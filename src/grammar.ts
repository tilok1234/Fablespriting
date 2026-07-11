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

import { fp_add, fp_div, fp_mul, fp_sqrt, fp_sub } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar, makeGenome } from "./genome.js";
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
 */
export interface PartChoice {
  readonly kind: PartKind;
  readonly exclusionGroup?: string;
  /** Instantiate member `member` of `count` (0-based; mirror: 0 = −x/L). */
  readonly make: (genome: Genome, member: number, count: number) => PartInit;
}

/**
 * A named attachment point (design 07 §1.1): `{name, allowed_kinds,
 * symmetry, clearance_fp}` plus this build's fill wiring. `clearanceFp`
 * is carried but inert until U5 lands clearance retries (design 07 §5).
 */
export interface SocketSpec {
  readonly name: string;
  readonly allowedKinds: readonly PartKind[];
  readonly symmetry: Symmetry;
  /** Sibling clearance radius (16.16 raw). Inert until U5. */
  readonly clearanceFp: number;
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

  function place(init: PartInit, kind: PartKind, symmetry: string): PartInit {
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
    return init;
  }

  function fillSockets(parent: PartInit): void {
    for (const socket of parent.sockets ?? []) {
      const count = symmetryMemberCount(socket.symmetry);
      // Budget closes first: a socket needing more members than remain
      // closes without drawing (design 07 §1.4).
      if (parts.length + count > spec.budgetMax) continue;
      // Pre-draw pruning (design 07 §1.1): allowed kinds, then exclusion
      // groups already holding a member — never draw-then-reject.
      const candidates = socket.candidates.filter(
        (c) =>
          socket.allowedKinds.includes(c.kind) &&
          (c.exclusionGroup === undefined || !usedExclusions.has(c.exclusionGroup)),
      );
      if (candidates.length === 0) continue; // socket closes, no draw
      let choice: PartChoice;
      if (candidates.length === 1) {
        choice = candidates[0]!; // deterministic fill — no draw spent
      } else {
        if (socket.drawPath === undefined) {
          throw new RangeError(
            `grammar: socket ${JSON.stringify(socket.name)} has ${candidates.length} candidates but no drawPath (design 07 §1.4 requires one)`,
          );
        }
        const stream = createStream(genome.seed, socket.drawPath, "fill");
        choice = candidates[stream.nextRange(candidates.length)]!;
        drawsConsumed += 1;
      }
      if (choice.exclusionGroup !== undefined) usedExclusions.add(choice.exclusionGroup);
      const group = socket.group ?? socket.name;
      const symmetry =
        socket.symmetry.kind === "single" ? "single" : `${socket.symmetry.kind}:${group}`;
      // All members place from this one choice, contiguously; children
      // expand depth-first per member afterwards (design 07 §1.4).
      const members: PartInit[] = [];
      for (let m = 0; m < count; m++) {
        members.push(place(choice.make(genome, m, count), choice.kind, symmetry));
      }
      for (const member of members) fillSockets(member);
    }
  }

  const core = place(spec.core.make(genome, 0, 1), spec.core.kind, "single");
  fillSockets(core);

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

/** Zero clearance: inert until U5 pins real clearance radii (design 07 §5). */
const NO_CLEARANCE = 0;

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

/** Grow the quadruped part graph — `growPlan(QUADRUPED_PLAN, genome)`. */
export function growQuadruped(genome: Genome): PartGraph {
  return growPlan(QUADRUPED_PLAN, genome);
}

// ---------------------------------------------------------------------------
// The grammar's structural output (design 07 §1.2: the frozen M1 wires
// PART_NAMES / CHAINS / PART_ROLES are now DERIVED from the grown graph)
// ---------------------------------------------------------------------------

/**
 * The quadruped's structure is genome-independent (no existence loci in
 * version 1; the fidelity law fixes the 13-part set), so the structural
 * wires derive once from the all-defaults growth.
 */
const STRUCTURE: PartGraph = growQuadruped(makeGenome());

/**
 * Part names in the pinned slab order — the design 06 §1.2 part table's
 * row order with mirror pairs and leg sockets expanded, now emitted by
 * the grammar's depth-first expansion. `poseQuadruped()[i]` is always the
 * part `PART_NAMES[i]`; the rasterizer's part-tag ids index this list.
 * Mirror pairs emit their −x (left) member first, matching the
 * FL-before-FR socket convention (FL is the −hip_x socket, §1.2 hips).
 */
export const PART_NAMES: readonly string[] = STRUCTURE.slabOrder;

/**
 * The quadruped skeleton chains (design 06 §1.5 pinned chain table):
 * pixel snapping is chain-GROUPED (constraint row 3, F14/F16 — per-slab
 * snapping reshaped the wolf's head), so all slabs of a chain receive
 * one snap offset per frame. Indices index {@link PART_NAMES}; each
 * chain's FIRST slab is its anchor (core, head, each leg, tail) — the
 * slab whose continuous projected screen center defines the chain's
 * screen position in craft.ts `snapOffsets`.
 */
export const CHAINS: readonly Chain[] = STRUCTURE.chains;

/** Material role of each pinned slab position (§1.2 part-table column). */
export const PART_ROLES: readonly MaterialRole[] = Object.freeze(
  STRUCTURE.parts.map((p) => p.materialRole),
);
