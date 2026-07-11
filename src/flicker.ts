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
 * gate applies to every WALK clip × direction cell (idle cells are
 * measurable but not gated — walk is where motion must justify churn).
 */

import { craftClip, snapOffsets } from "./craft.js";
import type { CraftGrid } from "./craft.js";
import { fp_mul, fp_sub } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";
import { applyPalette, derivePalette } from "./palette.js";
import type { ClipName, Slab } from "./pose.js";
import { PART_NAMES, clipPhases, poseQuadruped } from "./pose.js";
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
  /** K wrapping pairs in order: (0,1), (1,2), …, (K−1,0). */
  readonly pairs: readonly PairFlicker[];
  /** True iff every pair passes. */
  readonly pass: boolean;
}

/**
 * The pinned gate comparison for one pair (design 06 §1.6, exact — no
 * division): zero-motion convention first, then
 * `changed · 2^16 · GATE_DEN < GATE_NUM · energy`, strict `<`.
 */
export function pairPasses(changed: number, energy: bigint): boolean {
  if (energy < 0n) throw new RangeError("flicker: negative energy");
  if (energy === 0n) return changed === 0;
  return BigInt(changed) * 65536n * FLICKER_GATE_DEN < FLICKER_GATE_NUM * energy;
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

/**
 * Evaluate one clip × direction cell (design 06 §1.6): `rgbaFrames` are
 * the K final RGBA buffers (§1.3 artifact-1, post-palette), `slabLists`
 * the K continuous model-space slab lists that produced them (the §1.2
 * 13-slab template, PRE-snap — snapping never enters the energy).
 */
export function evaluateCell(
  rgbaFrames: readonly Uint8Array[],
  slabLists: readonly (readonly Slab[])[],
  direction: Direction,
): CellFlicker {
  const k = rgbaFrames.length;
  if (k < 1 || slabLists.length !== k) {
    throw new RangeError(
      `flicker: need matching non-empty frame and slab lists, got ${k} and ${slabLists.length}`,
    );
  }
  for (const slabs of slabLists) {
    if (slabs.length !== PART_NAMES.length) {
      throw new RangeError(
        `flicker: expected the ${PART_NAMES.length}-slab §1.2 list, got ${slabs.length}`,
      );
    }
  }
  const centers = slabLists.map((slabs) => screenCenters(slabs, direction));
  const pairs: PairFlicker[] = [];
  let pass = true;
  for (let f = 0; f < k; f++) {
    const g = (f + 1) % k;
    const changed = changedPixels(rgbaFrames[f]!, rgbaFrames[g]!);
    const energy = pairEnergy(centers[f]!, centers[g]!);
    const infinite = energy === 0n && changed > 0;
    const ok = pairPasses(changed, energy);
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
 * per-cell pipeline (poseQuadruped per phase → snapOffsets → rasterize →
 * craftClip → applyPalette): the same arithmetic exportCreature runs, so
 * the metric measures the shipped bytes (cross-checked against
 * exportCreature in tests/flicker.test.ts). Poses once (slab lists are
 * direction-independent), renders per direction.
 */
export function renderClipCells(
  genome: Genome,
  clip: ClipName,
  size = 32,
  k = 4,
): Record<Direction, RenderedCell> {
  const palette = derivePalette(genome);
  const rampLenRaw = getScalar(genome, "palette.ramp_len");
  if (rampLenRaw !== 3 && rampLenRaw !== 4 && rampLenRaw !== 5) {
    throw new RangeError(`flicker: palette.ramp_len must be 3, 4, or 5, got ${rampLenRaw}`);
  }
  const rampLen: 3 | 4 | 5 = rampLenRaw;
  const phases = clipPhases(k);
  const slabLists = phases.map((phi) => poseQuadruped(genome, clip, phi));
  const out = {} as Record<Direction, RenderedCell>;
  for (const direction of DIRECTIONS) {
    const offsets = snapOffsets(slabLists, direction);
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
 * Measure the walk-clip flicker of one genome: the four §1.6-gated
 * cells, rendered through the pinned pipeline and evaluated against the
 * gate. The CI test asserts `pass` on every cell.
 */
export function measureWalkFlicker(genome: Genome): Record<Direction, CellFlicker> {
  const cells = renderClipCells(genome, "walk");
  const out = {} as Record<Direction, CellFlicker>;
  for (const direction of DIRECTIONS) {
    const cell = cells[direction];
    out[direction] = evaluateCell(cell.rgbaFrames, cell.slabLists, direction);
  }
  return out;
}
