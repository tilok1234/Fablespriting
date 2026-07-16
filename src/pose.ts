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

import { FP_ONE, asr, fp_add, fp_div, fp_mul, fp_sub, sin_fp } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";
import type { MaterialRole, PartGraph } from "./grammar.js";
import {
  AMORPHOUS_WEIGHTS,
  CREST_ZREL,
  IDLE_BREATH,
  deriveAmorphousAnchors,
  growAmorphous,
  growLevitant,
  growQuadruped,
} from "./grammar.js";

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
  /**
   * Metaball field weight (design 07 §2.4.1 / §3, U4): present (a
   * positive fp raw) on the amorphous ball slabs ONLY — slabs carrying
   * it form THE field group inside `rasterize` (the single renderer
   * fork) and their half-extents are VISIBLE radii (F8); absent slabs
   * are classic ellipsoids. Per-frame value: the death envelope
   * deflates it. Everything outside the rasterizer (hitboxes, shadow,
   * snapping, flicker energy, craft) ignores it.
   */
  readonly fieldWeight?: number;
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

/** Levitant growth cache — same §4.4.8 pattern, separate map (a genome
 * only ever poses under its own meta.plan, but the caches stay disjoint
 * so a mixed-use genome object cannot cross-contaminate). */
const LEVITANT_GRAPH_CACHE = new WeakMap<Genome, PartGraph>();

function cachedLevitantGraph(genome: Genome): PartGraph {
  let graph = LEVITANT_GRAPH_CACHE.get(genome);
  if (graph === undefined) {
    graph = growLevitant(genome);
    LEVITANT_GRAPH_CACHE.set(genome, graph);
  }
  return graph;
}

/** Amorphous growth cache — same §4.4.8 pattern, separate map. */
const AMORPHOUS_GRAPH_CACHE = new WeakMap<Genome, PartGraph>();

function cachedAmorphousGraph(genome: Genome): PartGraph {
  let graph = AMORPHOUS_GRAPH_CACHE.get(genome);
  if (graph === undefined) {
    graph = growAmorphous(genome);
    AMORPHOUS_GRAPH_CACHE.set(genome, graph);
  }
  return graph;
}

/**
 * Grow (cached) the part graph a genome's `meta.plan` selects — the
 * design 07 §2.3.1 plan seam. Plan 0 → quadruped, 1 → levitant,
 * 2 → amorphous (§2.4.1).
 */
export function growCreature(genome: Genome): PartGraph {
  const plan = getScalar(genome, "meta.plan");
  return plan === 2
    ? cachedAmorphousGraph(genome)
    : plan === 1
      ? cachedLevitantGraph(genome)
      : cachedQuadrupedGraph(genome);
}

/**
 * Pose a genome under its own `meta.plan` — the design 07 §2.3.1 plan
 * dispatch: plan 0 → {@link poseQuadruped}, 1 → {@link poseLevitant},
 * 2 → {@link poseAmorphous}.
 */
export function poseCreature(
  genome: Genome,
  clip: ClipName,
  phaseTurnsRaw: number,
): readonly Slab[] {
  const plan = getScalar(genome, "meta.plan");
  return plan === 2
    ? poseAmorphous(genome, clip, phaseTurnsRaw)
    : plan === 1
      ? poseLevitant(genome, clip, phaseTurnsRaw)
      : poseQuadruped(genome, clip, phaseTurnsRaw);
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

/**
 * The §4.4.4 emitter orientation transform (design 07 §6.1, U5 — the
 * inert emitter rule ACTIVATES): during ATTACK, nodes of kind `emitter`
 * stretch along model +y (the facing axis) by
 * `ORIENT_STRETCH[frame]` — a rear-face-invariant multiplicative
 * stretch: `hy′ = fp_mul(S, hy); cy += hy′ − hy; hy = hy′`, applied
 * AFTER the chain-class envelope delta. The rear face `cy − hy` is
 * invariant by algebraic identity (the emitter stays socketed while
 * only the muzzle advances 2·(hy′ − hy)); the four projections turn the
 * model-+y advance into per-direction pointing for free — no envelope
 * constant is direction-aware (§4.4.2's law stays literally intact).
 * f0/f3 are exact identity (`fp_mul(65536, x) = x`); f2's delta =
 * rheDiv(f1 delta, 3) — the §4.4.2 house recovery shape under RHE.
 * Inert for every genome without an emitter node (every shipped
 * genome), and for walk/idle/hurt/death.
 */
export const ORIENT_STRETCH: readonly number[] = Object.freeze([65536, 98304, 76459, 65536]);

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
      if (clip === "attack" && node.kind === "emitter") {
        // §4.4.4 activation (design 07 §6.1): rear-face-invariant
        // stretch along facing, AFTER the chain-class envelope delta.
        const hyS = fp_mul(ORIENT_STRETCH[frame]!, hy);
        cy = fp_add(cy, fp_sub(hyS, hy));
        hy = hyS;
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

// ---------------------------------------------------------------------------
// The levitant gait template + envelopes (design 07 §2.3.1, U3)
// ---------------------------------------------------------------------------

/** Wing flap amplitude (walk) — template constant, 1.6 px (watcher). */
const FLAP_AMP = 104858;
/** Tendril z counter-bob amplitude — template constant, 0.5 px. */
const TENDRIL_ZBOB = 32768;
/** Per-ordinal tendril x-swing factors — 0.5, 0.9, 1.3 (watcher 0.5 + 0.4·i). */
const TENDRIL_XF: readonly number[] = Object.freeze([32768, 58982, 85197]);
/**
 * Death limp factors on the tendril oscillator deltas (design 07 §2.3:
 * tendrils go limp — lag preserved, amplitude → 0): 0.5, 0.25, 0; f3 = f2.
 */
const TENDRIL_LIMP: readonly number[] = Object.freeze([32768, 16384, 0]);

/** Per-chain-class translation deltas of one levitant envelope frame. */
interface LevitantEnvelopeFrame {
  /** True iff this frame's deltas scale by anim.levitant.anticipation. */
  readonly scaled: boolean;
  /** [dy, dz] for the body chain (orb + sensor stack + horns). */
  readonly body: readonly [number, number];
  /** [dy, dz] for both wing chains. */
  readonly wing: readonly [number, number];
  /** [dy, dz] for every tendril chain. */
  readonly tendril: readonly [number, number];
}

const LENV = (
  scaled: boolean,
  body: readonly [number, number],
  wing: readonly [number, number],
  tendril: readonly [number, number],
): LevitantEnvelopeFrame => Object.freeze({ scaled, body, wing, tendril });

/**
 * Levitant ATTACK envelope (design 07 §2.3.1, K = 4, design 03 §2's
 * 1+1+2): the levitant's axis is vertical — the wind-up rears BACK + UP
 * where the quadruped crouches; the strike is a forward swoop (dips).
 * Tendrils carry the quadruped tail's pinned trailing-inertia sign
 * (f0 dy = +0.5 while the body pulls −y); f2 = f1/3 easing. f0 scales by
 * `fp_mul(anticipation, delta)` (id 41), f1–f3 never.
 */
const LEVITANT_ATTACK: readonly LevitantEnvelopeFrame[] = Object.freeze([
  LENV(true, [-98304, 45875], [-98304, 65536], [32768, 0]), // f0 wind-up: −1.5/+0.7, −1.5/+1.0, +0.5/0
  LENV(false, [147456, -49152], [147456, -58982], [98304, 0]), // f1 strike: +2.25/−0.75, +2.25/−0.9, +1.5/0
  LENV(false, [49152, -16384], [49152, -19661], [32768, 0]), // f2 recovery: +0.75/−0.25, +0.75/−0.3, +0.5/0
  LENV(false, [0, 0], [0, 0], [0, 0]), // f3 recovered
]);

/**
 * Levitant HURT envelope (K = 2): f0 = −2.25 px recoil on EVERY chain —
 * the U2-tuned value that clears one pixel through TILT in all four
 * views; f1 = zeros. `flash: true` stays metadata-only.
 */
const LEVITANT_HURT: readonly LevitantEnvelopeFrame[] = Object.freeze([
  LENV(false, [-147456, 0], [-147456, 0], [-147456, 0]), // f0 recoil
  LENV(false, [0, 0], [0, 0], [0, 0]), // f1 return
]);

/**
 * Pose the levitant: genome → the 11 model-space slabs of the design 07
 * §2.3.1 node table, in the graph's pinned slab order, for one clip
 * sample at `phaseTurnsRaw` fp turns. Rest geometry comes from
 * {@link growLevitant} (cached); this function adds the per-frame deltas.
 *
 * Oscillators (§2.3.1; sin = the 06 §5.3 LUT; h = hover_freq,
 * r = flap_ratio, λ = tendril_lag in fp turns; h·φ, r·h·φ, (i+1)·λ are
 * plain integer products):
 *
 * ```
 * walk:  b     = fp_mul(hover_amp, sin(h·φ))
 *        flap  = fp_mul(FLAP_AMP, sin(r·h·φ))
 *        sig_i = sin(h·φ − (i+1)·λ)
 *        tx_i  = fp_mul(fp_mul(tendril_amp, XF[i]), sig_i)
 *        dzt_i = −fp_mul(TENDRIL_ZBOB, sig_i)
 * idle:  b     = fp_mul(asr(hover_amp, 1), sin(φ))   — freq ignored
 *        flap  = 0                                    — locomotors freeze
 *        sig_i = sin(φ − (i+1)·λ)
 *        tx_i  = fp_mul(fp_mul(asr(tendril_amp, 1), XF[i]), sig_i)
 *        dzt_i = −fp_mul(asr(TENDRIL_ZBOB, 1), sig_i)
 * ```
 *
 * Delta application (exact int32 adds onto rest raws): body chain
 * `cz += b`; wing chains `cz += b + flap`; tendril chains `cx += tx_i`,
 * `cz += b + dzt_i`. The idle rule (design 07 §2.3.1, the M1 precedent +
 * design 03 §2's idle row): kinds limb AND locomotor freeze in idle
 * (flap = 0 — the wings still RIDE the half-amp hover bob), every other
 * oscillator at half amplitude with the frequency locus ignored. One-shot
 * clips ride the idle base at their uniform phase φ_k (design 07 §4.4.2),
 * so attack/hurt/death wings never flap.
 *
 * Envelopes (design 07 §2.3.1, semantics = §4.4.2 verbatim): attack per
 * {@link LEVITANT_ATTACK} (f0 × anticipation, id 41); hurt per
 * {@link LEVITANT_HURT}; death = altitude loss — every chain, every
 * frame, `cy += DEATH_DY`; every chain sinks
 * `dz = −fp_mul(DEATH_SINK[k], max(0, restCz − restHz))` from its
 * ANCHOR's rest slab (no limbs ⇒ no fold path; wings never flap by the
 * idle rule); tendrils go limp — their idle oscillator deltas tx_i and
 * dzt_i each scale by TENDRIL_LIMP[k] (one extra fp_mul each), the phase
 * argument untouched (lag preserved), the hover ride untouched. Death's
 * k = 3 evaluates as k = 2 WHOLESALE (base phase + envelope + limp), so
 * the held pair is identical by construction.
 */
export function poseLevitant(
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
    if (clip === "death" && frame === 3) frame = 2; // held final frame — f3 IS f2 wholesale
    phi = frame * step;
  }
  const walking = clip === "walk";

  const graph = cachedLevitantGraph(genome);

  const h = getScalar(genome, "anim.levitant.hover_freq"); // int {1, 2}
  const hoverAmp = getScalar(genome, "anim.levitant.hover_amp");
  const r = getScalar(genome, "anim.levitant.flap_ratio"); // int [1, 3]
  const lag = getScalar(genome, "anim.levitant.tendril_lag"); // fp turns
  const tendrilAmp = getScalar(genome, "anim.levitant.tendril_amp");

  // Oscillators. h·φ and r·h·φ are plain integer products (int32-safe:
  // |r·h·φ| ≤ 6·65536); sin_fp wraps mod 1 turn. One-shot clips ride the
  // IDLE base (walking = false throughout).
  const theta = walking ? h * phi : phi; // idle/one-shot: frequency locus ignored
  const b = walking
    ? fp_mul(hoverAmp, sin_fp(theta))
    : fp_mul(asr(hoverAmp, 1), sin_fp(theta));
  const flap = walking ? fp_mul(FLAP_AMP, sin_fp(r * h * phi)) : 0; // idle rule: locomotors freeze
  const txBase = walking ? tendrilAmp : asr(tendrilAmp, 1);
  const zbobBase = walking ? TENDRIL_ZBOB : asr(TENDRIL_ZBOB, 1);

  // Envelope preparation (design 07 §2.3.1).
  let envFrame: LevitantEnvelopeFrame | undefined;
  let antScale = 65536;
  if (clip === "attack") {
    envFrame = LEVITANT_ATTACK[frame]!;
    antScale = getScalar(genome, "anim.levitant.anticipation");
  } else if (clip === "hurt") {
    envFrame = LEVITANT_HURT[frame]!;
  }
  const isDeath = clip === "death";
  const limp = isDeath ? TENDRIL_LIMP[frame]! : 65536;
  // Death per-chain sink deltas from the chains' anchor REST slabs —
  // EVERY chain (no limbs, no fold); iterates graph.chains, never a
  // fixed list.
  let deathSinkByChain: ReadonlyMap<string, number> | undefined;
  if (isDeath) {
    const sinkK = DEATH_SINK[frame]!;
    const sinks = new Map<string, number>();
    for (const chain of graph.chains) {
      const anchor = graph.parts[chain.slabs[0]!]!;
      const drop = Math.max(0, anchor.slab.center[2] - anchor.slab.half[2]);
      sinks.set(chain.name, -fp_mul(sinkK, drop));
    }
    deathSinkByChain = sinks;
  }

  const slabs = graph.parts.map((node) => {
    const [hx, hz] = [node.slab.half[0], node.slab.half[2]];
    let hy = node.slab.half[1];
    let [cx, cy, cz] = node.slab.center;
    const chain = node.animChain;
    let cls: "body" | "wing" | "tendril" = "body";
    if (chain.startsWith("wing_")) cls = "wing";
    else if (chain.startsWith("tendril_")) cls = "tendril";

    if (cls === "wing") {
      cz = fp_add(cz, fp_add(b, flap));
    } else if (cls === "tendril") {
      const i = node.animChain.charCodeAt(8) - 48; // "tendril_<i>" ordinal
      const sig = sin_fp(theta - (i + 1) * lag); // (i+1)·λ: plain integer product
      let tx = fp_mul(fp_mul(txBase, TENDRIL_XF[i]!), sig);
      let dzt = fp_sub(0, fp_mul(zbobBase, sig));
      if (isDeath) {
        tx = fp_mul(limp, tx); // limp: one extra fp_mul each, lag preserved
        dzt = fp_mul(limp, dzt);
      }
      cx = fp_add(cx, tx);
      cz = fp_add(cz, fp_add(b, dzt));
    } else {
      cz = fp_add(cz, b);
    }

    if (envFrame !== undefined) {
      const [edy, edz] = envFrame[cls];
      cy = fp_add(cy, envFrame.scaled ? fp_mul(antScale, edy) : edy);
      cz = fp_add(cz, envFrame.scaled ? fp_mul(antScale, edz) : edz);
    }
    if (clip === "attack" && node.kind === "emitter") {
      // §4.4.4 activation (design 07 §6.1): rear-face-invariant stretch
      // along facing, AFTER the chain-class envelope delta.
      const hyS = fp_mul(ORIENT_STRETCH[frame]!, hy);
      cy = fp_add(cy, fp_sub(hyS, hy));
      hy = hyS;
    }
    if (isDeath) {
      cy = fp_add(cy, DEATH_DY);
      cz = fp_add(cz, deathSinkByChain!.get(chain)!);
    }
    return Object.freeze({ cx, cy, cz, hx, hy, hz, role: node.materialRole });
  });

  return Object.freeze(slabs);
}

// ---------------------------------------------------------------------------
// The amorphous gait template + envelopes (design 07 §2.4.1, U4)
// ---------------------------------------------------------------------------

/** Walk hop amplitude — template constant, 1.2 px (slime). */
const HOP_AMP = 78643;
// IDLE_BREATH (0.10, the idle breathing squash amplitude) is imported
// from grammar.ts — the wide-pose eye floor consumes it at growth time.
/** Crest x-wobble amplitude — template constant, 1.6 px. */
const CREST_XAMP = 104858;
/** Drip z-lift amplitude — 1.1 px; drip y-trail amplitude — 1.2 px. */
const DRIP_ZAMP = 72090;
const DRIP_YAMP = 78643;
/** Drip rides 0.3 of the hop. */
const HOP_DRIP = 19661;
/**
 * Drip extra lag beyond ball_phase_delta, in fp turns — the ADJUDICATED
 * difference pin: the spike authors the drip lag as ABSOLUTE 1.9 rad, so
 * DRIP_EXTRA = RHE(1.9 rad in turns) − RHE(1.3 rad in turns) = 19818 −
 * 13559 = 6259 (the all-defaults drip lag is exactly the spike's own raw
 * 19818; the rejected alternative RHE(0.6 rad) = 6258 lands −1 ulp off).
 */
const DRIP_EXTRA = 6259;
/**
 * DEATH deflate weight scales (design 07 §2.4.1, the §2.4 deflate pin):
 * ball i's fieldWeight at death frame k = fp_mul(DEFLATE[k], W_i). f0/f1
 * reuse the DEATH_FOLD raws (weight is the blob's limb); f2 calibrated
 * UP from fold's 0.35 by the corner sweep (0.35 leaves the deflated
 * field too thin to occlude the sunken face — worst −1620 raw; 0.45
 * clears every corner at +634 and still reads as deflation: the drip's
 * f2 weight 0.248 < TH evaporates it). f3 = f2 wholesale.
 */
const DEFLATE: readonly number[] = Object.freeze([58982, 42598, 29491]); // 0.9, 0.65, 0.45
/**
 * Blob-chain death drop capacity — a pinned template constant REPLACING
 * the derived `max(0, restCz − restHz)`, which is 0 for a grounded blob
 * (rest cz 4.4 < rest visible hz 4.556): the deflation, not rest
 * clearance, creates the drop room. 3.0 px, grounding machine-verified
 * per frame (blob bottom −0.47/−0.85/−1.06 px at f0/f1/f2 — the
 * deflating surface never leaves the ground).
 */
const DEFLATE_DROP_CAP = 196608; // 3.0
/** Amorphous attack/hurt envelopes: every chain takes the SAME [dy, dz]
 * (a single-mass lunge — the blob has no head/limb/tail analog; equal
 * deltas = rigid by construction). f0 scales by anticipation (id 50). */
const AMORPHOUS_ATTACK: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([-98304, -45875] as const), // f0 wind-up (× ant): −1.5, −0.7 — the quadruped body-row squat
  Object.freeze([147456, 0] as const), // f1 strike: +2.25
  Object.freeze([49152, 0] as const), // f2 recovery: +0.75 = f1/3 exact
  Object.freeze([0, 0] as const), // f3 recovered
]);
const AMORPHOUS_HURT: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([-147456, 0] as const), // f0: −2.25 px whole-body recoil (U2-tuned raw verbatim)
  Object.freeze([0, 0] as const), // f1 return
]);

/**
 * Pose the amorphous: genome → the 7 model-space slabs of the design 07
 * §2.4.1 node table (blob, crest, skirt, drip, eye_l, eye_r, highlight),
 * in the graph's pinned slab order, for one clip sample at
 * `phaseTurnsRaw` fp turns. Rest geometry comes from
 * {@link growAmorphous} (cached); this function adds the per-frame
 * deltas AND — new mechanism, the multiplicative-oscillator extension of
 * the U1 decomposition law — per-frame EXTENT factors: squash scales
 * ball extents via fp_mul, with every factor exactly FP_ONE at rest
 * (`fp_mul(65536, x) = x` identically, and
 * `stretch = fp_div(65536, 65536) = 65536` exactly).
 *
 * Oscillators (§2.4.1; sin = the 06 §5.3 LUT; p = pulse_freq id 47,
 * a = squash_amp id 48, λ = ball_phase_delta id 49; p·φ a plain integer
 * product; lags subtract as plain ints, the LUT wraps):
 *
 * ```
 * walk:  θ      = p·φ
 *        squash = fp_sub(FP_ONE, fp_mul(a, sin(θ)))     (wide when landed)
 *        hop    = max(0, fp_mul(HOP_AMP, sin(θ)))
 * idle:  θ      = φ                                      (freq ignored — M1 rule)
 *        squash = fp_add(FP_ONE, fp_mul(IDLE_BREATH, sin(φ)))
 *        hop    = 0
 * both:  stretch  = fp_div(FP_ONE, squash)               (RHE(65536²/squash) — THE pinned division form)
 *        sigC     = sin(θ − λ);  sigD = sin(θ − (λ + DRIP_EXTRA))
 *        dripLift = max(0, fp_mul(DRIP_ZAMP, sigD))
 *        dz0      = fp_add(fp_mul(Z0_rest, fp_sub(stretch, FP_ONE)), hop)
 * ```
 *
 * Per-node deltas/factors (centers = rest + delta; halves = factor ×
 * rest; VISIBLE units throughout — F9): blob (0, 0, dz0) × (squash,
 * squash, stretch); crest (CREST_XAMP·sigC, 0, dz0 + CREST_ZREL·(stretch
 * − 1)); skirt (0, 0, hop) × (squash, squash, 1); drip (0,
 * −DRIP_YAMP·sigD, dripLift + HOP_DRIP·hop); eyes (0, restCy·(squash −
 * 1), dz0); highlight (0, 0, dz0 + hiZRel·(stretch − 1)).
 *
 * **The U4 idle rule (recorded deviation):** idle is the SPIKE'S OWN
 * preset, not the M1 half-amplitude rule — hop = 0 (locomotion zeroed),
 * squash flips to +0.10 breathing (IDLE_BREATH), crest/drip lag
 * oscillators run at FULL amplitude (the spike's formulas are
 * clip-independent). Grounds: the all-defaults-reproduces-slime() law
 * outranks the half-amplitude convention; S1b's accepted renders ARE the
 * idle evidence; the levitant idle-flap-freeze established plan-specific
 * idle rules by justification. Mini-sheet watch item.
 *
 * Ball slabs (nodes 0–3) carry `fieldWeight` = {@link AMORPHOUS_WEIGHTS}
 * on every non-death frame.
 *
 * Envelopes (§4.4.2 semantics; part classes ball vs face INSIDE the
 * one blob chain — the D-e amendment merged the face onto the blob
 * chain, and death's per-part deltas extend §2.4's already-per-part
 * deflate exception): attack/hurt per the tables above — every part
 * identical (no squash/stretch in envelopes). death (K = 4) = DEFLATE:
 * stagger `cy += DEATH_DY` every part every frame; ball weights scale
 * by {@link DEFLATE}[k]; balls sink
 * `cz −= fp_mul(DEATH_SINK[k], DEFLATE_DROP_CAP)`; face parts sink on
 * their OWN derived rest capacity `max(0, restCz − restHz)` (quadruped
 * formula verbatim — eyes ~4.1 px, highlight ~6.4 px at defaults) AND
 * retract `cy −= fp_mul(DEATH_SINK[k], max(0, restCy))` (the occlusion
 * mechanism: the face slides back into the collapsing mass —
 * depth-sorted occlusion only, no alpha exists; values identical to
 * the adjudicated per-chain form, whose face chains were singletons).
 * The idle base (breathing) continues through death; f3 = f2
 * WHOLESALE, so every held pair scores exactly 0.0.
 */
export function poseAmorphous(
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
    if (clip === "death" && frame === 3) frame = 2; // held final frame — f3 IS f2 wholesale
    phi = frame * step;
  }
  const walking = clip === "walk";

  const graph = cachedAmorphousGraph(genome);
  const a = deriveAmorphousAnchors(genome);

  const p = getScalar(genome, "anim.amorphous.pulse_freq"); // int {1, 2}
  const amp = getScalar(genome, "anim.amorphous.squash_amp"); // fp ratio
  const lam = getScalar(genome, "anim.amorphous.ball_phase_delta"); // fp turns

  // Oscillators. p·φ is a plain integer product (int32-safe: |p·φ| ≤
  // 2·65536); sin_fp wraps mod 1 turn. One-shot clips ride the IDLE
  // base (walking = false throughout).
  const theta = walking ? p * phi : phi; // idle/one-shot: frequency locus ignored
  const squash = walking
    ? fp_sub(FP_ONE, fp_mul(amp, sin_fp(theta)))
    : fp_add(FP_ONE, fp_mul(IDLE_BREATH, sin_fp(theta)));
  const hop = walking ? Math.max(0, fp_mul(HOP_AMP, sin_fp(theta))) : 0;
  const stretch = fp_div(FP_ONE, squash); // RHE(65536·65536/squash) — the pinned form
  const sigC = sin_fp(theta - lam);
  const sigD = sin_fp(theta - (lam + DRIP_EXTRA)); // plain int add — the drip's absolute spike lag
  const dripLift = Math.max(0, fp_mul(DRIP_ZAMP, sigD));
  const stretchM1 = fp_sub(stretch, FP_ONE);
  const squashM1 = fp_sub(squash, FP_ONE);
  const dz0 = fp_add(fp_mul(a.z0, stretchM1), hop);

  // Envelope preparation (design 07 §2.4.1 / §4.4.2).
  let envDelta: readonly [number, number] | undefined;
  let envScaled = false;
  let antScale = 65536;
  if (clip === "attack") {
    envDelta = AMORPHOUS_ATTACK[frame]!;
    envScaled = frame === 0;
    antScale = getScalar(genome, "anim.amorphous.anticipation");
  } else if (clip === "hurt") {
    envDelta = AMORPHOUS_HURT[frame]!;
  }
  const isDeath = clip === "death";
  const deathSinkK = isDeath ? DEATH_SINK[frame]! : 0;
  const deflateK = isDeath ? DEFLATE[frame]! : FP_ONE;

  const slabs = graph.parts.map((node) => {
    let [hx, hy, hz] = node.slab.half;
    let [cx, cy, cz] = node.slab.center;
    let fieldWeight: number | undefined;

    switch (node.name) {
      case "blob":
        cz = fp_add(cz, dz0);
        hx = fp_mul(squash, hx);
        hy = fp_mul(squash, hy);
        hz = fp_mul(stretch, hz);
        break;
      case "crest":
        cx = fp_add(cx, fp_mul(CREST_XAMP, sigC));
        cz = fp_add(cz, fp_add(dz0, fp_mul(CREST_ZREL, stretchM1)));
        break;
      case "skirt":
        cz = fp_add(cz, hop);
        hx = fp_mul(squash, hx);
        hy = fp_mul(squash, hy);
        break;
      case "drip":
        cy = fp_sub(cy, fp_mul(DRIP_YAMP, sigD));
        cz = fp_add(cz, fp_add(dripLift, fp_mul(HOP_DRIP, hop)));
        break;
      case "highlight":
        cz = fp_add(cz, fp_add(dz0, fp_mul(a.hiZRel, stretchM1)));
        break;
      case "rim_plate":
      case "rim_wisp":
      case "rim_sprout":
        // U5 rim (design 07 §6.1): rides the stretch like crest/
        // highlight — rimZRel is its rest z rel to the blob center.
        cz = fp_add(cz, fp_add(dz0, fp_mul(fp_sub(node.slab.center[2], a.z0), stretchM1)));
        break;
      case "orifice":
        // U5 orifice (design 07 §6.1): the eye branch verbatim — the
        // front tracks squash.
        cy = fp_add(cy, fp_mul(node.slab.center[1], squashM1));
        cz = fp_add(cz, dz0);
        break;
      default: // eye_l / eye_r — fy = restCy·squash, the spike's 4.6·squash line
        cy = fp_add(cy, fp_mul(node.slab.center[1], squashM1));
        cz = fp_add(cz, dz0);
    }
    // The four BALL parts (core + segments) carry the field weight
    // (deflated in death); the face parts (sensor/ornament kinds) are
    // classic slabs. Keyed by KIND — every part rides the one blob
    // chain since the D-e amendment, so chain membership no longer
    // separates balls from face.
    const isBall = node.kind === "core" || node.kind === "segment";
    if (isBall) {
      fieldWeight = isDeath
        ? fp_mul(deflateK, AMORPHOUS_WEIGHTS[node.id]!)
        : AMORPHOUS_WEIGHTS[node.id]!;
    }

    if (envDelta !== undefined) {
      const [edy, edz] = envDelta;
      cy = fp_add(cy, envScaled ? fp_mul(antScale, edy) : edy);
      cz = fp_add(cz, envScaled ? fp_mul(antScale, edz) : edz);
    }
    if (clip === "attack" && node.kind === "emitter") {
      // §4.4.4 activation (design 07 §6.1): rear-face-invariant stretch
      // along facing, AFTER the envelope delta.
      const hyS = fp_mul(ORIENT_STRETCH[frame]!, hy);
      cy = fp_add(cy, fp_sub(hyS, hy));
      hy = hyS;
    }
    if (isDeath) {
      // Death deltas per PART CLASS inside the one blob chain — the
      // §2.4 deflate exception already operates per part (per-ball
      // weights); the face retract/sink extends it (design 07 §2.4.1,
      // the D-e/D-h amendment). Values are identical to the pre-merge
      // per-chain form (face chains were singletons: anchor = self).
      cy = fp_add(cy, DEATH_DY);
      if (isBall) {
        // Balls: the pinned DEFLATE_DROP_CAP replaces the derived
        // capacity, which is 0 for a grounded blob.
        cz = fp_sub(cz, fp_mul(deathSinkK, DEFLATE_DROP_CAP));
      } else {
        // Face: sink on own rest capacity max(0, restCz − restHz)
        // (quadruped formula verbatim) AND retract toward the core on
        // max(0, restCy) — the occlusion mechanism.
        const cap = Math.max(0, node.slab.center[2] - node.slab.half[2]);
        cz = fp_sub(cz, fp_mul(deathSinkK, cap));
        cy = fp_sub(cy, fp_mul(deathSinkK, Math.max(0, node.slab.center[1])));
      }
    }
    return Object.freeze(
      fieldWeight === undefined
        ? { cx, cy, cz, hx, hy, hz, role: node.materialRole }
        : { cx, cy, cz, hx, hy, hz, role: node.materialRole, fieldWeight },
    );
  });

  return Object.freeze(slabs);
}
