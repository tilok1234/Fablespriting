/**
 * Fablesprite — M1 production code (TypeScript).
 *
 * This file is a toolchain placeholder: the real M1 modules (genome locus
 * tree, named PRNG streams, fixed-point arithmetic, renderer) land per
 * `docs/design/06-m1-foundations.md`, which is being authored separately.
 */

/**
 * Growth-rule-table version (`docs/design/01-genome.md` §4).
 *
 * The version prefix of every DNA string selects a growth-rule table.
 * Additive changes (new loci with defaults) don't bump this; behavioral
 * changes do, and old tables are kept so that any DNA string pasted into
 * any future build renders pixel-identical.
 */
export const GENERATOR_VERSION = 1;
