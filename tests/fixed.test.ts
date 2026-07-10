import { describe, expect, test } from "vitest";

import {
  INT32_MAX,
  INT32_MIN,
  SIN_TABLE,
  asr,
  cos_fp,
  fp_add,
  fp_div,
  fp_mul,
  fp_sqrt,
  fp_sub,
  rheDiv,
  sin_fp,
} from "../src/fixed.js";
import { fnv1a64 } from "../src/prng.js";

/** Interpret a u32 hex literal as a two's-complement int32 raw. */
function i32(x: number): number {
  return x | 0;
}

describe("design 06 §5.4 normative vectors", () => {
  test("fp_mul", () => {
    expect(fp_mul(i32(0x0002199a), i32(0xffff199a))).toBe(i32(0xfffe1c29)); // 2.1 · −0.9
    expect(fp_mul(i32(0x00008000), i32(0x00000001))).toBe(0); // tie → even
    expect(fp_mul(i32(0x00008000), i32(0x00000003))).toBe(2); // tie → even
    expect(fp_mul(i32(0xffff8000), i32(0x00000001))).toBe(0); // tie, symmetric
    expect(fp_mul(i32(0x0007999a), i32(0x00018000))).toBe(747111); // 7.6 · 1.5
    expect(fp_mul(i32(0xfffc999a), i32(0xfffc999a))).toBe(757593); // (−3.4)²
  });

  test("fp_div", () => {
    expect(fp_div(i32(0x00010000), i32(0x00030000))).toBe(21845); // 1/3
    expect(fp_div(i32(0xffff0000), i32(0x00030000))).toBe(-21845); // −1/3
    expect(fp_div(i32(0x0002199a), i32(0xffff199a))).toBe(i32(0xfffdaaa9)); // 2.1/−0.9
    expect(fp_div(i32(0x00000001), i32(0x00000002))).toBe(i32(0x00008000)); // exact
    expect(fp_div(i32(0x00000003), i32(0x00020000))).toBe(2); // tie → even
  });

  test("fp_sqrt", () => {
    expect(fp_sqrt(i32(0x00020000))).toBe(92682); // √2
    expect(fp_sqrt(i32(0x00090000))).toBe(i32(0x00030000)); // √9 = 3
    expect(fp_sqrt(i32(0x00004000))).toBe(i32(0x00008000)); // √0.25 = 0.5
  });

  test("sin_fp", () => {
    expect(sin_fp(i32(0x00004000))).toBe(65536); // 0.25 turns
    expect(sin_fp(i32(0xffffc000))).toBe(-65536); // −0.25 turns
  });
});

describe("design 06 §5.3 SIN_TABLE identity", () => {
  test("FNV-1a64 checksum over little-endian int32 serialization is the pinned 0x00361da115eb6196", () => {
    const bytes = new Uint8Array(SIN_TABLE.length * 4);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < SIN_TABLE.length; i++) {
      view.setInt32(i * 4, SIN_TABLE[i]!, true);
    }
    expect(fnv1a64(bytes)).toBe(0x00361da115eb6196n);
  });

  test("4096 entries, sum 0, pinned samples", () => {
    expect(SIN_TABLE.length).toBe(4096);
    let sum = 0;
    for (let i = 0; i < SIN_TABLE.length; i++) sum += SIN_TABLE[i]!;
    expect(sum).toBe(0);
    expect(SIN_TABLE[0]).toBe(0);
    expect(SIN_TABLE[1]).toBe(101);
    expect(SIN_TABLE[2]).toBe(201);
    expect(SIN_TABLE[512]).toBe(46341);
    expect(SIN_TABLE[1024]).toBe(65536);
    expect(SIN_TABLE[1536]).toBe(46341);
    expect(SIN_TABLE[2048]).toBe(0);
    expect(SIN_TABLE[3072]).toBe(-65536);
    expect(SIN_TABLE[4095]).toBe(-101);
  });

  test("index wraps and cos_fp is the quarter-turn lead", () => {
    expect(sin_fp(65536)).toBe(0); // 1.0 turns wraps to entry 0
    expect(sin_fp(65536 + 16384)).toBe(65536); // 1.25 turns
    expect(sin_fp(-65536 - 16384)).toBe(-65536); // −1.25 turns
    expect(cos_fp(0)).toBe(65536);
    expect(cos_fp(16384)).toBe(0); // cos(0.25 turns)
    expect(cos_fp(32768)).toBe(-65536); // cos(0.5 turns)
    expect(cos_fp(-16384)).toBe(0);
  });
});

describe("design 06 §5.1 asr and RHE grid rounding", () => {
  test("asr floors toward −∞, never toward zero", () => {
    expect(asr(-1, 1)).toBe(-1); // the pinned case
    expect(asr(-2, 1)).toBe(-1);
    expect(asr(-3, 1)).toBe(-2);
    expect(asr(1, 1)).toBe(0);
    expect(asr(3, 1)).toBe(1);
    expect(asr(98304, 1)).toBe(49152); // idle bob amplitude halving
    expect(asr(-98304, 2)).toBe(-24576);
    expect(asr(7, 0)).toBe(7);
  });

  test("rheDiv rounds half to even on both sides of zero", () => {
    expect(rheDiv(1, 2)).toBe(0); // 0.5 → 0
    expect(rheDiv(3, 2)).toBe(2); // 1.5 → 2
    expect(rheDiv(5, 2)).toBe(2); // 2.5 → 2
    expect(rheDiv(7, 2)).toBe(4); // 3.5 → 4
    expect(rheDiv(-1, 2)).toBe(0); // −0.5 → 0
    expect(rheDiv(-3, 2)).toBe(-2); // −1.5 → −2
    expect(rheDiv(-5, 2)).toBe(-2); // −2.5 → −2
    expect(rheDiv(-7, 2)).toBe(-4); // −3.5 → −4
    expect(rheDiv(2, 4)).toBe(0); // 0.5 → 0
    expect(rheDiv(6, 4)).toBe(2); // 1.5 → 2
    expect(rheDiv(5, 4)).toBe(1); // 1.25 → 1
    expect(rheDiv(7, 4)).toBe(2); // 1.75 → 2
    // §1.3 byte(): RHE(c·255/65536)
    expect(rheDiv(65536 * 255, 65536)).toBe(255);
    expect(rheDiv(0, 65536)).toBe(0);
  });
});

describe("design 06 §5.1 overflow policy (trap on true result outside int32)", () => {
  test("fp_add / fp_sub edges", () => {
    expect(fp_add(INT32_MAX - 1, 1)).toBe(INT32_MAX);
    expect(fp_add(INT32_MIN, INT32_MAX)).toBe(-1);
    expect(fp_sub(INT32_MIN + 1, 1)).toBe(INT32_MIN);
    expect(fp_sub(INT32_MAX, INT32_MAX)).toBe(0);
    expect(() => fp_add(INT32_MAX, 1)).toThrow(RangeError);
    expect(() => fp_add(INT32_MIN, -1)).toThrow(RangeError);
    expect(() => fp_sub(INT32_MIN, 1)).toThrow(RangeError);
    expect(() => fp_sub(INT32_MAX, -1)).toThrow(RangeError);
    expect(() => fp_sub(0, INT32_MIN)).toThrow(RangeError); // −(−2^31) = 2^31
  });

  test("fp_mul / fp_div / fp_sqrt traps and preconditions", () => {
    expect(() => fp_mul(INT32_MAX, INT32_MAX)).toThrow(RangeError);
    expect(() => fp_mul(INT32_MIN, INT32_MIN)).toThrow(RangeError);
    expect(() => fp_div(INT32_MAX, 1)).toThrow(RangeError); // (2^31−1)·2^16 / (2^−16·2^16)
    expect(() => fp_div(1, 0)).toThrow(RangeError);
    expect(() => fp_sqrt(-1)).toThrow(RangeError);
    expect(fp_sqrt(0)).toBe(0);
    expect(fp_sqrt(INT32_MAX)).toBe(11863283); // in range by construction, never traps
  });
});

describe("design 06 §5.2 porting note: raw −2^31 through the sign-magnitude split", () => {
  test("fp_mul with INT32_MIN operands (bitwise decomposition would flip the sign)", () => {
    // |−2^31| = 2^31 is not int32-representable; Math.floor/% decomposition
    // must survive it where `>> 16` would ToInt32-wrap to −32768.
    expect(fp_mul(INT32_MIN, 65536)).toBe(INT32_MIN); // × 1.0
    expect(fp_mul(65536, INT32_MIN)).toBe(INT32_MIN);
    expect(fp_mul(INT32_MIN, 1)).toBe(-32768); // exact: −2^31 / 2^16
    expect(fp_mul(INT32_MIN, 3)).toBe(-98304);
    expect(fp_mul(INT32_MIN, -1)).toBe(32768);
    expect(fp_mul(INT32_MIN, 0)).toBe(0);
    expect(() => fp_mul(INT32_MIN, -65536)).toThrow(RangeError); // true result +2^31
    expect(() => fp_mul(INT32_MIN, 65537)).toThrow(RangeError);
  });
});

describe("fp_mul property sweep vs BigInt round-half-even reference", () => {
  /** Independent reference: RHE(a·b / 2^16) as exact BigInt. */
  function refMul(a: number, b: number): bigint {
    const p = BigInt(a) * BigInt(b);
    let q = p >> 16n; // BigInt >> is arithmetic: floor toward −∞
    const r = p & 0xffffn; // non-negative remainder mod 2^16
    if (r > 0x8000n) q += 1n;
    else if (r === 0x8000n) q += q & 1n; // tie → even
    return q;
  }

  /** Returns a failure description, or null if fp_mul matches the reference. */
  function checkPair(a: number, b: number): string | null {
    const expected = refMul(a, b);
    if (expected >= -2147483648n && expected <= 2147483647n) {
      const got = fp_mul(a, b);
      return got === Number(expected) ? null : `fp_mul(${a}, ${b}) = ${got}, want ${expected}`;
    }
    try {
      const got = fp_mul(a, b);
      return `fp_mul(${a}, ${b}) = ${got}, expected an overflow trap (true result ${expected})`;
    } catch (e) {
      return e instanceof RangeError
        ? null
        : `fp_mul(${a}, ${b}) threw ${String(e)}, expected RangeError`;
    }
  }

  test("≥200k pairs: edges, exact halves (both signs), random", () => {
    // Deterministic xorshift32 so failures reproduce.
    let st = 0x12345678;
    const rnd = (): number => {
      st ^= (st << 13) | 0;
      st >>>= 0;
      st ^= st >>> 17;
      st ^= (st << 5) | 0;
      st >>>= 0;
      return st;
    };

    let failure: string | null = null;
    let count = 0;
    const check = (a: number, b: number): void => {
      count += 1;
      if (failure === null) failure = checkPair(a, b);
    };

    // Edge × edge cross (includes the ±2^31 and ±1 raw edges).
    const edges = [
      INT32_MIN, INT32_MIN + 1, -2147418112, -65537, -65536, -32769, -32768,
      -2, -1, 0, 1, 2, 32767, 32768, 65535, 65536, 2147418112, INT32_MAX - 1, INT32_MAX,
    ];
    for (const a of edges) for (const b of edges) check(a, b);

    // Edges × random full-range int32.
    for (const a of edges) {
      for (let i = 0; i < 200; i++) check(a, rnd() | 0);
    }

    // Constructed exact-half cases (low product ≡ 32768 mod 2^16), all four
    // sign combinations — floor-toward-−∞ and RHE both exercised.
    for (let i = 0; i < 40000; i++) {
      const am = (rnd() & 0x7fff) * 65536 + 32768;
      const bm = (rnd() & 0xffff) | 1; // odd
      const a = rnd() & 1 ? -am : am;
      const b = rnd() & 2 ? -bm : bm;
      check(a, b);
    }

    // Random full-range × small (mostly in-range products).
    for (let i = 0; i < 100000; i++) {
      const a = rnd() | 0;
      const b = (rnd() % 262145) - 131072;
      check(a, b);
    }

    // Random full-range × full-range (mostly exercises the overflow trap).
    for (let i = 0; i < 60000; i++) check(rnd() | 0, rnd() | 0);

    expect(failure).toBeNull();
    expect(count).toBeGreaterThanOrEqual(200000);
  });

  test("fp_div agrees with an exact rational RHE reference on a sweep", () => {
    let st = 0x9e3779b9;
    const rnd = (): number => {
      st ^= (st << 13) | 0;
      st >>>= 0;
      st ^= st >>> 17;
      st ^= (st << 5) | 0;
      st >>>= 0;
      return st;
    };
    const refDiv = (a: number, b: number): bigint => {
      let n = BigInt(a) << 16n;
      let d = BigInt(b);
      if (d < 0n) {
        n = -n;
        d = -d;
      }
      let q = n / d;
      let r = n % d;
      if (r < 0n) {
        q -= 1n;
        r += d;
      }
      const twice = r << 1n;
      if (twice > d) q += 1n;
      else if (twice === d) q += q & 1n;
      return q;
    };
    let failure: string | null = null;
    for (let i = 0; i < 20000 && failure === null; i++) {
      const a = rnd() | 0;
      let b = rnd() | 0;
      if (b === 0) b = 1;
      const expected = refDiv(a, b);
      if (expected >= -2147483648n && expected <= 2147483647n) {
        const got = fp_div(a, b);
        if (got !== Number(expected)) failure = `fp_div(${a}, ${b}) = ${got}, want ${expected}`;
      } else {
        try {
          fp_div(a, b);
          failure = `fp_div(${a}, ${b}) should trap (true result ${expected})`;
        } catch {
          /* expected */
        }
      }
    }
    expect(failure).toBeNull();
  });

  test("fp_sqrt agrees with exact isqrt-based RHE on a sweep", () => {
    let st = 0xdeadbeef;
    const rnd = (): number => {
      st ^= (st << 13) | 0;
      st >>>= 0;
      st ^= st >>> 17;
      st ^= (st << 5) | 0;
      st >>>= 0;
      return st;
    };
    let failure: string | null = null;
    for (let i = 0; i < 20000 && failure === null; i++) {
      const a = rnd() & 0x7fffffff;
      const n = BigInt(a) << 16n;
      // Exact integer sqrt by Newton on BigInt.
      let x = n;
      let y = (x + 1n) >> 1n;
      while (y < x) {
        x = y;
        y = (x + n / x) >> 1n;
      }
      if (n === 0n) x = 0n;
      let q = x;
      if (n - q * q > q) q += 1n; // spec's remainder comparison; ties impossible
      const got = fp_sqrt(a);
      if (got !== Number(q)) failure = `fp_sqrt(${a}) = ${got}, want ${q}`;
    }
    expect(failure).toBeNull();
  });
});
