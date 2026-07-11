/**
 * Fablesprite — M1 production code (TypeScript).
 *
 * Modules land per `docs/design/06-m1-foundations.md`: the fixed-point
 * kernel (§5), named PRNG streams (§4), the genome layer — locus
 * registry, varint tape codec, sampler (§§1–4) — and the quadruped
 * pose/geometry layer (§1.2 wolf template, oscillators, derived anchors),
 * the projection/rasterization layer (§1.2 pinned rasterization block,
 * design 04 §§2–3), the craft pass + chain snapping (§1.5, design 04
 * §4), the palette layer (§1.3 ramps + application, design 04 §5), the
 * §6 PNG encoder, and the §6 export layer (frame set, sheet, canonical
 * JSON, goldens) are all in.
 */

export * from "./fixed.js";
export * from "./prng.js";
export * from "./genome.js";
export * from "./pose.js";
export * from "./raster.js";
export * from "./craft.js";
export * from "./palette.js";
export * from "./png.js";
export * from "./export.js";
export * from "./flicker.js";

/**
 * Growth-rule-table version (`docs/design/01-genome.md` §4).
 *
 * The version prefix of every DNA string selects a growth-rule table.
 * Additive changes (new loci with defaults) don't bump this; behavioral
 * changes do, and old tables are kept so that any DNA string pasted into
 * any future build renders pixel-identical.
 */
export const GENERATOR_VERSION = 1;
