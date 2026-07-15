/**
 * U3 — the levitant plan (design 07 §2.3.1): registry append 36–46 +
 * plan-scoped sampling, the levitant grammar and gait template, the
 * plan-aware shadow/snapping seams, the anim semantic map, wire behavior
 * (id-0-first emit order, AQAC), the levitant goldens, and the scaled CI
 * corpora (flicker gates, sensor visibility, craft idempotence, the §2.3
 * corner worst-case table on the production fp path).
 *
 * Oracle provenance: the pose vectors in
 * tests/goldens/levitant_pose_oracle.v2.json were computed by an
 * independent from-spec Python oracle (scratchpad
 * levitant_pose_oracle.py, 2026-07-15 — reimplements the design 06 §5
 * fixed-point kernel, the §5.3 LUT from its defining formula, the
 * design 07 §2.3.1 geometry/oscillators/envelopes from the adjudicated
 * U3 spec), NEVER by running this implementation. The levitant golden
 * hashes were pinned only AFTER the M1 provenance ritual (2026-07-15):
 * PIL pixel-compare of the sheet PNG against the raw RGBA, an
 * independent Python JSON re-canonicalization (byte-identical), all 72
 * hitboxes exact-matched by a from-spec Python snap+hitbox oracle, every
 * sha256 recomputed in Python, and two consecutive renders
 * byte-identical. The rest-slab raw table below is the adjudicated spec
 * §2.3 table, every raw machine-verified (scratchpad verify_raws.py,
 * zero mismatches).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { snapOffsets } from "../src/craft.js";
import { asr, fp_mul, fp_sqrt } from "../src/fixed.js";
import { exportCreature } from "../src/export.js";
import { FLICKER_GATES, measureClipFlicker, renderClipCells } from "../src/flicker.js";
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
  LEVITANT_CHAINS,
  LEVITANT_PART_NAMES,
  LEVITANT_PART_ROLES,
  LEVITANT_PLAN,
  deriveLevitantAnchors,
  growLevitant,
} from "../src/grammar.js";
import { craftClip } from "../src/craft.js";
import {
  CLIP_KS,
  clipPhases,
  growCreature,
  poseCreature,
  poseLevitant,
  poseQuadruped,
} from "../src/pose.js";
import type { ClipName, Slab } from "../src/pose.js";
import { DIRECTIONS, DIRECTION_TURNS, TILT_RAW, rasterize, yawSlab } from "../src/raster.js";

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./goldens/${name}`, import.meta.url));

/** All-defaults levitant: the plan entry is the only non-default. */
const LEV_DEFAULTS = makeGenome({ values: [["meta.plan", 1]] });

const ALL_CLIPS: readonly ClipName[] = ["walk", "idle", "attack", "hurt", "death"];

// ---------------------------------------------------------------------------
// Registry append (ids 36–46), scopes, semantic map (design 07 §2.3.1)
// ---------------------------------------------------------------------------

describe("U3 registry append — ids 36–46, plan enum, scopes", () => {
  test("the 11 levitant loci transcribe the adjudicated table exactly", () => {
    const rows: ReadonlyArray<[number, string, string, number, number, number]> = [
      [36, "anim.levitant.hover_freq", "int", 1, 2, 1],
      [37, "anim.levitant.hover_amp", "fp", 0, 131072, 85197],
      [38, "anim.levitant.flap_ratio", "int", 1, 3, 3],
      [39, "anim.levitant.tendril_lag", "fp", 0, 8192, 7301],
      [40, "anim.levitant.tendril_amp", "fp", 0, 131072, 98304],
      [41, "anim.levitant.anticipation", "fp", 32768, 131072, 65536],
      [42, "body.core.altitude", "fp", 753664, 851968, 786432],
      [43, "body.sensor[C].scale", "fp", 39322, 98304, 65536],
      [44, "body.core.locomotor_size", "fp", 32768, 117965, 65536],
      [45, "body.core.tendril_girth", "fp", 45875, 91750, 58982],
      [46, "body.core.tendril_len", "fp", 52429, 98304, 85197],
    ];
    for (const [id, path, kind, lo, hi, dflt] of rows) {
      const locus = REGISTRY[id] as ScalarLocus;
      expect([locus.id, locus.path, locus.kind, locus.lo, locus.hi, locus.defaultRaw], path).toEqual(
        [id, path, kind, lo, hi, dflt],
      );
    }
  });

  test("meta.plan extends to {quadruped = 0, levitant = 1} — and NOT amorphous", () => {
    const plan = REGISTRY[0] as ScalarLocus;
    expect([plan.kind, plan.lo, plan.hi, plan.defaultRaw]).toEqual(["enum", 0, 1, 0]);
    expect(PLAN_NAMES).toEqual(["quadruped", "levitant"]); // amorphous = 2 is U4's append
  });

  test("scope-set completeness: every registry id in exactly one scope", () => {
    const seen = new Map<number, string>();
    for (const [name, ids] of Object.entries(LOCUS_SCOPES)) {
      for (const id of ids) {
        expect(seen.has(id), `id ${id} in both ${seen.get(id)} and ${name}`).toBe(false);
        seen.set(id, name);
      }
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(
      REGISTRY.map((l) => l.id),
    );
  });

  test("anim semantic map: referential integrity, anim.* only, no duplicate endpoints", () => {
    const qSeen = new Set<string>();
    const lSeen = new Set<string>();
    for (const entry of ANIM_SEMANTIC_MAP) {
      for (const side of ["quadruped", "levitant"] as const) {
        const path = entry[side];
        expect(path.startsWith(`anim.${side}.`), path).toBe(true);
        expect(locusByPath(path), path).toBeDefined();
      }
      expect(qSeen.has(entry.quadruped)).toBe(false);
      expect(lSeen.has(entry.levitant)).toBe(false);
      qSeen.add(entry.quadruped);
      lSeen.add(entry.levitant);
    }
    expect(ANIM_SEMANTIC_MAP.length).toBe(5);
    // Unmapped, recorded (design 01 §3 "present in one parent only"):
    for (const path of [
      "anim.quadruped.leg_swing_amp",
      "anim.quadruped.leg_lift_amp",
      "anim.levitant.flap_ratio",
    ]) {
      expect(locusByPath(path)).toBeDefined();
      expect(qSeen.has(path) || lSeen.has(path)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Wire (design 07 §2.3.1 D-k): AQAC, id-0-first emit order, round-trips
// ---------------------------------------------------------------------------

describe("U3 wire behavior", () => {
  test("all-defaults levitant tape is exactly AQAC, both directions", () => {
    expect(encodeGenome(LEV_DEFAULTS)).toBe("AQAC"); // bytes 01 00 02
    const g = decodeGenome("AQAC");
    expect(getScalar(g, "meta.plan")).toBe(1);
    expect(g.seed).toBe(0n);
    expect(g.traitTags).toEqual([]);
    expect(g.values.size).toBe(1);
  });

  test("id-0-first emit order: a plan-1 genome with seed + tags + scalars stays strictly ascending", () => {
    // The U2 emitter emitted seed (id 1) and tags (id 2) before the
    // scalar loop under a comment assuming id 0 could never be
    // non-default — the U3 plan append broke that. The fixed tape must
    // decode (the decoder rejects non-ascending ids outright).
    const g = makeGenome({
      seed: 42n,
      traitTags: [0, 3],
      values: [
        ["meta.plan", 1],
        ["palette.base_hue", 13107200],
        ["anim.levitant.hover_amp", 131072],
        ["body.core.tendril_len", 52429],
      ],
    });
    const text = encodeGenome(g);
    const bytes = Buffer.from(text, "base64url");
    expect(bytes[0]).toBe(1); // version
    expect(bytes[1]).toBe(0); // id 0 FIRST
    expect(bytes[2]).toBe(2); // zz(1)
    expect(bytes[3]).toBe(1); // then the seed entry
    const back = decodeGenome(text);
    expect(back).toEqual(g);
    expect(encodeGenome(back)).toBe(text);
  });

  test("plan-1 round-trips with mixed loci incl. 36–46 (both quadruped and levitant scalars on one tape)", () => {
    const g = makeGenome({
      seed: 7n,
      values: [
        [0, 1],
        [11, 16384], // a quadruped locus stays wire-legal and inert on a levitant
        [39, 8192],
        [46, 98304],
      ],
    });
    const decoded = decodeGenome(encodeGenome(g));
    expect(decoded).toEqual(g);
    expect(getScalar(decoded, 39)).toBe(8192);
    expect(getScalar(decoded, 11)).toBe(16384);
  });

  test("a v1-era DNA string still decodes unchanged (wire law: appends are absent-meaning)", () => {
    const g = decodeGenome("AQEqA4CA2AsMtOYEG4CABA"); // the 06 §3.4 worked example
    expect(getScalar(g, "meta.plan")).toBe(0);
    expect(getScalar(g, "anim.levitant.hover_amp")).toBe(85197); // absent = default
    expect(encodeGenome(g)).toBe("AQEqA4CA2AsMtOYEG4CABA");
  });
});

// ---------------------------------------------------------------------------
// Plan-scoped sampler (design 07 §2.3.1 D-a)
// ---------------------------------------------------------------------------

describe("plan-scoped sampler", () => {
  test("sampled quadruped DNA is byte-identical to the committed U2 strings (the 1132-golden-intact guard)", () => {
    // A sampled quadruped genome draws exactly ids 3..35 — the identical
    // set U2 drew. The pinned strings below were machine-generated from
    // the COMMITTED U2 build (d890599 src, tsc-compiled in a scratch
    // dir, 2026-07-15) and byte-compared — NOT from this tree's sampler.
    // (qa/sheet_0_49.json is the M1-era artifact: its DNA strings predate
    // the U2 id-35 append, so current tapes extend them by the id-35
    // entry; the committed qa files stay untouched, they are pinned
    // history, not a sampler contract.)
    const U2_DNA: ReadonlyArray<[bigint, string]> = [
      [
        0n,
        "AQIBAgPEtJ0BBJfbmAIFiBEGAgj0gAEJ680ICqr7BQvwowEM9PUNDdjbCQ7rEg-5lwYQtmkRq4IFEuJAE_M3FJgnFeLnBxbwoAUXAhiWoQMZ2PYDGgEbnz8cpoQGHol1H7MXIe3aCCLFvAEjhNUG",
      ],
      [
        1n,
        "AQEBAgIAAQO-mIMMBNbCngEFkxQGAQihEgn3_QQK9cwGC-1MDNXwBQ2UmREOtfMID5zMCBCzcBGiygIS4rQEE7uDAxSL4gQV2eECFunMAhjwxAMZ3qQDG9awCRzerAEdAR7y0A4f2pgBIcPdDCLmtQMjsoAE",
      ],
      [
        7n,
        "AQEHAgEAA-KWggcEh7TJAgXXGQYBCKK0CAnNjw0K2_wGC5aIAgyS2hENtNcWDoqOEA-n8gYQmucCEYTxCxK-uAMT3YUBFLmLAhXg6QcW2N8FGMhEGeNJGgEbxJIOHL-dAh6A2AMf2PUFIAIhmIENIoWjAyP7rAM",
      ],
      [
        40n,
        "AQEoAgEDA865_BQEn57DAwXOUQcCCKSVCQm3Fwr96QYLlGQM06kKDbavIA6itRAPkoYGEOvKAhHchw0S1LYEE-84FJGZAxW4hwkWquQCGPHWARnW0wUbvIoOHNIKHQEej_oCH-4XIZTDByLqEiPH8AE",
      ],
      [
        1132n,
        "AQHsCAICAQID0oI4BLveFwXMIgYCCOLeBAn32gYK_Y4KC6ldDKyjEg2c0ggOpsgGD6yCCBD3mAIR_voMEtmWAhOGuAMUyw0VhvkMFtiKAhcCGIzEBRnTnQIaARvpOBzx1QIdAR7opwcfnLAEIaGzCiLu-gQjuqUG",
      ],
    ];
    for (const [seed, dna] of U2_DNA) {
      expect(encodeGenome(sampleGenome(seed)), `seed ${seed}`).toBe(dna);
    }
  });

  test("sampleGenome(seed, 1): deterministic, plan 1, draws exactly shared + levitant loci", () => {
    for (const seed of [0n, 1n, 7n, 40n, 1132n]) {
      const a = sampleGenome(seed, 1);
      const b = sampleGenome(seed, 1);
      expect(encodeGenome(a)).toBe(encodeGenome(b));
      expect(getScalar(a, "meta.plan")).toBe(1);
      // Drawn ids = {0} ∪ shared scalars ∪ levitant scope (minus any
      // draw that happened to land on the default and dropped out).
      const legal = new Set([0, ...LOCUS_SCOPES.shared, ...LOCUS_SCOPES.levitant]);
      for (const id of a.values.keys()) {
        expect(legal.has(id), `levitant sample drew id ${id}`).toBe(true);
      }
      for (const id of LOCUS_SCOPES.quadruped) {
        expect(a.values.has(id), `quadruped locus ${id} on a levitant sample`).toBe(false);
      }
      // Shared loci draw from the same per-path streams as the
      // quadruped sample of the same seed (06 §4 stream keying).
      const q = sampleGenome(seed);
      for (const id of [3, 4, 5, 6, 13, 14, 15]) {
        expect(getScalar(a, id), `shared id ${id}`).toBe(getScalar(q, id));
      }
      expect(a.traitTags).toEqual(q.traitTags);
      expect(a.seed).toBe(seed);
    }
  });

  test("sampler rejects unknown plans", () => {
    expect(() => sampleGenome(0n, 2)).toThrow(RangeError);
    expect(() => sampleGenome(0n, -1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Grammar — the §2.1 node table, §2.3 rest geometry (spec raws)
// ---------------------------------------------------------------------------

describe("levitant grammar — the design 07 §2.3.1 node table", () => {
  test("11 nodes with the pinned identities, kinds, roles, chains, and symmetry groups", () => {
    const graph = growLevitant(LEV_DEFAULTS);
    expect(
      graph.parts.map((p) => [p.id, p.name, p.path, p.kind, p.materialRole, p.animChain, p.symmetry]),
    ).toEqual([
      [0, "orb", "body.core", "core", "hide", "body", "single"],
      [1, "sclera", "body.sensor[C]", "sensor", "underside", "body", "single"],
      [2, "iris", "body.sensor[C].iris", "sensor", "hide", "body", "single"],
      [3, "pupil", "body.sensor[C].pupil", "sensor", "focal", "body", "single"],
      [4, "wing_l", "body.locomotor[L]", "locomotor", "underside", "wing_l", "mirror:locomotors"],
      [5, "wing_r", "body.locomotor[R]", "locomotor", "underside", "wing_r", "mirror:locomotors"],
      [6, "horn_l", "body.ornament[L]", "ornament", "underside", "body", "mirror:ornaments"],
      [7, "horn_r", "body.ornament[R]", "ornament", "underside", "body", "mirror:ornaments"],
      [8, "tendril_0", "body.tendril[T:0]", "segment", "hide", "tendril_0", "serial:tendrils"],
      [9, "tendril_1", "body.tendril[T:1]", "segment", "hide", "tendril_1", "serial:tendrils"],
      [10, "tendril_2", "body.tendril[T:2]", "segment", "hide", "tendril_2", "serial:tendrils"],
    ]);
    expect(graph.plan).toBe("levitant");
    expect(graph.budget).toEqual({ used: 11, min: 8, max: 14 });
    expect(graph.mirrorBroken).toBe(false);
  });

  test("chain table: body {0,1,2,3,6,7} (non-contiguous is legal), wings, tendrils", () => {
    expect(LEVITANT_CHAINS.map((c) => [c.name, c.slabs])).toEqual([
      ["body", [0, 1, 2, 3, 6, 7]],
      ["wing_l", [4]],
      ["wing_r", [5]],
      ["tendril_0", [8]],
      ["tendril_1", [9]],
      ["tendril_2", [10]],
    ]);
    expect(growLevitant(LEV_DEFAULTS).chains).toEqual(LEVITANT_CHAINS);
    expect(LEVITANT_PART_NAMES.length).toBe(11);
    expect(LEVITANT_PART_ROLES.filter((r) => r === "focal")).toEqual(["focal"]); // pupil only
  });

  test("canonical socket order: body.core [sensor, locomotors, ornaments, tendrils]; sensor [iris, pupil]", () => {
    const orb = LEVITANT_PLAN.core.make(LEV_DEFAULTS, 0, 1);
    expect(orb.sockets!.map((s) => s.name)).toEqual([
      "sensor",
      "locomotors",
      "ornaments",
      "tendrils",
    ]);
    const sclera = orb.sockets![0]!.candidates[0]!.make(LEV_DEFAULTS, 0, 1);
    expect(sclera.sockets!.map((s) => s.name)).toEqual(["iris", "pupil"]);
  });

  test("all-defaults rest slabs are the adjudicated §2.3 raws (machine-verified table, incl. both 1-ulp notes)", () => {
    const graph = growLevitant(LEV_DEFAULTS);
    expect(graph.parts.map((p) => [...p.slab.center, ...p.slab.half])).toEqual([
      [0, 0, 786432, 353894, 340787, 353894], // orb (5.4, 5.2, 5.4) at z 12
      [0, 255590, 786432, 196608, 131072, 196608], // sclera (0, 3.9, 12)
      [0, 334233, 786432, 104858, 72090, 104858], // iris — y = 5.1 − 1 ulp (derivation is the pin)
      [0, 386662, 786432, 49152, 39322, 49152], // pupil (0, 5.9, 12)
      [-393216, -78643, 930611, 137626, 58982, 85197], // wing_l (−6.0, −1.2, 14.2)
      [393216, -78643, 930611, 137626, 58982, 85197], // wing_r
      [-222822, 65536, 1114112, 52429, 52429, 98304], // horn_l (−3.4, 1.0, 17.0)
      [222822, 65536, 1114112, 52429, 52429, 98304], // horn_r
      [0, 0, 380109, 58982, 58982, 85197], // tendril_0 (z 12 − 6.2)
      [0, 0, 268698, 49152, 49152, 85197], // tendril_1 (z 12 − 7.9)
      [0, 0, 157287, 39322, 39322, 85197], // tendril_2 — z = 2.4 + 1 ulp (drop 629145)
    ]);
  });

  test("growth consumes zero draws and keeps the 11-node structure for every genome", () => {
    const wantOrder = [...growLevitant(LEV_DEFAULTS).slabOrder];
    for (let seed = 0; seed < 50; seed++) {
      const graph = growLevitant(sampleGenome(BigInt(seed), 1));
      if (graph.drawsConsumed !== 0) expect.fail(`seed ${seed}: consumed draws`);
      if (graph.parts.length !== 11) expect.fail(`seed ${seed}: ${graph.parts.length} parts`);
      expect([...graph.slabOrder]).toEqual(wantOrder);
    }
  });

  test("coupling exactness at defaults: fp_mul(σ, 0) = 0 lands every anchor on its C raw", () => {
    expect(deriveLevitantAnchors(LEV_DEFAULTS)).toEqual({
      orbHx: 353894, // C 5.4
      orbHy: 340787, // C 5.2
      orbHz: 353894, // C 5.4
      z0: 786432, // 12.0
      sclY: 255590, // 5.2 − 1.3 = 3.9
    });
  });

  test("derived identities: DROP/SPACING forms, taper, pupil floors", () => {
    // Non-default tendril_len exercises the derived spacing.
    const g = makeGenome({
      values: [
        ["meta.plan", 1],
        ["body.core.tendril_len", 98304], // 1.5
        ["body.core.tendril_girth", 45875], // 0.7
        ["body.sensor[C].scale", 39322], // 0.6 — pupil floors engage
      ],
    });
    const graph = growLevitant(g);
    const z0 = 786432;
    const orbHz = 353894;
    const drop0 = orbHz - 32768 + 98304; // orb_hz − 0.5 + tl
    const spacing = 111411 + (98304 - 85197); // 1.7 + (tl − 1.3)
    expect(graph.parts[8]!.slab.center[2]).toBe(z0 - drop0);
    expect(graph.parts[9]!.slab.center[2]).toBe(z0 - drop0 - spacing);
    expect(graph.parts[10]!.slab.center[2]).toBe(z0 - drop0 - 2 * spacing);
    // Taper: plain int multiples of 9830.
    expect(graph.parts.slice(8).map((p) => p.slab.half[0])).toEqual([45875, 36045, 26215]);
    // Pupil floors: no rendered pupil smaller than the watcher's.
    expect([...graph.parts[3]!.slab.half]).toEqual([49152, 39322, 49152]);
    // Iris/sclera scale down un-floored.
    expect(graph.parts[2]!.slab.half[0]).toBe(fp_mul(39322, 104858));
  });
});

// ---------------------------------------------------------------------------
// Pose — the independent Python oracle, idle rule, envelopes, freezes
// ---------------------------------------------------------------------------

describe("levitant pose vectors match the from-spec Python oracle", () => {
  type OracleVectors = Record<string, Record<string, number[][][]>>;
  const oracle = JSON.parse(
    readFileSync(goldenPath("levitant_pose_oracle.v2.json"), "utf8"),
  ) as OracleVectors;

  const GENOMES: ReadonlyArray<[string, Genome]> = [
    ["defaults", LEV_DEFAULTS],
    [
      "nondefault",
      makeGenome({
        values: [
          ["meta.plan", 1],
          ["body.core.length", 786432],
          ["body.core.girth", 131072],
          ["body.core.depth", 393216],
          ["anim.levitant.hover_amp", 131072],
          ["anim.levitant.flap_ratio", 1],
          ["anim.levitant.tendril_lag", 8192],
          ["anim.levitant.tendril_amp", 65536],
          ["anim.levitant.anticipation", 98304],
          ["body.core.altitude", 753664],
          ["body.sensor[C].scale", 39322],
          ["body.core.locomotor_size", 117965],
          ["body.core.tendril_girth", 91750],
          ["body.core.tendril_len", 52429],
        ],
      }),
    ],
  ];

  for (const [label, genome] of GENOMES) {
    test(`${label}: all clip × phase slab lists, exact raws`, () => {
      let checks = 0;
      for (const clip of ALL_CLIPS) {
        const phases = clipPhases(CLIP_KS[clip]);
        phases.forEach((phi, k) => {
          const slabs = poseLevitant(genome, clip, phi);
          const expected = oracle[label]![clip]![k]!;
          expect(slabs.length).toBe(11);
          slabs.forEach((s, i) => {
            expect(
              [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz],
              `${label}/${clip}/f${k}/slab${i}`,
            ).toEqual(expected[i]);
            checks++;
          });
        });
      }
      expect(checks).toBe(11 * (4 + 4 + 4 + 2 + 4));
    });
  }
});

describe("levitant gait properties", () => {
  test("idle rule: flap 0 (wings ride the bob only), half amplitudes, frequency ignored", () => {
    const amp = makeGenome({
      values: [
        ["meta.plan", 1],
        ["anim.levitant.hover_amp", 99999], // odd — asr floor observable
      ],
    });
    const rest = growLevitant(amp).parts;
    // Idle bob peak at φ = 0.25 turns: b = asr(99999, 1) = 49999.
    const idle = poseLevitant(amp, "idle", 16384);
    expect(idle[0]!.cz - rest[0]!.slab.center[2]).toBe(49999);
    // Wings carry EXACTLY the bob delta — no flap term in idle.
    expect(idle[4]!.cz - rest[4]!.slab.center[2]).toBe(49999);
    expect(idle[5]!.cz - rest[5]!.slab.center[2]).toBe(49999);
    // Walk bob peak (h = 1, φ = 0.25): b = full amplitude; the wings'
    // DELTA differs from the orb's by the flap term
    // (sin(3·0.25 turns) = −1 → −1.6 = −104858).
    const walk = poseLevitant(amp, "walk", 16384);
    expect(walk[0]!.cz - rest[0]!.slab.center[2]).toBe(99999);
    expect(
      walk[4]!.cz - rest[4]!.slab.center[2] - (walk[0]!.cz - rest[0]!.slab.center[2]),
    ).toBe(-104858);
    // Frequency ignored in idle: h = 2 idles identically to h = 1.
    const h2 = makeGenome({
      values: [
        ["meta.plan", 1],
        ["anim.levitant.hover_amp", 99999],
        ["anim.levitant.hover_freq", 2],
      ],
    });
    for (const phi of clipPhases(4)) {
      expect(poseLevitant(h2, "idle", phi)).toEqual(poseLevitant(amp, "idle", phi));
    }
  });

  test("h = 2 freezes hover AND flap at the K = 4 phases (recorded degeneracy; tendrils stay alive via lag)", () => {
    const g = makeGenome({
      values: [
        ["meta.plan", 1],
        ["anim.levitant.hover_freq", 2],
        ["anim.levitant.hover_amp", 131072],
      ],
    });
    const rest = growLevitant(g).parts;
    for (const phi of clipPhases(4)) {
      const s = poseLevitant(g, "walk", phi);
      expect(s[0]!.cz, `orb φ=${phi}`).toBe(rest[0]!.slab.center[2]); // hover frozen
      expect(s[4]!.cz, `wing φ=${phi}`).toBe(rest[4]!.slab.center[2]); // flap frozen (sin(6φ) ≡ 0)
    }
    // Tendrils move (lagged signal is nonzero off the LUT zeros).
    const moved = clipPhases(4).some((phi) => {
      const s = poseLevitant(g, "walk", phi);
      return s[8]!.cx !== rest[8]!.slab.center[0];
    });
    expect(moved).toBe(true);
  });

  test("r = 2 freezes the flap at K = 4 (recorded degeneracy); hover stays alive", () => {
    const g = makeGenome({
      values: [
        ["meta.plan", 1],
        ["anim.levitant.flap_ratio", 2],
        ["anim.levitant.hover_amp", 131072],
      ],
    });
    const rest = growLevitant(g).parts;
    for (const phi of clipPhases(4)) {
      const s = poseLevitant(g, "walk", phi);
      // Wing cz − orb cz is constant = the rest offset (flap ≡ 0).
      expect(s[4]!.cz - s[0]!.cz).toBe(rest[4]!.slab.center[2] - rest[0]!.slab.center[2]);
    }
    expect(poseLevitant(g, "walk", 16384)[0]!.cz).not.toBe(rest[0]!.slab.center[2]);
  });

  test("one-shot clips are defined only at their K uniform phases", () => {
    expect(poseLevitant(LEV_DEFAULTS, "attack", 16384).length).toBe(11);
    expect(() => poseLevitant(LEV_DEFAULTS, "attack", 1)).toThrow(RangeError);
    expect(() => poseLevitant(LEV_DEFAULTS, "hurt", 16384)).toThrow(RangeError);
    expect(() => poseLevitant(LEV_DEFAULTS, "death", 65536)).toThrow(RangeError);
    expect(() => poseLevitant(LEV_DEFAULTS, "walk", 0.5)).toThrow(RangeError);
    expect(() => poseLevitant(LEV_DEFAULTS, "fly" as never, 0)).toThrow(RangeError);
  });

  test("death f3 IS f2 — identical slab lists (held final frame, wholesale)", () => {
    for (const seed of [0n, 3n, 7n]) {
      const g = sampleGenome(seed, 1);
      expect(poseLevitant(g, "death", 49152)).toEqual(poseLevitant(g, "death", 32768));
    }
  });

  test("death: TENDRIL_LIMP scales the tendril oscillator deltas only (lag preserved, hover untouched)", () => {
    const g = LEV_DEFAULTS;
    const rest = growLevitant(g).parts;
    const phases = clipPhases(4);
    for (const [k, limp] of [
      [0, 32768],
      [1, 16384],
      [2, 0],
    ] as const) {
      const death = poseLevitant(g, "death", phases[k]!);
      const idle = poseLevitant(g, "idle", phases[k]!);
      for (const i of [8, 9, 10]) {
        const idleTx = idle[i]!.cx - rest[i]!.slab.center[0];
        // Death tendril cx delta = fp_mul(limp, idle tx) exactly.
        expect(death[i]!.cx - rest[i]!.slab.center[0], `t${i - 8} f${k}`).toBe(
          fp_mul(limp, idleTx),
        );
      }
      // Body chain keeps the FULL idle hover (no limp on the bob).
      const idleBob = idle[0]!.cz - rest[0]!.slab.center[2];
      const sink = death[0]!.cz - rest[0]!.slab.center[2] - idleBob;
      expect(sink).toBeLessThanOrEqual(0); // pure sink beyond the bob
      // Stagger on every chain.
      expect(death[0]!.cy - rest[0]!.slab.center[1]).toBe(-49152);
      expect(death[4]!.cy - rest[4]!.slab.center[1]).toBe(-49152);
    }
  });

  test("death sink capacities at defaults: orb bottoms 0.99 px above ground at f2; nothing sinks below its own rest bottom capacity", () => {
    const s = poseLevitant(LEV_DEFAULTS, "death", 32768); // f2
    // Orb: rest cz 12, hz 5.4 → capacity raw 432538 (6.6 px); sink f2 =
    // fp_mul(55706, 432538) = 367660 (machine-verified in exact bigint
    // arithmetic); idle bob at φ = 0.5 turns is 0 → bottom =
    // 786432 − 367660 − 353894 = 64878 (0.98996 px above ground).
    const bottom = s[0]!.cz - s[0]!.hz;
    expect(bottom).toBe(64878);
    // Every slab stays at or above the ground line at every death frame.
    for (const phi of clipPhases(4)) {
      for (const slab of poseLevitant(LEV_DEFAULTS, "death", phi)) {
        expect(slab.cz - slab.hz).toBeGreaterThanOrEqual(-32768); // ≥ −0.5 px (tendril dip allowance)
      }
    }
  });

  test("anticipation scales the attack wind-up only, at both domain ends", () => {
    const lo = makeGenome({
      values: [["meta.plan", 1], ["anim.levitant.anticipation", 32768]],
    });
    const hi = makeGenome({
      values: [["meta.plan", 1], ["anim.levitant.anticipation", 131072]],
    });
    const phases = clipPhases(4);
    // f0 differs, f1..f3 identical.
    expect(poseLevitant(lo, "attack", 0)).not.toEqual(poseLevitant(hi, "attack", 0));
    for (let k = 1; k < 4; k++) {
      expect(poseLevitant(lo, "attack", phases[k]!)).toEqual(
        poseLevitant(hi, "attack", phases[k]!),
      );
    }
    // Exact f0 deltas: body dy −1.5 × ant.
    const rest = growLevitant(LEV_DEFAULTS).parts;
    const f0lo = poseLevitant(lo, "attack", 0);
    const f0hi = poseLevitant(hi, "attack", 0);
    expect(f0lo[0]!.cy - rest[0]!.slab.center[1]).toBe(fp_mul(32768, -98304));
    expect(f0hi[0]!.cy - rest[0]!.slab.center[1]).toBe(fp_mul(131072, -98304));
  });

  test("plan dispatch: poseCreature/growCreature follow meta.plan", () => {
    expect(poseCreature(LEV_DEFAULTS, "walk", 0).length).toBe(11);
    expect(poseCreature(makeGenome(), "walk", 0).length).toBe(13);
    expect(poseCreature(makeGenome(), "walk", 16384)).toEqual(
      poseQuadruped(makeGenome(), "walk", 16384),
    );
    expect(growCreature(LEV_DEFAULTS).plan).toBe("levitant");
    expect(growCreature(makeGenome()).plan).toBe("quadruped");
  });
});

// ---------------------------------------------------------------------------
// §2.3-corner worst-case table on the PRODUCTION fp path (design 07 §6.2)
// ---------------------------------------------------------------------------

describe("§2.3 corner worst-case table (production fp path)", () => {
  /** The 8 geometry loci swept lo/hi (ids 13–15 swept, never narrowed). */
  const GEO: ReadonlyArray<[string, number, number]> = [
    ["body.core.girth", 131072, 393216],
    ["body.core.length", 262144, 786432],
    ["body.core.depth", 131072, 393216],
    ["body.core.altitude", 753664, 851968],
    ["body.sensor[C].scale", 39322, 98304],
    ["body.core.locomotor_size", 32768, 117965],
    ["body.core.tendril_girth", 45875, 91750],
    ["body.core.tendril_len", 52429, 98304],
  ];

  function cornerGenome(bits: number, anim: ReadonlyArray<readonly [string, number]>): Genome {
    const values: Array<readonly [string, number]> = [["meta.plan", 1]];
    GEO.forEach(([path, lo, hi], i) => values.push([path, (bits >> i) & 1 ? hi : lo]));
    for (const [path, v] of anim) values.push([path, v]);
    return makeGenome({ values });
  }

  test("frame fit with 0.5 px snap margin: all 256 geometry corners × worst anim, every clip/phase/direction", { timeout: 120000 }, () => {
    // Worst-case anim: hover at its 2-px cap, anticipation 2 (deepest
    // attack rise), tendril swing at cap with max lag divergence.
    const anim: ReadonlyArray<readonly [string, number]> = [
      ["anim.levitant.hover_amp", 131072],
      ["anim.levitant.anticipation", 131072],
      ["anim.levitant.tendril_amp", 131072],
      ["anim.levitant.tendril_lag", 8192],
    ];
    // Screen bounds: sx ∈ [−16, 16], sy ∈ [−26.5, 5.5] px, kept with a
    // 0.5 px margin for the chain snap.
    const X_BOUND = 1015808; // 15.5 px
    const Y_MIN = -1703936; // −26 px
    const Y_MAX = 327680; // 5 px
    let minTop = Infinity;
    let minBottom = Infinity;
    for (let bits = 0; bits < 256; bits++) {
      const g = cornerGenome(bits, anim);
      for (const clip of ALL_CLIPS) {
        for (const phi of clipPhases(CLIP_KS[clip])) {
          const slabs = poseLevitant(g, clip, phi);
          for (const direction of DIRECTIONS) {
            const turns = DIRECTION_TURNS[direction];
            for (const slab of slabs) {
              const y = yawSlab(slab, turns);
              const syc = -y.cz - fp_mul(TILT_RAW, y.cy);
              const t = fp_mul(TILT_RAW, y.hy);
              const ry = fp_sqrt(fp_mul(y.hz, y.hz) + fp_mul(t, t));
              if (y.cx - y.hx < -X_BOUND || y.cx + y.hx > X_BOUND) {
                expect.fail(`corner ${bits} ${clip} φ${phi} ${direction}: x overflow`);
              }
              if (syc - ry < Y_MIN || syc + ry > Y_MAX) {
                expect.fail(
                  `corner ${bits} ${clip} φ${phi} ${direction}: y overflow (${syc - ry}, ${syc + ry})`,
                );
              }
              minTop = Math.min(minTop, (syc - ry) - Y_MIN);
              minBottom = Math.min(minBottom, Y_MAX - (syc + ry));
            }
          }
        }
      }
    }
    // The binding margins exist (sanity that the sweep actually bit).
    expect(minTop).toBeGreaterThanOrEqual(0);
    expect(minBottom).toBeGreaterThanOrEqual(0);
  });

  test("rest attachment identities hold at every geometry corner", () => {
    for (let bits = 0; bits < 256; bits++) {
      const g = cornerGenome(bits, []);
      const parts = growLevitant(g).parts;
      const orb = parts[0]!.slab;
      const wing = parts[5]!.slab; // +x member
      const horn = parts[7]!.slab;
      // Wing–orb x overlap = 2.1w − 0.6 ≥ 0.45 px (constant flank gap).
      const wingOverlap = orb.center[0] + orb.half[0] - (wing.center[0] - wing.half[0]);
      expect(wingOverlap, `corner ${bits} wing overlap`).toBeGreaterThanOrEqual(29491);
      // Wing z interval intersects the orb's at rest.
      expect(wing.center[2] - wing.half[2]).toBeLessThan(orb.center[2] + orb.half[2]);
      expect(wing.center[2] + wing.half[2]).toBeGreaterThan(orb.center[2] - orb.half[2]);
      // Horn: constant 1.1 px protrusion above the orb top; 1.9 px z overlap.
      const orbTop = orb.center[2] + orb.half[2];
      expect(horn.center[2] + horn.half[2] - orbTop, `corner ${bits} horn protrusion`).toBe(72090);
      expect(orbTop - (horn.center[2] - horn.half[2]), `corner ${bits} horn overlap`).toBe(124518);
      // Horn x interval stays on the orb (never out-runs the flank).
      expect(horn.center[0] - horn.half[0]).toBeLessThan(orb.center[0] + orb.half[0]);
      // Tendril_0 hangs at constant 0.5 px overlap with the orb bottom.
      const t0 = parts[8]!.slab;
      expect(t0.center[2] + t0.half[2] - (orb.center[2] - orb.half[2]), `corner ${bits} t0`).toBe(
        32768,
      );
      // Adjacent tendrils keep z-overlap tl − 0.4 ≥ 0.4 px.
      for (const [a, b] of [
        [8, 9],
        [9, 10],
      ] as const) {
        const za = parts[a]!.slab;
        const zb = parts[b]!.slab;
        const overlap = zb.center[2] + zb.half[2] - (za.center[2] - za.half[2]);
        expect(overlap, `corner ${bits} tendrils ${a}-${b}`).toBeGreaterThanOrEqual(26214);
      }
    }
  });

  test("adjacent-tendril x-gap ≤ 0.5 px at sampled phases (anim defaults, geometry corners)", () => {
    for (let bits = 0; bits < 256; bits++) {
      const g = cornerGenome(bits, []);
      for (const clip of ["walk", "idle"] as const) {
        for (const phi of clipPhases(4)) {
          const s = poseLevitant(g, clip, phi);
          for (const [a, b] of [
            [8, 9],
            [9, 10],
          ] as const) {
            const gap =
              Math.abs(s[a]!.cx - s[b]!.cx) - (s[a]!.hx + s[b]!.hx);
            expect(gap, `corner ${bits} ${clip} φ${phi} t${a - 8}/t${b - 8}`).toBeLessThanOrEqual(
              32768,
            );
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Export — goldens, shadow seam, plan dispatch (design 07 §3)
// ---------------------------------------------------------------------------

const LEV_GOLDEN_SHEET_PNG_SHA256 =
  "7fef414131a41c63b7fdd6d464b6b0e487eed42c9251c540c2bdd640658de965";
const LEV_GOLDEN_SHEET_RGBA_SHA256 =
  "be0217c318aedb0c4ffabfffa355c4f1ca12cb6a171837685221dcc8ada74ae2";
const LEV_GOLDEN_JSON_SHA256 =
  "1ed5352684f8d71b490ee147c2cabace7b209724bb91e6b108f848c8f80e23ae";

describe("the all-defaults levitant golden (pinned after the provenance ritual)", () => {
  const EXPORT = exportCreature(LEV_DEFAULTS);

  test("sheet PNG + sheet RGBA + JSON SHA-256s", () => {
    expect(EXPORT.sheetPngSha256).toBe(LEV_GOLDEN_SHEET_PNG_SHA256);
    expect(EXPORT.sheetRgbaSha256).toBe(LEV_GOLDEN_SHEET_RGBA_SHA256);
    expect(EXPORT.jsonSha256).toBe(LEV_GOLDEN_JSON_SHA256);
  });

  test("the committed golden FILES byte-match a fresh render", () => {
    expect(
      Buffer.from(EXPORT.sheetPng).equals(readFileSync(goldenPath("levitant.sheet.png"))),
    ).toBe(true);
    expect(readFileSync(goldenPath("levitant.json"), "utf8")).toBe(EXPORT.json);
  });

  test("schema: 72 frames, 128×640, genome AQAC, hurt flash, mirror false — plan-independent", () => {
    const meta = JSON.parse(EXPORT.json) as {
      frames: unknown[];
      genome: string;
      generator_version: number;
      sheet: { cell: number; h: number; w: number };
      clips: Record<string, Record<string, { flash?: boolean; mirror: boolean }>>;
    };
    expect(meta.frames.length).toBe(72);
    expect(meta.genome).toBe("AQAC");
    expect(meta.generator_version).toBe(2);
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

  test("levitant shadow = the core chain {0,1,2,3,6,7} extent (independent in-test arithmetic)", () => {
    const meta = JSON.parse(EXPORT.json) as {
      hitboxes: Array<{ shadow: { cx_fp: number; cy_fp: number; rx_fp: number; ry_fp: number } }>;
    };
    // Recompute frame 0 (walk/down f0) from the slab list + offsets.
    const slabLists = clipPhases(4).map((phi) => poseLevitant(LEV_DEFAULTS, "walk", phi));
    const offsets = snapOffsets(slabLists, "down", LEVITANT_CHAINS);
    const turns = DIRECTION_TURNS.down;
    let bMinX = Infinity;
    let bMaxX = -Infinity;
    for (const i of [0, 1, 2, 3, 6, 7]) {
      const y = yawSlab(slabLists[0]![i]!, turns);
      const cx = y.cx + offsets[0]![i]!.dx;
      bMinX = Math.min(bMinX, cx - y.hx);
      bMaxX = Math.max(bMaxX, cx + y.hx);
    }
    const rx = asr(bMaxX - bMinX, 1);
    expect(meta.hitboxes[0]!.shadow).toEqual({
      cx_fp: 1048576 + asr(bMinX + bMaxX, 1),
      cy_fp: 1736704, // ground-line anchored — altitude modulates NOTHING
      rx_fp: rx,
      ry_fp: asr(rx, 2),
    });
    // Every levitant shadow sits on the ground line.
    for (const hb of meta.hitboxes) expect(hb.shadow.cy_fp).toBe(1736704);
  });

  test("one sampled levitant (seed 0): pinned RGBA hash, deterministic", { timeout: 60000 }, () => {
    const out = exportCreature(sampleGenome(0n, 1));
    expect(out.sheetRgbaSha256).toBe(
      "838fd7f79ca386de0272d45332bad5af6c0512f9ac8b08259f3206d11aa1f9a2",
    );
  });
});

// ---------------------------------------------------------------------------
// Flicker CI corpus (design 07 §6.1: scaled — the 200-seed histogram is
// unit evidence in the design amendment, not CI)
// ---------------------------------------------------------------------------

describe("levitant flicker gates (CI corpus: defaults + seeds 0..9, all clips)", () => {
  test("levitant gate row holds on levitant cells; death held pair scores exactly 0.0; no INF", { timeout: 600000 }, () => {
    // Per-(plan, clip) tables (§4.2 U3 amendment): levitant cells assert
    // the levitant row, calibrated on the levitant's own §4.4.6 addendum
    // histograms; the quadruped row stays the U2 pins. CI corpus scaled
    // to defaults + seeds 0..9 for the ~180 s suite budget (§2.3.1
    // suite-time accounting); the 200-seed histograms are the recorded
    // unit evidence.
    expect(FLICKER_GATES.levitant).toEqual({
      walk: { num: 22n, den: 1n },
      idle: { num: 22n, den: 1n },
      attack: { num: 87n, den: 1n },
      hurt: { num: 22n, den: 1n },
      death: { num: 19n, den: 1n },
    });
    const genomes: Genome[] = [LEV_DEFAULTS];
    for (let seed = 0; seed < 10; seed++) genomes.push(sampleGenome(BigInt(seed), 1));
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
});

// ---------------------------------------------------------------------------
// Sensor visibility CI (design 07 §6.2 scaled corpus)
// ---------------------------------------------------------------------------

describe("sensor visibility (CI: seeds 0..49, down view, walk φ0 — scaled from the 2000-seed unit sweep)", () => {
  test("every levitant shows ≥ 1 focal pixel", { timeout: 600000 }, () => {
    for (let seed = 0; seed < 50; seed++) {
      const genome = sampleGenome(BigInt(seed), 1);
      const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
      const slabLists = clipPhases(4).map((phi) => poseLevitant(genome, "walk", phi));
      const offsets = snapOffsets(slabLists, "down", LEVITANT_CHAINS);
      const rawGrids = slabLists.map((slabs, f) =>
        rasterize(slabs, "down", 32, rampLen, offsets[f]!),
      );
      const { grids } = craftClip(rawGrids);
      let focal = 0;
      for (const row of grids[0]!) {
        for (const px of row) if (px !== null && px.role === "focal") focal++;
      }
      if (focal < 1) expect.fail(`seed ${seed}: zero focal pixels in the down view`);
    }
  });
});

// ---------------------------------------------------------------------------
// Craft idempotence on the levitant (R4)
// ---------------------------------------------------------------------------

describe("craft idempotence — levitant corpus (defaults + seeds 0..4, all clips)", () => {
  test("second craft pass is a no-op on every cell", { timeout: 600000 }, () => {
    const genomes: Genome[] = [LEV_DEFAULTS];
    for (let seed = 0; seed < 5; seed++) genomes.push(sampleGenome(BigInt(seed), 1));
    for (const [gi, genome] of genomes.entries()) {
      const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
      for (const clip of ALL_CLIPS) {
        const slabLists = clipPhases(CLIP_KS[clip]).map((phi) =>
          poseLevitant(genome, clip, phi),
        );
        for (const direction of DIRECTIONS) {
          const offsets = snapOffsets(slabLists, direction, LEVITANT_CHAINS);
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

// ---------------------------------------------------------------------------
// The flicker metric consumes levitant slab lists (11-slab energy)
// ---------------------------------------------------------------------------

describe("flicker plumbing accepts the 11-slab levitant lists", () => {
  test("renderClipCells returns 11-slab lists for a levitant and 13 for a quadruped", () => {
    const lev = renderClipCells(LEV_DEFAULTS, "idle");
    expect(lev.down.slabLists[0]!.length).toBe(11);
    const quad = renderClipCells(makeGenome(), "idle");
    expect(quad.down.slabLists[0]!.length).toBe(13);
  });
});
