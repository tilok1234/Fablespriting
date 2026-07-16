import { describe, expect, test } from "vitest";

import {
  GENOME_VERSION,
  GenomeCodecError,
  MalformedGenomeError,
  REGISTRY,
  TRAIT_TAG_NAMES,
  UpgradeRequiredError,
  decodeGenome,
  encodeGenome,
  getScalar,
  locusById,
  locusByPath,
  makeGenome,
  sampleGenome,
} from "../src/genome.js";
import type { Genome, ScalarLocus } from "../src/genome.js";
import { createStream } from "../src/prng.js";

/** Base64url (no pad) of a hex byte string — test-side tape builder. */
function b64u(hex: string): string {
  return Buffer.from(hex.replace(/\s+/g, ""), "hex").toString("base64url");
}

const SCALARS = REGISTRY.filter((l): l is ScalarLocus => l.kind !== "u64" && l.kind !== "tagset");

/** Cheap structural equality so the 10k-genome property loop stays fast. */
function genomesEqual(a: Genome, b: Genome): boolean {
  if (a.version !== b.version || a.seed !== b.seed) return false;
  if (a.traitTags.length !== b.traitTags.length) return false;
  for (let i = 0; i < a.traitTags.length; i++) {
    if (a.traitTags[i] !== b.traitTags[i]) return false;
  }
  if (a.values.size !== b.values.size) return false;
  for (const [id, v] of a.values) {
    if (b.values.get(id) !== v) return false;
  }
  return true;
}

describe("design 06 §1.1 registry", () => {
  test("56 loci, ids 0–55 (U3 appends 36–46, U4 appends 47–50, U5 appends 51–55), REGISTRY[i].id === i", () => {
    expect(REGISTRY.length).toBe(56);
    for (let i = 0; i < REGISTRY.length; i++) expect(REGISTRY[i]!.id).toBe(i);
  });

  test("byId/byPath agree and cover every locus", () => {
    for (const locus of REGISTRY) {
      expect(locusById(locus.id)).toBe(locus);
      expect(locusByPath(locus.path)).toBe(locus);
    }
    expect(locusById(56)).toBeUndefined();
    expect(locusById(-1)).toBeUndefined();
    expect(locusByPath("body.leg[fl].length")).toBeUndefined(); // no normalization (§2)
  });

  test("spot checks against the spec table raws", () => {
    const hue = locusByPath("palette.base_hue") as ScalarLocus;
    expect([hue.id, hue.lo, hue.hi, hue.defaultRaw]).toEqual([3, 0, 23592959, 851968]);
    const lag = locusByPath("anim.quadruped.tail_lag") as ScalarLocus;
    expect([lag.id, lag.lo, lag.hi, lag.defaultRaw]).toEqual([11, 0, 32768, 9387]);
    const contrast = locusByPath("palette.contrast") as ScalarLocus;
    expect([contrast.lo, contrast.hi, contrast.defaultRaw]).toEqual([6554, 22938, 14090]);
    const legLen = locusByPath("body.leg[FL].length") as ScalarLocus;
    expect([legLen.lo, legLen.hi, legLen.defaultRaw]).toEqual([157286, 327680, 203162]); // §1.2 narrowed lo
    // Default phase groups encode the trot: {FL, BR} = 0, {FR, BL} = 1.
    for (const [socket, group] of [["FL", 0], ["FR", 1], ["BL", 1], ["BR", 0]] as const) {
      const pg = locusByPath(`body.leg[${socket}].phase_group`) as ScalarLocus;
      expect(pg.kind).toBe("enum");
      expect(pg.defaultRaw).toBe(group);
    }
    expect(TRAIT_TAG_NAMES).toEqual(["chitin", "fleshy", "spectral", "mechanical", "verdant"]);
    // U2 append (design 07 §4): the anticipation locus, id 35, fp
    // [0.5, 2] default 1.0 — the default serializes absent (wire law).
    const ant = locusByPath("anim.quadruped.anticipation") as ScalarLocus;
    expect([ant.id, ant.kind, ant.lo, ant.hi, ant.defaultRaw]).toEqual([
      35,
      "fp",
      32768,
      131072,
      65536,
    ]);
  });
});

describe("design 06 §3.4 worked example (normative vector, both directions)", () => {
  const TAPE_HEX = "01 01 2a 03 80 80 d8 0b 0c b4 e6 04 1b 80 80 04";
  const TAPE_B64 = "AQEqA4CA2AsMtOYEG4CABA";

  test("the 16-byte tape base64urls to the pinned 22-char string", () => {
    expect(b64u(TAPE_HEX)).toBe(TAPE_B64);
  });

  test("encode: the described genome produces exactly the pinned string", () => {
    const g = makeGenome({
      seed: 42n,
      values: [
        ["palette.base_hue", 13107200], // 200.0°
        ["anim.quadruped.tail_amp", 131072], // 2.0
        ["body.leg[BL].length", 235930], // 3.6
      ],
    });
    expect(encodeGenome(g)).toBe(TAPE_B64);
  });

  test("decode: the exact bytes yield the exact field values", () => {
    const g = decodeGenome(TAPE_B64);
    expect(g.version).toBe(GENOME_VERSION);
    expect(g.seed).toBe(42n);
    expect(g.traitTags).toEqual([]);
    expect(g.values.size).toBe(3);
    expect(getScalar(g, "palette.base_hue")).toBe(13107200);
    expect(getScalar(g, "anim.quadruped.tail_amp")).toBe(131072);
    expect(getScalar(g, "body.leg[BL].length")).toBe(235930);
    // Every other scalar locus reads its registry default.
    for (const locus of SCALARS) {
      if (![3, 12, 27].includes(locus.id)) {
        expect(getScalar(g, locus.id)).toBe(locus.defaultRaw);
      }
    }
  });

  test("all-defaults wolf is the single byte 01 → \"AQ\"", () => {
    expect(encodeGenome(makeGenome())).toBe("AQ");
    const g = decodeGenome("AQ");
    expect(g.seed).toBe(0n);
    expect(g.traitTags).toEqual([]);
    expect(g.values.size).toBe(0);
    expect(getScalar(g, "body.core.length")).toBe(498074); // fallback = default
  });
});

describe("design 06 §3.3 reject rules (each fires with the right error class)", () => {
  const malformedStrings: ReadonlyArray<[string, string]> = [
    ["empty string (truncated version)", ""],
    ["impossible base64url length ≡ 1 mod 4", "A"],
    ["base64url padding is banned", "AQ=="],
    ["character outside the base64url alphabet", "A+"],
    ["non-zero leftover bits (non-canonical spelling of byte 0x01)", "AR"],
  ];
  for (const [name, text] of malformedStrings) {
    test(`Malformed: ${name}`, () => {
      expect(() => decodeGenome(text)).toThrow(MalformedGenomeError);
    });
  }

  const malformedTapes: ReadonlyArray<[string, string]> = [
    ["non-minimal uvarint in the version prefix (81 00 = 1)", "8100"],
    ["non-minimal uvarint in a scalar payload (80 00 = 0)", "01038000"],
    ["ids not strictly ascending (12 then 3)", "010cb4e604038080d80b"],
    ["duplicate id (1 twice)", "01012a012a"],
    ["explicit default: scalar payload 0", "010300"],
    ["explicit default: seed 0", "010100"],
    ["explicit default: empty tag set", "010200"],
    ["tag set not strictly ascending", "0102020100"],
    ["duplicate tag in the set", "0102020101"],
    ["tag count 3 outside the 0–2 domain", "010203000102"],
    ["ramp_len above domain (4 + 2 = 6 > 5)", "010604"],
    ["ramp_len below domain (4 − 2 = 2 < 3)", "010603"],
    ["base_hue one raw past the [0, 360) hi bound", "01038080d815"],
    ["fp value below its lo bound (base_hue raw −1, zz(−851969))", "0103818068"],
    ["scalar enum below 0 (phase_group −1)", "011701"],
    ["meta.plan below 0", "010001"],
    ["truncated entry: id with no payload", "0103"],
    ["truncated entry: payload uvarint cut mid-continuation", "010380"],
    ["truncated entry: tag count 2 but one tag present", "01020201"],
    ["trailing byte after a valid entry (id 0 after id 1 — never ascending)", "01012a00"],
    ["trailing bytes forming a truncated entry", "010cb4e60422"],
    ["uvarint longer than 10 bytes", "0101ffffffffffffffffffff01"],
    ["10-byte uvarint exceeding 2^64", "0101ffffffffffffffffff02"],
  ];
  for (const [name, hex] of malformedTapes) {
    test(`Malformed: ${name}`, () => {
      expect(() => decodeGenome(b64u(hex))).toThrow(MalformedGenomeError);
    });
  }

  const upgradeTapes: ReadonlyArray<[string, string]> = [
    ["unknown version prefix 2", "02"],
    ["unknown version prefix 0", "00"],
    ["unknown version prefix 2^32", "80808080107b"],
    ["locus id 56 beyond the version-1 registry (U5 extended it to 55)", "013802"],
    ["locus id 300 beyond the version-1 registry", "01ac0202"],
    ["trait tag 5 beyond the version-1 registry", "01020105"],
    ["phase_group enum member 2 beyond the registry", "011704"],
    ["meta.plan enum member 3 beyond the registry (plan 3 is a future unit's append)", "010006"],
  ];
  for (const [name, hex] of upgradeTapes) {
    test(`UpgradeRequired: ${name}`, () => {
      expect(() => decodeGenome(b64u(hex))).toThrow(UpgradeRequiredError);
    });
  }

  test("the two error kinds are distinct classes under one base", () => {
    const malformed = (() => {
      try {
        decodeGenome(b64u("010300"));
      } catch (e) {
        return e;
      }
      throw new Error("did not throw");
    })();
    const upgrade = (() => {
      try {
        decodeGenome(b64u("02"));
      } catch (e) {
        return e;
      }
      throw new Error("did not throw");
    })();
    expect(malformed).toBeInstanceOf(MalformedGenomeError);
    expect(malformed).toBeInstanceOf(GenomeCodecError);
    expect(malformed).not.toBeInstanceOf(UpgradeRequiredError);
    expect(upgrade).toBeInstanceOf(UpgradeRequiredError);
    expect(upgrade).toBeInstanceOf(GenomeCodecError);
    expect(upgrade).not.toBeInstanceOf(MalformedGenomeError);
  });

  test("domain hi bounds are accepted exactly (base_hue 23592959; max u64 seed)", () => {
    const atHi = decodeGenome(b64u("0103feffd715"));
    expect(getScalar(atHi, "palette.base_hue")).toBe(23592959);
    const maxSeed = decodeGenome(b64u("0101ffffffffffffffffff01"));
    expect(maxSeed.seed).toBe((1n << 64n) - 1n);
    expect(encodeGenome(maxSeed)).toBe(b64u("0101ffffffffffffffffff01"));
  });

  test("construction enforces domains too (§3.3 both ends)", () => {
    expect(() => makeGenome({ values: [["palette.ramp_len", 6]] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ values: [["palette.base_hue", -1]] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ values: [["palette.base_hue", 851968.5]] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ seed: -1n })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ seed: 1n << 64n })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ traitTags: [0, 1, 2] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ traitTags: [5] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ traitTags: [1, 1] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ values: [["meta.seed", 1]] })).toThrow(MalformedGenomeError);
    expect(() => makeGenome({ values: [["no.such.locus", 1]] })).toThrow(MalformedGenomeError);
  });
});

describe("design 06 §3.3 round-trip and canonical-bytes laws (≥ 10,000 genomes)", () => {
  test("decode(encode(g)) == g and encode(decode(b)) == b over the corpus", () => {
    const corpus: Genome[] = [];

    // Sampler-generated genomes (spread across the u64 seed space).
    for (let i = 0; i < 2000; i++) {
      const seed = (BigInt(i) * 0x9e3779b97f4a7c15n) & ((1n << 64n) - 1n);
      corpus.push(sampleGenome(seed));
    }

    // Adversarially-randomized in-domain genomes: random subsets of loci,
    // biased hard toward the domain extremes, random seeds and tag sets.
    const rng = createStream(0xfab1e5n, "tests.genome.adversarial");
    for (let i = 0; i < 8001; i++) {
      const values: Array<readonly [number, number]> = [];
      for (const locus of SCALARS) {
        const mode = rng.nextRange(5);
        if (mode === 0 || mode === 1) continue; // absent
        const v =
          mode === 2 ? locus.lo : mode === 3 ? locus.hi : rng.nextFp(locus.lo, locus.hi);
        values.push([locus.id, v]);
      }
      const seedMode = rng.nextRange(4);
      const seed =
        seedMode === 0
          ? 0n
          : seedMode === 1
            ? BigInt(rng.nextRange(128)) // tiny seeds: 1-byte uvarints
            : seedMode === 2
              ? BigInt(rng.nextU32())
              : (BigInt(rng.nextU32()) << 32n) | BigInt(rng.nextU32());
      const nTags = rng.nextRange(3);
      const tags = new Set<number>();
      while (tags.size < nTags) tags.add(rng.nextRange(5));
      corpus.push(makeGenome({ seed, traitTags: [...tags], values }));
    }

    expect(corpus.length).toBeGreaterThanOrEqual(10000);

    for (const g of corpus) {
      const text = encodeGenome(g);
      const decoded = decodeGenome(text);
      if (!genomesEqual(decoded, g)) {
        expect(decoded).toEqual(g); // slow path only on failure, for the diff
      }
      const reencoded = encodeGenome(decoded);
      if (reencoded !== text) {
        expect(reencoded).toBe(text);
      }
    }
  });
});

describe("design 06 §3.5 adversarial worst cases (as amended at U3)", () => {
  const zz = (d: bigint): bigint => (d >= 0n ? d << 1n : (-d << 1n) - 1n);
  const uvarintLen = (value: bigint): number => {
    let v = value;
    let n = 1;
    while ((v >>= 7n) > 0n) n++;
    return n;
  };
  /** Costliest in-domain extreme of each locus in `ids` (absent if it cannot move). */
  const worstValues = (ids: ReadonlySet<number>): Array<readonly [number, number]> => {
    const values: Array<readonly [number, number]> = [];
    for (const locus of SCALARS) {
      if (!ids.has(locus.id)) continue;
      const candidates = [locus.lo, locus.hi].filter((v) => v !== locus.defaultRaw);
      if (candidates.length === 0) continue;
      let best = candidates[0]!;
      for (const c of candidates) {
        if (uvarintLen(zz(BigInt(c - locus.defaultRaw))) > uvarintLen(zz(BigInt(best - locus.defaultRaw)))) {
          best = c;
        }
      }
      values.push([locus.id, best]);
    }
    return values;
  };
  const idSet = (...ranges: ReadonlyArray<readonly [number, number]>): Set<number> => {
    const s = new Set<number>();
    for (const [lo, hi] of ranges) for (let i = lo; i <= hi; i++) s.add(i);
    return s;
  };

  test("quadruped sampler-reachable worst: 138 bytes = 184 chars (the U2 pin, unchanged — the byte model validated)", () => {
    // A sampled quadruped genome carries exactly ids 3..35 (the U3
    // plan-scoped sampler, design 07 §2.3.1 D-a), so U2's pin holds.
    const g = makeGenome({
      seed: (1n << 64n) - 1n,
      traitTags: [3, 4],
      values: worstValues(idSet([3, 35])),
    });
    const text = encodeGenome(g);
    expect(text.length).toBe(184);
    expect(Buffer.from(text, "base64url").length).toBe(138);
    expect(text.length).toBeLessThanOrEqual(200); // design 01 requirement 4
    expect(genomesEqual(decodeGenome(text), g)).toBe(true);
  });

  test("levitant sampler-reachable worst: 85 bytes = 114 chars (plan entry + shared + ids 36–46)", () => {
    const g = makeGenome({
      seed: (1n << 64n) - 1n,
      traitTags: [3, 4],
      values: [
        [0, 1],
        ...worstValues(idSet([3, 6], [13, 15], [36, 46])),
      ],
    });
    const text = encodeGenome(g);
    expect(text.length).toBe(114);
    expect(Buffer.from(text, "base64url").length).toBe(85);
    expect(text.length).toBeLessThanOrEqual(200); // the design 01 req-4 target holds for every sampler-reachable genome
    expect(genomesEqual(decodeGenome(text), g)).toBe(true);
  });

  test("fully-adversarial cross-plan tape (hand-edited, every locus): 193 bytes = 258 chars", () => {
    // Exceeds design 01 req 4's ~200-char guidance — recorded honestly in
    // the design 06 §3.5 amendment: the guidance was a target, degradation
    // is linear, and no sampler can emit this tape. U3's bound was 179 B =
    // 239 chars; the U4 append (ids 47–50) grows it by 14 B exactly as the
    // U3 amendment predicted (machine-verified).
    const g = makeGenome({
      seed: (1n << 64n) - 1n,
      traitTags: [3, 4],
      values: [[0, 1], ...worstValues(idSet([3, 50]))],
    });
    const text = encodeGenome(g);
    expect(text.length).toBe(258);
    expect(Buffer.from(text, "base64url").length).toBe(193);
    expect(genomesEqual(decodeGenome(text), g)).toBe(true);
  });
});

describe("design 06 §4.2 pinned sampler", () => {
  test("deterministic: same seed → byte-identical genome twice", () => {
    const a = sampleGenome(123n);
    const b = sampleGenome(123n);
    expect(genomesEqual(a, b)).toBe(true);
    expect(encodeGenome(a)).toBe(encodeGenome(b));
    expect(encodeGenome(sampleGenome(1n))).not.toBe(encodeGenome(sampleGenome(2n)));
  });

  test("pinned first-sample values derived from the §4.3 stream vectors", () => {
    // Each locus draws from its own fresh stream, so the §4.3 first-u32
    // vectors pin these sampled raws exactly (verified against an
    // independent reimplementation of §4 before pinning).
    expect(getScalar(sampleGenome(0n), "body.leg[FL].length")).toBe(267147);
    expect(getScalar(sampleGenome(42n), "body.tail.girth")).toBe(84671);
    expect(getScalar(sampleGenome(0xdeadbeefn), "palette.base_hue")).toBe(12049849);
  });

  test("pinned trait_tags draws (own stream, n = nextRange(2) + 1)", () => {
    expect(sampleGenome(0n).traitTags).toEqual([2]);
    expect(sampleGenome(42n).traitTags).toEqual([1, 2]);
    expect(sampleGenome(123n).traitTags).toEqual([1]);
  });

  test("meta.seed = s, meta.plan = 0, tags never empty, everything in-domain", () => {
    for (let i = 0; i < 200; i++) {
      const seed = (BigInt(i) * 0x2545f4914f6cdd1dn) & ((1n << 64n) - 1n);
      const g = sampleGenome(seed);
      expect(g.seed).toBe(seed);
      expect(g.values.has(0)).toBe(false); // plan stays at its default 0
      expect(getScalar(g, "meta.plan")).toBe(0);
      expect(g.traitTags.length).toBeGreaterThanOrEqual(1);
      expect(g.traitTags.length).toBeLessThanOrEqual(2);
      for (let t = 1; t < g.traitTags.length; t++) {
        expect(g.traitTags[t]!).toBeGreaterThan(g.traitTags[t - 1]!);
      }
      for (const locus of SCALARS) {
        const v = getScalar(g, locus.id);
        expect(v).toBeGreaterThanOrEqual(locus.lo);
        expect(v).toBeLessThanOrEqual(locus.hi);
      }
    }
  });

  test("sampler seed domain is enforced", () => {
    expect(() => sampleGenome(-1n)).toThrow(RangeError);
    expect(() => sampleGenome(1n << 64n)).toThrow(RangeError);
  });
});

describe("genome accessors", () => {
  test("getScalar rejects non-scalar and unknown loci", () => {
    const g = makeGenome();
    expect(() => getScalar(g, "meta.seed")).toThrow(RangeError);
    expect(() => getScalar(g, "meta.trait_tags")).toThrow(RangeError);
    expect(() => getScalar(g, 99)).toThrow(RangeError);
    expect(() => getScalar(g, "nope")).toThrow(RangeError);
  });

  test("makeGenome canonicalizes: defaults dropped, tags sorted, ids ascending", () => {
    const g = makeGenome({
      traitTags: [4, 0],
      values: [
        ["body.tail.girth", 72090], // the default — must be dropped
        [33, 100000],
        ["palette.ramp_len", 5],
      ],
    });
    expect(g.traitTags).toEqual([0, 4]);
    expect(g.values.has(34)).toBe(false);
    expect([...g.values.keys()]).toEqual([6, 33]); // ascending ids
    expect(getScalar(g, 34)).toBe(72090);
    expect(() => makeGenome({ values: [[33, 100000], ["body.tail.length", 100000]] }))
      .toThrow(MalformedGenomeError); // duplicate id via path alias
  });
});
