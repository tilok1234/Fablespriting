/**
 * U6 — the CI hash guard on the pinned acceptance sheet (design 07 §7 /
 * §7.1): qa/sheet_mix_0_99.png + .json are the M2 acceptance artifacts,
 * and THE GUARD'S LAW is that any grammar/craft/sampler change that
 * moves a shipped byte fails here until the qa artifacts AND the
 * committed fixture (tests/goldens/u6_mix_guard.txt) regenerate in the
 * SAME commit — that regeneration diff is the reviewed artifact. A hash
 * move without it cannot pass CI.
 *
 * Three legs (the adjudicated composition):
 * 1. full-manifest identity — all 100 mix genomes re-derived
 *    (sample + encode, no render) and the canonical manifest string
 *    byte-compared against the committed qa JSON (observed 3.6–4.0 s
 *    quiet; any sampler/registry/stream drift fails here);
 * 2. a 6-cell render slice (2 per plan: per plan the lowest seed plus
 *    the lowest EMITTER-BEARING seed, the plan's NEXT-LOWEST seed
 *    joining when those coincide — realized under the pinned census:
 *    quad {0, 11}, lev {8, 9}, amor {3, 4}. The heuristic is advisory;
 *    NORMATIVE at any regeneration is that the six cells cover every
 *    plan × {ornament, emitter} render path, re-verified by
 *    ENUMERATION — the heuristic does not imply it: lev × ornament
 *    rides on seed 9's crown, and lev's emitter seeds 8/10 carry no
 *    ornament) re-exported
 *    through the FULL pipeline, sheet-RGBA sha256 asserted against the
 *    fixture AND pixel-compared against the decoded committed PNG's
 *    cell regions — proving the committed PNG contains TODAY'S renderer
 *    output, not a stale paste (observed ~21–23 s quiet; per-leg
 *    times are observations — the RETAINED whole-file guard walls,
 *    25.2–33.0 s solo, are in design 07 §7.1 item 5);
 * 3. whole-file sha256 pins of the committed PNG and manifest — every
 *    hash move is an explicit reviewed fixture diff line.
 *
 * Coverage tradeoff, recorded: per-run pixel coverage is 6 of 100
 * cells; the other 94 cells' GENOMES are guarded by leg 1 and their
 * pixels by the standing goldens + the U5 anchor slice per run, and by
 * the full-100 re-render at every unit close-out (design 07 §7.1) —
 * the U5 anchor-slice scaling precedent applied verbatim.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { describe, expect, test } from "vitest";

import { SHEET_GUTTER, buildMixManifestEntries } from "../src/cli.js";
import { SHEET_HEIGHT, SHEET_WIDTH, canonicalJson, exportCreature } from "../src/export.js";
import type { JsonValue } from "../src/export.js";
import { sampleBestiary } from "../src/genome.js";
import { GENERATOR_VERSION } from "../src/index.js";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const QA_PNG = join(REPO_ROOT, "qa", "sheet_mix_0_99.png");
const QA_JSON = join(REPO_ROOT, "qa", "sheet_mix_0_99.json");
const FIXTURE = join(REPO_ROOT, "tests", "goldens", "u6_mix_guard.txt");

/**
 * The pinned guard slice (design 07 §7.1): per plan the lowest seed
 * plus the lowest emitter-bearing seed, the plan's next-lowest seed
 * joining when those coincide (lev: seed 8 is both, so 9 joins — NOT
 * lev's next emitter seed 10, which carries no ornament and would
 * lose lev × ornament). Adjudicated by enumeration; the normative
 * regeneration property is full plan × {ornament, emitter} coverage
 * (see the header). Realized: quad {0, 11}, lev {8, 9}, amor {3, 4}.
 */
const GUARD_SLICE_SEEDS = [0, 11, 8, 9, 3, 4] as const;

/** Parse the fixture: lines of `key sha256hex`. */
function readFixture(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(FIXTURE, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const [key, sha] = line.split(" ");
    map.set(key!, sha!);
  }
  return map;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Decode a PNG written by the in-repo encoder (design 06 §6: one zlib
 * stream across the IDAT chunks, filter byte 0 on every scanline) back
 * to {width, height, rgba}. Asserts the encoder's own invariants — a
 * committed PNG violating them is not ours.
 */
function decodeSheetPng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const u32 = (off: number): number =>
    bytes[off]! * 0x1000000 + bytes[off + 1]! * 0x10000 + bytes[off + 2]! * 0x100 + bytes[off + 3]!;
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = u32(16);
  const height = u32(20);
  const idat: Uint8Array[] = [];
  let pos = 8;
  while (pos < bytes.length) {
    const len = u32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    if (type === "IDAT") idat.push(bytes.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + width * 4;
  expect(raw.length).toBe(stride * height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride], `scanline ${y} filter byte`).toBe(0);
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, rgba };
}

describe("qa guard — the pinned mix sheet (design 07 §7.1)", { timeout: 300000 }, () => {
  test("leg 1: full-manifest identity — 100 re-derived mix genomes byte-match the committed manifest", () => {
    const entries = buildMixManifestEntries(0, 99);
    // The manifest schema, transcribed from design 07 §7.1 (canonical
    // key order is sorted by canonicalJson; `mix: true` top-level;
    // entries carry self-describing plan/tags name strings).
    const manifest = canonicalJson({
      cell: { gutter: SHEET_GUTTER, h: SHEET_HEIGHT, w: SHEET_WIDTH },
      cols: 10,
      entries: entries.map(
        (e): JsonValue => ({
          col: e.col,
          dna: e.dna,
          plan: e.plan,
          row: e.row,
          seed: e.seed,
          tags: [...e.tags],
        }),
      ),
      generator_version: GENERATOR_VERSION,
      mix: true,
      rows: 10,
      seed_range: { from: 0, to: 99 },
    });
    expect(manifest).toBe(readFileSync(QA_JSON, "utf8"));
  });

  test("leg 2: 6-cell render slice — today's renderer output matches the fixture AND the committed PNG's pixels", () => {
    const fixture = readFixture();
    const png = decodeSheetPng(readFileSync(QA_PNG));
    expect(png.width).toBe(10 * SHEET_WIDTH + 9 * SHEET_GUTTER); // 1298
    expect(png.height).toBe(10 * SHEET_HEIGHT + 9 * SHEET_GUTTER); // 6418
    for (const seed of GUARD_SLICE_SEEDS) {
      const creature = exportCreature(sampleBestiary(BigInt(seed)));
      expect(creature.sheetRgbaSha256, `cell ${seed} vs fixture`).toBe(fixture.get(`cell:${seed}`));
      const row = Math.floor(seed / 10);
      const col = seed % 10;
      const x0 = col * (SHEET_WIDTH + SHEET_GUTTER);
      const y0 = row * (SHEET_HEIGHT + SHEET_GUTTER);
      for (let y = 0; y < SHEET_HEIGHT; y++) {
        const got = png.rgba.subarray(
          ((y0 + y) * png.width + x0) * 4,
          ((y0 + y) * png.width + x0) * 4 + SHEET_WIDTH * 4,
        );
        const want = creature.sheetRgba.subarray(y * SHEET_WIDTH * 4, (y + 1) * SHEET_WIDTH * 4);
        expect(Buffer.from(got).equals(Buffer.from(want)), `cell ${seed} row ${y}`).toBe(true);
      }
    }
  });

  test("leg 3: whole-file sha256 pins — every hash move is an explicit reviewed fixture diff", () => {
    const fixture = readFixture();
    expect(sha256(readFileSync(QA_PNG))).toBe(fixture.get("png:sheet_mix_0_99.png"));
    expect(sha256(readFileSync(QA_JSON, "utf8"))).toBe(fixture.get("json:sheet_mix_0_99.json"));
  });
});
