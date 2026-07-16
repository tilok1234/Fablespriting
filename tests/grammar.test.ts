import { describe, expect, test } from "vitest";

import { FP_ONE } from "../src/fixed.js";
import { locusByPath, makeGenome, sampleGenome } from "../src/genome.js";
import type { Genome } from "../src/genome.js";
import {
  QUADRUPED_PLAN,
  growPlan,
  growQuadruped,
  symmetryMemberCount,
} from "../src/grammar.js";
import { CHAINS, PART_NAMES, PART_ROLES } from "../src/wires.js";
import type { PartChoice, PartKind, PlanSpec, SocketSpec } from "../src/grammar.js";
import { poseQuadruped } from "../src/pose.js";

const DEFAULTS = makeGenome();

// ---------------------------------------------------------------------------
// Synthetic-plan helpers. Every pinned draw literal below was derived by
// the scratchpad Python oracle (u1_oracle.py, 2026-07-11), which
// implements the design 06 §4 stream discipline independently — never by
// running this implementation: the fill draw for a socket is
// `stream(seed, drawPath, "fill").nextRange(#candidates)`.
// ---------------------------------------------------------------------------

const UNIT_SLAB = {
  center: [0, 0, 0] as const,
  half: [FP_ONE, FP_ONE, FP_ONE] as const,
};

function leaf(
  name: string,
  kind: PartKind = "ornament",
  exclusionGroup?: string,
): PartChoice {
  return {
    kind,
    ...(exclusionGroup === undefined ? {} : { exclusionGroup }),
    make: () => ({
      name,
      path: `toy.${name}`,
      materialRole: "hide",
      animChain: "body",
      slab: UNIT_SLAB,
    }),
  };
}

function toyPlan(sockets: readonly SocketSpec[], budgetMax = 14, budgetMin = 1): PlanSpec {
  return {
    plan: "toy",
    budgetMin,
    budgetMax,
    core: {
      kind: "core",
      make: () => ({
        name: "core",
        path: "toy.core",
        materialRole: "hide",
        animChain: "body",
        slab: UNIT_SLAB,
        sockets,
      }),
    },
  };
}

function single(
  name: string,
  candidates: readonly PartChoice[],
  drawPath?: string,
): SocketSpec {
  return {
    name,
    allowedKinds: ["ornament", "segment"],
    symmetry: { kind: "single" },
    clearanceFp: 0,
    ...(drawPath === undefined ? {} : { drawPath }),
    candidates,
  };
}

function seeded(seed: bigint): Genome {
  return makeGenome({ seed });
}

describe("growPlan — draw discipline (design 07 §1.4 / design 06 §4)", () => {
  const crest = single("crest", [leaf("a"), leaf("b"), leaf("c")], "toy.crest");

  test("a multi-candidate fill consumes exactly one stream(seed, drawPath, 'fill') draw", () => {
    // Oracle literals: nextRange(3) on stream(seed, "toy.crest", "fill")
    // = 2 for seed 0, 1 for seed 7.
    const plan = toyPlan([crest]);
    const g0 = growPlan(plan, seeded(0n));
    expect(g0.drawsConsumed).toBe(1);
    expect(g0.parts[1]!.name).toBe("c"); // index 2
    const g7 = growPlan(plan, seeded(7n));
    expect(g7.drawsConsumed).toBe(1);
    expect(g7.parts[1]!.name).toBe("b"); // index 1
  });

  test("a single-candidate fill consumes no draw (the meta.plan precedent)", () => {
    const graph = growPlan(toyPlan([single("mount", [leaf("only")])]), seeded(7n));
    expect(graph.drawsConsumed).toBe(0);
    expect(graph.slabOrder).toEqual(["core", "only"]);
  });

  test("a drawable socket without a drawPath is a spec violation", () => {
    const bad = toyPlan([single("crest", [leaf("a"), leaf("b")])]);
    expect(() => growPlan(bad, seeded(0n))).toThrow(RangeError);
  });

  test("determinism: the same genome grows a deep-equal graph", () => {
    const plan = toyPlan([crest, single("mount", [leaf("m1"), leaf("m2")], "toy.mount")]);
    expect(growPlan(plan, seeded(7n))).toEqual(growPlan(plan, seeded(7n)));
  });
});

describe("growPlan — exclusion groups prune BEFORE the draw (design 07 §1.1)", () => {
  // Socket order: crown (places the "hat" group), topper (candidates
  // [hat-grouped, plain]), banner (independent 2-candidate draw).
  const bannerSocket = single("banner", [leaf("x"), leaf("y")], "toy.banner");
  const withExclusion = toyPlan([
    single("crown", [leaf("e1", "ornament", "hat")]),
    single("topper", [leaf("e2", "ornament", "hat"), leaf("plain")], "toy.mount"),
    bannerSocket,
  ]);
  const withoutExclusion = toyPlan([
    single("crown", [leaf("e1")]),
    single("topper", [leaf("e2", "ornament", "hat"), leaf("plain")], "toy.mount"),
    bannerSocket,
  ]);

  test("a used group removes its candidates from the choice set, not the draw's outcome", () => {
    // crown fills "hat" → topper prunes to [plain]: single-candidate,
    // no draw. Only banner draws (oracle: nextRange(2) = 0 → "x").
    const graph = growPlan(withExclusion, seeded(7n));
    expect(graph.slabOrder).toEqual(["core", "e1", "plain", "x"]);
    expect(graph.drawsConsumed).toBe(1);
  });

  test("an exclusion firing never reshuffles a sibling socket's draw", () => {
    // Without the exclusion, topper draws (oracle: nextRange(2) = 1 →
    // "plain") — and banner's own stream is untouched by the extra draw.
    const fired = growPlan(withExclusion, seeded(7n));
    const unfired = growPlan(withoutExclusion, seeded(7n));
    expect(unfired.drawsConsumed).toBe(2);
    expect(unfired.parts[3]!).toEqual(fired.parts[3]!); // banner node identical
  });

  test("allowed-kind pruning shares the pre-draw slot", () => {
    // A limb candidate on an ornament-only socket prunes away, leaving a
    // single candidate: no draw, no drawPath needed.
    const graph = growPlan(
      toyPlan([single("crest", [leaf("wrong", "limb"), leaf("right")])]),
      seeded(0n),
    );
    expect(graph.slabOrder).toEqual(["core", "right"]);
    expect(graph.drawsConsumed).toBe(0);
  });

  test("a socket whose candidates all prune away closes without drawing", () => {
    const graph = growPlan(
      toyPlan([
        single("crown", [leaf("e1", "ornament", "hat")]),
        single("topper", [leaf("e2", "ornament", "hat")]),
      ]),
      seeded(0n),
    );
    expect(graph.slabOrder).toEqual(["core", "e1"]);
    expect(graph.drawsConsumed).toBe(0);
  });
});

describe("growPlan — symmetry groups place all members from one fill (design 02 §1)", () => {
  test("mirror: two contiguous members, −x/L member first, shared group label", () => {
    const ears: SocketSpec = {
      name: "ears",
      allowedKinds: ["sensor"],
      symmetry: { kind: "mirror" },
      clearanceFp: 0,
      candidates: [
        {
          kind: "sensor",
          make: (_g, member) => ({
            name: member === 0 ? "ear_l" : "ear_r",
            path: member === 0 ? "toy.ear[L]" : "toy.ear[R]",
            materialRole: "hide",
            animChain: "head",
            slab: UNIT_SLAB,
          }),
        },
      ],
    };
    const graph = growPlan(toyPlan([ears]), seeded(0n));
    expect(graph.slabOrder).toEqual(["core", "ear_l", "ear_r"]);
    expect(graph.parts[1]!.path).toBe("toy.ear[L]");
    expect(graph.parts[1]!.symmetry).toBe("mirror:ears");
    expect(graph.parts[2]!.symmetry).toBe("mirror:ears");
    expect(graph.drawsConsumed).toBe(0);
  });

  test("mirror: the recorded group name can differ from the socket name (leg pairs)", () => {
    const socket: SocketSpec = {
      name: "leg_fore",
      allowedKinds: ["limb"],
      symmetry: { kind: "mirror" },
      clearanceFp: 0,
      group: "legs_fore",
      candidates: [leaf("leg", "limb")],
    };
    const graph = growPlan(toyPlan([socket]), seeded(0n));
    expect(graph.parts[1]!.symmetry).toBe("mirror:legs_fore");
  });

  test("serial(N): N members with ascending ordinals in one fill", () => {
    const tendrils: SocketSpec = {
      name: "tendrils",
      allowedKinds: ["locomotor"],
      symmetry: { kind: "serial", n: 3 },
      clearanceFp: 0,
      candidates: [
        {
          kind: "locomotor",
          make: (_g, member) => ({
            name: `tendril_${member}`,
            path: `toy.tendril[T:${member}]`,
            materialRole: "hide",
            animChain: "tail",
            slab: UNIT_SLAB,
          }),
        },
      ],
    };
    const graph = growPlan(toyPlan([tendrils]), seeded(0n));
    expect(graph.slabOrder).toEqual(["core", "tendril_0", "tendril_1", "tendril_2"]);
    expect(graph.parts.slice(1).map((p) => p.path)).toEqual([
      "toy.tendril[T:0]",
      "toy.tendril[T:1]",
      "toy.tendril[T:2]",
    ]);
    for (const p of graph.parts.slice(1)) expect(p.symmetry).toBe("serial:tendrils");
    expect(graph.drawsConsumed).toBe(0);
  });

  test("symmetryMemberCount covers the design 02 §1 vocabulary", () => {
    expect(symmetryMemberCount({ kind: "single" })).toBe(1);
    expect(symmetryMemberCount({ kind: "mirror" })).toBe(2);
    expect(symmetryMemberCount({ kind: "radial", n: 5 })).toBe(5);
    expect(symmetryMemberCount({ kind: "serial", n: 4 })).toBe(4);
  });
});

describe("growPlan — budgeted expansion (design 02 §3 / design 07 §1.4)", () => {
  const mirrorPair: SocketSpec = {
    name: "pair",
    allowedKinds: ["ornament"],
    symmetry: { kind: "mirror" },
    clearanceFp: 0,
    candidates: [leaf("wing")],
  };

  test("a socket needing more members than remain closes; smaller later sockets still fill", () => {
    // budgetMax 3: core(1) + a(2); pair needs 2 → 4 > 3, closes; b fits.
    const graph = growPlan(
      toyPlan([single("a", [leaf("a")]), mirrorPair, single("b", [leaf("b")])], 3),
      seeded(0n),
    );
    expect(graph.slabOrder).toEqual(["core", "a", "b"]);
    expect(graph.budget).toEqual({ used: 3, min: 1, max: 3 });
    expect(graph.drawsConsumed).toBe(0); // closed sockets never draw
  });

  test("the same plan under a looser budget places the pair", () => {
    const graph = growPlan(
      toyPlan([single("a", [leaf("a")]), mirrorPair, single("b", [leaf("b")])], 5),
      seeded(0n),
    );
    expect(graph.slabOrder).toEqual(["core", "a", "wing", "wing", "b"]);
    expect(graph.budget.used).toBe(5);
  });

  test("closed multi-candidate sockets consume no draw (stream discipline survives budget)", () => {
    // budgetMax 2: crest (3 candidates) fills with a draw; mount (2
    // candidates) closes on budget and must NOT touch its stream.
    const plan = toyPlan(
      [
        single("crest", [leaf("a"), leaf("b"), leaf("c")], "toy.crest"),
        single("mount", [leaf("m1"), leaf("m2")], "toy.mount"),
      ],
      2,
    );
    const graph = growPlan(plan, seeded(0n));
    expect(graph.slabOrder).toEqual(["core", "c"]);
    expect(graph.drawsConsumed).toBe(1);
  });

  test("growing outside the budget band is a spec violation", () => {
    expect(() => growPlan(toyPlan([], 14, 5), seeded(0n))).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// The quadruped grammar (design 07 §1.4) — the re-derivation of the M1
// template. Structural pins below are the §1.4 amendment table; all rest
// slab raws were derived by the independent Python oracle (u1_oracle.py),
// never by this implementation.
// ---------------------------------------------------------------------------

describe("quadruped grammar — the design 07 §1.4 part-node table", () => {
  test("13 nodes with the pinned identities, kinds, roles, chains, and symmetry groups", () => {
    const graph = growQuadruped(DEFAULTS);
    expect(
      graph.parts.map((p) => [p.id, p.name, p.path, p.kind, p.materialRole, p.animChain, p.symmetry]),
    ).toEqual([
      [0, "core", "body.core", "core", "hide", "body", "single"],
      [1, "core_underside", "body.core.underside", "segment", "underside", "body", "single"],
      [2, "head", "body.head", "head", "hide", "head", "single"],
      [3, "snout", "body.head.snout", "segment", "underside", "head", "single"],
      [4, "ear_l", "body.head.ear[L]", "sensor", "hide", "head", "mirror:ears"],
      [5, "ear_r", "body.head.ear[R]", "sensor", "hide", "head", "mirror:ears"],
      [6, "eye_l", "body.head.eye[L]", "sensor", "focal", "head", "mirror:eyes"],
      [7, "eye_r", "body.head.eye[R]", "sensor", "focal", "head", "mirror:eyes"],
      [8, "leg_fl", "body.leg[FL]", "limb", "hide", "leg_fl", "mirror:legs_fore"],
      [9, "leg_fr", "body.leg[FR]", "limb", "hide", "leg_fr", "mirror:legs_fore"],
      [10, "leg_bl", "body.leg[BL]", "limb", "hide", "leg_bl", "mirror:legs_hind"],
      [11, "leg_br", "body.leg[BR]", "limb", "hide", "leg_br", "mirror:legs_hind"],
      [12, "tail", "body.tail", "segment", "hide", "tail", "single"],
    ]);
    expect(graph.plan).toBe("quadruped");
    expect(graph.budget).toEqual({ used: 13, min: 8, max: 14 });
    expect(graph.mirrorBroken).toBe(false);
  });

  test("all-defaults rest slabs are the wolf template raws (independent oracle table)", () => {
    const graph = growQuadruped(DEFAULTS);
    expect(
      graph.parts.map((p) => [...p.slab.center, ...p.slab.half]),
    ).toEqual([
      [0, -32768, 498074, 255590, 498074, 222822], // core
      [0, 98304, 386662, 196548, 367080, 144167], // underside
      [0, 543949, 642253, 196608, 222822, 196608], // head
      [0, 760218, 563610, 104858, 144179, 98304], // snout
      [-131072, 471859, 825754, 58982, 65536, 111411], // ear_l
      [131072, 471859, 825754, 58982, 65536, 111411], // ear_r
      [-104858, 714343, 681575, 52429, 45875, 52429], // eye_l
      [104858, 714343, 681575, 52429, 45875, 52429], // eye_r
      [-170394, 301466, 203162, 75366, 98304, 203162], // leg_fl
      [170394, 301466, 203162, 75366, 98304, 203162], // leg_fr
      [-170394, -340787, 203162, 75366, 98304, 203162], // leg_bl
      [170394, -340787, 203162, 75366, 98304, 203162], // leg_br
      [0, -576717, 629146, 72090, 209715, 72090], // tail
    ]);
  });

  test("the structural wires are the grammar's output", () => {
    const graph = growQuadruped(DEFAULTS);
    expect(graph.slabOrder).toEqual(PART_NAMES);
    expect(graph.parts.map((p) => p.materialRole)).toEqual(PART_ROLES);
    expect(graph.chains).toEqual(CHAINS);
    expect(CHAINS.map((c) => [c.name, c.slabs])).toEqual([
      ["body", [0, 1]],
      ["head", [2, 3, 4, 5, 6, 7]],
      ["leg_fl", [8]],
      ["leg_fr", [9]],
      ["leg_bl", [10]],
      ["leg_br", [11]],
      ["tail", [12]],
    ]);
  });

  test("growth consumes zero draws and keeps the 13-part structure for every genome", () => {
    // The §1.2 fidelity law fixes the part set for EVERY genome; v1 has
    // no existence loci, so the graph's shape is genome-independent.
    const wantOrder = [...growQuadruped(DEFAULTS).slabOrder];
    for (let seed = 0; seed < 100; seed++) {
      const graph = growQuadruped(sampleGenome(BigInt(seed)));
      if (graph.drawsConsumed !== 0) expect.fail(`seed ${seed}: consumed draws`);
      if (graph.parts.length !== 13) expect.fail(`seed ${seed}: ${graph.parts.length} parts`);
      expect([...graph.slabOrder]).toEqual(wantOrder);
    }
  });

  test("mirror members are x-mirrors in the rest graph (legs: hips only — per-leg loci)", () => {
    const graph = growQuadruped(sampleGenome(123n));
    // Ears and eyes share one gene set: full mirror.
    for (const [l, r] of [
      [4, 5],
      [6, 7],
    ] as const) {
      const a = graph.parts[l]!.slab;
      const b = graph.parts[r]!.slab;
      expect(a.center[0]).toBe(-b.center[0]);
      expect(a.center.slice(1)).toEqual(b.center.slice(1));
      expect(a.half).toEqual(b.half);
    }
    // Legs are recorded pairs (design 02 §2) but carry per-socket loci
    // (design 06 §1.1), so only the ±hip_x placement mirrors.
    for (const [l, r] of [
      [8, 9],
      [10, 11],
    ] as const) {
      const a = graph.parts[l]!.slab;
      const b = graph.parts[r]!.slab;
      expect(a.center[0]).toBe(-b.center[0]);
      expect(a.center[1]).toBe(b.center[1]); // shared hip_y per pair
    }
  });

  test("part identity reconstructs loci from paths (limb subtrees are registry spellings)", () => {
    // The gait template reads `<path>.phase_group` etc. straight off the
    // node — so every limb path must be the canonical registry prefix.
    const graph = growQuadruped(DEFAULTS);
    for (const node of graph.parts.filter((p) => p.kind === "limb")) {
      for (const leafName of ["length", "girth", "phase_group"]) {
        expect(locusByPath(`${node.path}.${leafName}`), `${node.path}.${leafName}`).toBeDefined();
      }
    }
    expect(locusByPath("body.tail.length")).toBeDefined();
    expect(locusByPath("body.tail.girth")).toBeDefined();
  });

  test("the quadruped plan's canonical socket order is the pinned §1.4 order (U5 appends emitter, dorsal — emitter BEFORE ornament)", () => {
    const core = QUADRUPED_PLAN.core.make(DEFAULTS, 0, 1);
    expect(core.sockets!.map((s) => s.name)).toEqual([
      "underside",
      "head",
      "leg_fore",
      "leg_hind",
      "tail",
      "emitter",
      "dorsal",
    ]);
    const head = core.sockets![1]!.candidates[0]!.make(DEFAULTS, 0, 1);
    expect(head.sockets!.map((s) => s.name)).toEqual(["snout", "ears", "eyes"]);
  });

  test("rest graph + zero deltas = the idle φ=0 pose (except the lagged tail wag)", () => {
    // At idle φ = 0 the bob is exactly 0 but the tail's lagged wag is
    // not, so every slab except the tail's cx must equal the rest slab.
    for (const seed of [0n, 7n, 123n]) {
      const genome = sampleGenome(seed);
      const graph = growQuadruped(genome);
      const posed = poseQuadruped(genome, "idle", 0);
      for (let i = 0; i < 13; i++) {
        const rest = graph.parts[i]!.slab;
        const s = posed[i]!;
        expect([i === 12 ? rest.center[0] : s.cx, s.cy, s.cz]).toEqual([...rest.center]);
        expect([s.hx, s.hy, s.hz]).toEqual([...rest.half]);
      }
    }
  });
});
