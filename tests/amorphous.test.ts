/**
 * U4 — the amorphous plan and the metaball renderer fork (design 07
 * §2.4.1): registry append 47–50 + plan-2 scoping, the amorphous grammar
 * (visible-radius authoring per F8, the eye forward floor), the gait
 * template (hop-squash walk, breathing idle — the multiplicative-extents
 * mechanism), envelopes incl. the DEFLATE death, THE FORK (fp field
 * march inside rasterize: same tags, same serialization, slab and field
 * paths coexisting), wire behavior (AQAE, size bounds), the three-column
 * semantic map, the amorphous goldens, and the scaled CI corpora
 * (flicker gates, eye visibility, craft property suite + idempotence).
 *
 * Oracle provenance: the pose vectors in
 * tests/goldens/amorphous_pose_oracle.v2.json were computed by an
 * independent from-spec Python oracle (scratchpad
 * u4-verify/amorphous_pose_oracle.py, 2026-07-16 — reimplements the
 * design 06 §5 fixed-point kernel, the §5.3 LUT from its defining
 * formula, the design 07 §2.4.1 geometry/oscillators/envelopes from the
 * adjudicated U4 spec plus the implementation-evidence amendments: the
 * wide-pose skirt floor and the one-chain face merge), NEVER by running
 * this implementation. The amorphous golden hashes were pinned only
 * AFTER the M1 provenance ritual (2026-07-16, re-run from scratch after
 * the visibility repair landed): PIL pixel-compare of the sheet PNG
 * against the raw RGBA, an independent Python JSON re-canonicalization
 * (byte-identical), all 72 hitboxes exact-matched by a from-spec Python
 * snap+hitbox oracle (one-chain table), every sha256 recomputed in
 * Python, and two consecutive renders byte-identical.
 * Defaults-reproduce-slime() evidence: the fp fork exact-matched the
 * FLOAT spike renderer pixel for pixel — 0 silhouette / role / tone
 * differences over all 32 walk+idle × phase × direction cells (3706
 * opaque pixels, offset-free grids so the chain merge does not touch
 * them) — re-verified at the resume audit before the final pins.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { craftClip, rule2Orphan, rule3Jaggy, snapOffsets } from "../src/craft.js";
import { FP_ONE, asr, fp_add, fp_div, fp_mul, fp_sqrt, fp_sub, rheDiv } from "../src/fixed.js";
import { exportCreature, sha256Hex } from "../src/export.js";
import { measureClipFlicker, renderClipCells } from "../src/flicker.js";
import {
  ANIM_SEMANTIC_MAP,
  LOCUS_SCOPES,
  PLAN_NAMES,
  REGISTRY,
  decodeGenome,
  encodeGenome,
  getScalar,
  locusByPath,
  makeGenome,
  sampleGenome,
} from "../src/genome.js";
import type { Genome, ScalarLocus } from "../src/genome.js";
import {
  AMORPHOUS_PLAN,
  AMORPHOUS_WEIGHTS,
  BALL_FROM_VIS,
  VIS_RATIO,
  deriveAmorphousAnchors,
  growAmorphous,
} from "../src/grammar.js";
import {
  AMORPHOUS_CHAINS,
  AMORPHOUS_PART_NAMES,
  AMORPHOUS_PART_ROLES,
} from "../src/wires.js";
import {
  CLIP_KS,
  clipPhases,
  growCreature,
  poseAmorphous,
  poseCreature,
} from "../src/pose.js";
import type { ClipName, Slab } from "../src/pose.js";
import {
  BISECT_ITERS,
  DIRECTIONS,
  FIELD_TH_RAW,
  MARCH_STEP,
  SAMPLE_OFFSETS,
  TILT_RAW,
  rasterize,
  serializeRasterGrid,
} from "../src/raster.js";

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./goldens/${name}`, import.meta.url));

/** All-defaults amorphous: the plan entry is the only non-default. */
const AMO_DEFAULTS = makeGenome({ values: [["meta.plan", 2]] });

const ALL_CLIPS: readonly ClipName[] = ["walk", "idle", "attack", "hurt", "death"];

// ---------------------------------------------------------------------------
// Registry append (ids 47–50), plan enum, scopes, semantic map
// ---------------------------------------------------------------------------

describe("U4 registry append — ids 47–50, plan enum, scopes", () => {
  test("the 4 amorphous loci transcribe the adjudicated table exactly", () => {
    const rows: ReadonlyArray<[number, string, string, number, number, number]> = [
      [47, "anim.amorphous.pulse_freq", "int", 1, 2, 1],
      [48, "anim.amorphous.squash_amp", "fp", 0, 13107, 9830],
      [49, "anim.amorphous.ball_phase_delta", "fp", 0, 16384, 13559],
      [50, "anim.amorphous.anticipation", "fp", 32768, 131072, 65536],
    ];
    for (const [id, path, kind, lo, hi, dflt] of rows) {
      const locus = REGISTRY[id] as ScalarLocus;
      expect([locus.id, locus.path, locus.kind, locus.lo, locus.hi, locus.defaultRaw], path).toEqual(
        [id, path, kind, lo, hi, dflt],
      );
    }
  });

  test("meta.plan extends to {quadruped = 0, levitant = 1, amorphous = 2}", () => {
    const plan = REGISTRY[0] as ScalarLocus;
    expect([plan.kind, plan.lo, plan.hi, plan.defaultRaw]).toEqual(["enum", 0, 2, 0]);
    expect(PLAN_NAMES).toEqual(["quadruped", "levitant", "amorphous"]);
  });

  test("scope sets: quadruped/levitant FROZEN, amorphous = {47–50}, gated = {51–55} (U5 H3), every id in exactly one scope", () => {
    expect([...LOCUS_SCOPES.amorphous].sort((a, b) => a - b)).toEqual([47, 48, 49, 50]);
    // U5 (design 07 §6.1): the gated scope is in NO plan's default draw
    // set — the H3 anchor-razor pin (no sampled seed re-rolls).
    expect([...LOCUS_SCOPES.gated].sort((a, b) => a - b)).toEqual([51, 52, 53, 54, 55]);
    // The existing scopes DO NOT MOVE (design 07 §2.4.1 D-a).
    expect([...LOCUS_SCOPES.shared].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 13, 14, 15,
    ]);
    expect([...LOCUS_SCOPES.quadruped].sort((a, b) => a - b)).toEqual([
      7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
      33, 34, 35,
    ]);
    expect([...LOCUS_SCOPES.levitant].sort((a, b) => a - b)).toEqual([
      36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46,
    ]);
    const seen = new Map<number, string>();
    for (const [name, ids] of Object.entries(LOCUS_SCOPES)) {
      for (const id of ids) {
        expect(seen.has(id), `id ${id} in both ${seen.get(id)} and ${name}`).toBe(false);
        seen.set(id, name);
      }
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(REGISTRY.map((l) => l.id));
  });

  test("three-column anim semantic map: integrity, all four amorphous loci mapped, tail_amp row absent", () => {
    const seen: Record<string, Set<string>> = { quadruped: new Set(), levitant: new Set(), amorphous: new Set() };
    for (const entry of ANIM_SEMANTIC_MAP) {
      for (const side of ["quadruped", "levitant", "amorphous"] as const) {
        const path = entry[side];
        if (path === undefined) continue; // absent = unmapped for that plan
        expect(path.startsWith(`anim.${side}.`), path).toBe(true);
        expect(locusByPath(path), path).toBeDefined();
        expect(seen[side]!.has(path), `duplicate ${side} endpoint ${path}`).toBe(false);
        seen[side]!.add(path);
      }
    }
    expect(ANIM_SEMANTIC_MAP.length).toBe(5);
    expect([...seen.amorphous!].sort()).toEqual([
      "anim.amorphous.anticipation",
      "anim.amorphous.ball_phase_delta",
      "anim.amorphous.pulse_freq",
      "anim.amorphous.squash_amp",
    ]);
    // The tail_amp ↔ tendril_amp row has NO amorphous member (recorded).
    const tailRow = ANIM_SEMANTIC_MAP.find((e) => e.quadruped === "anim.quadruped.tail_amp")!;
    expect(tailRow.amorphous).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Wire (design 07 §2.4.1 D-a/D-l): AQAE, size bounds, committed-build DNA
// ---------------------------------------------------------------------------

describe("U4 wire behavior", () => {
  test("all-defaults amorphous tape is exactly AQAE (bytes 01 00 04), both directions", () => {
    expect(encodeGenome(AMO_DEFAULTS)).toBe("AQAE");
    expect([...Buffer.from("AQAE", "base64url")]).toEqual([1, 0, 4]);
    const g = decodeGenome("AQAE");
    expect(getScalar(g, "meta.plan")).toBe(2);
    expect(g.seed).toBe(0n);
    expect(g.traitTags).toEqual([]);
    expect(g.values.size).toBe(1);
  });

  test("amorphous sampler-reachable worst: 60 bytes = 80 chars (plan + max seed + tags + shared + ids 47–50)", () => {
    const worst: Array<readonly [number, number]> = [[0, 2]];
    for (const locus of REGISTRY) {
      if (locus.kind === "u64" || locus.kind === "tagset") continue;
      if (locus.id === 0) continue;
      if (!LOCUS_SCOPES.shared.has(locus.id) && !LOCUS_SCOPES.amorphous.has(locus.id)) continue;
      const candidates = [locus.lo, locus.hi].filter((v) => v !== locus.defaultRaw);
      if (candidates.length === 0) continue;
      // costlier delta = larger |zigzag|; both ends same uvarint class or
      // the larger-magnitude delta wins.
      let best = candidates[0]!;
      for (const c of candidates) {
        const zz = (d: number): number => (d >= 0 ? 2 * d : -2 * d - 1);
        if (zz(c - locus.defaultRaw) > zz(best - locus.defaultRaw)) best = c;
      }
      worst.push([locus.id, best]);
    }
    const g = makeGenome({ seed: (1n << 64n) - 1n, traitTags: [3, 4], values: worst });
    const text = encodeGenome(g);
    expect(Buffer.from(text, "base64url").length).toBe(60);
    expect(text.length).toBe(80);
    expect(text.length).toBeLessThanOrEqual(200); // design 01 req 4 holds for every sampler-reachable genome
    expect(encodeGenome(decodeGenome(text))).toBe(text);
  });

  test("sampled quadruped AND levitant DNA byte-identical to the committed U3-close build (scopes did not move)", () => {
    // Strings machine-generated from the COMMITTED build (4e1e0aa, the
    // U3 close; genome.ts identical to c5b2ea2) before U4 touched
    // genome.ts — NOT from this tree's sampler.
    const LEV_DNA: ReadonlyArray<[bigint, string]> = [
      [0n, "AQACAgECA8S0nQEEl9uYAgWIEQYCDdjbCQ7rEg-5lwYlgscBJgEnuTgojUEpqEQqyvAEK8pwLOPsAy39Cy7xuwM"],
      [1n, "AQACAQECAgABA76YgwwE1sKeAQWTFAYBDZSZEQ618wgPnMwIJfHrAiYBJ9VsKJPyAymp2AIqgY4DK4SJAyyczQUtgOUBLrYW"],
      [7n, "AQACAQcCAQAD4paCBwSHtMkCBdcZBgENtNcWDoqOEA-n8gYkAiX8rgUmAyfnOiitnQopkPIBKug0K67uASy42wEt1MwBLommAw"],
    ];
    for (const [seed, dna] of LEV_DNA) {
      expect(encodeGenome(sampleGenome(seed, 1)), `levitant seed ${seed}`).toBe(dna);
    }
    // The quadruped strings are pinned in levitant.test.ts (the U2 pin);
    // spot-assert one here so this file also fails loudly on a scope move.
    expect(encodeGenome(sampleGenome(0n))).toBe(
      "AQIBAgPEtJ0BBJfbmAIFiBEGAgj0gAEJ680ICqr7BQvwowEM9PUNDdjbCQ7rEg-5lwYQtmkRq4IFEuJAE_M3FJgnFeLnBxbwoAUXAhiWoQMZ2PYDGgEbnz8cpoQGHol1H7MXIe3aCCLFvAEjhNUG",
    );
  });

  test("sampleGenome(seed, 2): deterministic, plan 2, draws exactly shared + amorphous loci", () => {
    for (const seed of [0n, 1n, 7n]) {
      const a = sampleGenome(seed, 2);
      const b = sampleGenome(seed, 2);
      expect(encodeGenome(a)).toBe(encodeGenome(b));
      expect(getScalar(a, "meta.plan")).toBe(2);
      const legal = new Set([0, ...LOCUS_SCOPES.shared, ...LOCUS_SCOPES.amorphous]);
      for (const id of a.values.keys()) {
        expect(legal.has(id), `amorphous sample drew id ${id}`).toBe(true);
      }
      // Shared loci draw from the same per-path streams as the other
      // plans' samples of the same seed (06 §4 stream keying).
      const q = sampleGenome(seed);
      for (const id of [3, 4, 5, 6, 13, 14, 15]) {
        expect(getScalar(a, id), `shared id ${id}`).toBe(getScalar(q, id));
      }
      expect(a.traitTags).toEqual(q.traitTags);
    }
  });
});

// ---------------------------------------------------------------------------
// Grammar — the §2.4.1 node table, rest geometry, the eye forward floor
// ---------------------------------------------------------------------------

describe("amorphous grammar — the design 07 §2.4.1 node table", () => {
  test("7 nodes with the pinned identities, kinds, roles, chains, and symmetry groups", () => {
    const graph = growAmorphous(AMO_DEFAULTS);
    expect(
      graph.parts.map((p) => [p.id, p.name, p.path, p.kind, p.materialRole, p.animChain, p.symmetry]),
    ).toEqual([
      [0, "blob", "body.blob", "core", "hide", "blob", "single"],
      [1, "crest", "body.ball[B:0]", "segment", "hide", "blob", "serial:balls"],
      [2, "skirt", "body.ball[B:1]", "segment", "hide", "blob", "serial:balls"],
      [3, "drip", "body.ball[B:2]", "segment", "hide", "blob", "serial:balls"],
      [4, "eye_l", "body.eye[L]", "sensor", "focal", "blob", "mirror:eyes"],
      [5, "eye_r", "body.eye[R]", "sensor", "focal", "blob", "mirror:eyes"],
      [6, "highlight", "body.ornament[C]", "ornament", "underside", "blob", "single"],
    ]);
    expect(graph.plan).toBe("amorphous");
    expect(graph.budget).toEqual({ used: 7, min: 7, max: 14 });
    expect(graph.mirrorBroken).toBe(false);
    // Roles used = exactly [hide, underside, focal] (unit law).
    expect(new Set(AMORPHOUS_PART_ROLES)).toEqual(new Set(["hide", "underside", "focal"]));
  });

  test("chain table: ONE blob chain {0..6} — balls AND face (the D-e amendment: own face chains corner-straddle the eyes structurally; the face rides the blob's snap offset, spike-exact relative vote geometry)", () => {
    expect(AMORPHOUS_CHAINS.map((c) => [c.name, c.slabs])).toEqual([
      ["blob", [0, 1, 2, 3, 4, 5, 6]],
    ]);
    expect(growAmorphous(AMO_DEFAULTS).chains).toEqual(AMORPHOUS_CHAINS);
    expect(AMORPHOUS_PART_NAMES).toEqual([
      "blob",
      "crest",
      "skirt",
      "drip",
      "eye_l",
      "eye_r",
      "highlight",
    ]);
  });

  test("canonical socket order: body.blob [balls, eyes, highlight, emitter, rim] (U5 appends — emitter BEFORE ornament)", () => {
    const blob = AMORPHOUS_PLAN.core.make(AMO_DEFAULTS, 0, 1);
    expect(blob.sockets!.map((s) => s.name)).toEqual([
      "balls",
      "eyes",
      "highlight",
      "emitter",
      "rim",
    ]);
  });

  test("all-defaults rest slabs are the adjudicated §2.4.1 raws (machine-verified table; VISIBLE half-extents)", () => {
    const graph = growAmorphous(AMO_DEFAULTS);
    expect(graph.parts.map((p) => [...p.slab.center, ...p.slab.half])).toEqual([
      [0, 0, 288358, 360055, 342491, 298582], // blob — vis 0.67·(8.2, 7.8, 6.8), z0 4.4
      [0, -52429, 524288, 175636, 166855, 149291], // crest (0, −0.8, z0 + 3.6)
      [0, 39322, 124518, 324927, 307364, 158073], // skirt (0, 0.6, 1.9)
      [0, -353894, 104858, 100991, 100991, 87818], // drip (0, −5.4, 1.6)
      [-131072, 301466, 340787, 55706, 39322, 72090], // eye_l (−2.0, 4.6, z0 + 0.8)
      [131072, 301466, 340787, 55706, 39322, 72090], // eye_r
      [-157286, 170394, 484966, 78643, 58982, 65536], // highlight (−2.4, 2.6, z0 + 3.0)
    ]);
  });

  test("growth consumes zero draws and keeps the 7-node structure for every genome", () => {
    const wantOrder = [...growAmorphous(AMO_DEFAULTS).slabOrder];
    for (let seed = 0; seed < 50; seed++) {
      const graph = growAmorphous(sampleGenome(BigInt(seed), 2));
      if (graph.drawsConsumed !== 0) expect.fail(`seed ${seed}: consumed draws`);
      if (graph.parts.length !== 7) expect.fail(`seed ${seed}: ${graph.parts.length} parts`);
      expect([...graph.slabOrder]).toEqual(wantOrder);
    }
  });

  test("coupling exactness at defaults + the pinned constant identities", () => {
    const a = deriveAmorphousAnchors(AMO_DEFAULTS);
    expect(a).toEqual({
      blobVx: 360055,
      blobVy: 342491,
      blobVz: 298582,
      z0: 288358,
      skirtVx: 324927,
      skirtVy: 307364,
      dripY: -353894,
      eyeX: 131072,
      eyeY: 301466, // floors INACTIVE at defaults — byte-inert (below)
      hiX: -157286,
      hiY: 170394,
      hiZRel: 196608,
    });
    // Constant rest ground gap: z0 − blobVz = −10224 raw (−0.156 px — the
    // slime TOUCHES the ground), constant across the depth domain because
    // Z0 shares BLOB_VZ's σ.
    for (const depth of [131072, 222822, 393216]) {
      const g = makeGenome({ values: [["meta.plan", 2], ["body.core.depth", depth]] });
      const an = deriveAmorphousAnchors(g);
      expect(an.z0 - an.blobVz, `depth ${depth}`).toBe(-10224);
    }
    // Constant eye front setback: blobVy − eyeY(coupled) = 41025 raw
    // (0.626 px) across the length domain (shared σ) — WHERE the
    // forward floors stay inactive. The floors can only SHRINK the
    // setback (forward-only, more proud); at the short L-lo genome the
    // wide-pose floor activates (setback 38685 — the visibility repair
    // at work).
    for (const [length, want] of [
      [262144, 38685],
      [498074, 41025],
      [786432, 41025],
    ] as const) {
      const g = makeGenome({ values: [["meta.plan", 2], ["body.core.length", length]] });
      const an = deriveAmorphousAnchors(g);
      expect(an.blobVy - an.eyeY, `length ${length}`).toBe(want);
      expect(an.blobVy - an.eyeY).toBeLessThanOrEqual(41025);
    }
    // F8's normative constants.
    expect(VIS_RATIO).toBe(43909);
    expect(BALL_FROM_VIS).toBe(97815);
    expect(fp_div(FP_ONE, VIS_RATIO)).toBe(BALL_FROM_VIS);
  });

  test("the eye forward floors: inactive at defaults (rest-body margin 6878 raw, wide-skirt margin 153464 raw); activate at the G-lo/L-lo/D-lo corner and at seed 11", () => {
    // In-test replica of the §2.4.1 floor arithmetic for the BODY ball at
    // defaults (Q_BODY = 32768 exact).
    const ballR = (vis: number): number => fp_mul(vis, BALL_FROM_VIS);
    const rx = ballR(360055);
    const ry = ballR(342491);
    const rz = ballR(298582);
    const eyeZ = fp_add(288358, 52429);
    const x = fp_div(131072, rx);
    const z = fp_div(fp_sub(eyeZ, 288358), rz);
    const rem = fp_sub(fp_sub(32768, fp_mul(x, x)), fp_mul(z, z));
    const floorBody = fp_sub(fp_add(0, fp_mul(ry, fp_sqrt(rem))), 39322);
    expect(floorBody).toBe(294588);
    expect(301466 - floorBody).toBe(6878); // the coupled anchor wins — byte-inert
    // WIDE-POSE skirt floor (the U4 visibility repair) at defaults:
    // replica at squash_w = 1 + max(9830, 6554) = 75366 — the rest-mapped
    // candidate sits 153464 raw BELOW the coupled anchor (inert).
    const squashW = fp_add(FP_ONE, 9830);
    const stretchW = fp_div(FP_ONE, squashW);
    const dz0W = fp_mul(288358, fp_sub(stretchW, FP_ONE));
    const wrx = ballR(fp_mul(squashW, 324927));
    const wry = ballR(fp_mul(squashW, 307364));
    const wrz = ballR(158073);
    const wx = fp_div(131072, wrx);
    const wz = fp_div(fp_sub(fp_add(eyeZ, dz0W), 124518), wrz);
    const wrem = fp_sub(fp_sub(48021, fp_mul(wx, wx)), fp_mul(wz, wz));
    expect(wrem).toBe(6821); // solvable, so the candidate EXISTS at defaults…
    const floorWide = fp_div(
      fp_sub(fp_add(39322, fp_mul(wry, fp_sqrt(wrem))), 39322),
      squashW,
    );
    expect(floorWide).toBe(148002); // …and sits far below the coupled anchor
    expect(301466 - floorWide).toBe(153464); // inert margin — byte-inert at defaults
    // Activation spot checks (evidence-triggered mechanisms): at the
    // all-lo geometry corner the floors push the eye forward.
    const corner = makeGenome({
      values: [
        ["meta.plan", 2],
        ["body.core.girth", 131072],
        ["body.core.length", 262144],
        ["body.core.depth", 131072],
      ],
    });
    const an = deriveAmorphousAnchors(corner);
    const coupled = fp_add(301466, fp_mul(45065, fp_sub(262144, 498074)));
    expect(coupled).toBe(139232);
    expect(an.eyeY).toBe(184672); // the wide-pose skirt floor, active past the rest floors
    expect(an.eyeY).toBeGreaterThan(coupled);
    // Seed 11 — the sweep-caught burial genome (idle f1 field −1238 raw
    // past TH pre-repair): the wide floor advances its rest eye anchor.
    expect(deriveAmorphousAnchors(sampleGenome(11n, 2)).eyeY).toBe(229558);
    // The wide-pose BLOB floor (candidate 4, budget 0.26):
    // Q_BODY_WIDE = FP − fp_sqrt(RHE(0.26·2^16)) = 32119 — the budget
    // sits strictly above the defaults' own wide-pose blob term
    // (walk-f3 16751 / idle-f1 16315), so the defaults stay exactly
    // inert (eyeY 301466 pinned above). Seed 4 — the blob-burial
    // genome (walk f3 blob term 18865, margin +796 raw, zero focal
    // pixels pre-repair) — is pushed forward.
    expect(FP_ONE - fp_sqrt(17039)).toBe(32119);
    expect(deriveAmorphousAnchors(sampleGenome(4n, 2)).eyeY).toBe(171681);
  });
});

// ---------------------------------------------------------------------------
// Pose — the independent Python oracle, gait properties, envelopes
// ---------------------------------------------------------------------------

describe("amorphous pose vectors match the from-spec Python oracle", () => {
  type OracleVectors = Record<string, Record<string, (number | null)[][][]>>;
  const oracle = JSON.parse(
    readFileSync(goldenPath("amorphous_pose_oracle.v2.json"), "utf8"),
  ) as OracleVectors;

  const GENOMES: ReadonlyArray<[string, Genome]> = [
    ["defaults", AMO_DEFAULTS],
    [
      "nondefault",
      makeGenome({
        values: [
          ["meta.plan", 2],
          ["body.core.girth", 131072],
          ["body.core.length", 786432],
          ["body.core.depth", 393216],
          // Every amorphous locus EXCEPT pulse_freq non-default
          // (pulse_freq stays 1 — the p = 2 hop/squash freeze is the
          // recorded degeneracy, pinned by its own test below).
          ["anim.amorphous.squash_amp", 13107],
          ["anim.amorphous.ball_phase_delta", 16384],
          ["anim.amorphous.anticipation", 98304],
        ],
      }),
    ],
  ];

  for (const [label, genome] of GENOMES) {
    test(`${label}: all clip × phase slab lists + fieldWeights, exact raws`, () => {
      let checks = 0;
      for (const clip of ALL_CLIPS) {
        const phases = clipPhases(CLIP_KS[clip]);
        phases.forEach((phi, k) => {
          const slabs = poseAmorphous(genome, clip, phi);
          const expected = oracle[label]![clip]![k]!;
          expect(slabs.length).toBe(7);
          slabs.forEach((s, i) => {
            expect(
              [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz, s.fieldWeight ?? null],
              `${label}/${clip}/f${k}/slab${i}`,
            ).toEqual(expected[i]);
            checks++;
          });
        });
      }
      expect(checks).toBe(7 * (4 + 4 + 4 + 2 + 4));
    });
  }
});

describe("amorphous gait properties", () => {
  test("rest-pose law: at walk φ=0 every extent factor is exactly FP_ONE and centers carry only lag terms", () => {
    const rest = growAmorphous(AMO_DEFAULTS).parts;
    const s = poseAmorphous(AMO_DEFAULTS, "walk", 0);
    // squash = 1 − a·sin(0) = 65536 exactly; stretch = fp_div(65536,
    // 65536) = 65536 exactly; fp_mul(65536, x) = x identically.
    expect([s[0]!.hx, s[0]!.hy, s[0]!.hz]).toEqual([...rest[0]!.slab.half]);
    expect(s[0]!.cz).toBe(rest[0]!.slab.center[2]); // dz0 = 0 + hop 0
    expect(s[2]!.hx).toBe(rest[2]!.slab.half[0]); // skirt factors 1
    // Lag oscillators are NONZERO at φ=0 (the spike's own rest pose —
    // sin(−λ) ≠ 0), like the M1 tail: crest x and drip y moved.
    expect(s[1]!.cx).not.toBe(rest[1]!.slab.center[0]);
    expect(s[3]!.cy).not.toBe(rest[3]!.slab.center[1]);
  });

  test("multiplicative extents: walk squash scales blob/skirt x,y and stretches blob z; eyes ride restCy·squash", () => {
    const rest = growAmorphous(AMO_DEFAULTS).parts;
    const s = poseAmorphous(AMO_DEFAULTS, "walk", 16384); // sin = 1: squash 0.85
    const squash = fp_sub(FP_ONE, 9830);
    const stretch = fp_div(FP_ONE, squash);
    expect(s[0]!.hx).toBe(fp_mul(squash, rest[0]!.slab.half[0]));
    expect(s[0]!.hy).toBe(fp_mul(squash, rest[0]!.slab.half[1]));
    expect(s[0]!.hz).toBe(fp_mul(stretch, rest[0]!.slab.half[2]));
    expect(s[2]!.hx).toBe(fp_mul(squash, rest[2]!.slab.half[0]));
    expect(s[2]!.hz).toBe(rest[2]!.slab.half[2]); // skirt z factor 1
    // Eye y: rest + fp_mul(restCy, squash − 1) ≡ fp_mul(restCy, squash).
    expect(s[4]!.cy).toBe(fp_mul(rest[4]!.slab.center[1], squash));
    // Crest/drip/eye halves untouched.
    expect([s[1]!.hx, s[1]!.hy, s[1]!.hz]).toEqual([...rest[1]!.slab.half]);
  });

  test("the U4 idle rule (spike preset verbatim — recorded deviation): +0.10 breath, hop 0, FULL-amplitude lag oscillators", () => {
    const rest = growAmorphous(AMO_DEFAULTS).parts;
    const idle = poseAmorphous(AMO_DEFAULTS, "idle", 16384); // sin = 1
    const squash = fp_add(FP_ONE, 6554); // 1 + 0.10 — sign FLIPS vs walk
    expect(idle[0]!.hx).toBe(fp_mul(squash, rest[0]!.slab.half[0]));
    // hop = 0: skirt z stays at rest.
    expect(idle[2]!.cz).toBe(rest[2]!.slab.center[2]);
    // Crest lag oscillator at FULL amplitude in idle — identical to the
    // walk value at the same θ (the spike's formulas are clip-independent
    // at pulse_freq 1).
    const walk = poseAmorphous(AMO_DEFAULTS, "walk", 16384);
    expect(idle[1]!.cx).toBe(walk[1]!.cx);
    // Frequency locus ignored in idle: p = 2 idles identically.
    const p2 = makeGenome({ values: [["meta.plan", 2], ["anim.amorphous.pulse_freq", 2]] });
    for (const phi of clipPhases(4)) {
      expect(poseAmorphous(p2, "idle", phi)).toEqual(poseAmorphous(AMO_DEFAULTS, "idle", phi));
    }
  });

  test("p = 2 freezes hop AND squash at the K = 4 phases (recorded degeneracy; crest/drip stay alive via lag)", () => {
    const g = makeGenome({ values: [["meta.plan", 2], ["anim.amorphous.pulse_freq", 2]] });
    const rest = growAmorphous(g).parts;
    for (const phi of clipPhases(4)) {
      const s = poseAmorphous(g, "walk", phi);
      expect(s[0]!.cz, `blob φ=${phi}`).toBe(rest[0]!.slab.center[2]); // hop + dz0 frozen
      expect(s[0]!.hx, `blob hx φ=${phi}`).toBe(rest[0]!.slab.half[0]); // squash frozen at 1
    }
    // The crest still wobbles (lagged signal nonzero off the LUT zeros).
    const moved = clipPhases(4).some((phi) => {
      const s = poseAmorphous(g, "walk", phi);
      return s[1]!.cx !== rest[1]!.slab.center[0];
    });
    expect(moved).toBe(true);
  });

  test("fieldWeights: W = [1.0, 0.8, 0.7, 0.55] raws on balls, absent on face slabs, every non-death frame", () => {
    expect([...AMORPHOUS_WEIGHTS]).toEqual([65536, 52429, 45875, 36045]);
    for (const clip of ["walk", "idle", "attack", "hurt"] as const) {
      for (const phi of clipPhases(CLIP_KS[clip])) {
        const s = poseAmorphous(AMO_DEFAULTS, clip, phi);
        expect(s.slice(0, 4).map((x) => x.fieldWeight)).toEqual([65536, 52429, 45875, 36045]);
        expect(s.slice(4).every((x) => x.fieldWeight === undefined)).toBe(true);
      }
    }
  });

  test("one-shot clips are defined only at their K uniform phases", () => {
    expect(poseAmorphous(AMO_DEFAULTS, "attack", 16384).length).toBe(7);
    expect(() => poseAmorphous(AMO_DEFAULTS, "attack", 1)).toThrow(RangeError);
    expect(() => poseAmorphous(AMO_DEFAULTS, "hurt", 16384)).toThrow(RangeError);
    expect(() => poseAmorphous(AMO_DEFAULTS, "death", 65536)).toThrow(RangeError);
    expect(() => poseAmorphous(AMO_DEFAULTS, "walk", 0.5)).toThrow(RangeError);
    expect(() => poseAmorphous(AMO_DEFAULTS, "ooze" as never, 0)).toThrow(RangeError);
  });

  test("attack/hurt envelope pins: equal deltas on every chain; f0 × anticipation only; f2 = f1/3 exact", () => {
    const rest = growAmorphous(AMO_DEFAULTS).parts;
    const idle0 = poseAmorphous(AMO_DEFAULTS, "idle", 0);
    const atk0 = poseAmorphous(AMO_DEFAULTS, "attack", 0);
    const atk1 = poseAmorphous(AMO_DEFAULTS, "attack", 16384);
    const atk2 = poseAmorphous(AMO_DEFAULTS, "attack", 32768);
    const atk3 = poseAmorphous(AMO_DEFAULTS, "attack", 49152);
    const idle1 = poseAmorphous(AMO_DEFAULTS, "idle", 16384);
    const idle2 = poseAmorphous(AMO_DEFAULTS, "idle", 32768);
    const idle3 = poseAmorphous(AMO_DEFAULTS, "idle", 49152);
    for (let i = 0; i < 7; i++) {
      // f0 (ant = 1 at defaults): dy −98304, dz −45875 on EVERY slab.
      expect(atk0[i]!.cy - idle0[i]!.cy, `f0 dy slab ${i}`).toBe(-98304);
      expect(atk0[i]!.cz - idle0[i]!.cz, `f0 dz slab ${i}`).toBe(-45875);
      expect(atk1[i]!.cy - idle1[i]!.cy, `f1 dy slab ${i}`).toBe(147456);
      expect(atk2[i]!.cy - idle2[i]!.cy, `f2 dy slab ${i}`).toBe(49152);
      expect(atk3[i]!.cy - idle3[i]!.cy, `f3 dy slab ${i}`).toBe(0);
    }
    expect(147456 / 3).toBe(49152); // f2 = f1/3 exact
    // Anticipation scales f0 only, both domain ends.
    const lo = makeGenome({ values: [["meta.plan", 2], ["anim.amorphous.anticipation", 32768]] });
    const hi = makeGenome({ values: [["meta.plan", 2], ["anim.amorphous.anticipation", 131072]] });
    expect(poseAmorphous(lo, "attack", 0)).not.toEqual(poseAmorphous(hi, "attack", 0));
    for (let k = 1; k < 4; k++) {
      expect(poseAmorphous(lo, "attack", k * 16384)).toEqual(poseAmorphous(hi, "attack", k * 16384));
    }
    const f0lo = poseAmorphous(lo, "attack", 0);
    expect(f0lo[0]!.cy - idle0[0]!.cy).toBe(fp_mul(32768, -98304));
    // Hurt: −2.25 px recoil on every chain at f0; f1 = idle base.
    const hurt0 = poseAmorphous(AMO_DEFAULTS, "hurt", 0);
    const hurt1 = poseAmorphous(AMO_DEFAULTS, "hurt", 32768);
    for (let i = 0; i < 7; i++) {
      expect(hurt0[i]!.cy - idle0[i]!.cy, `hurt f0 slab ${i}`).toBe(-147456);
      expect(hurt1[i]!.cy - idle2[i]!.cy, `hurt f1 slab ${i}`).toBe(0);
    }
    expect(rest.length).toBe(7);
  });

  test("death = DEFLATE: weight table per frame, blob DROP_CAP sink, face rest-capacity sink + retract, f3 = f2 wholesale", () => {
    const rest = growAmorphous(AMO_DEFAULTS).parts;
    const DEFLATE = [58982, 42598, 29491];
    const DEATH_SINK = [9830, 29491, 55706];
    for (const [k, phi] of [
      [0, 0],
      [1, 16384],
      [2, 32768],
    ] as const) {
      const s = poseAmorphous(AMO_DEFAULTS, "death", phi);
      const idle = poseAmorphous(AMO_DEFAULTS, "idle", phi);
      // Weight scale table (the deflate — §2.4's new envelope mechanism).
      for (let b = 0; b < 4; b++) {
        expect(s[b]!.fieldWeight, `f${k} ball ${b}`).toBe(fp_mul(DEFLATE[k]!, AMORPHOUS_WEIGHTS[b]!));
      }
      // Blob chain: sink = DEATH_SINK[k] × DEFLATE_DROP_CAP (196608 — the
      // pinned constant replacing the derived capacity, 0 for a grounded
      // blob); stagger −49152; extents untouched by death.
      const sink = fp_mul(DEATH_SINK[k]!, 196608);
      expect(s[0]!.cz - idle[0]!.cz).toBe(-sink);
      expect(s[0]!.cy - idle[0]!.cy).toBe(-49152);
      expect(s[0]!.hx).toBe(idle[0]!.hx);
      // Face chains: sink on max(0, restCz − restHz) of the chain anchor;
      // retract cy −= DEATH_SINK[k] × max(0, restCy).
      for (const i of [4, 5, 6]) {
        const cap = Math.max(0, rest[i]!.slab.center[2] - rest[i]!.slab.half[2]);
        const retract = fp_mul(DEATH_SINK[k]!, Math.max(0, rest[i]!.slab.center[1]));
        expect(s[i]!.cz - idle[i]!.cz, `face ${i} f${k} sink`).toBe(-fp_mul(DEATH_SINK[k]!, cap));
        expect(s[i]!.cy - idle[i]!.cy, `face ${i} f${k} retract`).toBe(-49152 - retract);
      }
    }
    // f3 IS f2 wholesale — identical slab lists (weights included).
    for (const seed of [0n, 3n, 7n]) {
      const g = sampleGenome(seed, 2);
      expect(poseAmorphous(g, "death", 49152)).toEqual(poseAmorphous(g, "death", 32768));
    }
  });

  test("plan dispatch: poseCreature/growCreature follow meta.plan = 2", () => {
    expect(poseCreature(AMO_DEFAULTS, "walk", 0).length).toBe(7);
    expect(poseCreature(AMO_DEFAULTS, "walk", 16384)).toEqual(
      poseAmorphous(AMO_DEFAULTS, "walk", 16384),
    );
    expect(growCreature(AMO_DEFAULTS).plan).toBe("amorphous");
    expect(poseCreature(makeGenome(), "walk", 0).length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// THE FORK (design 07 §2.4.1 D-f) — raster golden, traps, ties, tags
// ---------------------------------------------------------------------------

/** The pinned §1.4-serialized raster golden of the fork: all-defaults
 * amorphous, walk φ=0, down, 32×32, no offsets — the fork's determinism
 * anchor beside the M1 classic-path golden. */
const AMORPHOUS_RASTER_GOLDEN_SHA256 =
  "785694abc9f15daf01a2f0f81c04cb17eb9e80b077001343da0dddb99a95be17";

describe("the metaball renderer fork", () => {
  test("fork raster golden: all-defaults walk φ=0 down serialized-grid sha256, twice (deterministic)", () => {
    const slabs = poseAmorphous(AMO_DEFAULTS, "walk", 0);
    const a = rasterize(slabs, "down", 32, 4);
    const b = rasterize(slabs, "down", 32, 4);
    expect(sha256Hex(serializeRasterGrid(a))).toBe(AMORPHOUS_RASTER_GOLDEN_SHA256);
    expect(sha256Hex(serializeRasterGrid(b))).toBe(AMORPHOUS_RASTER_GOLDEN_SHA256);
  });

  test("offset-hook equivalence: all-zero offsets are byte-identical to no offsets", () => {
    const slabs = poseAmorphous(AMO_DEFAULTS, "walk", 16384);
    const zeros = slabs.map(() => ({ dx: 0, dy: 0 }));
    const a = serializeRasterGrid(rasterize(slabs, "left", 32, 4));
    const b = serializeRasterGrid(rasterize(slabs, "left", 32, 4, zeros));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("dominant-ball part tags + face slabs coexist (spot checks on the golden grid)", () => {
    const slabs = poseAmorphous(AMO_DEFAULTS, "walk", 0);
    const grid = rasterize(slabs, "down", 32, 4);
    // The crest crowns the mass (part 1), the blob fills the middle
    // (part 0), the skirt fringes the bottom (part 2); eyes are focal
    // slab hits, the highlight an underside slab hit. Spot pixels read
    // off the pinned golden render.
    expect(grid[15]![17]!.partId).toBe(1);
    expect(grid[20]![15]!.partId).toBe(0);
    expect(grid[27]![15]!.partId).toBe(2);
    expect(grid[23]![13]!.role).toBe("focal");
    expect(grid[19]![18]!.role).toBe("underside");
    // Field pixels carry ball node ids only (0..3) on hide.
    for (const row of grid) {
      for (const p of row) {
        if (p === null) continue;
        if (p.role === "hide") expect(p.partId).toBeLessThanOrEqual(3);
      }
    }
  });

  test("M1 admission guard: columns outside every ball's |dx| < rx are transparent", () => {
    // One small ball dead center: opaque pixels only where the column is
    // admitted (|sx| < ball rx ≈ 2.99 px around x = 16).
    const ball: Slab = {
      cx: 0,
      cy: 0,
      cz: 327680,
      hx: 131072,
      hy: 131072,
      hz: 131072,
      role: "hide",
      fieldWeight: 65536,
    };
    const grid = rasterize([ball], "up", 32, 4);
    let opaque = 0;
    for (const row of grid) {
      row.forEach((p, x) => {
        if (p === null) return;
        opaque++;
        expect(Math.abs(x - 16) <= 3, `column ${x}`).toBe(true);
      });
    }
    expect(opaque).toBeGreaterThan(0);
  });

  test("march-cap trap: a >256-step admitted span with no crossing traps (spec violation)", () => {
    // Ball with a 40-px visible y half-extent (ball ry ≈ 59.7 px → ~398
    // march steps) whose z sits far above every ray: admitted columns
    // march the whole span, find nothing, and must TRAP at 256.
    const tall: Slab = {
      cx: 0,
      cy: 0,
      cz: 6553600,
      hx: 655360,
      hy: 2621440,
      hz: 65536,
      role: "hide",
      fieldWeight: 65536,
    };
    expect(() => rasterize([tall], "up", 32, 4)).toThrow(/MARCH_CAP/);
  });

  test("fieldWeight validation: non-positive or fractional weights are rejected", () => {
    const bad = { cx: 0, cy: 0, cz: 327680, hx: 131072, hy: 131072, hz: 131072, role: "hide" as const };
    expect(() => rasterize([{ ...bad, fieldWeight: 0 }], "up")).toThrow(RangeError);
    expect(() => rasterize([{ ...bad, fieldWeight: -65536 }], "up")).toThrow(RangeError);
    expect(() => rasterize([{ ...bad, fieldWeight: 0.5 }], "up")).toThrow(RangeError);
  });

  test("depth tie vs a classic slab: the field (lower pseudo-index) wins the tied sample — observed through the pinned depth tag", () => {
    // In-test replica of M1–M4 (an independent re-implementation of the
    // march) computes the 16 per-sample field entry depths of pixel
    // (16, 10) in the 'up' view for one flat ball; a degenerate classic
    // FOCAL micro-slab (hx = hz = 8192, hy = 1: covers exactly ONE
    // sample column/row) is then placed so its entry depth EXACTLY
    // equals that sample's field depth. If the tie goes to the field
    // (pseudo-index 0 < slab index 1 — §1.4's rule), the pixel's hide
    // key keeps all 16 samples and its depthRaw equals the field-only
    // render's; nudging the slab 1 raw closer flips that sample to the
    // focal key and the depth tag must move to the 15-sample mean.
    const ball: Slab = {
      cx: 0,
      cy: 0,
      cz: 1048576,
      hx: 655360,
      hy: 524288,
      hz: 655360,
      role: "hide",
      fieldWeight: 65536,
    };
    const rx = fp_mul(ball.hx, BALL_FROM_VIS);
    const ry = fp_mul(ball.hy, BALL_FROM_VIS);
    const rz = fp_mul(ball.hz, BALL_FROM_VIS);
    const invRx = fp_div(FP_ONE, rx);
    const invRy = fp_div(FP_ONE, ry);
    const invRz = fp_div(FP_ONE, rz);
    const fieldAt = (px: number, py: number, pz: number): number => {
      const x = fp_mul(fp_sub(px, ball.cx), invRx);
      if (x > FP_ONE || x < -FP_ONE) return 0;
      const y = fp_mul(fp_sub(py, ball.cy), invRy);
      if (y > FP_ONE || y < -FP_ONE) return 0;
      const z = fp_mul(fp_sub(pz, ball.cz), invRz);
      if (z > FP_ONE || z < -FP_ONE) return 0;
      const d2 = fp_mul(x, x) + fp_mul(y, y) + fp_mul(z, z);
      if (d2 >= FP_ONE) return 0;
      const t = FP_ONE - d2;
      return fp_mul(ball.fieldWeight!, fp_mul(t, t));
    };
    const march = (sx: number, sy: number): number => {
      const dx = fp_sub(sx, ball.cx);
      expect(dx < rx && dx > -rx).toBe(true);
      let y = fp_sub(ball.cy, ry);
      const y1 = fp_add(ball.cy, ry);
      while (y <= y1) {
        const pz = fp_sub(fp_sub(0, fp_mul(TILT_RAW, y)), sy);
        if (fieldAt(sx, y, pz) >= FIELD_TH_RAW) {
          let lo = fp_sub(y, MARCH_STEP);
          let hi = y;
          for (let k = 0; k < BISECT_ITERS; k++) {
            const mid = asr(fp_add(lo, hi), 1);
            const pzm = fp_sub(fp_sub(0, fp_mul(TILT_RAW, mid)), sy);
            if (fieldAt(sx, mid, pzm) >= FIELD_TH_RAW) hi = mid;
            else lo = mid;
          }
          return hi;
        }
        y = fp_add(y, MARCH_STEP);
      }
      throw new Error("replica: expected a crossing");
    };
    const px = 16;
    const py = 10;
    const depths: number[] = [];
    for (let iy = 0; iy < 4; iy++) {
      for (let ix = 0; ix < 4; ix++) {
        const sx = fp_div(px * 65536 + SAMPLE_OFFSETS[ix]! - 32 * 32768, 32 * 2048);
        const sy = fp_div(py * 65536 + SAMPLE_OFFSETS[iy]! - 32 * 54272, 32 * 2048);
        depths.push(march(sx, sy));
      }
    }
    const sum = depths.reduce((a, b) => a + b, 0);
    // Field-only render agrees with the replica (independent M1–M4
    // re-implementation cross-check through the depth tag).
    const g0 = rasterize([ball], "up", 32, 4);
    expect(g0[py]![px]!.depthRaw).toBe(rheDiv(sum, 16));
    // Micro-slab targeting sample (ix=0, iy=0) ONLY (adjacent sample
    // columns/rows miss by the C1/Q2 guards: X = fp_div(16384, 8192) >
    // FP_ONE; z0² = fp_div(16384, 8000)² > a). The slab is built so the
    // ray through the sample passes its center in z (w = 0 ⇒ z0 = 0,
    // b0 = 0 exactly, for ANY cy), so its entry depth is cy − K with a
    // cy-INDEPENDENT K — computed here by replicating the pinned
    // P1–Q5 steps (extents chosen so every T1 setup constant stays
    // int32: fp_mul(hy, hy) = 16, invE2y = 2^28 < 2^31; the original
    // draft's hy = 1 raw made fp_mul(hy, hy) = 0 and T1 trap).
    const d = depths[0]!;
    const sx0 = fp_div(px * 65536 + SAMPLE_OFFSETS[0]! - 32 * 32768, 32 * 2048);
    const sy0 = fp_div(py * 65536 + SAMPLE_OFFSETS[0]! - 32 * 54272, 32 * 2048);
    const P_HY = 1024;
    const P_HZ = 8000;
    const zs = fp_sub(0, fp_div(fp_mul(TILT_RAW, P_HY), P_HZ)); // P2
    const a = fp_add(FP_ONE, fp_mul(zs, zs)); // P3
    const invA = fp_div(FP_ONE, a); // P4
    const q = fp_mul(a, FP_ONE); // Q1 at X = 0, z0 = 0
    const yq = fp_mul(fp_sub(0, fp_sqrt(q)), invA); // Q4 (b0 = 0)
    const K = fp_sub(0, fp_mul(P_HY, yq)); // entry depth = cy − K (Q5)
    expect(K).toBeGreaterThan(0);
    const mkProbe = (cy: number): Slab => ({
      cx: sx0,
      cy,
      cz: fp_sub(fp_sub(0, fp_mul(TILT_RAW, cy)), sy0),
      hx: 8192,
      hy: P_HY,
      hz: P_HZ,
      role: "focal",
    });
    // Exact tie: the field wins (lower index) — the pixel is hide with
    // ALL 16 samples, depth tag unchanged.
    const gTie = rasterize([ball, mkProbe(fp_add(d, K))], "up", 32, 4);
    expect(gTie[py]![px]!.role).toBe("hide");
    expect(gTie[py]![px]!.partId).toBe(0);
    expect(gTie[py]![px]!.depthRaw).toBe(rheDiv(sum, 16));
    // One raw closer: strict < now hands that sample to the focal slab —
    // the hide key drops to 15 samples and the depth tag moves.
    const gWin = rasterize([ball, mkProbe(fp_add(d, K - 1))], "up", 32, 4);
    expect(gWin[py]![px]!.role).toBe("hide"); // 15 vs 1 — hide still wins the vote
    expect(gWin[py]![px]!.depthRaw).toBe(rheDiv(sum - d, 15));
    expect(rheDiv(sum, 16)).not.toBe(rheDiv(sum - d, 15)); // the observation is real
  });
});

// ---------------------------------------------------------------------------
// Export — goldens (ritual-pinned), shadow seam, hitboxes, visibility
// ---------------------------------------------------------------------------

const AMO_GOLDEN_SHEET_PNG_SHA256 =
  "834e00a9c3019c59242ebd230ac29e53e1d49b5bf24478317c51b2d9c3517dee";
const AMO_GOLDEN_SHEET_RGBA_SHA256 =
  "7712bff19d42be221467eb48ac81e0cc47e1b1956f5ec67426ca6a79d01bf5ac";
// V1 (generator v3): amorphous geometry is untouched, so both PIXEL hashes
// above are byte-identical to v2 (razor evidence); only the JSON moves, by
// exactly the generator_version line.
const AMO_GOLDEN_JSON_SHA256 =
  "732ae255ef38121e580a0c34f7c8ca479c3db68e9b3fa081fbce5f598ec030b5";

describe("the all-defaults amorphous golden (pinned after the provenance ritual)", () => {
  const EXPORT = exportCreature(AMO_DEFAULTS);

  test("sheet PNG + sheet RGBA + JSON SHA-256s", () => {
    expect(EXPORT.sheetPngSha256).toBe(AMO_GOLDEN_SHEET_PNG_SHA256);
    expect(EXPORT.sheetRgbaSha256).toBe(AMO_GOLDEN_SHEET_RGBA_SHA256);
    expect(EXPORT.jsonSha256).toBe(AMO_GOLDEN_JSON_SHA256);
  });

  test("the committed golden FILES byte-match a fresh render", () => {
    expect(
      Buffer.from(EXPORT.sheetPng).equals(readFileSync(goldenPath("amorphous.sheet.png"))),
    ).toBe(true);
    expect(readFileSync(goldenPath("amorphous.json"), "utf8")).toBe(EXPORT.json);
  });

  test("schema: 72 frames, 128×640, genome AQAE, hurt flash, mirror false, GENERATOR_VERSION 3", () => {
    const meta = JSON.parse(EXPORT.json) as {
      frames: unknown[];
      genome: string;
      generator_version: number;
      sheet: { cell: number; h: number; w: number };
      clips: Record<string, Record<string, { flash?: boolean; mirror: boolean }>>;
    };
    expect(meta.frames.length).toBe(72);
    expect(meta.genome).toBe("AQAE");
    // V1 (design 08 §1 law 2) bumped the stamp to 3; the amorphous PIXELS
    // are razor-proven byte-identical to v2 — only the stamp moved.
    expect(meta.generator_version).toBe(3);
    expect(meta.sheet).toEqual({ cell: 32, h: 640, w: 128 });
    expect(meta.clips.hurt!.down!.flash).toBe(true);
    expect(meta.clips.walk!.down!.flash).toBeUndefined();
    for (const clip of Object.values(meta.clips)) {
      for (const dir of Object.values(clip)) expect(dir.mirror).toBe(false);
    }
  });

  test("death cells hold their final frame byte-identically", () => {
    for (let d = 0; d < 4; d++) {
      expect(EXPORT.rgbaSha256[56 + d * 4 + 3]).toBe(EXPORT.rgbaSha256[56 + d * 4 + 2]);
    }
  });

  test("shadow = the blob chain {0..6} extent, ground-anchored (independent in-test arithmetic)", () => {
    const meta = JSON.parse(EXPORT.json) as {
      hitboxes: Array<{ shadow: { cx_fp: number; cy_fp: number; rx_fp: number; ry_fp: number } }>;
    };
    const slabLists = clipPhases(4).map((phi) => poseAmorphous(AMO_DEFAULTS, "walk", phi));
    const offsets = snapOffsets(slabLists, "down", AMORPHOUS_CHAINS);
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    for (const i of [0, 1, 2, 3, 4, 5, 6]) {
      // Down view = 2 quarter turns: cx → −cx, extents unswapped.
      const s = slabLists[0]![i]!;
      const cx = -s.cx + offsets[0]![i]!.dx;
      bMinX = Math.min(bMinX, cx - s.hx);
      bMaxX = Math.max(bMaxX, cx + s.hx);
    }
    const rx = asr(bMaxX - bMinX, 1);
    expect(meta.hitboxes[0]!.shadow).toEqual({
      cx_fp: 1048576 + asr(bMinX + bMaxX, 1),
      cy_fp: 1736704, // the ground line — the slime touches it (contact shadow)
      rx_fp: rx,
      ry_fp: asr(rx, 2),
    });
    for (const hb of meta.hitboxes) expect(hb.shadow.cy_fp).toBe(1736704);
  });

  test("one sampled amorphous (seed 0): pinned RGBA hash, deterministic", { timeout: 120000 }, () => {
    const out = exportCreature(sampleGenome(0n, 2));
    expect(out.sheetRgbaSha256).toBe(
      "c3172d3d4fc4384708d08666ce53a3bd1db37cfb23a23c1e57088a509eb44fd7",
    );
  });
});

// ---------------------------------------------------------------------------
// Flicker CI corpus (scaled — the 0..1999 sweep is the unit evidence)
// ---------------------------------------------------------------------------

describe("amorphous flicker gates (CI corpus: defaults + seeds 0..4, all gated clips)", () => {
  test("amorphous gate row holds; death held pair scores exactly 0.0; no INF", { timeout: 600000 }, () => {
    const genomes: Genome[] = [AMO_DEFAULTS];
    for (let seed = 0; seed < 5; seed++) genomes.push(sampleGenome(BigInt(seed), 2));
    for (const [gi, genome] of genomes.entries()) {
      const label = gi === 0 ? "defaults" : `seed ${gi - 1}`;
      for (const clip of ["walk", "attack", "hurt", "death"] as const) {
        const cells = measureClipFlicker(genome, clip);
        for (const direction of DIRECTIONS) {
          const cell = cells[direction];
          for (const pair of cell.pairs) {
            expect(pair.infinite, `${label} ${clip} ${direction} INF`).toBe(false);
          }
          expect(cell.pass, `${label} ${clip} ${direction} gate`).toBe(true);
          if (clip === "death") {
            const held = cell.pairs[2]!;
            expect(held.changed, `${label} death ${direction} held`).toBe(0);
            expect(held.energy).toBe(0n);
          }
        }
      }
    }
  });

  test("renderClipCells returns 7-slab lists for an amorphous genome", () => {
    const cells = renderClipCells(AMO_DEFAULTS, "idle");
    expect(cells.down.slabLists[0]!.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Eye visibility (CI: seeds 0..19, down view, walk — scaled from the
// 2000-seed unit sweep)
// ---------------------------------------------------------------------------

describe("eye visibility (CI: seeds 0..19, down view, walk 4 phases)", () => {
  test("every amorphous shows ≥ 1 focal pixel in every down-view walk AND idle frame", { timeout: 600000 }, () => {
    // Idle is included deliberately: the U4 visibility repair's worst
    // observed case (seed 11) was buried DEEPEST at the idle wide-squash
    // frame (breath 0.10 exceeds a small sampled squash_amp), so idle
    // guards the repaired mechanism, not just the spec'd walk corpus.
    for (let seed = 0; seed < 20; seed++) {
      const genome = sampleGenome(BigInt(seed), 2);
      const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
      for (const clip of ["walk", "idle"] as const) {
        const slabLists = clipPhases(4).map((phi) => poseAmorphous(genome, clip, phi));
        const offsets = snapOffsets(slabLists, "down", AMORPHOUS_CHAINS);
        const rawGrids = slabLists.map((slabs, f) =>
          rasterize(slabs, "down", 32, rampLen, offsets[f]!),
        );
        const { grids } = craftClip(rawGrids);
        grids.forEach((grid, f) => {
          let focal = 0;
          for (const row of grid) {
            for (const px of row) if (px !== null && px.role === "focal") focal++;
          }
          if (focal < 1) {
            expect.fail(`seed ${seed} ${clip} f${f}: zero focal pixels in the down view`);
          }
        });
      }
    }
  });

  test("one chain, one offset: every slab shares the blob offset (the D-e face-scramble guard, trivial by construction)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const genome = sampleGenome(BigInt(seed), 2);
      for (const clip of ["walk", "idle"] as const) {
        const slabLists = clipPhases(4).map((phi) => poseAmorphous(genome, clip, phi));
        for (const direction of DIRECTIONS) {
          const offsets = snapOffsets(slabLists, direction, AMORPHOUS_CHAINS);
          offsets.forEach((frame, f) => {
            for (let i = 1; i < 7; i++) {
              expect(frame[i], `${seed}/${clip}/${direction}/f${f}/slab${i}`).toEqual(frame[0]);
            }
          });
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Craft property suite on the amorphous corpus (S3 scope note discharged)
// ---------------------------------------------------------------------------

describe("craft property suite — amorphous corpus (defaults + seeds 0..4)", () => {
  test("crafted cells are rule-2/rule-3 fixpoints with legal selout edges; drip exemption recorded", { timeout: 600000 }, () => {
    const genomes: Genome[] = [AMO_DEFAULTS];
    for (let seed = 0; seed < 5; seed++) genomes.push(sampleGenome(BigInt(seed), 2));
    for (const [gi, genome] of genomes.entries()) {
      const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
      for (const clip of ALL_CLIPS) {
        const slabLists = clipPhases(CLIP_KS[clip]).map((phi) =>
          poseAmorphous(genome, clip, phi),
        );
        for (const direction of DIRECTIONS) {
          const offsets = snapOffsets(slabLists, direction, AMORPHOUS_CHAINS);
          const rawGrids = slabLists.map((slabs, f) =>
            rasterize(slabs, direction, 32, rampLen, offsets[f]!),
          );
          const { grids } = craftClip(rawGrids);
          for (const grid of grids) {
            // Orphans (rule 2) and jaggies (rule 3): the fixpoint proof —
            // both rules fire ZERO changes on a crafted grid.
            const clone = grid.map((row) =>
              row.map((c) => (c === null ? null : { ...c })),
            );
            expect(rule2Orphan(clone), `genome ${gi} ${clip}/${direction} rule2`).toBe(0);
            expect(rule3Jaggy(clone), `genome ${gi} ${clip}/${direction} rule3`).toBe(0);
            for (const row of grid) {
              for (const c of row) {
                if (c === null) continue;
                expect([0, 1, 2]).toContain(c.edge);
                expect(c.partId).toBeLessThanOrEqual(6);
              }
            }
          }
        }
      }
    }
    // F15 exemption spot check at defaults (recorded facts, re-derived
    // after the D-e chain merge): the drip (part 3) is fully occluded in
    // the down-view walk cell (no stats ⇒ no exemption entry) and EXEMPT
    // in the left view where it renders ~2 px/frame; the squashed-thin
    // skirt fringe (part 2), the small eyes (4, 5), and the highlight
    // (6) are exempt in the down view.
    const rampLen = 4 as const;
    const mk = (dir: "down" | "left"): readonly number[] => {
      const slabLists = clipPhases(4).map((phi) => poseAmorphous(AMO_DEFAULTS, "walk", phi));
      const offsets = snapOffsets(slabLists, dir, AMORPHOUS_CHAINS);
      const rawGrids = slabLists.map((slabs, f) => rasterize(slabs, dir, 32, rampLen, offsets[f]!));
      return craftClip(rawGrids).info.exemptParts;
    };
    expect(mk("down")).toEqual([2, 4, 5, 6]);
    expect(mk("left")).toContain(3);
  });
});

describe("craft idempotence — amorphous corpus (defaults + seeds 0..2, all clips)", () => {
  test("second craft pass is a no-op on every cell", { timeout: 600000 }, () => {
    const genomes: Genome[] = [AMO_DEFAULTS];
    for (let seed = 0; seed < 3; seed++) genomes.push(sampleGenome(BigInt(seed), 2));
    for (const [gi, genome] of genomes.entries()) {
      const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
      for (const clip of ALL_CLIPS) {
        const slabLists = clipPhases(CLIP_KS[clip]).map((phi) =>
          poseAmorphous(genome, clip, phi),
        );
        for (const direction of DIRECTIONS) {
          const offsets = snapOffsets(slabLists, direction, AMORPHOUS_CHAINS);
          const rawGrids = slabLists.map((slabs, f) =>
            rasterize(slabs, direction, 32, rampLen, offsets[f]!),
          );
          const one = craftClip(rawGrids);
          const two = craftClip(one.grids);
          expect(two.grids, `genome ${gi} ${clip}/${direction}`).toEqual(one.grids);
        }
      }
    }
  });
});
