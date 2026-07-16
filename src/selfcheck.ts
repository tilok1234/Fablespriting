/**
 * Fablesprite — the U5 readability self-check (design 07 §5.1, making
 * design 02 §4's defense normative): a PURE function of the genome that
 * scores the walk-f0 down-view silhouette against the plan's pinned
 * fill-ratio and bbox-aspect bands.
 *
 * Metric (exact integers, pinned): pose the genome at `walk` phase 0
 * (the raster-golden pose), rasterize the DOWN view at 32×32 with the
 * genome's own ramp_len, **offset-free** (the §1.4 golden form — no
 * snap), then over the opaque pixels:
 *
 * ```
 * N         = count of opaque pixels
 * bbox      = [minX..maxX] × [minY..maxY];  w = maxX−minX+1, h = maxY−minY+1
 * fill_fp   = rheDiv(N · 65536, w · h)      (ties-to-even, design 06 §5.1)
 * aspect_fp = rheDiv(w · 65536, h)
 * degenerate ⇔ N = 0 ∨ fill_fp ∉ [FILL_LO, FILL_HI] ∨ aspect_fp ∉ [ASP_LO, ASP_HI]
 * ```
 *
 * Bands (design 07 §5.1, MEASURED 2026-07-16 on the pristine cffb2a0
 * build over the shipped default-path corpora — `sampleGenome(seed,
 * plan)` seeds 0..1999 per plan; margin rule M = max(3277,
 * floor(range/8)), band = [obsMin − M, obsMax + M]): band ⊇ envelope ⇒
 * ZERO violators on every already-reachable genome by construction (the
 * H4 anchor-razor resolution — the defense guards the NEWLY-reachable
 * space: tag/preset modes, hand-edited DNA, future grammar drift).
 * Bands may only WIDEN post-measurement (the union re-pin rule), never
 * narrow.
 *
 * Where it runs (the one coherent story, design 07 §5.1):
 * 1. sampler-time — tag/preset modes only, the bounded re-roll protocol
 *    (genome.ts, R_SC = 2, `selfcheck:i` draw names);
 * 2. export-time — every genome, every plan: a degenerate export's
 *    canonical JSON gains top-level `"degenerate": true`, ABSENT when
 *    false (the flash-flag additive-key precedent), so every
 *    non-degenerate export is byte-identical to before. Accept-and-tag,
 *    never a silent loop (design 05 §1).
 *
 * One 32×32 raster per check — negligible against a 72-frame export.
 */

import { rheDiv } from "./fixed.js";
import type { Genome } from "./genome.js";
import { PLAN_NAMES, getScalar } from "./genome.js";
import { poseCreature } from "./pose.js";
import { rasterize } from "./raster.js";

/** One plan's self-check bands, inclusive 16.16 raw bounds. */
export interface SelfCheckBands {
  readonly fillLo: number;
  readonly fillHi: number;
  readonly aspectLo: number;
  readonly aspectHi: number;
}

/**
 * The pinned per-plan band table (design 07 §5.1 — measured envelope +
 * margin; see the module header for the measurement record).
 */
export const SELF_CHECK_BANDS: Readonly<
  Record<(typeof PLAN_NAMES)[number], SelfCheckBands>
> = Object.freeze({
  quadruped: Object.freeze({ fillLo: 28141, fillHi: 66223, aspectLo: 9453, aspectHi: 66166 }),
  levitant: Object.freeze({ fillLo: 22937, fillHi: 49243, aspectLo: 18725, aspectHi: 122749 }),
  amorphous: Object.freeze({ fillLo: 35449, fillHi: 65692, aspectLo: 9878, aspectHi: 118059 }),
});

/** The self-check metric values of one genome (all exact integers). */
export interface SelfCheckMetrics {
  /** Opaque pixel count of the walk-f0 down-view 32×32 raster. */
  readonly n: number;
  /** Opaque bbox width in pixels (0 when n = 0). */
  readonly w: number;
  /** Opaque bbox height in pixels (0 when n = 0). */
  readonly h: number;
  /** rheDiv(n·65536, w·h) — 0 when n = 0. */
  readonly fillFp: number;
  /** rheDiv(w·65536, h) — 0 when n = 0. */
  readonly aspectFp: number;
  readonly degenerate: boolean;
}

/** The silhouette numbers of one tagged grid (no band judgment). */
export interface SilhouetteMetrics {
  readonly n: number;
  readonly w: number;
  readonly h: number;
  readonly fillFp: number;
  readonly aspectFp: number;
}

/**
 * The pinned silhouette arithmetic over one tagged raster grid (§5.1):
 * opaque count, opaque bbox, `fill_fp = rheDiv(n·65536, w·h)`,
 * `aspect_fp = rheDiv(w·65536, h)`. n = 0 reports all-zero metrics
 * (always degenerate). Exposed for the CI metric unit vectors.
 */
export function silhouetteMetrics(
  grid: ReadonlyArray<ReadonlyArray<unknown | null>>,
): SilhouetteMetrics {
  let n = 0;
  let minX = 0;
  let maxX = -1;
  let minY = 0;
  let maxY = -1;
  for (let py = 0; py < grid.length; py++) {
    const row = grid[py]!;
    for (let px = 0; px < row.length; px++) {
      if (row[px] === null) continue;
      if (n === 0) {
        minX = px;
        maxX = px;
        minY = py;
        maxY = py;
      } else {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      n++;
    }
  }
  if (n === 0) return Object.freeze({ n: 0, w: 0, h: 0, fillFp: 0, aspectFp: 0 });
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  return Object.freeze({
    n,
    w,
    h,
    fillFp: rheDiv(n * 65536, w * h),
    aspectFp: rheDiv(w * 65536, h),
  });
}

/**
 * Compute the self-check metrics of one genome (see the module header
 * for the pinned definitions). Pure and deterministic: same DNA, same
 * flag, forever.
 */
export function selfCheckMetrics(genome: Genome): SelfCheckMetrics {
  const planName = PLAN_NAMES[getScalar(genome, "meta.plan")];
  if (planName === undefined) {
    throw new RangeError(
      `selfcheck: genome meta.plan ${getScalar(genome, "meta.plan")} names no band row`,
    );
  }
  const bands = SELF_CHECK_BANDS[planName];
  const rampLenRaw = getScalar(genome, "palette.ramp_len");
  if (rampLenRaw !== 3 && rampLenRaw !== 4 && rampLenRaw !== 5) {
    throw new RangeError(`selfcheck: palette.ramp_len must be 3, 4, or 5, got ${rampLenRaw}`);
  }
  const slabs = poseCreature(genome, "walk", 0);
  const grid = rasterize(slabs, "down", 32, rampLenRaw); // OFFSET-FREE — the §1.4 golden form
  const m = silhouetteMetrics(grid);
  const degenerate =
    m.n === 0 ||
    m.fillFp < bands.fillLo ||
    m.fillFp > bands.fillHi ||
    m.aspectFp < bands.aspectLo ||
    m.aspectFp > bands.aspectHi;
  return Object.freeze({ ...m, degenerate });
}

/** True iff the genome fails its plan's self-check bands (§5.1). */
export function selfCheck(genome: Genome): boolean {
  return selfCheckMetrics(genome).degenerate;
}
