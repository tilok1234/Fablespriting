/**
 * U5 — degeneracy defenses + trait tags + form-follows-function
 * (design 07 §5.1/§6.1, the adjudicated U5 spec): registry append 51–55
 * + the gated scope, weighted socket fills (tag→weight tables, the H1
 * engine law), the clearance/placement machinery (place:0..2, drop
 * semantics, stream isolation), the sampler modes (forced tags,
 * temperament priors, FFF presets, gated draws, self-check re-roll),
 * the readability self-check (bands, metrics, the degenerate manifest
 * flag), the §4.4.4 emitter orientation activation, wire behavior, and
 * the anchor-razor CI fingerprint.
 *
 * Oracle provenance: tests/goldens/u5_pose_oracle.v2.json was computed
 * by an independent from-spec Python oracle (scratchpad
 * u5-oracle/u5_pose_oracle.py, 2026-07-16 — reimplements the design 06
 * §5 kernel, the §5.3 LUT from its defining formula, design 06 §4 PCG32
 * from its published check vector for the independent kind/place draws,
 * and the three plans' geometry/oscillators/envelopes plus the U5
 * ornament/emitter tables from the spec text), NEVER by running this
 * implementation. Cross-matched 7632 fields exact before pinning.
 * RE-SCOPED at M3/V1 (design 08 §2.1), never re-pinned: the oracle's
 * raws stay the base, and the ONE quantity V1 introduces — a rigid
 * per-chain model-y translation at growth time — is added from the
 * shipped classifier with its raws asserted alongside. Five of the six
 * oracle genomes assert the original vectors unmodified (quadruped
 * `ornamented` is in the byte-stable partition; levitant and amorphous
 * are untouched plans).
 *
 * Anchor-razor fingerprint: tests/goldens/u5_anchor_33.txt was captured
 * from the PRISTINE cffb2a0 build (the unit's baseline protocol §1.5)
 * — plans × (defaults + seeds 0..9), sheet-RGBA + JSON sha256 — and the
 * suite re-derives every entry from the live build each run: any byte
 * movement on the shipped default path fails here. RE-PINNED at V1
 * (generator v3): every JSON hash moves with the version stamp, and the
 * quadruped sheet hashes move for the fitted seeds — the V1 razor
 * (design 08 §2.1.7) is what proves the rest byte-identical.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { fp_mul, rheDiv } from "../src/fixed.js";
import { exportCreature } from "../src/export.js";
import { evaluateCell, measureClipFlicker } from "../src/flicker.js";
import {
  FFF_PRESETS,
  LOCUS_SCOPES,
  PLAN_NAMES,
  REGISTRY,
  SELF_CHECK_REROLL,
  TEMPERAMENT,
  decodeGenome,
  encodeGenome,
  getScalar,
  makeGenome,
  sampleGenome,
} from "../src/genome.js";
import type { Genome, ScalarLocus } from "../src/genome.js";
import {
  EMIT_HALF,
  ORNAMENT_TAG_WEIGHTS,
  PLACE_RETRY_CAP,
  QUADRUPED_PLAN,
  LEVITANT_PLAN,
  AMORPHOUS_PLAN,
  classifyQuadruped,
  growPlan,
} from "../src/grammar.js";
import type { PartChoice, PartInit, PlanSpec, SocketSpec } from "../src/grammar.js";
import { createStream } from "../src/prng.js";
import {
  SELF_CHECK_BANDS,
  selfCheck,
  selfCheckMetrics,
  silhouetteMetrics,
} from "../src/selfcheck.js";
import { CLIP_KS, ORIENT_STRETCH, clipPhases, growCreature, poseCreature } from "../src/pose.js";
import { rasterize } from "../src/raster.js";

const goldenPath = (name: string): string =>
  fileURLToPath(new URL(`./goldens/${name}`, import.meta.url));

const PLANS = [0, 1, 2] as const;
const ORNAMENT_EXISTS = [53, 54, 55] as const;

// ---------------------------------------------------------------------------
// Registry append (ids 51–55) + the gated scope
// ---------------------------------------------------------------------------

describe("U5 registry append — ids 51–55 (existence-default-absent law)", () => {
  test("the 5 gated loci transcribe the adjudicated table exactly", () => {
    const rows: ReadonlyArray<[number, string, string, number, number, number]> = [
      [51, "body.emitter[C].exists", "enum", 0, 1, 0],
      [52, "body.emitter[C].size", "fp", 39322, 98304, 65536],
      [53, "body.ornament[D].exists", "enum", 0, 1, 0],
      [54, "body.ornament[K].exists", "enum", 0, 1, 0],
      [55, "body.ornament[M].exists", "enum", 0, 1, 0],
    ];
    for (const [id, path, kind, lo, hi, dflt] of rows) {
      const locus = REGISTRY[id] as ScalarLocus;
      expect([locus.id, locus.path, locus.kind, locus.lo, locus.hi, locus.defaultRaw], path).toEqual(
        [id, path, kind, lo, hi, dflt],
      );
    }
  });

  test("every gated default means ABSENT: the all-defaults genomes grow the 13/11/7 censuses", () => {
    expect(growCreature(makeGenome()).parts.length).toBe(13);
    expect(growCreature(makeGenome({ values: [["meta.plan", 1]] })).parts.length).toBe(11);
    expect(growCreature(makeGenome({ values: [["meta.plan", 2]] })).parts.length).toBe(7);
  });

  test("wire round-trip over ids 51–55 (appends are absent-meaning)", () => {
    const g = makeGenome({
      seed: 99n,
      values: [
        [51, 1],
        [52, 72090],
        [53, 1],
        [54, 1],
        [55, 1],
      ],
    });
    const dna = encodeGenome(g);
    const back = decodeGenome(dna);
    expect(encodeGenome(back)).toBe(dna);
    for (const id of [51, 53, 54, 55]) expect(getScalar(back, id)).toBe(1);
    expect(getScalar(back, 52)).toBe(72090);
  });
});

// ---------------------------------------------------------------------------
// H1 — tags gate NOTHING on the default path (structural proof)
// ---------------------------------------------------------------------------

describe("U5 anchor razor — H1/H2 structural proofs", () => {
  test("default-path growth consumes ZERO draws for seeds 0..29 × 3 plans (sampled tags gate nothing)", () => {
    for (const plan of PLANS) {
      for (let seed = 0; seed < 30; seed++) {
        const g = sampleGenome(BigInt(seed), plan);
        expect(g.traitTags.length).toBeGreaterThanOrEqual(1); // tags ARE drawn
        const graph = growCreature(g);
        expect(graph.drawsConsumed, `${PLAN_NAMES[plan]}:${seed}`).toBe(0);
        expect(graph.parts.length).toBe([13, 11, 7][plan]);
      }
    }
  });

  test("H2: no opts and empty opts are byte-identical to the 2-arg call", () => {
    for (const plan of PLANS) {
      for (const seed of [0n, 7n, 40n]) {
        const dna = encodeGenome(sampleGenome(seed, plan));
        expect(encodeGenome(sampleGenome(seed, plan, {}))).toBe(dna);
        expect(encodeGenome(sampleGenome(seed, plan, undefined))).toBe(dna);
      }
    }
  });

  test("the H1 engine law: every shipped candidate with tagWeights also carries existsLocus", () => {
    // Walk the three shipped PlanSpecs' socket trees (make() is pure).
    const genome = makeGenome({
      values: [
        [51, 1],
        [53, 1],
        [54, 1],
        [55, 1],
      ],
    });
    const walk = (init: PartInit, seen: PartChoice[]): void => {
      for (const socket of init.sockets ?? []) {
        for (const c of socket.candidates) {
          seen.push(c);
          walk(c.make(genome, 0, 1, 0), seen);
        }
      }
    };
    for (const spec of [QUADRUPED_PLAN, LEVITANT_PLAN, AMORPHOUS_PLAN]) {
      const seen: PartChoice[] = [];
      walk(spec.core.make(genome, 0, 1, 0), seen);
      let weighted = 0;
      for (const c of seen) {
        if (c.tagWeights !== undefined) {
          weighted++;
          expect(c.existsLocus, `${spec.plan} candidate with tagWeights`).toBeDefined();
          expect(c.tagWeights.length).toBe(5);
        }
      }
      expect(weighted).toBe(3); // the plan's three ornament candidates
    }
  });

  test("a tagWeights candidate WITHOUT existsLocus is rejected at growth (RangeError)", () => {
    const bad: PlanSpec = {
      plan: "synthetic",
      budgetMin: 1,
      budgetMax: 4,
      core: {
        kind: "core",
        make: () => ({
          name: "core",
          path: "body.core",
          materialRole: "hide",
          animChain: "body",
          slab: { center: [0, 0, 0], half: [65536, 65536, 65536] },
          sockets: [
            {
              name: "orn",
              allowedKinds: ["ornament"],
              symmetry: { kind: "single" },
              clearanceFp: 0,
              drawPath: "body.ornament[D]",
              candidates: [
                {
                  kind: "ornament",
                  tagWeights: [1, 1, 1, 1, 1], // ILLEGAL: no existsLocus
                  make: () => ({
                    name: "x",
                    path: "body.ornament[D]",
                    materialRole: "underside",
                    animChain: "body",
                    slab: { center: [0, 0, 0], half: [65536, 65536, 65536] },
                  }),
                },
              ],
            },
          ],
        }),
      },
    };
    expect(() => growPlan(bad, makeGenome())).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Weighted fills — the §4 arithmetic on a synthetic plan + the real table
// ---------------------------------------------------------------------------

/** A synthetic single-socket plan over the real ornament weight table. */
function synOrnamentPlan(): PlanSpec {
  const fam = (name: "plate" | "wisp" | "sprout"): PartChoice => ({
    kind: "ornament",
    existsLocus: "body.ornament[D].exists",
    tagWeights: ORNAMENT_TAG_WEIGHTS[name],
    neutralWeight: 1,
    make: () => ({
      name,
      path: "body.ornament[D]",
      materialRole: "underside",
      animChain: "body",
      slab: { center: [0, 0, 655360], half: [6554, 6554, 6554] },
    }),
  });
  return {
    plan: "synthetic",
    budgetMin: 1,
    budgetMax: 4,
    core: {
      kind: "core",
      make: () => ({
        name: "core",
        path: "body.core",
        materialRole: "hide",
        animChain: "body",
        slab: { center: [0, 0, 0], half: [65536, 65536, 65536] },
        sockets: [
          {
            name: "orn",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: 0,
            drawPath: "syn.orn",
            candidates: [fam("plate"), fam("wisp"), fam("sprout")],
          },
        ],
      }),
    },
  };
}

describe("U5 weighted fills — pinned arithmetic (design 07 §6.1)", () => {
  test("the tag→weight table transcribes exactly; no 1–2 tag set zeroes all candidates", () => {
    expect(ORNAMENT_TAG_WEIGHTS.plate).toEqual([6, 2, 0, 5, 0]);
    expect(ORNAMENT_TAG_WEIGHTS.wisp).toEqual([0, 0, 6, 1, 1]);
    expect(ORNAMENT_TAG_WEIGHTS.sprout).toEqual([1, 4, 1, 0, 6]);
    const cols = [ORNAMENT_TAG_WEIGHTS.plate, ORNAMENT_TAG_WEIGHTS.wisp, ORNAMENT_TAG_WEIGHTS.sprout];
    let minTotal = Infinity;
    for (let a = 0; a < 5; a++) {
      for (let b = a; b < 5; b++) {
        const tags = a === b ? [a] : [a, b];
        const total = cols.reduce(
          (sum, col) => sum + tags.reduce((s, t) => s + col[t]!, 0),
          0,
        );
        expect(total, `tags {${tags}}`).toBeGreaterThan(0);
        if (total < minTotal) minTotal = total;
      }
    }
    expect(minTotal).toBe(6);
  });

  test("worked example (CI vector): tags {chitin} → wisp pruned, T = 7, r < 6 → plate, r = 6 → sprout", () => {
    const spec = synOrnamentPlan();
    for (let seed = 0; seed < 32; seed++) {
      const g = makeGenome({ seed: BigInt(seed), traitTags: [0], values: [[53, 1]] });
      const graph = growPlan(spec, g);
      expect(graph.drawsConsumed).toBe(1);
      const r = createStream(BigInt(seed), "syn.orn", "fill").nextRange(7);
      expect(graph.parts[1]!.name, `seed ${seed} r=${r}`).toBe(r < 6 ? "plate" : "sprout");
    }
  });

  test("2-tag sum {spectral, verdant}: plate zero-pruned, T = 14 (the corrected max)", () => {
    const spec = synOrnamentPlan();
    for (let seed = 0; seed < 24; seed++) {
      const g = makeGenome({ seed: BigInt(seed), traitTags: [2, 4], values: [[53, 1]] });
      const graph = growPlan(spec, g);
      expect(graph.drawsConsumed).toBe(1);
      const r = createStream(BigInt(seed), "syn.orn", "fill").nextRange(14);
      expect(graph.parts[1]!.name, `seed ${seed}`).toBe(r < 7 ? "wisp" : "sprout");
    }
  });

  test("neutral row (no tags): all three survive at weight 1, T = 3 — arithmetic-identical to the uniform draw", () => {
    const spec = synOrnamentPlan();
    for (let seed = 0; seed < 24; seed++) {
      const g = makeGenome({ seed: BigInt(seed), values: [[53, 1]] });
      const graph = growPlan(spec, g);
      const r = createStream(BigInt(seed), "syn.orn", "fill").nextRange(3);
      expect(graph.parts[1]!.name).toBe(["plate", "wisp", "sprout"][r]);
    }
  });

  test("existence prune EMPTIES the socket before weights (default gated loci ⇒ no draw, no node)", () => {
    const spec = synOrnamentPlan();
    const g = makeGenome({ traitTags: [0] }); // id 53 defaults 0
    const graph = growPlan(spec, g);
    expect(graph.parts.length).toBe(1);
    expect(graph.drawsConsumed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Clearance machinery — synthetic plan (design 07 §5.1)
// ---------------------------------------------------------------------------

/**
 * A synthetic plan: core at the origin, a fixed blocker slab, then a
 * placement socket with 3 slots whose positions are supplied by the
 * test — slots in `collidingSlots` land ON the blocker.
 */
function synPlacePlan(collidingSlots: ReadonlySet<number>, drawPath = "syn.place"): PlanSpec {
  return {
    plan: "synthetic",
    budgetMin: 2,
    budgetMax: 6,
    core: {
      kind: "core",
      make: () => ({
        name: "core",
        path: "body.core",
        materialRole: "hide",
        animChain: "body",
        slab: { center: [0, 0, 0], half: [65536, 65536, 65536] },
        sockets: [
          {
            name: "blocker",
            allowedKinds: ["segment"],
            symmetry: { kind: "single" },
            clearanceFp: 0,
            candidates: [
              {
                kind: "segment",
                make: () => ({
                  name: "blocker",
                  path: "body.tail",
                  materialRole: "hide",
                  animChain: "body",
                  slab: { center: [655360, 0, 0], half: [131072, 131072, 131072] },
                }),
              },
            ],
          },
          {
            name: "placed",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: 13107,
            placeSlots: 3,
            drawPath,
            candidates: [
              {
                kind: "ornament",
                existsLocus: "body.ornament[D].exists",
                make: (_g, _m, _c, slot = 0) => ({
                  name: `placed_${slot}`,
                  path: "body.ornament[D]",
                  materialRole: "underside",
                  animChain: "body",
                  slab: {
                    // A colliding slot sits exactly on the blocker; a
                    // clean slot sits far away on −x.
                    center: [collidingSlots.has(slot) ? 655360 : -655360 - slot * 131072, 0, 0],
                    half: [65536, 65536, 65536],
                  },
                }),
              },
            ],
          },
        ],
      }),
    },
  };
}

describe("U5 clearance machinery — place:0..R−1, drop semantics, stream isolation", () => {
  const genomeFor = (seed: bigint): Genome =>
    makeGenome({ seed, values: [[53, 1]] });
  const slotDraw = (seed: bigint, attempt: number, drawPath = "syn.place"): number =>
    createStream(seed, drawPath, `place:${attempt}`).nextRange(3);

  test("PLACE_RETRY_CAP is pinned at 3", () => {
    expect(PLACE_RETRY_CAP).toBe(3);
  });

  test("clean first placement: one place:0 draw, part placed at the drawn slot", () => {
    const spec = synPlacePlan(new Set());
    for (const seed of [0n, 1n, 2n, 3n]) {
      const graph = growPlan(spec, genomeFor(seed));
      expect(graph.parts.length).toBe(3);
      expect(graph.drawsConsumed).toBe(1); // the single place:0 draw
      expect(graph.parts[2]!.name).toBe(`placed_${slotDraw(seed, 0)}`);
    }
  });

  test("place:1 rescue: attempt 0 collides, attempt 1 places (draws counted)", () => {
    // Find a seed whose attempt-0 slot differs from its attempt-1 slot,
    // then make ONLY the attempt-0 slot colliding.
    let seed = 0n;
    while (slotDraw(seed, 0) === slotDraw(seed, 1)) seed += 1n;
    const spec = synPlacePlan(new Set([slotDraw(seed, 0)]));
    const graph = growPlan(spec, genomeFor(seed));
    expect(graph.parts.length).toBe(3);
    expect(graph.drawsConsumed).toBe(2); // place:0 + place:1
    expect(graph.parts[2]!.name).toBe(`placed_${slotDraw(seed, 1)}`);
  });

  test("full drop after R colliding attempts: socket closes, no node, no budget, draws stay counted", () => {
    const spec = synPlacePlan(new Set([0, 1, 2])); // every slot collides
    const graph = growPlan(spec, genomeFor(5n));
    expect(graph.parts.length).toBe(2); // core + blocker only
    expect(graph.drawsConsumed).toBe(3); // the three colliding attempts
    expect(graph.parts.some((p) => p.name.startsWith("placed_"))).toBe(false);
  });

  test("embedding into the HOST is never a violation (parent exempt from the check)", () => {
    // A placement right on top of the core (the parent) must place.
    const hostSpec: PlanSpec = {
      plan: "synthetic",
      budgetMin: 1,
      budgetMax: 4,
      core: {
        kind: "core",
        make: () => ({
          name: "core",
          path: "body.core",
          materialRole: "hide",
          animChain: "body",
          slab: { center: [0, 0, 0], half: [131072, 131072, 131072] },
          sockets: [
            {
              name: "embedded",
              allowedKinds: ["ornament"],
              symmetry: { kind: "single" },
              clearanceFp: 0,
              placeSlots: 3,
              drawPath: "syn.embed",
              candidates: [
                {
                  kind: "ornament",
                  existsLocus: "body.ornament[D].exists",
                  make: () => ({
                    name: "embedded",
                    path: "body.ornament[D]",
                    materialRole: "underside",
                    animChain: "body",
                    slab: { center: [0, 0, 131072], half: [65536, 65536, 65536] },
                  }),
                },
              ],
            },
          ],
        }),
      },
    };
    const graph = growPlan(hostSpec, makeGenome({ values: [[53, 1]] }));
    expect(graph.parts.length).toBe(2);
  });

  test("stream isolation: each socket's place draws come from its OWN drawPath stream", () => {
    // Two placement sockets; the second's accepted slot must equal the
    // prediction from ITS stream whether or not the first socket retried.
    const build = (firstColliding: ReadonlySet<number>): PlanSpec => ({
      plan: "synthetic",
      budgetMin: 2,
      budgetMax: 8,
      core: {
        kind: "core",
        make: () => ({
          name: "core",
          path: "body.core",
          materialRole: "hide",
          animChain: "body",
          slab: { center: [0, 0, 0], half: [65536, 65536, 65536] },
          sockets: [
            {
              name: "blocker",
              allowedKinds: ["segment"],
              symmetry: { kind: "single" },
              clearanceFp: 0,
              candidates: [
                {
                  kind: "segment",
                  make: () => ({
                    name: "blocker",
                    path: "body.tail",
                    materialRole: "hide",
                    animChain: "body",
                    slab: { center: [655360, 0, 0], half: [131072, 131072, 131072] },
                  }),
                },
              ],
            },
            ...(["a", "b"] as const).map((tag, i): SocketSpec => ({
              name: `placed_${tag}`,
              allowedKinds: ["ornament"],
              symmetry: { kind: "single" },
              clearanceFp: 13107,
              placeSlots: 3,
              drawPath: `syn.place.${tag}`,
              candidates: [
                {
                  kind: "ornament",
                  existsLocus: "body.ornament[D].exists",
                  make: (_g, _m, _c, slot = 0) => ({
                    name: `${tag}_${slot}`,
                    path: "body.ornament[D]",
                    materialRole: "underside",
                    animChain: "body",
                    slab: {
                      center: [
                        i === 0 && firstColliding.has(slot)
                          ? 655360
                          : -(655360 + i * 655360 + slot * 131072),
                        0,
                        0,
                      ],
                      half: [32768, 32768, 32768],
                    },
                  }),
                },
              ],
            })),
          ],
        }),
      },
    });
    let seed = 0n;
    while (slotDraw(seed, 0, "syn.place.a") === slotDraw(seed, 1, "syn.place.a")) seed += 1n;
    const g = genomeFor(seed);
    const clean = growPlan(build(new Set()), g);
    const retried = growPlan(build(new Set([slotDraw(seed, 0, "syn.place.a")])), g);
    const bName = (graph: typeof clean): string =>
      graph.parts.find((p) => p.name.startsWith("b_"))!.name;
    const predictedB = `b_${slotDraw(seed, 0, "syn.place.b")}`;
    expect(bName(clean)).toBe(predictedB);
    expect(bName(retried)).toBe(predictedB); // a's retry never perturbs b
    expect(retried.drawsConsumed).toBe(clean.drawsConsumed + 1);
  });

  test("shipped mandatory sockets stay OUTSIDE the mechanism (no placeSlots anywhere but the dorsal)", () => {
    const genome = makeGenome({
      values: [
        [51, 1],
        [53, 1],
        [54, 1],
        [55, 1],
      ],
    });
    const collect = (init: PartInit, out: SocketSpec[]): void => {
      for (const socket of init.sockets ?? []) {
        out.push(socket);
        for (const c of socket.candidates) collect(c.make(genome, 0, 1, 0), out);
      }
    };
    for (const spec of [QUADRUPED_PLAN, LEVITANT_PLAN, AMORPHOUS_PLAN]) {
      const sockets: SocketSpec[] = [];
      collect(spec.core.make(genome, 0, 1, 0), sockets);
      const withSlots = sockets.filter((s) => s.placeSlots !== undefined);
      if (spec.plan === "quadruped") {
        expect(withSlots.map((s) => s.name)).toEqual(["dorsal"]);
        expect(withSlots[0]!.placeSlots).toBe(3);
        expect(withSlots[0]!.clearanceFp).toBe(13107);
      } else {
        expect(withSlots).toEqual([]);
      }
      for (const s of sockets) {
        if (s.placeSlots === undefined && spec.plan === "quadruped" && s.name !== "dorsal") {
          expect(s.clearanceFp).toBe(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// §4.4.4 activation — the emitter orientation transform + oracle vectors
// ---------------------------------------------------------------------------

describe("U5 emitter orientation (§4.4.4 ACTIVATED — design 07 §6.1)", () => {
  test("ORIENT_STRETCH is the pinned family [65536, 98304, 76459, 65536]; f2 = the house recovery shape", () => {
    expect(ORIENT_STRETCH).toEqual([65536, 98304, 76459, 65536]);
    expect(76459 - 65536).toBe(rheDiv(98304 - 65536, 3)); // f2 delta = rheDiv(f1 delta, 3)
  });

  test("from-spec Python oracle vectors: 6 pinned genomes × every clip × frame, exact slab raws", () => {
    const oracle = JSON.parse(readFileSync(goldenPath("u5_pose_oracle.v2.json"), "utf8")) as Record<
      string,
      Record<string, Record<string, number[][][]>>
    >;
    const genomes: Record<string, Record<string, Genome>> = {
      quadruped: {
        ranged: makeGenome({
          seed: 5n,
          values: [
            [51, 1],
            [52, 80000],
            ["body.core.length", 589824],
            ["body.head.scale", 78643],
            ["body.head.snout_len", 180224],
            ["anim.quadruped.anticipation", 98304],
            ["anim.quadruped.bob_amp", 45875],
          ],
        }),
        ornamented: makeGenome({
          seed: 11n,
          values: [
            [53, 1],
            ["body.core.girth", 327680],
            ["body.core.depth", 262144],
            ["body.core.length", 458752],
            ["anim.quadruped.tail_amp", 131072],
          ],
        }),
      },
      levitant: {
        ranged: makeGenome({
          seed: 5n,
          values: [
            [0, 1],
            [51, 1],
            [52, 80000],
            ["body.core.girth", 196608],
            ["anim.levitant.hover_amp", 65536],
            ["anim.levitant.anticipation", 81920],
            ["body.sensor[C].scale", 78643],
          ],
        }),
        ornamented: makeGenome({
          seed: 11n,
          values: [
            [0, 1],
            [54, 1],
            ["body.core.girth", 294912],
            ["body.core.tendril_len", 65536],
          ],
        }),
      },
      amorphous: {
        ranged: makeGenome({
          seed: 5n,
          values: [
            [0, 2],
            [51, 1],
            [52, 80000],
            ["anim.amorphous.squash_amp", 6554],
          ],
        }),
        ornamented: makeGenome({
          seed: 11n,
          values: [
            [0, 2],
            [55, 1],
            ["body.core.length", 589824],
            ["anim.amorphous.ball_phase_delta", 9830],
          ],
        }),
      },
    };
    // V1 RE-SCOPE (design 08 §2.1, generator v3), not a re-pin. The Python
    // oracle's raws stay the base — every M1/M2 equation, the §5.3 LUT, the
    // envelope tables and the §4.4.4 emitter stretch are still asserted
    // against vectors this implementation never produced. What V1 adds is a
    // rigid per-chain TRANSLATION at growth time, and only that translation
    // is taken from the shipped classifier, with its raws pinned below so a
    // drift in either the oracle or the fit still fails this test.
    //
    // Of the six oracle genomes only `quadruped/ranged` moves at all:
    // `quadruped/ornamented` is in the byte-stable partition (dF = dR = 0)
    // and both levitant and amorphous cases are on untouched plans, so five
    // of the six assert the ORIGINAL oracle raws unmodified.
    const fits: Record<string, { dFront: number; dRear: number }> = {};
    for (const [label, genome] of Object.entries(genomes.quadruped!)) {
      const c = classifyQuadruped(genome);
      fits[label] = { dFront: c.dFront, dRear: c.dRear };
    }
    expect(fits.ranged).toEqual({ dFront: -253175, dRear: 967 }); // F 18.436 px / R′ 13.400
    expect(fits.ornamented).toEqual({ dFront: 0, dRear: 0 }); // in the partition
    expect(classifyQuadruped(genomes.quadruped!.ornamented!).geometryStable).toBe(true);

    for (const [plan, cases] of Object.entries(genomes)) {
      for (const [label, genome] of Object.entries(cases)) {
        const fit = plan === "quadruped" ? fits[label]! : { dFront: 0, dRear: 0 };
        const chains = growCreature(genome).parts.map((p) => p.animChain);
        for (const clip of Object.keys(CLIP_KS) as (keyof typeof CLIP_KS)[]) {
          const phases = clipPhases(CLIP_KS[clip]);
          for (let k = 0; k < phases.length; k++) {
            const slabs = poseCreature(genome, clip, phases[k]!);
            const want = oracle[plan]![label]![clip]![k]!;
            expect(slabs.length, `${plan}/${label}/${clip}/f${k}`).toBe(want.length);
            for (let i = 0; i < slabs.length; i++) {
              const s = slabs[i]!;
              const row = want[i]!.slice(0, 6);
              // model y (index 1) is the ONLY coordinate the fit touches.
              if (chains[i] === "head") row[1] = row[1]! + fit.dFront;
              else if (chains[i] === "tail") row[1] = row[1]! + fit.dRear;
              expect(
                [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz],
                `${plan}/${label}/${clip}/f${k}/slab${i}`,
              ).toEqual(row);
              if (want[i]!.length === 7) {
                expect(s.fieldWeight ?? null).toBe(want[i]![6]);
              }
            }
          }
        }
      }
    }
  });

  test("rear-face invariance: at every attack frame the emitter's cy − hy equals the untransformed base", () => {
    for (const plan of PLANS) {
      const vals: Array<readonly [number | string, number]> = [
        [51, 1],
        [52, 80000],
      ];
      if (plan !== 0) vals.unshift([0, plan]);
      const g = makeGenome({ values: vals });
      const graph = growCreature(g);
      const idx = graph.parts.findIndex((p) => p.kind === "emitter");
      expect(idx).toBeGreaterThanOrEqual(0);
      const restHy = graph.parts[idx]!.slab.half[1];
      const phases = clipPhases(4);
      for (let k = 0; k < 4; k++) {
        const s = poseCreature(g, "attack", phases[k]!)[idx]!;
        const hyExpected = fp_mul(ORIENT_STRETCH[k]!, restHy);
        expect(s.hy, `plan ${plan} f${k} hy`).toBe(hyExpected);
        // rear face = (cy − stretch delta) − restHy ⇔ cy − hy invariant
        // vs the untransformed base: cy − hy === baseCy − restHy where
        // baseCy = cy − (hy − restHy).
        expect(s.cy - s.hy).toBe(s.cy - (s.hy - restHy) - restHy);
      }
      // walk/idle/hurt/death never transform the emitter
      for (const clip of ["walk", "idle", "hurt", "death"] as const) {
        for (const phi of clipPhases(CLIP_KS[clip])) {
          expect(poseCreature(g, clip, phi)[idx]!.hy).toBe(restHy);
        }
      }
    }
  });

  test("emitter floors: half-extents never fall below the EMIT_HALF raws", () => {
    expect(EMIT_HALF).toEqual([45875, 58982, 45875]);
    for (const plan of PLANS) {
      const vals: Array<readonly [number | string, number]> = [
        [51, 1],
        [52, 39322], // domain lo
      ];
      if (plan !== 0) vals.unshift([0, plan]);
      const graph = growCreature(makeGenome({ values: vals }));
      const em = graph.parts.find((p) => p.kind === "emitter")!;
      expect(em.slab.half).toEqual([45875, 58982, 45875]);
      expect(em.materialRole).toBe("focal");
    }
  });

  test("emitter visibility: one ranged genome per plan renders ≥ 1 focal emitter pixel in the down-view attack f1", { timeout: 120000 }, () => {
    for (const plan of PLANS) {
      const g = sampleGenome(7n, plan, { preset: "ranged" });
      const graph = growCreature(g);
      const idx = graph.parts.findIndex((p) => p.kind === "emitter");
      const slabs = poseCreature(g, "attack", 16384); // f1 strike
      const grid = rasterize(slabs, "down", 32, 4);
      let hit = 0;
      for (const row of grid) for (const px of row) if (px !== null && px.partId === idx) hit++;
      expect(hit, `${PLAN_NAMES[plan]}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Wire — size bounds (mode-reachable + adversarial)
// ---------------------------------------------------------------------------

describe("U5 wire size bounds (design 06 §3.5 as amended)", () => {
  /** Costliest in-domain raw of a scalar locus (largest zigzag delta). */
  const worstRaw = (locus: ScalarLocus): number | null => {
    const zz = (d: number): number => (d >= 0 ? 2 * d : -2 * d - 1);
    const candidates = [locus.lo, locus.hi].filter((v) => v !== locus.defaultRaw);
    if (candidates.length === 0) return null;
    let best = candidates[0]!;
    for (const c of candidates) if (zz(c - locus.defaultRaw) > zz(best - locus.defaultRaw)) best = c;
    return best;
  };
  const b64len = (n: number): number => Math.floor(n / 3) * 4 + (n % 3 === 0 ? 0 : (n % 3) + 1);
  const byteLen = (dna: string): number => Math.floor((dna.length * 6) / 8);

  test("mode-reachable per-plan worsts: quadruped 146 B = 195 chars, levitant 93 B = 124, amorphous 68 B = 91", () => {
    const gatedByPlan: ReadonlyArray<readonly number[]> = [
      [51, 52, 53],
      [51, 52, 54],
      [51, 52, 55],
    ];
    const wantBytes = [146, 93, 68];
    for (const plan of PLANS) {
      const values: Array<readonly [number, number]> = [];
      if (plan !== 0) values.push([0, plan]);
      const scope = LOCUS_SCOPES[PLAN_NAMES[plan] as "quadruped" | "levitant" | "amorphous"];
      for (const locus of REGISTRY) {
        if (locus.kind !== "fp" && locus.kind !== "int" && locus.kind !== "enum") continue;
        if (locus.id === 0) continue;
        const inScope =
          LOCUS_SCOPES.shared.has(locus.id) ||
          scope.has(locus.id) ||
          gatedByPlan[plan]!.includes(locus.id);
        if (!inScope) continue;
        const w = worstRaw(locus);
        if (w !== null) values.push([locus.id, w]);
      }
      const g = makeGenome({ seed: (1n << 64n) - 1n, traitTags: [3, 4], values });
      const dna = encodeGenome(g);
      expect(byteLen(dna), `${PLAN_NAMES[plan]} bytes`).toBe(wantBytes[plan]);
      expect(dna.length).toBe(b64len(wantBytes[plan]!));
    }
    expect([b64len(146), b64len(93), b64len(68)]).toEqual([195, 124, 91]);
  });

  test("fully adversarial cross-plan tape: 205 B = 274 chars (no sampler emits it; degradation linear)", () => {
    const values: Array<readonly [number, number]> = [];
    for (const locus of REGISTRY) {
      if (locus.kind !== "fp" && locus.kind !== "int" && locus.kind !== "enum") continue;
      const w = worstRaw(locus);
      if (w !== null) values.push([locus.id, w]);
    }
    const g = makeGenome({ seed: (1n << 64n) - 1n, traitTags: [3, 4], values });
    const dna = encodeGenome(g);
    expect(byteLen(dna)).toBe(205);
    expect(dna.length).toBe(274);
  });

  test("DEFAULT-sampler per-plan worsts UNCHANGED (scopes untouched): 138 / 85 / 60 B", () => {
    const wantBytes = [138, 85, 60];
    for (const plan of PLANS) {
      const values: Array<readonly [number, number]> = [];
      if (plan !== 0) values.push([0, plan]);
      const scope = LOCUS_SCOPES[PLAN_NAMES[plan] as "quadruped" | "levitant" | "amorphous"];
      for (const locus of REGISTRY) {
        if (locus.kind !== "fp" && locus.kind !== "int" && locus.kind !== "enum") continue;
        if (locus.id === 0) continue;
        if (!LOCUS_SCOPES.shared.has(locus.id) && !scope.has(locus.id)) continue;
        const w = worstRaw(locus);
        if (w !== null) values.push([locus.id, w]);
      }
      const g = makeGenome({ seed: (1n << 64n) - 1n, traitTags: [3, 4], values });
      expect(byteLen(encodeGenome(g)), PLAN_NAMES[plan]).toBe(wantBytes[plan]);
    }
  });
});
