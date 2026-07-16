/**
 * U2 — the M2 clip set (design 07 §4): envelopes, the anticipation
 * locus, the one-shot flicker policy, the permanent M1 anchor law, and
 * the seed-1132 cycle-breaker verdict.
 *
 * Oracle provenance: the envelope pose vectors in
 * tests/goldens/envelope_oracle.v2.json were computed by an independent
 * from-spec Python oracle (scratchpad envelope_oracle.py, 2026-07-11 —
 * reimplements the design 06 §5 fixed-point kernel, the §5.3 LUT from
 * its defining formula, the §1.2 default-wolf rest slabs, the idle
 * oscillators, and the design 07 §4.4 envelope tables), NEVER by running
 * this implementation. The v1 anchor fixtures (tests/goldens/*.v1.*)
 * were rendered by the committed M1 build (510e0df) before any U2 code
 * change; the defaults pair is the original M1 golden file, renamed.
 * The 2001-genome inertness proof of the §4.4 cycle-breaker (baseline
 * vs v2 anchor comparison) ran 2026-07-11; fingerprints in the §4.3
 * amendment.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { craftClip, rule2Sequential, snapOffsets } from "../src/craft.js";
import { canonicalJson, exportCreature, sha256Hex } from "../src/export.js";
import type { JsonValue } from "../src/export.js";
import {
  FLICKER_GATES,
  evaluateCell,
  measureClipFlicker,
  renderClipCells,
} from "../src/flicker.js";
import { decodeGenome, encodeGenome, getScalar, makeGenome, sampleGenome } from "../src/genome.js";
import type { Genome } from "../src/genome.js";
import { CLIP_KS, ONE_SHOT_CLIPS, clipPhases, poseQuadruped } from "../src/pose.js";
import type { ClipName } from "../src/pose.js";
import { DIRECTIONS, rasterize } from "../src/raster.js";

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./goldens/${name}`, import.meta.url));

// ---------------------------------------------------------------------------
// The permanent M1 anchor law (design 07 §4.3, decision-pinned at U2):
// for any v1 genome, the v2 sheet's rows y ∈ [0, 256) are byte-equal to
// the v1 sheet, and the v1 SUBSET of the JSON is value-equal. Fixtures:
// the committed M1 renders of {defaults, seeds 0, 1, 7, 40, 1142}.
// ---------------------------------------------------------------------------

describe("M1 anchors — v1 fixtures vs the v2 render (design 07 §4.3)", () => {
  const ANCHOR_GENOMES: ReadonlyArray<[string, () => Genome]> = [
    ["defaults", () => makeGenome()],
    ["seed0", () => sampleGenome(0n)],
    ["seed1", () => sampleGenome(1n)],
    ["seed7", () => sampleGenome(7n)],
    ["seed40", () => sampleGenome(40n)],
    ["seed1142", () => sampleGenome(1142n)],
  ];

  for (const [name, make] of ANCHOR_GENOMES) {
    test(`${name}: sheet rows [0, 256) byte-equal; v1 JSON subset value-equal`, { timeout: 60000 }, async () => {
      const out = exportCreature(make());
      // Anchor 1: the first 256 sheet rows re-encoded with the pinned §6
      // PNG recipe must be byte-identical to the committed v1 sheet PNG
      // (the encoder is deterministic, so PNG equality ⟺ RGBA equality).
      const { encodePng } = await import("../src/png.js");
      const first256 = out.sheetRgba.subarray(0, 128 * 256 * 4);
      const v1Png = readFileSync(goldenPath(`${name === "defaults" ? "defaults" : name}.v1.sheet.png`));
      expect(
        Buffer.from(encodePng(first256, 128, 256)).equals(v1Png),
        `${name} sheet anchor`,
      ).toBe(true);
      // Anchor 2: the v1 subset of the metadata, canonically serialized.
      const v2meta = JSON.parse(out.json) as Record<string, JsonValue>;
      const v1meta = JSON.parse(
        readFileSync(goldenPath(`${name === "defaults" ? "defaults" : name}.v1.json`), "utf8"),
      ) as Record<string, JsonValue>;
      const subset = (meta: Record<string, JsonValue>, v2: boolean): string => {
        const clips = meta.clips as Record<string, JsonValue>;
        const frames = meta.frames as JsonValue[];
        const hitboxes = meta.hitboxes as JsonValue[];
        return canonicalJson({
          clips: { idle: clips.idle!, walk: clips.walk! },
          frames: v2 ? frames.slice(0, 32) : frames,
          hitboxes: v2 ? hitboxes.slice(0, 32) : hitboxes,
          palette: meta.palette!,
        });
      };
      expect(subset(v2meta, true)).toBe(subset(v1meta, false));
      // The only permitted top-level diffs (§4.3): generator_version,
      // the appended frames/clips/hitboxes, sheet.h, and — because the
      // U2 sampler draws the appended locus 35 — the genome tape.
      expect(v1meta.generator_version).toBe(1);
      expect(v2meta.generator_version).toBe(2);
      expect((v1meta.sheet as { h: number }).h).toBe(256);
      expect((v2meta.sheet as { h: number }).h).toBe(640);
    });
  }
});

// ---------------------------------------------------------------------------
// Envelope pose vectors — the independent Python oracle (design 07 §4.4)
// ---------------------------------------------------------------------------

describe("envelope pose vectors match the from-spec Python oracle", () => {
  type OracleVectors = Record<string, Record<string, number[][][]>>;
  const oracle = JSON.parse(readFileSync(goldenPath("envelope_oracle.v2.json"), "utf8")) as OracleVectors;

  const GENOMES: ReadonlyArray<[string, Genome]> = [
    ["defaults", makeGenome()],
    // A non-default anticipation (1.5): scales ONLY the attack wind-up.
    ["anticipation_1.5", makeGenome({ values: [["anim.quadruped.anticipation", 98304]] })],
  ];

  for (const [label, genome] of GENOMES) {
    test(`${label}: all one-shot clip × phase slab lists, exact raws`, () => {
      let checks = 0;
      for (const clip of ["attack", "hurt", "death"] as const) {
        const phases = clipPhases(CLIP_KS[clip]);
        phases.forEach((phi, k) => {
          const slabs = poseQuadruped(genome, clip, phi);
          const expected = oracle[label]![clip]![k]!;
          expect(slabs.length).toBe(13);
          slabs.forEach((s, i) => {
            expect(
              [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz],
              `${label}/${clip}/f${k}/slab${i}`,
            ).toEqual(expected[i]);
            checks++;
          });
        });
      }
      expect(checks).toBe(13 * (4 + 2 + 4));
    });
  }

  test("anticipation scales the wind-up only: f1..f3 equal across the two genomes", () => {
    const phases = clipPhases(4);
    for (let k = 1; k < 4; k++) {
      expect(poseQuadruped(GENOMES[1]![1], "attack", phases[k]!)).toEqual(
        poseQuadruped(GENOMES[0]![1], "attack", phases[k]!),
      );
    }
    expect(poseQuadruped(GENOMES[1]![1], "attack", 0)).not.toEqual(
      poseQuadruped(GENOMES[0]![1], "attack", 0),
    );
  });

  test("death f3 IS f2 — identical slab lists (the held final frame)", () => {
    const g = sampleGenome(3n);
    expect(poseQuadruped(g, "death", 49152)).toEqual(poseQuadruped(g, "death", 32768));
  });
});

// ---------------------------------------------------------------------------
// Registry append — locus 35 wire behavior (design 07 §4.3; 06 §3 law)
// ---------------------------------------------------------------------------

describe("locus 35 wire behavior", () => {
  test("a v1-era DNA string decodes unchanged (the §3.4 worked example)", () => {
    const g = decodeGenome("AQEqA4CA2AsMtOYEG4CABA");
    expect(g.seed).toBe(42n);
    expect(getScalar(g, "anim.quadruped.anticipation")).toBe(65536); // absent = default
    expect(encodeGenome(g)).toBe("AQEqA4CA2AsMtOYEG4CABA"); // round-trips byte-identically
  });

  test("the default anticipation serializes ABSENT; non-defaults round-trip", () => {
    expect(encodeGenome(makeGenome())).toBe("AQ"); // still the 1-byte defaults tape
    expect(
      encodeGenome(makeGenome({ values: [["anim.quadruped.anticipation", 65536]] })),
    ).toBe("AQ");
    const g = makeGenome({ values: [["anim.quadruped.anticipation", 98304]] });
    const decoded = decodeGenome(encodeGenome(g));
    expect(getScalar(decoded, 35)).toBe(98304);
  });

  test("a v1 DNA string renders v2-identically to its explicit-default twin", () => {
    // Wire law consequence: absent anticipation IS raw 65536, so the two
    // genomes are one genome — same canonical object, same export bytes.
    const absent = decodeGenome("AQEq"); // seed 42, nothing else
    const explicit = makeGenome({ seed: 42n, values: [[35, 65536]] });
    expect(absent).toEqual(explicit);
  });
});

// ---------------------------------------------------------------------------
// One-shot flicker policy (design 07 §4.2)
// ---------------------------------------------------------------------------

describe("one-shot flicker policy", () => {
  test("one-shot roster (the gate TABLE pin is single-sourced in tests/flicker-gates.test.ts — U4 consolidation)", () => {
    // The per-(plan, clip) gate table (design 07 §4.2) is asserted by
    // exactly ONE module, tests/flicker-gates.test.ts: the U3 close-out
    // found duplicate pins here AND in levitant.test.ts — a silent-
    // divergence risk. This file keeps the quadruped BEHAVIORAL gate
    // tests (below); the quadruped cells still assert their own row
    // through measureClipFlicker.
    expect(FLICKER_GATES.quadruped).toBeDefined();
    expect([...ONE_SHOT_CLIPS].sort()).toEqual(["attack", "death", "hurt"]);
    expect(CLIP_KS).toEqual({ walk: 4, idle: 4, attack: 4, hurt: 2, death: 4 });
  });

  test("no wrap, structurally: K frames yield K−1 pairs (3/1/3)", { timeout: 120000 }, () => {
    const genome = makeGenome();
    for (const [clip, pairs] of [
      ["attack", 3],
      ["hurt", 1],
      ["death", 3],
    ] as const) {
      const cells = measureClipFlicker(genome, clip);
      for (const direction of DIRECTIONS) {
        expect(cells[direction].pairs.length, `${clip}/${direction}`).toBe(pairs);
      }
    }
    // Looping clips keep the wrap pair: K pairs.
    const walk = measureClipFlicker(genome, "walk");
    expect(walk.down.pairs.length).toBe(4);
  });

  test("evaluateCell wrap:false drops exactly the (K−1, 0) pair", () => {
    const slabs = poseQuadruped(makeGenome(), "idle", 0);
    const a = new Uint8Array(32 * 32 * 4);
    const b = new Uint8Array(a);
    b[0] = 255;
    b[3] = 255;
    // Frames [a, a, b]: consecutive pairs (a,a), (a,b); wrap adds (b,a).
    const wrapped = evaluateCell([a, a, b], [slabs, slabs, slabs], "down");
    const oneShot = evaluateCell([a, a, b], [slabs, slabs, slabs], "down", { wrap: false });
    expect(wrapped.pairs.length).toBe(3);
    expect(oneShot.pairs.length).toBe(2);
    expect(oneShot.pairs[0]!.changed).toBe(0);
    expect(oneShot.pairs[1]!.changed).toBe(1);
  });

  test("death's held pair: 0 changed at 0 motion = 0.0 = pass (defaults)", { timeout: 60000 }, () => {
    const cells = measureClipFlicker(makeGenome(), "death");
    for (const direction of DIRECTIONS) {
      const held = cells[direction].pairs[2]!; // (f2, f3)
      expect(held.changed).toBe(0);
      expect(held.energy).toBe(0n);
      expect(held.infinite).toBe(false);
      expect(held.pass).toBe(true);
    }
  });

  test(
    "CI gate: seeds 0..49 × {attack, hurt, death} × 4 directions all pass, no INF",
    { timeout: 600000 },
    () => {
      for (let seed = 0; seed < 50; seed++) {
        const genome = sampleGenome(BigInt(seed));
        for (const clip of ["attack", "hurt", "death"] as const) {
          const cells = measureClipFlicker(genome, clip);
          for (const direction of DIRECTIONS) {
            const cell = cells[direction];
            for (const pair of cell.pairs) {
              expect(pair.infinite, `seed ${seed} ${clip} ${direction} INF`).toBe(false);
            }
            expect(cell.pass, `seed ${seed} ${clip} ${direction} gate`).toBe(true);
          }
        }
      }
    },
  );
});

// ---------------------------------------------------------------------------
// The seed-1132 verdict (design 07 §4.4): the craft cycle-breaker
// ---------------------------------------------------------------------------

describe("seed 1132 — the craft fixpoint cycle-breaker (design 07 §4.4)", () => {
  test("the v1 trap genome now exports; its v2 output is golden", { timeout: 120000 }, () => {
    const out = exportCreature(sampleGenome(1132n));
    // Pinned after the 2001-genome inertness proof (2026-07-11): every
    // non-trapped genome's anchors are byte-identical with the breaker
    // in the tree; 1132 gains output where none existed.
    expect(out.sheetRgbaSha256).toBe(
      "4701843b52713b6739f7c88b097cad4fc1cd800a112442bce932829ddd2df02d",
    );
    expect(out.sheetPngSha256).toBe(
      "886939a67ff8b88b64dff77aa49459bb91a91a55cd728f29d95dfa74543ac23d",
    );
    expect(sha256Hex(new TextEncoder().encode(out.json))).toBe(out.jsonSha256);
    expect(out.jsonSha256).toBe(
      "545ca06da559760114481b75cd7314fc789846b3f61809711ea5c9f79d402e89",
    );
  });

  test("the trapped cell converges via the breaker and is idempotent", { timeout: 60000 }, () => {
    const genome = sampleGenome(1132n);
    const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
    const phases = clipPhases(4);
    const slabLists = phases.map((phi) => poseQuadruped(genome, "walk", phi));
    const offsets = snapOffsets(slabLists, "down");
    const rawGrids = slabLists.map((slabs, f) =>
      rasterize(slabs, "down", 32, rampLen, offsets[f]!),
    );
    const one = craftClip(rawGrids);
    expect(one.info.cycleBroken).toBe(true);
    // Idempotence (constraint row 2) now covers the broken cell: the
    // second pass converges immediately WITHOUT the breaker.
    const two = craftClip(one.grids);
    expect(two.info.cycleBroken).toBe(false);
    expect(two.info.workRounds).toBe(0);
    expect(two.grids).toEqual(one.grids);
  });

  test("rule2Sequential settles a mutual-donor island pair (the 1132 pattern)", () => {
    // Two vertically adjacent interior islands whose dominant donor is
    // each other — the exact simultaneous-update 2-cycle. Layout (roles
    // h = hide, u = underside, f = focal; tones as digits):
    //         f2
    //   u3    h2    h3
    //   u3    h1    h3
    //         u1
    const P = (role: "hide" | "underside" | "focal", tone: number): NonNullable<unknown> => ({
      role,
      tone,
      partId: 0,
      depthRaw: 0,
      edge: 0,
    });
    type Grid = ReturnType<typeof craftClip>["grids"][number];
    const grid = [
      [null, P("focal", 2), null],
      [P("underside", 3), P("hide", 2), P("hide", 3)],
      [P("underside", 3), P("hide", 1), P("hide", 3)],
      [null, P("underside", 1), null],
    ] as Grid;
    const changes = rule2Sequential(grid);
    expect(changes).toBeGreaterThan(0);
    // Settled: the scan-first island adopted its partner's key, so the
    // partner now shares a (role, tone) neighbor and both are stable.
    const again = rule2Sequential(grid);
    expect(again).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property sweep — the new clips over sampled genomes (design 07 §8 U2)
// ---------------------------------------------------------------------------

describe("property sweep — new clips", () => {
  test(
    "seeds 0..49: every one-shot cell renders; craft output properties hold",
    { timeout: 600000 },
    () => {
      // CI corpus scaled from U2's 200 seeds to 50 for the ~180 s suite
      // budget (design 07 §2.3.1 suite-time accounting) — this file was
      // the suite's longest and bounds its wall time; the 200-seed run
      // is recorded U2 unit evidence.
      for (let seed = 0; seed < 50; seed++) {
        const genome = sampleGenome(BigInt(seed));
        for (const clip of ["attack", "hurt", "death"] as const) {
          const cells = renderClipCells(genome, clip);
          for (const direction of DIRECTIONS) {
            const frames = cells[direction].rgbaFrames;
            expect(frames.length).toBe(CLIP_KS[clip]);
            for (const rgba of frames) {
              expect(rgba.length).toBe(32 * 32 * 4);
              // §6 pin: transparent pixels are exactly (0,0,0,0).
              for (let p = 0; p < rgba.length; p += 4) {
                if (rgba[p + 3] === 0) {
                  if (rgba[p] !== 0 || rgba[p + 1] !== 0 || rgba[p + 2] !== 0) {
                    throw new Error(
                      `seed ${seed} ${clip}/${direction}: hidden color under zero alpha`,
                    );
                  }
                }
              }
            }
          }
        }
      }
    },
  );

  test(
    "craft idempotence extends to the new cells (seeds 0..9, all one-shot clips)",
    { timeout: 600000 },
    () => {
      for (let seed = 0; seed < 10; seed++) {
        const genome = sampleGenome(BigInt(seed));
        const rampLen = getScalar(genome, "palette.ramp_len") as 3 | 4 | 5;
        for (const clip of ["attack", "hurt", "death"] as const) {
          const phases = clipPhases(CLIP_KS[clip]);
          const slabLists = phases.map((phi) => poseQuadruped(genome, clip, phi));
          for (const direction of DIRECTIONS) {
            const offsets = snapOffsets(slabLists, direction);
            const rawGrids = slabLists.map((slabs, f) =>
              rasterize(slabs, direction, 32, rampLen, offsets[f]!),
            );
            const one = craftClip(rawGrids);
            const two = craftClip(one.grids);
            expect(two.grids, `seed ${seed} ${clip}/${direction}`).toEqual(one.grids);
          }
        }
      }
    },
  );

  test("goldens byte-identical across two consecutive full runs (defaults + 1132)", { timeout: 240000 }, () => {
    for (const make of [() => makeGenome(), () => sampleGenome(1132n)]) {
      const a = exportCreature(make());
      const b = exportCreature(make());
      expect(b.rgbaSha256).toEqual(a.rgbaSha256);
      expect(b.pngSha256).toEqual(a.pngSha256);
      expect(b.sheetRgbaSha256).toBe(a.sheetRgbaSha256);
      expect(Buffer.from(b.sheetPng).equals(Buffer.from(a.sheetPng))).toBe(true);
      expect(b.json).toBe(a.json);
    }
  });
});

// ---------------------------------------------------------------------------
// Clip type surface
// ---------------------------------------------------------------------------

describe("clip surface", () => {
  test("frame counts sum to the pinned 72", () => {
    const clips: ClipName[] = ["walk", "idle", "attack", "hurt", "death"];
    expect(clips.reduce((n, c) => n + CLIP_KS[c] * 4, 0)).toBe(72);
  });
});
