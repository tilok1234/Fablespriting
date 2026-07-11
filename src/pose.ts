/**
 * Fablesprite — the M1 quadruped pose/geometry layer (design 06 §1.2, with
 * clip semantics per design 03 §§1–2).
 *
 * genome → part graph → skeleton/gait → slabs: this module implements the
 * hardcoded wolf template — the production transcription of Spike S1's
 * `wolf()` — in 16.16 fixed point. It produces the model-space slab list
 * for one (clip, phase) sample; projection, rasterization, and craft
 * consume it downstream. **Slab order is part of the contract**: the
 * rasterizer's per-pixel part tags index this array, so the row order of
 * the §1.2 part table is pinned here and covered by tests.
 *
 * Model space (design 06 §1.2 / spike S1): x = creature's right,
 * y = forward (facing), z = up; units are pixels of the 32×32 target,
 * all values 16.16 raws. Phases are in fp TURNS (1.0 turn = 65536 raw =
 * full cycle), never radians.
 *
 * Everything here is deterministic and float-free (RISKS R6): all
 * arithmetic goes through fixed.ts, every pinned template constant is the
 * spec's `RHE(d · 2^16)` raw with the authored decimal in a comment.
 */

import { asr, fp_add, fp_div, fp_mul, fp_sqrt, fp_sub, sin_fp } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";

/**
 * Material role vocabulary of the §1.2 part table. Roles select palette
 * ramps (§1.3): `hide` and `underside` follow `palette.ramp_len`; `focal`
 * (eyes) always uses the pinned 4-entry focal table and is
 * merge-protected in the craft pass (F16).
 */
export type MaterialRole = "hide" | "underside" | "focal";

/**
 * M1 clip names (design 03 §2, narrowed to M1 scope by design 06 §1):
 * `walk` = the full gait preset; `idle` = the pinned low-amplitude rule
 * (idle amplitude = walk >> 1 — a pipeline rule, not a locus).
 */
export type ClipName = "walk" | "idle";

/**
 * One axis-aligned ellipsoid slab in model space (design 06 §1.2): center
 * and half-extents as 16.16 raws plus the material role. Half-extents are
 * strictly positive for every valid genome (locus domains keep them so).
 */
export interface Slab {
  /** Center x (16.16 raw px, model space — creature's right). */
  readonly cx: number;
  /** Center y (16.16 raw px, model space — forward). */
  readonly cy: number;
  /** Center z (16.16 raw px, model space — up). */
  readonly cz: number;
  /** Half-extent along x (16.16 raw px, > 0). */
  readonly hx: number;
  /** Half-extent along y (16.16 raw px, > 0). */
  readonly hy: number;
  /** Half-extent along z (16.16 raw px, > 0). */
  readonly hz: number;
  /** Palette-ramp role (§1.3). */
  readonly role: MaterialRole;
}

/**
 * Part names in the pinned slab order — the §1.2 part table's row order
 * with mirror pairs and leg sockets expanded. `poseQuadruped()[i]` is
 * always the part `PART_NAMES[i]`; the rasterizer's part-tag ids index
 * this list. Mirror pairs emit their −x (left) member first, matching the
 * FL-before-FR socket convention (FL is the −hip_x socket, §1.2 hips).
 */
export const PART_NAMES = Object.freeze([
  "core",
  "core_underside",
  "head",
  "snout",
  "ear_l",
  "ear_r",
  "eye_l",
  "eye_r",
  "leg_fl",
  "leg_fr",
  "leg_bl",
  "leg_br",
  "tail",
] as const);

/** Material role of each pinned slab position (§1.2 part-table column). */
export const PART_ROLES: readonly MaterialRole[] = Object.freeze([
  "hide", // core
  "underside", // core underside
  "hide", // head
  "underside", // snout
  "hide", // ear_l
  "hide", // ear_r
  "focal", // eye_l
  "focal", // eye_r
  "hide", // leg FL
  "hide", // leg FR
  "hide", // leg BL
  "hide", // leg BR
  "hide", // tail
]);

// ---------------------------------------------------------------------------
// §1.2 pinned template constants — raw = RHE(d · 2^16) of the authored
// decimal, per the design 06 notation rule.
// ---------------------------------------------------------------------------

/** Core center y = −0.5. */
const CORE_CY = -32768;
/** Underside half-extent factors: 0.769·girth, 0.737·length, 0.647·depth. */
const UNDERSIDE_KX = 50397; // 0.769
const UNDERSIDE_KY = 48300; // 0.737
const UNDERSIDE_KZ = 42402; // 0.647
/** Head half-extents scale·(3.0, 3.4, 3.0). */
const HEAD_HX = 196608; // 3.0
const HEAD_HY = 222822; // 3.4
const HEAD_HZ = 196608; // 3.0
/** Snout center offset from H, scaled: scale·(0, 3.3, −1.2). */
const SNOUT_OY = 216269; // 3.3
const SNOUT_OZ = -78643; // −1.2
/**
 * Snout half-extents (scale·1.6, snout_len, scale·1.5) — cross-extents
 * scale with the head (§1.2 as amended by the eye visibility coupling):
 * fixed 1.6/1.5 extents on a shrunken head rode up over the eye rows and
 * occluded them from the camera. `fp_mul(1.0, c) = c`, so scale-1
 * genomes are byte-identical to the original constants.
 */
const SNOUT_HX = 104858; // 1.6
const SNOUT_HZ = 98304; // 1.5
/** Ear center offset from H, scaled: scale·(±2.0, −1.1, 2.8). */
const EAR_OX = 131072; // 2.0
const EAR_OY = -72090; // −1.1
const EAR_OZ = 183501; // 2.8
/** Ear half-extents ear_size·(0.9, 1.0, 1.7). */
const EAR_HX = 58982; // 0.9
const EAR_HY = 65536; // 1.0
const EAR_HZ = 111411; // 1.7
/**
 * Eye center offset from H: (±scale·eye_offset, EY, scale·0.6), with EY
 * the derived forward offset of the §1.2 eye visibility coupling —
 * `EY = max(scale·2.6, ySurf − 0.3·eyeHy)`, guaranteeing the eye's front
 * face protrudes at least 0.7 of its forward half-extent beyond the head
 * surface at the eye's own (x, z) column. 0.7 sits just below the
 * default wolf's own protrusion ratio (≈ 0.7221), so the all-default
 * genome takes the plain-constant branch with a 1016-raw margin
 * (machine-verified) and stays byte-identical.
 */
const EYE_OY = 170394; // 2.6 — the wolf forward-offset constant
const EYE_OZ = 39322; // 0.6
/**
 * Eye half-extents eye_size·(0.8, 0.7, 0.8), floored at these same raws
 * (§1.2 eye visibility coupling: no rendered eye is smaller than the
 * default wolf's — sub-pixel eye discs split their ≤ 16 supersamples
 * across pixel boundaries and lose every majority vote). Factor and
 * floor coincide because the default `eye_size` is exactly 1.0.
 */
const EYE_HX = 52429; // 0.8
const EYE_HY = 45875; // 0.7
const EYE_HZ = 52429; // 0.8
/**
 * Head-frame column base of the eye's head-surface extent:
 * 1 − (0.6/3.0)² = 0.96, raw RHE(0.96·2^16) = 62915 — identically
 * FP_ONE − fp_mul(13107, 13107) (both derivations agree,
 * machine-verified). The eye's x column enters as
 * `Xn = fp_div(eye_offset, 3.0)` (head scale cancels), and
 * `inside = 0.96 − Xn²` stays > 0 over the whole eye_offset domain
 * (max Xn = 0.8 → inside ≥ 0.32).
 */
const EYE_INSIDE_BASE = 62915; // 0.96
/** 1 − κ with κ = 0.7 the guaranteed protrusion ratio; raw RHE(0.3·2^16). */
const EYE_SLACK = 19661; // 0.3
/** Leg half-extent along y (1.5). */
const LEG_HY = 98304; // 1.5

/** Quarter turn in fp turns — the walk lift's phase lead (§1.2). */
const QUARTER_TURN = 16384; // 0.25 turns
/** Half turn — the trot offset of phase group 1 (G_i ∈ {0, 32768}). */
const HALF_TURN = 32768; // 0.5 turns
/** One full turn in fp raw. */
const FULL_TURN = 65536; // 1.0 turn

// ---------------------------------------------------------------------------
// §1.2 anchor coupling: anchor(dim) = C + fp_mul(σ, dim − D)
// ---------------------------------------------------------------------------

/**
 * The derived attachment anchors of design 06 §1.2 — "derived anchors,
 * not constants". Each is the wolf constant C plus a proportional
 * correction along its tracked core dimension:
 * `anchor(dim) = C + fp_mul(σ, dim − D)`. The delta form is load-bearing:
 * `fp_mul(σ, 0) = 0`, so at the all-default core dims every anchor equals
 * the original wolf raw constant exactly (machine-verified in the spec,
 * asserted in tests/pose.test.ts).
 */
export interface QuadrupedAnchors {
  /** HY head center y — C 8.3 (543949), tracks core.length, σ 71572 (8.3/7.6). */
  readonly hy: number;
  /** HZ head center z — C 9.8 (642253), tracks core.depth, σ 107942 (1 + 2.2/3.4). */
  readonly hz: number;
  /** hip_y fore (FL, FR) — C 4.6 (301466), tracks core.length, σ 39667 (4.6/7.6). */
  readonly hipYFore: number;
  /** hip_y hind (BL, BR) — C −5.2 (−340787), tracks core.length, σ −44840 (−5.2/7.6). */
  readonly hipYHind: number;
  /** hip_x (± per socket) — C 2.6 (170394), tracks core.girth, σ 43691 (2.6/3.9). */
  readonly hipX: number;
  /** CZ core center z — C 7.6 (498074), tracks core.depth, σ 65536 (slope 1). */
  readonly cz: number;
  /** UY underside center y — C 1.5 (98304), tracks core.length, σ 17246 (2.0/7.6). */
  readonly uy: number;
  /** UZ underside center z — C 5.9 (386662), tracks core.depth, σ 32768 (1 − 1.7/3.4). */
  readonly uz: number;
  /** TY tail center y — C −8.8 (−576717), tracks core.length, σ −65536 (slope −1). */
  readonly ty: number;
  /** TZ tail center z — C 9.6 (629146), tracks core.depth, σ 104087 (1 + 2.0/3.4). */
  readonly tz: number;
}

/** `anchor(dim) = C + fp_mul(σ, dim − D)` — the §1.2 coupling law. */
function anchor(c: number, sigma: number, dim: number, dimDefault: number): number {
  return fp_add(c, fp_mul(sigma, fp_sub(dim, dimDefault)));
}

/** Registry defaults of the tracked core dimensions (design 06 §1.1). */
const LENGTH_D = 498074; // body.core.length 7.6
const GIRTH_D = 255590; // body.core.girth 3.9
const DEPTH_D = 222822; // body.core.depth 3.4

/**
 * Compute the derived attachment anchors for a genome's core dimensions,
 * exactly per the design 06 §1.2 coupling table. Every C, D, and σ below
 * is the spec's pinned raw.
 */
export function deriveAnchors(genome: Genome): QuadrupedAnchors {
  const length = getScalar(genome, "body.core.length");
  const girth = getScalar(genome, "body.core.girth");
  const depth = getScalar(genome, "body.core.depth");
  return Object.freeze({
    hy: anchor(543949, 71572, length, LENGTH_D), // C 8.3, σ 8.3/7.6
    hz: anchor(642253, 107942, depth, DEPTH_D), // C 9.8, σ 1 + 2.2/3.4
    hipYFore: anchor(301466, 39667, length, LENGTH_D), // C 4.6, σ 4.6/7.6
    hipYHind: anchor(-340787, -44840, length, LENGTH_D), // C −5.2, σ −5.2/7.6
    hipX: anchor(170394, 43691, girth, GIRTH_D), // C 2.6, σ 2.6/3.9
    cz: anchor(498074, 65536, depth, DEPTH_D), // C 7.6, σ 1
    uy: anchor(98304, 17246, length, LENGTH_D), // C 1.5, σ 2.0/7.6
    uz: anchor(386662, 32768, depth, DEPTH_D), // C 5.9, σ 1 − 1.7/3.4
    ty: anchor(-576717, -65536, length, LENGTH_D), // C −8.8, σ −1
    tz: anchor(629146, 104087, depth, DEPTH_D), // C 9.6, σ 1 + 2.0/3.4
  });
}

// ---------------------------------------------------------------------------
// Clip phase sampling (S2 verdict / F10: uniform, K = 4 for both clips)
// ---------------------------------------------------------------------------

/**
 * The K uniform clip phases in fp turns: φ_k = k · (65536 / K). M1 pins
 * K = 4 for both clips (design 06 §1.2 per S2/F10 — uniform sampling,
 * uniform durations), giving exactly {0, 16384, 32768, 49152} raw =
 * {0, 0.25, 0.5, 0.75} turns; each is an exact multiple of the sin-LUT
 * granularity (16 raw = 2^−12 turns) by construction. Any k must divide
 * 65536 so the phases stay exact raws.
 */
export function clipPhases(k = 4): readonly number[] {
  if (!Number.isInteger(k) || k < 1 || FULL_TURN % k !== 0) {
    throw new RangeError(
      `pose: clipPhases k must be a positive integer dividing 65536, got ${k}`,
    );
  }
  const step = FULL_TURN / k;
  const phases: number[] = [];
  for (let i = 0; i < k; i++) phases.push(i * step);
  return Object.freeze(phases);
}

// ---------------------------------------------------------------------------
// poseQuadruped — the §1.2 part table + oscillators
// ---------------------------------------------------------------------------

/** Leg sockets in pinned order; sign is the hip_x mirror (§1.2 hips). */
const LEG_SOCKETS = Object.freeze([
  { socket: "FL", sign: -1, fore: true },
  { socket: "FR", sign: +1, fore: true },
  { socket: "BL", sign: -1, fore: false },
  { socket: "BR", sign: +1, fore: false },
] as const);

function slab(
  cx: number,
  cy: number,
  cz: number,
  hx: number,
  hy: number,
  hz: number,
  role: MaterialRole,
): Slab {
  return Object.freeze({ cx, cy, cz, hx, hy, hz, role });
}

/**
 * Pose the M1 quadruped: genome → the 13 model-space slabs of the
 * design 06 §1.2 part table, in the pinned {@link PART_NAMES} order, for
 * one clip sample at `phaseTurnsRaw` fp turns.
 *
 * Oscillators (§1.2, exact equations; sin = the §5.3 LUT, g = gait_freq,
 * φ in fp turns, G_i the trot offset {0, 32768} from each leg's
 * phase_group):
 *
 * ```
 * walk:  b    = fp_mul(bob_amp,        sin(2·g·φ))
 *        dy_i = fp_mul(leg_swing_amp,  sin(g·φ + G_i))
 *        dz_i = max(0, fp_mul(leg_lift_amp, sin(g·φ + G_i + 16384)))
 *        wag  = fp_mul(tail_amp,       sin(g·φ − tail_lag))
 * idle:  b    = fp_mul(asr(bob_amp,1), sin(φ));  dy_i = dz_i = 0
 *        wag  = fp_mul(asr(tail_amp,1), sin(φ − tail_lag))
 * ```
 *
 * Idle amplitude = walk >> 1 is the pinned pipeline rule (design 06 §1.2,
 * design 03 §2's low-amplitude preset); idle ignores g by construction
 * (`sin(φ)`, not `sin(g·φ)`). Legs ride the bob at half amplitude —
 * center z = length + asr(dz, 1) + asr(b, 1) — and span z ∈ [0, 2·length]
 * at rest, standing on the ground plane. Head children (snout, ears,
 * eyes) offset from H scaled by `head.scale`, so grown heads keep their
 * features attached (S4-F18). The §1.2 eye visibility coupling extends
 * that lesson: eye half-extents floor at the default wolf's raws, the
 * eye forward offset floors at a guaranteed-protrusion value, and the
 * snout's cross-extents scale with the head — so every sampled genome's
 * eyes survive rasterization (known residual: one sub-pixel straddle,
 * seed 1142, characterized in tests/raster.test.ts).
 *
 * The phase argument must be an integer raw; it may lie outside
 * [0, 65536) — oscillator arguments wrap through the LUT (§5.3), so any
 * whole number of turns added to φ is a no-op.
 */
export function poseQuadruped(
  genome: Genome,
  clip: ClipName,
  phaseTurnsRaw: number,
): readonly Slab[] {
  if (clip !== "walk" && clip !== "idle") {
    throw new RangeError(`pose: unknown clip ${JSON.stringify(clip)} (M1 clips are walk | idle)`);
  }
  if (!Number.isInteger(phaseTurnsRaw)) {
    throw new RangeError(`pose: phase must be an integer fp-turns raw, got ${phaseTurnsRaw}`);
  }
  const phi = phaseTurnsRaw;
  const walking = clip === "walk";

  const g = getScalar(genome, "anim.quadruped.gait_freq"); // int {1, 2}
  const bobAmp = getScalar(genome, "anim.quadruped.bob_amp");
  const swingAmp = getScalar(genome, "anim.quadruped.leg_swing_amp");
  const liftAmp = getScalar(genome, "anim.quadruped.leg_lift_amp");
  const tailLag = getScalar(genome, "anim.quadruped.tail_lag");
  const tailAmp = getScalar(genome, "anim.quadruped.tail_amp");
  const length = getScalar(genome, "body.core.length");
  const girth = getScalar(genome, "body.core.girth");
  const depth = getScalar(genome, "body.core.depth");
  const scale = getScalar(genome, "body.head.scale");
  const snoutLen = getScalar(genome, "body.head.snout_len");
  const earSize = getScalar(genome, "body.head.ear_size");
  const eyeSize = getScalar(genome, "body.head.eye_size");
  const eyeOffset = getScalar(genome, "body.head.eye_offset");
  const tailLen = getScalar(genome, "body.tail.length");
  const tailGirth = getScalar(genome, "body.tail.girth");

  const a = deriveAnchors(genome);

  // Oscillators (§1.2). g·φ and 2·g·φ are plain integer products (integer
  // frequency ratio × fp turns — design 03 §1); sin_fp wraps mod 1 turn.
  const b = walking
    ? fp_mul(bobAmp, sin_fp(2 * g * phi))
    : fp_mul(asr(bobAmp, 1), sin_fp(phi));
  const wag = walking
    ? fp_mul(tailAmp, sin_fp(g * phi - tailLag))
    : fp_mul(asr(tailAmp, 1), sin_fp(phi - tailLag));

  const slabs: Slab[] = [];

  // core — (0, −0.5, CZ + b), half (girth, length, depth), hide
  slabs.push(slab(0, CORE_CY, fp_add(a.cz, b), girth, length, depth, "hide"));

  // core underside — (0, UY, UZ + b), half (0.769·girth, 0.737·length,
  // 0.647·depth), underside
  slabs.push(
    slab(
      0,
      a.uy,
      fp_add(a.uz, b),
      fp_mul(UNDERSIDE_KX, girth),
      fp_mul(UNDERSIDE_KY, length),
      fp_mul(UNDERSIDE_KZ, depth),
      "underside",
    ),
  );

  // head — H = (0, HY, HZ + b), half scale·(3.0, 3.4, 3.0), hide
  const headY = a.hy;
  const headZ = fp_add(a.hz, b);
  const headHy = fp_mul(scale, HEAD_HY);
  slabs.push(
    slab(0, headY, headZ, fp_mul(scale, HEAD_HX), headHy, fp_mul(scale, HEAD_HZ), "hide"),
  );

  // snout — H + scale·(0, 3.3, −1.2), half (scale·1.6, snout_len,
  // scale·1.5), underside
  slabs.push(
    slab(
      0,
      fp_add(headY, fp_mul(scale, SNOUT_OY)),
      fp_add(headZ, fp_mul(scale, SNOUT_OZ)),
      fp_mul(scale, SNOUT_HX),
      snoutLen,
      fp_mul(scale, SNOUT_HZ),
      "underside",
    ),
  );

  // ears (±) — H + scale·(±2.0, −1.1, 2.8), half ear_size·(0.9, 1.0, 1.7),
  // hide; −x (left) member first
  const earX = fp_mul(scale, EAR_OX);
  const earY = fp_add(headY, fp_mul(scale, EAR_OY));
  const earZ = fp_add(headZ, fp_mul(scale, EAR_OZ));
  const earHx = fp_mul(earSize, EAR_HX);
  const earHy = fp_mul(earSize, EAR_HY);
  const earHz = fp_mul(earSize, EAR_HZ);
  slabs.push(slab(-earX, earY, earZ, earHx, earHy, earHz, "hide"));
  slabs.push(slab(earX, earY, earZ, earHx, earHy, earHz, "hide"));

  // eyes (±) — H + (±scale·eye_offset, EY, scale·0.6), half-extents
  // eye_size·(0.8, 0.7, 0.8) floored at the default raws, focal; −x
  // (left) member first. EY per the §1.2 eye visibility coupling: the
  // exact fp step order below is normative (floors first — the slack
  // term uses the FLOORED forward half-extent).
  const eyeHx = Math.max(fp_mul(eyeSize, EYE_HX), EYE_HX);
  const eyeHy = Math.max(fp_mul(eyeSize, EYE_HY), EYE_HY);
  const eyeHz = Math.max(fp_mul(eyeSize, EYE_HZ), EYE_HZ);
  const eyeXn = fp_div(eyeOffset, HEAD_HX); // head scale cancels
  const eyeInside = fp_sub(EYE_INSIDE_BASE, fp_mul(eyeXn, eyeXn));
  const eyeYSurf = fp_mul(headHy, fp_sqrt(eyeInside));
  const eyeMinOy = fp_sub(eyeYSurf, fp_mul(EYE_SLACK, eyeHy));
  const eyeX = fp_mul(scale, eyeOffset);
  const eyeY = fp_add(headY, Math.max(fp_mul(scale, EYE_OY), eyeMinOy));
  const eyeZ = fp_add(headZ, fp_mul(scale, EYE_OZ));
  slabs.push(slab(-eyeX, eyeY, eyeZ, eyeHx, eyeHy, eyeHz, "focal"));
  slabs.push(slab(eyeX, eyeY, eyeZ, eyeHx, eyeHy, eyeHz, "focal"));

  // legs ×4 — (hip_x, hip_y + dy_i, length_i + asr(dz_i, 1) + asr(b, 1)),
  // half (girth_i, 1.5, length_i), hide; sockets FL, FR, BL, BR
  const legBobLift = asr(b, 1);
  for (const { socket, sign, fore } of LEG_SOCKETS) {
    const legLen = getScalar(genome, `body.leg[${socket}].length`);
    const legGirth = getScalar(genome, `body.leg[${socket}].girth`);
    const group = getScalar(genome, `body.leg[${socket}].phase_group`);
    const gi = group === 1 ? HALF_TURN : 0; // trot offset G_i ∈ {0, 32768}
    let dy = 0;
    let dz = 0;
    if (walking) {
      dy = fp_mul(swingAmp, sin_fp(g * phi + gi));
      dz = Math.max(0, fp_mul(liftAmp, sin_fp(g * phi + gi + QUARTER_TURN)));
    }
    slabs.push(
      slab(
        sign * a.hipX,
        fp_add(fore ? a.hipYFore : a.hipYHind, dy),
        fp_add(fp_add(legLen, asr(dz, 1)), legBobLift),
        legGirth,
        LEG_HY,
        legLen,
        "hide",
      ),
    );
  }

  // tail — (wag, TY, TZ + b), half (tail.girth, tail.length, tail.girth),
  // hide
  slabs.push(slab(wag, a.ty, fp_add(a.tz, b), tailGirth, tailLen, tailGirth, "hide"));

  return Object.freeze(slabs);
}
