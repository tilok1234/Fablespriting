/**
 * U5 — the render-heavy test slice (split from tests/u5.test.ts for
 * worker parallelism): flicker relaxation + mode-genome gates, the two
 * ritual-pinned goldens, and the 33-entry anchor-razor fingerprint
 * (captured from the PRISTINE cffb2a0 build — provenance in
 * tests/u5.test.ts's header and design 07 §5.1).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { exportCreature } from "../src/export.js";
import { evaluateCell, measureClipFlicker } from "../src/flicker.js";
import {
  PLAN_NAMES,
  getScalar,
  makeGenome,
  sampleGenome,
} from "../src/genome.js";
import type { Genome } from "../src/genome.js";
import { growCreature } from "../src/pose.js";

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./goldens/${name}`, import.meta.url));

const PLANS = [0, 1, 2] as const;

describe("U5 flicker — slab-count relaxation + mode-genome gates (CI slice)", () => {
  test("evaluateCell accepts any consistent slab count ≥ 7 and rejects < 7 or inconsistent", () => {
    const rgba = [new Uint8Array(4096), new Uint8Array(4096)];
    const slab = { cx: 0, cy: 0, cz: 0, hx: 65536, hy: 65536, hz: 65536, role: "hide" as const };
    const mk = (n: number) => Array.from({ length: n }, () => slab);
    expect(() => evaluateCell(rgba, [mk(8), mk(8)], "down")).not.toThrow();
    expect(() => evaluateCell(rgba, [mk(14), mk(14)], "down")).not.toThrow();
    expect(() => evaluateCell(rgba, [mk(6), mk(6)], "down")).toThrow(RangeError);
    expect(() => evaluateCell(rgba, [mk(8), mk(9)], "down")).toThrow(RangeError);
  });

  // CI slice scaled at the U5 gate (round-0 budget ruling R1): ONE clip
  // per (plan, mode) — each plan's loudest per its own calibration
  // (quadruped/amorphous walk, levitant attack) — all four directions of
  // that clip. The full 4-clip × 4-dir × 2-mode × 3-plan grid is unit
  // evidence (the recorded 2400-export mode sweep, §6.1).
  test("per-(plan, clip) gates HOLD on one tagged and one preset genome per plan (loudest clip)", { timeout: 240000 }, () => {
    const LOUDEST: readonly ("walk" | "attack")[] = ["walk", "attack", "walk"];
    for (const plan of PLANS) {
      for (const opts of [{ tags: [0] }, { preset: "ranged" as const }]) {
        const genome = sampleGenome(7n, plan, opts);
        const clip = LOUDEST[plan]!;
        const cells = measureClipFlicker(genome, clip);
        for (const direction of ["down", "left", "up", "right"] as const) {
          expect(cells[direction].pass, `${PLAN_NAMES[plan]} ${JSON.stringify(opts)} ${clip} ${direction}`).toBe(true);
        }
      }
    }
  });
});

describe("U5 goldens — tagged + preset (ritual-pinned)", () => {
  test("tagged golden: quadruped seed 7 {tags: [chitin]} — pinned hashes + committed files byte-match", { timeout: 240000 }, () => {
    const genome = sampleGenome(7n, 0, { tags: [0] });
    const e = exportCreature(genome);
    // RE-PINNED at V1 (generator v3): quadruped seed 7 is OUT of the design
    // 08 §2 byte-stable partition on all three conjuncts (F 19.539 px,
    // R′ 16.462, girth 0.691), so it is fitted AND floored — a full re-pin,
    // re-derived twice byte-identically under the provenance ritual.
    expect(e.sheetPngSha256).toBe("40a5fa498f9646811185f36ea5086bf8459526dc8aa6a83dfa529046065d8c9d");
    expect(e.sheetRgbaSha256).toBe("8cc671ef141ff4a33a9bb80adb6a5a480230e02a0bd1caaa1dd06518df28ef79");
    expect(e.jsonSha256).toBe("7cec1c4379ae9c7b1d5340eb60f9b4acb45ccf4cc4c662241f146885a9c0f630");
    expect(Buffer.from(e.sheetPng).equals(readFileSync(goldenPath("tagged_chitin_q7.sheet.png")))).toBe(true);
    expect(e.json).toBe(readFileSync(goldenPath("tagged_chitin_q7.json"), "utf8"));
    // the tagged graph grew the dorsal (14 slabs) and stays clean
    expect(growCreature(genome).parts.length).toBe(14);
    expect(e.json.includes("degenerate")).toBe(false);
  });

  test("preset golden: levitant seed 7 {preset: ranged} — pinned hashes + committed files byte-match", { timeout: 240000 }, () => {
    const genome = sampleGenome(7n, 1, { preset: "ranged" });
    const e = exportCreature(genome);
    // V1: levitant geometry is untouched, so BOTH pixel hashes are unchanged
    // from v2 (razor evidence); only the JSON moves, by the version line.
    expect(e.sheetPngSha256).toBe("90ee5258de1193595a4bc220a1c82ac3ccc2154ee8ce66135a49166d2c98e9d0");
    expect(e.sheetRgbaSha256).toBe("8c6206721e339093643aa8bef53f934c7312471ac5d25e61dc13378c19de746d");
    expect(e.jsonSha256).toBe("0ce814d5b9cf509d194a07a5137da9937415c259f76cd38377f090c071ecfdce");
    expect(Buffer.from(e.sheetPng).equals(readFileSync(goldenPath("ranged_lev7.sheet.png")))).toBe(true);
    expect(e.json).toBe(readFileSync(goldenPath("ranged_lev7.json"), "utf8"));
    expect(getScalar(genome, 51)).toBe(1); // the ranged guarantee, golden-carried
    expect(growCreature(genome).parts.length).toBe(12);
    expect(e.json.includes("degenerate")).toBe(false);
  });
});

describe("U5 anchor razor — baseline fingerprints (pristine cffb2a0 capture)", () => {
  // CI slice scaled at the U5 gate (round-0 budget ruling R1): the
  // per-run slice renders defaults + seeds 0..1 per plan (9 exports);
  // the COMMITTED 33-entry fingerprint file stays whole as unit
  // evidence, and the full 33 re-render at every unit close-out (the
  // exec-lens/orchestrator gate set).
  test("plans × (defaults + seeds 0..1): sheet-RGBA and JSON hashes byte-match the baseline", { timeout: 300000 }, () => {
    const lines = readFileSync(goldenPath("u5_anchor_33.txt"), "utf8")
      .trim()
      .split(/\r?\n/); // CRLF-tolerant: Windows CI checkouts autocrlf
    // multi-line text goldens (the first real windows-runner failure,
    // 2026-07-17 — .gitattributes now pins goldens eol-inert too)
    expect(lines.length).toBe(33); // the full evidence file stays intact
    const expected = new Map<string, readonly [string, string]>();
    for (const line of lines) {
      const [key, sheet, json] = line.split(" ");
      expected.set(key!, [sheet!, json!]);
    }
    for (const plan of PLANS) {
      const name = PLAN_NAMES[plan]!;
      const genomes: Array<readonly [string, Genome]> = [
        [`${name}:defaults`, plan === 0 ? makeGenome() : makeGenome({ values: [["meta.plan", plan]] })],
      ];
      for (let seed = 0; seed < 2; seed++) {
        genomes.push([`${name}:${seed}`, sampleGenome(BigInt(seed), plan)]);
      }
      for (const [key, genome] of genomes) {
        const want = expected.get(key);
        expect(want, key).toBeDefined();
        const e = exportCreature(genome);
        expect(e.sheetRgbaSha256, `${key} sheet`).toBe(want![0]);
        expect(e.jsonSha256, `${key} json`).toBe(want![1]);
      }
    }
  });
});
