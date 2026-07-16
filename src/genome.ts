/**
 * Fablesprite — the genome layer (design 06 §§1–4): the version-1 locus
 * registry (§1.1), the canonical varint tape codec (§3), and the pinned
 * random-genome sampler (§4.2).
 *
 * Everything on the wire is byte-pinned: LEB128 uvarints (minimal length
 * mandatory), scalar payloads as zigzagged deltas from the registry
 * default, strictly ascending ids, defaults absent, a version prefix, and
 * base64url (RFC 4648 §5, no padding). There is exactly one encoding of
 * any genome (§3.3); the decoder rejects everything non-canonical rather
 * than silently normalizing, distinguishing {@link MalformedGenomeError}
 * (broken or non-canonical bytes) from {@link UpgradeRequiredError} (a
 * version prefix, locus id, or enum member beyond this build's registry —
 * a *newer* build could decode it; this one must refuse rather than
 * misrender).
 */

import { createStream } from "./prng.js";

/**
 * The tape's version prefix for this build's registry table
 * (design 06 §3.2, `tape := uvarint(version) entry*`). Additive registry
 * appends never bump it; behavioral changes do and freeze the old table
 * (design 01 §4 promise, restated in design 06 §3.3).
 */
export const GENOME_VERSION = 1;

/** 2^64 — exclusive upper bound of the u64 `meta.seed` domain (§1.1). */
const TWO64 = 1n << 64n;

/**
 * Enum member names of locus 0 `meta.plan` (design 06 §1.1 as extended by
 * design 07 §2.1 at U3 and §2.4.1 at U4):
 * { quadruped = 0, levitant = 1, amorphous = 2 }. Each member appended
 * only in the unit that made it growable (a decodable-but-ungrowable
 * enum member would be a landmine); old builds decoding a newer plan id
 * raise UpgradeRequired, the correct 06 §3.3 behavior.
 */
export const PLAN_NAMES = Object.freeze(["quadruped", "levitant", "amorphous"] as const);

/**
 * Enum member names of locus 2 `meta.trait_tags` (design 06 §1.1):
 * { chitin = 0, fleshy = 1, spectral = 2, mechanical = 3, verdant = 4 }.
 */
export const TRAIT_TAG_NAMES = Object.freeze([
  "chitin",
  "fleshy",
  "spectral",
  "mechanical",
  "verdant",
] as const);

/**
 * A scalar locus (fp, int, or enum — the §3.2 payload class that encodes
 * `uvarint(zz(value_raw − default_raw))`). Domain bounds are inclusive in
 * RAW units (design 06 §0): `fp` bounds are 16.16 raws, `int`/`enum`
 * bounds are plain integers. Enum loci always have lo = 0 and
 * hi = cardinality − 1; a decoded enum value above hi is a member beyond
 * this registry (UpgradeRequired), not a malformed value.
 */
export interface ScalarLocus {
  readonly id: number;
  /** Canonical spelling — the exact byte string hashed for streams (§2). */
  readonly path: string;
  readonly kind: "fp" | "int" | "enum";
  /** Inclusive raw lower bound. */
  readonly lo: number;
  /** Inclusive raw upper bound. */
  readonly hi: number;
  /** Registry default (raw) — serializes as absent (§3.2). */
  readonly defaultRaw: number;
}

/** Locus 1 `meta.seed`: u64 [0, 2^64), default 0 (design 06 §1.1). */
export interface SeedLocus {
  readonly id: 1;
  readonly path: "meta.seed";
  readonly kind: "u64";
}

/**
 * Locus 2 `meta.trait_tags`: a set of 0–2 tags drawn from the
 * {@link TRAIT_TAG_NAMES} enum, default empty (design 06 §1.1). Wire
 * payload: `uvarint(count)` then `count` strictly-ascending
 * `uvarint(tag)` (§3.2).
 */
export interface TagSetLocus {
  readonly id: 2;
  readonly path: "meta.trait_tags";
  readonly kind: "tagset";
  /** Enum cardinality of a single tag (5 in version 1). */
  readonly tagCard: number;
  /** Domain bound on the set size (2 in version 1). */
  readonly maxTags: number;
}

export type Locus = ScalarLocus | SeedLocus | TagSetLocus;

function s(
  id: number,
  path: string,
  kind: "fp" | "int" | "enum",
  lo: number,
  hi: number,
  defaultRaw: number,
): ScalarLocus {
  return Object.freeze({ id, path, kind, lo, hi, defaultRaw });
}

/**
 * The canonical version-1 locus registry of design 06 §1.1 as extended by
 * design 07 §4 (U2 appends id 35), design 07 §2.3.1 (U3 appends the
 * levitant loci, ids 36–46), and design 07 §2.4.1 (U4 appends the
 * amorphous loci, ids 47–50), transcribed exactly: ids 0–50,
 * append-only per version-table, never renumbered, never reused.
 * `REGISTRY[i].id === i` for every entry. All fp bounds and defaults are
 * the spec's pinned raws (`RHE(d · 2^16)` of the authored decimals); the
 * half-open [0, 360) hue domain carries the largest raw inside it,
 * 23592959, per the §0 pinned rule. Appends carry absent-meaning defaults
 * (06 §3 wire law), so every issued v1 DNA string decodes unchanged.
 */
export const REGISTRY: readonly Locus[] = Object.freeze([
  s(0, "meta.plan", "enum", 0, 2, 0), // {quadruped = 0, levitant = 1, amorphous = 2} — U3/U4 (design 07 §2.1)
  Object.freeze({ id: 1, path: "meta.seed", kind: "u64" } as const),
  Object.freeze({
    id: 2,
    path: "meta.trait_tags",
    kind: "tagset",
    tagCard: 5,
    maxTags: 2,
  } as const),
  s(3, "palette.base_hue", "fp", 0, 23592959, 851968), // 13.0° of [0, 360)
  s(4, "palette.hue_shift", "fp", -2949120, 2949120, 1179648), // 18.0° of [−45, 45]
  s(5, "palette.contrast", "fp", 6554, 22938, 14090), // 0.215 of [0.10, 0.35]
  s(6, "palette.ramp_len", "int", 3, 5, 4),
  s(7, "anim.quadruped.gait_freq", "int", 1, 2, 1),
  s(8, "anim.quadruped.bob_amp", "fp", 0, 131072, 32768), // 0.5 px of [0, 2]
  s(9, "anim.quadruped.leg_swing_amp", "fp", 0, 262144, 137626), // 2.1 px of [0, 4]
  s(10, "anim.quadruped.leg_lift_amp", "fp", 0, 262144, 98304), // 1.5 px of [0, 4]
  s(11, "anim.quadruped.tail_lag", "fp", 0, 32768, 9387), // 0.1432394 turns of [0, 0.5]
  s(12, "anim.quadruped.tail_amp", "fp", 0, 262144, 91750), // 1.4 px of [0, 4]
  s(13, "body.core.length", "fp", 262144, 786432, 498074), // 7.6 px of [4, 12]
  s(14, "body.core.girth", "fp", 131072, 393216, 255590), // 3.9 px of [2, 6]
  s(15, "body.core.depth", "fp", 131072, 393216, 222822), // 3.4 px of [2, 6]
  s(16, "body.head.scale", "fp", 39322, 104858, 65536), // 1.0 of [0.6, 1.6]
  s(17, "body.head.snout_len", "fp", 65536, 262144, 144179), // 2.2 px of [1, 4]
  s(18, "body.head.ear_size", "fp", 32768, 117965, 65536), // 1.0 of [0.5, 1.8]
  s(19, "body.head.eye_size", "fp", 39322, 98304, 65536), // 1.0 of [0.6, 1.5]
  s(20, "body.head.eye_offset", "fp", 65536, 157286, 104858), // 1.6 px of [1.0, 2.4]
  s(21, "body.leg[FL].length", "fp", 157286, 327680, 203162), // 3.1 px of [2.4, 5] (§1.2 narrowing)
  s(22, "body.leg[FL].girth", "fp", 52429, 131072, 75366), // 1.15 px of [0.8, 2]
  s(23, "body.leg[FL].phase_group", "enum", 0, 1, 0),
  s(24, "body.leg[FR].length", "fp", 157286, 327680, 203162),
  s(25, "body.leg[FR].girth", "fp", 52429, 131072, 75366),
  s(26, "body.leg[FR].phase_group", "enum", 0, 1, 1),
  s(27, "body.leg[BL].length", "fp", 157286, 327680, 203162),
  s(28, "body.leg[BL].girth", "fp", 52429, 131072, 75366),
  s(29, "body.leg[BL].phase_group", "enum", 0, 1, 1),
  s(30, "body.leg[BR].length", "fp", 157286, 327680, 203162),
  s(31, "body.leg[BR].girth", "fp", 52429, 131072, 75366),
  s(32, "body.leg[BR].phase_group", "enum", 0, 1, 0),
  s(33, "body.tail.length", "fp", 98304, 393216, 209715), // 3.2 px of [1.5, 6]
  s(34, "body.tail.girth", "fp", 39322, 131072, 72090), // 1.1 px of [0.6, 2]
  s(35, "anim.quadruped.anticipation", "fp", 32768, 131072, 65536), // 1.0 of [0.5, 2] — U2 (design 07 §4)
  // U3 appends (design 07 §2.3.1): the levitant plan, defaults from S1's
  // watcher (spike01 watcher()) — every decimal is RHE(d·2^16), every
  // raw machine-verified before pinning. Lags/phases in TURNS (the
  // tail_lag precedent: 0.7 rad = 0.11140846 turns → 7301).
  s(36, "anim.levitant.hover_freq", "int", 1, 2, 1), // gait base phase θ = h·φ; h = 2 freezes hover+flap at K=4 (recorded degeneracy, gait_freq-2 precedent)
  s(37, "anim.levitant.hover_amp", "fp", 0, 131072, 85197), // 1.3 px of [0, 2] — watcher 1.3·sin(φ)
  s(38, "anim.levitant.flap_ratio", "int", 1, 3, 3), // wing flap phase r·h·φ — watcher sin(3φ); r = 2 frozen at K=4 (recorded)
  s(39, "anim.levitant.tendril_lag", "fp", 0, 8192, 7301), // 0.7 rad = 0.11140846 turns of [0, 0.125]
  s(40, "anim.levitant.tendril_amp", "fp", 0, 131072, 98304), // 1.5 px of [0, 2] — tendril x-swing base
  s(41, "anim.levitant.anticipation", "fp", 32768, 131072, 65536), // 1.0 of [0.5, 2] — attack f0 scale (id-35 analog)
  s(42, "body.core.altitude", "fp", 753664, 851968, 786432), // 12.0 px of [11.5, 13] — rest orb center z0
  s(43, "body.sensor[C].scale", "fp", 39322, 98304, 65536), // 1.0 of [0.6, 1.5] — eye-stack scale (eye_size precedent)
  s(44, "body.core.locomotor_size", "fp", 32768, 117965, 65536), // 1.0 of [0.5, 1.8] — wing size (ear_size precedent)
  s(45, "body.core.tendril_girth", "fp", 45875, 91750, 58982), // 0.9 px of [0.7, 1.4] — tendril x/y halves, taper −i·9830
  s(46, "body.core.tendril_len", "fp", 52429, 98304, 85197), // 1.3 px of [0.8, 1.5] — tendril z half; spacing derives
  // U4 appends (design 07 §2.4.1): the amorphous plan, defaults from
  // S1b's slime (spike01b slime()) — every decimal is RHE(d·2^16), every
  // raw machine-verified before pinning. Lags/phases in TURNS (the U3
  // 0.7-rad precedent: 1.3 rad = 0.20690143 turns → 13559).
  s(47, "anim.amorphous.pulse_freq", "int", 1, 2, 1), // gait base phase θ = p·φ (slime sin(φ)); p = 2 freezes hop AND squash at K = 4 (recorded degeneracy, gait_freq-2 precedent; crest/drip stay alive via lag)
  s(48, "anim.amorphous.squash_amp", "fp", 0, 13107, 9830), // 0.15 ratio of [0, 0.2] — walk squash = 1 − a·sin(θ); hi sweep-narrowed from a 0.25 sketch (eye burial, drip detach at 0.25)
  s(49, "anim.amorphous.ball_phase_delta", "fp", 0, 16384, 13559), // 1.3 rad = 0.20690143 turns of [0, 0.25] — soft-body lag λ; drip lag = λ + DRIP_EXTRA (6259, the adjudicated difference pin)
  s(50, "anim.amorphous.anticipation", "fp", 32768, 131072, 65536), // 1.0 of [0.5, 2] — attack f0 scale (id-35/41 analog)
]);

/**
 * Plan-scope column of the registry (design 07 §2.3.1, U3) — registry
 * METADATA, not wire data: which loci each plan's pinned sampler draws.
 * `shared` loci (meta, palette, and the body.core dims — the design 01 §3
 * cross-plan homology carriers) are drawn for every plan; each plan adds
 * its own set. Every registry id belongs to exactly one scope
 * (CI-asserted). Unconsumed loci on any genome stay wire-legal and inert.
 */
export const LOCUS_SCOPES: Readonly<
  Record<"shared" | "quadruped" | "levitant" | "amorphous", ReadonlySet<number>>
> = Object.freeze({
  shared: Object.freeze(new Set([0, 1, 2, 3, 4, 5, 6, 13, 14, 15])),
  quadruped: Object.freeze(
    new Set([7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]),
  ),
  levitant: Object.freeze(new Set([36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46])),
  amorphous: Object.freeze(new Set([47, 48, 49, 50])),
});

/**
 * One cross-plan `anim` leaf correspondence (design 06 §1.1's pinned
 * mechanism, shipped at U3 per design 07 §2.5; grown three-column at
 * U4 per §2.4.1). Paths are canonical registry spellings; a missing
 * plan column means "unmapped for that plan" (the design 01 §3
 * "present in one parent only" case). Referential integrity is
 * CI-tested. No crossover code consumes this table until M5.
 */
export interface AnimSemanticEntry {
  readonly quadruped: string;
  readonly levitant: string;
  readonly amorphous?: string;
}

/**
 * The anim semantic map (design 07 §2.5 as realized at U3/U4):
 * quadruped ↔ levitant ↔ amorphous leaf correspondences for `anim.*`
 * only — body paths align by raw path identity (design 01 §3) and need
 * no map. All four amorphous loci are mapped. Unmapped, recorded:
 * quadruped leg_swing_amp + leg_lift_amp; levitant flap_ratio; the
 * tail_amp ↔ tendril_amp row has no amorphous member. bob_amp ↔
 * squash_amp is a px-ratio unit mismatch mapped on semantics ("primary
 * body oscillation amplitude") — the map is correspondence data, not a
 * converter; M5's crossover resolves units.
 */
export const ANIM_SEMANTIC_MAP: readonly AnimSemanticEntry[] = Object.freeze([
  Object.freeze({
    quadruped: "anim.quadruped.gait_freq",
    levitant: "anim.levitant.hover_freq",
    amorphous: "anim.amorphous.pulse_freq",
  }),
  Object.freeze({
    quadruped: "anim.quadruped.bob_amp",
    levitant: "anim.levitant.hover_amp",
    amorphous: "anim.amorphous.squash_amp",
  }),
  Object.freeze({
    quadruped: "anim.quadruped.tail_lag",
    levitant: "anim.levitant.tendril_lag",
    amorphous: "anim.amorphous.ball_phase_delta",
  }),
  Object.freeze({ quadruped: "anim.quadruped.tail_amp", levitant: "anim.levitant.tendril_amp" }),
  Object.freeze({
    quadruped: "anim.quadruped.anticipation",
    levitant: "anim.levitant.anticipation",
    amorphous: "anim.amorphous.anticipation",
  }),
]);

const BY_PATH: ReadonlyMap<string, Locus> = new Map(
  REGISTRY.map((locus) => [locus.path, locus]),
);

/**
 * Registry lookup by canonical id. Returns undefined for ids outside this
 * build's version-1 table (the codec maps that to UpgradeRequired; direct
 * callers decide their own policy).
 */
export function locusById(id: number): Locus | undefined {
  return Number.isInteger(id) && id >= 0 && id < REGISTRY.length
    ? REGISTRY[id]
    : undefined;
}

/**
 * Registry lookup by canonical path spelling (§2: no aliases, no
 * normalization — the exact registry byte string or nothing).
 */
export function locusByPath(path: string): Locus | undefined {
  return BY_PATH.get(path);
}

function resolveLocus(ref: number | string): Locus {
  const locus = typeof ref === "number" ? locusById(ref) : locusByPath(ref);
  if (locus === undefined) {
    throw new MalformedGenomeError(
      `genome: unknown locus ${JSON.stringify(ref)} in the version-${GENOME_VERSION} registry`,
    );
  }
  return locus;
}

/**
 * Base class of the two codec error kinds pinned by design 06 §3.3.
 * Every decode/validation failure is one of the two concrete subclasses;
 * nothing is ever silently normalized.
 */
export abstract class GenomeCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Non-canonical or broken input (design 06 §3.3): a non-minimal uvarint,
 * non-ascending ids, an explicit default-valued entry (scalar payload 0,
 * seed 0, empty tag set), a non-ascending tag set, an out-of-domain
 * value, a truncated entry, trailing bytes, or bad base64url. No build,
 * past or future, accepts these bytes.
 */
export class MalformedGenomeError extends GenomeCodecError {}

/**
 * Input beyond this build's registry (design 06 §3.3): an unknown version
 * prefix, a locus id past the version-table, or an enum member past its
 * registered cardinality. A newer build could decode it; this build
 * refuses rather than misrender.
 */
export class UpgradeRequiredError extends GenomeCodecError {}

/**
 * A genome: the version, the u64 seed, the trait-tag set, and the
 * explicit non-default scalar raws. Canonical by construction
 * ({@link makeGenome}): `traitTags` is strictly ascending and `values`
 * holds only non-default in-domain raws, keyed by locus id in ascending
 * iteration order. Absent loci read as their registry defaults via
 * {@link getScalar}.
 */
export interface Genome {
  /** Tape version prefix; {@link GENOME_VERSION} for genomes of this build. */
  readonly version: number;
  /** Locus 1 `meta.seed` (u64 as bigint); 0n is the default. */
  readonly seed: bigint;
  /** Locus 2 `meta.trait_tags`: strictly ascending tag ids, 0–2 entries. */
  readonly traitTags: readonly number[];
  /** Explicit non-default scalar raws by locus id, ascending-id order. */
  readonly values: ReadonlyMap<number, number>;
}

/** Construction input for {@link makeGenome}; every field is optional. */
export interface GenomeInit {
  readonly seed?: bigint;
  readonly traitTags?: readonly number[];
  /** Scalar raws keyed by locus id or canonical path. */
  readonly values?: Iterable<readonly [number | string, number]>;
}

function validateScalarRaw(locus: ScalarLocus, value: number): void {
  if (!Number.isInteger(value)) {
    throw new MalformedGenomeError(
      `genome: ${locus.path} raw must be an integer, got ${value}`,
    );
  }
  if (value < locus.lo || value > locus.hi) {
    throw new MalformedGenomeError(
      `genome: ${locus.path} raw ${value} outside domain [${locus.lo}, ${locus.hi}]`,
    );
  }
}

/**
 * Build a canonical {@link Genome}, enforcing every locus domain
 * (design 06 §§0–1): the seed must lie in [0, 2^64), tags must be known,
 * distinct, and at most {@link TagSetLocus.maxTags}; scalar raws must be
 * integers inside their inclusive raw domains. Values equal to the
 * registry default are dropped (defaults are representation-absent,
 * mirroring §3.2's wire rule), tags are sorted ascending, and the values
 * map is rebuilt in ascending-id order — so structurally equal genomes
 * are deep-equal objects.
 */
export function makeGenome(init: GenomeInit = {}): Genome {
  const seed = init.seed ?? 0n;
  if (typeof seed !== "bigint" || seed < 0n || seed >= TWO64) {
    throw new MalformedGenomeError(
      `genome: meta.seed ${seed} outside the u64 domain [0, 2^64)`,
    );
  }

  const tagLocus = REGISTRY[2] as TagSetLocus;
  const rawTags = init.traitTags ?? [];
  if (rawTags.length > tagLocus.maxTags) {
    throw new MalformedGenomeError(
      `genome: meta.trait_tags holds ${rawTags.length} tags, domain allows at most ${tagLocus.maxTags}`,
    );
  }
  const seen = new Set<number>();
  for (const tag of rawTags) {
    if (!Number.isInteger(tag) || tag < 0 || tag >= tagLocus.tagCard) {
      throw new MalformedGenomeError(
        `genome: unknown trait tag ${tag} (version-${GENOME_VERSION} tags are 0..${tagLocus.tagCard - 1})`,
      );
    }
    if (seen.has(tag)) {
      throw new MalformedGenomeError(`genome: duplicate trait tag ${tag}`);
    }
    seen.add(tag);
  }
  const traitTags: readonly number[] = Object.freeze(
    [...rawTags].sort((a, b) => a - b),
  );

  const staged = new Map<number, number>();
  for (const [ref, value] of init.values ?? []) {
    const locus = resolveLocus(ref);
    if (locus.kind === "u64" || locus.kind === "tagset") {
      throw new MalformedGenomeError(
        `genome: ${locus.path} is not a scalar locus — use the seed/traitTags fields`,
      );
    }
    if (staged.has(locus.id)) {
      throw new MalformedGenomeError(
        `genome: duplicate value for locus ${locus.id} (${locus.path})`,
      );
    }
    validateScalarRaw(locus, value);
    staged.set(locus.id, value);
  }
  const values = new Map<number, number>();
  for (const id of [...staged.keys()].sort((a, b) => a - b)) {
    const value = staged.get(id)!;
    if (value !== (REGISTRY[id] as ScalarLocus).defaultRaw) {
      values.set(id, value);
    }
  }

  return Object.freeze({ version: GENOME_VERSION, seed, traitTags, values });
}

/**
 * Read a scalar locus raw with fallback to the registry default — the
 * access rule of §3.2's "defaults absent" turned around: an absent locus
 * *is* its default. Throws RangeError for a non-scalar locus
 * (`meta.seed`/`meta.trait_tags` live on the genome's own fields) or an
 * unknown reference.
 */
export function getScalar(genome: Genome, ref: number | string): number {
  const locus = typeof ref === "number" ? locusById(ref) : locusByPath(ref);
  if (locus === undefined) {
    throw new RangeError(
      `genome: unknown locus ${JSON.stringify(ref)} in the version-${GENOME_VERSION} registry`,
    );
  }
  if (locus.kind === "u64" || locus.kind === "tagset") {
    throw new RangeError(
      `genome: ${locus.path} is not a scalar locus — read genome.seed / genome.traitTags`,
    );
  }
  return genome.values.get(locus.id) ?? locus.defaultRaw;
}

// ---------------------------------------------------------------------------
// §3.1 primitives: uvarint (LEB128, minimal), zigzag64, base64url (no pad)
// ---------------------------------------------------------------------------

/** Append the minimal LEB128 encoding of v (a u64) — design 06 §3.1. */
function pushUvarint(out: number[], value: bigint): void {
  let v = value;
  for (;;) {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    if (v === 0n) {
      out.push(b);
      return;
    }
    out.push(b | 0x80);
  }
}

interface ByteCursor {
  pos: number;
}

/**
 * Read one uvarint (design 06 §3.1). Rejects, as Malformed: truncation,
 * a redundant trailing 0x00 group (minimal length is mandatory), and any
 * encoding exceeding 64 bits (more than 10 bytes, or a 10th byte pushing
 * the value past 2^64).
 */
function readUvarint(bytes: Uint8Array, cursor: ByteCursor): bigint {
  let result = 0n;
  let shift = 0n;
  const start = cursor.pos;
  for (;;) {
    if (cursor.pos >= bytes.length) {
      throw new MalformedGenomeError(
        `genome: truncated uvarint at byte ${start}`,
      );
    }
    const b = bytes[cursor.pos]!;
    cursor.pos += 1;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      if (b === 0 && cursor.pos - start > 1) {
        throw new MalformedGenomeError(
          `genome: non-minimal uvarint at byte ${start} (redundant trailing 0x00 group)`,
        );
      }
      if (result >= TWO64) {
        throw new MalformedGenomeError(
          `genome: uvarint at byte ${start} exceeds 64 bits`,
        );
      }
      return result;
    }
    shift += 7n;
    if (shift > 63n) {
      throw new MalformedGenomeError(
        `genome: uvarint at byte ${start} exceeds 64 bits (more than 10 bytes)`,
      );
    }
  }
}

/** zigzag64 (design 06 §3.1): zz(0)=0, zz(−1)=1, zz(1)=2, zz(−2)=3. */
function zigzag(delta: bigint): bigint {
  return delta >= 0n ? delta << 1n : (-delta << 1n) - 1n;
}

/** Inverse of {@link zigzag}. */
function unzigzag(zz: bigint): bigint {
  return (zz & 1n) === 0n ? zz >> 1n : -((zz + 1n) >> 1n);
}

/** RFC 4648 §5 alphabet (design 06 §3.1). */
const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const B64_INDEX: ReadonlyMap<string, number> = new Map(
  [...B64_ALPHABET].map((c, i) => [c, i]),
);

function bytesToBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    out += B64_ALPHABET[b0 >> 2]!;
    if (i + 1 >= bytes.length) {
      out += B64_ALPHABET[(b0 & 0x03) << 4]!;
      break;
    }
    const b1 = bytes[i + 1]!;
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]!;
    if (i + 2 >= bytes.length) {
      out += B64_ALPHABET[(b1 & 0x0f) << 2]!;
      break;
    }
    const b2 = bytes[i + 2]!;
    out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]!;
    out += B64_ALPHABET[b2 & 0x3f]!;
  }
  return out;
}

/**
 * Strict no-pad base64url decode. Rejects, as Malformed: characters
 * outside the RFC 4648 §5 alphabet (including `=` padding), an impossible
 * length (≡ 1 mod 4), and non-zero leftover bits — every byte string must
 * have exactly one accepted spelling, or `encode(decode(b)) == b` (§3.3)
 * would not hold at the string level.
 */
function base64urlToBytes(text: string): Uint8Array {
  if (text.length % 4 === 1) {
    throw new MalformedGenomeError(
      `genome: bad base64url — impossible length ${text.length}`,
    );
  }
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let j = 0;
  for (const ch of text) {
    const v = B64_INDEX.get(ch);
    if (v === undefined) {
      throw new MalformedGenomeError(
        `genome: bad base64url — invalid character ${JSON.stringify(ch)}`,
      );
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j] = (acc >> bits) & 0xff;
      j += 1;
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    throw new MalformedGenomeError(
      "genome: bad base64url — non-zero leftover bits (non-canonical spelling)",
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3.2–§3.3: the tape codec
// ---------------------------------------------------------------------------

/**
 * Encode a genome to its unique canonical tape (design 06 §3.2), returned
 * as no-pad base64url. The input is re-canonicalized through
 * {@link makeGenome} first, so a hand-built object with explicit default
 * values still produces the canonical bytes. Entries are emitted in
 * strictly ascending id order; scalar payloads are
 * `uvarint(zz(value_raw − default_raw))`; defaults are absent.
 */
export function encodeGenome(genome: Genome): string {
  if (genome.version !== GENOME_VERSION) {
    throw new UpgradeRequiredError(
      `genome: cannot encode version ${genome.version} — this build knows only version ${GENOME_VERSION}`,
    );
  }
  const g = makeGenome({
    seed: genome.seed,
    traitTags: genome.traitTags,
    values: genome.values,
  });

  const out: number[] = [];
  pushUvarint(out, BigInt(GENOME_VERSION));
  // Strictly-ascending id order (§3.2): a non-default meta.plan (id 0)
  // must emit BEFORE the seed and tag entries. U2's emitter assumed id 0
  // could never be non-default (a single-member enum); U3's plan append
  // made that comment false — the id-0-first fix is design 07 §2.3.1's
  // pinned codec repair, CI-tested.
  const plan = g.values.get(0);
  if (plan !== undefined) {
    pushUvarint(out, 0n);
    pushUvarint(out, zigzag(BigInt(plan) - BigInt((REGISTRY[0] as ScalarLocus).defaultRaw)));
  }
  if (g.seed !== 0n) {
    pushUvarint(out, 1n);
    pushUvarint(out, g.seed);
  }
  if (g.traitTags.length > 0) {
    pushUvarint(out, 2n);
    pushUvarint(out, BigInt(g.traitTags.length));
    for (const tag of g.traitTags) pushUvarint(out, BigInt(tag));
  }
  // g.values iterates in ascending id order (makeGenome invariant); every
  // remaining scalar id is ≥ 3, so the whole tape is strictly ascending.
  for (const [id, value] of g.values) {
    if (id === 0) continue; // already emitted first
    const locus = REGISTRY[id] as ScalarLocus;
    pushUvarint(out, BigInt(id));
    pushUvarint(out, zigzag(BigInt(value) - BigInt(locus.defaultRaw)));
  }
  return bytesToBase64url(Uint8Array.from(out));
}

/**
 * Decode a base64url tape to a {@link Genome}, enforcing every §3.3
 * reject rule — an error, never silent normalization:
 *
 * - {@link MalformedGenomeError}: bad base64url; a non-minimal uvarint;
 *   an id ≤ the previous id; a scalar payload of 0; a seed of 0; an empty
 *   or non-ascending tag set; a value outside its locus domain; a
 *   truncated entry; trailing bytes (any trailing garbage is a truncated
 *   or non-ascending entry — the tape has no other suffix).
 * - {@link UpgradeRequiredError}: a version prefix this build does not
 *   know; a locus id beyond the version-1 registry; an enum member (tag
 *   or scalar enum value) beyond its registered cardinality.
 *
 * Round-trip laws (§3.3, property-tested in CI): `decode(encode(g)) == g`
 * for every valid genome, and `encode(decode(b)) == b` for every byte
 * string that decodes at all.
 */
export function decodeGenome(text: string): Genome {
  const bytes = base64urlToBytes(text);
  const cursor: ByteCursor = { pos: 0 };

  const version = readUvarint(bytes, cursor);
  if (version !== BigInt(GENOME_VERSION)) {
    throw new UpgradeRequiredError(
      `genome: unknown version prefix ${version} — this build knows only version ${GENOME_VERSION}`,
    );
  }

  let seed = 0n;
  const tags: number[] = [];
  const values: Array<readonly [number, number]> = [];
  let prevId = -1n;

  while (cursor.pos < bytes.length) {
    const id = readUvarint(bytes, cursor);
    if (id <= prevId) {
      throw new MalformedGenomeError(
        `genome: locus ids not strictly ascending (${id} after ${prevId})`,
      );
    }
    prevId = id;
    if (id >= BigInt(REGISTRY.length)) {
      throw new UpgradeRequiredError(
        `genome: locus id ${id} beyond the version-${GENOME_VERSION} registry`,
      );
    }
    const locus = REGISTRY[Number(id)]!;

    if (locus.kind === "u64") {
      const v = readUvarint(bytes, cursor);
      if (v === 0n) {
        throw new MalformedGenomeError(
          "genome: explicit default — meta.seed 0 must be absent",
        );
      }
      seed = v;
    } else if (locus.kind === "tagset") {
      const count = readUvarint(bytes, cursor);
      if (count === 0n) {
        throw new MalformedGenomeError(
          "genome: explicit default — empty meta.trait_tags must be absent",
        );
      }
      if (count > BigInt(locus.maxTags)) {
        throw new MalformedGenomeError(
          `genome: meta.trait_tags count ${count} outside domain (at most ${locus.maxTags})`,
        );
      }
      let prevTag = -1n;
      for (let i = 0n; i < count; i++) {
        const tag = readUvarint(bytes, cursor);
        if (tag <= prevTag) {
          throw new MalformedGenomeError(
            `genome: meta.trait_tags not strictly ascending (${tag} after ${prevTag})`,
          );
        }
        prevTag = tag;
        if (tag >= BigInt(locus.tagCard)) {
          throw new UpgradeRequiredError(
            `genome: trait tag ${tag} beyond the version-${GENOME_VERSION} registry`,
          );
        }
        tags.push(Number(tag));
      }
    } else {
      const zz = readUvarint(bytes, cursor);
      if (zz === 0n) {
        throw new MalformedGenomeError(
          `genome: explicit default — zero delta for ${locus.path} must be absent`,
        );
      }
      const value = BigInt(locus.defaultRaw) + unzigzag(zz);
      if (value < BigInt(locus.lo)) {
        throw new MalformedGenomeError(
          `genome: ${locus.path} raw ${value} outside domain [${locus.lo}, ${locus.hi}]`,
        );
      }
      if (value > BigInt(locus.hi)) {
        if (locus.kind === "enum") {
          throw new UpgradeRequiredError(
            `genome: enum member ${value} of ${locus.path} beyond the version-${GENOME_VERSION} registry`,
          );
        }
        throw new MalformedGenomeError(
          `genome: ${locus.path} raw ${value} outside domain [${locus.lo}, ${locus.hi}]`,
        );
      }
      values.push([Number(id), Number(value)]);
    }
  }

  return makeGenome({ seed, traitTags: tags, values });
}

// ---------------------------------------------------------------------------
// §4.2: the pinned random-genome sampler
// ---------------------------------------------------------------------------

/**
 * The pinned M1 sampler (design 06 §4.2), plan-scoped since U3
 * (design 07 §2.3.1, resolving D-a; U4 adds plan 2 with scope
 * {47–50}): given a sheet seed s and a caller-chosen plan (default
 * quadruped — plan is a PARAMETER, it consumes NO draw; 06 §4.2 governs
 * draw *spending* and plan is not drawn at all in
 * U3/U4 — plan-MIX sampling defers to U6, which if it samples must use the
 * reserved `stream(seed, "meta.plan", "sample")`), the sampled genome has
 * `meta.seed = s`, `meta.plan = plan`, and draws exactly the SHARED loci
 * plus the requested plan's scope ({@link LOCUS_SCOPES}), each from its
 * own stream `stream(s, path, "sample")` (the §0 default draw name):
 *
 * - fp/int scalars: `nextFp(lo, hi)` over the inclusive raw domain;
 * - enums: `nextRange(cardinality)`;
 * - `meta.trait_tags`: `n = nextRange(2) + 1` (so n ∈ {1, 2}, never
 *   zero — sampled genomes always commit to a theme), then draws of
 *   `nextRange(5)` until the set holds n distinct tags, discarding
 *   duplicates and redrawing immediately, always over the full 5-tag
 *   enum. The set serializes ascending regardless of draw order.
 *
 * A sampled quadruped genome draws exactly ids 3..35 — the identical set
 * U2 drew — so its DNA string is byte-identical to U2's (what keeps the
 * seed-1132 v2 golden intact; CI-asserted against strings generated from
 * the committed U2 build). The committed M1-era qa/sheet_0_49.* artifacts
 * stay untouched pinned history (their DNA strings predate the U2 id-35
 * append).
 * Deterministic: the same (seed, plan) yields a byte-identical genome,
 * in any conforming implementation.
 */
export function sampleGenome(seed: bigint, plan = 0): Genome {
  if (typeof seed !== "bigint" || seed < 0n || seed >= TWO64) {
    throw new RangeError(`genome: sampler seed ${seed} outside u64 [0, 2^64)`);
  }
  if (plan !== 0 && plan !== 1 && plan !== 2) {
    throw new RangeError(
      `genome: sampler plan ${plan} outside the version-${GENOME_VERSION} enum {0, 1, 2}`,
    );
  }
  const planScope = LOCUS_SCOPES[PLAN_NAMES[plan] as "quadruped" | "levitant" | "amorphous"];

  const values: Array<readonly [number, number]> = [];
  if (plan !== 0) values.push([0, plan]);
  for (const locus of REGISTRY) {
    if (locus.kind === "u64" || locus.kind === "tagset") continue;
    if (locus.id === 0) continue; // meta.plan is the caller parameter — never drawn (D-a)
    if (!LOCUS_SCOPES.shared.has(locus.id) && !planScope.has(locus.id)) continue;
    const stream = createStream(seed, locus.path);
    const value =
      locus.kind === "enum"
        ? stream.nextRange(locus.hi - locus.lo + 1)
        : stream.nextFp(locus.lo, locus.hi);
    values.push([locus.id, value]);
  }

  const tagStream = createStream(seed, "meta.trait_tags");
  const n = tagStream.nextRange(2) + 1;
  const tags = new Set<number>();
  while (tags.size < n) {
    tags.add(tagStream.nextRange(5)); // re-adding an existing tag = the pinned discard-and-redraw
  }

  return makeGenome({ seed, traitTags: [...tags], values });
}
