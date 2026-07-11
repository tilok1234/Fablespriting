import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { INT32_MAX, INT32_MIN } from "../src/fixed.js";
import { makeGenome, sampleGenome } from "../src/genome.js";
import { PART_NAMES } from "../src/grammar.js";
import type { MaterialRole } from "../src/grammar.js";
import { poseQuadruped } from "../src/pose.js";
import type { Slab } from "../src/pose.js";
import {
  COVERAGE_RAW,
  DIRECTIONS,
  DIRECTION_TURNS,
  ROLE_NAMES,
  SUPERSAMPLE,
  rasterize,
  serializeRasterGrid,
  yawSlab,
} from "../src/raster.js";
import type { RasterGrid } from "../src/raster.js";

const DEFAULTS = makeGenome();

/** Frozen model-space slab literal for hand-built scenes (raws). */
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
 * Shared structural validator (plain function so the 500-genome sweep
 * stays fast). Returns null when the grid is well-formed, else a message
 * pinpointing the first violation.
 */
function structureViolation(grid: RasterGrid, size: number, nSlabs: number): string | null {
  if (grid.length !== size) return `grid height ${grid.length} !== ${size}`;
  for (let py = 0; py < size; py++) {
    const row = grid[py]!;
    if (row.length !== size) return `row ${py} width ${row.length} !== ${size}`;
    for (let px = 0; px < size; px++) {
      const cell = row[px];
      if (cell === null || cell === undefined) {
        if (cell === undefined) return `(${px}, ${py}) is undefined, not null`;
        continue;
      }
      if (!ROLE_NAMES.includes(cell.role)) return `(${px}, ${py}) unknown role ${cell.role}`;
      if (!Number.isInteger(cell.tone) || cell.tone < 0 || cell.tone > 2) {
        return `(${px}, ${py}) tone ${cell.tone} outside 0..2 at ramp_len 4`;
      }
      if (!Number.isInteger(cell.partId) || cell.partId < 0 || cell.partId >= nSlabs) {
        return `(${px}, ${py}) partId ${cell.partId} not a slab index`;
      }
      if (!Number.isInteger(cell.depthRaw) || cell.depthRaw < INT32_MIN || cell.depthRaw > INT32_MAX) {
        return `(${px}, ${py}) depthRaw ${cell.depthRaw} not an int32`;
      }
    }
  }
  return null;
}

function countRole(grid: RasterGrid, role: MaterialRole): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null && c.role === role) n++;
  return n;
}

function countOpaque(grid: RasterGrid): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null) n++;
  return n;
}

describe("structure — grid shape and tag well-formedness (deliverable 1)", () => {
  test("all-defaults wolf, every direction: 32×32 grid, valid tags", () => {
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    for (const d of DIRECTIONS) {
      const grid = rasterize(slabs, d);
      expect(structureViolation(grid, 32, slabs.length)).toBeNull();
      expect(countOpaque(grid)).toBeGreaterThan(0);
    }
  });

  test("focal pixels carry eye part tags (down view)", () => {
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    const grid = rasterize(slabs, "down");
    let focal = 0;
    for (const row of grid) {
      for (const c of row) {
        if (c !== null && c.role === "focal") {
          focal++;
          expect(["eye_l", "eye_r"]).toContain(PART_NAMES[c.partId]);
        }
      }
    }
    expect(focal).toBeGreaterThan(0);
  });

  test("rejects bad direction, size, and ramp_len", () => {
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    expect(() => rasterize(slabs, "north" as never)).toThrow(RangeError);
    expect(() => rasterize(slabs, "down", 0)).toThrow(RangeError);
    expect(() => rasterize(slabs, "down", 31.5)).toThrow(RangeError);
    expect(() => rasterize(slabs, "down", 32, 6 as never)).toThrow(RangeError);
  });
});

describe("P1 invariant probe (design 04 §2, S1/F1)", () => {
  test("all-defaults wolf facing down: head-side rows sit LOWER than tail-side rows", () => {
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    const grid = rasterize(slabs, "down");
    // Part tags: head = 2, snout = 3, tail = 12 (pinned slab order).
    let minHeadPy = Number.POSITIVE_INFINITY;
    let maxTailPy = Number.NEGATIVE_INFINITY;
    let headPixels = 0;
    let tailPixels = 0;
    for (let py = 0; py < 32; py++) {
      for (const c of grid[py]!) {
        if (c === null) continue;
        if (c.partId === 2 || c.partId === 3) {
          headPixels++;
          if (py < minHeadPy) minHeadPy = py;
        }
        if (c.partId === 12) {
          tailPixels++;
          if (py > maxTailPy) maxTailPy = py;
        }
      }
    }
    expect(headPixels).toBeGreaterThan(0);
    expect(tailPixels).toBeGreaterThan(0);
    // LOWER in the sprite = larger py. Every head/snout row is strictly
    // below every tail row: getting the P1 sign wrong flips this.
    expect(minHeadPy).toBeGreaterThan(maxTailPy);
  });

  test("head pixels are closer (smaller depth tag) than tail pixels in the down view", () => {
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    const grid = rasterize(slabs, "down");
    let maxHeadDepth = Number.NEGATIVE_INFINITY;
    let minTailDepth = Number.POSITIVE_INFINITY;
    for (const row of grid) {
      for (const c of row) {
        if (c === null) continue;
        if (c.partId === 2 && c.depthRaw > maxHeadDepth) maxHeadDepth = c.depthRaw;
        if (c.partId === 12 && c.depthRaw < minTailDepth) minTailDepth = c.depthRaw;
      }
    }
    expect(maxHeadDepth).toBeLessThan(minTailDepth);
  });
});

describe("yaw exactness (design 04 §2: extents permute exactly, no resampling)", () => {
  test("rasterizing at each direction equals rasterizing independently yawed slabs at up", () => {
    // Walk φ = 0.25 turns: leg swing ±2.1 and tail wag break both the
    // mirror and the 180° rotational symmetry, so any yaw slip changes
    // pixels.
    const slabs = poseQuadruped(DEFAULTS, "walk", 16384);
    for (const d of DIRECTIONS) {
      const direct = rasterize(slabs, d);
      const preYawed = slabs.map((s) => yawSlab(s, DIRECTION_TURNS[d]));
      expect(rasterize(preYawed, "up")).toEqual(direct);
    }
  });

  test("yawSlab: quarter-turn CCW center map and odd-turn extent swap", () => {
    const s = slab(65536, 131072, 196608, 6553, 13107, 19661, "hide");
    // (x, y) → (−y, x) per CCW turn.
    expect(yawSlab(s, 1)).toEqual(slab(-131072, 65536, 196608, 13107, 6553, 19661, "hide"));
    expect(yawSlab(s, 2)).toEqual(slab(-65536, -131072, 196608, 6553, 13107, 19661, "hide"));
    expect(yawSlab(s, 3)).toEqual(slab(131072, -65536, 196608, 13107, 6553, 19661, "hide"));
    expect(yawSlab(s, 0)).toEqual(s);
    expect(yawSlab(s, 4)).toEqual(s);
    expect(yawSlab(s, -1)).toEqual(yawSlab(s, 3));
    expect(() => yawSlab(s, 1.5)).toThrow(RangeError);
  });
});

describe("coverage boundary — exact integer comparison (deliverable 4)", () => {
  // The pinned rule: opaque iff hits·2^16 ≥ S²·COVERAGE_RAW. At S = 4,
  // 32×32 that is hits·65536 ≥ 16·27525 = 440400, i.e. hits ≥ 7 (6·65536 =
  // 393216 < 440400 ≤ 458752 = 7·65536). The scenes below are strip slabs
  // engineered so pixel (16, 20) receives exactly 7 or exactly 6 hitting
  // samples; sample columns of that pixel sit at sx ∈ {0.125, 0.375,
  // 0.625, 0.875}, sample rows at sy ∈ {−6.375, −6.125, −5.875, −5.625}.
  test("the integer comparison itself: 7·2^16 clears the threshold, 6·2^16 does not", () => {
    expect(7 * 65536).toBeGreaterThanOrEqual(SUPERSAMPLE * SUPERSAMPLE * COVERAGE_RAW);
    expect(6 * 65536).toBeLessThan(SUPERSAMPLE * SUPERSAMPLE * COVERAGE_RAW);
  });

  // Column strip: hits exactly sample column ix = 1 (sx = 0.375) of pixel
  // x = 16, every sample row (|X| = 0 at the column, 1.25 at neighbors;
  // hit needs |X| ≤ ~1). Huge y/z extents make the depth-side test
  // trivially pass everywhere in frame.
  const colStrip = slab(24576, 0, 0, 13107, 6553600, 6553600, "hide"); // cx 0.375, hx 0.2, hy = hz = 100

  // Row strip: hits exactly sample row iy = 2 (sy = −5.875) across all
  // four sample columns of pixel x = 16 (hx = 100 → |X| ≈ 0; the row
  // test w = −sy − cz gives |Z0| = 0 on the row, 1.67 at neighbors).
  const rowStripFull = slab(0, 0, 385024, 6553600, 9830, 9830, "hide"); // cz 5.875, hy = hz = 0.15

  // Same row strip narrowed to sample columns ix ∈ {0, 1, 2}: hx = 0.3
  // centered on column ix = 1 puts |X| = 0.833 on ix 0/2 (hit) and 1.667
  // on ix 3 (miss).
  const rowStripShort = slab(24576, 0, 385024, 19661, 9830, 9830, "hide"); // hx 0.3

  test("exactly 7 hitting samples (4 + 4 − 1 overlap) → opaque", () => {
    const grid = rasterize([colStrip, rowStripFull], "up");
    expect(grid[20]![16]).not.toBeNull();
  });

  test("exactly 6 hitting samples (4 + 3 − 1 overlap) → transparent", () => {
    const grid = rasterize([colStrip, rowStripShort], "up");
    expect(grid[20]![16]).toBeNull();
  });

  test("4 hitting samples (column strip alone) → transparent", () => {
    const grid = rasterize([colStrip], "up");
    expect(grid[20]![16]).toBeNull();
  });
});

describe("tie-breaks (deliverable 5)", () => {
  // Row-band strips: hy = hz = 0.2 bands centered between two sample rows
  // hit exactly those two rows across all four sample columns of pixel
  // (16, 20) — 8 samples each. Rows 0, 1 center: sy = −6.25 → cz = 6.25;
  // rows 2, 3 center: sy = −5.75 → cz = 5.75. Both bands see identical
  // sample geometry relative to their centers (w = ±0.125 exactly), so
  // their (material-independent) tones are identical raws.
  const bandTop = (role: MaterialRole): Slab =>
    slab(0, 0, 409600, 6553600, 13107, 13107, role); // rows iy 0, 1
  const bandBottom = (role: MaterialRole): Slab =>
    slab(0, 0, 376832, 6553600, 13107, 13107, role); // rows iy 2, 3

  test("(a) exact 8–8 vote tie → the key whose first sample is earliest in scan order wins", () => {
    // hide on the top band (scanned first: iy outer ascending) vs
    // underside on the bottom band — hide must win the tie.
    const hideFirst = rasterize([bandTop("hide"), bandBottom("underside")], "up");
    expect(hideFirst[20]![16]!.role).toBe("hide");
    // Swap the bands: underside now owns the earliest samples and wins —
    // proving the rule is scan-order, not role or slab order.
    const undersideFirst = rasterize([bandTop("underside"), bandBottom("hide")], "up");
    expect(undersideFirst[20]![16]!.role).toBe("underside");
  });

  test("part tie within the winning key → earliest contributing sample, not lowest slab index", () => {
    // Same role in both bands → a single (material, tone) key with 16
    // samples, split 8–8 between the two parts. The top band is slab
    // index 1, so a lowest-index rule would answer 0; the pinned
    // earliest-sample rule answers 1.
    const grid = rasterize([bandBottom("hide"), bandTop("hide")], "up");
    const cell = grid[20]![16]!;
    expect(cell.role).toBe("hide");
    expect(cell.partId).toBe(1);
  });

  test("(b) exact depth tie → the lower slab index wins", () => {
    // Two coincident slabs: every sample hits both at bit-identical entry
    // depth, so the strict-< nearest scan must keep the lower index.
    const sphere = (role: MaterialRole): Slab =>
      slab(0, 0, 393216, 131072, 131072, 131072, role); // r = 2 at z = 6
    const hideFirst = rasterize([sphere("hide"), sphere("underside")], "up");
    const cell = hideFirst[20]![16]!;
    expect(cell.role).toBe("hide");
    expect(cell.partId).toBe(0);
    const undersideFirst = rasterize([sphere("underside"), sphere("hide")], "up");
    const swapped = undersideFirst[20]![16]!;
    expect(swapped.role).toBe("underside");
    expect(swapped.partId).toBe(0);
  });
});

describe("determinism (deliverable 6)", () => {
  test("two rasterizations of the same scene are deep-equal", () => {
    const slabs = poseQuadruped(sampleGenome(123n), "walk", 0);
    for (const d of DIRECTIONS) {
      expect(rasterize(slabs, d)).toEqual(rasterize(slabs, d));
    }
  });
});

describe("500-genome sampled sweep, all 4 directions, walk phase 0 (deliverable 7)", () => {
  test(
    "no throws, structure holds, every sprite has opaque pixels; focal survival characterized",
    { timeout: 300000 },
    () => {
      // RESOLVED SPEC FINDING (found & fixed 2026-07-11): before the
      // design 06 §1.2 eye visibility coupling, 78 of the first 500
      // sampled genomes (323 of the first 2000) rendered NO focal (eye)
      // pixel in the down view, from three geometric causes: buried
      // eyes (front face never leaves the head ellipsoid), snout
      // occlusion (fixed 1.6×1.5 snout cross-extents ride over the eye
      // rows on scale < ~0.8 heads), and sub-pixel straddling (an eye
      // disc under ~1 px splits its ≤ 16 samples across pixels and
      // loses every majority vote to the head behind it). The coupling
      // (protrusion floor + default-raw footprint floors + scaled snout
      // cross-extents) repairs all of the first 500 and all but ONE of
      // the first 2000 — see the seeds 500..1999 sweep below for the
      // pinned residual.
      let focalless = 0;
      for (let seed = 0; seed < 500; seed++) {
        const g = sampleGenome(BigInt(seed));
        const slabs = poseQuadruped(g, "walk", 0);
        for (const d of DIRECTIONS) {
          let grid: RasterGrid;
          try {
            grid = rasterize(slabs, d);
          } catch (e) {
            expect.fail(`seed ${seed}, ${d}: rasterize threw ${String(e)}`);
          }
          const violation = structureViolation(grid, 32, slabs.length);
          if (violation !== null) expect.fail(`seed ${seed}, ${d}: ${violation}`);
          if (countOpaque(grid) === 0) {
            expect.fail(`seed ${seed}, ${d}: fully transparent sprite`);
          }
          if (d === "down" && countRole(grid, "focal") === 0) focalless++;
        }
      }
      expect(focalless).toBe(0);
    },
  );

  test("the all-defaults wolf keeps its eyes in the down view", () => {
    const grid = rasterize(poseQuadruped(DEFAULTS, "walk", 0), "down");
    expect(countRole(grid, "focal")).toBeGreaterThan(0);
  });

  test(
    "seeds 500..1999, down view: the sole eyeless residual is seed 1142",
    { timeout: 300000 },
    () => {
      // Design 06 §1.2 eye visibility coupling, known residual: seed
      // 1142's floored eye claims exactly 8 of 16 samples in two pixels
      // — a dead tie against the head's 8 — and the pinned first-seen
      // tie-break resolves both to the head (plus two 9 vs 7 near
      // misses); its profile views do render the eye. All three floors
      // sit at their maximum default-byte-identical raws and vote-rule
      // repairs are rejected (they alter default frames — §1.2), so
      // this is the principled optimum for M1. Pinned exactly: a change
      // to this list must be deliberate.
      const eyeless: number[] = [];
      for (let seed = 500; seed < 2000; seed++) {
        const g = sampleGenome(BigInt(seed));
        const grid = rasterize(poseQuadruped(g, "walk", 0), "down");
        if (countRole(grid, "focal") === 0) eyeless.push(seed);
      }
      expect(eyeless).toEqual([1142]);
    },
  );
});

describe("pinned raster golden (deliverable 8)", () => {
  test("SHA-256 of the serialized tagged grid — all-defaults wolf, down, walk phase 0", () => {
    const grid = rasterize(poseQuadruped(DEFAULTS, "walk", 0), "down");
    const hash = createHash("sha256").update(serializeRasterGrid(grid)).digest("hex");
    // First raster golden: computed by this implementation on
    // 2026-07-11, to be cross-checked by the differential verifier
    // against an independent transcription of the pinned step orders.
    expect(hash).toBe("3121cea8d4833a2fa5a5a7f51c56cf253d8bfd0827a9f460244f3e67a8a477ed");
  });

  test("serialization format: header + 0x00 transparent / 8-byte opaque records", () => {
    const grid = rasterize(poseQuadruped(DEFAULTS, "walk", 0), "down");
    const bytes = serializeRasterGrid(grid);
    const opaque = countOpaque(grid);
    expect(bytes[0]).toBe(32);
    expect(bytes[1]).toBe(32);
    // Opaque record: 0x01, role, tone, partId, int32 LE depth = 8 bytes.
    expect(bytes.length).toBe(2 + (32 * 32 - opaque) + opaque * 8);
  });
});
