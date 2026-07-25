/**
 * Fablesprite — the grammar core (design 02 §1, design 07 §1 as amended
 * by §1.4): typed part graphs grown by budgeted, deterministic socket
 * expansion.
 *
 * Growth turns a genome into a **PartGraph**: part nodes bound to sockets
 * with symmetry groups, each node carrying its REST-POSE slab (design 07
 * §1.4: all oscillator terms zero — growth precedes animation; gait
 * templates in pose.ts layer per-frame deltas on top). Expansion starts
 * at the plan's core and fills sockets in **canonical socket order** —
 * the per-plan pinned order of each part's socket array, never iteration
 * order of a map — depth-first: all members of a fill emit contiguously,
 * then each member's own sockets fill in member order, then the parent's
 * next socket (design 07 §1.4).
 *
 * Randomness discipline (design 06 §4, design 07 §1.1): a socket fill
 * with more than one surviving candidate consumes exactly one draw from
 * `stream(seed, draw_path, "fill")`; single-candidate and closed sockets
 * consume none (the meta.plan precedent — a draw that could only return
 * one value is not spent). Exclusion groups prune candidates *before*
 * the draw, so an exclusion firing changes the drawn arity, never a
 * sibling socket's stream. Budget: each placed node consumes one part of
 * the plan's budget; a socket whose symmetry needs more members than the
 * remaining budget closes without drawing (design 07 §1.4).
 *
 * The quadruped grammar (design 07 §1.4) re-derives the M1 template
 * (design 06 §1.2) node for node: 13 parts, zero draws, byte-identical
 * pipeline output for every genome (the §1.2 M1-fidelity law, verified
 * by the seeds 0..1999 sweep before the hardcoded path was deleted).
 * {@link PART_NAMES}, {@link CHAINS}, and {@link PART_ROLES} are the
 * grammar's *output* — derived from the grown graph, no longer hardcoded.
 */

import { FP_ONE, fp_add, fp_div, fp_mul, fp_sqrt, fp_sub } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";
import { createStream } from "./prng.js";

// ---------------------------------------------------------------------------
// Vocabulary (design 02 §1)
// ---------------------------------------------------------------------------

/**
 * Material role vocabulary of the design 06 §1.2 part table. Roles select
 * palette ramps (§1.3): `hide` and `underside` follow `palette.ramp_len`;
 * `focal` (eyes) always uses the pinned 4-entry focal table and is
 * merge-protected in the craft pass (F16). M2 keeps exactly these three
 * (design 07 §0 non-goals).
 */
export type MaterialRole = "hide" | "underside" | "focal";

/** Part-node kinds (design 02 §1, the closed vocabulary). */
export type PartKind =
  | "core"
  | "segment"
  | "limb"
  | "head"
  | "sensor"
  | "emitter"
  | "ornament"
  | "locomotor";

/**
 * Socket symmetry (design 02 §1 / design 07 §1.1): all members of a group
 * place from ONE draw. `mirror` is an L/R pair (−x member first —
 * design 06 §1.2's FL-before-FR convention); `radial(n)`/`serial(n)`
 * place n members with ordinals 0..n−1 in placement order (ordinals only
 * within a named socket, design 06 §2).
 */
export type Symmetry =
  | { readonly kind: "single" }
  | { readonly kind: "mirror" }
  | { readonly kind: "radial"; readonly n: number }
  | { readonly kind: "serial"; readonly n: number };

/** Member count a symmetry group places (all from one draw). */
export function symmetryMemberCount(symmetry: Symmetry): number {
  switch (symmetry.kind) {
    case "single":
      return 1;
    case "mirror":
      return 2;
    default:
      return symmetry.n;
  }
}

/** One axis-aligned rest-pose slab: center and half-extents, 16.16 raws. */
export interface RestSlab {
  readonly center: readonly [number, number, number];
  readonly half: readonly [number, number, number];
}

/**
 * The instantiation of one symmetry member: identity, wiring, geometry,
 * and child sockets. Produced by a {@link PartChoice}'s `make` — member
 * paths are authored per plan (design 07 §1.4 pins the quadruped's; the
 * engine never composes path spellings itself).
 */
export interface PartInit {
  /** Slab-order name (`PART_NAMES` entry — part-tag ids index these). */
  readonly name: string;
  /** Canonical part path (design 06 §2 rules; the locus-subtree root). */
  readonly path: string;
  readonly materialRole: MaterialRole;
  /** Chain this slab snaps with (design 06 §1.5 chain-grouped snapping). */
  readonly animChain: string;
  readonly slab: RestSlab;
  /** Child sockets in canonical order (absent = leaf). */
  readonly sockets?: readonly SocketSpec[];
}

/**
 * One candidate part for a socket fill. `kind` participates in the
 * allowed-kind pre-draw pruning; `exclusionGroup` names the max-one group
 * (design 07 §1.1: pruned from the choice set *before* the draw).
 *
 * U5 (design 07 §6.1): `existsLocus` names a registry existence marker
 * (06 §2, default ABSENT) — the candidate is PRUNED pre-draw when it
 * reads 0; `tagWeights` is a length-5 integer vector indexed by trait
 * tag id (chitin 0 … verdant 4) — the candidate's effective weight is
 * the plain integer SUM over the genome's tags (or `neutralWeight`,
 * default 1, when the vector is absent or the tag set empty), and
 * effective weight 0 prunes pre-draw like an exclusion group. **Engine
 * law (H1): `tagWeights` is legal ONLY on candidates that also carry
 * `existsLocus`** — a mandatory socket can therefore never be
 * zero-weighted closed (growPlan throws RangeError).
 */
export interface PartChoice {
  readonly kind: PartKind;
  readonly exclusionGroup?: string;
  /** Registry path of the 06 §2 existence marker gating this candidate. */
  readonly existsLocus?: string;
  /** Per-tag weight vector (length 5, non-negative integers). */
  readonly tagWeights?: readonly number[];
  /** Weight when `tagWeights` is absent or the tag set is empty. */
  readonly neutralWeight?: number;
  /**
   * Instantiate member `member` of `count` (0-based; mirror: 0 = −x/L).
   * `slot` is the drawn placement slot of a `placeSlots` socket —
   * growth always passes it (0 when the socket draws no placement).
   */
  readonly make: (genome: Genome, member: number, count: number, slot?: number) => PartInit;
}

/**
 * Placement retry cap R (design 07 §5.1): a `placeSlots` socket draws at
 * most R placement attempts (`place:0..R-1`), then drops the part.
 */
export const PLACE_RETRY_CAP = 3;

/**
 * A named attachment point (design 07 §1.1): `{name, allowed_kinds,
 * symmetry, clearance_fp}` plus this build's fill wiring.
 *
 * U5 (design 07 §5.1) activates the clearance machinery: a socket WITH
 * `placeSlots = n` draws a placement slot per attempt from
 * `stream(seed, drawPath, "place:a")` (a = 0..{@link PLACE_RETRY_CAP}−1),
 * builds the member slab, and tests it against every previously placed
 * node EXCEPT the socket's parent (the host — embedding into the host is
 * the attachment mechanism): **collision ⇔ min over axes of
 * (hA + hB − |cA − cB|) > clearanceFp** (plain int compares; positive
 * only when the boxes interpenetrate on all three axes). On collision
 * the next attempt draws `place:a+1`; after R colliding attempts the
 * part is DROPPED — the socket closes, no node placed, no budget
 * consumed, the spent draws stay counted. A socket WITHOUT `placeSlots`
 * never runs the check (a retry has no draw to re-roll — the shipped
 * mandatory sockets stay outside the mechanism; their geometry is
 * locus-derived and domain-table-verified).
 */
export interface SocketSpec {
  readonly name: string;
  readonly allowedKinds: readonly PartKind[];
  readonly symmetry: Symmetry;
  /** Sibling clearance radius (16.16 raw) for `placeSlots` sockets. */
  readonly clearanceFp: number;
  /** Placement slot count n — presence opts the socket into clearance. */
  readonly placeSlots?: number;
  /**
   * Recorded symmetry-group name; defaults to the socket name. The
   * quadruped's leg pairs record as `legs_fore`/`legs_hind` (design 02 §2
   * "mirror leg pairs", pinned in design 07 §1.4).
   */
  readonly group?: string;
  /**
   * Stream path keying this socket's fill draw
   * (`stream(seed, drawPath, "fill")` — design 07 §1.4). Required when
   * more than one candidate can survive pruning; never touched otherwise.
   */
  readonly drawPath?: string;
  readonly candidates: readonly PartChoice[];
}

/** A plan: its core part and the pinned part budget (design 02 §3). */
export interface PlanSpec {
  readonly plan: string;
  readonly budgetMin: number;
  readonly budgetMax: number;
  readonly core: PartChoice;
}

// ---------------------------------------------------------------------------
// The PartGraph
// ---------------------------------------------------------------------------

/** One grown part node (design 07 §1.1's node, made concrete). */
export interface PartNode {
  /** Slab index — raster part-tag ids index the graph's part list. */
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly kind: PartKind;
  readonly materialRole: MaterialRole;
  readonly animChain: string;
  /**
   * Recorded symmetry group: `"single"` or
   * `"<mirror|radial|serial>:<group>"` (design 07 §1.4).
   */
  readonly symmetry: string;
  /** Rest-pose slab (all oscillator terms zero — design 07 §1.4). */
  readonly slab: RestSlab;
}

/** One skeleton chain: name + the slab indices it snaps as a unit. */
export interface Chain {
  readonly name: string;
  readonly slabs: readonly number[];
}

/** The grammar's output (design 07 §1.1). */
export interface PartGraph {
  readonly plan: string;
  readonly parts: readonly PartNode[];
  /** Node names in slab order (normative — part-tag ids index it). */
  readonly slabOrder: readonly string[];
  /** Chains in first-appearance order (design 06 §1.5 pinned table). */
  readonly chains: readonly Chain[];
  readonly budget: {
    readonly used: number;
    readonly min: number;
    readonly max: number;
  };
  /** Stream draws the growth consumed (quadruped: always 0 — §1.4). */
  readonly drawsConsumed: number;
  /**
   * True when an asymmetry gene broke a mirror group. Version-1 genomes
   * carry no asymmetry loci (design 02 §1), so growth always records
   * false; the aberration post-pass (post-M2) is what will set it.
   */
  readonly mirrorBroken: boolean;
}

/**
 * Grow a plan's part graph from a genome — the budgeted, deterministic
 * expansion of design 07 §1.1 (algorithm pinned in §1.4; see the module
 * header for the draw/budget/exclusion discipline). Throws RangeError on
 * spec violations: a drawable socket without a `drawPath`, or a grown
 * graph outside the plan's budget band.
 */
export function growPlan(spec: PlanSpec, genome: Genome): PartGraph {
  const parts: PartNode[] = [];
  const chainIndex = new Map<string, number[]>();
  const chainOrder: string[] = [];
  const usedExclusions = new Set<string>();
  let drawsConsumed = 0;

  function place(init: PartInit, kind: PartKind, symmetry: string): number {
    const id = parts.length;
    parts.push(
      Object.freeze({
        id,
        name: init.name,
        path: init.path,
        kind,
        materialRole: init.materialRole,
        animChain: init.animChain,
        symmetry,
        slab: Object.freeze({
          center: Object.freeze(init.slab.center),
          half: Object.freeze(init.slab.half),
        }),
      }),
    );
    let chain = chainIndex.get(init.animChain);
    if (chain === undefined) {
      chain = [];
      chainIndex.set(init.animChain, chain);
      chainOrder.push(init.animChain);
    }
    chain.push(id);
    return id;
  }

  /** The §5.1 collision predicate: interpenetration past clearanceFp. */
  function collides(a: RestSlab, b: RestSlab, clearanceFp: number): boolean {
    let minPen = Infinity;
    for (let i = 0; i < 3; i++) {
      const pen = a.half[i]! + b.half[i]! - Math.abs(a.center[i]! - b.center[i]!);
      if (pen < minPen) minPen = pen;
    }
    return minPen > clearanceFp;
  }

  function fillSockets(parent: PartInit, parentId: number): void {
    for (const socket of parent.sockets ?? []) {
      const count = symmetryMemberCount(socket.symmetry);
      // Budget closes first: a socket needing more members than remain
      // closes without drawing (design 07 §1.4).
      if (parts.length + count > spec.budgetMax) continue;
      // Pre-draw pruning, pinned order (design 07 §1.1 as extended at
      // U5: budget → allowed kinds → exclusion groups → existence →
      // tag-weights) — never draw-then-reject.
      const survivors: PartChoice[] = [];
      const weights: number[] = [];
      for (const c of socket.candidates) {
        if (c.tagWeights !== undefined) {
          // The H1 engine law: tagWeights requires existsLocus — a
          // mandatory socket can never be zero-weighted closed.
          if (c.existsLocus === undefined) {
            throw new RangeError(
              `grammar: socket ${JSON.stringify(socket.name)} candidate carries tagWeights without existsLocus (design 07 §6.1 H1 law)`,
            );
          }
          if (c.tagWeights.length !== 5 || c.tagWeights.some((w) => !Number.isInteger(w) || w < 0)) {
            throw new RangeError(
              `grammar: socket ${JSON.stringify(socket.name)} candidate tagWeights must be 5 non-negative integers`,
            );
          }
        }
        if (!socket.allowedKinds.includes(c.kind)) continue;
        if (c.exclusionGroup !== undefined && usedExclusions.has(c.exclusionGroup)) continue;
        // Existence prune (06 §2 markers): a candidate whose existence
        // locus reads 0 (the default) is pruned BEFORE any weight is
        // consulted — on every all-defaults-gated genome the socket
        // closes here with zero draws (the H1 resolution).
        if (c.existsLocus !== undefined && getScalar(genome, c.existsLocus) === 0) continue;
        // Effective weight (design 07 §6.1): neutral when the vector is
        // absent or the tag set empty; otherwise the plain int sum of
        // the genome's tags' entries. Zero prunes pre-draw.
        const w =
          c.tagWeights === undefined || genome.traitTags.length === 0
            ? (c.neutralWeight ?? 1)
            : genome.traitTags.reduce((sum, t) => sum + c.tagWeights![t]!, 0);
        if (w === 0) continue;
        survivors.push(c);
        weights.push(w);
      }
      if (survivors.length === 0) continue; // socket closes, no draw
      let choice: PartChoice;
      if (survivors.length === 1) {
        choice = survivors[0]!; // deterministic fill — no draw spent
      } else {
        if (socket.drawPath === undefined) {
          throw new RangeError(
            `grammar: socket ${JSON.stringify(socket.name)} has ${survivors.length} candidates but no drawPath (design 07 §1.4 requires one)`,
          );
        }
        // Exactly ONE weighted draw (design 07 §6.1): T = Σ weights in
        // candidate-array order, r = nextRange(T), the first candidate
        // whose cumulative weight exceeds r wins. All weights 1 makes
        // this arithmetic-identical to the U1 uniform draw.
        const stream = createStream(genome.seed, socket.drawPath, "fill");
        const total = weights.reduce((a, b) => a + b, 0);
        const r = stream.nextRange(total);
        let cum = 0;
        let idx = 0;
        for (let i = 0; i < weights.length; i++) {
          cum += weights[i]!;
          if (r < cum) {
            idx = i;
            break;
          }
        }
        choice = survivors[idx]!;
        drawsConsumed += 1;
      }
      const group = socket.group ?? socket.name;
      const symmetry =
        socket.symmetry.kind === "single" ? "single" : `${socket.symmetry.kind}:${group}`;
      // Build the members — with the §5.1 placement/clearance loop when
      // the socket opts in via placeSlots.
      let members: PartInit[] | null = null;
      if (socket.placeSlots !== undefined) {
        if (!Number.isInteger(socket.placeSlots) || socket.placeSlots < 1) {
          throw new RangeError(
            `grammar: socket ${JSON.stringify(socket.name)} placeSlots must be a positive integer`,
          );
        }
        if (socket.drawPath === undefined) {
          throw new RangeError(
            `grammar: socket ${JSON.stringify(socket.name)} has placeSlots but no drawPath for its place draws`,
          );
        }
        for (let a = 0; a < PLACE_RETRY_CAP; a++) {
          // Each attempt is its own stream (`place:a` — the FIRST
          // attempt is place:0); a retry in one socket can never
          // perturb another socket's draws (06 §4 stream keying).
          const stream = createStream(genome.seed, socket.drawPath, `place:${a}`);
          const slot = stream.nextRange(socket.placeSlots);
          drawsConsumed += 1;
          const built: PartInit[] = [];
          for (let m = 0; m < count; m++) built.push(choice.make(genome, m, count, slot));
          const hit = built.some((init) =>
            parts.some((node) => node.id !== parentId && collides(init.slab, node.slab, socket.clearanceFp)),
          );
          if (!hit) {
            members = built;
            break;
          }
        }
        if (members === null) continue; // dropped after R colliding attempts — socket closes
      } else {
        members = [];
        for (let m = 0; m < count; m++) members.push(choice.make(genome, m, count, 0));
      }
      if (choice.exclusionGroup !== undefined) usedExclusions.add(choice.exclusionGroup);
      // All members place from this one choice, contiguously; children
      // expand depth-first per member afterwards (design 07 §1.4).
      const memberIds = members.map((init) => place(init, choice.kind, symmetry));
      for (let m = 0; m < members.length; m++) fillSockets(members[m]!, memberIds[m]!);
    }
  }

  const coreInit = spec.core.make(genome, 0, 1, 0);
  const coreId = place(coreInit, spec.core.kind, "single");
  fillSockets(coreInit, coreId);

  if (parts.length < spec.budgetMin || parts.length > spec.budgetMax) {
    throw new RangeError(
      `grammar: ${spec.plan} grew ${parts.length} parts, outside the pinned budget [${spec.budgetMin}, ${spec.budgetMax}]`,
    );
  }

  return Object.freeze({
    plan: spec.plan,
    parts: Object.freeze(parts),
    slabOrder: Object.freeze(parts.map((p) => p.name)),
    chains: Object.freeze(
      chainOrder.map((name) =>
        Object.freeze({ name, slabs: Object.freeze(chainIndex.get(name)!) }),
      ),
    ),
    budget: Object.freeze({
      used: parts.length,
      min: spec.budgetMin,
      max: spec.budgetMax,
    }),
    drawsConsumed,
    mirrorBroken: false,
  });
}

// ---------------------------------------------------------------------------
// Quadruped geometry — design 06 §1.2 pinned template constants
// (raw = RHE(d · 2^16) of the authored decimal, per the notation rule)
// ---------------------------------------------------------------------------

/** Core center y = −0.5. */
const CORE_CY = -32768;
/** Underside half-extent factors: 0.769·girth, 0.737·length, 0.647·depth. */
const UNDERSIDE_KX = 50397; // 0.769
const UNDERSIDE_KY = 48300; // 0.737
const UNDERSIDE_KZ = 42402; // 0.647
/** Head half-extents scale·(3.0, 3.4, 3.0). */
const HEAD_HX = 196608; // 3.0
const HEAD_HY = 222822; // 3.4
const HEAD_HZ = 196608; // 3.0
/** Snout center offset from H, scaled: scale·(0, 3.3, −1.2). */
const SNOUT_OY = 216269; // 3.3
const SNOUT_OZ = -78643; // −1.2
/**
 * Snout half-extents (scale·1.6, snout_len, scale·1.5) — cross-extents
 * scale with the head (design 06 §1.2 as amended by the eye visibility
 * coupling): fixed 1.6/1.5 extents on a shrunken head rode up over the
 * eye rows and occluded them from the camera. `fp_mul(1.0, c) = c`, so
 * scale-1 genomes are byte-identical to the original constants.
 */
const SNOUT_HX = 104858; // 1.6
const SNOUT_HZ = 98304; // 1.5
/** Ear center offset from H, scaled: scale·(±2.0, −1.1, 2.8). */
const EAR_OX = 131072; // 2.0
const EAR_OY = -72090; // −1.1
const EAR_OZ = 183501; // 2.8
/** Ear half-extents ear_size·(0.9, 1.0, 1.7). */
const EAR_HX = 58982; // 0.9
const EAR_HY = 65536; // 1.0
const EAR_HZ = 111411; // 1.7
/**
 * Eye center offset from H: (±scale·eye_offset, EY, scale·0.6), with EY
 * the derived forward offset of the design 06 §1.2 eye visibility
 * coupling — `EY = max(scale·2.6, ySurf − 0.3·eyeHy)`, guaranteeing the
 * eye's front face protrudes at least 0.7 of its forward half-extent
 * beyond the head surface at the eye's own (x, z) column. 0.7 sits just
 * below the default wolf's own protrusion ratio (≈ 0.7221), so the
 * all-default genome takes the plain-constant branch with a 1016-raw
 * margin (machine-verified) and stays byte-identical.
 */
const EYE_OY = 170394; // 2.6 — the wolf forward-offset constant
const EYE_OZ = 39322; // 0.6
/**
 * Eye half-extents eye_size·(0.8, 0.7, 0.8), floored at these same raws
 * (design 06 §1.2 eye visibility coupling: no rendered eye is smaller
 * than the default wolf's — sub-pixel eye discs split their ≤ 16
 * supersamples across pixel boundaries and lose every majority vote).
 * Factor and floor coincide because the default `eye_size` is exactly 1.
 */
const EYE_HX = 52429; // 0.8
const EYE_HY = 45875; // 0.7
const EYE_HZ = 52429; // 0.8
/**
 * Head-frame column base of the eye's head-surface extent:
 * 1 − (0.6/3.0)² = 0.96, raw RHE(0.96·2^16) = 62915 — identically
 * FP_ONE − fp_mul(13107, 13107) (both derivations agree,
 * machine-verified). The eye's x column enters as
 * `Xn = fp_div(eye_offset, 3.0)` (head scale cancels), and
 * `inside = 0.96 − Xn²` stays > 0 over the whole eye_offset domain
 * (max Xn = 0.8 → inside ≥ 0.32).
 */
const EYE_INSIDE_BASE = 62915; // 0.96
/** 1 − κ with κ = 0.7 the guaranteed protrusion ratio; raw RHE(0.3·2^16). */
const EYE_SLACK = 19661; // 0.3
/** Leg half-extent along y (1.5). */
const LEG_HY = 98304; // 1.5

// ---------------------------------------------------------------------------
// Design 06 §1.2 anchor coupling: anchor(dim) = C + fp_mul(σ, dim − D)
// ---------------------------------------------------------------------------

/**
 * The derived attachment anchors of design 06 §1.2 — "derived anchors,
 * not constants". Each is the wolf constant C plus a proportional
 * correction along its tracked core dimension:
 * `anchor(dim) = C + fp_mul(σ, dim − D)`. The delta form is load-bearing:
 * `fp_mul(σ, 0) = 0`, so at the all-default core dims every anchor equals
 * the original wolf raw constant exactly (machine-verified in the spec,
 * asserted in tests/pose.test.ts).
 */
export interface QuadrupedAnchors {
  /** HY head center y — C 8.3 (543949), tracks core.length, σ 71572 (8.3/7.6). */
  readonly hy: number;
  /** HZ head center z — C 9.8 (642253), tracks core.depth, σ 107942 (1 + 2.2/3.4). */
  readonly hz: number;
  /** hip_y fore (FL, FR) — C 4.6 (301466), tracks core.length, σ 39667 (4.6/7.6). */
  readonly hipYFore: number;
  /** hip_y hind (BL, BR) — C −5.2 (−340787), tracks core.length, σ −44840 (−5.2/7.6). */
  readonly hipYHind: number;
  /** hip_x (± per socket) — C 2.6 (170394), tracks core.girth, σ 43691 (2.6/3.9). */
  readonly hipX: number;
  /** CZ core center z — C 7.6 (498074), tracks core.depth, σ 65536 (slope 1). */
  readonly cz: number;
  /** UY underside center y — C 1.5 (98304), tracks core.length, σ 17246 (2.0/7.6). */
  readonly uy: number;
  /** UZ underside center z — C 5.9 (386662), tracks core.depth, σ 32768 (1 − 1.7/3.4). */
  readonly uz: number;
  /** TY tail center y — C −8.8 (−576717), tracks core.length, σ −65536 (slope −1). */
  readonly ty: number;
  /** TZ tail center z — C 9.6 (629146), tracks core.depth, σ 104087 (1 + 2.0/3.4). */
  readonly tz: number;
}

/** `anchor(dim) = C + fp_mul(σ, dim − D)` — the §1.2 coupling law. */
function anchor(c: number, sigma: number, dim: number, dimDefault: number): number {
  return fp_add(c, fp_mul(sigma, fp_sub(dim, dimDefault)));
}

/** Registry defaults of the tracked core dimensions (design 06 §1.1). */
const LENGTH_D = 498074; // body.core.length 7.6
const GIRTH_D = 255590; // body.core.girth 3.9
const DEPTH_D = 222822; // body.core.depth 3.4

/**
 * Compute the derived attachment anchors for a genome's core dimensions,
 * exactly per the design 06 §1.2 coupling table. Every C, D, and σ below
 * is the spec's pinned raw.
 */
export function deriveAnchors(genome: Genome): QuadrupedAnchors {
  const length = getScalar(genome, "body.core.length");
  const girth = getScalar(genome, "body.core.girth");
  const depth = getScalar(genome, "body.core.depth");
  return Object.freeze({
    hy: anchor(543949, 71572, length, LENGTH_D), // C 8.3, σ 8.3/7.6
    hz: anchor(642253, 107942, depth, DEPTH_D), // C 9.8, σ 1 + 2.2/3.4
    hipYFore: anchor(301466, 39667, length, LENGTH_D), // C 4.6, σ 4.6/7.6
    hipYHind: anchor(-340787, -44840, length, LENGTH_D), // C −5.2, σ −5.2/7.6
    hipX: anchor(170394, 43691, girth, GIRTH_D), // C 2.6, σ 2.6/3.9
    cz: anchor(498074, 65536, depth, DEPTH_D), // C 7.6, σ 1
    uy: anchor(98304, 17246, length, LENGTH_D), // C 1.5, σ 2.0/7.6
    uz: anchor(386662, 32768, depth, DEPTH_D), // C 5.9, σ 1 − 1.7/3.4
    ty: anchor(-576717, -65536, length, LENGTH_D), // C −8.8, σ −1
    tz: anchor(629146, 104087, depth, DEPTH_D), // C 9.6, σ 1 + 2.0/3.4
  });
}

// ---------------------------------------------------------------------------
// The quadruped plan (design 07 §1.4 U1 amendment, node for node)
// ---------------------------------------------------------------------------

/** Zero clearance (mandatory sockets stay outside the §5.1 machinery). */
const NO_CLEARANCE = 0;

// ---------------------------------------------------------------------------
// U5 shared template constants (design 07 §3/§6.1) — the new optional
// ornament + emitter parts. Every raw machine-verified before pinning.
// ---------------------------------------------------------------------------

/** Ornament embed into its host surface: 0.3 px. */
export const ORN_EMBED = 19661;
/** Emitter embed into its host surface: 0.3 px. */
export const EMIT_EMBED = 19661;
/** Emitter half-extents at size 1.0: (0.7, 0.9, 0.7) — also the FLOOR
 * raws (the M1 eye-floor mechanism verbatim; identity at size 1.0). */
export const EMIT_HALF: readonly [number, number, number] = Object.freeze([
  45875, 58982, 45875,
]) as [number, number, number];

/** The one ornament candidate family order: [plate, wisp, sprout]. */
export const ORNAMENT_FAMILIES = ["plate", "wisp", "sprout"] as const;

/**
 * The tag→weight table (design 07 §6.1, pinned taste constants; ONE
 * table for all three plans — the families carry the read, per-plan
 * geometry is §3). Columns index {@link ORNAMENT_FAMILIES}; rows are
 * per-candidate vectors indexed by tag id (chitin 0, fleshy 1,
 * spectral 2, mechanical 3, verdant 4). Machine-verified: no 1- or
 * 2-tag combination zeroes all three candidates (minimum total 6).
 */
export const ORNAMENT_TAG_WEIGHTS: Readonly<
  Record<(typeof ORNAMENT_FAMILIES)[number], readonly number[]>
> = Object.freeze({
  plate: Object.freeze([6, 2, 0, 5, 0]), // chitin never grows a ghost-wisp; a ghost wears no plate
  wisp: Object.freeze([0, 0, 6, 1, 1]),
  sprout: Object.freeze([1, 4, 1, 0, 6]), // machines don't sprout; plants don't plate
});

/** Quadruped dorsal placement-slot cy factors of core length: +0.25, 0, −0.25. */
const SLOT_F: readonly number[] = Object.freeze([16384, 0, -16384]);

/** Quadruped dorsal clearance radius: 0.2 px allowed interpenetration. */
const DORSAL_CLEARANCE = 13107;

/** Levitant lens z offset below the orb center: −2.0 px. */
const LENS_OZ = -131072;

/** Emitter half-extents × size (id 52), FLOORED at the EMIT_HALF raws. */
function emitterHalves(genome: Genome): readonly [number, number, number] {
  const size = getScalar(genome, "body.emitter[C].size");
  return [
    Math.max(fp_mul(size, EMIT_HALF[0]), EMIT_HALF[0]),
    Math.max(fp_mul(size, EMIT_HALF[1]), EMIT_HALF[1]),
    Math.max(fp_mul(size, EMIT_HALF[2]), EMIT_HALF[2]),
  ];
}

/**
 * Coverage threshold raw (0.42 px) — mirrored from raster.ts's
 * COVERAGE_RAW; the U5 thin-ornament pixel-phase repair keys on it.
 */
const ORN_COVERAGE_RAW = 27525;

/**
 * The U5 thin-ornament pixel-phase repair (implementation-evidence
 * amendment, design 07 §6.1 — the U3 pupil pixel-phase lesson in x/y):
 * a part whose half-extent along a screen-mapping axis is below the
 * 0.42-px coverage threshold and whose center sits on a pixel BOUNDARY
 * splits its supersamples across two columns and can never win a
 * majority vote — and the §1.5 chain snap PLANTS centered parts
 * (cx = 0, crown/rim cy) exactly on boundaries, structurally, for every
 * genome and frame. The mode render sweep found wisp/sprout ornaments
 * (halves 0.35–0.4) rendering ZERO pixels in EVERY view. Repair: for
 * x and y independently, when the half-extent < 0.42 px, advance the
 * rest center FORWARD by the smallest non-negative delta landing its
 * pixel phase at the pixel CENTER (32768 raw) — at most one pixel,
 * deterministic, locus-free, and byte-inert for every shipped genome
 * (no shipped genome grows these parts). Plate candidates (halves
 * ≥ 0.5 px) are untouched — the pinned tagged golden's dorsal plate
 * keeps its bytes.
 */
function ornamentPhaseCenter(
  center: readonly [number, number, number],
  halves: readonly [number, number, number],
): readonly [number, number, number] {
  const fix = (c: number, h: number): number => {
    if (h >= ORN_COVERAGE_RAW) return c;
    const phase = ((c % 65536) + 65536) % 65536;
    return fp_add(c, (32768 - phase + 65536) % 65536);
  };
  return [fix(center[0], halves[0]), fix(center[1], halves[1]), center[2]];
}

/**
 * Build one plan's three ornament candidates (design 07 §6.1): kind
 * `ornament`, role `underside` (the horns/highlight bright-ramp contrast
 * precedent), shared tag→weight table, per-plan geometry supplied by
 * `center` (which receives the candidate's halves and the drawn
 * placement slot). Centers pass through the thin-ornament pixel-phase
 * repair above.
 */
function ornamentCandidates(
  namePrefix: string,
  path: string,
  existsLocus: string,
  animChain: string,
  halvesByFamily: Readonly<Record<(typeof ORNAMENT_FAMILIES)[number], readonly [number, number, number]>>,
  center: (
    genome: Genome,
    halves: readonly [number, number, number],
    slot: number,
  ) => readonly [number, number, number],
): PartChoice[] {
  return ORNAMENT_FAMILIES.map((family) => ({
    kind: "ornament" as const,
    existsLocus,
    tagWeights: ORNAMENT_TAG_WEIGHTS[family],
    neutralWeight: 1,
    make(genome: Genome, _member: number, _count: number, slot = 0): PartInit {
      const halves = halvesByFamily[family];
      return {
        name: `${namePrefix}_${family}`,
        path,
        materialRole: "underside",
        animChain,
        slab: {
          center: ornamentPhaseCenter(center(genome, halves, slot), halves),
          half: halves,
        },
      };
    },
  }));
}

function undersideChoice(): PartChoice {
  return {
    kind: "segment",
    make(genome) {
      const a = deriveAnchors(genome);
      return {
        name: "core_underside",
        path: "body.core.underside",
        materialRole: "underside",
        animChain: "body",
        slab: {
          center: [0, a.uy, a.uz],
          half: [
            fp_mul(UNDERSIDE_KX, getScalar(genome, "body.core.girth")),
            fp_mul(UNDERSIDE_KY, getScalar(genome, "body.core.length")),
            fp_mul(UNDERSIDE_KZ, getScalar(genome, "body.core.depth")),
          ],
        },
      };
    },
  };
}

function snoutChoice(): PartChoice {
  return {
    kind: "segment",
    make(genome) {
      const a = deriveAnchors(genome);
      const scale = getScalar(genome, "body.head.scale");
      return {
        name: "snout",
        path: "body.head.snout",
        materialRole: "underside",
        animChain: "head",
        slab: {
          center: [
            0,
            fp_add(a.hy, fp_mul(scale, SNOUT_OY)),
            fp_add(a.hz, fp_mul(scale, SNOUT_OZ)),
          ],
          half: [
            fp_mul(scale, SNOUT_HX),
            getScalar(genome, "body.head.snout_len"),
            fp_mul(scale, SNOUT_HZ),
          ],
        },
      };
    },
  };
}

/** Mirror-member tags in emit order: −x member first (design 06 §1.2). */
const MIRROR_TAGS = ["L", "R"] as const;

function earsChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome, member) {
      const a = deriveAnchors(genome);
      const scale = getScalar(genome, "body.head.scale");
      const ear = getScalar(genome, "body.head.ear_size");
      const earX = fp_mul(scale, EAR_OX);
      const tag = MIRROR_TAGS[member]!;
      return {
        name: `ear_${tag.toLowerCase()}`,
        path: `body.head.ear[${tag}]`,
        materialRole: "hide",
        animChain: "head",
        slab: {
          center: [
            member === 0 ? -earX : earX,
            fp_add(a.hy, fp_mul(scale, EAR_OY)),
            fp_add(a.hz, fp_mul(scale, EAR_OZ)),
          ],
          half: [fp_mul(ear, EAR_HX), fp_mul(ear, EAR_HY), fp_mul(ear, EAR_HZ)],
        },
      };
    },
  };
}

function eyesChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome, member) {
      // The design 06 §1.2 eye visibility coupling — exact fp step order
      // normative (floors first: the slack term uses the FLOORED forward
      // half-extent).
      const a = deriveAnchors(genome);
      const scale = getScalar(genome, "body.head.scale");
      const eyeSize = getScalar(genome, "body.head.eye_size");
      const eyeOffset = getScalar(genome, "body.head.eye_offset");
      const eyeHx = Math.max(fp_mul(eyeSize, EYE_HX), EYE_HX);
      const eyeHy = Math.max(fp_mul(eyeSize, EYE_HY), EYE_HY);
      const eyeHz = Math.max(fp_mul(eyeSize, EYE_HZ), EYE_HZ);
      const xn = fp_div(eyeOffset, HEAD_HX); // head scale cancels
      const inside = fp_sub(EYE_INSIDE_BASE, fp_mul(xn, xn));
      const ySurf = fp_mul(fp_mul(scale, HEAD_HY), fp_sqrt(inside));
      const minOy = fp_sub(ySurf, fp_mul(EYE_SLACK, eyeHy));
      const eyeX = fp_mul(scale, eyeOffset);
      const tag = MIRROR_TAGS[member]!;
      return {
        name: `eye_${tag.toLowerCase()}`,
        path: `body.head.eye[${tag}]`,
        materialRole: "focal",
        animChain: "head",
        slab: {
          center: [
            member === 0 ? -eyeX : eyeX,
            fp_add(a.hy, Math.max(fp_mul(scale, EYE_OY), minOy)),
            fp_add(a.hz, fp_mul(scale, EYE_OZ)),
          ],
          half: [eyeHx, eyeHy, eyeHz],
        },
      };
    },
  };
}

function headChoice(): PartChoice {
  return {
    kind: "head",
    make(genome) {
      const a = deriveAnchors(genome);
      const scale = getScalar(genome, "body.head.scale");
      return {
        name: "head",
        path: "body.head",
        materialRole: "hide",
        animChain: "head",
        slab: {
          center: [0, a.hy, a.hz],
          half: [fp_mul(scale, HEAD_HX), fp_mul(scale, HEAD_HY), fp_mul(scale, HEAD_HZ)],
        },
        sockets: [
          {
            name: "snout",
            allowedKinds: ["segment"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [snoutChoice()],
          },
          {
            name: "ears",
            allowedKinds: ["sensor"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            candidates: [earsChoice()],
          },
          {
            name: "eyes",
            allowedKinds: ["sensor"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            candidates: [eyesChoice()],
          },
        ],
      };
    },
  };
}

/**
 * One mirror leg pair (design 02 §2 "mirror leg pairs ×2"): member 0 is
 * the −x (left) socket. Leg loci reconstruct from the part path
 * (`<path>.length` / `.girth` / `.phase_group` are the registry
 * spellings), which is what lets the gait template consume the graph
 * without a side table.
 */
function legPairChoice(fore: boolean): PartChoice {
  const sockets = fore ? (["FL", "FR"] as const) : (["BL", "BR"] as const);
  return {
    kind: "limb",
    make(genome, member) {
      const a = deriveAnchors(genome);
      const sock = sockets[member]!;
      const len = getScalar(genome, `body.leg[${sock}].length`);
      const legGirth = getScalar(genome, `body.leg[${sock}].girth`);
      return {
        name: `leg_${sock.toLowerCase()}`,
        path: `body.leg[${sock}]`,
        materialRole: "hide",
        animChain: `leg_${sock.toLowerCase()}`,
        slab: {
          center: [
            member === 0 ? -a.hipX : a.hipX,
            fore ? a.hipYFore : a.hipYHind,
            len,
          ],
          half: [legGirth, LEG_HY, len],
        },
      };
    },
  };
}

function tailChoice(): PartChoice {
  return {
    kind: "segment",
    make(genome) {
      const a = deriveAnchors(genome);
      const tailGirth = getScalar(genome, "body.tail.girth");
      return {
        name: "tail",
        path: "body.tail",
        materialRole: "hide",
        animChain: "tail",
        slab: {
          center: [0, a.ty, a.tz],
          half: [tailGirth, getScalar(genome, "body.tail.length"), tailGirth],
        },
      };
    },
  };
}

/**
 * The quadruped maw emitter (design 07 §6.1, U5): fires from the face —
 * chain `head`, role `focal` (F5: the high-contrast focal ramp; F16
 * merge-protection inherited). Proud of the snout front by
 * 2·hy_e − 0.3 ≥ 1.5 px at every size (floors), machine-verified.
 */
function mawChoice(): PartChoice {
  return {
    kind: "emitter",
    existsLocus: "body.emitter[C].exists",
    make(genome) {
      const a = deriveAnchors(genome);
      const scale = getScalar(genome, "body.head.scale");
      const [hx, hy, hz] = emitterHalves(genome);
      const snoutFront = fp_add(
        fp_add(a.hy, fp_mul(scale, SNOUT_OY)),
        getScalar(genome, "body.head.snout_len"),
      );
      return {
        name: "maw",
        path: "body.emitter[C]",
        materialRole: "focal",
        animChain: "head",
        slab: {
          center: [
            0,
            fp_add(snoutFront, fp_sub(hy, EMIT_EMBED)),
            fp_add(a.hz, fp_mul(scale, SNOUT_OZ)), // the snout line
          ],
          half: [hx, hy, hz],
        },
      };
    },
  };
}

/**
 * Quadruped dorsal ornament candidates (design 07 §6.1): plate / wisp /
 * sprout riding the core top (cz couples to the derived CZ anchor +
 * genomic depth — delta-form inherited from a.cz, no new σ), placed at
 * one of 3 drawn cy slots (±0.25·length, 0) under the §5.1 clearance
 * machinery (the unit's only drawn-placement socket).
 */
function dorsalCandidates(): PartChoice[] {
  return ornamentCandidates(
    "dorsal",
    "body.ornament[D]",
    "body.ornament[D].exists",
    "body",
    {
      plate: [32768, 72090, 58982], // 0.5, 1.1, 0.9
      wisp: [26214, 45875, 85197], // 0.4, 0.7, 1.3
      sprout: [22938, 32768, 98304], // 0.35, 0.5, 1.5
    },
    (genome, halves, slot) => {
      const a = deriveAnchors(genome);
      return [
        0,
        fp_mul(SLOT_F[slot]!, getScalar(genome, "body.core.length")),
        fp_add(
          fp_add(a.cz, getScalar(genome, "body.core.depth")),
          fp_sub(halves[2], ORN_EMBED),
        ),
      ];
    },
  );
}

function coreChoice(): PartChoice {
  return {
    kind: "core",
    make(genome) {
      const a = deriveAnchors(genome);
      return {
        name: "core",
        path: "body.core",
        materialRole: "hide",
        animChain: "body",
        slab: {
          center: [0, CORE_CY, a.cz],
          half: [
            getScalar(genome, "body.core.girth"),
            getScalar(genome, "body.core.length"),
            getScalar(genome, "body.core.depth"),
          ],
        },
        sockets: [
          {
            name: "underside",
            allowedKinds: ["segment"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [undersideChoice()],
          },
          {
            name: "head",
            allowedKinds: ["head"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [headChoice()],
          },
          {
            name: "leg_fore",
            allowedKinds: ["limb"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            group: "legs_fore",
            candidates: [legPairChoice(true)],
          },
          {
            name: "leg_hind",
            allowedKinds: ["limb"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            group: "legs_hind",
            candidates: [legPairChoice(false)],
          },
          {
            name: "tail",
            allowedKinds: ["segment"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [tailChoice()],
          },
          // U5 appends (design 07 §6.1) — EMITTER BEFORE ORNAMENT on
          // every plan (the guarantee-order ruling: the ranged-forced
          // emitter fills first and can never be budget-vetoed; on the
          // quadruped, 13 + 2 > 14 means dorsal + emitter never
          // coexist — a ranged quadruped forfeits its dorsal ornament,
          // design 02 §3's slot scarcity working as intended).
          {
            name: "emitter",
            allowedKinds: ["emitter"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE, // no placement draw — inert (§5.1 ruling)
            candidates: [mawChoice()],
          },
          {
            name: "dorsal",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: DORSAL_CLEARANCE,
            placeSlots: 3,
            drawPath: "body.ornament[D]",
            candidates: dorsalCandidates(),
          },
        ],
      };
    },
  };
}

/**
 * The quadruped plan (design 07 §1.4): canonical socket order
 * `body.core: [underside, head, leg_fore, leg_hind, tail]`,
 * `body.head: [snout, ears, eyes]`; depth-first expansion reproduces the
 * design 06 §1.2 normative slab order exactly. Every socket is a
 * single-candidate mandatory fill, so growth consumes zero draws for
 * every genome (the fidelity law fixes the 13-part set). Budget 8–14
 * (design 02 §3); the quadruped uses 13.
 */
export const QUADRUPED_PLAN: PlanSpec = Object.freeze({
  plan: "quadruped",
  budgetMin: 8,
  budgetMax: 14,
  core: coreChoice(),
});

// ---------------------------------------------------------------------------
// V1 frame fit (design 08 §2, generator v3) — the compressive soft-knee
// length couplings and the tail-root girth floor.
//
// The M1 length couplings put the snout front near +20 px and the tail tip
// near −19 px at the registry's domain corners: a ≈39 px rest span in a
// 32 px frame, which sliced 44% of the M2 sheet's quadrupeds against the
// vertical frame edges. The fix is a growth-time, draw-free, per-side
// soft-knee on the head- and tail-chain EXTENTS: identity at and below a
// pinned knee, a strictly-monotone compressive segment above it,
// asymptoting inside the 30-column budget.
//
// Vocabulary (design 08 §2 as amended at V1):
//   BOUND      991232 (15.125 px) — column 31's first supersample and
//              column 0's last: ink there is geometrically impossible iff
//              every posed slab keeps |x| < BOUND.
//   SNAP_PRICE  32768 (0.5 px) — the walk/idle chain-snap mean rounding.
//              Head and tail chains are y-static across walk/idle frames,
//              so the per-frame `roundPx(0)` term is zero and ±0.5 px is
//              the whole price (the FRAME-VARIANCE GUARD in the V1 tests
//              is what keeps that true).
//   FIT_ASYM   BOUND − SNAP_PRICE, both sides — the asymptote no genome
//              reaches, so post-snap extent ≤ 991231 < BOUND for every
//              int32-representable input, unconditionally.
//
// The map is ONE RHE division of a constant numerator by an increasing
// denominator, so monotonicity is a theorem rather than a sweep result;
// the naive two-op form `K + fp_div(fp_mul(w, d), d + w)` is genuinely
// non-monotone under double rounding (36 650 decreasing pairs on the
// front constants over the swept domain [400000, 1700000], against ZERO
// for the form below) and must never be reintroduced — the V1 tests pin
// vectors at K+128/K+129 as its tripwire.
// ---------------------------------------------------------------------------

/** Column-31's first supersample / column-0's last: 15.125 px. */
export const FIT_BOUND = 991232;
/** Walk/idle chain-snap price on a y-static chain: ±0.5 px. */
export const FIT_SNAP_PRICE = 32768;
/** Shared per-side asymptote — exactly `FIT_BOUND − FIT_SNAP_PRICE`. */
export const FIT_ASYM = 958464;
/** The 30-column budget in model units: `2 · FIT_ASYM` (29.25 px). */
export const SPAN_BUDGET = 1916928;
/** Front knee — identity at and below (14.125 px). */
export const FIT_KNEE_F = 925696;
/** Rear knee — identity at and below (13.25 px). */
export const FIT_KNEE_R = 868352;
/** Front soft-knee width `FIT_ASYM − FIT_KNEE_F` (0.5 px). */
const FIT_W_F = 32768;
/** `fp_mul(FIT_W_F, FIT_W_F)` — the front numerator (0.25 px²). */
const FIT_W2_F = 16384;
/** Rear soft-knee width `FIT_ASYM − FIT_KNEE_R` (1.375 px). */
const FIT_W_R = 90112;
/** `fp_mul(FIT_W_R, FIT_W_R)` — the rear numerator (1.890625 px²). */
const FIT_W2_R = 123904;

/**
 * Tail-root cross-extent floor (0.9 px) — the M1 eye-floor mechanism, third
 * application. `body.tail.girth` ∈ [0.6, 2] px halves (id 34); at the low
 * half the tail rendered as the M2 verdict's 1 px outline-less wire, and the
 * six carrier seeds (s06 0.7610, s17 0.8012, s28 0.6836, s53 0.7484,
 * s60 0.6245, s95 0.6706) are a population, not a domain corner. Identity at
 * and above, so thick-tailed genomes keep their bytes.
 */
export const TAIL_GIRTH_FLOOR = 58982;

/**
 * The design 06 §1.4 screen-mapping tilt (0.5), mirrored here so grammar.ts
 * stays free of a raster import — raster.ts imports THIS module, so the
 * dependency cannot run the other way. CI asserts the two raws agree
 * (`SCREEN_TILT === TILT_RAW`), so the mirror can never drift.
 */
export const SCREEN_TILT = 32768;

/**
 * A rest slab's PROFILE-VIEW screen-row half extent.
 *
 * The screen mapping is `sy = −cz − TILT·cy`, and the profile yaw swaps the
 * model x/y halves, so a slab's rendered row half extent in the side view is
 * `hz + TILT·hx` — the box's shear image, not `hz` alone. This is the
 * quantity that decides whether a slab can lay four flat rows against a
 * frame edge; using `hz` by itself understates it by `TILT·hx`, which for a
 * snout is a full pixel and change.
 */
export function profileRowHalfExtent(half: readonly [number, number, number]): number {
  return fp_add(half[2], fp_mul(SCREEN_TILT, half[0]));
}

/**
 * The front soft-knee `g_F`: identity at and below {@link FIT_KNEE_F},
 * `FIT_ASYM − w²/(d + w)` above it (algebraically `K + w·d/(d+w)`) — value
 * K and slope 1 at the knee, asymptote {@link FIT_ASYM}, never reached.
 * `fp_div(16384, 32768) = 32768` makes the joint EXACT.
 */
export function fitFront(extent: number): number {
  if (extent <= FIT_KNEE_F) return extent;
  return fp_sub(FIT_ASYM, fp_div(FIT_W2_F, fp_add(fp_sub(extent, FIT_KNEE_F), FIT_W_F)));
}

/**
 * The rear soft-knee `g_R` — same form at {@link FIT_KNEE_R}.
 * `fp_div(123904, 90112) = 90112` makes the joint EXACT.
 */
export function fitRear(extent: number): number {
  if (extent <= FIT_KNEE_R) return extent;
  return fp_sub(FIT_ASYM, fp_div(FIT_W2_R, fp_add(fp_sub(extent, FIT_KNEE_R), FIT_W_R)));
}

/**
 * One quadruped's frame-fit record: the UNCORRECTED chain extents that
 * enter the maps, and the rigid per-chain translations they imply.
 *
 * `front` is the head chain's MAX `cy + hy` over its slabs — head ball,
 * snout, ears, eyes and the maw emitter alike — so no dominance assumption
 * exists anywhere in the mechanism (the eyes measurably exceed the head
 * ball at eye_size-hi corners, and the maw is the global front corner at
 * 24.785 px). `rear` is `−min(cy − hy)` over the tail chain.
 */
export interface QuadrupedFit {
  /** Uncorrected head-chain front extent (chain max of `cy + hy`). */
  readonly front: number;
  /** Uncorrected tail-chain rear extent, positive (`−min(cy − hy)`). */
  readonly rear: number;
  /** Head-chain translation `g_F(front) − front` ≤ 0. */
  readonly dFront: number;
  /** Tail-chain translation `rear − g_R(rear)` ≥ 0. */
  readonly dRear: number;
}

/** The no-correction record (used when a chain is absent from a graph). */
const FIT_IDENTITY: QuadrupedFit = Object.freeze({
  front: 0,
  rear: 0,
  dFront: 0,
  dRear: 0,
});

/** Apply the tail-root girth floor to a grown quadruped's tail chain. */
function floorTailRoot(parts: readonly PartNode[]): readonly PartNode[] {
  let touched = false;
  const out = parts.map((node) => {
    if (node.animChain !== "tail") return node;
    const [hx, hy, hz] = node.slab.half;
    const fx = Math.max(hx, TAIL_GIRTH_FLOOR);
    const fz = Math.max(hz, TAIL_GIRTH_FLOOR);
    if (fx === hx && fz === hz) return node;
    touched = true;
    return Object.freeze({
      ...node,
      slab: Object.freeze({
        center: node.slab.center,
        half: Object.freeze([fx, hy, fz]) as unknown as readonly [number, number, number],
      }),
    });
  });
  return touched ? out : parts;
}

/** Measure the head/tail chain extents that feed the soft-knee maps. */
function measureFit(parts: readonly PartNode[]): QuadrupedFit {
  let front: number | null = null;
  let rearMin: number | null = null;
  for (const node of parts) {
    if (node.animChain === "head") {
      const f = fp_add(node.slab.center[1], node.slab.half[1]);
      if (front === null || f > front) front = f;
    } else if (node.animChain === "tail") {
      const r = fp_sub(node.slab.center[1], node.slab.half[1]);
      if (rearMin === null || r < rearMin) rearMin = r;
    }
  }
  if (front === null && rearMin === null) return FIT_IDENTITY;
  const f = front ?? 0;
  const rear = rearMin === null ? 0 : -rearMin;
  return Object.freeze({
    front: f,
    rear,
    dFront: front === null ? 0 : fp_sub(fitFront(f), f),
    dRear: rearMin === null ? 0 : fp_sub(rear, fitRear(rear)),
  });
}

/**
 * The V1 fit pass: floor the tail root, measure the head/tail extents, then
 * translate each chain RIGIDLY along model y by its correction.
 *
 * Translation (not scaling) is the pinned mechanism: fixed-point addition
 * carries no rounding, so the APPLIED extent equals `g` bit for bit and the
 * order-preservation law holds on shipped values as a theorem rather than
 * an approximation; slab half-extents are untouched, so part shapes, the
 * craft pass's overlap topology, the M1 eye floor, and hitbox dimensions
 * all survive up to a shift. The floor changes cross-extents only, so the
 * rear extent is floor-independent — the order is pinned anyway.
 */
function fitQuadrupedGraph(raw: PartGraph): { readonly graph: PartGraph; readonly fit: QuadrupedFit } {
  const floored = floorTailRoot(raw.parts);
  const fit = measureFit(floored);
  if (fit.dFront === 0 && fit.dRear === 0) {
    if (floored === raw.parts) return { graph: raw, fit };
    return { graph: Object.freeze({ ...raw, parts: Object.freeze(floored) }), fit };
  }
  const parts = floored.map((node) => {
    const d = node.animChain === "head" ? fit.dFront : node.animChain === "tail" ? fit.dRear : 0;
    if (d === 0) return node;
    const [cx, cy, cz] = node.slab.center;
    return Object.freeze({
      ...node,
      slab: Object.freeze({
        center: Object.freeze([cx, fp_add(cy, d), cz]) as unknown as readonly [number, number, number],
        half: node.slab.half,
      }),
    });
  });
  return { graph: Object.freeze({ ...raw, parts: Object.freeze(parts) }), fit };
}

/**
 * The design 08 §2 byte-stable partition, per quadruped genome — the
 * population V1's anchor razor proves byte-identical to v2.
 *
 * THREE conjuncts, all of them GEOMETRY (design 08 §2 as amended at V1,
 * ruling R-V1b): below the front knee, below the rear knee, at or above the
 * tail-root girth floor. There is no fourth, pose-level conjunct, because V1
 * ships no pose mechanism at all: the one-shot clips run v2's envelopes
 * unmodified, so a genome whose GROWN geometry is byte-identical to v2 has a
 * byte-identical whole cell — walk, idle, and every transient one-shot frame
 * alike. (The clamp-era fourth conjunct died with the clamp; a regression to
 * four conjuncts is a CI failure.)
 *
 * Every conjunct carries real population: a knee-only partition would fail
 * its own razor, because the tail floor moves bytes for below-knee genomes
 * (carriers s06 and s60 are below both knees).
 */
export interface QuadrupedClassification extends QuadrupedFit {
  /** `body.tail.girth` as sampled (the registry scalar). */
  readonly girth: number;
  /** True iff all three geometry conjuncts hold — the whole partition test
   * for a quadruped. */
  readonly geometryStable: boolean;
  /** The failing conjunct names, in predicate order (empty ⟺ geometry stable). */
  readonly fails: readonly string[];
}

/**
 * Classify one quadruped genome against the byte-stable partition — the
 * ONE implementation, shared by growth, the tests, the sweeps and the
 * baseline razor.
 */
export function classifyQuadruped(genome: Genome): QuadrupedClassification {
  const fit = fitQuadrupedGraph(growPlan(QUADRUPED_PLAN, genome)).fit;
  const girth = getScalar(genome, "body.tail.girth");
  const fails: string[] = [];
  if (fit.front > FIT_KNEE_F) fails.push("front>knee");
  if (fit.rear > FIT_KNEE_R) fails.push("rear>knee");
  if (girth < TAIL_GIRTH_FLOOR) fails.push("girth<floor");
  return Object.freeze({
    ...fit,
    girth,
    geometryStable: fails.length === 0,
    fails: Object.freeze(fails),
  });
}

/**
 * The design 08 §2 byte-stable partition, plan-generic — the population V1's
 * anchor razor proves byte-identical to v2 (§0.1 sense, permitted diff
 * `generator_version`).
 *
 * Levitant and amorphous genomes are ALWAYS in: V1 touches no levitant or
 * amorphous geometry and ships no render-path or pose branch, so those plans
 * cannot move a byte. A quadruped is in iff {@link classifyQuadruped} says
 * its geometry is stable — three conjuncts, no more.
 */
export function inFrameFitPartition(genome: Genome): boolean {
  if (getScalar(genome, "meta.plan") !== 0) return true;
  return classifyQuadruped(genome).geometryStable;
}

/**
 * Grow the quadruped part graph — `growPlan(QUADRUPED_PLAN, genome)` put
 * through the V1 fit pass. One seam: every consumer (pose, hitboxes, snap,
 * flicker, the craft pass) sees the corrected graph, and growth stays
 * draw-free on the default path.
 */
export function growQuadruped(genome: Genome): PartGraph {
  return fitQuadrupedGraph(growPlan(QUADRUPED_PLAN, genome)).graph;
}

// ---------------------------------------------------------------------------
// Levitant geometry — design 07 §2.3.1 (U3) pinned template constants.
// All-defaults reproduces S1's watcher() (spike01_slab_projection.py:187)
// exactly in raw except the two pinned 1-ulp derivation notes (iris rest
// y 334233, tendril-2 drop 629145) — machine-verified before pinning.
// ---------------------------------------------------------------------------

/** Orb half-extent wolf constants C: 5.4, 5.2, 5.4. */
const ORB_CX = 353894; // 5.4
const ORB_CY = 340787; // 5.2
const ORB_CZ = 353894; // 5.4
/** Orb coupling slopes σ: 5.4/3.9 on girth, 5.2/7.6 on length, 0.5 on depth. */
const ORB_SX = 90742; // 5.4/3.9
const ORB_SY = 44840; // 5.2/7.6 (= |hip_y hind σ| — design 06 cross-check)
const ORB_SZ = 32768; // 0.5 — damped (design 07 §2.3.1: the canvas-safety overrule)
/** Eye-stack scale-proportional offsets: sclera −1.3·s, iris +1.2·s, pupil +2.0·s from ORB_HY / SCL_Y. */
const STACK_SCLERA_BACK = 85197; // 1.3
const STACK_IRIS_FWD = 78643; // 1.2
const STACK_PUPIL_FWD = 131072; // 2.0
/** Sclera half-extents ×s: (3.0, 2.0, 3.0). */
const SCLERA_HALF = [196608, 131072, 196608] as const;
/** Iris half-extents ×s: (1.6, 1.1, 1.6). */
const IRIS_HALF = [104858, 72090, 104858] as const;
/** Pupil half-extents ×s, FLOORED at these raws (the M1 eye-floor mechanism): (0.75, 0.6, 0.75). */
const PUPIL_HALF = [49152, 39322, 49152] as const;
/** Wing placement: +0.6 from the orb flank, −1.2, z0 + 2.2. */
const WING_OX = 39322; // 0.6
const WING_OY = -78643; // −1.2
const WING_OZ = 144179; // 2.2
/** Wing half-extents ×w: (2.1, 0.9, 1.3). */
const WING_HALF = [137626, 58982, 85197] as const;
/** Horn x: C 3.4 tracking girth at ratio slope 3.4/3.9. */
const HORN_CX = 222822; // 3.4
const HORN_SX = 57134; // 3.4/3.9 — machine-verified (the adjudicator's hand value 57139 was wrong)
const HORN_OY = 65536; // 1.0
/** Horn z rides the orb TOP at constant protrusion: rel = ORB_HZ − 0.4. */
const HORN_OZ_REL = -26214; // −0.4
/** Horn half-extents — constants: (0.8, 0.8, 1.5). */
const HORN_HALF = [52429, 52429, 98304] as const;
/** Tendril taper step: girth_i = girth − i·9830 (plain int multiple). */
const TAPER_STEP = 9830; // 0.15
/** Tendril spacing base: SPACING_STEP = 1.7 + (tendril_len − 1.3). */
const SPACING_BASE = 111411; // 1.7
const TENDRIL_LEN_D = 85197; // tendril_len default 1.3
/** DROP_0 = orb_hz − 0.5 + tendril_len (constant 0.5 px overlap with the orb bottom). */
const DROP_OVERLAP = 32768; // 0.5

/** Registry default of body.sensor[C].scale etc. — shared dim defaults above. */

/**
 * The derived levitant anchors (design 07 §2.3.1): orb half-extents in
 * delta form off the shared core dims (`fp_mul(σ, 0) = 0` — exact at
 * defaults), plus the eye-stack line. G/L/D are ids 14/13/15 (the design
 * 01 §3 cross-plan homology carriers — no levitant-only dimension
 * vocabulary exists), ALT id 42, s id 43.
 */
export interface LevitantAnchors {
  /** Orb half-extent x — C 5.4, tracks core.girth, σ 5.4/3.9. */
  readonly orbHx: number;
  /** Orb half-extent y — C 5.2, tracks core.length, σ 5.2/7.6. */
  readonly orbHy: number;
  /** Orb half-extent z — C 5.4, tracks core.depth, σ 0.5 (damped — canvas safety). */
  readonly orbHz: number;
  /** Rest orb center z — the altitude locus, no coupling. */
  readonly z0: number;
  /** Sclera center y = orbHy − 1.3·s (scale-proportional embed). */
  readonly sclY: number;
}

/** Compute the levitant anchors for a genome (design 07 §2.3.1 table). */
export function deriveLevitantAnchors(genome: Genome): LevitantAnchors {
  const girth = getScalar(genome, "body.core.girth");
  const length = getScalar(genome, "body.core.length");
  const depth = getScalar(genome, "body.core.depth");
  const s = getScalar(genome, "body.sensor[C].scale");
  const orbHy = anchor(ORB_CY, ORB_SY, length, LENGTH_D);
  return Object.freeze({
    orbHx: anchor(ORB_CX, ORB_SX, girth, GIRTH_D),
    orbHy,
    orbHz: anchor(ORB_CZ, ORB_SZ, depth, DEPTH_D),
    z0: getScalar(genome, "body.core.altitude"),
    sclY: fp_sub(orbHy, fp_mul(s, STACK_SCLERA_BACK)),
  });
}

/**
 * The pupil pixel-phase target: the DOWN-view sub-pixel phase of the
 * all-defaults watcher's own rest pupil — `RHE(386662 / 2) mod 65536` =
 * 62259 (derived, not authored; machine-verified). See
 * {@link pupilPhaseCy} for the coupling this anchors.
 */
const PUPIL_PHASE_TARGET = 62259;

/**
 * The U3 pupil pixel-phase coupling (design 07 §2.3.1, the D-i evidence
 * repair — sweep-triggered per the adjudicated spec's "pin the narrowest
 * all-defaults-byte-inert coupling ONLY if failures appear").
 *
 * Mechanism: the levitant's pupil is structurally CENTERED (cx = 0 on
 * the snapped body chain), so its down-view footprint always splits its
 * sample columns evenly across a pixel boundary; whether the 1.5-px
 * focal disc wins any majority vote then hinges entirely on its screen-y
 * sub-pixel phase, `fp_mul(TILT, cy) mod one pixel` (the chain snap
 * plants the orb anchor on a whole-pixel raw, so the phase is exact
 * geometry, no raster knowledge needed). The evidence sweep (seeds
 * 0..1999 levitant-forced, down view, 4 walk phases) found 408 of 8000
 * frames with ZERO focal pixels without this repair, 0 of 8000 with it
 * (counts + method in the design 07 §2.3.1 amendment). Repair: advance cy
 * FORWARD (+y only — more protrusion, never occlusion, the M1 EY
 * spirit) by the smallest delta that lands the phase exactly on
 * {@link PUPIL_PHASE_TARGET}, the phase the all-defaults watcher proves
 * out. `2·screenDelta` is exact in model y because TILT is exactly 0.5.
 * At all defaults the phase already equals the target, so delta = 0 —
 * byte-inert by construction.
 */
function pupilPhaseCy(rawCy: number): number {
  const syOff = fp_mul(32768, rawCy); // TILT · cy — the exact down-view screen offset
  const phase = ((syOff % 65536) + 65536) % 65536;
  const delta = (PUPIL_PHASE_TARGET - phase + 65536) % 65536; // forward-only [0, 1) px screen
  return fp_add(rawCy, 2 * delta);
}

function pupilChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome) {
      const a = deriveLevitantAnchors(genome);
      const s = getScalar(genome, "body.sensor[C].scale");
      return {
        name: "pupil",
        path: "body.sensor[C].pupil",
        materialRole: "focal",
        animChain: "body",
        slab: {
          center: [0, pupilPhaseCy(fp_add(a.sclY, fp_mul(s, STACK_PUPIL_FWD))), a.z0],
          // Floored at the watcher raws (design 07 §2.3.1 / the M1
          // eye-floor justification verbatim): a sub-0.8-px disc loses
          // its majority votes. Identity at s = 1.
          half: [
            Math.max(fp_mul(s, PUPIL_HALF[0]), PUPIL_HALF[0]),
            Math.max(fp_mul(s, PUPIL_HALF[1]), PUPIL_HALF[1]),
            Math.max(fp_mul(s, PUPIL_HALF[2]), PUPIL_HALF[2]),
          ],
        },
      };
    },
  };
}

function irisChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome) {
      const a = deriveLevitantAnchors(genome);
      const s = getScalar(genome, "body.sensor[C].scale");
      return {
        name: "iris",
        path: "body.sensor[C].iris",
        materialRole: "hide",
        animChain: "body",
        slab: {
          center: [0, fp_add(a.sclY, fp_mul(s, STACK_IRIS_FWD)), a.z0],
          half: [fp_mul(s, IRIS_HALF[0]), fp_mul(s, IRIS_HALF[1]), fp_mul(s, IRIS_HALF[2])],
        },
      };
    },
  };
}

function scleraChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome) {
      const a = deriveLevitantAnchors(genome);
      const s = getScalar(genome, "body.sensor[C].scale");
      return {
        name: "sclera",
        path: "body.sensor[C]",
        materialRole: "underside",
        animChain: "body",
        slab: {
          center: [0, a.sclY, a.z0],
          half: [fp_mul(s, SCLERA_HALF[0]), fp_mul(s, SCLERA_HALF[1]), fp_mul(s, SCLERA_HALF[2])],
        },
        // Canonical socket order body.sensor[C]: [iris, pupil]
        // (design 07 §2.3.1) — the stack expands depth-first here.
        sockets: [
          {
            name: "iris",
            allowedKinds: ["sensor"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [irisChoice()],
          },
          {
            name: "pupil",
            allowedKinds: ["sensor"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [pupilChoice()],
          },
        ],
      };
    },
  };
}

function wingsChoice(): PartChoice {
  return {
    kind: "locomotor",
    make(genome, member) {
      const a = deriveLevitantAnchors(genome);
      const w = getScalar(genome, "body.core.locomotor_size");
      const wingX = fp_add(a.orbHx, WING_OX); // flank-tracking, constant 0.6 gap
      const tag = MIRROR_TAGS[member]!;
      return {
        name: `wing_${tag.toLowerCase()}`,
        path: `body.locomotor[${tag}]`,
        materialRole: "underside",
        animChain: `wing_${tag.toLowerCase()}`,
        slab: {
          center: [member === 0 ? -wingX : wingX, WING_OY, fp_add(a.z0, WING_OZ)],
          half: [fp_mul(w, WING_HALF[0]), fp_mul(w, WING_HALF[1]), fp_mul(w, WING_HALF[2])],
        },
      };
    },
  };
}

function hornsChoice(): PartChoice {
  return {
    kind: "ornament",
    make(genome, member) {
      const a = deriveLevitantAnchors(genome);
      const girth = getScalar(genome, "body.core.girth");
      const hornX = anchor(HORN_CX, HORN_SX, girth, GIRTH_D);
      const tag = MIRROR_TAGS[member]!;
      return {
        name: `horn_${tag.toLowerCase()}`,
        path: `body.ornament[${tag}]`,
        materialRole: "underside",
        animChain: "body",
        slab: {
          center: [
            member === 0 ? -hornX : hornX,
            HORN_OY,
            fp_add(a.z0, fp_add(a.orbHz, HORN_OZ_REL)),
          ],
          half: [HORN_HALF[0], HORN_HALF[1], HORN_HALF[2]],
        },
      };
    },
  };
}

function tendrilsChoice(): PartChoice {
  return {
    kind: "segment",
    make(genome, member) {
      const a = deriveLevitantAnchors(genome);
      const tg = getScalar(genome, "body.core.tendril_girth");
      const tl = getScalar(genome, "body.core.tendril_len");
      // DROP_i = DROP_0 + i·SPACING_STEP (plain int multiples — exact).
      const drop0 = fp_add(fp_sub(a.orbHz, DROP_OVERLAP), tl);
      const spacing = fp_add(SPACING_BASE, fp_sub(tl, TENDRIL_LEN_D));
      const gi = tg - member * TAPER_STEP; // plain int multiple (taper)
      return {
        name: `tendril_${member}`,
        path: `body.tendril[T:${member}]`,
        materialRole: "hide",
        animChain: `tendril_${member}`,
        slab: {
          center: [0, 0, fp_sub(a.z0, fp_add(drop0, member * spacing))],
          half: [gi, gi, tl],
        },
      };
    },
  };
}

/**
 * The levitant lens emitter (design 07 §6.1, U5): chain `body` (rides
 * the hover rigidly with the face, F16), role `focal`. Sits 2.0 px
 * below the orb center, under the eye stack; proud of the orb front by
 * ≥ 1.5 px at every size (floors) and of the sclera front at every
 * sensor scale — machine-verified.
 */
function lensChoice(): PartChoice {
  return {
    kind: "emitter",
    existsLocus: "body.emitter[C].exists",
    make(genome) {
      const a = deriveLevitantAnchors(genome);
      const [hx, hy, hz] = emitterHalves(genome);
      return {
        name: "lens",
        path: "body.emitter[C]",
        materialRole: "focal",
        animChain: "body",
        slab: {
          center: [0, fp_add(a.orbHy, fp_sub(hy, EMIT_EMBED)), fp_add(a.z0, LENS_OZ)],
          half: [hx, hy, hz],
        },
      };
    },
  };
}

/**
 * Levitant crown ornament candidates (design 07 §6.1): plate (flat cap)
 * / wisp (flame) / sprout riding the orb top at 0.3 embed — fixed
 * central placement (no placement draw; crown hx ≤ 1.3 clears both
 * horns at every girth: horn x tracks girth OUTWARD, the gap only
 * grows).
 */
function crownCandidates(): PartChoice[] {
  return ornamentCandidates(
    "crown",
    "body.ornament[K]",
    "body.ornament[K].exists",
    "body",
    {
      plate: [85197, 39322, 32768], // 1.3, 0.6, 0.5 — flat cap
      wisp: [26214, 26214, 104858], // 0.4, 0.4, 1.6 — flame
      sprout: [22938, 22938, 117965], // 0.35, 0.35, 1.8
    },
    (genome, halves) => {
      const a = deriveLevitantAnchors(genome);
      return [0, 0, fp_add(a.z0, fp_add(a.orbHz, fp_sub(halves[2], ORN_EMBED)))];
    },
  );
}

function orbChoice(): PartChoice {
  return {
    kind: "core",
    make(genome) {
      const a = deriveLevitantAnchors(genome);
      return {
        name: "orb",
        path: "body.core",
        materialRole: "hide",
        animChain: "body",
        slab: {
          center: [0, 0, a.z0],
          half: [a.orbHx, a.orbHy, a.orbHz],
        },
        // Canonical socket order (design 07 §2.3.1):
        // body.core: [sensor, locomotors, ornaments, tendrils].
        sockets: [
          {
            name: "sensor",
            allowedKinds: ["sensor"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [scleraChoice()],
          },
          {
            name: "locomotors",
            allowedKinds: ["locomotor"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            candidates: [wingsChoice()],
          },
          {
            name: "ornaments",
            allowedKinds: ["ornament"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            candidates: [hornsChoice()],
          },
          {
            name: "tendrils",
            allowedKinds: ["segment"],
            symmetry: { kind: "serial", n: 3 },
            clearanceFp: NO_CLEARANCE,
            candidates: [tendrilsChoice()],
          },
          // U5 appends (design 07 §6.1) — emitter before ornament (the
          // §3.1 guarantee-order ruling); census 11 + 2 = 13 ≤ 14, both
          // fit, no competition on this plan.
          {
            name: "emitter",
            allowedKinds: ["emitter"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [lensChoice()],
          },
          {
            name: "crown",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE, // fixed placement — no draw to re-roll
            drawPath: "body.ornament[K]", // the kind fill draw
            candidates: crownCandidates(),
          },
        ],
      };
    },
  };
}

/**
 * The levitant plan (design 07 §2.3.1, U3): 11 nodes — orb, the sclera/
 * iris/pupil sensor stack, mirror wings (locomotors), mirror horns
 * (ornaments — the §1.3 vocabulary amendment), and 3 serial tendrils
 * (count FIXED at 3 in U3; a count locus would collide with 06 §2's
 * existence-defaults-absent law — recorded tension, deferred). Every
 * socket is a single-candidate mandatory fill ⇒ zero draws for every
 * levitant genome. Chains: body {orb, sensor stack, horns} rides z0
 * rigidly (F16 — the face never scrambles), wing_l/wing_r flap
 * independently, each tendril is its own lagged chain. Budget 8–14; the
 * levitant uses 11. All-defaults reproduces S1's watcher (fp
 * re-derivation; two pinned 1-ulp notes).
 */
export const LEVITANT_PLAN: PlanSpec = Object.freeze({
  plan: "levitant",
  budgetMin: 8,
  budgetMax: 14,
  core: orbChoice(),
});

/** Grow the levitant part graph — `growPlan(LEVITANT_PLAN, genome)`. */
export function growLevitant(genome: Genome): PartGraph {
  return growPlan(LEVITANT_PLAN, genome);
}

// ---------------------------------------------------------------------------
// The grammar's structural output wires (PART_NAMES / CHAINS / PART_ROLES
// and the per-plan variants) live in wires.ts since U5 — derived from the
// all-defaults growths there, byte-identical values; see wires.ts for the
// module-cycle rationale.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Amorphous geometry — design 07 §2.4.1 (U4) pinned template constants.
// All-defaults reproduces S1b's slime() (spike01b_more_plans.py:144) in
// exact fp (worst |fp − float| 0.00126 px over all four walk phases —
// machine-verified before pinning). NOTE: ball slabs carry VISIBLE
// half-extents (F8's normative 0.67× law: the visible surface at
// TH = 0.3 sits at ~0.67× the ball radius); the renderer fork alone
// converts to ball radii via BALL_FROM_VIS. Every raw is RHE(d·2^16) of
// its authored decimal.
// ---------------------------------------------------------------------------

/**
 * F8's normative visible-radius law: VIS_RATIO = RHE(0.67·2^16); ball
 * radius recovers from a visible half-extent as
 * `fp_mul(vis, BALL_FROM_VIS)` with BALL_FROM_VIS = fp_div(2^16, 43909)
 * — computed ONCE per rasterize call in the fork, and at growth time by
 * the eye forward floor below. Round-trip fidelity vs the spike's
 * authored ball radii is ≤ 1 ulp (machine-verified per axis: blob.x
 * +1, crest.x −1, crest.y +1, crest.z +1, skirt.y +1, rest 0; the
 * authored VISIBLE raws are the pins, recovered ball radii are
 * derived values).
 */
export const VIS_RATIO = 43909; // RHE(0.67·2^16)
/** fp_div(65536, VIS_RATIO) — the visible→ball radius factor. */
export const BALL_FROM_VIS = 97815;

/** Blob (main ball) visible half-extents C: 0.67·(8.2, 7.8, 6.8). */
const BLOB_VX_C = 360055; // 5.494
const BLOB_VY_C = 342491; // 5.226
const BLOB_VZ_C = 298582; // 4.556
/** Blob coupling slopes σ: 0.67·8.2/3.9 girth, 0.67·7.8/7.6 length, 0.67·6.8/3.4 depth. */
const SIG_BLOB_VX = 92322;
const SIG_BLOB_VY = 45065;
const SIG_BLOB_VZ = 87818;
/** Rest blob center z — C 4.4, tracks depth at BLOB_VZ's OWN σ, so the
 * rest ground gap (Z0 − BLOB_VZ = −10224 raw = −0.156 px: the slime
 * TOUCHES the ground) is constant across the depth domain. */
const Z0_C = 288358; // 4.4
/** Crest visible half-extents — constants (0.67·(4.0, 3.8, 3.4)); the
 * crest merges into big bodies rather than scaling (recorded). */
const CREST_V = [175636, 166855, 149291] as const;
/** Crest rest offsets: y −0.8, z rel +3.6 (rides stretch in pose). */
const CREST_Y = -52429; // −0.8
export const CREST_ZREL = 235930; // 3.6 — pose.ts consumes it (z delta rides stretch)
/** Skirt visible half-extents: x/y coupled (0.67·(7.4, 7.0)), z constant 0.67·3.6. */
const SKIRT_VX_C = 324927; // 4.958
const SKIRT_VY_C = 307364; // 4.69
const SKIRT_VZ = 158073; // 2.412 — constant (grounded band)
const SIG_SKIRT_VX = 83315; // 0.67·7.4/3.9
const SIG_SKIRT_VY = 40443; // 0.67·7.0/7.6
/** Skirt rest center: y 0.6, z 1.9 (spike constants). */
const SKIRT_Y = 39322; // 0.6
const SKIRT_Z = 124518; // 1.9
/** Drip visible half-extents — constants 0.67·(2.3, 2.3, 2.0). */
const DRIP_V = [100991, 100991, 87818] as const;
/** Drip rest y — C −5.4 tracking length at σ −0.6 DAMPED (sweep-optimized:
 * 0.55 ⇒ 42 corner fails, 0.60 ⇒ 14, 0.65 ⇒ 22 — totals incl. a
 * constant +4 death-occlusion baseline; drip-only 38/10/18 — design 07
 * §2.4.1). */
const DRIP_Y0_C = -353894; // −5.4
const SIG_DRIP_Y = -39322; // −0.6
/** Drip rest z 1.6 (spike). */
const DRIP_Z0 = 104858; // 1.6
/** Eye slab half-extents — constants (0.85, 0.6, 1.1), spike slabs. */
const AMORPH_EYE_HALF = [55706, 39322, 72090] as const;
/** Eye x — C 2.0 tracking girth at 2.0/3.9 (constant visible-flank ratio). */
const AMORPH_EYE_X_C = 131072; // 2.0
const SIG_AMORPH_EYE_X = 33608; // 2.0/3.9
/** Eye y — C 4.6 sharing BLOB_VY's σ ⇒ constant 0.626 px front setback. */
const AMORPH_EYE_Y_C = 301466; // 4.6
const SIG_AMORPH_EYE_Y = SIG_BLOB_VY;
/** Eye z rides the blob center at constant rel +0.8. */
export const EYE_ZREL = 52429; // 0.8
/** Highlight half-extents — constants (1.2, 0.9, 1.0). */
const HI_HALF = [78643, 58982, 65536] as const;
/** Highlight x — C −2.4 tracking girth at −2.4/3.9. */
const HI_X_C = -157286; // −2.4
const SIG_HI_X = -40330; // −2.4/3.9
/** Highlight y — C 2.6 tracking length at 2.6/7.6 (constant body-frame ratio). */
const HI_Y_C = 170394; // 2.6
const SIG_HI_Y = 22420; // 2.6/7.6
/** Highlight z rel — C 3.0 tracking depth at 3.0/3.4 (constant z ratio to
 * the blob ball; both the decimal-ratio and fp_div forms land 57826). */
const HI_ZREL_C = 196608; // 3.0
const SIG_HI_ZREL = 57826; // 3.0/3.4

/**
 * Per-ball field weights W (spike: 1.0, 0.8, 0.7, 0.55) in node-id order
 * blob, crest, skirt, drip. Template constants; pose.ts emits them as
 * per-frame `fieldWeight` raws (death deflates them — design 07 §2.4.1).
 */
export const AMORPHOUS_WEIGHTS: readonly number[] = Object.freeze([
  65536, 52429, 45875, 36045,
]);

/**
 * Eye forward floor thresholds (design 07 §2.4.1, the M1 eye-visibility
 * mechanism in amorphous form — evidence-triggered: 256 buried-eye
 * corner configs without the floor, 0 with it — the corrected,
 * artifact-backed figure, see §2.4.1). The floor guarantees
 * the blob ball contributes < 0.25 and the skirt ball < 0.05 of field
 * at the eye's front face (sum + crest/drip residual < TH, sweep-proven
 * with worst margin +295 raw). Q_BODY = FP − fp_sqrt(fp_div(16384,
 * 65536)) = 32768 exact; Q_SKIRT = FP − fp_sqrt(fp_div(3277, 45875)).
 */
const Q_BODY = 32768;
const Q_SKIRT = 48021;
/**
 * Wide-pose BLOB floor threshold (the U4 visibility repair's second
 * candidate): term budget B = 0.26 of field —
 * Q_BODY_WIDE = FP − fp_sqrt(RHE(0.26·2^16) = 17039) = 32119
 * (machine-derived; a hand-derived 32118 was 1 ulp wrong — the
 * machine-verify law at work). B sits strictly ABOVE the defaults' own
 * wide-pose blob term (walk-f3 16751, idle-f1 16315 —
 * machine-verified), so the all-defaults genome stays exactly inert,
 * while burial genomes (worst caught: seed 4 walk f3, blob term 18865,
 * total margin +796 raw yet zero focal pixels — a pre-repair-build
 * diagnostic) are pushed to ≥ 2620 raw of field margin (production
 * probe: seed 4 walk f3 = 2620 exactly; the draft's 2622 predates the
 * DRIP_EXTRA 6259 re-pin — §2.4.1) — the defaults' proven league
 * (defaults win their pixels at 2910).
 */
const Q_BODY_WIDE = 32119;

/**
 * Idle breathing squash amplitude — template constant, 0.10 (the
 * spike's OWN idle preset; the sign FLIPS vs the walk squash — the
 * recorded U4 idle-rule deviation). Lives here because the wide-pose
 * eye floor below consumes it at growth time; pose.ts imports it.
 */
export const IDLE_BREATH = 6554;

/**
 * The derived amorphous anchors (design 07 §2.4.1): every geometry
 * anchor in delta form off the SHARED core dims — `fp_mul(σ, 0) = 0`,
 * exact at defaults; no amorphous dimension locus exists (the U3 D-d
 * homology ruling re-verified against the blob geometry). G/L/D are ids
 * 14/13/15.
 */
export interface AmorphousAnchors {
  /** Blob visible half-extents (x, y, z). */
  readonly blobVx: number;
  readonly blobVy: number;
  readonly blobVz: number;
  /** Rest blob center z — C 4.4, shares blobVz's σ (constant ground gap −0.156 px). */
  readonly z0: number;
  /** Skirt visible half-extents x, y (z is the SKIRT_VZ constant). */
  readonly skirtVx: number;
  readonly skirtVy: number;
  /** Drip rest y — C −5.4, σ −0.6 damped. */
  readonly dripY: number;
  /** Eye |x| — C 2.0, σ 2.0/3.9. */
  readonly eyeX: number;
  /** Eye rest y AFTER the forward floor (max of the coupled anchor,
   * the rest floors, and the wide-pose skirt floor; every floor
   * inactive at all defaults — rest-body margin 6878 raw, wide-skirt
   * margin 153 464 raw — byte-inert, the M1 EY-floor pattern). */
  readonly eyeY: number;
  /** Highlight x (C −2.4) and y (C 2.6). */
  readonly hiX: number;
  readonly hiY: number;
  /** Highlight z rel to the blob center — C 3.0, σ 3.0/3.4; pose.ts
   * consumes it (the z delta rides stretch). */
  readonly hiZRel: number;
}

/**
 * One eye forward floor candidate (design 07 §2.4.1 §5, exact fp step
 * order): in the BALL-radius frame of ball b at rest,
 * `X = fp_div(eyeX − cx, ballRx)`, `Z = fp_div(eyeZ − cz, ballRz)`
 * (|X| or |Z| > 1 → inactive), `rem = q − X² − Z²` (≤ 0 → inactive),
 * `floor = cy + fp_mul(ballRy, fp_sqrt(rem)) − EYE_HALF.y`. Growth-time
 * divides — never per sample.
 */
function eyeFloor(
  eyeX: number,
  eyeZ: number,
  cx: number,
  cy: number,
  cz: number,
  visRx: number,
  visRy: number,
  visRz: number,
  q: number,
): number | null {
  const rx = fp_mul(visRx, BALL_FROM_VIS);
  const ry = fp_mul(visRy, BALL_FROM_VIS);
  const rz = fp_mul(visRz, BALL_FROM_VIS);
  const x = fp_div(fp_sub(eyeX, cx), rx);
  if (x > FP_ONE || x < -FP_ONE) return null;
  const z = fp_div(fp_sub(eyeZ, cz), rz);
  if (z > FP_ONE || z < -FP_ONE) return null;
  const rem = fp_sub(fp_sub(q, fp_mul(x, x)), fp_mul(z, z));
  if (rem <= 0) return null;
  return fp_sub(fp_add(cy, fp_mul(ry, fp_sqrt(rem))), AMORPH_EYE_HALF[1]);
}

/** Compute the amorphous anchors for a genome (design 07 §2.4.1 table). */
export function deriveAmorphousAnchors(genome: Genome): AmorphousAnchors {
  const girth = getScalar(genome, "body.core.girth");
  const length = getScalar(genome, "body.core.length");
  const depth = getScalar(genome, "body.core.depth");
  const blobVx = anchor(BLOB_VX_C, SIG_BLOB_VX, girth, GIRTH_D);
  const blobVy = anchor(BLOB_VY_C, SIG_BLOB_VY, length, LENGTH_D);
  const blobVz = anchor(BLOB_VZ_C, SIG_BLOB_VZ, depth, DEPTH_D);
  const z0 = anchor(Z0_C, SIG_BLOB_VZ, depth, DEPTH_D);
  const skirtVx = anchor(SKIRT_VX_C, SIG_SKIRT_VX, girth, GIRTH_D);
  const skirtVy = anchor(SKIRT_VY_C, SIG_SKIRT_VY, length, LENGTH_D);
  const eyeX = anchor(AMORPH_EYE_X_C, SIG_AMORPH_EYE_X, girth, GIRTH_D);
  const eyeYCoupled = anchor(AMORPH_EYE_Y_C, SIG_AMORPH_EYE_Y, length, LENGTH_D);
  // The eye forward floor (growth time, rest geometry, ball-radius
  // frame): candidates from the blob ball and the skirt ball.
  const eyeZ = fp_add(z0, EYE_ZREL);
  const floorBody = eyeFloor(eyeX, eyeZ, 0, 0, z0, blobVx, blobVy, blobVz, Q_BODY);
  const floorSkirt = eyeFloor(
    eyeX,
    eyeZ,
    0,
    SKIRT_Y,
    SKIRT_Z,
    skirtVx,
    skirtVy,
    SKIRT_VZ,
    Q_SKIRT,
  );
  // The WIDE-POSE skirt floor (U4 visibility repair, evidence-triggered
  // at implementation — design 07 §2.4.1): the rendered 0..1999 sweep
  // found genomes whose eyes render ZERO focal pixels at the wide-squash
  // frames (walk φ = 0.75 / idle φ = 0.25): squash widens the skirt
  // while dz0 = z0·(stretch − 1) < 0 sinks the eye toward it, so the
  // skirt's field term at the eye front blows the 0.05 budget the rest
  // floor guaranteed only at rest (worst observed: seed 11, idle f1
  // field −1238 raw PAST TH). The pinned U3 pixel-phase fallback is
  // mechanically ineffective here (the eyes' own-chain snap cancels
  // rest sub-pixel shifts, and this is field burial, not vote phase),
  // so the repair extends the floor mechanism itself: one more
  // candidate — the SAME skirt floor arithmetic evaluated at the
  // genome's own wide-squash pose (squash_w = 1 + max(squash_amp,
  // IDLE_BREATH), hop = 0, the walk/idle wide extreme; skirt halves
  // ×squash_w, eye z at z0 + EYE_ZREL + dz0_w), mapped back to a REST
  // anchor by the pinned division stretch form (pose re-applies
  // ×squash_w exactly up to ≤ 1 ulp of the div/mul round-trip —
  // recorded, budget slack is thousands of raws). Forward-only via the
  // same max(); inert at all defaults (the defaults' wide-pose skirt
  // candidate sits 153 464 raw BELOW the coupled anchor —
  // machine-verified in tests) so the all-defaults geometry is
  // untouched.
  const squashAmp = getScalar(genome, "anim.amorphous.squash_amp");
  const squashW = fp_add(FP_ONE, Math.max(squashAmp, IDLE_BREATH));
  const stretchW = fp_div(FP_ONE, squashW);
  const dz0W = fp_mul(z0, fp_sub(stretchW, FP_ONE)); // hop = 0 at the wide phase
  const eyeZW = fp_add(eyeZ, dz0W);
  const floorSkirtWide = eyeFloor(
    eyeX,
    eyeZW,
    0,
    SKIRT_Y,
    SKIRT_Z,
    fp_mul(squashW, skirtVx),
    fp_mul(squashW, skirtVy),
    SKIRT_VZ,
    Q_SKIRT,
  );
  // Wide-pose BLOB floor (candidate 4): the blob widens in x/y and
  // flattens in z at the wide pose (halves × (squash_w, squash_w,
  // stretch_w), center z rides dz0_w with the eye — their z offset
  // stays EYE_ZREL exactly), and a deep blob can bury the eye alone
  // (seed 4 walk f3). Budget 0.26 (Q_BODY_WIDE) — see the constant.
  const floorBodyWide = eyeFloor(
    eyeX,
    eyeZW,
    0,
    0,
    fp_add(z0, dz0W),
    fp_mul(squashW, blobVx),
    fp_mul(squashW, blobVy),
    fp_mul(stretchW, blobVz),
    Q_BODY_WIDE,
  );
  const wideCandidates = [floorSkirtWide, floorBodyWide].filter(
    (f): f is number => f !== null,
  );
  const floorWideRest =
    wideCandidates.length === 0 ? null : fp_div(Math.max(...wideCandidates), squashW);
  let eyeY = eyeYCoupled;
  if (floorBody !== null && floorBody > eyeY) eyeY = floorBody;
  if (floorSkirt !== null && floorSkirt > eyeY) eyeY = floorSkirt;
  if (floorWideRest !== null && floorWideRest > eyeY) eyeY = floorWideRest;
  return Object.freeze({
    blobVx,
    blobVy,
    blobVz,
    z0,
    skirtVx,
    skirtVy,
    dripY: anchor(DRIP_Y0_C, SIG_DRIP_Y, length, LENGTH_D),
    eyeX,
    eyeY,
    hiX: anchor(HI_X_C, SIG_HI_X, girth, GIRTH_D),
    hiY: anchor(HI_Y_C, SIG_HI_Y, length, LENGTH_D),
    hiZRel: anchor(HI_ZREL_C, SIG_HI_ZREL, depth, DEPTH_D),
  });
}

/** The three auxiliary balls in serial ordinal order (design 07 §2.4.1). */
const BALL_NAMES = ["crest", "skirt", "drip"] as const;

function ballsChoice(): PartChoice {
  return {
    kind: "segment",
    make(genome, member) {
      const a = deriveAmorphousAnchors(genome);
      const name = BALL_NAMES[member]!;
      let slab: RestSlab;
      switch (name) {
        case "crest":
          slab = {
            center: [0, CREST_Y, fp_add(a.z0, CREST_ZREL)],
            half: [CREST_V[0], CREST_V[1], CREST_V[2]],
          };
          break;
        case "skirt":
          slab = {
            center: [0, SKIRT_Y, SKIRT_Z],
            half: [a.skirtVx, a.skirtVy, SKIRT_VZ],
          };
          break;
        default:
          slab = {
            center: [0, a.dripY, DRIP_Z0],
            half: [DRIP_V[0], DRIP_V[1], DRIP_V[2]],
          };
      }
      return {
        name,
        path: `body.ball[B:${member}]`,
        materialRole: "hide",
        animChain: "blob",
        slab,
      };
    },
  };
}

function amorphousEyesChoice(): PartChoice {
  return {
    kind: "sensor",
    make(genome, member) {
      const a = deriveAmorphousAnchors(genome);
      const tag = MIRROR_TAGS[member]!;
      return {
        name: `eye_${tag.toLowerCase()}`,
        path: `body.eye[${tag}]`,
        materialRole: "focal",
        animChain: "blob",
        slab: {
          center: [member === 0 ? -a.eyeX : a.eyeX, a.eyeY, fp_add(a.z0, EYE_ZREL)],
          half: [AMORPH_EYE_HALF[0], AMORPH_EYE_HALF[1], AMORPH_EYE_HALF[2]],
        },
      };
    },
  };
}

function highlightChoice(): PartChoice {
  return {
    kind: "ornament",
    make(genome) {
      const a = deriveAmorphousAnchors(genome);
      return {
        name: "highlight",
        path: "body.ornament[C]",
        materialRole: "underside",
        animChain: "blob",
        slab: {
          center: [a.hiX, a.hiY, fp_add(a.z0, a.hiZRel)],
          half: [HI_HALF[0], HI_HALF[1], HI_HALF[2]],
        },
      };
    },
  };
}

/**
 * The amorphous orifice emitter (design 07 §6.1, U5): a CLASSIC focal
 * slab (no fieldWeight) on the one blob chain — strictly in front of
 * the visible field surface by ≥ 1.5 px at every size (floors), it wins
 * its pixels by depth; no eye floor needed (it PROTRUDES by
 * construction, never sets back). Machine-verified at defaults.
 */
function orificeChoice(): PartChoice {
  return {
    kind: "emitter",
    existsLocus: "body.emitter[C].exists",
    make(genome) {
      const a = deriveAmorphousAnchors(genome);
      const [hx, hy, hz] = emitterHalves(genome);
      return {
        name: "orifice",
        path: "body.emitter[C]",
        materialRole: "focal",
        animChain: "blob",
        slab: {
          center: [0, fp_add(a.blobVy, fp_sub(hy, EMIT_EMBED)), a.z0],
          half: [hx, hy, hz],
        },
      };
    },
  };
}

/**
 * Amorphous rim ornament candidates (design 07 §6.1): classic slabs on
 * the blob chain, rear-top mounted (cy = −0.5·blobVy — clear of the
 * eyes, reads over the crest; interpenetration with the crest ball is
 * legal and invisible: one mass). No placement draw ⇒ no clearance
 * check (§5.1).
 */
function rimCandidates(): PartChoice[] {
  return ornamentCandidates(
    "rim",
    "body.ornament[M]",
    "body.ornament[M].exists",
    "blob",
    {
      plate: [78643, 58982, 32768], // 1.2, 0.9, 0.5
      wisp: [26214, 26214, 91750], // 0.4, 0.4, 1.4
      sprout: [22938, 22938, 104858], // 0.35, 0.35, 1.6
    },
    (genome, halves) => {
      const a = deriveAmorphousAnchors(genome);
      return [
        0,
        fp_mul(-32768, a.blobVy),
        fp_add(a.z0, fp_add(a.blobVz, fp_sub(halves[2], ORN_EMBED))),
      ];
    },
  );
}

function blobChoice(): PartChoice {
  return {
    kind: "core",
    make(genome) {
      const a = deriveAmorphousAnchors(genome);
      return {
        name: "blob",
        path: "body.blob",
        materialRole: "hide",
        animChain: "blob",
        slab: {
          center: [0, 0, a.z0],
          half: [a.blobVx, a.blobVy, a.blobVz],
        },
        // Canonical socket order (design 07 §2.4.1):
        // body.blob: [balls, eyes, highlight].
        sockets: [
          {
            name: "balls",
            allowedKinds: ["segment"],
            symmetry: { kind: "serial", n: 3 },
            clearanceFp: NO_CLEARANCE,
            candidates: [ballsChoice()],
          },
          {
            name: "eyes",
            allowedKinds: ["sensor"],
            symmetry: { kind: "mirror" },
            clearanceFp: NO_CLEARANCE,
            candidates: [amorphousEyesChoice()],
          },
          {
            name: "highlight",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [highlightChoice()],
          },
          // U5 appends (design 07 §6.1) — emitter before ornament (the
          // §3.1 guarantee-order ruling); census 7 + 2 = 9, both fit.
          {
            name: "emitter",
            allowedKinds: ["emitter"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE,
            candidates: [orificeChoice()],
          },
          {
            name: "rim",
            allowedKinds: ["ornament"],
            symmetry: { kind: "single" },
            clearanceFp: NO_CLEARANCE, // fixed placement — no draw to re-roll
            drawPath: "body.ornament[M]", // the kind fill draw
            candidates: rimCandidates(),
          },
        ],
      };
    },
  };
}

/**
 * The amorphous plan (design 07 §2.4.1, U4): 7 nodes — the blob core
 * (`body.blob`, the field owner: the union of the blob chain's ball
 * slabs, evaluated only by the renderer fork), 3 serial auxiliary balls
 * (`body.ball[B:0..2]` — crest, skirt, drip; count FIXED at 4 total, the
 * U3 tendril-count ruling verbatim), mirror eyes `body.eye[L]`/`[R]`
 * (focal slab face parts), and the single asymmetric highlight
 * `body.ornament[C]` (the U3 horns vocabulary-amendment precedent —
 * mandatory fill, underside role: the F5 bright-ramp gloss cue). Every
 * socket is a single-candidate mandatory fill ⇒ zero draws for every
 * amorphous genome; `mirror_broken` false always. Chains: ONE blob
 * chain holding ALL SEVEN slabs (§3's blob chain plus the face — the
 * D-e AMENDMENT, implementation-evidence-triggered, design 07 §2.4.1:
 * under own face chains the snap law plants each eye's center on a
 * pixel CORNER for every genome and frame — the worst possible
 * 4-way sample straddle for a 1.7-px focal part, structurally beyond
 * any rest-geometry repair — and the rendered visibility sweep found
 * zero-focal frames with HEALTHY field margins (seed 11 walk f3).
 * Riding the blob chain restores the spike's exact relative vote
 * geometry — the accepted S1b renders are the evidence — and the
 * eyes' oscillator IS the squash signal (restCy·squash), the blob's
 * own signal, so this is the levitant F16 rigid-face case, not the
 * wing/tendril independent-signal case. Face scramble is impossible
 * by construction (one chain, one offset). Death's face retract
 * survives as per-PART deltas inside the chain — the §2.4 deflate
 * exception already operates per part (per-ball weights).
 * Budget [7, 14]: the mandatory census is 7 (the spike's exact part
 * list); design 02 §3's "~8–14" band is tilde-loose and inventing an
 * 8th part would be banned speculation (recorded deviation, design 07
 * §1.1 amendment note). Ball slabs carry VISIBLE half-extents (F8) —
 * hitboxes, shadow, flicker energy, and craft see visible-radius
 * geometry with no plan special-case; only the fork converts.
 */
export const AMORPHOUS_PLAN: PlanSpec = Object.freeze({
  plan: "amorphous",
  budgetMin: 7,
  budgetMax: 14,
  core: blobChoice(),
});

/** Grow the amorphous part graph — `growPlan(AMORPHOUS_PLAN, genome)`. */
export function growAmorphous(genome: Genome): PartGraph {
  return growPlan(AMORPHOUS_PLAN, genome);
}

// AMORPHOUS_PART_NAMES / AMORPHOUS_CHAINS / AMORPHOUS_PART_ROLES live in
// wires.ts since U5 (byte-identical values; module-cycle rationale there).
