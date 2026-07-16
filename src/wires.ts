/**
 * Fablesprite — the grammar's structural output wires (design 07 §1.2:
 * the frozen M1 wires PART_NAMES / CHAINS / PART_ROLES, DERIVED from the
 * grown all-defaults graphs, no longer hardcoded).
 *
 * Moved out of grammar.ts at U5 (module-layout change only — every
 * exported value is byte-identical): U5's sampler-time self-check gives
 * genome.ts a runtime import path into pose/grammar
 * (genome → selfcheck → pose → grammar → genome), and ES-module cycle
 * evaluation requires that no module body in that cycle CALL across a
 * partially-evaluated module. grammar.ts's only such top-level calls
 * were these three all-defaults growths, so they live here — a leaf
 * module outside every cycle. All structural values are unchanged
 * because every U5 existence locus defaults ABSENT (06 §2 law): the
 * all-defaults growths still produce exactly the 13/11/7-node graphs.
 */

import { makeGenome } from "./genome.js";
import type { Chain, MaterialRole, PartGraph } from "./grammar.js";
import { growAmorphous, growLevitant, growQuadruped } from "./grammar.js";

/**
 * The quadruped's structure is genome-independent at defaults (every
 * existence locus defaults absent; the fidelity law fixes the 13-part
 * set), so the structural wires derive once from the all-defaults
 * growth.
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

/**
 * The levitant's structure is likewise genome-independent at defaults,
 * so its structural wires derive once from the all-defaults growth
 * (design 07 §2.3.1 node table).
 */
const LEVITANT_STRUCTURE: PartGraph = growLevitant(makeGenome());

/** Levitant part names in the pinned slab order (design 07 §2.3.1). */
export const LEVITANT_PART_NAMES: readonly string[] = LEVITANT_STRUCTURE.slabOrder;

/**
 * The levitant skeleton chains (design 07 §2.3.1 chain table): body =
 * {orb, sclera, iris, pupil, horn_l, horn_r} (slabs 0,1,2,3,6,7 —
 * non-contiguous membership is legal), wing_l {4}, wing_r {5},
 * tendril_0..2 {8},{9},{10}.
 */
export const LEVITANT_CHAINS: readonly Chain[] = LEVITANT_STRUCTURE.chains;

/** Material role of each levitant slab position (§2.3.1 node table). */
export const LEVITANT_PART_ROLES: readonly MaterialRole[] = Object.freeze(
  LEVITANT_STRUCTURE.parts.map((p) => p.materialRole),
);

/**
 * The amorphous structure is genome-independent at defaults (ball count
 * fixed at 4), so its structural wires derive once from the all-defaults
 * growth (design 07 §2.4.1 node table).
 */
const AMORPHOUS_STRUCTURE: PartGraph = growAmorphous(makeGenome({ values: [["meta.plan", 2]] }));

/** Amorphous part names in the pinned slab order (design 07 §2.4.1):
 * blob, crest, skirt, drip, eye_l, eye_r, highlight. */
export const AMORPHOUS_PART_NAMES: readonly string[] = AMORPHOUS_STRUCTURE.slabOrder;

/**
 * The amorphous skeleton chains (design 07 §2.4.1 chain table, as
 * amended at implementation): ONE blob chain {0, 1, 2, 3, 4, 5, 6} —
 * balls AND face parts ride the blob's snap offset (the shadow chain
 * seam therefore sees all seven slabs; the ball extents dominate its
 * x-span in the front/back views, and a floor-pushed eye may
 * legitimately widen it in profile — the levitant eye-stack
 * precedent, derived, no special case).
 */
export const AMORPHOUS_CHAINS: readonly Chain[] = AMORPHOUS_STRUCTURE.chains;

/** Material role of each amorphous slab position (§2.4.1 node table). */
export const AMORPHOUS_PART_ROLES: readonly MaterialRole[] = Object.freeze(
  AMORPHOUS_STRUCTURE.parts.map((p) => p.materialRole),
);
