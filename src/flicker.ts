/**
 * Fablesprite — the M1 flicker metric (design 06 §1.6, normative; the
 * S3 as-built metric of design 03 §4, transcribed to exact fixed point;
 * constraint row 5, finding F12).
 *
 * Per clip × direction cell, over the K final RGBA frames (the §1.3
 * artifact-1 buffers, post-palette) and the K continuous PRE-SNAP slab
 * lists that produced them, every consecutive wrapping frame pair
 * (f, (f+1) mod K) scores `changed_pixels / motion_energy`:
 *
 * - `changed` = the count of pixel positions whose 4 RGBA bytes differ
 *   in any byte (transparent is exactly (0,0,0,0) — §1.3 — so the byte
 *   comparison is total);
 * - `energy` = the sum over the 13 §1.2 slabs of the Euclidean
 *   screen-space displacement of the slab's CONTINUOUS pre-snap projected
 *   center between the two frames, in 16.16 raws — the §1.5 snap-position
 *   mapping (after yawSlab: sx = cx, sy = −cz − TILT·cy), per-slab
 *   displacement RHE(√(dx² + dy²)) on the EXACT integer square sum
 *   (which exceeds int32 — machine-verified max 2^38 over the locus
 *   domains — so it is carried in BigInt, never through fp_mul).
 *
 * The gate comparison is exact integer arithmetic, no division: a pair
 * passes iff changed·2^16·GATE_DEN < GATE_NUM·energy. Zero-motion
 * convention (S3/F12): energy = 0 ∧ changed = 0 → pass (score 0);
 * energy = 0 ∧ changed > 0 → INF → the pair (and cell) auto-fails.
 *
 * This module is diagnostic — it renders through the pinned §6.1
 * pipeline but adds nothing to it; no goldens hash its output. The CI
 * gates apply to every walk, attack, hurt, and death clip × direction
 * cell (idle cells are measurable but not gated — M1 policy). One-shot
 * clips measure consecutive pairs only; gates are per-(plan, clip)
 * tables per {@link FLICKER_GATES} (design 07 §4.2 as amended at U3).
 */

import { craftClip, snapOffsets } from "./craft.js";
import type { CraftGrid } from "./craft.js";
import { fp_mul, fp_sub } from "./fixed.js";
import type { Genome } from "./genome.js";
import { PLAN_NAMES, getScalar } from "./genome.js";
import { applyPalette, derivePalette } from "./palette.js";
import { AMORPHOUS_PART_NAMES, LEVITANT_PART_NAMES, PART_NAMES } from "./grammar.js";
import type { ClipName, Slab } from "./pose.js";
import { CLIP_KS, ONE_SHOT_CLIPS, clipPhases, growCreature, poseCreature } from "./pose.js";
import type { Direction } from "./raster.js";
import { DIRECTIONS, DIRECTION_TURNS, TILT_RAW, rasterize, yawSlab } from "./raster.js";

// ---------------------------------------------------------------------------
// The pinned gate (design 06 §1.6)
// ---------------------------------------------------------------------------

/**
 * Flicker gate numerator: the gate value is GATE_NUM / GATE_DEN = 32.0,
 * RECALIBRATED on the production renderer per the F12 caveat
 * (design 06 §1.6): over seeds 0..199 × 4 directions = 800 walk cells
 * (3200 pairs), the production distribution is mean 5.93 / p99 18.70 /
 * max 25.1166, no INF — the S3 gate 12.0 does not hold (131 pairs
 * exceed it: sampled genomes reach low-motion corners the S3 substrate
 * never had, e.g. gait_freq = 2, whose legs and bob freeze at K = 4
 * quarter-phase sampling). 32.0 is the tightest round value with
 * ≥ 1.25× margin over the measured max (25.1166 × 1.25 = 31.40; actual
 * margin 1.274×). A pair passes iff
 * `changed · 2^16 · GATE_DEN < GATE_NUM · energy` — exact integers, no
 * division, strict `<` (a score exactly at the gate fails).
 */
export const FLICKER_GATE_NUM = 32n;

/** Flicker gate denominator (the gate is the rational NUM/DEN). */
export const FLICKER_GATE_DEN = 1n;

/** One clip's flicker gate as the exact rational num/den. */
export interface FlickerGate {
  readonly num: bigint;
  readonly den: bigint;
}

/**
 * Per-(plan, clip) flicker gates (design 07 §4.2 as amended at U3,
 * 2026-07-15). Gate POLICY only — the 06 §1.6 metric arithmetic is
 * normative and untouched. Each plan's row is calibrated by the M1
 * recalibration method against that plan's OWN production histogram
 * (per clip over seeds 0..199 × 4 directions = 800 cells; looping
 * clips wrap, one-shot clips measure consecutive pairs only; gate =
 * the tightest integer with ≥ 1.25× margin over the plan's observed
 * max). A plan's gate never prices in the other plan's histogram, so
 * a regression past a plan's own calibrated ceiling fails even where
 * the other plan's cells are legitimately louder.
 *
 * quadruped — the U2 pins RESTATED, not recalibrated (design 07 §4.4.6,
 * 2026-07-11; its histograms have not moved): observed maxima walk
 * 25.1166 (M1) / attack 14.6730 / hurt 10.8359 / death 19.2914 → gates
 * 32, 19, 14, 25.
 *
 * levitant — calibrated at U3 on seeds 0..199 (§4.4.6 addendum), then
 * RECALIBRATED at U3 close-out on the full 0..1999 sweep (8000 cells
 * per clip, no INF anywhere, death held pairs exactly 0.0): observed
 * maxima walk 37.3744 (seed 780 left) / attack 114.9282 (seed 1101
 * down) / hurt 17.2825 / death 16.1387 → gates 47 (1.257×),
 * 144 (1.253×), 22 (1.273×), 19 (1.177× vs the 2000-seed max; the
 * 0..199 pin stands, margin recorded honestly). The six cells over the
 * 200-seed gates were rendered and eyeballed at close-out: all are the
 * near-frozen low-energy family or whole-body 1-px settles — metric
 * artifacts of the one-chain body mass (orb + eye stack + horns
 * dominating the 11-slab silhouette), not visible churn; renders in
 * the §2.3.1 close-out record.
 *
 * amorphous — calibrated at U4 in ONE step on the FULL seeds 0..1999
 * amorphous-forced sweep (the §4.4.6 close-out lesson: never
 * 200-then-2000), 8000 cells (2000 seeds × 4 directions) per clip on
 * the FINAL
 * production path (post visibility-repair + chain merge), no INF
 * anywhere, death held pairs exactly 0.0: observed maxima walk
 * 113.8060 (seed 1933 up) / attack 49.7549 (seed 431 up) / hurt
 * 22.0728 (seed 864 down) / death 22.6905 (seed 900 down) → gates
 * 143 (1.257×), 63 (1.266×), 28 (1.269×), 29 (1.278×). The loud walk
 * tail (a handful of cells 58–113.8) is the squash mechanism's metric
 * artifact priced in by design: squash oscillates EXTENTS, so
 * changed-pixel counts have no matching center-motion energy in the
 * one-chain mass — the U3 one-chain artifact, amplified (histograms in
 * design 07 §2.4.1).
 *
 * Idle rows carry the plan's walk rational for callers that measure
 * idle cells, but idle is NOT CI-gated (unchanged M1 policy).
 */
export const FLICKER_GATES: Readonly<
  Record<(typeof PLAN_NAMES)[number], Readonly<Record<ClipName, FlickerGate>>>
> = Object.freeze({
  quadruped: Object.freeze({
    walk: Object.freeze({ num: 32n, den: 1n }),
    idle: Object.freeze({ num: 32n, den: 1n }),
    attack: Object.freeze({ num: 19n, den: 1n }),
    hurt: Object.freeze({ num: 14n, den: 1n }),
    death: Object.freeze({ num: 25n, den: 1n }),
  }),
  levitant: Object.freeze({
    walk: Object.freeze({ num: 47n, den: 1n }),
    idle: Object.freeze({ num: 47n, den: 1n }),
    attack: Object.freeze({ num: 144n, den: 1n }),
    hurt: Object.freeze({ num: 22n, den: 1n }),
    death: Object.freeze({ num: 19n, den: 1n }),
  }),
  amorphous: Object.freeze({
    walk: Object.freeze({ num: 143n, den: 1n }),
    idle: Object.freeze({ num: 143n, den: 1n }),
    attack: Object.freeze({ num: 63n, den: 1n }),
    hurt: Object.freeze({ num: 28n, den: 1n }),
    death: Object.freeze({ num: 29n, den: 1n }),
  }),
});

// ---------------------------------------------------------------------------
// Metric pieces (each independently testable)
// ---------------------------------------------------------------------------

/** A continuous (pre-snap) projected screen center, 16.16 raws. */
export interface ScreenCenter {
  readonly x: number;
  readonly y: number;
}

/**
 * The §1.5 screen mapping of one slab's continuous center for a facing
 * direction: after yawSlab, `sx = cx`, `sy = −cz − TILT·cy` — model-scale
 * screen raws without the §1.2 frame anchor (a constant; displacements
 * never see it). This is byte-for-byte the position snapOffsets uses for
 * chain anchors, applied here to EVERY slab.
 */
export function screenCenters(slabs: readonly Slab[], direction: Direction): ScreenCenter[] {
  const turns = DIRECTION_TURNS[direction];
  if (turns === undefined) {
    throw new RangeError(`flicker: unknown direction ${JSON.stringify(direction)}`);
  }
  return slabs.map((slab) => {
    const yawed = yawSlab(slab, turns);
    return Object.freeze({
      x: yawed.cx,
      y: fp_sub(fp_sub(0, yawed.cz), fp_mul(TILT_RAW, yawed.cy)),
    });
  });
}

/** Integer square root of a non-negative BigInt (floor). */
function isqrtBig(n: bigint): bigint {
  if (n < 0n) throw new RangeError("flicker: isqrt of negative");
  if (n < 2n) return n;
  // Seed from the double sqrt (correctly rounded), then settle exactly.
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  if (x < 1n) x = 1n;
  while (x * x > n) x -= 1n;
  while ((x + 1n) * (x + 1n) <= n) x += 1n;
  return x;
}

/**
 * RHE(√n) for a non-negative exact integer n — the §5.2 fp_sqrt rounding
 * applied to an exact square sum: a tie is impossible ((q+½)² is never an
 * integer), so nearest is decided by the remainder test
 * `q = isqrt(n); if n − q² > q: q += 1` (design 06 §1.6).
 */
export function sqrtRhe(n: bigint): bigint {
  const q = isqrtBig(n);
  return n - q * q > q ? q + 1n : q;
}

/**
 * Motion energy of one frame pair (design 06 §1.6): the sum over slabs of
 * RHE(√(dx² + dy²)) — dx, dy the raw screen-center differences, the
 * square sum computed EXACTLY (BigInt: it exceeds int32 at the domain
 * extremes — machine-verified max 2^38 ≈ (8 px)² — so fp_mul is not a
 * legal carrier). Result in 16.16 raws, exact.
 */
export function pairEnergy(a: readonly ScreenCenter[], b: readonly ScreenCenter[]): bigint {
  if (a.length !== b.length) {
    throw new RangeError(`flicker: center list lengths differ (${a.length} vs ${b.length})`);
  }
  let energy = 0n;
  for (let i = 0; i < a.length; i++) {
    const dx = BigInt(b[i]!.x - a[i]!.x);
    const dy = BigInt(b[i]!.y - a[i]!.y);
    energy += sqrtRhe(dx * dx + dy * dy);
  }
  return energy;
}

/**
 * Changed-pixel count between two same-shape RGBA buffers (design 06
 * §1.6): the number of pixel positions whose 4 bytes differ in any byte.
 */
export function changedPixels(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length % 4 !== 0) {
    throw new RangeError(
      `flicker: RGBA buffers must share a length divisible by 4, got ${a.length} and ${b.length}`,
    );
  }
  let changed = 0;
  for (let p = 0; p < a.length; p += 4) {
    if (
      a[p] !== b[p] ||
      a[p + 1] !== b[p + 1] ||
      a[p + 2] !== b[p + 2] ||
      a[p + 3] !== b[p + 3]
    ) {
      changed++;
    }
  }
  return changed;
}

/** One wrapping frame pair's flicker verdict (design 06 §1.6). */
export interface PairFlicker {
  /** Changed pixel positions between the two frames. */
  readonly changed: number;
  /** Exact motion energy in 16.16 raws. */
  readonly energy: bigint;
  /** True iff energy = 0 with changed > 0 — churn at zero motion (INF). */
  readonly infinite: boolean;
  /** The pinned gate verdict for this pair. */
  readonly pass: boolean;
}

/** One clip × direction cell's flicker verdict. */
export interface CellFlicker {
  /**
   * Frame pairs in order. Looping clips: K wrapping pairs (0,1), (1,2),
   * …, (K−1,0). One-shot clips (design 07 §4.2): K−1 consecutive pairs
   * only — no wrap (a death's final pose legitimately differs from its
   * first frame; wrapping would gate a transition that never plays).
   */
  readonly pairs: readonly PairFlicker[];
  /** True iff every pair passes. */
  readonly pass: boolean;
}

/**
 * The pinned gate comparison for one pair (design 06 §1.6, exact — no
 * division): zero-motion convention first, then
 * `changed · 2^16 · gateDen < gateNum · energy`, strict `<`. The default
 * gate is the M1 walk gate 32.0; cell callers pass the plan × clip
 * {@link FLICKER_GATES} rational (design 07 §4.2 as amended at U3).
 */
export function pairPasses(
  changed: number,
  energy: bigint,
  gateNum: bigint = FLICKER_GATE_NUM,
  gateDen: bigint = FLICKER_GATE_DEN,
): boolean {
  if (energy < 0n) throw new RangeError("flicker: negative energy");
  if (energy === 0n) return changed === 0;
  return BigInt(changed) * 65536n * gateDen < gateNum * energy;
}

/**
 * Informative (NON-normative) real-valued score of a pair —
 * changed/energy with energy in pixels — for reports and histograms
 * only; the gate never divides.
 */
export function pairScore(changed: number, energy: bigint): number {
  if (energy === 0n) return changed === 0 ? 0 : Infinity;
  return (changed * 65536) / Number(energy);
}

/** Options for {@link evaluateCell} (design 07 §4.2). */
export interface EvaluateCellOptions {
  /**
   * Include the wrapping (K−1, 0) pair. Defaults to true (looping-clip
   * behavior — the M1 metric); one-shot clips pass false.
   */
  readonly wrap?: boolean;
  /** Gate numerator (default: the M1 walk gate 32). */
  readonly gateNum?: bigint;
  /** Gate denominator (default 1). */
  readonly gateDen?: bigint;
}

/**
 * Evaluate one clip × direction cell (design 06 §1.6 as extended by
 * design 07 §4.2): `rgbaFrames` are the K final RGBA buffers (§1.3
 * artifact-1, post-palette), `slabLists` the K continuous model-space
 * slab lists that produced them (the §1.2 13-slab template, PRE-snap —
 * snapping never enters the energy). Looping clips measure K wrapping
 * pairs; one-shot clips (`wrap: false`) measure the K−1 consecutive
 * pairs only. Metric, zero-motion convention, and INF-fail are unchanged.
 */
export function evaluateCell(
  rgbaFrames: readonly Uint8Array[],
  slabLists: readonly (readonly Slab[])[],
  direction: Direction,
  options: EvaluateCellOptions = {},
): CellFlicker {
  const wrap = options.wrap ?? true;
  const gateNum = options.gateNum ?? FLICKER_GATE_NUM;
  const gateDen = options.gateDen ?? FLICKER_GATE_DEN;
  const k = rgbaFrames.length;
  if (k < 1 || slabLists.length !== k) {
    throw new RangeError(
      `flicker: need matching non-empty frame and slab lists, got ${k} and ${slabLists.length}`,
    );
  }
  for (const slabs of slabLists) {
    // A plan's normative slab list: 13 (quadruped, 06 §1.2), 11
    // (levitant, design 07 §2.3.1), or 7 (amorphous, design 07 §2.4.1).
    if (
      slabs.length !== PART_NAMES.length &&
      slabs.length !== LEVITANT_PART_NAMES.length &&
      slabs.length !== AMORPHOUS_PART_NAMES.length
    ) {
      throw new RangeError(
        `flicker: expected a plan slab list (${PART_NAMES.length}, ${LEVITANT_PART_NAMES.length}, or ${AMORPHOUS_PART_NAMES.length} slabs), got ${slabs.length}`,
      );
    }
  }
  const centers = slabLists.map((slabs) => screenCenters(slabs, direction));
  const pairs: PairFlicker[] = [];
  let pass = true;
  const pairCount = wrap ? k : k - 1;
  for (let f = 0; f < pairCount; f++) {
    const g = (f + 1) % k;
    const changed = changedPixels(rgbaFrames[f]!, rgbaFrames[g]!);
    const energy = pairEnergy(centers[f]!, centers[g]!);
    const infinite = energy === 0n && changed > 0;
    const ok = pairPasses(changed, energy, gateNum, gateDen);
    if (!ok) pass = false;
    pairs.push(Object.freeze({ changed, energy, infinite, pass: ok }));
  }
  return Object.freeze({ pairs: Object.freeze(pairs), pass });
}

// ---------------------------------------------------------------------------
// Rendering one cell through the pinned §6.1 pipeline
// ---------------------------------------------------------------------------

/** One rendered clip × direction cell plus its metric inputs. */
export interface RenderedCell {
  /** K final RGBA buffers (§1.3 artifact-1, post-palette). */
  readonly rgbaFrames: readonly Uint8Array[];
  /** K continuous model-space slab lists (pre-snap — the energy input). */
  readonly slabLists: readonly (readonly Slab[])[];
}

/**
 * Render the four direction cells of one clip through exactly the §6.1
 * per-cell pipeline (the plan's pose function per phase — dispatched on
 * `meta.plan`, design 07 §2.3.1 — → snapOffsets with the grown graph's
 * chains → rasterize → craftClip → applyPalette): the same arithmetic
 * exportCreature runs, so the metric measures the shipped bytes
 * (cross-checked against exportCreature in tests/flicker.test.ts). Poses
 * once (slab lists are direction-independent), renders per direction.
 */
export function renderClipCells(
  genome: Genome,
  clip: ClipName,
  size = 32,
  k = CLIP_KS[clip],
): Record<Direction, RenderedCell> {
  const palette = derivePalette(genome);
  const rampLenRaw = getScalar(genome, "palette.ramp_len");
  if (rampLenRaw !== 3 && rampLenRaw !== 4 && rampLenRaw !== 5) {
    throw new RangeError(`flicker: palette.ramp_len must be 3, 4, or 5, got ${rampLenRaw}`);
  }
  const rampLen: 3 | 4 | 5 = rampLenRaw;
  const chains = growCreature(genome).chains;
  const phases = clipPhases(k);
  const slabLists = phases.map((phi) => poseCreature(genome, clip, phi));
  const out = {} as Record<Direction, RenderedCell>;
  for (const direction of DIRECTIONS) {
    const offsets = snapOffsets(slabLists, direction, chains);
    const rawGrids = slabLists.map((slabs, f) =>
      rasterize(slabs, direction, size, rampLen, offsets[f]!),
    );
    const { grids } = craftClip(rawGrids);
    const rgbaFrames = grids.map((grid) => applyPalette(grid as CraftGrid, palette));
    out[direction] = Object.freeze({
      rgbaFrames: Object.freeze(rgbaFrames),
      slabLists: Object.freeze(slabLists),
    });
  }
  return out;
}

/**
 * Measure one clip's flicker for one genome (design 06 §1.6 as extended
 * by design 07 §4.2): the four direction cells, rendered through the
 * pinned pipeline and evaluated against the {@link FLICKER_GATES}
 * rational of the genome's OWN plan row (`meta.plan` — quadruped cells
 * assert quadruped gates, levitant cells levitant gates) and the clip,
 * with the wrap pair included exactly when the clip loops (one-shot
 * clips measure consecutive pairs only). The CI gate asserts `pass` on
 * every walk, attack, hurt, and death cell (idle stays measurable but
 * ungated — M1 policy).
 */
export function measureClipFlicker(
  genome: Genome,
  clip: ClipName,
): Record<Direction, CellFlicker> {
  const planName = PLAN_NAMES[getScalar(genome, "meta.plan")];
  if (planName === undefined) {
    throw new RangeError(
      `flicker: genome meta.plan ${getScalar(genome, "meta.plan")} names no plan gate row`,
    );
  }
  const gate = FLICKER_GATES[planName][clip];
  const wrap = !ONE_SHOT_CLIPS.has(clip);
  const cells = renderClipCells(genome, clip);
  const out = {} as Record<Direction, CellFlicker>;
  for (const direction of DIRECTIONS) {
    const cell = cells[direction];
    out[direction] = evaluateCell(cell.rgbaFrames, cell.slabLists, direction, {
      wrap,
      gateNum: gate.num,
      gateDen: gate.den,
    });
  }
  return out;
}

/**
 * Measure the walk-clip flicker of one genome — the M1 entry point,
 * unchanged: `measureClipFlicker(genome, "walk")`.
 */
export function measureWalkFlicker(genome: Genome): Record<Direction, CellFlicker> {
  return measureClipFlicker(genome, "walk");
}
