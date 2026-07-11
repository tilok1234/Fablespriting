/**
 * Fablesprite — the quadruped gait template (design 06 §1.2 oscillators,
 * clip semantics per design 03 §§1–2, graph consumption per design 07
 * §1.2/§1.4).
 *
 * genome → part graph → skeleton/gait → slabs: since U1 the geometry
 * lives in the grammar (grammar.ts grows the rest-pose PartGraph); this
 * module is the per-plan pose function that layers the §1.2 oscillator
 * deltas onto the grown slabs for one (clip, phase) sample. Projection,
 * rasterization, and craft consume the result downstream. **Slab order
 * is part of the contract**: the rasterizer's per-pixel part tags index
 * this array, so the order is the graph's slab order (the §1.2 part
 * table's pinned row order) and is covered by tests.
 *
 * Model space (design 06 §1.2 / spike S1): x = creature's right,
 * y = forward (facing), z = up; units are pixels of the 32×32 target,
 * all values 16.16 raws. Phases are in fp TURNS (1.0 turn = 65536 raw =
 * full cycle), never radians.
 *
 * Everything here is deterministic and float-free (RISKS R6): all
 * arithmetic goes through fixed.ts. Per-frame deltas ADD to rest-pose
 * raws (exact int32 addition), so the decomposition into growth + gait
 * is byte-identical to the retired hardcoded template — proven by the
 * design 07 §1.2 fidelity sweep (seeds 0..1999) before that template
 * was deleted.
 */

import { asr, fp_add, fp_mul, sin_fp } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";
import type { MaterialRole } from "./grammar.js";
import { growQuadruped } from "./grammar.js";

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

/** Quarter turn in fp turns — the walk lift's phase lead (§1.2). */
const QUARTER_TURN = 16384; // 0.25 turns
/** Half turn — the trot offset of phase group 1 (G_i ∈ {0, 32768}). */
const HALF_TURN = 32768; // 0.5 turns
/** One full turn in fp raw. */
const FULL_TURN = 65536; // 1.0 turn

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
// poseQuadruped — §1.2 oscillators layered on the grown graph
// ---------------------------------------------------------------------------

/**
 * Pose the quadruped: genome → the 13 model-space slabs of the design 06
 * §1.2 part table, in the graph's pinned slab order, for one clip sample
 * at `phaseTurnsRaw` fp turns. The rest-pose geometry comes from
 * {@link growQuadruped}; this function adds the per-frame deltas.
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
 * (`sin(φ)`, not `sin(g·φ)`). Delta application per chain (design 07
 * §1.4): the bob b adds to cz on every non-limb chain (body, head,
 * tail); the tail chain additionally wags on cx; limb nodes swing on cy
 * (dy_i), and ride cz at half lift + half bob — cz + asr(dz_i, 1) +
 * asr(b, 1) — reconstructing each leg's G_i from its part path
 * (`<path>.phase_group`). Legs span z ∈ [0, 2·length] at rest, standing
 * on the ground plane. Head children stay attached under scaling
 * (S4-F18) because their rest offsets are grown from H in the grammar;
 * the §1.2 eye visibility coupling likewise lives in growth (known
 * residual: one sub-pixel straddle, seed 1142, characterized in
 * tests/raster.test.ts).
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

  const graph = growQuadruped(genome);

  const g = getScalar(genome, "anim.quadruped.gait_freq"); // int {1, 2}
  const bobAmp = getScalar(genome, "anim.quadruped.bob_amp");
  const swingAmp = getScalar(genome, "anim.quadruped.leg_swing_amp");
  const liftAmp = getScalar(genome, "anim.quadruped.leg_lift_amp");
  const tailLag = getScalar(genome, "anim.quadruped.tail_lag");
  const tailAmp = getScalar(genome, "anim.quadruped.tail_amp");

  // Oscillators (§1.2). g·φ and 2·g·φ are plain integer products (integer
  // frequency ratio × fp turns — design 03 §1); sin_fp wraps mod 1 turn.
  const b = walking
    ? fp_mul(bobAmp, sin_fp(2 * g * phi))
    : fp_mul(asr(bobAmp, 1), sin_fp(phi));
  const wag = walking
    ? fp_mul(tailAmp, sin_fp(g * phi - tailLag))
    : fp_mul(asr(tailAmp, 1), sin_fp(phi - tailLag));
  const legBobLift = asr(b, 1);

  const slabs = graph.parts.map((node) => {
    const [hx, hy, hz] = node.slab.half;
    let [cx, cy, cz] = node.slab.center;
    if (node.kind === "limb") {
      // Legs ride the bob at half amplitude and reconstruct their trot
      // offset from the part path's phase_group locus.
      let dy = 0;
      let dz = 0;
      if (walking) {
        const group = getScalar(genome, `${node.path}.phase_group`);
        const gi = group === 1 ? HALF_TURN : 0; // trot offset G_i ∈ {0, 32768}
        dy = fp_mul(swingAmp, sin_fp(g * phi + gi));
        dz = Math.max(0, fp_mul(liftAmp, sin_fp(g * phi + gi + QUARTER_TURN)));
      }
      cy = fp_add(cy, dy);
      cz = fp_add(fp_add(cz, asr(dz, 1)), legBobLift);
    } else {
      cz = fp_add(cz, b);
      if (node.animChain === "tail") cx = fp_add(cx, wag);
    }
    return Object.freeze({ cx, cy, cz, hx, hy, hz, role: node.materialRole });
  });

  return Object.freeze(slabs);
}
