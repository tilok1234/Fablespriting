import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { MAX_SHEET_COLS, SHEET_GUTTER, buildContactSheet, main } from "../src/cli.js";
import { SHEET_HEIGHT, SHEET_WIDTH, exportCreature } from "../src/export.js";
import { encodeGenome, sampleGenome } from "../src/genome.js";

// ---------------------------------------------------------------------------
// The contact-sheet CLI is a QA tool, NOT normative rendering — it
// composes golden-tested exportCreature outputs (design 06 §6). These
// tests are smoke coverage of the composition + manifest contract
// documented in README.md; no hashes are pinned (pinned QA sheets in
// qa/ re-render on every grammar/craft change BY DESIGN).
// ---------------------------------------------------------------------------

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const DIST_CLI = join(REPO_ROOT, "dist", "cli.js");

/** Big-endian u32 at `off` (PNG header fields). */
function u32be(bytes: Uint8Array, off: number): number {
  return bytes[off]! * 0x1000000 + bytes[off + 1]! * 0x10000 + bytes[off + 2]! * 0x100 + bytes[off + 3]!;
}

describe("buildContactSheet (seeds 0..3)", { timeout: 120000 }, () => {
  const sheet = buildContactSheet(0, 3);

  test("grid geometry: 2×2 cells with 2-px gutters", () => {
    expect(sheet.cols).toBe(2);
    expect(sheet.rows).toBe(2);
    expect(sheet.width).toBe(2 * SHEET_WIDTH + SHEET_GUTTER);
    expect(sheet.height).toBe(2 * SHEET_HEIGHT + SHEET_GUTTER);
    expect(sheet.rgba.length).toBe(sheet.width * sheet.height * 4);
  });

  test("PNG parses: signature and IHDR dimensions", () => {
    const png = sheet.png;
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: length at 8, type at 12, width at 16, height at 20.
    expect(u32be(png, 8)).toBe(13);
    expect([...png.subarray(12, 16)]).toEqual([0x49, 0x48, 0x44, 0x52]); // "IHDR"
    expect(u32be(png, 16)).toBe(sheet.width);
    expect(u32be(png, 20)).toBe(sheet.height);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(6); // color type RGBA
  });

  test("manifest maps grid positions to seed/dna (row-major, seed order)", () => {
    const manifest = JSON.parse(sheet.manifest) as {
      cell: { gutter: number; h: number; w: number };
      cols: number;
      rows: number;
      entries: { col: number; dna: string; row: number; seed: number }[];
      seed_range: { from: number; to: number };
    };
    expect(manifest.cell).toEqual({ gutter: SHEET_GUTTER, h: SHEET_HEIGHT, w: SHEET_WIDTH });
    expect(manifest.cols).toBe(2);
    expect(manifest.rows).toBe(2);
    expect(manifest.seed_range).toEqual({ from: 0, to: 3 });
    expect(manifest.entries).toHaveLength(4);
    manifest.entries.forEach((entry, i) => {
      expect(entry.seed).toBe(i);
      expect(entry.row).toBe(Math.floor(i / 2));
      expect(entry.col).toBe(i % 2);
      expect(entry.dna).toBe(encodeGenome(sampleGenome(BigInt(i))));
    });
  });

  test("cell (0,0) is byte-identical to seed 0's export sheet; gutters transparent", () => {
    const creature = exportCreature(sampleGenome(0n));
    for (let y = 0; y < SHEET_HEIGHT; y++) {
      const row = sheet.rgba.subarray(y * sheet.width * 4, y * sheet.width * 4 + SHEET_WIDTH * 4);
      const want = creature.sheetRgba.subarray(y * SHEET_WIDTH * 4, (y + 1) * SHEET_WIDTH * 4);
      expect(row, `row ${y}`).toEqual(want);
      // The 2-px gutter to the right of cell (0,0) stays (0,0,0,0).
      for (let gx = SHEET_WIDTH; gx < SHEET_WIDTH + SHEET_GUTTER; gx++) {
        const p = (y * sheet.width + gx) * 4;
        expect(sheet.rgba[p]! | sheet.rgba[p + 1]! | sheet.rgba[p + 2]! | sheet.rgba[p + 3]!).toBe(0);
      }
    }
  });

  test("bad ranges throw", () => {
    expect(() => buildContactSheet(3, 2)).toThrow(RangeError);
    expect(() => buildContactSheet(-1, 2)).toThrow(RangeError);
    expect(() => buildContactSheet(0.5, 2)).toThrow(RangeError);
  });

  test("column cap keeps sheets under ~4096 px wide", () => {
    expect(MAX_SHEET_COLS * (SHEET_WIDTH + SHEET_GUTTER) - SHEET_GUTTER).toBeLessThanOrEqual(4096);
  });
});

describe("--plan (design 07 §2.3.1 D-a: the U3 mini-sheet instrument)", { timeout: 120000 }, () => {
  test("plan-forced sheet: levitant DNA in entries, plan key in the manifest", () => {
    const sheet = buildContactSheet(0, 0, 1);
    expect(sheet.entries[0]!.dna).toBe(encodeGenome(sampleGenome(0n, 1)));
    const manifest = JSON.parse(sheet.manifest) as { plan?: string };
    expect(manifest.plan).toBe("levitant");
    // Cell (0,0) is byte-identical to the levitant export sheet.
    const creature = exportCreature(sampleGenome(0n, 1));
    expect(Buffer.from(sheet.rgba.subarray(0, SHEET_WIDTH * 4)).equals(
      Buffer.from(creature.sheetRgba.subarray(0, SHEET_WIDTH * 4)),
    )).toBe(true);
  });

  test("the default-plan manifest carries NO plan key (qa/sheet_0_49.json stays byte-intact)", () => {
    const sheet = buildContactSheet(0, 0);
    expect("plan" in (JSON.parse(sheet.manifest) as object)).toBe(false);
  });

  test("bad --plan is a usage error (exit 2), before any rendering", () => {
    const errs: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      errs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(main(["sheet", "--seed-range", "0..0", "--plan", "serpentine"])).toBe(2);
    } finally {
      process.stderr.write = orig;
    }
    expect(errs.join("")).toContain("bad --plan");
    expect(() => buildContactSheet(0, 0, 3)).toThrow(RangeError);
  });
});

describe("bin entry (subprocess)", () => {
  // The bin needs the tsc build (Node 24's type stripping does not remap
  // the sources' .js specifiers onto .ts files — README "Contact-sheet
  // CLI"); this spawn test runs only where dist/cli.js exists (CI builds
  // before testing; locally run `npm run build` first).
  test.skipIf(!existsSync(DIST_CLI))("sheet --seed-range 0..0 writes PNG + manifest", { timeout: 120000 }, () => {
    const outDir = mkdtempSync(join(tmpdir(), "fablesprite-cli-"));
    try {
      const result = spawnSync(process.execPath, [DIST_CLI, "sheet", "--seed-range", "0..0", "--out", outDir], {
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const png = readFileSync(join(outDir, "sheet_0_0.png"));
      expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(u32be(png, 16)).toBe(SHEET_WIDTH); // one cell, no gutter
      expect(u32be(png, 20)).toBe(SHEET_HEIGHT);
      const manifest = JSON.parse(readFileSync(join(outDir, "sheet_0_0.json"), "utf8")) as {
        entries: { seed: number }[];
      };
      expect(manifest.entries).toHaveLength(1);
      expect(manifest.entries[0]!.seed).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test.skipIf(!existsSync(DIST_CLI))("usage error exits 2", { timeout: 60000 }, () => {
    const result = spawnSync(process.execPath, [DIST_CLI, "nonsense"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("usage:");
  });
});
