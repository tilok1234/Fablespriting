#!/usr/bin/env node
/**
 * Fablesprite — the contact-sheet CLI (`fablesprite sheet`), the ROADMAP
 * standing-practice human QA tool: pinned sheets re-render on every
 * grammar/craft change and get human review (constraint row 10 — the
 * flicker gate alone is not a quality gate).
 *
 * NOT normative rendering: the sheet composes the golden-tested
 * exportCreature() outputs (design 06 §6) into a review grid; no design
 * 06 semantics live here, and no goldens hash the composed sheet (it
 * re-renders on every template change BY DESIGN — it is a reviewed
 * artifact). The CLI contract is documented in README.md.
 *
 * `fablesprite sheet --seed-range A..B [--out DIR]` renders the sampled
 * genome of every seed in [A, B] (design 06 §4.2 sampler — sheet
 * identity is cross-implementation) to its full 128×256 export sheet,
 * composed 1× into a grid of G columns (G = ceil(√N), capped so the
 * output stays under ~4096 px wide) with a 2-px transparent gutter,
 * plus a sidecar canonical-JSON manifest mapping grid position →
 * {seed, dna} — positions stay identifiable without in-image text (no
 * font rendering in M1). Outputs `sheet_<A>_<B>.png` + `.json` in
 * --out (default ./out).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonValue } from "./export.js";
import { SHEET_HEIGHT, SHEET_WIDTH, canonicalJson, exportCreature } from "./export.js";
import { encodeGenome, sampleGenome } from "./genome.js";
import { GENERATOR_VERSION } from "./index.js";
import { encodePng } from "./png.js";

/** Transparent gutter between sheet cells, in pixels. */
export const SHEET_GUTTER = 2;

/**
 * Column cap: the composed sheet stays under ~4096 px wide —
 * cols·(128 + 2) − 2 ≤ 4096 ⇒ cols ≤ 31.
 */
export const MAX_SHEET_COLS = 31;

/** One placed genome of a contact sheet. */
export interface SheetEntry {
  readonly seed: number;
  readonly dna: string;
  readonly row: number;
  readonly col: number;
}

/** A built contact sheet: composed pixels + identifying manifest. */
export interface ContactSheet {
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  readonly entries: readonly SheetEntry[];
  /** The composed RGBA buffer (uncovered pixels exactly (0,0,0,0)). */
  readonly rgba: Uint8Array;
  /** PNG bytes of the composed sheet (the §6 encoder). */
  readonly png: Uint8Array;
  /** Canonical-JSON manifest (grid position → seed/dna), single line. */
  readonly manifest: string;
}

/**
 * Build the contact sheet for the inclusive seed range [from, to]:
 * renders each seed's sampled genome through the FULL pinned pipeline
 * (exportCreature) and composes the 128×256 export sheets row-major
 * into the gutter grid. Deterministic; ~1.2 s per genome (renders 32
 * frames each — a QA tool, not a hot path).
 */
export function buildContactSheet(from: number, to: number): ContactSheet {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    throw new RangeError(`cli: bad seed range ${from}..${to} (need 0 ≤ from ≤ to, safe integers)`);
  }
  const n = to - from + 1;
  const cols = Math.min(Math.ceil(Math.sqrt(n)), MAX_SHEET_COLS);
  const rows = Math.ceil(n / cols);
  const width = cols * SHEET_WIDTH + (cols - 1) * SHEET_GUTTER;
  const height = rows * SHEET_HEIGHT + (rows - 1) * SHEET_GUTTER;
  const rgba = new Uint8Array(width * height * 4); // transparent
  const entries: SheetEntry[] = [];

  for (let i = 0; i < n; i++) {
    const seed = from + i;
    const row = Math.floor(i / cols);
    const col = i % cols;
    const genome = sampleGenome(BigInt(seed));
    const creature = exportCreature(genome);
    const x0 = col * (SHEET_WIDTH + SHEET_GUTTER);
    const y0 = row * (SHEET_HEIGHT + SHEET_GUTTER);
    for (let y = 0; y < SHEET_HEIGHT; y++) {
      const src = y * SHEET_WIDTH * 4;
      const dst = ((y0 + y) * width + x0) * 4;
      rgba.set(creature.sheetRgba.subarray(src, src + SHEET_WIDTH * 4), dst);
    }
    entries.push(Object.freeze({ seed, dna: encodeGenome(genome), row, col }));
  }

  const manifest = canonicalJson({
    cell: { gutter: SHEET_GUTTER, h: SHEET_HEIGHT, w: SHEET_WIDTH },
    cols,
    entries: entries.map((e): JsonValue => ({ col: e.col, dna: e.dna, row: e.row, seed: e.seed })),
    generator_version: GENERATOR_VERSION,
    rows,
    seed_range: { from, to },
  });

  return Object.freeze({
    width,
    height,
    cols,
    rows,
    entries: Object.freeze(entries),
    rgba,
    png: encodePng(rgba, width, height),
    manifest,
  });
}

const USAGE = `usage: fablesprite sheet --seed-range A..B [--out DIR]
  Renders sampled genomes for every seed in the inclusive range A..B and
  composes their 128x256 export sheets into one contact-sheet PNG plus a
  JSON manifest (grid position -> seed/dna). Writes sheet_<A>_<B>.png and
  sheet_<A>_<B>.json into DIR (default ./out). ~1.2 s per genome.`;

/** Parse `--flag value` / `--flag=value` pairs after the subcommand. */
function parseFlags(args: readonly string[]): Map<string, string> | null {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) return null;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flags.set(arg.slice(0, eq), arg.slice(eq + 1));
    } else {
      const value = args[i + 1];
      if (value === undefined) return null;
      flags.set(arg, value);
      i++;
    }
  }
  return flags;
}

/**
 * CLI entry: returns the process exit code (0 ok, 2 usage error).
 * Separated from the argv/exit plumbing so tests invoke it directly.
 */
export function main(argv: readonly string[]): number {
  if (argv[0] !== "sheet") {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  const flags = parseFlags(argv.slice(1));
  const range = flags?.get("--seed-range");
  const rangeMatch = range === undefined ? null : /^(\d+)\.\.(\d+)$/.exec(range);
  if (!flags || !rangeMatch) {
    process.stderr.write(USAGE + "\n");
    return 2;
  }
  for (const key of flags.keys()) {
    if (key !== "--seed-range" && key !== "--out") {
      process.stderr.write(`unknown flag ${key}\n${USAGE}\n`);
      return 2;
    }
  }
  const from = Number(rangeMatch[1]);
  const to = Number(rangeMatch[2]);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) {
    process.stderr.write(`bad --seed-range ${range}: need integers A ≤ B\n`);
    return 2;
  }
  const outDir = resolve(flags.get("--out") ?? "./out");

  const t0 = Date.now();
  const sheet = buildContactSheet(from, to);
  const renderMs = Date.now() - t0;

  mkdirSync(outDir, { recursive: true });
  const base = `sheet_${from}_${to}`;
  const pngPath = join(outDir, `${base}.png`);
  const jsonPath = join(outDir, `${base}.json`);
  writeFileSync(pngPath, sheet.png);
  writeFileSync(jsonPath, sheet.manifest, "utf8");

  process.stdout.write(
    `${sheet.entries.length} genomes → ${sheet.cols}×${sheet.rows} grid ` +
      `(${sheet.width}×${sheet.height} px) in ${(renderMs / 1000).toFixed(1)} s\n` +
      `${pngPath}\n${jsonPath}\n`,
  );
  return 0;
}

// Run only when executed as the entry script (bin/`node dist/cli.js`),
// never on import (tests import buildContactSheet/main directly).
const entry = process.argv[1];
if (
  entry !== undefined &&
  resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
) {
  process.exit(main(process.argv.slice(2)));
}
