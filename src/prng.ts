/**
 * Fablesprite — named PRNG streams (design 06 §4).
 *
 * Every random draw in the pipeline gets its own stream named by
 * (locus path, draw name), keyed against the genome seed:
 *
 *   k         = fnv1a64(utf8(path) ‖ 0x00 ‖ utf8(draw_name))
 *   u         = k XOR genome_seed
 *   initstate = splitmix64(u)
 *   initseq   = splitmix64(initstate)
 *
 * feeding PCG32 XSH-RR 64/32 with the reference pcg32_srandom_r seeding.
 * Keying happens once per stream creation, not per draw; BigInt state is
 * acceptable for M1 per the spec's hot-path note (draws are rare; the
 * rasterizer hot path uses no PRNG).
 */

const MASK64 = (1n << 64n) - 1n;

/** FNV-1a 64 offset basis (design 06 §4.1). */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
/** FNV-1a 64 prime (design 06 §4.1). */
const FNV_PRIME = 0x100000001b3n;

/** PCG32 XSH-RR 64/32 multiplier, O'Neill reference (design 06 §4.1). */
const PCG_MULT = 6364136223846793005n;

/**
 * FNV-1a 64 over a byte sequence (design 06 §4.1): offset basis
 * 0xcbf29ce484222325, prime 0x100000001b3, all arithmetic mod 2^64.
 * Returns the exact u64 hash as a bigint.
 */
export function fnv1a64(bytes: Uint8Array): bigint {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]!);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/**
 * splitmix64 finalizer (design 06 §4.1):
 * `z = x + 0x9E3779B97F4A7C15; z = (z ^ z>>30)·0xBF58476D1CE4E5B9;
 *  z = (z ^ z>>27)·0x94D049BB133111EB; return z ^ z>>31` — all mod 2^64.
 */
export function splitmix64(x: bigint): bigint {
  let z = (x + 0x9e3779b97f4a7c15n) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/**
 * The stream key `k` of design 06 §4.1: FNV-1a64 over the UTF-8 bytes of
 * `path`, then one 0x00 byte, then the UTF-8 bytes of `drawName`. The
 * canonical registry spelling of the path is the exact byte string hashed
 * (design 06 §2) — no aliases, no normalization.
 */
export function streamKey(path: string, drawName: string): bigint {
  const enc = new TextEncoder();
  const p = enc.encode(path);
  const d = enc.encode(drawName);
  const bytes = new Uint8Array(p.length + 1 + d.length);
  bytes.set(p, 0);
  bytes[p.length] = 0; // the pinned 0x00 separator
  bytes.set(d, p.length + 1);
  return fnv1a64(bytes);
}

/**
 * PCG32, XSH-RR 64/32 (O'Neill reference variant), multiplier
 * 6364136223846793005, seeded exactly like the reference
 * `pcg32_srandom_r` (design 06 §4.1):
 *
 *   state = 0;  inc = (initseq << 1) | 1
 *   advance();  state += initstate;  advance()
 *
 * Draw API per design 06 §4.2. Published check vector: (42, 54) yields
 * 0xa15c02b7, 0x7b47f409, 0xba1d3330, … (golden-tested).
 */
export class Pcg32Stream {
  private state: bigint;
  private readonly inc: bigint;

  constructor(initstate: bigint, initseq: bigint) {
    this.state = 0n;
    this.inc = (((initseq << 1n) | 1n)) & MASK64;
    this.advance();
    this.state = (this.state + (initstate & MASK64)) & MASK64;
    this.advance();
  }

  private advance(): void {
    this.state = (this.state * PCG_MULT + this.inc) & MASK64;
  }

  /**
   * One PCG32 output (design 06 §4.1/§4.2). The output function reads the
   * pre-advance state:
   *
   *   xorshifted = ((old >> 18) XOR old) >> 27   (low 32 bits)
   *   rot        = old >> 59
   *   out        = 32-bit rotate right of xorshifted by rot
   */
  nextU32(): number {
    const old = this.state;
    this.advance();
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /**
   * Unbiased integer in [0, n) for n ≥ 1 — O'Neill's bounded variant,
   * pinned by design 06 §4.2: `threshold = 2^32 mod n`; loop
   * `r = nextU32()` until `r ≥ threshold`; return `r mod n`. No
   * fixed-modulo shortcut: bias is nondeterminism's quiet cousin across
   * future refactors of n.
   */
  nextRange(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 4294967296) {
      throw new RangeError(`prng: nextRange n must be an integer in [1, 2^32], got ${n}`);
    }
    const threshold = 4294967296 % n;
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) return r % n;
    }
  }

  /**
   * Fixed-point draw over inclusive RAW bounds (design 06 §4.2):
   * `lo + nextRange(hi − lo + 1)`. Domain bounds are inclusive in raw
   * units per design 06 §0 — a half-open authored domain like [0, 360)
   * is expressed by passing the largest raw inside it as `hi`.
   */
  nextFp(lo: number, hi: number): number {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) {
      throw new RangeError(`prng: nextFp requires integer raw bounds lo ≤ hi, got [${lo}, ${hi}]`);
    }
    return lo + this.nextRange(hi - lo + 1);
  }
}

/**
 * Stream factory of design 06 §4.1: the stream for a given
 * (genome_seed, locus_path, draw_name) triple. `genomeSeed` is the u64
 * `meta.seed` locus as a bigint; `drawName` defaults to `"sample"` — the
 * design 06 §0 default wherever a sampler paragraph does not name a draw.
 */
export function createStream(
  genomeSeed: bigint,
  locusPath: string,
  drawName = "sample",
): Pcg32Stream {
  const k = streamKey(locusPath, drawName);
  const u = (k ^ genomeSeed) & MASK64;
  const initstate = splitmix64(u);
  const initseq = splitmix64(initstate);
  return new Pcg32Stream(initstate, initseq);
}
