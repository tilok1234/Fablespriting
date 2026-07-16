/**
 * Fablesprite — M1 production code (TypeScript).
 *
 * Modules land per `docs/design/06-m1-foundations.md` and
 * `docs/design/07-m2-grammar.md`: the fixed-point kernel (06 §5), named
 * PRNG streams (06 §4), the genome layer — locus registry, varint tape
 * codec, sampler (06 §§1–4) — the grammar core (07 §1: PartGraph,
 * budgeted expansion, the quadruped plan), the quadruped gait template
 * (06 §1.2 oscillators consuming the grown graph), the
 * projection/rasterization layer (06 §1.2 pinned rasterization block,
 * design 04 §§2–3), the craft pass + chain snapping (06 §1.5, design 04
 * §4), the palette layer (06 §1.3 ramps + application, design 04 §5),
 * the 06 §6 PNG encoder, and the 06 §6 export layer (frame set, sheet,
 * canonical JSON, goldens) are all in.
 */

export * from "./fixed.js";
export * from "./prng.js";
export * from "./genome.js";
export * from "./grammar.js";
export * from "./wires.js";
export * from "./selfcheck.js";
export * from "./pose.js";
export * from "./raster.js";
export * from "./craft.js";
export * from "./palette.js";
export * from "./png.js";
export * from "./export.js";
export * from "./flicker.js";

/**
 * Generator version (`docs/design/01-genome.md` §4; design 07 §4.3).
 *
 * Version 2 lands with U2, the first output-changing unit of M2: the
 * export gains the attack/hurt/death clips (72 frames, 128×640 sheet).
 * GENOME version stays 1 — every M2 registry change is an append with an
 * absent-meaning default, so every issued v1 DNA string decodes
 * unchanged, and the design 07 §4.3 anchor law pins the v1 SUBSET of the
 * v2 output byte-identical: sheet rows y ∈ [0, 256) equal the v1 sheet,
 * and frames[0..31] / clips.walk / clips.idle / palette /
 * hitboxes[0..31] are value-equal to v1's (CI anchor fixtures in
 * tests/goldens/*.v1.*).
 */
export const GENERATOR_VERSION = 2;
