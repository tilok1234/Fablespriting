/**
 * Fablesprite — 16.16 signed fixed-point kernel (design 06 §5).
 *
 * Floats are banned in core (RISKS R6): every creature-space quantity is a
 * signed 32-bit two's-complement raw with value = raw / 2^16, domain
 * [−32768, +32768) (design 06 §5.1). This module has zero imports and zero
 * runtime dependencies by design: it is the innermost rasterizer math and
 * the cross-language determinism anchor — a second implementer must be able
 * to port it from design 06 §5 alone and produce bit-identical results.
 *
 * Overflow policy (design 06 §5.1): any op whose true result falls outside
 * int32 is a spec violation. The spec asks implementations to trap in debug
 * builds; this build has no debug/release split, so it always traps
 * (throws RangeError). Locus domains and the M1 template keep production
 * genomes far from the edges, so the checks never fire on valid input.
 */

/** Smallest int32 raw (−32768.0 in 16.16). */
export const INT32_MIN = -2147483648;
/** Largest int32 raw (32767.99998… in 16.16). */
export const INT32_MAX = 2147483647;

/** One in 16.16 raw units (2^16). */
export const FP_ONE = 65536;

function trapOverflow(op: string, result: number): number {
  if (result < INT32_MIN || result > INT32_MAX) {
    throw new RangeError(
      `fixed: ${op} overflow — true result ${result} outside int32 (design 06 §5.1 spec violation)`,
    );
  }
  return result;
}

/**
 * Fixed-point addition (design 06 §5.1): plain int32 addition.
 * Traps (RangeError) if the true sum leaves int32 — spec violation.
 */
export function fp_add(a: number, b: number): number {
  return trapOverflow("fp_add", a + b);
}

/**
 * Fixed-point subtraction (design 06 §5.1): plain int32 subtraction.
 * Traps (RangeError) if the true difference leaves int32 — spec violation.
 */
export function fp_sub(a: number, b: number): number {
  return trapOverflow("fp_sub", a - b);
}

/**
 * Arithmetic shift right: `asr(x, k) = floor(x / 2^k)` (design 06 §5.1).
 *
 * Truncation in the spec always floors toward −∞, never toward zero —
 * pinned explicitly for negative operands: `asr(−1, 1) = −1`. Implemented
 * with Math.floor, not `>>`: the porting note in design 06 §5.2 bans
 * bitwise ops because they force operands through ToInt32.
 */
export function asr(x: number, k: number): number {
  return Math.floor(x / 2 ** k);
}

/**
 * Round half to even of the rational `n / d` for integers n and d > 0 —
 * the RHE helper for rounding onto coarser grids (design 06 §5.1).
 *
 * Ties-to-even is the pinned rounding mode everywhere a value rounds to a
 * coarser grid: op results, `byte()` in §1.3, and craft-pass pixel
 * snapping. Load-bearing, not stylistic (S3 finding F14: half-up rounding
 * turned the wolf's exactly-±0.5 px bob into a 1-px square wave).
 *
 * Both |n| and d must stay within Number.MAX_SAFE_INTEGER; d must be a
 * positive integer.
 */
export function rheDiv(n: number, d: number): number {
  if (!Number.isInteger(d) || d <= 0) {
    throw new RangeError(`rheDiv divisor must be a positive integer, got ${d}`);
  }
  // Floor division with a one-step correction: Math.floor(n / d) can be
  // off by one ulp when the double quotient rounds across an integer.
  let q = Math.floor(n / d);
  let r = n - q * d;
  if (r < 0) {
    q -= 1;
    r += d;
  } else if (r >= d) {
    q += 1;
    r -= d;
  }
  const twice = 2 * r;
  if (twice > d) {
    q += 1;
  } else if (twice === d && q % 2 !== 0) {
    q += 1; // tie → even neighbor
  }
  return q;
}

/**
 * Fixed-point multiply: `fp_mul(a, b) = RHE(a·b / 2^16)` (design 06 §5.2).
 *
 * Split multiply in doubles (not BigInt — this is the innermost rasterizer
 * op), sign handled by symmetry (RHE is odd, so sign-magnitude is exact);
 * every intermediate stays below 2^53. Per the spec's porting note, the
 * decomposition uses Math.floor/%, never `>>`/`&`: bitwise ops ToInt32 the
 * operand, and the magnitude of raw −2^31 is 2^31, which is not
 * int32-representable — `2147483648 >> 16` wraps to −32768 and silently
 * flips the product's sign. Raw −2^31 stays domain-legal here.
 *
 * Traps (RangeError) if the true rounded product leaves int32.
 */
export function fp_mul(a: number, b: number): number {
  let s = 1;
  let am = a;
  let bm = b;
  if (am < 0) {
    s = -s;
    am = -am;
  }
  if (bm < 0) {
    s = -s;
    bm = -bm;
  }
  const ah = Math.floor(am / 65536);
  const al = am % 65536;
  const bh = Math.floor(bm / 65536);
  const bl = bm % 65536;
  const low = al * bl; // < 2^32
  let q = ah * bh * 65536 + ah * bl + al * bh + Math.floor(low / 65536); // < 2^47
  const r = low % 65536;
  if (r > 32768) {
    q += 1;
  } else if (r === 32768) {
    q += q % 2; // ties to even (q is non-negative here)
  }
  const out = s < 0 ? (q === 0 ? 0 : -q) : q;
  return trapOverflow("fp_mul", out);
}

/**
 * Fixed-point divide: `fp_div(a, b) = RHE(a·2^16 / b)`, b ≠ 0
 * (design 06 §5.2). Divides occur per slab per frame, never per sample, so
 * BigInt exactness is permitted by the spec's hot-path note — only the
 * mathematical result is normative.
 *
 * Throws RangeError on b = 0 and traps if the true quotient leaves int32.
 */
export function fp_div(a: number, b: number): number {
  if (b === 0) {
    throw new RangeError("fixed: fp_div by zero (design 06 §5.2 requires b ≠ 0)");
  }
  let n = BigInt(a) << 16n;
  let d = BigInt(b);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  // Floor division with non-negative remainder (BigInt / truncates to zero).
  let q = n / d;
  let r = n % d;
  if (r < 0n) {
    q -= 1n;
    r += d;
  }
  const twice = r << 1n;
  if (twice > d) {
    q += 1n;
  } else if (twice === d) {
    q += q & 1n; // ties to even (two's-complement & gives 1 for odd q of either sign)
  }
  return trapOverflow("fp_div", Number(q));
}

/**
 * Fixed-point square root: `fp_sqrt(a) = RHE(√(a·2^16))` for a ≥ 0 — that
 * is, RHE of √(value)·2^16 (design 06 §5.2).
 *
 * A tie is impossible ((q+½)² is never an integer), so nearest is decided
 * by integer remainder comparison per the spec's reference algorithm:
 * `q = isqrt(a·2^16); if a·2^16 − q² > q: q += 1`. Both a·2^16 (< 2^47)
 * and q² are exact in doubles. The result never overflows int32.
 *
 * Throws RangeError on a < 0.
 */
export function fp_sqrt(a: number): number {
  if (a < 0) {
    throw new RangeError("fixed: fp_sqrt of negative raw (design 06 §5.2 requires a ≥ 0)");
  }
  const n = a * 65536; // exact: < 2^47
  let q = Math.floor(Math.sqrt(n));
  // Math.sqrt is correctly rounded, but the floor of the double can still
  // land one off the integer square root at exactness boundaries — correct.
  while (q * q > n) q -= 1;
  while ((q + 1) * (q + 1) <= n) q += 1;
  if (n - q * q > q) q += 1;
  return q;
}

/**
 * Quarter-wave of the design 06 §5.3 sine table: entries i = 0..1024 of
 * `SIN_TABLE[i] = RHE(sin(2π·i/4096) · 65536)`, embedded as literal
 * constants — Math.sin at runtime is NOT bit-identical across JS engines,
 * so the values were generated offline at double precision (the spec
 * guarantees no entry lies within 5×10⁻⁴ of a rounding tie) and are pinned
 * here. The remaining three quadrants follow by exact symmetry
 * (sin(π−x) = sin(x), sin(π+x) = −sin(x); RHE is odd, so the mirrored
 * entries are identical integers). The full decoded table is what the
 * spec's FNV-1a64 checksum 0x00361da115eb6196 pins, verified in tests.
 */
const SIN_QUARTER: readonly number[] = [
  0, 101, 201, 302, 402, 503, 603, 704, 804, 905, 1005, 1106, 1206, 1307, 1407, 1508,
  1608, 1709, 1809, 1910, 2010, 2111, 2211, 2312, 2412, 2513, 2613, 2714, 2814, 2914, 3015, 3115,
  3216, 3316, 3417, 3517, 3617, 3718, 3818, 3918, 4019, 4119, 4219, 4320, 4420, 4520, 4621, 4721,
  4821, 4921, 5022, 5122, 5222, 5322, 5422, 5523, 5623, 5723, 5823, 5923, 6023, 6123, 6224, 6324,
  6424, 6524, 6624, 6724, 6824, 6924, 7024, 7124, 7224, 7323, 7423, 7523, 7623, 7723, 7823, 7923,
  8022, 8122, 8222, 8322, 8421, 8521, 8621, 8720, 8820, 8919, 9019, 9119, 9218, 9318, 9417, 9517,
  9616, 9716, 9815, 9914, 10014, 10113, 10212, 10312, 10411, 10510, 10609, 10709, 10808, 10907, 11006, 11105,
  11204, 11303, 11402, 11501, 11600, 11699, 11798, 11897, 11996, 12095, 12193, 12292, 12391, 12490, 12588, 12687,
  12785, 12884, 12983, 13081, 13180, 13278, 13376, 13475, 13573, 13672, 13770, 13868, 13966, 14065, 14163, 14261,
  14359, 14457, 14555, 14653, 14751, 14849, 14947, 15045, 15143, 15240, 15338, 15436, 15534, 15631, 15729, 15826,
  15924, 16021, 16119, 16216, 16314, 16411, 16508, 16606, 16703, 16800, 16897, 16994, 17091, 17188, 17285, 17382,
  17479, 17576, 17673, 17770, 17867, 17963, 18060, 18156, 18253, 18350, 18446, 18543, 18639, 18735, 18832, 18928,
  19024, 19120, 19216, 19313, 19409, 19505, 19600, 19696, 19792, 19888, 19984, 20080, 20175, 20271, 20366, 20462,
  20557, 20653, 20748, 20844, 20939, 21034, 21129, 21224, 21320, 21415, 21510, 21604, 21699, 21794, 21889, 21984,
  22078, 22173, 22268, 22362, 22457, 22551, 22645, 22740, 22834, 22928, 23022, 23116, 23210, 23304, 23398, 23492,
  23586, 23680, 23774, 23867, 23961, 24054, 24148, 24241, 24335, 24428, 24521, 24614, 24708, 24801, 24894, 24987,
  25080, 25172, 25265, 25358, 25451, 25543, 25636, 25728, 25821, 25913, 26005, 26098, 26190, 26282, 26374, 26466,
  26558, 26650, 26742, 26833, 26925, 27017, 27108, 27200, 27291, 27382, 27474, 27565, 27656, 27747, 27838, 27929,
  28020, 28111, 28202, 28293, 28383, 28474, 28564, 28655, 28745, 28835, 28926, 29016, 29106, 29196, 29286, 29376,
  29466, 29555, 29645, 29735, 29824, 29914, 30003, 30093, 30182, 30271, 30360, 30449, 30538, 30627, 30716, 30805,
  30893, 30982, 31071, 31159, 31248, 31336, 31424, 31512, 31600, 31688, 31776, 31864, 31952, 32040, 32127, 32215,
  32303, 32390, 32477, 32565, 32652, 32739, 32826, 32913, 33000, 33087, 33173, 33260, 33347, 33433, 33520, 33606,
  33692, 33778, 33865, 33951, 34037, 34122, 34208, 34294, 34380, 34465, 34551, 34636, 34721, 34806, 34892, 34977,
  35062, 35146, 35231, 35316, 35401, 35485, 35570, 35654, 35738, 35823, 35907, 35991, 36075, 36159, 36243, 36326,
  36410, 36493, 36577, 36660, 36744, 36827, 36910, 36993, 37076, 37159, 37241, 37324, 37407, 37489, 37572, 37654,
  37736, 37818, 37900, 37982, 38064, 38146, 38228, 38309, 38391, 38472, 38554, 38635, 38716, 38797, 38878, 38959,
  39040, 39120, 39201, 39282, 39362, 39442, 39523, 39603, 39683, 39763, 39843, 39922, 40002, 40082, 40161, 40241,
  40320, 40399, 40478, 40557, 40636, 40715, 40794, 40872, 40951, 41029, 41108, 41186, 41264, 41342, 41420, 41498,
  41576, 41653, 41731, 41808, 41886, 41963, 42040, 42117, 42194, 42271, 42348, 42424, 42501, 42578, 42654, 42730,
  42806, 42882, 42958, 43034, 43110, 43186, 43261, 43337, 43412, 43487, 43562, 43638, 43713, 43787, 43862, 43937,
  44011, 44086, 44160, 44234, 44308, 44382, 44456, 44530, 44604, 44677, 44751, 44824, 44898, 44971, 45044, 45117,
  45190, 45262, 45335, 45408, 45480, 45552, 45625, 45697, 45769, 45841, 45912, 45984, 46056, 46127, 46199, 46270,
  46341, 46412, 46483, 46554, 46624, 46695, 46765, 46836, 46906, 46976, 47046, 47116, 47186, 47256, 47325, 47395,
  47464, 47534, 47603, 47672, 47741, 47809, 47878, 47947, 48015, 48084, 48152, 48220, 48288, 48356, 48424, 48491,
  48559, 48626, 48694, 48761, 48828, 48895, 48962, 49029, 49095, 49162, 49228, 49295, 49361, 49427, 49493, 49559,
  49624, 49690, 49756, 49821, 49886, 49951, 50016, 50081, 50146, 50211, 50275, 50340, 50404, 50468, 50532, 50596,
  50660, 50724, 50787, 50851, 50914, 50977, 51041, 51104, 51166, 51229, 51292, 51354, 51417, 51479, 51541, 51603,
  51665, 51727, 51789, 51850, 51911, 51973, 52034, 52095, 52156, 52217, 52277, 52338, 52398, 52459, 52519, 52579,
  52639, 52699, 52759, 52818, 52878, 52937, 52996, 53055, 53114, 53173, 53232, 53290, 53349, 53407, 53465, 53523,
  53581, 53639, 53697, 53754, 53812, 53869, 53926, 53983, 54040, 54097, 54154, 54210, 54267, 54323, 54379, 54435,
  54491, 54547, 54603, 54658, 54714, 54769, 54824, 54879, 54934, 54989, 55043, 55098, 55152, 55206, 55260, 55314,
  55368, 55422, 55476, 55529, 55582, 55636, 55689, 55742, 55794, 55847, 55900, 55952, 56004, 56056, 56108, 56160,
  56212, 56264, 56315, 56367, 56418, 56469, 56520, 56571, 56621, 56672, 56722, 56773, 56823, 56873, 56923, 56972,
  57022, 57072, 57121, 57170, 57219, 57268, 57317, 57366, 57414, 57463, 57511, 57559, 57607, 57655, 57703, 57750,
  57798, 57845, 57892, 57939, 57986, 58033, 58079, 58126, 58172, 58219, 58265, 58311, 58356, 58402, 58448, 58493,
  58538, 58583, 58628, 58673, 58718, 58763, 58807, 58851, 58896, 58940, 58983, 59027, 59071, 59114, 59158, 59201,
  59244, 59287, 59330, 59372, 59415, 59457, 59499, 59541, 59583, 59625, 59667, 59708, 59750, 59791, 59832, 59873,
  59914, 59954, 59995, 60035, 60075, 60116, 60156, 60195, 60235, 60275, 60314, 60353, 60392, 60431, 60470, 60509,
  60547, 60586, 60624, 60662, 60700, 60738, 60776, 60813, 60851, 60888, 60925, 60962, 60999, 61035, 61072, 61108,
  61145, 61181, 61217, 61253, 61288, 61324, 61359, 61394, 61429, 61464, 61499, 61534, 61568, 61603, 61637, 61671,
  61705, 61739, 61772, 61806, 61839, 61873, 61906, 61939, 61971, 62004, 62036, 62069, 62101, 62133, 62165, 62197,
  62228, 62260, 62291, 62322, 62353, 62384, 62415, 62445, 62476, 62506, 62536, 62566, 62596, 62626, 62655, 62685,
  62714, 62743, 62772, 62801, 62830, 62858, 62886, 62915, 62943, 62971, 62998, 63026, 63054, 63081, 63108, 63135,
  63162, 63189, 63215, 63242, 63268, 63294, 63320, 63346, 63372, 63397, 63423, 63448, 63473, 63498, 63523, 63547,
  63572, 63596, 63621, 63645, 63668, 63692, 63716, 63739, 63763, 63786, 63809, 63832, 63854, 63877, 63899, 63922,
  63944, 63966, 63987, 64009, 64031, 64052, 64073, 64094, 64115, 64136, 64156, 64177, 64197, 64217, 64237, 64257,
  64277, 64296, 64316, 64335, 64354, 64373, 64392, 64410, 64429, 64447, 64465, 64483, 64501, 64519, 64536, 64554,
  64571, 64588, 64605, 64622, 64639, 64655, 64672, 64688, 64704, 64720, 64735, 64751, 64766, 64782, 64797, 64812,
  64827, 64841, 64856, 64870, 64884, 64899, 64912, 64926, 64940, 64953, 64967, 64980, 64993, 65006, 65018, 65031,
  65043, 65055, 65067, 65079, 65091, 65103, 65114, 65126, 65137, 65148, 65159, 65169, 65180, 65190, 65200, 65210,
  65220, 65230, 65240, 65249, 65259, 65268, 65277, 65286, 65294, 65303, 65311, 65320, 65328, 65336, 65343, 65351,
  65358, 65366, 65373, 65380, 65387, 65393, 65400, 65406, 65413, 65419, 65425, 65430, 65436, 65442, 65447, 65452,
  65457, 65462, 65467, 65471, 65476, 65480, 65484, 65488, 65492, 65495, 65499, 65502, 65505, 65508, 65511, 65514,
  65516, 65519, 65521, 65523, 65525, 65527, 65528, 65530, 65531, 65532, 65533, 65534, 65535, 65535, 65536, 65536,
  65536,
];

function buildSinTable(): Int32Array {
  const t = new Int32Array(4096);
  for (let i = 0; i <= 1024; i++) t[i] = SIN_QUARTER[i]!;
  for (let i = 1025; i < 2048; i++) t[i] = SIN_QUARTER[2048 - i]!;
  for (let i = 2048; i < 4096; i++) t[i] = -t[i - 2048]!;
  return t;
}

/**
 * The 4096-entry sine lookup table of design 06 §5.3:
 * `SIN_TABLE[i] = RHE(sin(2π·i/4096) · 65536)`. No interpolation; arguments
 * are fp turns. Pinned identity: FNV-1a64 over the entries serialized as
 * little-endian int32 = 0x00361da115eb6196; entry sum = 0 (both
 * golden-tested). Resolution 2^−12 turns ≈ 0.088°.
 */
export const SIN_TABLE: Readonly<Int32Array> = buildSinTable();

/**
 * `sin_fp(x) = SIN_TABLE[(x >> 4) & 4095]` — x in fp turns; the shift is
 * an asr (floor) and the index wraps mod 4096 (design 06 §5.3). Negative
 * turns wrap up: sin_fp(−0.25 turns) = −65536.
 */
export function sin_fp(x: number): number {
  const idx = ((Math.floor(x / 16) % 4096) + 4096) % 4096;
  return SIN_TABLE[idx]!;
}

/**
 * `cos_fp(x) = sin_fp(x + 16384)` — quarter-turn phase lead
 * (design 06 §5.3). The un-wrapped sum never misindexes: 2^32 raw turns is
 * an exact multiple of the table period, so int32 wrap-around is a no-op
 * on the index.
 */
export function cos_fp(x: number): number {
  return sin_fp(x + 16384);
}
