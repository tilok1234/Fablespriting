/**
 * Fablesprite — M1 production code (TypeScript).
 *
 * Modules land per `docs/design/06-m1-foundations.md`: the fixed-point
 * kernel (§5), named PRNG streams (§4), and the genome layer — locus
 * registry, varint tape codec, sampler (§§1–4) — are in; the renderer
 * follows.
 */

export * from "./fixed.js";
export * from "./prng.js";
export * from "./genome.js";

/**
 * Growth-rule-table version (`docs/design/01-genome.md` §4).
 *
 * The version prefix of every DNA string selects a growth-rule table.
 * Additive changes (new loci with defaults) don't bump this; behavioral
 * changes do, and old tables are kept so that any DNA string pasted into
 * any future build renders pixel-identical.
 */
export const GENERATOR_VERSION = 1;
