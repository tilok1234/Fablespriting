/**
 * U5 — the sampler modes + readability self-check test slice (split
 * from tests/u5.test.ts so vitest parallelizes the mode-sampling cost
 * across workers; provenance and pins are documented there).
 */

import { describe, expect, test } from "vitest";

import { rheDiv } from "../src/fixed.js";
import { exportCreature } from "../src/export.js";
import {
  FFF_PRESETS,
  PLAN_NAMES,
  REGISTRY,
  SELF_CHECK_REROLL,
  TEMPERAMENT,
  applySelfCheckReroll,
  decodeGenome,
  encodeGenome,
  getScalar,
  locusById,
  makeGenome,
  sampleGenome,
} from "../src/genome.js";
import type { Genome, ScalarLocus } from "../src/genome.js";
import { createStream } from "../src/prng.js";
import {
  SELF_CHECK_BANDS,
  selfCheck,
  selfCheckMetrics,
  silhouetteMetrics,
} from "../src/selfcheck.js";
import { growCreature } from "../src/pose.js";

const PLANS = [0, 1, 2] as const;
const ORNAMENT_EXISTS = [53, 54, 55] as const;

describe("U5 sampler modes (design 07 §6.1)", () => {
  test("committed sampler-mode DNA vectors (seed 7 × plan × {chitin, ranged, armor})", { timeout: 120000 }, () => {
    const vectors: ReadonlyArray<[number, "tags" | "preset", string, string]> = [
      [0, "tags", "chitin", "AQEHAgEAA-KWggcEh7TJAgXXGQYBCOFDCdHDBQrb_AYLlogCDPOEBw201xYOio4QD6fyBhCa5wIRhPELEr64AxPdhQEUuYsCFeDpBxbY3wUYyEQZ40kaARvEkg4cv50CHoDYAx_Y9QUgAiGYgQ0ihaMDI_usAzUC"],
      [0, "preset", "ranged", "AQEHAgEAA-KWggcEh7TJAgXXGQYBCKK0CAnNjw0K2_wGC5aIAgyS2hENtNcWDoqOEA-n8gYQmucCEYTxCxK-uAMTrs8DFLmLAhXg6QcW2N8FGMhEGeNJGgEbxJIOHL-dAh6A2AMf2PUFIAIhmIENIoWjAyP7rAMzAjSE1gM"],
      [0, "preset", "armor", "AQEHAgEAA-KWggcEh7TJAgXXGQYBCOXjAQnNjw0K2_wGC5aIAgyS2hENtNcWDpzkEA-1sAcQmucCEYTxCxK-uAMT3YUBFLmLAhXg6QcWrusCGMhEGcTHBRoBG8SSDhyUrQQegNgDH5a7BSACIZiBDSKFowMj-6wDNQI"],
      [1, "tags", "chitin", "AQACAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDoqOEA-n8gYkAiXrtwQmAyfnOiiFigYpkPIBKug0K67uASy42wEt1MwBLommAw"],
      [1, "preset", "ranged", "AQACAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDoqOEA-n8gYkAiX8rgUmAyfnOiitnQopkPIBKug0K8gGLLjbAS3UzAEuiaYDMwI0hNYD"],
      [1, "preset", "armor", "AQACAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDpzkEA-n8gYkAiW1igYmAyfnOiitnQopkPIBKug0K67uASy42wEt9p8CLommAzYC"],
      [2, "tags", "chitin", "AQAEAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDoqOEA-n8gYwvUQx0YsBMs-DATcC"],
      [2, "preset", "ranged", "AQAEAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDoqOEA-n8gYwswYx0YsBMs-DATMCNITWAw"],
      [2, "preset", "armor", "AQAEAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDpzkEA-n8gYwm20x0YsBMs-DATcC"],
    ];
    for (const [plan, kind, name, dna] of vectors) {
      const opts = kind === "tags" ? { tags: [0] } : { preset: name as "ranged" | "armor" };
      expect(encodeGenome(sampleGenome(7n, plan, opts)), `${PLAN_NAMES[plan]} ${name}`).toBe(dna);
      // Determinism: a second call is byte-identical.
      expect(encodeGenome(sampleGenome(7n, plan, opts))).toBe(dna);
    }
  });

  test("ranged GUARANTEES the emitter: id 51 = 1, size ∈ [72090, 98304], exactly one grown emitter node", { timeout: 120000 }, () => {
    for (const plan of PLANS) {
      for (let seed = 0; seed < 10; seed++) {
        const g = sampleGenome(BigInt(seed), plan, { preset: "ranged" });
        expect(getScalar(g, 51)).toBe(1);
        const size = getScalar(g, 52);
        expect(size).toBeGreaterThanOrEqual(72090);
        expect(size).toBeLessThanOrEqual(98304);
        const graph = growCreature(g);
        expect(graph.parts.filter((p) => p.kind === "emitter").length).toBe(1);
      }
    }
  });

  test("armor FORCES the plan's ornament existence locus to 1", { timeout: 120000 }, () => {
    for (const plan of PLANS) {
      for (let seed = 0; seed < 10; seed++) {
        const g = sampleGenome(BigInt(seed), plan, { preset: "armor" });
        expect(getScalar(g, ORNAMENT_EXISTS[plan])).toBe(1);
        // armor's per-locus rows: girth in the high half on every plan
        const girth = getScalar(g, "body.core.girth");
        expect(girth).toBeGreaterThanOrEqual(314573);
        expect(girth).toBeLessThanOrEqual(393216);
      }
    }
  });

  test("speed preset: quadruped leg lengths remapped to [262144, 327680]; frozen-family law holds", { timeout: 120000 }, () => {
    for (let seed = 0; seed < 10; seed++) {
      const g = sampleGenome(BigInt(seed), 0, { preset: "speed" });
      for (const sock of ["FL", "FR", "BL", "BR"]) {
        const len = getScalar(g, `body.leg[${sock}].length`);
        expect(len).toBeGreaterThanOrEqual(262144);
        expect(len).toBeLessThanOrEqual(327680);
      }
      // speed does NOT bias gait_freq (the recorded deviation)
      const lev = sampleGenome(BigInt(seed), 1, { preset: "speed" });
      expect(getScalar(lev, "anim.levitant.flap_ratio")).toBe(3); // forced = the DEFAULT member
    }
  });

  test("temperament priors: chitin remaps quadruped bob_amp to [0, 32768]; spectral forces levitant hover_freq 1", { timeout: 120000 }, () => {
    for (let seed = 0; seed < 10; seed++) {
      const q = sampleGenome(BigInt(seed), 0, { tags: [0] });
      expect(q.traitTags).toEqual([0]);
      const bob = getScalar(q, "anim.quadruped.bob_amp");
      expect(bob).toBeGreaterThanOrEqual(0);
      expect(bob).toBeLessThanOrEqual(32768);
      const swing = getScalar(q, "anim.quadruped.leg_swing_amp");
      expect(swing).toBeGreaterThanOrEqual(78643);
      expect(swing).toBeLessThanOrEqual(144179);
      const lev = sampleGenome(BigInt(seed), 1, { tags: [2] });
      expect(getScalar(lev, "anim.levitant.hover_freq")).toBe(1);
      const hover = getScalar(lev, "anim.levitant.hover_amp");
      expect(hover).toBeGreaterThanOrEqual(65536);
      expect(hover).toBeLessThanOrEqual(131072);
    }
  });

  test("conflict rules: the LOWEST tag id wins per locus; presets apply last and win", { timeout: 120000 }, () => {
    for (let seed = 0; seed < 10; seed++) {
      // chitin (0) + fleshy (1) both bias quadruped bob_amp — chitin wins.
      const g = sampleGenome(BigInt(seed), 0, { tags: [0, 1] });
      expect(getScalar(g, "anim.quadruped.bob_amp")).toBeLessThanOrEqual(32768);
      // chitin biases bob [0, 32768]; speed remaps it to [0, 39322] and
      // leg_swing to [163840, 262144] OVER chitin's [78643, 144179].
      const p = sampleGenome(BigInt(seed), 0, { tags: [0], preset: "speed" });
      const swing = getScalar(p, "anim.quadruped.leg_swing_amp");
      expect(swing).toBeGreaterThanOrEqual(163840);
      expect(swing).toBeLessThanOrEqual(262144);
    }
  });

  test("tag-mode gated draws follow the pinned probabilities' streams (independent recompute)", { timeout: 120000 }, () => {
    for (const plan of PLANS) {
      const ornLocus = REGISTRY[ORNAMENT_EXISTS[plan]] as ScalarLocus;
      for (let seed = 0; seed < 20; seed++) {
        const g = sampleGenome(BigInt(seed), plan, { tags: [0] }); // chitin: no emitter boost
        const wantOrn = createStream(BigInt(seed), ornLocus.path).nextRange(4) >= 1 ? 1 : 0;
        expect(getScalar(g, ORNAMENT_EXISTS[plan]), `orn ${plan}:${seed}`).toBe(wantOrn);
        const wantEmit = createStream(BigInt(seed), "body.emitter[C].exists").nextRange(8) === 0 ? 1 : 0;
        expect(getScalar(g, 51), `emit ${plan}:${seed}`).toBe(wantEmit);
        const s = sampleGenome(BigInt(seed), plan, { tags: [2] }); // spectral: P = 1/2
        const wantEmitS = createStream(BigInt(seed), "body.emitter[C].exists").nextRange(2) === 1 ? 1 : 0;
        expect(getScalar(s, 51), `emitS ${plan}:${seed}`).toBe(wantEmitS);
      }
    }
  });

  test("preset-only speed/ranged never draws the ornament locus (stays 0)", { timeout: 120000 }, () => {
    for (const plan of PLANS) {
      for (let seed = 0; seed < 10; seed++) {
        expect(getScalar(sampleGenome(BigInt(seed), plan, { preset: "speed" }), ORNAMENT_EXISTS[plan])).toBe(0);
        expect(getScalar(sampleGenome(BigInt(seed), plan, { preset: "ranged" }), ORNAMENT_EXISTS[plan])).toBe(0);
      }
    }
  });

  test("empty forced tag set: a neutral genome (tags []) — reachable, deterministic, gates nothing on", () => {
    const g = sampleGenome(3n, 0, { tags: [] });
    expect(g.traitTags).toEqual([]);
    expect(getScalar(g, 51)).toBe(0);
    expect(getScalar(g, 53)).toBe(0);
  });

  test("census assertion: quadruped ∈ {13, 14}, levitant ∈ {11, 12, 13}, amorphous ∈ {7, 8, 9} across modes", { timeout: 240000 }, () => {
    const ranges = [
      [13, 14],
      [11, 13],
      [7, 9],
    ] as const;
    const modes = [
      { tags: [0] },
      { tags: [2, 3] },
      { preset: "speed" as const },
      { preset: "armor" as const },
      { preset: "ranged" as const },
      { tags: [0], preset: "ranged" as const },
    ];
    for (const plan of PLANS) {
      for (const opts of modes) {
        for (let seed = 0; seed < 8; seed++) {
          const graph = growCreature(sampleGenome(BigInt(seed), plan, opts));
          const [lo, hi] = ranges[plan];
          expect(graph.parts.length, `${PLAN_NAMES[plan]} ${JSON.stringify(opts)} ${seed}`).toBeGreaterThanOrEqual(lo);
          expect(graph.parts.length).toBeLessThanOrEqual(hi);
        }
      }
    }
  });

  test("quadruped budget competition: with BOTH loci on, the emitter wins and the dorsal budget-closes", () => {
    const g = makeGenome({ values: [[51, 1], [53, 1]] });
    const graph = growCreature(g);
    expect(graph.parts.length).toBe(14);
    expect(graph.parts.some((p) => p.name === "maw")).toBe(true);
    expect(graph.parts.some((p) => p.name.startsWith("dorsal"))).toBe(false);
    // levitant and amorphous fit both:
    const lev = growCreature(makeGenome({ values: [[0, 1], [51, 1], [54, 1]] }));
    expect(lev.parts.filter((p) => p.kind === "emitter").length).toBe(1);
    expect(lev.parts.some((p) => p.name.startsWith("crown"))).toBe(true);
    expect(lev.parts.length).toBe(13);
    const amo = growCreature(makeGenome({ values: [[0, 2], [51, 1], [55, 1]] }));
    expect(amo.parts.length).toBe(9);
  });

  test("the temperament/preset tables transcribe the pinned raws (spot pins)", () => {
    expect(TEMPERAMENT.quadruped[0]!["anim.quadruped.leg_swing_amp"]).toEqual({ lo: 78643, hi: 144179 });
    expect(TEMPERAMENT.levitant[2]!["anim.levitant.hover_freq"]).toEqual({ forced: 1 });
    expect(TEMPERAMENT.amorphous[3]!["anim.amorphous.pulse_freq"]).toEqual({ forced: 1 });
    expect(FFF_PRESETS.armor.quadruped["body.core.depth"]).toEqual({ lo: 131072, hi: 183501 });
    expect(FFF_PRESETS.speed.levitant["anim.levitant.flap_ratio"]).toEqual({ forced: 3 });
    expect(FFF_PRESETS.ranged.quadruped["body.head.eye_size"]).toEqual({ lo: 65536, hi: 98304 });
    expect(Object.keys(FFF_PRESETS.ranged.amorphous)).toEqual([]);
  });
});

describe("U5 readability self-check (design 07 §5.1)", () => {
  test("the band table transcribes the measured pins exactly", () => {
    expect(SELF_CHECK_BANDS.quadruped).toEqual({ fillLo: 28141, fillHi: 66223, aspectLo: 9453, aspectHi: 66166 });
    expect(SELF_CHECK_BANDS.levitant).toEqual({ fillLo: 22937, fillHi: 49243, aspectLo: 18725, aspectHi: 122749 });
    expect(SELF_CHECK_BANDS.amorphous).toEqual({ fillLo: 35449, fillHi: 65692, aspectLo: 9878, aspectHi: 118059 });
  });

  test("metric unit vectors: hand-built grids (exact rheDiv arithmetic; n = 0 degenerate)", () => {
    const empty: (null | { x: 1 })[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
    expect(silhouetteMetrics(empty)).toEqual({ n: 0, w: 0, h: 0, fillFp: 0, aspectFp: 0 });
    // a 3×2 solid block: n=6, w=3, h=2 → fill 1.0, aspect 1.5
    const block = Array.from({ length: 8 }, () => Array<null | { x: 1 }>(8).fill(null));
    for (let y = 2; y < 4; y++) for (let x = 1; x < 4; x++) block[y]![x] = { x: 1 };
    expect(silhouetteMetrics(block)).toEqual({ n: 6, w: 3, h: 2, fillFp: 65536, aspectFp: 98304 });
    // an L shape: n=5, bbox 3×3 → fill rheDiv(5·65536, 9) = 36409 (rounds 36408.9), aspect 65536
    const ell = Array.from({ length: 8 }, () => Array<null | { x: 1 }>(8).fill(null));
    for (let y = 0; y < 3; y++) ell[y]![0] = { x: 1 };
    ell[2]![1] = { x: 1 };
    ell[2]![2] = { x: 1 };
    expect(silhouetteMetrics(ell)).toEqual({ n: 5, w: 3, h: 3, fillFp: rheDiv(5 * 65536, 9), aspectFp: 65536 });
    expect(rheDiv(5 * 65536, 9)).toBe(36409);
    // Rounding-mode lock: the metric numerators are n·2^16 with d ≤ 1024,
    // so an exact .5 tie is UNREACHABLE in-domain (2N = (2q+1)d forces
    // d's 2-adic valuation to 17). The formula's RHE mode is pinned by
    // rheDiv's own tie vectors: ties go to the even neighbor.
    expect(rheDiv(3, 2)).toBe(2);
    expect(rheDiv(5, 2)).toBe(2);
    expect(rheDiv(-3, 2)).toBe(-2);
  });

  test("the all-defaults metrics equal the spec's defaults column (in-band)", () => {
    const rows: ReadonlyArray<[Genome, number, number]> = [
      [makeGenome(), 48242, 29127],
      [makeGenome({ values: [["meta.plan", 1]] }), 31804, 61681],
      [makeGenome({ values: [["meta.plan", 2]] }), 46811, 56174],
    ];
    for (const [g, fill, aspect] of rows) {
      const m = selfCheckMetrics(g);
      expect([m.fillFp, m.aspectFp, m.degenerate]).toEqual([fill, aspect, false]);
    }
  });

  test("plans × seeds 0..49: every default-path genome is self-check clean (the CI slice of the §8 property law)", { timeout: 240000 }, () => {
    for (const plan of PLANS) {
      for (let seed = 0; seed < 50; seed++) {
        expect(selfCheck(sampleGenome(BigInt(seed), plan)), `${PLAN_NAMES[plan]}:${seed}`).toBe(false);
      }
    }
  });

  test("degenerate flag: ABSENT when false, PRESENT (true) for the pinned out-of-band DNA (byte test)", { timeout: 120000 }, () => {
    // The pinned synthetic violator (hand-edited DNA): levitant, min
    // length / max girth / min depth, min sensor, max locomotor, min
    // tendril girth+len, crown forced, SEED 9 — the neutral kind fill
    // resolves crown_PLATE (halves ≥ 0.5 px: immune to the §6.1
    // thin-ornament pixel-phase repair, which moved the adjudication
    // probe's sprout crown in-band) — w 26 × h 13, aspect 131072
    // > band hi 122749.
    const dna = "AQACAQkNs-YcDrTmEA_LmQsry5kDLJqzBi3lzAEu__8DNgI";
    const g = decodeGenome(dna);
    const m = selfCheckMetrics(g);
    expect(m.degenerate).toBe(true);
    expect(m.aspectFp).toBe(131072);
    const bad = exportCreature(g);
    expect(bad.json).toContain('"degenerate":true');
    const good = exportCreature(makeGenome({ values: [["meta.plan", 1]] }));
    expect(good.json.includes("degenerate")).toBe(false);
  });

  test("the re-roll sets transcribe the pins", () => {
    expect(SELF_CHECK_REROLL.quadruped).toEqual([21, 22, 24, 25, 27, 28, 30, 31, 53]);
    expect(SELF_CHECK_REROLL.levitant).toEqual([44, 45, 46, 54]);
    expect(SELF_CHECK_REROLL.amorphous).toEqual([55]);
  });
});

// ---------------------------------------------------------------------------
// The re-roll protocol EXECUTED — unit vectors through the pure helper
// (design 07 §5.1; the U5 round-0 laws finding: the machinery must carry
// execution evidence, not constant transcriptions). The degeneracy check
// is injected, so every branch fires without a reachable degenerate.
// ---------------------------------------------------------------------------

describe("applySelfCheckReroll — executed unit vectors (injected check)", () => {
  const SEED = 123n;
  const PLAN_QUAD: ReadonlyArray<readonly [number, number]> = [];
  const REROLL = [...SELF_CHECK_REROLL.quadruped];

  /** Hand-computed expectation: the exact draw the helper must make for
   * locus `id` on pass `i` — the same primitives, derived independently
   * of the helper's control flow. */
  const expectDraw = (id: number, i: number): number => {
    const locus = locusById(id)!;
    const s = createStream(SEED, locus.path, `selfcheck:${i}`);
    return locus.kind === "enum"
      ? s.nextRange((locus as { hi: number; lo: number }).hi - (locus as { lo: number }).lo + 1)
      : s.nextFp((locus as { lo: number }).lo, (locus as { hi: number }).hi);
  };

  test("not degenerate → initial genome returned untouched, zero re-roll draws", () => {
    const g = applySelfCheckReroll(SEED, [0], PLAN_QUAD, REROLL, undefined, () => false);
    expect(encodeGenome(g)).toBe(encodeGenome(makeGenome({ seed: SEED, traitTags: [0] })));
  });

  test("fail once → one full selfcheck:0 pass, every re-roll id redrawn from its own stream", () => {
    let calls = 0;
    const failOnce = () => calls++ === 0;
    const g = applySelfCheckReroll(SEED, [0], PLAN_QUAD, REROLL, undefined, failOnce);
    for (const id of REROLL) {
      expect(getScalar(g, id), `locus ${id} = selfcheck:0 draw`).toBe(expectDraw(id, 0));
    }
    expect(calls).toBe(2); // initial check + first in-band check (break)
  });

  test("fail twice → second pass overwrites with selfcheck:1 draws; cap accepts the result", () => {
    let calls = 0;
    const failTwice = () => calls++ < 2;
    const g = applySelfCheckReroll(SEED, [0], PLAN_QUAD, REROLL, undefined, failTwice);
    for (const id of REROLL) {
      expect(getScalar(g, id), `locus ${id} = selfcheck:1 draw`).toBe(expectDraw(id, 1));
    }
  });

  test("always degenerate → R_SC = 2 cap: accept-and-return after exactly two passes", () => {
    let calls = 0;
    const always = () => {
      calls++;
      return true;
    };
    const g = applySelfCheckReroll(SEED, [0], PLAN_QUAD, REROLL, undefined, always);
    expect(calls).toBe(3); // initial + after pass 0 + after pass 1, then accept
    for (const id of REROLL) {
      expect(getScalar(g, id)).toBe(expectDraw(id, 1)); // final values = pass-1 draws
    }
  });

  test("skipId is never re-rolled (the preset-forced exemption)", () => {
    const skip = REROLL[0]!;
    const g = applySelfCheckReroll(SEED, [0], PLAN_QUAD, REROLL, skip, () => true);
    const dflt = (locusById(skip) as { defaultRaw: number }).defaultRaw;
    expect(getScalar(g, skip), "skipped locus keeps its input value").toBe(dflt);
    for (const id of REROLL.slice(1)) {
      expect(getScalar(g, id)).toBe(expectDraw(id, 1));
    }
  });
});
