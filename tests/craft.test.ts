import { describe, expect, test } from "vitest";

import {
  MAX_CLUSTERS,
  MAX_MERGE_ITERS,
  MAX_PASS_ITERS,
  MIN_CLUSTER_PX,
  N4,
  SOFT_MIN_DIM,
  SOFT_MIN_PX,
  computeExemptParts,
  craftClip,
  findClusters,
  rule2Orphan,
  rule3Jaggy,
  rule4Selout,
  rule5Clip,
  snapOffsets,
} from "../src/craft.js";
import type { CraftGrid, CraftPixel } from "../src/craft.js";
import { fp_mul, fp_sub } from "../src/fixed.js";
import { makeGenome, sampleGenome } from "../src/genome.js";
import type { Genome } from "../src/genome.js";
import { CHAINS, PART_NAMES } from "../src/grammar.js";
import type { MaterialRole } from "../src/grammar.js";
import { clipPhases, poseQuadruped } from "../src/pose.js";
import type { Slab } from "../src/pose.js";
import { DIRECTION_TURNS, ROLE_NAMES, TILT_RAW, rasterize, yawSlab } from "../src/raster.js";
import type { RasterGrid } from "../src/raster.js";

const DEFAULTS = makeGenome();
const WALK_PHASES = clipPhases(4);

// ---------------------------------------------------------------------------
// Scene helpers. Every expected value in the constructed-scene tests below
// was derived by the scratchpad Python oracle (craft_oracle.py, 2026-07-11),
// which implements the design 06 §1.5 semantics independently — never by
// running this implementation.
// ---------------------------------------------------------------------------

function cell(role: MaterialRole, tone: number, partId: number, depthRaw: number): CraftPixel {
  return { role, tone, partId, depthRaw, edge: 0 };
}

function emptyGrid(w = 32, h = 32): CraftGrid {
  const g: CraftGrid = [];
  for (let y = 0; y < h; y++) g.push(new Array<CraftPixel | null>(w).fill(null));
  return g;
}

function countOpaque(grid: readonly (readonly (CraftPixel | null)[])[]): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null) n++;
  return n;
}

function countFocal(grid: RasterGrid | CraftGrid): number {
  let n = 0;
  for (const row of grid) for (const c of row) if (c !== null && c.role === "focal") n++;
  return n;
}

/** Full craft pipeline of one walk cell: pose → snap → rasterize → craft. */
function craftWalkCell(genome: Genome, direction: "down" | "left" | "up" | "right") {
  const slabLists = WALK_PHASES.map((phi) => poseQuadruped(genome, "walk", phi));
  const offsets = snapOffsets(slabLists, direction);
  const raw = slabLists.map((slabs, f) => rasterize(slabs, direction, 32, 4, offsets[f]));
  return { raw, crafted: craftClip(raw) };
}

describe("pinned constants and chain table (design 06 §1.5)", () => {
  test("the 32×32 constant row", () => {
    expect(MAX_CLUSTERS).toBe(14);
    expect(MIN_CLUSTER_PX).toBe(4);
    expect(SOFT_MIN_PX).toBe(6);
    expect(SOFT_MIN_DIM).toBe(3);
    expect(MAX_PASS_ITERS).toBe(40);
    expect(MAX_MERGE_ITERS).toBe(300);
    expect(N4).toEqual([
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]);
  });

  test("CHAINS is the pinned quadruped table and partitions the 13 slabs", () => {
    expect(CHAINS.map((c) => [c.name, c.slabs])).toEqual([
      ["body", [0, 1]],
      ["head", [2, 3, 4, 5, 6, 7]],
      ["leg_fl", [8]],
      ["leg_fr", [9]],
      ["leg_bl", [10]],
      ["leg_br", [11]],
      ["tail", [12]],
    ]);
    const seen = CHAINS.flatMap((c) => [...c.slabs]).sort((a, b) => a - b);
    expect(seen).toEqual(PART_NAMES.map((_, i) => i)); // 0..12 exactly once
  });
});

describe("rule 2 — orphan cull and interior-island reassignment", () => {
  test("isolated pixel culled; interior island reassigned to dominant neighbor", () => {
    const g = emptyGrid();
    g[5]![5] = cell("hide", 0, 0, 100); // no opaque neighbor → cull
    g[10]![10] = cell("hide", 1, 5, 500); // island: 4 neighbors, none (hide, 1)
    g[9]![10] = cell("hide", 0, 1, 100); // up (donor: first in N4 order)
    g[11]![10] = cell("hide", 0, 2, 110); // down
    g[10]![9] = cell("underside", 0, 3, 120); // left
    g[10]![11] = cell("hide", 0, 4, 130); // right
    expect(rule2Orphan(g)).toBe(2);
    expect(g[5]![5]).toBeNull();
    // Oracle: dominant (hide, 0) with 3 votes; donor = up (partId 1); own
    // depthRaw kept.
    expect(g[10]![10]).toEqual(cell("hide", 0, 1, 500));
    // Arms survive (each has the center as an opaque neighbor).
    expect(g[9]![10]).toEqual(cell("hide", 0, 1, 100));
  });

  test("dominant-key tie breaks to the smallest (roleId, tone)", () => {
    const g = emptyGrid();
    g[10]![10] = cell("hide", 1, 5, 500);
    g[9]![10] = cell("hide", 0, 1, 100); // hide tone 0 ×2
    g[11]![10] = cell("underside", 0, 2, 110); // underside tone 0 ×2
    g[10]![9] = cell("hide", 0, 3, 120);
    g[10]![11] = cell("underside", 0, 4, 130);
    expect(rule2Orphan(g)).toBe(1);
    // Oracle: 2–2 tie → (0, 0) hide < (1, 0) underside; donor = up.
    expect(g[10]![10]).toEqual(cell("hide", 0, 1, 500));
  });

  test("focal pixels are exempt: neither island-reassigned nor culled (F16)", () => {
    const g = emptyGrid();
    g[10]![10] = cell("focal", 1, 6, 500);
    g[9]![10] = cell("hide", 0, 1, 100);
    g[11]![10] = cell("hide", 0, 2, 110);
    g[10]![9] = cell("hide", 0, 3, 120);
    g[10]![11] = cell("hide", 0, 4, 130);
    expect(rule2Orphan(g)).toBe(0);
    expect(g[10]![10]).toEqual(cell("focal", 1, 6, 500));
    const g2 = emptyGrid();
    g2[5]![5] = cell("focal", 1, 6, 100); // fully isolated focal
    expect(rule2Orphan(g2)).toBe(0);
    expect(g2[5]![5]).toEqual(cell("focal", 1, 6, 100));
  });
});

describe("rule 3 — jaggy repair", () => {
  /** The exact tooth pattern: v row above a straight w run with one v
   * tooth breaking it. Oracle: exactly one repair, at the tooth. */
  function toothScene(): CraftGrid {
    const g = emptyGrid();
    for (const x of [11, 12, 13]) g[10]![x] = cell("hide", 0, 1, 100); // v row
    g[11]![11] = cell("hide", 1, 2, 200);
    g[11]![12] = cell("hide", 0, 1, 100); // the tooth
    g[11]![13] = cell("hide", 1, 2, 200);
    for (const x of [11, 12, 13]) g[12]![x] = cell("hide", 1, 2, 200); // w row
    return g;
  }

  test("the exact tooth pattern fires once; the cell copies the opposite neighbor", () => {
    const g = toothScene();
    expect(rule3Jaggy(g)).toBe(1);
    // Oracle: (12, 11) becomes a full copy of (12, 12) — donor tags
    // including partId and depthRaw.
    expect(g[11]![12]).toEqual(cell("hide", 1, 2, 200));
  });

  test("a near-miss (one flank diagonal broken) does not fire anywhere", () => {
    const g = toothScene();
    g[10]![11] = null; // remove (11, 10) from the v row
    expect(rule3Jaggy(g)).toBe(0);
    expect(g[11]![12]).toEqual(cell("hide", 0, 1, 100)); // tooth intact
  });

  test("focal pixels are exempt: a focal tooth is never shaved into transparency (F16)", () => {
    // Oracle scene A: the shave pattern (w = ⊥) on a focal cluster does
    // not fire; scene A' pins that the identical hide geometry DOES.
    const g = emptyGrid();
    for (const x of [11, 12, 13]) g[10]![x] = cell("focal", 1, 6, 500);
    g[11]![12] = cell("focal", 1, 6, 500); // 1-px tooth into transparency
    expect(rule3Jaggy(g)).toBe(0);
    expect(g[11]![12]).toEqual(cell("focal", 1, 6, 500));
    const g2 = emptyGrid();
    for (const x of [11, 12, 13]) g2[10]![x] = cell("hide", 1, 1, 100);
    g2[11]![12] = cell("hide", 1, 1, 100); // same geometry, non-focal
    expect(rule3Jaggy(g2)).toBe(1); // oracle: the hide tooth IS shaved
    expect(g2[11]![12]).toBeNull();
  });

  test("focal pixels are exempt: a focal tooth is never recolored away from focal (F16)", () => {
    // Oracle scene B: the copy branch (w = hide) on a focal tooth does
    // not fire.
    const g = emptyGrid();
    for (const x of [11, 12, 13]) g[10]![x] = cell("focal", 1, 6, 500);
    g[11]![11] = cell("hide", 1, 2, 200);
    g[11]![12] = cell("focal", 1, 6, 500); // the tooth
    g[11]![13] = cell("hide", 1, 2, 200);
    for (const x of [11, 12, 13]) g[12]![x] = cell("hide", 1, 2, 200);
    expect(rule3Jaggy(g)).toBe(0);
    expect(g[11]![12]).toEqual(cell("focal", 1, 6, 500));
  });

  test("the exemption is one-sided: a transparent notch in a focal silhouette still fills", () => {
    // Oracle scene C: v = ⊥, w = focal — the donor copy ADDS a face
    // pixel (rule 3 may grow a face, never shrink it).
    const g = emptyGrid();
    for (const y of [11, 12]) for (let x = 10; x < 15; x++) g[y]![x] = cell("focal", 1, 6, 500);
    for (const x of [10, 11, 13, 14]) g[10]![x] = cell("focal", 1, 6, 500);
    expect(rule3Jaggy(g)).toBe(1); // exactly the notch at (12, 10)
    expect(g[10]![12]).toEqual(cell("focal", 1, 6, 500));
  });
});

describe("rule 5 — clip-scoped cluster budget", () => {
  test("src/dst determinism: sub-threshold cluster merges into the most-contact neighbor", () => {
    const g = emptyGrid();
    for (let x = 10; x < 13; x++) g[10]![x] = cell("hide", 0, 0, 10); // A, 3 px
    for (let x = 10; x < 20; x++) g[9]![x] = cell("hide", 1, 1, 20); // B, 10 px, 3 contacts
    for (let x = 12; x < 22; x++) g[11]![x] = cell("underside", 0, 2, 30); // C, 10 px, 1 contact
    const dec = rule5Clip([g]);
    // Oracle: A (0,0,0) → B (1,0,1); pixels keep partId/depthRaw.
    expect(dec).toEqual([{ src: [0, 0, 0], dst: [1, 0, 1] }]);
    for (let x = 10; x < 13; x++) expect(g[10]![x]).toEqual(cell("hide", 1, 0, 10));
  });

  test("dst contact tie breaks to the larger doubled median", () => {
    const g = emptyGrid();
    for (let x = 10; x < 13; x++) g[10]![x] = cell("hide", 0, 0, 10); // A, 3 px
    for (const x of [10, 11]) g[9]![x] = cell("hide", 1, 1, 20); // B: 2 contacts
    for (let x = 6; x < 12; x++) g[8]![x] = cell("hide", 1, 1, 20); // B total 8 px
    for (const x of [11, 12]) g[11]![x] = cell("hide", 2, 2, 30); // C: 2 contacts
    for (let x = 9; x < 19; x++) g[12]![x] = cell("hide", 2, 2, 30); // C total 12 px
    // Oracle: contacts tie 2–2 → C (dmed 24 > 16) wins.
    expect(rule5Clip([g])).toEqual([{ src: [0, 0, 0], dst: [2, 0, 2] }]);
  });

  test("contact-less sub-threshold cluster is deleted (floating debris)", () => {
    const g = emptyGrid();
    for (let x = 10; x < 13; x++) g[10]![x] = cell("hide", 0, 0, 10);
    expect(rule5Clip([g])).toEqual([{ src: [0, 0, 0], dst: null }]);
    expect(countOpaque(g)).toBe(0);
  });

  test("over budget with only contact-less large clusters: all skipped, stop at the floor", () => {
    const g = emptyGrid();
    for (let i = 0; i < 15; i++) {
      const bx = 2 + (i % 5) * 6;
      const by = 2 + Math.floor(i / 5) * 6;
      for (const dx of [0, 1]) for (const dy of [0, 1]) g[by + dy]![bx + dx] = cell("hide", 0, i, 10);
    }
    expect(rule5Clip([g])).toEqual([]); // skipped, never deleted
    expect(countOpaque(g)).toBe(60);
    expect(findClusters(g).length).toBe(15); // still over budget — allowed
  });

  test("focal keys are never src: an equal-size hide cluster merges, the eye survives (F16)", () => {
    const g = emptyGrid();
    for (let x = 8; x < 14; x++) for (let y = 8; y < 12; y++) g[y]![x] = cell("hide", 0, 0, 10);
    g[9]![14] = cell("focal", 1, 6, 5); // 2-px eye, sub-threshold
    g[10]![14] = cell("focal", 1, 6, 5);
    g[9]![7] = cell("hide", 2, 5, 8); // 2-px hide cluster, same size
    g[10]![7] = cell("hide", 2, 5, 8);
    const dec = rule5Clip([g]);
    // Oracle: only the hide cluster merges; the focal key is untouched.
    expect(dec).toEqual([{ src: [5, 0, 2], dst: [0, 0, 0] }]);
    expect(g[9]![14]).toEqual(cell("focal", 1, 6, 5));
    expect(g[10]![14]).toEqual(cell("focal", 1, 6, 5));
    expect(g[9]![7]).toEqual(cell("hide", 0, 5, 8));
  });

  test("focal keys may be dst: a hide scrap merges INTO the eye", () => {
    const g = emptyGrid();
    for (let x = 8; x < 13; x++) for (let y = 8; y < 12; y++) g[y]![x] = cell("focal", 1, 6, 5);
    for (const y of [9, 10, 11]) g[y]![13] = cell("hide", 0, 5, 8); // only neighbor = focal
    expect(rule5Clip([g])).toEqual([{ src: [5, 0, 0], dst: [6, 2, 1] }]);
    expect(g[9]![13]).toEqual(cell("focal", 1, 5, 8)); // partId/depth provenance kept
  });

  test("over budget with only focal keys left: stop at the floor, erase nothing", () => {
    const g = emptyGrid();
    for (let i = 0; i < 15; i++) {
      const bx = 2 + (i % 5) * 6;
      const by = 2 + Math.floor(i / 5) * 6;
      g[by]![bx] = cell("focal", 1, i, 5);
      g[by]![bx + 1] = cell("focal", 1, i, 5);
    }
    expect(rule5Clip([g])).toEqual([]);
    expect(countOpaque(g)).toBe(30);
  });
});

describe("rule 4 — selout on post-merge geometry", () => {
  test("open boundary → edge 1; interior → edge 0 (non-exempt part)", () => {
    const g = emptyGrid();
    for (let x = 10; x < 18; x++) for (let y = 10; y < 18; y++) g[y]![x] = cell("hide", 0, 0, 100);
    const exempt = computeExemptParts([g]);
    expect([...exempt]).toEqual([]); // 64 px, bbox 8 — not exempt
    rule4Selout([g], exempt);
    expect(g[10]![10]!.edge).toBe(1); // corner: open
    expect(g[11]![11]!.edge).toBe(0); // interior, same part all around
  });

  test("interior part boundary: edge 2 on the strictly-farther part, exact rational compare", () => {
    const g = emptyGrid();
    for (let x = 8; x < 11; x++) for (let y = 10; y < 13; y++) g[y]![x] = cell("hide", 0, 0, 4);
    for (let x = 11; x < 14; x++) for (let y = 10; y < 13; y++) g[y]![x] = cell("hide", 0, 1, 4);
    g[11]![13]!.depthRaw = 5; // B: sum 37, count 9 vs A: sum 36, count 9
    const exempt = computeExemptParts([g]);
    expect([...exempt]).toEqual([]); // both 9 px, bbox 3 — not exempt
    rule4Selout([g], exempt);
    // Oracle: 37·9 > 36·9 → B strictly farther. Interior B pixel adjacent
    // to A gets edge 2; the facing A pixel stays 0; open pixels get 1.
    expect(g[11]![11]!.edge).toBe(2);
    expect(g[11]![10]!.edge).toBe(0);
    expect(g[10]![11]!.edge).toBe(1);
    expect(g[10]![8]!.edge).toBe(1);
  });

  test("exactly equal part mean depths → no edge 2 (strict >, no epsilon)", () => {
    const g = emptyGrid();
    for (let x = 8; x < 11; x++) for (let y = 10; y < 13; y++) g[y]![x] = cell("hide", 0, 0, 4);
    for (let x = 11; x < 14; x++) for (let y = 10; y < 13; y++) g[y]![x] = cell("hide", 0, 1, 4);
    rule4Selout([g], computeExemptParts([g]));
    expect(g[11]![11]!.edge).toBe(0);
  });
});

describe("F15 — exemptions from part-level stats (craftClip)", () => {
  test("a thin part whose post-merge cluster exceeds both thresholds is still softened", () => {
    // P = 4-px part (2×2), Q = 3-px part column of a different tone; the
    // budget merge folds Q into P's cluster → 7 px, bbox 3×3: the spike's
    // post-merge cluster stats would NOT exempt it (size ≥ 6, bboxMin ≥ 3)
    // and every open pixel would drown in outline. PART-level stats are
    // merge-invariant (merges reassign role/tone only) and exempt both
    // parts (P dmed size 8 < 12, Q 6 < 12) → edge 0 everywhere.
    const g = emptyGrid();
    for (const x of [10, 11]) for (const y of [10, 11]) g[y]![x] = cell("hide", 0, 3, 7);
    for (const y of [9, 10, 11]) g[y]![12] = cell("hide", 1, 4, 9);
    const frames = [g, g, g, g];
    const { grids, info } = craftClip(frames);
    expect(info.mergeDecisions).toEqual([{ src: [4, 0, 1], dst: [3, 0, 0] }]);
    expect(info.exemptParts).toEqual([3, 4]);
    expect(info.iterations).toEqual([
      { rule2: 0, rule3: 0, merges: 1 },
      { rule2: 0, rule3: 0, merges: 0 },
    ]);
    expect(info.workRounds).toBe(1);
    expect(info.keyCountAtSelout).toBe(1);
    for (const f of grids) {
      expect(countOpaque(f)).toBe(7);
      // Q pixels recolored to (hide, 0), provenance kept, all edges 0.
      for (const y of [9, 10, 11]) expect(f[y]![12]).toEqual(cell("hide", 0, 4, 9));
      for (const x of [10, 11]) for (const y of [10, 11]) expect(f[y]![x]).toEqual(cell("hide", 0, 3, 7));
    }
    // Inputs were cloned, never mutated.
    expect(g[9]![12]).toEqual(cell("hide", 1, 4, 9));
  });
});

describe("clip scope — presence-based medians (F13)", () => {
  test("a key present in 2 of 4 frames is medianed over the present frames only", () => {
    const present = emptyGrid();
    for (let x = 10; x < 15; x++) present[10]![x] = cell("hide", 0, 0, 10); // 5 px
    const empty = emptyGrid();
    const { grids, info } = craftClip([present, present, empty, empty]);
    // Presence dmed = 10 ≥ 8 → not under (zero-inflating would read 5 < 8
    // and delete the body — the F13 thin-body failure).
    expect(info.mergeDecisions).toEqual([]);
    expect(countOpaque(grids[0]!)).toBe(5);
    expect(countOpaque(grids[2]!)).toBe(0);
  });

  test("a sub-threshold contact-less key present in 2 of 4 frames is deleted everywhere", () => {
    const present = emptyGrid();
    for (let x = 10; x < 13; x++) present[10]![x] = cell("hide", 0, 0, 10); // 3 px
    const empty = emptyGrid();
    const { grids, info } = craftClip([present, present, empty, empty]);
    expect(info.mergeDecisions).toEqual([{ src: [0, 0, 0], dst: null }]);
    for (const f of grids) expect(countOpaque(f)).toBe(0);
  });
});

describe("chain-grouped snapping (design 06 §1.5, F14/F16)", () => {
  /** Continuous chain-anchor screen y for the body chain (slab 0), down. */
  function bodyPosY(slabs: readonly Slab[]): number {
    const sl = yawSlab(slabs[0]!, DIRECTION_TURNS.down);
    return fp_sub(fp_sub(0, sl.cz), fp_mul(TILT_RAW, sl.cy));
  }

  test("F14: an exactly ±0.5 px oscillation parks (ties-to-even)", () => {
    // Idle bob at bob_amp 1.0: b = {0, +0.5, 0, −0.5} px — the knife-edge
    // case. Oracle raws: pos_y = −514458 − b, mean −514458, roundPx(mean)
    // = −524288, and BOTH ±0.5 displacements round to 0 (ties-to-even),
    // so every frame snaps to the same whole-pixel position.
    const g = makeGenome({ values: [["anim.quadruped.bob_amp", 65536]] });
    const slabLists = clipPhases(4).map((phi) => poseQuadruped(g, "idle", phi));
    const offs = snapOffsets(slabLists, "down");
    const expectedDy = [-9830, 22938, -9830, -42598]; // oracle raws
    for (let f = 0; f < 4; f++) {
      expect(offs[f]![0]).toEqual({ dx: 0, dy: expectedDy[f] });
      expect(offs[f]![1]).toEqual(offs[f]![0]); // body chain = slabs {0, 1}
      // Snapped position identical in every frame: parked.
      expect(bodyPosY(slabLists[f]!) + offs[f]![0]!.dy).toBe(-524288);
    }
  });

  test("a whole-pixel oscillation moves in whole pixels", () => {
    // Idle bob at bob_amp 2.0: b = {0, +1, 0, −1} px. Oracle: snapped =
    // {−524288, −589824, −524288, −458752} — crisp ±1 px steps (the dy
    // offset is the constant −9830: the motion is already pixel-aligned).
    const g = makeGenome({ values: [["anim.quadruped.bob_amp", 131072]] });
    const slabLists = clipPhases(4).map((phi) => poseQuadruped(g, "idle", phi));
    const offs = snapOffsets(slabLists, "down");
    const snapped = slabLists.map((s, f) => bodyPosY(s) + offs[f]![0]!.dy);
    expect(snapped).toEqual([-524288, -589824, -524288, -458752]);
    for (let f = 0; f < 4; f++) expect(offs[f]![0]!.dy).toBe(-9830);
  });

  test("chain grouping: every slab of a chain shares its chain's offset (all directions)", () => {
    const slabLists = WALK_PHASES.map((phi) => poseQuadruped(sampleGenome(7n), "walk", phi));
    for (const d of ["down", "left", "up", "right"] as const) {
      const offs = snapOffsets(slabLists, d);
      for (let f = 0; f < slabLists.length; f++) {
        for (const chain of CHAINS) {
          const anchorOff = offs[f]![chain.slabs[0]!];
          for (const s of chain.slabs) expect(offs[f]![s]).toEqual(anchorOff);
        }
        for (const off of offs[f]!) {
          expect(Number.isInteger(off.dx)).toBe(true);
          expect(Number.isInteger(off.dy)).toBe(true);
        }
      }
    }
  });

  test("rejects bad inputs", () => {
    expect(() => snapOffsets([], "down")).toThrow(RangeError);
    const slabs = poseQuadruped(DEFAULTS, "walk", 0);
    expect(() => snapOffsets([slabs.slice(0, 12)], "down")).toThrow(RangeError);
    expect(() => snapOffsets([slabs], "north" as never)).toThrow(RangeError);
  });
});

describe("rasterizer offset hook (design 06 §1.5)", () => {
  const slabs = poseQuadruped(DEFAULTS, "walk", 0);

  test("zero offsets are identical to no offsets", () => {
    const zero = slabs.map(() => ({ dx: 0, dy: 0 }));
    expect(rasterize(slabs, "down", 32, 4, zero)).toEqual(rasterize(slabs, "down"));
  });

  test("a whole-pixel offset shifts columns/rows exactly, depth tags untouched", () => {
    const base = rasterize(slabs, "down");
    const one = slabs.map(() => ({ dx: 65536, dy: 65536 }));
    const shifted = rasterize(slabs, "down", 32, 4, one);
    expect(countOpaque(shifted as CraftGrid)).toBe(countOpaque(base as CraftGrid));
    for (let py = 0; py < 31; py++) {
      for (let px = 0; px < 31; px++) {
        expect(shifted[py + 1]![px + 1]).toEqual(base[py]![px]);
      }
    }
  });

  test("rejects mismatched or non-integer offsets", () => {
    expect(() => rasterize(slabs, "down", 32, 4, [{ dx: 0, dy: 0 }])).toThrow(RangeError);
    const bad = slabs.map(() => ({ dx: 0.5, dy: 0 }));
    expect(() => rasterize(slabs, "down", 32, 4, bad)).toThrow(RangeError);
  });
});

describe("idempotence — craftClip ∘ craftClip = craftClip (constraint row 2)", () => {
  test("holds over 50 sampled genomes × walk × down (full snap + craft pipeline)", { timeout: 300000 }, () => {
    for (let seed = 0; seed < 50; seed++) {
      const { crafted } = craftWalkCell(sampleGenome(BigInt(seed)), "down");
      const second = craftClip(crafted.grids);
      expect(second.grids, `seed ${seed}`).toEqual(crafted.grids);
    }
  });
});

describe("pipeline property sweep", () => {
  test(
    "200 sampled genomes, walk φ = 0, down: fixpoint, budget, face guarantee, well-formed pixels",
    { timeout: 300000 },
    () => {
      for (let seed = 0; seed < 200; seed++) {
        const g = sampleGenome(BigInt(seed));
        const raw = rasterize(poseQuadruped(g, "walk", 0), "down");
        const preFocal = countFocal(raw);
        let out: ReturnType<typeof craftClip>;
        try {
          out = craftClip([raw]);
        } catch (e) {
          expect.fail(`seed ${seed}: craftClip threw ${String(e)}`);
        }
        if (out.info.keyCountAtSelout > MAX_CLUSTERS) {
          expect.fail(`seed ${seed}: ${out.info.keyCountAtSelout} keys after clip merge`);
        }
        if (preFocal > 0 && countFocal(out.grids[0]!) === 0) {
          expect.fail(`seed ${seed}: craft erased the face`);
        }
        for (const row of out.grids[0]!) {
          for (const c of row) {
            if (c === null) continue;
            if (!ROLE_NAMES.includes(c.role)) expect.fail(`seed ${seed}: bad role ${c.role}`);
            if (!Number.isInteger(c.tone) || c.tone < 0 || c.tone > 2) {
              expect.fail(`seed ${seed}: tone ${c.tone}`);
            }
            if (!Number.isInteger(c.partId) || c.partId < 0 || c.partId > 12) {
              expect.fail(`seed ${seed}: partId ${c.partId}`);
            }
            if (!Number.isInteger(c.depthRaw)) expect.fail(`seed ${seed}: depthRaw ${c.depthRaw}`);
            if (c.edge !== 0 && c.edge !== 1 && c.edge !== 2) {
              expect.fail(`seed ${seed}: edge ${c.edge}`);
            }
          }
        }
      }
    },
  );

  test(
    "30 sampled genomes, full 4-frame walk clips (snapped): budget and face guarantee per clip",
    { timeout: 300000 },
    () => {
      for (let seed = 0; seed < 30; seed++) {
        const { raw, crafted } = craftWalkCell(sampleGenome(BigInt(seed)), "down");
        expect(crafted.info.keyCountAtSelout, `seed ${seed}`).toBeLessThanOrEqual(MAX_CLUSTERS);
        const preFocal = raw.reduce((n, g) => n + countFocal(g), 0);
        const postFocal = crafted.grids.reduce((n, g) => n + countFocal(g), 0);
        if (preFocal > 0 && postFocal === 0) {
          expect.fail(`seed ${seed}: craft erased the face across the clip`);
        }
      }
    },
  );
});

describe("craftClip input validation and determinism", () => {
  test("rejects zero frames and ragged frame sets", () => {
    expect(() => craftClip([])).toThrow(RangeError);
    const a = rasterize(poseQuadruped(DEFAULTS, "walk", 0), "down");
    const b = rasterize(poseQuadruped(DEFAULTS, "walk", 0), "down", 33);
    expect(() => craftClip([a, b])).toThrow(RangeError);
  });

  test("same input twice gives deep-equal grids and info", () => {
    const raw = WALK_PHASES.map((phi) =>
      rasterize(poseQuadruped(sampleGenome(11n), "walk", phi), "down"),
    );
    const one = craftClip(raw);
    const two = craftClip(raw);
    expect(two.grids).toEqual(one.grids);
    expect(two.info).toEqual(one.info);
  });
});
