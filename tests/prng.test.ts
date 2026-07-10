import { describe, expect, test } from "vitest";

import { Pcg32Stream, createStream, fnv1a64, splitmix64, streamKey } from "../src/prng.js";

describe("design 06 §4.1 primitives", () => {
  test("fnv1a64 of the empty sequence is the offset basis", () => {
    expect(fnv1a64(new Uint8Array(0))).toBe(0xcbf29ce484222325n);
  });

  test("PCG32 published quickstart vector: (initstate 42, initseq 54)", () => {
    const s = new Pcg32Stream(42n, 54n);
    expect(s.nextU32()).toBe(0xa15c02b7);
    expect(s.nextU32()).toBe(0x7b47f409);
    expect(s.nextU32()).toBe(0xba1d3330);
  });
});

describe("design 06 §4.3 normative stream vectors", () => {
  const vectors: ReadonlyArray<{
    seed: bigint;
    path: string;
    k: bigint;
    initstate: bigint;
    u32: readonly [number, number];
  }> = [
    {
      seed: 0n,
      path: "body.leg[FL].length",
      k: 0x1e6bba6b6e570af9n,
      initstate: 0xea6b245aee22f862n,
      u32: [0xb13ea62e, 0xbc57dc41],
    },
    {
      seed: 42n,
      path: "body.tail.girth",
      k: 0x997e16fde0e664b3n,
      initstate: 0xb3c9bfbb240bd70dn,
      u32: [0xd5e5d99d, 0xb301febf],
    },
    {
      seed: 0xdeadbeefn,
      path: "palette.base_hue",
      k: 0xd296c909b6113670n,
      initstate: 0x9fb66eaf1999411an,
      u32: [0x3d2fddb9, 0x2ffdaa65],
    },
  ];

  for (const v of vectors) {
    test(`seed ${v.seed} × ${v.path} × sample`, () => {
      const k = streamKey(v.path, "sample");
      expect(k).toBe(v.k);
      const initstate = splitmix64(k ^ v.seed);
      expect(initstate).toBe(v.initstate);
      const stream = createStream(v.seed, v.path, "sample");
      expect(stream.nextU32()).toBe(v.u32[0]);
      expect(stream.nextU32()).toBe(v.u32[1]);
    });
  }

  test("first vector: initseq and the pinned nextRange(100) sequences", () => {
    const k = streamKey("body.leg[FL].length", "sample");
    const initstate = splitmix64(k ^ 0n);
    expect(splitmix64(initstate)).toBe(0xe4da9a2f45e57663n);

    // Fresh stream: threshold = 2^32 mod 100 = 96, no rejection occurs.
    const fresh = createStream(0n, "body.leg[FL].length");
    expect([fresh.nextRange(100), fresh.nextRange(100), fresh.nextRange(100), fresh.nextRange(100)])
      .toEqual([6, 25, 32, 11]);

    // After consuming the two pinned u32 outputs.
    const offset = createStream(0n, "body.leg[FL].length");
    offset.nextU32();
    offset.nextU32();
    expect([offset.nextRange(100), offset.nextRange(100), offset.nextRange(100), offset.nextRange(100)])
      .toEqual([32, 11, 56, 12]);
  });

  test("draw name defaults to \"sample\" (design 06 §0)", () => {
    const a = createStream(42n, "body.tail.girth");
    const b = createStream(42n, "body.tail.girth", "sample");
    expect(a.nextU32()).toBe(b.nextU32());
    expect(a.nextU32()).toBe(b.nextU32());
  });

  test("distinct draw names key distinct streams", () => {
    const a = createStream(0n, "body.leg[FL].length", "sample");
    const b = createStream(0n, "body.leg[FL].length", "other");
    expect(b.nextU32()).not.toBe(a.nextU32());
  });
});

describe("design 06 §4.2 draw API properties", () => {
  test("nextRange(n) over small n: every value reachable, none outside", () => {
    const stream = createStream(7n, "body.leg[FL].length");
    const n = 5;
    const counts = new Array<number>(n).fill(0);
    const draws = 100000;
    for (let i = 0; i < draws; i++) {
      const r = stream.nextRange(n);
      if (!Number.isInteger(r) || r < 0 || r >= n) {
        throw new Error(`nextRange(${n}) produced out-of-range ${r} at draw ${i}`);
      }
      counts[r]! += 1;
    }
    for (let v = 0; v < n; v++) {
      expect(counts[v]).toBeGreaterThan(0);
    }
    // Sanity, not a statistics test: no value starved to below a quarter of fair share.
    for (let v = 0; v < n; v++) {
      expect(counts[v]!).toBeGreaterThan(draws / n / 4);
    }
  });

  test("nextRange(1) is always 0; invalid n rejected", () => {
    const stream = createStream(1n, "palette.base_hue");
    for (let i = 0; i < 10; i++) expect(stream.nextRange(1)).toBe(0);
    expect(() => stream.nextRange(0)).toThrow(RangeError);
    expect(() => stream.nextRange(-3)).toThrow(RangeError);
    expect(() => stream.nextRange(2.5)).toThrow(RangeError);
  });

  test("nextFp draws over inclusive raw bounds (design 06 §0)", () => {
    const stream = createStream(9n, "body.core.girth");
    const lo = -2;
    const hi = 2;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = stream.nextFp(lo, hi);
      expect(r).toBeGreaterThanOrEqual(lo);
      expect(r).toBeLessThanOrEqual(hi);
      seen.add(r);
    }
    expect(seen.size).toBe(hi - lo + 1); // both endpoints reachable: bounds are inclusive
    const point = createStream(9n, "body.core.girth").nextFp(360, 360);
    expect(point).toBe(360); // degenerate single-raw domain
    expect(() => stream.nextFp(1, 0)).toThrow(RangeError);
  });
});
