/**
 * Fablesprite — the M1 craft pass (design 06 §1.5, normative; design 04 §4
 * as amended by Spike S3 — findings F13–F16 in docs/ASSESSMENT.md §2).
 *
 * tagged grids → crafted grids: this module implements the clip-scoped
 * craft pipeline — quantize (done upstream by the rasterizer's majority
 * vote) → rules 2/3/5 iterated to a joint fixpoint → rule 4 (selout)
 * decided AND applied on post-merge geometry (F13, constraint row 2) —
 * plus the chain-grouped pixel snapping (constraint row 3, F14/F16) that
 * feeds the rasterizer's §1.5 offset hook. Rules 6 and 7 are M2/M3 and
 * deliberately absent (R10); the flicker metric and its CI gate are a
 * separate unit.
 *
 * Everything is exact integer arithmetic (RISKS R6): per-key statistics
 * are DOUBLED presence-medians (sums of middle samples, compared against
 * doubled thresholds — no half is ever materialized), part mean depths
 * compare by exact rational cross-multiplication, and snapping rounds
 * with rheDiv's ties-to-even. A second implementer must be able to
 * reproduce the crafted grids bit-exactly from design 06 §1.5 alone.
 *
 * Unit of work: one clip × direction cell — the K tagged RasterGrids of
 * that cell (plus, for snapping, the K slab lists that produced them).
 * All clip-wide decisions are computed once from clip aggregates and
 * applied to every frame identically (design 03 §4 — anti-flicker).
 */

import { fp_mul, fp_sub, rheDiv } from "./fixed.js";
import type { Chain, MaterialRole } from "./grammar.js";
import { CHAINS } from "./grammar.js";
import type { Slab } from "./pose.js";
import { DIRECTION_TURNS, ROLE_IDS, ROLE_NAMES, TILT_RAW, yawSlab } from "./raster.js";
import type { Direction, RasterGrid, SlabOffset } from "./raster.js";

// ---------------------------------------------------------------------------
// Pinned constants (design 06 §1.5 — the 32×32 row; every craft threshold
// is resolution-scoped in principle per constraint row 8, M1 pins size 32
// only per D5)
// ---------------------------------------------------------------------------

/** Rule 5 cluster-key budget at 32×32. */
export const MAX_CLUSTERS = 14;
/** Rule 5 sub-threshold cluster size at 32×32. */
export const MIN_CLUSTER_PX = 4;
/** F7 softening: part size threshold at 32×32 (F15 part-level form). */
export const SOFT_MIN_PX = 6;
/** F7 softening: part bbox-min threshold at 32×32 (F15 part-level form). */
export const SOFT_MIN_DIM = 3;
/** Fixpoint safety cap for one craft pass — exceeding it traps (§1.5). */
export const MAX_PASS_ITERS = 40;
/** Safety cap inside rule 5 — exceeding it traps (§1.5). */
export const MAX_MERGE_ITERS = 300;
/** Safety cap inside the sequential rule-2 cycle-breaker (design 07 §4.4). */
export const MAX_SEQ_CHANGES = 4096;

/**
 * The pinned 4-neighborhood order (design 06 §1.5): up, down, left,
 * right. Rule 2's donor choice and rule 3's first-matching-direction
 * rule depend on this order; out-of-bounds cells are transparent.
 */
export const N4: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([0, -1] as const),
  Object.freeze([0, 1] as const),
  Object.freeze([-1, 0] as const),
  Object.freeze([1, 0] as const),
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One opaque cell of a crafted grid (design 06 §1.5): the four §1.4
 * rasterizer tags plus the selout edge flag — 0 none, 1 = boundary-vs-
 * transparent (outline: the palette layer draws ramp slot 0), 2 = farther
 * side of an interior part boundary (one tone darker). Mutable: craft
 * rules edit clones in place; inputs are never mutated.
 */
export interface CraftPixel {
  role: MaterialRole;
  tone: number;
  partId: number;
  depthRaw: number;
  edge: number;
}

/** A crafted (or in-progress working) grid: `grid[py][px]`, null = transparent. */
export type CraftGrid = (CraftPixel | null)[][];

/**
 * A cluster key — the clip-stable identity (partId, roleId, tone) of
 * design 06 §1.5 (roleId per the §1.3 wire ids: hide 0, underside 1,
 * focal 2), compared lexicographically.
 */
export type ClusterKey = readonly [partId: number, roleId: number, tone: number];

/**
 * One rule-5 decision: src merged into dst, or deleted (dst = null —
 * contact-less floating debris below MIN_CLUSTER_PX).
 */
export interface MergeDecision {
  readonly src: ClusterKey;
  readonly dst: ClusterKey | null;
}

/** Per-iteration activity counts of the §1.5 fixpoint loop. */
export interface CraftIteration {
  readonly rule2: number;
  readonly rule3: number;
  readonly merges: number;
}

/** The craft pass's decisions record (design 06 §1.5 orchestration). */
export interface CraftInfo {
  /** One entry per fixpoint iteration; the last is all-zero (the proof). */
  readonly iterations: readonly CraftIteration[];
  /**
   * True iff the pass detected a repeated grid state (a proven cycle —
   * the simultaneous iteration is a pure function of the grids, so a
   * repeat with activity can never converge) and switched rule 2 to its
   * sequential cycle-breaker form (design 07 §4.4). False for every
   * genome the v1 pass accepted — the detection condition is exactly
   * "would have trapped".
   */
  readonly cycleBroken: boolean;
  /** Iterations with any change (the S3 "work rounds" log). */
  readonly workRounds: number;
  /** Total rule-2 culls + reassignments across the pass. */
  readonly rule2Total: number;
  /** Total rule-3 repairs across the pass. */
  readonly rule3Total: number;
  /** Ordered rule-5 decisions across all iterations. */
  readonly mergeDecisions: readonly MergeDecision[];
  /** F15 exempt part ids (ascending), from the fixpoint part stats. */
  readonly exemptParts: readonly number[];
  /** Distinct cluster keys across the clip at selout time. */
  readonly keyCountAtSelout: number;
}

/** A cluster: 4-connected same-(role, tone) region (design 06 §1.5). */
export interface Cluster {
  readonly key: ClusterKey;
  /** Pixels as (x, y) pairs, discovery order (order carries no meaning). */
  readonly pixels: readonly (readonly [number, number])[];
  readonly size: number;
}

// ---------------------------------------------------------------------------
// Shared machinery
// ---------------------------------------------------------------------------

/** Focal's §1.3 wire id — the merge-protected role (F16). */
const FOCAL_ID = ROLE_IDS.focal;

/**
 * Encode a key triple as one integer whose numeric order IS the
 * lexicographic order of (partId, roleId, tone): partId ≤ 255 (§1.4 part
 * tags are bytes), roleId < 4, tone < 4.
 */
function encodeKey(partId: number, roleId: number, tone: number): number {
  return partId * 16 + roleId * 4 + tone;
}

function decodeKey(k: number): ClusterKey {
  const tone = k % 4;
  const roleId = Math.floor(k / 4) % 4;
  return Object.freeze([Math.floor(k / 16), roleId, tone]) as ClusterKey;
}

interface FrameClusters {
  clusters: InternalCluster[];
  /** label[py*w + px] = cluster index, −1 transparent. */
  label: Int32Array;
}

interface InternalCluster {
  key: number;
  pixels: [number, number][];
  size: number;
}

/**
 * Find the 4-connected same-(role, tone) clusters of a grid
 * (design 06 §1.5 shared machinery). Key partId = majority part tag over
 * the region, ties to the LOWEST partId.
 */
function findClustersInternal(grid: CraftGrid, w: number, h: number): FrameClusters {
  const label = new Int32Array(w * h).fill(-1);
  const clusters: InternalCluster[] = [];
  for (let y0 = 0; y0 < h; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const seed = grid[y0]![x0] ?? null;
      if (seed === null || label[y0 * w + x0] !== -1) continue;
      const idx = clusters.length;
      const role = seed.role;
      const tone = seed.tone;
      const roleId = ROLE_IDS[role];
      const stack: [number, number][] = [[x0, y0]];
      label[y0 * w + x0] = idx;
      const pixels: [number, number][] = [];
      const partCounts = new Map<number, number>();
      while (stack.length > 0) {
        const [x, y] = stack.pop()!;
        pixels.push([x, y]);
        const p = grid[y]![x]!.partId;
        partCounts.set(p, (partCounts.get(p) ?? 0) + 1);
        for (const [dx, dy] of N4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || label[ny * w + nx] !== -1) continue;
          const c = grid[ny]![nx] ?? null;
          if (c !== null && c.role === role && c.tone === tone) {
            label[ny * w + nx] = idx;
            stack.push([nx, ny]);
          }
        }
      }
      // Majority part, ties → lowest partId.
      let part = -1;
      let best = -1;
      for (const [p, n] of partCounts) {
        if (n > best || (n === best && p < part)) {
          part = p;
          best = n;
        }
      }
      clusters.push({ key: encodeKey(part, roleId, tone), pixels, size: pixels.length });
    }
  }
  return { clusters, label };
}

/**
 * The exported cluster view (for tests and the differential verifier):
 * decoded keys, no labels.
 */
export function findClusters(grid: CraftGrid): Cluster[] {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  return findClustersInternal(grid, w, h).clusters.map((c) =>
    Object.freeze({
      key: decodeKey(c.key),
      pixels: Object.freeze(c.pixels.map((p) => Object.freeze([p[0], p[1]] as const))),
      size: c.size,
    }),
  );
}

/**
 * Doubled median of a non-empty integer sample list (design 06 §1.5):
 * sort ascending; odd count → 2·middle; even count → the sum of the two
 * middles. Callers compare against doubled thresholds — no halves.
 */
function doubledMedian(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  if (n % 2 === 1) return 2 * v[(n - 1) / 2]!;
  return v[n / 2 - 1]! + v[n / 2]!;
}

// ---------------------------------------------------------------------------
// Rule 2 — orphan cull (design 06 §1.5)
// ---------------------------------------------------------------------------

/**
 * Rule 2: cull opaque pixels with no opaque 4-neighbor; reassign interior
 * 1-px islands (4 opaque neighbors, none sharing the pixel's
 * (role, tone)) to the dominant neighbor key — most of the 4 neighbors,
 * ties to the lexicographically smallest (roleId, tone); donor = the
 * first neighbor in N4 order with that key; the pixel takes the donor's
 * role/tone/partId and keeps its OWN depthRaw, edge 0. Focal pixels are
 * exempt entirely (F16 / constraint row 6: a craft rule may never erase
 * a face). Detect-then-apply: donor tags are read from the pre-rule
 * grid — all changes are detected and their donor values captured
 * before any is applied. Mutates `grid`; returns the change count.
 */
export function rule2Orphan(grid: CraftGrid): number {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const cell = (x: number, y: number): CraftPixel | null =>
    x >= 0 && x < w && y >= 0 && y < h ? (grid[y]![x] ?? null) : null;

  const culls: [number, number][] = [];
  const reassigns: { x: number; y: number; role: MaterialRole; tone: number; partId: number }[] =
    [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y]![x] ?? null;
      if (c === null || c.role === "focal") continue;
      let opaque = 0;
      let shares = false;
      for (const [dx, dy] of N4) {
        const n = cell(x + dx, y + dy);
        if (n === null) continue;
        opaque++;
        if (n.role === c.role && n.tone === c.tone) shares = true;
      }
      if (opaque === 0) {
        culls.push([x, y]);
        continue;
      }
      if (opaque === 4 && !shares) {
        // Dominant neighbor key: most neighbors, ties → smallest
        // (roleId, tone). All four neighbors are opaque here.
        const counts = new Map<number, number>();
        for (const [dx, dy] of N4) {
          const n = cell(x + dx, y + dy)!;
          const k = ROLE_IDS[n.role] * 4 + n.tone;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        let domKey = -1;
        let domCount = -1;
        for (const [k, n] of counts) {
          if (n > domCount || (n === domCount && k < domKey)) {
            domKey = k;
            domCount = n;
          }
        }
        for (const [dx, dy] of N4) {
          const n = cell(x + dx, y + dy)!;
          if (ROLE_IDS[n.role] * 4 + n.tone === domKey) {
            reassigns.push({ x, y, role: n.role, tone: n.tone, partId: n.partId });
            break;
          }
        }
      }
    }
  }
  for (const [x, y] of culls) grid[y]![x] = null;
  for (const r of reassigns) {
    const own = grid[r.y]![r.x]!;
    grid[r.y]![r.x] = { role: r.role, tone: r.tone, partId: r.partId, depthRaw: own.depthRaw, edge: 0 };
  }
  return culls.length + reassigns.length;
}

/**
 * Sequential form of rule 2 — the design 06 §1.5 cycle-breaker (U2
 * amendment, design 07 §4.4): repeatedly scan the grid in row-major order
 * (y outer, x inner — rule 2's own scan order) and, at the FIRST pixel
 * where rule 2 would fire (cull or interior-island reassignment, decided
 * from the CURRENT grid), apply that single change and restart the scan
 * from the top; stop when a full scan fires nothing. One pixel at a time,
 * so the mutual-donor island pairs that put the simultaneous
 * detect-then-apply form into a 2-cycle (the seed-1132 trap) settle
 * instead: reassigning the scan-first member gives it its partner's key,
 * and the partner then shares a (role, tone) with it and stops being an
 * island. Only ever invoked by {@link craftClip} AFTER a repeated grid
 * state proves the simultaneous form diverges — no non-trapped cell ever
 * reaches this code path. Mutates `grid`; returns the change count; traps
 * after MAX_SEQ_CHANGES changes (no termination proof exists — the cap
 * preserves the §1.5 trap-not-loop discipline).
 */
export function rule2Sequential(grid: CraftGrid): number {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const cell = (x: number, y: number): CraftPixel | null =>
    x >= 0 && x < w && y >= 0 && y < h ? (grid[y]![x] ?? null) : null;

  let changes = 0;
  for (;;) {
    if (changes > MAX_SEQ_CHANGES) {
      throw new Error(
        "craft: sequential rule 2 did not settle within MAX_SEQ_CHANGES (design 06 §1.5 trap discipline)",
      );
    }
    let fired = false;
    scan: for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y]![x] ?? null;
        if (c === null || c.role === "focal") continue;
        let opaque = 0;
        let shares = false;
        for (const [dx, dy] of N4) {
          const n = cell(x + dx, y + dy);
          if (n === null) continue;
          opaque++;
          if (n.role === c.role && n.tone === c.tone) shares = true;
        }
        if (opaque === 0) {
          grid[y]![x] = null;
          fired = true;
          changes++;
          break scan;
        }
        if (opaque === 4 && !shares) {
          // Identical dominant-neighbor rule to rule2Orphan.
          const counts = new Map<number, number>();
          for (const [dx, dy] of N4) {
            const n = cell(x + dx, y + dy)!;
            const k = ROLE_IDS[n.role] * 4 + n.tone;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
          let domKey = -1;
          let domCount = -1;
          for (const [k, n] of counts) {
            if (n > domCount || (n === domCount && k < domKey)) {
              domKey = k;
              domCount = n;
            }
          }
          for (const [dx, dy] of N4) {
            const n = cell(x + dx, y + dy)!;
            if (ROLE_IDS[n.role] * 4 + n.tone === domKey) {
              grid[y]![x] = {
                role: n.role,
                tone: n.tone,
                partId: n.partId,
                depthRaw: c.depthRaw,
                edge: 0,
              };
              break;
            }
          }
          fired = true;
          changes++;
          break scan;
        }
      }
    }
    if (!fired) return changes;
  }
}

// ---------------------------------------------------------------------------
// Rule 3 — jaggy repair (design 06 §1.5)
// ---------------------------------------------------------------------------

/**
 * Rule 3: repair single-pixel teeth/notches that break an otherwise
 * straight run between exactly two clusters (transparent counts as a
 * cluster; out-of-bounds is transparent). For a cell p with value v
 * (its (role, tone), or ⊥ when transparent), scanning d ∈ N4 in the
 * pinned order and firing on the FIRST match: p's d-neighbor continues
 * v; the other three neighbors share one value w ≠ v; the two diagonals
 * beside the d-neighbor are v and the two beside the opposite neighbor
 * are w. Repair: w = ⊥ deletes p, else p becomes a full copy (role,
 * tone, partId, depthRaw) of the opposite neighbor, edge 0. The repaired
 * boundary is locally stable, so repairs cannot cascade. Focal pixels
 * are exempt entirely, as in rule 2 (F16 / constraint row 6): a cell
 * whose v is focal never fires — never shaved into transparency, never
 * recolored away from focal. The exemption is one-sided: a transparent
 * notch in a focal silhouette still fills and a non-focal tooth may
 * adopt a focal donor — rule 3 may grow a face, never shrink it.
 * Detect-then-apply; mutates `grid`; returns the repair count.
 */
export function rule3Jaggy(grid: CraftGrid): number {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  // Cell value: (roleId·4 + tone) or −1 for transparent/out-of-bounds.
  const val = (x: number, y: number): number => {
    if (x < 0 || x >= w || y < 0 || y >= h) return -1;
    const c = grid[y]![x] ?? null;
    return c === null ? -1 : ROLE_IDS[c.role] * 4 + c.tone;
  };

  const repairs: { x: number; y: number; donor: CraftPixel | null }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = val(x, y);
      // Focal cells never fire (F16 / constraint row 6, design 06 §1.5):
      // rule 3 may grow a face, never shrink it.
      if (v !== -1 && Math.floor(v / 4) === FOCAL_ID) continue;
      for (const [dx, dy] of N4) {
        if (val(x + dx, y + dy) !== v) continue;
        const others = N4.filter(([ox, oy]) => ox !== dx || oy !== dy);
        const w0 = val(x + others[0]![0], y + others[0]![1]);
        if (w0 === v) continue;
        if (
          val(x + others[1]![0], y + others[1]![1]) !== w0 ||
          val(x + others[2]![0], y + others[2]![1]) !== w0
        ) {
          continue;
        }
        // Perpendiculars to d.
        const p1x = -dy;
        const p1y = dx;
        const p2x = dy;
        const p2y = -dx;
        if (val(x + dx + p1x, y + dy + p1y) !== v) continue;
        if (val(x + dx + p2x, y + dy + p2y) !== v) continue;
        if (val(x - dx + p1x, y - dy + p1y) !== w0) continue;
        if (val(x - dx + p2x, y - dy + p2y) !== w0) continue;
        // w0 !== −1 ⟹ the opposite cell is in-bounds and opaque.
        const donor = w0 === -1 ? null : grid[y - dy]![x - dx]!;
        repairs.push({
          x,
          y,
          donor:
            donor === null
              ? null
              : { role: donor.role, tone: donor.tone, partId: donor.partId, depthRaw: donor.depthRaw, edge: 0 },
        });
        break;
      }
    }
  }
  for (const r of repairs) grid[r.y]![r.x] = r.donor;
  return repairs.length;
}

// ---------------------------------------------------------------------------
// Rule 5 — cluster budget, clip-scoped (design 06 §1.5)
// ---------------------------------------------------------------------------

interface ClipStats {
  /** key → per-present-frame summed sizes. */
  sizes: Map<number, number[]>;
  /** unordered key-pair (ka·4096 + kb, ka < kb) → summed contact count. */
  contacts: Map<number, number>;
  /** per frame: clusters (for the apply step). */
  frames: FrameClusters[];
}

function clipStats(grids: readonly CraftGrid[], w: number, h: number): ClipStats {
  const sizes = new Map<number, number[]>();
  const contacts = new Map<number, number>();
  const frames: FrameClusters[] = [];
  for (const grid of grids) {
    const fc = findClustersInternal(grid, w, h);
    frames.push(fc);
    // Per-frame per-key size (same-key clusters sum within the frame).
    const frameSizes = new Map<number, number>();
    for (const c of fc.clusters) {
      frameSizes.set(c.key, (frameSizes.get(c.key) ?? 0) + c.size);
    }
    for (const [k, s] of frameSizes) {
      let list = sizes.get(k);
      if (list === undefined) {
        list = [];
        sizes.set(k, list);
      }
      list.push(s);
    }
    // Contacts: each 4-adjacent pixel pair across two distinct clusters,
    // counted once via the (+1, 0) and (0, +1) neighbors; same-key pairs
    // are dropped; counts sum over the clip.
    const { clusters, label } = fc;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y]![x] === null) continue;
        const a = label[y * w + x]!;
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= w || ny >= h || grid[ny]![nx] === null) continue;
          const b = label[ny * w + nx]!;
          if (b === a) continue;
          const ka = clusters[a]!.key;
          const kb = clusters[b]!.key;
          if (ka === kb) continue;
          const pair = ka < kb ? ka * 4096 + kb : kb * 4096 + ka;
          contacts.set(pair, (contacts.get(pair) ?? 0) + 1);
        }
      }
    }
  }
  return { sizes, contacts, frames };
}

/**
 * Rule 5: merge sub-threshold cluster keys into their dominant neighbor
 * (and delete contact-less floating debris) until every key's doubled
 * presence-median size ≥ 2·MIN_CLUSTER_PX and at most MAX_CLUSTERS keys
 * remain — or until only merge-protected/skipped keys are left (the
 * "stop at the floor" rule). Focal keys are never selectable as src
 * (F16); they still count toward the budget and may be dst. Comparators
 * (design 06 §1.5, all on doubled medians): src = min by (dmed, key);
 * dst = min by (−contact, −dmed, key). Merges reassign (role, tone)
 * only, applied to every frame identically; decisions are recorded in
 * order (deletions with dst = null). Mutates `grids`; traps after
 * MAX_MERGE_ITERS.
 */
export function rule5Clip(grids: readonly CraftGrid[]): MergeDecision[] {
  const h = grids[0]?.length ?? 0;
  const w = h > 0 ? grids[0]![0]!.length : 0;
  const decisions: MergeDecision[] = [];
  const skip = new Set<number>();
  for (let iter = 0; iter < MAX_MERGE_ITERS; iter++) {
    const { sizes, contacts, frames } = clipStats(grids, w, h);
    const dmed = new Map<number, number>();
    for (const [k, list] of sizes) dmed.set(k, doubledMedian(list));
    const keys = [...sizes.keys()].sort((a, b) => a - b);
    const selectable = keys.filter((k) => Math.floor(k / 4) % 4 !== FOCAL_ID && !skip.has(k));
    const under = selectable.filter((k) => dmed.get(k)! < 2 * MIN_CLUSTER_PX);
    const overBudget = keys.length > MAX_CLUSTERS;
    if (under.length === 0 && !overBudget) return decisions; // converged
    const pool = under.length > 0 ? under : selectable;
    if (pool.length === 0) return decisions; // floor: only protected/skipped keys left
    // src = min by (dmed, key); pool is key-ascending already.
    let src = pool[0]!;
    for (const k of pool) {
      if (dmed.get(k)! < dmed.get(src)!) src = k;
    }
    // Neighbor contact sums for src.
    const nbr = new Map<number, number>();
    for (const [pair, n] of contacts) {
      const ka = Math.floor(pair / 4096);
      const kb = pair % 4096;
      if (ka === src) nbr.set(kb, (nbr.get(kb) ?? 0) + n);
      else if (kb === src) nbr.set(ka, (nbr.get(ka) ?? 0) + n);
    }
    let dst: number | null;
    if (nbr.size === 0) {
      if (dmed.get(src)! < 2 * MIN_CLUSTER_PX) {
        dst = null; // contact-less floating debris → delete
      } else {
        skip.add(src); // large contact-less cluster → skip, never delete
        continue;
      }
    } else {
      // dst = min by (−contact, −dmed, key).
      dst = -1;
      let bestContact = -1;
      let bestDmed = -1;
      for (const [k, n] of nbr) {
        const dm = dmed.get(k)!;
        if (
          n > bestContact ||
          (n === bestContact && dm > bestDmed) ||
          (n === bestContact && dm === bestDmed && k < dst!)
        ) {
          dst = k;
          bestContact = n;
          bestDmed = dm;
        }
      }
    }
    // Apply to every frame: pixels of src-keyed clusters are deleted or
    // reassigned to dst's (role, tone), keeping partId/depthRaw.
    const dstKey = dst === null ? null : decodeKey(dst);
    for (let f = 0; f < grids.length; f++) {
      for (const c of frames[f]!.clusters) {
        if (c.key !== src) continue;
        for (const [x, y] of c.pixels) {
          if (dstKey === null) {
            grids[f]![y]![x] = null;
          } else {
            const cell = grids[f]![y]![x]!;
            grids[f]![y]![x] = {
              role: ROLE_NAMES[dstKey[1]]!,
              tone: dstKey[2],
              partId: cell.partId,
              depthRaw: cell.depthRaw,
              edge: 0,
            };
          }
        }
      }
    }
    decisions.push(Object.freeze({ src: decodeKey(src), dst: dstKey }));
  }
  throw new Error("craft: rule 5 did not converge within MAX_MERGE_ITERS (design 06 §1.5 trap)");
}

// ---------------------------------------------------------------------------
// Rule 4 — selout (design 06 §1.5, F13/F15)
// ---------------------------------------------------------------------------

/**
 * F15: the F7 thinness exemptions, decided from PART-LEVEL stats —
 * computed once per craft pass from the POST-FIXPOINT grids
 * (superseding the spike's post-merge per-KEY stats; rule-5 merges
 * reassign (role, tone) only, so the budget merge can never inflate a
 * part out of its exemption — the exact F15 failure). Pinned at the
 * fixpoint, not the pass input, because idempotence demands it
 * (design 06 §1.5: input-grid stats broke the contract on 5 of the
 * first 50 sampled walk cells). Per frame per partId over the part's
 * FULL pixel set: size = pixel count, bboxMin = min(bbox width,
 * height); present iff size > 0. A part is exempt iff its doubled
 * presence-median size < 12 (2·SOFT_MIN_PX) OR its doubled
 * presence-median bboxMin < 6 (2·SOFT_MIN_DIM).
 */
export function computeExemptParts(grids: readonly CraftGrid[]): Set<number> {
  const perPart = new Map<number, { sizes: number[]; bboxMins: number[] }>();
  for (const grid of grids) {
    const h = grid.length;
    const w = h > 0 ? grid[0]!.length : 0;
    const frame = new Map<
      number,
      { n: number; minX: number; maxX: number; minY: number; maxY: number }
    >();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y]![x] ?? null;
        if (c === null) continue;
        const e = frame.get(c.partId);
        if (e === undefined) {
          frame.set(c.partId, { n: 1, minX: x, maxX: x, minY: y, maxY: y });
        } else {
          e.n++;
          if (x < e.minX) e.minX = x;
          if (x > e.maxX) e.maxX = x;
          if (y < e.minY) e.minY = y;
          if (y > e.maxY) e.maxY = y;
        }
      }
    }
    for (const [p, e] of frame) {
      let s = perPart.get(p);
      if (s === undefined) {
        s = { sizes: [], bboxMins: [] };
        perPart.set(p, s);
      }
      s.sizes.push(e.n);
      s.bboxMins.push(Math.min(e.maxX - e.minX + 1, e.maxY - e.minY + 1));
    }
  }
  const exempt = new Set<number>();
  for (const [p, s] of perPart) {
    if (doubledMedian(s.sizes) < 2 * SOFT_MIN_PX || doubledMedian(s.bboxMins) < 2 * SOFT_MIN_DIM) {
      exempt.add(p);
    }
  }
  return exempt;
}

/**
 * Rule 4: selout, decided and applied on post-merge geometry (F13). Part
 * mean depths over ALL frames' opaque pixels compare by exact rational
 * cross-multiplication — part a strictly farther than part b iff
 * depthSum[a]·count[b] > depthSum[b]·count[a] (BigInt; the spike's 1e-9
 * epsilon is superseded by exact strict >). Per frame: a cluster is
 * exempt iff its majority part (its key's partId) is in `exemptParts`;
 * edges reset to 0, then per opaque pixel — exempt cluster → 0; open
 * (any transparent/out-of-bounds 4-neighbor) → 1; else any opaque
 * neighbor of a different, strictly-nearer part → 2. Mutates `grids`;
 * returns the distinct key count across the clip at selout time.
 */
export function rule4Selout(grids: readonly CraftGrid[], exemptParts: ReadonlySet<number>): number {
  // Part mean depths over all frames.
  const depthSum = new Map<number, number>();
  const depthCount = new Map<number, number>();
  for (const grid of grids) {
    for (const row of grid) {
      for (const c of row) {
        if (c === null) continue;
        depthSum.set(c.partId, (depthSum.get(c.partId) ?? 0) + c.depthRaw);
        depthCount.set(c.partId, (depthCount.get(c.partId) ?? 0) + 1);
      }
    }
  }
  const farther = (a: number, b: number): boolean =>
    BigInt(depthSum.get(a)!) * BigInt(depthCount.get(b)!) >
    BigInt(depthSum.get(b)!) * BigInt(depthCount.get(a)!);

  const keys = new Set<number>();
  for (const grid of grids) {
    const h = grid.length;
    const w = h > 0 ? grid[0]!.length : 0;
    const { clusters, label } = findClustersInternal(grid, w, h);
    const exemptIdx = new Set<number>();
    for (let i = 0; i < clusters.length; i++) {
      keys.add(clusters[i]!.key);
      if (exemptParts.has(Math.floor(clusters[i]!.key / 16))) exemptIdx.add(i);
    }
    for (const row of grid) {
      for (const c of row) {
        if (c !== null) c.edge = 0;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const cell = grid[y]![x] ?? null;
        if (cell === null) continue;
        if (exemptIdx.has(label[y * w + x]!)) continue;
        let open = false;
        for (const [dx, dy] of N4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || grid[ny]![nx] === null) {
            open = true;
            break;
          }
        }
        if (open) {
          cell.edge = 1;
          continue;
        }
        for (const [dx, dy] of N4) {
          const n = grid[y + dy]![x + dx]!;
          if (n.partId !== cell.partId && farther(cell.partId, n.partId)) {
            cell.edge = 2;
            break;
          }
        }
      }
    }
  }
  return keys.size;
}

// ---------------------------------------------------------------------------
// craftClip — the orchestration (design 06 §1.5)
// ---------------------------------------------------------------------------

/**
 * The M1 craft pass over one clip × direction cell (design 06 §1.5,
 * normative): clone the K input grids; iterate rule 2 → rule 3 (each
 * over every frame in ascending frame order) → rule 5 until a whole
 * iteration changes nothing (≤ MAX_PASS_ITERS, else trap); then compute
 * the F15 exempt-part set from the fixpoint grids and let rule 4 decide
 * and apply the selout edges. Inputs are never mutated. Idempotence is a
 * hard contract (constraint row 2): `craftClip(craftClip(g).grids).grids`
 * deep-equals `craftClip(g).grids`, property-tested in CI — the fixpoint
 * placement of the F15 stats is what makes it hold by construction.
 */
export function craftClip(input: readonly RasterGrid[]): { grids: CraftGrid[]; info: CraftInfo } {
  if (input.length === 0) {
    throw new RangeError("craft: craftClip needs at least one frame");
  }
  const h = input[0]!.length;
  const w = h > 0 ? input[0]![0]!.length : 0;
  for (const g of input) {
    if (g.length !== h || g.some((row) => row.length !== w)) {
      throw new RangeError("craft: all frames must share one width × height");
    }
  }
  // Clone to working grids (edge enters as 0).
  const grids: CraftGrid[] = input.map((g) =>
    g.map((row) =>
      row.map((c) =>
        c === null
          ? null
          : { role: c.role, tone: c.tone, partId: c.partId, depthRaw: c.depthRaw, edge: 0 },
      ),
    ),
  );

  // Cycle detection (design 07 §4.4): one simultaneous iteration is a
  // pure function of the grid state (rule 5's skip set is local to each
  // rule5Clip call), so a post-iteration state equal to ANY previously
  // seen state — while the iteration still had activity — is proof the
  // trajectory is periodic and will never converge. Only then does the
  // pass switch rule 2 to its sequential cycle-breaker form; genomes the
  // v1 pass accepted never repeat a state and never take the branch.
  const stateFingerprint = (): string => {
    let s = "";
    for (const g of grids) {
      for (const row of g) {
        for (const c of row) {
          s += c === null ? "." : `${ROLE_IDS[c.role]},${c.tone},${c.partId},${c.depthRaw};`;
        }
      }
    }
    return s;
  };

  const iterations: CraftIteration[] = [];
  const mergeDecisions: MergeDecision[] = [];
  let rule2Total = 0;
  let rule3Total = 0;
  let converged = false;
  let cycleBroken = false;
  const seenStates = new Set<string>([stateFingerprint()]);
  for (let it = 0; it < MAX_PASS_ITERS; it++) {
    let c2 = 0;
    let c3 = 0;
    for (const g of grids) c2 += cycleBroken ? rule2Sequential(g) : rule2Orphan(g);
    for (const g of grids) c3 += rule3Jaggy(g);
    const decisions = rule5Clip(grids);
    mergeDecisions.push(...decisions);
    iterations.push(Object.freeze({ rule2: c2, rule3: c3, merges: decisions.length }));
    rule2Total += c2;
    rule3Total += c3;
    if (c2 === 0 && c3 === 0 && decisions.length === 0) {
      converged = true;
      break;
    }
    if (!cycleBroken) {
      const fp = stateFingerprint();
      if (seenStates.has(fp)) {
        cycleBroken = true; // proven cycle — sequential rule 2 from here on
      } else {
        seenStates.add(fp);
      }
    }
  }
  if (!converged) {
    throw new Error(
      "craft: rules 2/3/5 did not reach a joint fixpoint within MAX_PASS_ITERS (design 06 §1.5 trap)",
    );
  }

  const exemptParts = computeExemptParts(grids); // F15: at the fixpoint
  const keyCountAtSelout = rule4Selout(grids, exemptParts);

  const info: CraftInfo = Object.freeze({
    iterations: Object.freeze(iterations),
    cycleBroken,
    workRounds: iterations.filter((e) => e.rule2 > 0 || e.rule3 > 0 || e.merges > 0).length,
    rule2Total,
    rule3Total,
    mergeDecisions: Object.freeze(mergeDecisions),
    exemptParts: Object.freeze([...exemptParts].sort((a, b) => a - b)),
    keyCountAtSelout,
  });
  return { grids, info };
}

// ---------------------------------------------------------------------------
// Chain-grouped pixel snapping (design 06 §1.5, constraint row 3, F14/F16)
// ---------------------------------------------------------------------------

/** roundPx(x) = rheDiv(x, 65536)·65536 — whole-pixel raw, ties-to-even (F14). */
function roundPx(x: number): number {
  return rheDiv(x, 65536) * 65536;
}

/**
 * Chain-grouped snap offsets for one clip × direction cell
 * (design 06 §1.5). `slabLists` holds the K frames' model-space slab
 * lists in the plan's normative order; `chains` is the plan's pinned
 * chain table (default: the quadruped {@link CHAINS} — every M1-era call
 * site is byte-identical; exportCreature passes the grown graph's chains
 * since U3, the design 07 §3.4 seam). The chains must cover each slab
 * index exactly once. A chain's screen position is the continuous
 * projected screen center of its FIRST slab after yawSlab: sx = cx,
 * sy = −cz − TILT·cy (the §1.4 screen mapping without the constant frame
 * anchor). Per chain per axis: mean = rheDiv(Σ pos, K);
 * snapped(f) = roundPx(mean) + roundPx(pos(f) − mean);
 * offset(f) = snapped(f) − pos(f) — one (dx, dy) per chain per frame,
 * returned per slab (every slab of a chain shares its chain's offset),
 * ready for {@link rasterize}'s offset hook.
 */
export function snapOffsets(
  slabLists: readonly (readonly Slab[])[],
  direction: Direction,
  chains: readonly Chain[] = CHAINS,
): readonly (readonly SlabOffset[])[] {
  const turns = DIRECTION_TURNS[direction];
  if (turns === undefined) {
    throw new RangeError(`craft: unknown direction ${JSON.stringify(direction)}`);
  }
  const k = slabLists.length;
  if (k === 0) {
    throw new RangeError("craft: snapOffsets needs at least one frame");
  }
  // Slab-count check against the chains' covered indices (design 07
  // §3.4): every chain table pins a full partition of the slab list.
  let covered = 0;
  for (const chain of chains) covered += chain.slabs.length;
  for (const slabs of slabLists) {
    if (slabs.length !== covered) {
      throw new RangeError(
        `craft: snapOffsets expects the ${covered}-slab list its chain table covers, got ${slabs.length}`,
      );
    }
  }
  const offsets: SlabOffset[][] = slabLists.map(() => new Array<SlabOffset>(covered));
  for (const chain of chains) {
    const anchor = chain.slabs[0]!;
    const posX: number[] = [];
    const posY: number[] = [];
    for (const slabs of slabLists) {
      const sl = yawSlab(slabs[anchor]!, turns);
      posX.push(sl.cx);
      posY.push(fp_sub(fp_sub(0, sl.cz), fp_mul(TILT_RAW, sl.cy)));
    }
    const meanX = rheDiv(
      posX.reduce((a, b) => a + b, 0),
      k,
    );
    const meanY = rheDiv(
      posY.reduce((a, b) => a + b, 0),
      k,
    );
    const baseX = roundPx(meanX);
    const baseY = roundPx(meanY);
    for (let f = 0; f < k; f++) {
      const off = Object.freeze({
        dx: baseX + roundPx(posX[f]! - meanX) - posX[f]!,
        dy: baseY + roundPx(posY[f]! - meanY) - posY[f]!,
      });
      for (const s of chain.slabs) offsets[f]![s] = off;
    }
  }
  return Object.freeze(offsets.map((row) => Object.freeze(row)));
}
