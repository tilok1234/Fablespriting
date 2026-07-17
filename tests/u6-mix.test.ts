/**
 * U6 — the default bestiary mix (design 07 §7.1): sampleBestiary.
 *
 * The identity law under test: for every seed, `sampleBestiary(seed)`
 * is IDENTICAL to `sampleGenome(seed, P, { tags: T })` where P is the
 * plan drawn from the RESERVED `stream(seed, "meta.plan", "sample")`
 * (the U3 D-a reservation, consumed at U6) and T is the seed's own
 * default-path tag set. P and T are re-derived HERE from raw
 * createStream calls transcribed from the spec text — sharing no
 * helper with the wrapper's code (the pin-against-spec discipline: a
 * bug shared by wrapper and helper must not self-verify).
 *
 * The distribution pins (design 07 §7.1, MEASURED and adjudicated):
 * PLAN_MIX_WEIGHTS = [1, 1, 1] (uniform); the seeds-0..99 plan
 * sequence and realized census {34, 33, 33}; the 0..99 mix-DNA corpus
 * fingerprint. Any change to weights, stream key, or draw arithmetic
 * breaks these vectors — a weights retune is a reviewed regeneration
 * (new qa artifacts + new fixtures in the same commit), never a silent
 * drift.
 */

import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  PLAN_MIX_WEIGHTS,
  REGISTRY,
  encodeGenome,
  getScalar,
  sampleBestiary,
  sampleGenome,
} from "../src/genome.js";
import { createStream } from "../src/prng.js";
import { selfCheck } from "../src/selfcheck.js";

/**
 * The pinned seeds-0..99 plan sequence (design 07 §7.1; 0 = quadruped,
 * 1 = levitant, 2 = amorphous) — the reserved-stream conformance
 * vector: weights, stream key, and draw arithmetic are all pinned by
 * this one string.
 */
const PINNED_PLAN_SEQUENCE =
  "0002200211100221101021022102001102202022020121120220101112020212121010102101102010102121221112201020";

/** The pinned 0..99 mix-DNA fingerprint (sha256 of newline-joined DNAs). */
const PINNED_MIX_FINGERPRINT_0_99 =
  "ae3bbbe767449b0e1d5c4affed15a43ed4448a47a2bae13ba63aeaa9583036ea";

/**
 * The spec's plan draw, transcribed (u6 spec §1.1 / design 07 §7.1):
 * one `nextRange(Σ weights)` on the reserved stream; at weights
 * [1, 1, 1] the arithmetic is `nextRange(3)` verbatim and the result
 * IS the plan id.
 */
function planFromSpec(seed: bigint): number {
  return createStream(seed, "meta.plan", "sample").nextRange(3);
}

/**
 * The default path's tag draw, transcribed (design 06 §4.2):
 * `n = nextRange(2) + 1`, then `nextRange(5)` until n distinct,
 * discard-and-redraw; returned ascending (serialization order).
 */
function tagsFromSpec(seed: bigint): number[] {
  const s = createStream(seed, "meta.trait_tags", "sample");
  const n = s.nextRange(2) + 1;
  const drawn = new Set<number>();
  while (drawn.size < n) drawn.add(s.nextRange(5));
  return [...drawn].sort((a, b) => a - b);
}

describe("sampleBestiary — the identity law (design 07 §7.1)", { timeout: 120000 }, () => {
  test("seeds 0..49: sampleBestiary(s) === sampleGenome(s, P, { tags: T }) with P/T from raw spec streams", () => {
    for (let i = 0; i < 50; i++) {
      const seed = BigInt(i);
      const p = planFromSpec(seed);
      const t = tagsFromSpec(seed);
      expect(encodeGenome(sampleBestiary(seed)), `seed ${i}`).toBe(
        encodeGenome(sampleGenome(seed, p, { tags: t })),
      );
    }
  });

  test("seeds 0..49: mix keeps each seed's default-path tag identity", () => {
    for (let i = 0; i < 50; i++) {
      const seed = BigInt(i);
      const p = planFromSpec(seed);
      // The default (plain) path draws the same stream the mix consumes.
      expect([...sampleGenome(seed, p).traitTags], `seed ${i}`).toEqual(tagsFromSpec(seed));
    }
  });

  test("sampleBestiary rejects out-of-domain seeds (the sampleGenome RangeError contract)", () => {
    expect(() => sampleBestiary(-1n)).toThrow(RangeError);
    expect(() => sampleBestiary(1n << 64n)).toThrow(RangeError);
    expect(() => sampleBestiary(0 as unknown as bigint)).toThrow(RangeError);
  });
});

describe("the pinned mix distribution (design 07 §7.1)", { timeout: 120000 }, () => {
  test("PLAN_MIX_WEIGHTS is the pinned frozen uniform [1, 1, 1]", () => {
    expect([...PLAN_MIX_WEIGHTS]).toEqual([1, 1, 1]);
    expect(Object.isFrozen(PLAN_MIX_WEIGHTS)).toBe(true);
  });

  test("zero registry appends: U6 adds an entry point, not loci", () => {
    expect(REGISTRY.length).toBe(56);
  });

  test("seeds 0..99: reserved-stream conformance + census {34, 33, 33} + corpus fingerprint + zero degenerate", () => {
    const dnas: string[] = [];
    const seq: number[] = [];
    const census = [0, 0, 0];
    let degenerate = 0;
    for (let i = 0; i < 100; i++) {
      const genome = sampleBestiary(BigInt(i));
      const plan = getScalar(genome, 0);
      seq.push(plan);
      census[plan]! += 1;
      dnas.push(encodeGenome(genome));
      if (selfCheck(genome)) degenerate += 1;
    }
    // (c) any change to weights, stream key, or draw arithmetic breaks this
    expect(seq.join("")).toBe(PINNED_PLAN_SEQUENCE);
    // (b) the realized census, recorded honestly — CI-asserted so silent drift fails
    expect(census).toEqual([34, 33, 33]);
    expect(createHash("sha256").update(dnas.join("\n")).digest("hex")).toBe(
      PINNED_MIX_FINGERPRINT_0_99,
    );
    // (e) the §5.1 bands hold on the mix-sampled space (0/100; 0/2000 at the sweep)
    expect(degenerate).toBe(0);
  });
});
