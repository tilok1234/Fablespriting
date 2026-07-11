import { describe, expect, test } from "vitest";

import { exportCreature } from "../src/export.js";
import {
  FLICKER_GATE_DEN,
  FLICKER_GATE_NUM,
  changedPixels,
  evaluateCell,
  measureWalkFlicker,
  pairEnergy,
  pairPasses,
  pairScore,
  renderClipCells,
  screenCenters,
  sqrtRhe,
} from "../src/flicker.js";
import { makeGenome, sampleGenome } from "../src/genome.js";
import { poseQuadruped } from "../src/pose.js";
import { DIRECTIONS } from "../src/raster.js";

// ---------------------------------------------------------------------------
// Oracle provenance: every vector below is independent hand math (3-4-5
// triangles, small integer square roots, boundary rationals against the
// pinned gate) or a constructed degenerate case — never derived by
// running this implementation. The production distribution behind the
// pinned gate 32.0 is the design 06 §1.6 recalibration (seeds 0..199,
// 3200 pairs, max 25.1166, 2026-07-11).
// ---------------------------------------------------------------------------

describe("sqrtRhe — RHE(√n) on exact integer square sums (§1.6)", () => {
  test("hand vectors", () => {
    expect(sqrtRhe(0n)).toBe(0n);
    expect(sqrtRhe(1n)).toBe(1n);
    expect(sqrtRhe(2n)).toBe(1n); // 1.414 → 1
    expect(sqrtRhe(6n)).toBe(2n); // 2.449 → 2
    expect(sqrtRhe(7n)).toBe(3n); // 2.646 → 3
    expect(sqrtRhe(30n)).toBe(5n); // 5.477 → 5
    expect(sqrtRhe(31n)).toBe(6n); // 5.568 → 6
    // A 3-4-5 triangle in raws: √((3·2^16)² + (4·2^16)²) = 5·2^16 exact.
    expect(sqrtRhe(BigInt(3 * 65536) ** 2n + BigInt(4 * 65536) ** 2n)).toBe(5n * 65536n);
    // Beyond int32 (the §1.6 range point): 2^38 → 2^19 exact.
    expect(sqrtRhe(1n << 38n)).toBe(1n << 19n);
  });

  test("no-tie remainder rule: q² + q boundary", () => {
    // n = q² + q is the last n rounding DOWN to q (√n < q + ½);
    // n = q² + q + 1 is the first rounding UP to q + 1.
    for (const q of [1n, 2n, 100n, 65536n]) {
      expect(sqrtRhe(q * q + q)).toBe(q);
      expect(sqrtRhe(q * q + q + 1n)).toBe(q + 1n);
    }
  });

  test("negative input throws", () => {
    expect(() => sqrtRhe(-1n)).toThrow(RangeError);
  });
});

describe("changedPixels (§1.6)", () => {
  test("counts positions differing in any byte", () => {
    const a = new Uint8Array([0, 0, 0, 0, 10, 20, 30, 255, 1, 2, 3, 255]);
    const b = new Uint8Array([0, 0, 0, 0, 10, 20, 31, 255, 1, 2, 3, 255]);
    expect(changedPixels(a, a)).toBe(0);
    expect(changedPixels(a, b)).toBe(1); // only the middle pixel differs
    // alpha-only difference still counts (4-byte comparison is total)
    const c = new Uint8Array([0, 0, 0, 1, 10, 20, 30, 255, 1, 2, 3, 255]);
    expect(changedPixels(a, c)).toBe(1);
  });

  test("shape mismatches throw", () => {
    expect(() => changedPixels(new Uint8Array(4), new Uint8Array(8))).toThrow(RangeError);
    expect(() => changedPixels(new Uint8Array(3), new Uint8Array(3))).toThrow(RangeError);
  });
});

describe("pairEnergy — exact per-slab RHE displacement sum (§1.6)", () => {
  test("3-4-5 hand vector plus a zero slab", () => {
    const a = [
      { x: 0, y: 0 },
      { x: 100, y: -200 },
    ];
    const b = [
      { x: 3 * 65536, y: 4 * 65536 }, // displacement exactly 5 px
      { x: 100, y: -200 }, // displacement 0
    ];
    expect(pairEnergy(a, b)).toBe(5n * 65536n);
    expect(pairEnergy(a, a)).toBe(0n);
    // symmetric: energy(a→b) = energy(b→a)
    expect(pairEnergy(b, a)).toBe(5n * 65536n);
  });

  test("length mismatch throws", () => {
    expect(() => pairEnergy([{ x: 0, y: 0 }], [])).toThrow(RangeError);
  });
});

describe("pairPasses — the pinned exact gate comparison (§1.6)", () => {
  test("gate is 32.0 (recalibrated per F12)", () => {
    expect(FLICKER_GATE_NUM).toBe(32n);
    expect(FLICKER_GATE_DEN).toBe(1n);
  });

  test("zero-motion convention", () => {
    expect(pairPasses(0, 0n)).toBe(true); // 0/0 = 0.0 passes
    expect(pairPasses(1, 0n)).toBe(false); // churn at zero motion = INF
  });

  test("strict < at the gate boundary (hand rationals)", () => {
    // score = changed·2^16 / energy; gate 32.0
    expect(pairPasses(32, 65536n)).toBe(false); // exactly 32.0 fails
    expect(pairPasses(31, 65536n)).toBe(true); // 31.0 passes
    expect(pairPasses(32, 65537n)).toBe(true); // 31.9995… passes
    expect(pairPasses(1024, 2097152n)).toBe(false); // 1024·65536/2^21 = 32 exactly
    expect(pairPasses(1024, 2097153n)).toBe(true); // just under
  });

  test("pairScore (informative) agrees on the same points", () => {
    expect(pairScore(0, 0n)).toBe(0);
    expect(pairScore(5, 0n)).toBe(Infinity);
    expect(pairScore(32, 65536n)).toBe(32);
  });
});

describe("evaluateCell — INF auto-fail and zero-motion pass (constructed cells)", () => {
  const slabs = poseQuadruped(makeGenome(), "idle", 0);
  const blank = new Uint8Array(32 * 32 * 4);

  test("churn at zero motion → INF → cell fails", () => {
    // Two frames from the IDENTICAL slab list (energy exactly 0) whose
    // buffers differ by one pixel: both wrapping pairs are INF.
    const churn = new Uint8Array(blank);
    churn[0] = 255;
    churn[3] = 255;
    const cell = evaluateCell([blank, churn], [slabs, slabs], "down");
    expect(cell.pass).toBe(false);
    expect(cell.pairs).toHaveLength(2);
    for (const pair of cell.pairs) {
      expect(pair.energy).toBe(0n);
      expect(pair.changed).toBe(1);
      expect(pair.infinite).toBe(true);
      expect(pair.pass).toBe(false);
    }
  });

  test("zero motion, zero churn → score 0 → cell passes", () => {
    const cell = evaluateCell([blank, blank], [slabs, slabs], "down");
    expect(cell.pass).toBe(true);
    for (const pair of cell.pairs) {
      expect(pair.energy).toBe(0n);
      expect(pair.changed).toBe(0);
      expect(pair.infinite).toBe(false);
      expect(pair.pass).toBe(true);
    }
  });

  test("shape mismatches throw", () => {
    expect(() => evaluateCell([blank], [slabs, slabs], "down")).toThrow(RangeError);
    expect(() => evaluateCell([blank], [slabs.slice(0, 5)], "down")).toThrow(RangeError);
  });
});

describe("renderClipCells matches exportCreature (the metric measures the shipped bytes)", () => {
  test("walk cells of seed 3 are byte-identical to export frames 0..15", { timeout: 60000 }, () => {
    const genome = sampleGenome(3n);
    const cells = renderClipCells(genome, "walk");
    const exported = exportCreature(genome);
    DIRECTIONS.forEach((direction, d) => {
      const cell = cells[direction];
      for (let k = 0; k < 4; k++) {
        const frame = exported.frames[d * 4 + k]!;
        expect(frame.clip).toBe("walk");
        expect(frame.direction).toBe(direction);
        expect(cell.rgbaFrames[k]).toEqual(frame.rgba);
      }
    });
  });
});

describe("the CI flicker gate (design 06 §1.6; ROADMAP M1 acceptance)", () => {
  test("all-defaults wolf: every walk cell passes", { timeout: 60000 }, () => {
    const cells = measureWalkFlicker(makeGenome());
    for (const direction of DIRECTIONS) {
      expect(cells[direction].pass, `defaults walk ${direction}`).toBe(true);
    }
  });

  test(
    "seeds 0..49 × 4 directions: every walk cell under the gate, no INF",
    { timeout: 300000 },
    () => {
      for (let seed = 0; seed < 50; seed++) {
        const cells = measureWalkFlicker(sampleGenome(BigInt(seed)));
        for (const direction of DIRECTIONS) {
          const cell = cells[direction];
          for (const pair of cell.pairs) {
            expect(pair.infinite, `seed ${seed} walk ${direction} INF`).toBe(false);
          }
          expect(cell.pass, `seed ${seed} walk ${direction} gate`).toBe(true);
        }
      }
    },
  );
});
