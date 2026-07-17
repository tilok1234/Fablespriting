#!/usr/bin/env node
/**
 * Fablesprite — the contact-sheet CLI (`fablesprite sheet`), the ROADMAP
 * standing-practice human QA tool: pinned sheets re-render on every
 * grammar/craft change and get human review (constraint row 10 — the
 * flicker gate alone is not a quality gate).
 *
 * NOT normative rendering: the sheet composes the golden-tested
 * exportCreature() outputs (design 06 §6) into a review grid; no design
 * 06 semantics live here. The M1-era "no goldens hash the composed
 * sheet" note is superseded FOR MIX SHEETS by the design 07 §7 guard
 * law (U6): tests/qa-guard.test.ts hash-compares the committed
 * qa/sheet_mix_0_99.* on every run — a hash move without a reviewed
 * regeneration commit fails CI. Plain (non-mix) sheets keep the M1
 * rule: reviewed artifacts, never byte-pinned. The CLI contract is
 * documented in README.md.
 *
 * `fablesprite sheet --seed-range A..B [--mix] [--out DIR]` renders the
 * sampled genome of every seed in [A, B] (design 06 §4.2 sampler —
 * sheet identity is cross-implementation; with --mix the U6
 * sampleBestiary mix, design 07 §7.1) to its full 128×640 export sheet,
 * composed 1× into a grid of G columns (G = ceil(√N), capped so the
 * output stays under ~4096 px wide) with a 2-px transparent gutter,
 * plus a sidecar canonical-JSON manifest mapping grid position →
 * {seed, dna} (mix sheets add per-cell plan/tags — self-describing) —
 * positions stay identifiable without in-image text (no font rendering
 * in M1). Outputs `sheet_<A>_<B>.png` + `.json` (mix:
 * `sheet_mix_<A>_<B>.*`) in --out (default ./out).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CreatureExport, JsonValue } from "./export.js";
import { SHEET_HEIGHT, SHEET_WIDTH, canonicalJson, exportCreature } from "./export.js";
import type { SampleGenomeOpts } from "./genome.js";
import {
  PLAN_NAMES,
  TRAIT_TAG_NAMES,
  decodeGenome,
  encodeGenome,
  sampleBestiary,
  sampleGenome,
} from "./genome.js";
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

/**
 * One placed genome of a MIX contact sheet (design 07 §7.1): the mix
 * manifest is self-describing twice over — the human-readable plan/tags
 * name strings AND the dna string (mix genomes encode plan, seed, tags,
 * and every drawn value explicitly; decode-and-render reproduces any
 * cell with no knowledge of the mix).
 */
export interface MixSheetEntry extends SheetEntry {
  /** The drawn plan, as its {@link PLAN_NAMES} string. */
  readonly plan: string;
  /** The drawn tag set, as {@link TRAIT_TAG_NAMES} strings, ascending tag id. */
  readonly tags: readonly string[];
}

/** Grid columns for an n-cell sheet: ceil(√n), capped at {@link MAX_SHEET_COLS}. */
function sheetCols(n: number): number {
  return Math.min(Math.ceil(Math.sqrt(n)), MAX_SHEET_COLS);
}

/**
 * The mix manifest entries of the inclusive seed range [from, to] —
 * sample + encode only, NO render (design 07 §7.1): every seed through
 * {@link sampleBestiary}, placed row-major on the {@link sheetCols}
 * grid. Exported for the CI hash guard (tests/qa-guard.test.ts
 * re-derives the committed qa/sheet_mix_0_99.json from it, observed
 * 3.6–4.0 s for 100 genomes on a quiet machine, 2026-07-17);
 * {@link buildContactSheet}'s mix path consumes it too,
 * so the manifest is single-sourced.
 */
export function buildMixManifestEntries(from: number, to: number): readonly MixSheetEntry[] {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    throw new RangeError(`cli: bad seed range ${from}..${to} (need 0 ≤ from ≤ to, safe integers)`);
  }
  const n = to - from + 1;
  const cols = sheetCols(n);
  const entries: MixSheetEntry[] = [];
  for (let i = 0; i < n; i++) {
    const seed = from + i;
    const genome = sampleBestiary(BigInt(seed));
    const plan = genome.values.get(0) ?? 0;
    entries.push(
      Object.freeze({
        seed,
        dna: encodeGenome(genome),
        row: Math.floor(i / cols),
        col: i % cols,
        plan: PLAN_NAMES[plan]!,
        tags: Object.freeze(genome.traitTags.map((t) => TRAIT_TAG_NAMES[t]!)),
      }),
    );
  }
  return Object.freeze(entries);
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
 * (exportCreature) and composes the 128×640 export sheets row-major
 * into the gutter grid. A numeric `planOrMix` forces every sampled
 * genome onto that plan (design 07 §2.3.1 D-a: plan is a sampler
 * parameter, default quadruped — the U3 mini-sheet instrument);
 * `"mix"` (U6, design 07 §7.1) samples every seed through
 * {@link sampleBestiary} instead — plan and mix are structurally
 * exclusive in the one parameter slot, and `"mix"` with `opts` throws
 * (--plan/--tags/--preset force what mix draws; silent precedence
 * would lie about the sheet's provenance). Mix cells render from
 * `decodeGenome(entry.dna)` — the manifest is single-sourced from
 * {@link buildMixManifestEntries} and the DNA round-trip law makes the
 * decoded render identical. Deterministic; a few seconds per genome
 * (renders 72 frames each — a QA tool, not a hot path).
 */
export function buildContactSheet(
  from: number,
  to: number,
  planOrMix: number | "mix" = 0,
  opts?: SampleGenomeOpts,
): ContactSheet {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) {
    throw new RangeError(`cli: bad seed range ${from}..${to} (need 0 ≤ from ≤ to, safe integers)`);
  }
  const mix = planOrMix === "mix";
  if (mix && opts !== undefined) {
    throw new RangeError("cli: mix mode takes no sampler opts (plan/tags are drawn, not forced)");
  }
  const plan = mix ? 0 : (planOrMix as number);
  if (!mix && (!Number.isInteger(plan) || plan < 0 || plan >= PLAN_NAMES.length)) {
    throw new RangeError(`cli: bad plan ${String(planOrMix)} (0..${PLAN_NAMES.length - 1} or "mix")`);
  }
  const n = to - from + 1;
  const cols = sheetCols(n);
  const rows = Math.ceil(n / cols);
  const width = cols * SHEET_WIDTH + (cols - 1) * SHEET_GUTTER;
  const height = rows * SHEET_HEIGHT + (rows - 1) * SHEET_GUTTER;
  const rgba = new Uint8Array(width * height * 4); // transparent
  const mixEntries = mix ? buildMixManifestEntries(from, to) : undefined;
  const entries: SheetEntry[] = [];

  for (let i = 0; i < n; i++) {
    const seed = from + i;
    const row = Math.floor(i / cols);
    const col = i % cols;
    let dna: string;
    let creature: CreatureExport;
    if (mixEntries !== undefined) {
      const entry = mixEntries[i]!;
      dna = entry.dna;
      creature = exportCreature(decodeGenome(dna));
      entries.push(entry);
    } else {
      const genome = sampleGenome(BigInt(seed), plan, opts);
      dna = encodeGenome(genome);
      creature = exportCreature(genome);
      entries.push(Object.freeze({ seed, dna, row, col }));
    }
    const x0 = col * (SHEET_WIDTH + SHEET_GUTTER);
    const y0 = row * (SHEET_HEIGHT + SHEET_GUTTER);
    for (let y = 0; y < SHEET_HEIGHT; y++) {
      const src = y * SHEET_WIDTH * 4;
      const dst = ((y0 + y) * width + x0) * 4;
      rgba.set(creature.sheetRgba.subarray(src, src + SHEET_WIDTH * 4), dst);
    }
  }

  // The manifest gains `plan`/`tags`/`preset` keys ONLY when supplied
  // (the defaults-absent house rule, design 06 §3.2's spirit): the
  // committed qa/sheet_0_49.json stays byte-intact without a re-pin
  // (design 07 §2.3.1 D-a consequence; the U5 mode keys follow the same
  // law — design 07 §6.1), while forced mini-sheets self-identify. Mix
  // sheets (U6, design 07 §7.1) gain top-level `mix: true` (absent on
  // non-mix sheets) and per-entry plan/tags name strings; the
  // plan/tags/preset keys never co-occur with `mix` (excluded at parse).
  const manifest = canonicalJson({
    cell: { gutter: SHEET_GUTTER, h: SHEET_HEIGHT, w: SHEET_WIDTH },
    cols,
    entries: mixEntries
      ? mixEntries.map(
          (e): JsonValue => ({
            col: e.col,
            dna: e.dna,
            plan: e.plan,
            row: e.row,
            seed: e.seed,
            tags: [...e.tags],
          }),
        )
      : entries.map((e): JsonValue => ({ col: e.col, dna: e.dna, row: e.row, seed: e.seed })),
    generator_version: GENERATOR_VERSION,
    ...(mix ? { mix: true } : {}),
    ...(plan === 0 ? {} : { plan: PLAN_NAMES[plan]! }),
    ...(opts?.preset === undefined ? {} : { preset: opts.preset }),
    rows,
    seed_range: { from, to },
    ...(opts?.tags === undefined ? {} : { tags: opts.tags.map((t) => TRAIT_TAG_NAMES[t]!) }),
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

const USAGE = `usage: fablesprite sheet --seed-range A..B [--plan quadruped|levitant|amorphous]
                        [--tags T1[,T2]] [--preset speed|armor|ranged]
                        [--mix] [--out DIR]
  Renders sampled genomes for every seed in the inclusive range A..B and
  composes their 128x640 export sheets into one contact-sheet PNG plus a
  JSON manifest (grid position -> seed/dna). --plan forces every sampled
  genome onto that plan (default quadruped). --tags forces the trait-tag
  set (at most 2 distinct names of chitin, fleshy, spectral, mechanical,
  verdant) and --preset applies an FFF prior preset - both open the U5
  sampler modes (design 07 s6.1). --mix (U6, design 07 s7.1) samples the
  DEFAULT BESTIARY MIX instead: plan drawn per seed on the reserved
  meta.plan stream, tags drawn and gating - mutually exclusive with
  --plan/--tags/--preset (they force what mix draws). Writes
  sheet_<A>_<B>.png and sheet_<A>_<B>.json (mix: sheet_mix_<A>_<B>.*)
  into DIR (default ./out). A few seconds per genome.`;

/**
 * Valueless boolean flags (design 07 §7.1): never consume a following
 * token; `--flag=x` is a usage error.
 */
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set(["--mix"]);

/**
 * Parse `--flag value` / `--flag=value` pairs after the subcommand;
 * {@link BOOLEAN_FLAGS} take no value and map to "".
 */
function parseFlags(args: readonly string[]): Map<string, string> | null {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) return null;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      if (BOOLEAN_FLAGS.has(arg.slice(0, eq))) return null; // --mix=x is a usage error
      flags.set(arg.slice(0, eq), arg.slice(eq + 1));
    } else if (BOOLEAN_FLAGS.has(arg)) {
      flags.set(arg, "");
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
    if (
      key !== "--seed-range" &&
      key !== "--out" &&
      key !== "--plan" &&
      key !== "--tags" &&
      key !== "--preset" &&
      key !== "--mix"
    ) {
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
  // --mix is mutually exclusive with the forcing flags (design 07 §7.1):
  // --plan/--tags/--preset force exactly what mix draws; silent
  // precedence would lie about the sheet's provenance.
  const mix = flags.has("--mix");
  if (mix) {
    const conflicts = ["--plan", "--tags", "--preset"].filter((f) => flags.has(f));
    if (conflicts.length > 0) {
      process.stderr.write(
        `--mix cannot be combined with ${conflicts.join(", ")} (mix draws plan and tags; forcing them contradicts the mix)\n${USAGE}\n`,
      );
      return 2;
    }
  }
  const planName = flags.get("--plan") ?? "quadruped";
  const plan = (PLAN_NAMES as readonly string[]).indexOf(planName);
  if (plan < 0) {
    process.stderr.write(`bad --plan ${planName}: known plans are ${PLAN_NAMES.join(", ")}\n${USAGE}\n`);
    return 2;
  }
  // U5 sampler-mode flags (design 07 §6.1): tags by name, comma-
  // separated, at most 2, distinct; unknown names are usage errors.
  let opts: SampleGenomeOpts | undefined;
  const tagsFlag = flags.get("--tags");
  let tags: number[] | undefined;
  if (tagsFlag !== undefined) {
    tags = [];
    for (const name of tagsFlag.split(",")) {
      const tag = (TRAIT_TAG_NAMES as readonly string[]).indexOf(name);
      if (tag < 0) {
        process.stderr.write(
          `bad --tags ${tagsFlag}: known tags are ${TRAIT_TAG_NAMES.join(", ")}\n${USAGE}\n`,
        );
        return 2;
      }
      if (tags.includes(tag)) {
        process.stderr.write(`bad --tags ${tagsFlag}: duplicate tag ${name}\n${USAGE}\n`);
        return 2;
      }
      tags.push(tag);
    }
    if (tags.length > 2) {
      process.stderr.write(`bad --tags ${tagsFlag}: at most 2 tags\n${USAGE}\n`);
      return 2;
    }
  }
  const presetFlag = flags.get("--preset");
  if (presetFlag !== undefined && presetFlag !== "speed" && presetFlag !== "armor" && presetFlag !== "ranged") {
    process.stderr.write(`bad --preset ${presetFlag}: known presets are speed, armor, ranged\n${USAGE}\n`);
    return 2;
  }
  if (tags !== undefined || presetFlag !== undefined) {
    opts = {
      ...(tags === undefined ? {} : { tags }),
      ...(presetFlag === undefined ? {} : { preset: presetFlag }),
    };
  }
  const outDir = resolve(flags.get("--out") ?? "./out");

  const t0 = Date.now();
  const sheet = buildContactSheet(from, to, mix ? "mix" : plan, opts);
  const renderMs = Date.now() - t0;

  mkdirSync(outDir, { recursive: true });
  const base = mix ? `sheet_mix_${from}_${to}` : `sheet_${from}_${to}`;
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
