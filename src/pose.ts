/**
 * Fablesprite — the quadruped gait template and clip set (design 06 §1.2
 * oscillators, clip semantics per design 03 §§1–2 and design 07 §4, graph
 * consumption per design 07 §1.2/§1.4).
 *
 * genome → part graph → skeleton/gait → slabs: since U1 the geometry
 * lives in the grammar (grammar.ts grows the rest-pose PartGraph); this
 * module is the per-plan pose function that layers the §1.2 oscillator
 * deltas — and, since U2, the design 07 §4 one-shot envelopes — onto the
 * grown slabs for one (clip, phase) sample. Projection, rasterization,
 * and craft consume the result downstream. **Slab order is part of the
 * contract**: the rasterizer's per-pixel part tags index this array, so
 * the order is the graph's slab order (the §1.2 part table's pinned row
 * order) and is covered by tests.
 *
 * Model space (design 06 §1.2 / spike S1): x = creature's right,
 * y = forward (facing), z = up; units are pixels of the 32×32 target,
 * all values 16.16 raws. Phases are in fp TURNS (1.0 turn = 65536 raw =
 * full cycle), never radians. Clips are defined in model space only —
 * the four directions stay pure projection (design 03 §2: "direction
 * handling is free"); no envelope constant is direction-aware.
 *
 * Everything here is deterministic and float-free (RISKS R6): all
 * arithmetic goes through fixed.ts. Per-frame deltas ADD to rest-pose
 * raws (exact int32 addition), so the decomposition into growth + gait
 * is byte-identical to the retired hardcoded template — proven by the
 * design 07 §1.2 fidelity sweep (seeds 0..1999) before that template
 * was deleted; walk/idle arithmetic is untouched by U2 (the design 07
 * §4.3 anchor law).
 */

import { asr, fp_add, fp_mul, sin_fp } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";
import type { MaterialRole, PartGraph } from "./grammar.js";
import { growQuadruped } from "./grammar.js";

/**
 * The M2 clip roster (design 03 §2 as pinned by design 07 §4.1):
 * `walk` = the full gait preset; `idle` = the pinned low-amplitude rule
 * (idle amplitude = walk >> 1 — a pipeline rule, not a locus); `attack`,
 * `hurt`, `death` = the idle preset plus a one-shot envelope (design 07
 * §4.4 pinned tables). Frame-set order is exactly this declaration order.
 */
export type ClipName = "walk" | "idle" | "attack" | "hurt" | "death";

/**
 * Per-clip frame count K (design 07 §4.1, pinned): walk 4, idle 4 (M1),
 * attack 4 (anticipation, strike, recovery, recovery), hurt 2
 * (recoil, return), death 4 (stagger, sink, collapse, held final frame).
 */
export const CLIP_KS: Readonly<Record<ClipName, number>> = Object.freeze({
  walk: 4,
  idle: 4,
  attack: 4,
  hurt: 2,
  death: 4,
});

/**
 * The one-shot clips (design 07 §4.2): played once, never wrapped — the
 * flicker metric measures consecutive pairs only for these.
 */
export const ONE_SHOT_CLIPS: ReadonlySet<ClipName> = Object.freeze(
  new Set<ClipName>(["attack", "hurt", "death"]),
);

/**
 * One axis-aligned ellipsoid slab in model space (design 06 §1.2): center
 * and half-extents as 16.16 raws plus the material role. Half-extents are
 * strictly positive for every valid genome (locus domains keep them so;
 * the death leg fold scales by factors ≥ 0.35 of positive raws).
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
// Clip phase sampling (S2 verdict / F10: uniform, K per design 07 §4.1)
// ---------------------------------------------------------------------------

/**
 * The K uniform clip phases in fp turns: φ_k = k · (65536 / K). M1 pins
 * K = 4 for walk and idle (design 06 §1.2 per S2/F10 — uniform sampling,
 * uniform durations), giving exactly {0, 16384, 32768, 49152} raw =
 * {0, 0.25, 0.5, 0.75} turns; U2's clips pin K per {@link CLIP_KS}
 * (hurt's K = 2 gives {0, 32768}). Each is an exact multiple of the
 * sin-LUT granularity (16 raw = 2^−12 turns) by construction. Any k must
 * divide 65536 so the phases stay exact raws.
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
// Per-genome growth cache (design 07 §4 U2 note — byte-inert by purity)
// ---------------------------------------------------------------------------

/**
 * Growth cache: {@link growQuadruped} is a pure function of the (frozen)
 * genome object, so caching its graph per genome identity is
 * byte-invisible — the 72-frame set re-grows once instead of once per
 * pose sample. WeakMap keeps the cache from pinning genomes in memory.
 */
const GRAPH_CACHE = new WeakMap<Genome, PartGraph>();

function cachedQuadrupedGraph(genome: Genome): PartGraph {
  let graph = GRAPH_CACHE.get(genome);
  if (graph === undefined) {
    graph = growQuadruped(genome);
    GRAPH_CACHE.set(genome, graph);
  }
  return graph;
}

// ---------------------------------------------------------------------------
// The design 07 §4.4 envelope tables (pinned raws — see the amendment)
// ---------------------------------------------------------------------------

/** Per-chain-class translation deltas of one envelope frame, fp raws. */
interface EnvelopeFrame {
  /** True iff this frame's deltas scale by the anticipation locus. */
  readonly scaled: boolean;
  /** [dy, dz] for the body chain (core + underside). */
  readonly body: readonly [number, number];
  /** [dy, dz] for the head chain (head, snout, ears, eyes). */
  readonly head: readonly [number, number];
  /** [dy, dz] for the tail chain. */
  readonly tail: readonly [number, number];
  /** [dy, dz] for every limb (the four leg chains). */
  readonly limb: readonly [number, number];
}

const ENV = (
  scaled: boolean,
  body: readonly [number, number],
  head: readonly [number, number],
  tail: readonly [number, number],
  limb: readonly [number, number],
): EnvelopeFrame => Object.freeze({ scaled, body, head, tail, limb });

/**
 * ATTACK envelope (design 07 §4.4, K = 4): f0 wind-up (contract along −y
 * and crouch, scaled by `anim.quadruped.anticipation`), f1 strike (lunge
 * along +y, head leading, legs carried), f2 recovery easing back, f3
 * recovered (pure idle base). Raws are the pinned px constants × 2^16.
 */
const ATTACK_ENVELOPE: readonly EnvelopeFrame[] = Object.freeze([
  ENV(true, [-98304, -45875], [-131072, -58982], [32768, -45875], [0, 0]), // f0: −1.5/−0.7, −2.0/−0.9, +0.5/−0.7, legs planted
  ENV(false, [147456, 0], [196608, 0], [98304, 0], [147456, 0]), // f1: +2.25, +3.0, +1.5, +2.25
  ENV(false, [49152, 0], [65536, 0], [32768, 0], [49152, 0]), // f2: +0.75, +1.0, +0.5, +0.75
  ENV(false, [0, 0], [0, 0], [0, 0], [0, 0]), // f3: recovered
]);

/**
 * HURT envelope (design 07 §4.4, K = 2): f0 whole-body recoil along −y
 * (every chain, limbs included — no stretch), f1 return to the idle base.
 * The palette flash is metadata only (`flash: true` on the clip entries).
 */
const HURT_ENVELOPE: readonly EnvelopeFrame[] = Object.freeze([
  ENV(false, [-147456, 0], [-147456, 0], [-147456, 0], [-147456, 0]), // f0: −2.25 px whole-body recoil
  ENV(false, [0, 0], [0, 0], [0, 0], [0, 0]), // f1: return
]);

/**
 * DEATH envelope (design 07 §4.4, K = 4) — the quadruped collapse:
 *
 * - Every chain shifts DEATH_DY along −y on every frame (the stagger).
 * - Each non-limb chain sinks toward the ground line by
 *   `dz = −fp_mul(DEATH_SINK[k], max(0, restCz − restHz))` computed from
 *   its anchor node's REST slab (the chain's first slab in the grown
 *   graph) and applied to every slab of the chain — rigid per-chain
 *   translation, so faces never scramble (F16's assembly lesson).
 * - Limbs fold: `cz → fp_mul(DEATH_FOLD[k], cz)`,
 *   `hz → fp_mul(DEATH_FOLD[k], hz)` — feet stay on the ground line
 *   (cz = hz at rest), the leg shortens as it folds.
 * - Frame 3 IS frame 2 (the held final pose): poseQuadruped evaluates
 *   k = 3 as k = 2 wholesale — envelope AND idle base — so the two slab
 *   lists are identical and the f2→f3 flicker pair is 0 changed pixels
 *   at 0 motion (score 0.0 by the zero-motion convention).
 */
const DEATH_DY = -49152; // −0.75 px stagger, all chains, all frames
const DEATH_SINK: readonly number[] = Object.freeze([9830, 29491, 55706]); // 0.15, 0.45, 0.85
const DEATH_FOLD: readonly number[] = Object.freeze([58982, 42598, 22938]); // 0.9, 0.65, 0.35

// ---------------------------------------------------------------------------
// poseQuadruped — §1.2 oscillators + §4.4 envelopes on the grown graph
// ---------------------------------------------------------------------------

/**
 * Pose the quadruped: genome → the 13 model-space slabs of the design 06
 * §1.2 part table, in the graph's pinned slab order, for one clip sample
 * at `phaseTurnsRaw` fp turns. The rest-pose geometry comes from
 * {@link growQuadruped} (cached per genome); this function adds the
 * per-frame deltas.
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
 * For walk/idle the phase argument must be an integer raw; it may lie
 * outside [0, 65536) — oscillator arguments wrap through the LUT (§5.3),
 * so any whole number of turns added to φ is a no-op.
 *
 * The one-shot clips (attack, hurt, death — design 07 §4.4) are the IDLE
 * base at the clip's own uniform phase φ_k plus the pinned envelope
 * deltas for frame k; their phase argument must be exactly one of the
 * clip's K uniform phases (φ = k · 65536/K, k ∈ [0, K)) — envelopes are
 * per-frame curves, defined nowhere else. Death's k = 3 evaluates as
 * k = 2 (the held final frame).
 */
export function poseQuadruped(
  genome: Genome,
  clip: ClipName,
  phaseTurnsRaw: number,
): readonly Slab[] {
  const kFrames = CLIP_KS[clip];
  if (kFrames === undefined) {
    throw new RangeError(
      `pose: unknown clip ${JSON.stringify(clip)} (clips are walk | idle | attack | hurt | death)`,
    );
  }
  if (!Number.isInteger(phaseTurnsRaw)) {
    throw new RangeError(`pose: phase must be an integer fp-turns raw, got ${phaseTurnsRaw}`);
  }

  const oneShot = ONE_SHOT_CLIPS.has(clip);
  let phi = phaseTurnsRaw;
  let frame = 0;
  if (oneShot) {
    const step = FULL_TURN / kFrames;
    if (phaseTurnsRaw < 0 || phaseTurnsRaw >= FULL_TURN || phaseTurnsRaw % step !== 0) {
      throw new RangeError(
        `pose: one-shot clip ${clip} is defined only at its ${kFrames} uniform phases (multiples of ${step} in [0, 65536)), got ${phaseTurnsRaw}`,
      );
    }
    frame = phaseTurnsRaw / step;
    if (clip === "death" && frame === 3) frame = 2; // held final frame — f3 IS f2
    phi = frame * step;
  }
  const walking = clip === "walk";

  const graph = cachedQuadrupedGraph(genome);

  const g = getScalar(genome, "anim.quadruped.gait_freq"); // int {1, 2}
  const bobAmp = getScalar(genome, "anim.quadruped.bob_amp");
  const swingAmp = getScalar(genome, "anim.quadruped.leg_swing_amp");
  const liftAmp = getScalar(genome, "anim.quadruped.leg_lift_amp");
  const tailLag = getScalar(genome, "anim.quadruped.tail_lag");
  const tailAmp = getScalar(genome, "anim.quadruped.tail_amp");

  // Oscillators (§1.2). g·φ and 2·g·φ are plain integer products (integer
  // frequency ratio × fp turns — design 03 §1); sin_fp wraps mod 1 turn.
  // One-shot clips ride the IDLE base (walking = false throughout).
  const b = walking
    ? fp_mul(bobAmp, sin_fp(2 * g * phi))
    : fp_mul(asr(bobAmp, 1), sin_fp(phi));
  const wag = walking
    ? fp_mul(tailAmp, sin_fp(g * phi - tailLag))
    : fp_mul(asr(tailAmp, 1), sin_fp(phi - tailLag));
  const legBobLift = asr(b, 1);

  // Envelope preparation (design 07 §4.4).
  let envFrame: EnvelopeFrame | undefined;
  let antScale = 65536;
  if (clip === "attack") {
    envFrame = ATTACK_ENVELOPE[frame]!;
    antScale = getScalar(genome, "anim.quadruped.anticipation");
  } else if (clip === "hurt") {
    envFrame = HURT_ENVELOPE[frame]!;
  }
  const isDeath = clip === "death";
  // Death per-chain sink deltas from the chains' anchor REST slabs.
  let deathSinkByChain: ReadonlyMap<string, number> | undefined;
  if (isDeath) {
    const sinkK = DEATH_SINK[frame]!;
    const sinks = new Map<string, number>();
    for (const chain of graph.chains) {
      const anchor = graph.parts[chain.slabs[0]!]!;
      if (anchor.kind === "limb") continue;
      const drop = Math.max(0, anchor.slab.center[2] - anchor.slab.half[2]);
      sinks.set(chain.name, -fp_mul(sinkK, drop));
    }
    deathSinkByChain = sinks;
  }

  const slabs = graph.parts.map((node) => {
    let [hx, hy, hz] = node.slab.half;
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
      if (envFrame !== undefined) {
        const [edy, edz] = envFrame.limb;
        cy = fp_add(cy, envFrame.scaled ? fp_mul(antScale, edy) : edy);
        cz = fp_add(cz, envFrame.scaled ? fp_mul(antScale, edz) : edz);
      }
      if (isDeath) {
        const fold = DEATH_FOLD[frame]!;
        cy = fp_add(cy, DEATH_DY);
        cz = fp_mul(fold, cz);
        hz = fp_mul(fold, hz);
      }
    } else {
      cz = fp_add(cz, b);
      if (node.animChain === "tail") cx = fp_add(cx, wag);
      if (envFrame !== undefined) {
        const [edy, edz] =
          node.animChain === "head"
            ? envFrame.head
            : node.animChain === "tail"
              ? envFrame.tail
              : envFrame.body;
        cy = fp_add(cy, envFrame.scaled ? fp_mul(antScale, edy) : edy);
        cz = fp_add(cz, envFrame.scaled ? fp_mul(antScale, edz) : edz);
      }
      if (isDeath) {
        cy = fp_add(cy, DEATH_DY);
        cz = fp_add(cz, deathSinkByChain!.get(node.animChain)!);
      }
    }
    return Object.freeze({ cx, cy, cz, hx, hy, hz, role: node.materialRole });
  });

  return Object.freeze(slabs);
}
