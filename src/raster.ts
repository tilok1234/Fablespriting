/**
 * Fablesprite — projection + rasterization (design 04 §§2–3, design 06 §1.2
 * pinned rasterization block, §1.3 tone thresholds, §1.4 pinned arithmetic).
 *
 * slabs → tagged pixel grid: this module implements the fixed camera
 * (orthographic along +y with top-down shear TILT), the four quarter-turn
 * yaw directions, the S×S supersampled per-sample ray/ellipsoid
 * intersection (P3), the majority-vote pixel resolve with the pinned
 * coverage threshold and tie-breaks, and the surface-tone quantization.
 * Everything is 16.16 fixed point through fixed.ts (RISKS R6): no floats,
 * no PRNG, fully deterministic. A second implementer must be able to
 * reproduce the pixels from design 06 §§1.2/1.4 alone — the numbered step
 * orders in the doc comments below are transcribed there as normative text.
 *
 * Screen mapping (design 04 §2): sx = x, sy = −z − TILT·y, depth = y.
 * Invariant P1: smaller depth = closer to camera, and the −TILT term puts
 * closer geometry LOWER in the sprite (a creature facing "down" leads with
 * its head at the sprite's bottom).
 */

import { FP_ONE, fp_add, fp_div, fp_mul, fp_sqrt, fp_sub, rheDiv } from "./fixed.js";
import type { MaterialRole, Slab } from "./pose.js";

// ---------------------------------------------------------------------------
// Pinned constants (design 06 §1.2 rasterization block)
// ---------------------------------------------------------------------------

/** TILT = 0.5 (D3, P2) — the global top-down shear, raw RHE(0.5·2^16). */
export const TILT_RAW = 32768;

/**
 * The pinned normalized light direction raw (−29565, −36135, 45990) — the
 * normalized (−0.45, −0.55, 0.70), upper-left and slightly toward camera,
 * shared by the whole bestiary (design 04 §3, design 06 §1.2).
 */
export const LIGHT_RAW: readonly [number, number, number] = Object.freeze([
  -29565, -36135, 45990,
]) as [number, number, number];

/** Coverage threshold 0.42 at 32×32 (S1/F4), raw RHE(0.42·2^16). */
export const COVERAGE_RAW = 27525;

/** Supersample grid side S = 4 (S1-validated; design 06 §1.2 pins S = 4). */
export const SUPERSAMPLE = 4;

/**
 * The exact per-sample offset raws (ix+0.5)/S for S = 4 (design 06 §1.2):
 * {0.125, 0.375, 0.625, 0.875} = {8192, 24576, 40960, 57344}. Sample
 * (ix, iy) of output pixel (px, py) is cast at
 * (px + OFF[ix] − ox, py + OFF[iy] − oy), all in fp raws.
 */
export const SAMPLE_OFFSETS: readonly number[] = Object.freeze([
  8192, 24576, 40960, 57344,
]);

/**
 * Direction names — the spike's DIRECTIONS table, normative via
 * design 06 §1.2 ("Directions = yawing the creature 0/90/180/270°").
 */
export type Direction = "down" | "left" | "up" | "right";

/** All four directions in the spike's table order. */
export const DIRECTIONS: readonly Direction[] = Object.freeze([
  "down",
  "left",
  "up",
  "right",
]);

/**
 * Quarter-turn CCW yaw count per direction — exactly the spike's
 * `DIRECTIONS = {"down": 2, "left": 1, "up": 0, "right": 3}`.
 */
export const DIRECTION_TURNS: Readonly<Record<Direction, number>> = Object.freeze({
  down: 2,
  left: 1,
  up: 0,
  right: 3,
});

/**
 * Material-role wire ids used by the vote key and by
 * {@link serializeRasterGrid}: hide = 0, underside = 1, focal = 2 — the
 * order the roles appear in design 06 §1.3 ("hide, underside, focal").
 */
export const ROLE_IDS: Readonly<Record<MaterialRole, number>> = Object.freeze({
  hide: 0,
  underside: 1,
  focal: 2,
});

/** ROLE_IDS inverted: the role at each wire id. */
export const ROLE_NAMES: readonly MaterialRole[] = Object.freeze([
  "hide",
  "underside",
  "focal",
]);

/**
 * Tone thresholds by `palette.ramp_len` (design 06 §1.3, exact table):
 * ascending raw thresholds; tone t is the number of thresholds the shading
 * dot product d strictly exceeds, so tone ∈ [0, ramp_len − 2] (rasterizer
 * tone t maps to ramp slot t + 1).
 *
 * | ramp_len | thresholds (dark ← → light)                  |
 * |----------|----------------------------------------------|
 * | 3        | light iff d > 0.025 (1638)                   |
 * | 4        | mid iff d > −0.25 (−16384), light iff d > 0.30 (19661) — the S1 values |
 * | 5        | d > −0.35 (−22938), d > 0.15 (9830), d > 0.55 (36045) |
 *
 * Raws are RHE(d·2^16) per the design 06 notation rule. Focal pixels
 * ALWAYS quantize on the ramp_len = 4 row, whatever the genome says
 * (§1.3: the focal table has exactly slots 0..3, so focal tone stays in
 * {0, 1, 2} for every genome).
 */
export const TONE_THRESHOLDS: Readonly<Record<3 | 4 | 5, readonly number[]>> =
  Object.freeze({
    3: Object.freeze([1638]),
    4: Object.freeze([-16384, 19661]),
    5: Object.freeze([-22938, 9830, 36045]),
  });

// ---------------------------------------------------------------------------
// Yaw (design 04 §2: extents permute exactly at quarter turns)
// ---------------------------------------------------------------------------

/**
 * Yaw a slab by CCW quarter turns about z: each turn maps center
 * (x, y) → (−y, x) and swaps the (x, y) half-extents at odd turn counts —
 * exact integer permutation/negation, no resampling error (P4's "true
 * projections" rest on this). Negative or ≥ 4 turn counts wrap mod 4.
 */
export function yawSlab(slab: Slab, quarterTurns: number): Slab {
  if (!Number.isInteger(quarterTurns)) {
    throw new RangeError(`raster: quarterTurns must be an integer, got ${quarterTurns}`);
  }
  const q = ((quarterTurns % 4) + 4) % 4;
  let x = slab.cx;
  let y = slab.cy;
  for (let i = 0; i < q; i++) {
    const nx = fp_sub(0, y); // −y (trapped negation)
    y = x;
    x = nx;
  }
  const swap = q % 2 === 1;
  return Object.freeze({
    cx: x,
    cy: y,
    cz: slab.cz,
    hx: swap ? slab.hy : slab.hx,
    hy: swap ? slab.hx : slab.hy,
    hz: slab.hz,
    role: slab.role,
  });
}

// ---------------------------------------------------------------------------
// Output grid
// ---------------------------------------------------------------------------

/** One opaque pixel of the tagged grid (design 04 §4 machinery inputs). */
export interface RasterPixel {
  /** Material role of the winning (material, tone) vote key. */
  readonly role: MaterialRole;
  /**
   * Quantized tone of the winning key: 0..ramp_len−2 for hide/underside
   * (0..2 at the default ramp_len = 4), always 0..2 for focal.
   */
  readonly tone: number;
  /**
   * Part tag = slab index into the input slab list (design 06 §1.2: the
   * slab-list order is normative; part-tag ids index it). Majority part
   * among the winning key's samples; ties on the part vote count are
   * broken in favor of the part whose first contributing sample (among
   * the winning key's samples) occurs earliest in the pinned scan order —
   * the same first-seen rule as the (material, tone) vote (design 06 §1.4).
   */
  readonly partId: number;
  /**
   * The per-pixel depth tag design 04 §4 rule 4 consumes: the mean entry
   * depth of the winning key's samples, RHE-rounded to a 16.16 raw
   * (rheDiv(sum of entry depths, sample count)) — design 06 §1.4.
   */
  readonly depthRaw: number;
}

/** The tagged grid: `grid[py][px]` is null (transparent) or a pixel tag. */
export type RasterGrid = ReadonlyArray<ReadonlyArray<RasterPixel | null>>;

// ---------------------------------------------------------------------------
// rasterize
// ---------------------------------------------------------------------------

/**
 * Per-slab projection constants, computed once per rasterize call
 * (design 06 §5.2's placement note: divides happen per slab per frame,
 * never per sample). See {@link rasterize} for the numbered step orders.
 */
interface SlabSetup {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly hy: number;
  readonly roleId: number;
  /** P2. Zs = −fp_div(fp_mul(TILT_RAW, hy), hz). */
  readonly zs: number;
  /** P3. A = FP_ONE + fp_mul(Zs, Zs). */
  readonly a: number;
  /** P4. invA = fp_div(FP_ONE, A). */
  readonly invA: number;
  /** T1. invE2 per axis = fp_div(FP_ONE, fp_mul(h, h)). */
  readonly invE2x: number;
  readonly invE2y: number;
  readonly invE2z: number;
  /** Per sample-column: X = fp_div(sx − cx, hx); X2 = fp_mul(X, X). */
  readonly colOneMinusX2: Int32Array;
  /** Per sample-row: Z0 = fp_div(w, hz); precomputed Z0², and B0 = fp_mul(Z0, Zs). */
  readonly rowZ0sq: Int32Array;
  readonly rowB0: Int32Array;
}

/**
 * Rasterize a model-space slab list to the tagged 32×32 grid for one
 * facing direction — design 04 §§2–3 with every constant and order pinned
 * by design 06 §1.2.
 *
 * `slabs` is the pose layer's output (poseQuadruped); **its order is the
 * part-tag id space** (design 06 §1.2 normative slab order). `size`
 * defaults to 32 — the only resolution the spec pins (16×16 descoped, D5);
 * other sizes follow the spike's general anchor/scale formula and are
 * provided for craft-rule resolution context only. `rampLen` is the
 * genome's `palette.ramp_len` (3 | 4 | 5), selecting the §1.3 tone
 * threshold row for hide/underside samples; focal samples always use the
 * ramp_len = 4 row.
 *
 * Frame anchors (design 06 §1.2, from spike lines 222–223): ox = size/2,
 * oy = size·(26.5/32) — at 32×32 the raws (1048576, 1736704); oy is the
 * ground line. Sample (ix, iy) of pixel (px, py) is cast at
 * ((px·2^16 + OFF[ix] − ox)/scale, (py·2^16 + OFF[iy] − oy)/scale) with
 * OFF = {@link SAMPLE_OFFSETS}, scale = size/32 in raw (exact: size·2^11;
 * at size 32 the fp_div by 1.0 is the identity). Pinned scan order within
 * a pixel: iy outer ascending, ix inner ascending; pixels scan py outer
 * ascending, px inner ascending.
 *
 * **Ray/ellipsoid intersection — pinned fixed-point step order.** The
 * quadratic in depth y of design 04 §2/P3 (the spike's `ray_hit`) is
 * evaluated in the ellipsoid-normalized frame: substituting
 * X = (sx−cx)/hx, Y = (y−cy)/hy, Z = (z−cz)/hz with z = −TILT·y − sy
 * gives Z = Z0 + Zs·Y and X² + Y² + (Z0 + Zs·Y)² = 1, whose discriminant
 * factors as disc/4 = (1+Zs²)(1−X²) − Z0². This is algebraically the
 * spike's B² − 4AC over the reals; the raw A/B/C form is NOT used because
 * its B² intermediate overflows int32 for legal domain-extreme genomes,
 * while every intermediate below stays inside the 16.16 domain. The
 * normative steps (all ops are fixed.ts ops; per-slab steps P1–P4 and T1
 * run once per slab, per-column/row steps C1/R1 once per sample column /
 * row, steps Q1–Q5 once per sample):
 *
 * ```
 * P1. tiltCy = fp_mul(TILT_RAW, cy)
 * P2. Zs     = fp_sub(0, fp_div(fp_mul(TILT_RAW, hy), hz))
 * P3. A      = fp_add(FP_ONE, fp_mul(Zs, Zs))
 * P4. invA   = fp_div(FP_ONE, A)
 * C1. X = fp_div(fp_sub(sx, cx), hx); if |X| > FP_ONE → miss; else
 *     oneMinusX2 = fp_sub(FP_ONE, fp_mul(X, X)). The |X| test is exactly
 *     equivalent to oneMinusX2 < 0 (fp_mul is monotone in |X| on integers:
 *     RHE(X²/2^16) > 2^16 ⟺ |X| > 2^16), and it is required — it keeps
 *     both the squaring and Q1's fp_mul inside int32 (X² > 1 misses in x)
 * R1. w      = fp_sub(fp_sub(fp_sub(0, tiltCy), sy), cz)
 *     Z0     = fp_div(w, hz);  Z0sq = fp_mul(Z0, Z0);  B0 = fp_mul(Z0, Zs)
 * Q1. Q      = fp_sub(fp_mul(A, oneMinusX2), Z0sq)
 * Q2. if Q < 0 → miss (disc < 0; Q = 0 is a tangent hit, as in the spike)
 * Q3. sqrtQ  = fp_sqrt(Q)
 * Q4. Y      = fp_mul(fp_sub(fp_sub(0, B0), sqrtQ), invA)   — the smaller
 *     root = entry (closer to camera)
 * Q5. depth  = fp_add(cy, fp_mul(hy, Y))
 *     hit z  = fp_sub(fp_sub(0, fp_mul(TILT_RAW, depth)), sy)
 *     hit point p = (sx, depth, z)
 * ```
 *
 * **Nearest-sample selection**: slabs are scanned in ascending slab-index
 * order; the smallest entry depth wins, compared with strict `<` — so on
 * exactly equal entry depth raws the LOWER SLAB INDEX wins (design 06 §1.4).
 *
 * **Tone — pinned fixed-point step order** (design 04 §3 / the spike's
 * `surface_tone`): the ellipsoid normal at the hit point, normalized,
 * dotted with {@link LIGHT_RAW}, quantized by {@link TONE_THRESHOLDS}:
 *
 * ```
 * T1. invE2_i = fp_div(FP_ONE, fp_mul(h_i, h_i))       (per slab, per axis)
 * T2. n_i     = fp_mul(fp_sub(p_i, c_i), invE2_i)      ((p−c)/h² per axis)
 * T3. L       = fp_sqrt(fp_add(fp_add(fp_mul(nx,nx), fp_mul(ny,ny)), fp_mul(nz,nz)))
 * T4. invL    = L == 0 ? FP_ONE : fp_div(FP_ONE, L)    (zero guard — the
 *     spike's `or 1.0`: a degenerate normal is used unnormalized)
 * T5. u_i     = fp_mul(n_i, invL)
 * T6. d       = fp_add(fp_add(fp_mul(ux, Lx), fp_mul(uy, Ly)), fp_mul(uz, Lz))
 * T7. tone    = number of row thresholds d strictly exceeds (row = the
 *     §1.3 ramp_len row; focal always the ramp_len = 4 row)
 * ```
 *
 * **Pixel resolve** (design 06 §1.2, exact): a pixel is opaque iff
 * `hits · 2^16 ≥ S² · COVERAGE_RAW` as plain integer math (at S = 4,
 * 32×32: hits·65536 ≥ 440400, i.e. hits ≥ 7) — NOT a precomputed rounded
 * sample count, so the boundary is bit-exact against the raw threshold.
 * The winning (material, tone) key has the most contributing samples;
 * ties on vote count break to the key whose first contributing sample is
 * earliest in the pinned scan order. partId and depthRaw per
 * {@link RasterPixel}.
 */
export function rasterize(
  slabs: readonly Slab[],
  direction: Direction,
  size = 32,
  rampLen: 3 | 4 | 5 = 4,
): RasterGrid {
  const turns = DIRECTION_TURNS[direction];
  if (turns === undefined) {
    throw new RangeError(`raster: unknown direction ${JSON.stringify(direction)}`);
  }
  if (!Number.isInteger(size) || size < 1 || size > 255) {
    throw new RangeError(`raster: size must be an integer in [1, 255], got ${size}`);
  }
  const bodyThresholds = TONE_THRESHOLDS[rampLen];
  if (bodyThresholds === undefined) {
    throw new RangeError(`raster: ramp_len must be 3, 4, or 5, got ${rampLen}`);
  }
  const focalThresholds = TONE_THRESHOLDS[4];
  if (slabs.length > 255) {
    throw new RangeError(`raster: at most 255 slabs (part tags are bytes), got ${slabs.length}`);
  }

  const s = SUPERSAMPLE;
  const ss = s * s;
  const nCols = size * s;

  // Frame anchor raws: ox = size/2 → size·2^15; oy = size·(26.5/32) →
  // size·54272 (26.5·2^16/32 = 54272 exactly). Scale = size/32 in raw =
  // size·2^11 (exact); at size 32 scale = FP_ONE and the fp_div is the
  // identity (RHE(x·2^16/2^16) = x).
  const oxRaw = size * 32768;
  const oyRaw = size * 54272;
  const scaleRaw = size * 2048;

  // Sample coordinates per column (px, ix) and row (py, iy), in model raws.
  const colSx = new Int32Array(nCols);
  const rowSy = new Int32Array(nCols);
  for (let cell = 0; cell < size; cell++) {
    for (let i = 0; i < s; i++) {
      colSx[cell * s + i] = fp_div(cell * 65536 + SAMPLE_OFFSETS[i]! - oxRaw, scaleRaw);
      rowSy[cell * s + i] = fp_div(cell * 65536 + SAMPLE_OFFSETS[i]! - oyRaw, scaleRaw);
    }
  }

  // Yaw the slabs (exact permutation) and run the per-slab setup steps.
  const setups: SlabSetup[] = slabs.map((raw) => {
    const sl = yawSlab(raw, turns);
    const tiltCy = fp_mul(TILT_RAW, sl.cy); // P1
    const zs = fp_sub(0, fp_div(fp_mul(TILT_RAW, sl.hy), sl.hz)); // P2
    const a = fp_add(FP_ONE, fp_mul(zs, zs)); // P3
    const invA = fp_div(FP_ONE, a); // P4
    // C1 per column. The miss test |X| > FP_ONE is exactly equivalent to
    // fp_sub(FP_ONE, fp_mul(X, X)) < 0 (fp_mul is monotone on |X| here:
    // RHE(X²/2^16) > 2^16 ⟺ |X| > 2^16 for integer X) and keeps the
    // squaring inside int32 for arbitrarily distant columns. Missed
    // columns store −1 as the sentinel.
    const colOneMinusX2 = new Int32Array(nCols);
    for (let c = 0; c < nCols; c++) {
      const x = fp_div(fp_sub(colSx[c]!, sl.cx), sl.hx); // C1
      colOneMinusX2[c] =
        x > FP_ONE || x < -FP_ONE ? -1 : fp_sub(FP_ONE, fp_mul(x, x));
    }
    const rowZ0sq = new Int32Array(nCols);
    const rowB0 = new Int32Array(nCols);
    for (let r = 0; r < nCols; r++) {
      const w = fp_sub(fp_sub(fp_sub(0, tiltCy), rowSy[r]!), sl.cz); // R1
      const z0 = fp_div(w, sl.hz);
      rowZ0sq[r] = fp_mul(z0, z0);
      rowB0[r] = fp_mul(z0, zs);
    }
    return {
      cx: sl.cx,
      cy: sl.cy,
      cz: sl.cz,
      hy: sl.hy,
      roleId: ROLE_IDS[sl.role],
      zs,
      a,
      invA,
      invE2x: fp_div(FP_ONE, fp_mul(sl.hx, sl.hx)), // T1
      invE2y: fp_div(FP_ONE, fp_mul(sl.hy, sl.hy)),
      invE2z: fp_div(FP_ONE, fp_mul(sl.hz, sl.hz)),
      colOneMinusX2,
      rowZ0sq,
      rowB0,
    };
  });

  const n = setups.length;
  const grid: (RasterPixel | null)[][] = [];

  // Per-pixel vote state, insertion-ordered (Map preserves insertion
  // order, which IS the first-contributing-sample order — the pinned
  // vote and part tie-breaks fall out of iterating it front to back).
  interface KeyVote {
    count: number;
    depthSum: number;
    parts: Map<number, number>;
  }

  for (let py = 0; py < size; py++) {
    const row: (RasterPixel | null)[] = [];
    for (let px = 0; px < size; px++) {
      const votes = new Map<number, KeyVote>();
      let hits = 0;
      for (let iy = 0; iy < s; iy++) {
        const r = py * s + iy;
        for (let ix = 0; ix < s; ix++) {
          const c = px * s + ix;
          // Nearest slab: ascending index, strict < — lower index wins ties.
          let best = -1;
          let bestDepth = 0;
          for (let j = 0; j < n; j++) {
            const su = setups[j]!;
            const oneMinusX2 = su.colOneMinusX2[c]!;
            if (oneMinusX2 < 0) continue; // C1 miss
            const q = fp_sub(fp_mul(su.a, oneMinusX2), su.rowZ0sq[r]!); // Q1
            if (q < 0) continue; // Q2 miss
            const sqrtQ = fp_sqrt(q); // Q3
            const y = fp_mul(fp_sub(fp_sub(0, su.rowB0[r]!), sqrtQ), su.invA); // Q4
            const depth = fp_add(su.cy, fp_mul(su.hy, y)); // Q5
            if (best < 0 || depth < bestDepth) {
              best = j;
              bestDepth = depth;
            }
          }
          if (best < 0) continue;
          hits++;
          const su = setups[best]!;
          // Q5 hit point → tone steps T2–T7.
          const pxm = colSx[c]!;
          const pzm = fp_sub(fp_sub(0, fp_mul(TILT_RAW, bestDepth)), rowSy[r]!);
          const nx = fp_mul(fp_sub(pxm, su.cx), su.invE2x); // T2
          const ny = fp_mul(fp_sub(bestDepth, su.cy), su.invE2y);
          const nz = fp_mul(fp_sub(pzm, su.cz), su.invE2z);
          const len = fp_sqrt(
            fp_add(fp_add(fp_mul(nx, nx), fp_mul(ny, ny)), fp_mul(nz, nz)),
          ); // T3
          const invL = len === 0 ? FP_ONE : fp_div(FP_ONE, len); // T4
          const ux = fp_mul(nx, invL); // T5
          const uy = fp_mul(ny, invL);
          const uz = fp_mul(nz, invL);
          const d = fp_add(
            fp_add(fp_mul(ux, LIGHT_RAW[0]!), fp_mul(uy, LIGHT_RAW[1]!)),
            fp_mul(uz, LIGHT_RAW[2]!),
          ); // T6
          const thresholds = su.roleId === ROLE_IDS.focal ? focalThresholds : bodyThresholds;
          let tone = 0; // T7
          for (const t of thresholds) if (d > t) tone++;
          const key = su.roleId * 4 + tone; // tone ≤ 3, roleId ≤ 2 — injective
          let vote = votes.get(key);
          if (vote === undefined) {
            vote = { count: 0, depthSum: 0, parts: new Map() };
            votes.set(key, vote);
          }
          vote.count++;
          vote.depthSum += bestDepth;
          vote.parts.set(best, (vote.parts.get(best) ?? 0) + 1);
        }
      }
      // Coverage: exact integer comparison hits·2^16 ≥ S²·COVERAGE_RAW.
      if (hits * 65536 < ss * COVERAGE_RAW) {
        row.push(null);
        continue;
      }
      // Majority vote; ties → first contributing sample earliest in scan
      // order = first insertion into the Map.
      let winKey = -1;
      let winVote: KeyVote | undefined;
      for (const [key, vote] of votes) {
        if (winVote === undefined || vote.count > winVote.count) {
          winKey = key;
          winVote = vote;
        }
      }
      /* v8 ignore next — hits ≥ 7 guarantees votes is non-empty */
      if (winVote === undefined) throw new Error("raster: opaque pixel with no votes");
      // Part majority with the same first-seen tie-break.
      let partId = -1;
      let partCount = -1;
      for (const [part, count] of winVote.parts) {
        if (count > partCount) {
          partId = part;
          partCount = count;
        }
      }
      row.push(
        Object.freeze({
          role: ROLE_NAMES[Math.floor(winKey / 4)]!,
          tone: winKey % 4,
          partId,
          depthRaw: rheDiv(winVote.depthSum, winVote.count),
        }),
      );
    }
    grid.push(row);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Canonical serialization (the raster golden's hash input)
// ---------------------------------------------------------------------------

/**
 * Serialize a tagged grid to the canonical byte form hashed by the raster
 * goldens (SHA-256 over these bytes). Pinned format, byte-exact:
 *
 * - header: width u8, height u8;
 * - then every pixel in scan order (py outer ascending, px inner
 *   ascending): a transparent pixel is the single byte 0x00; an opaque
 *   pixel is 0x01, role id u8 ({@link ROLE_IDS}), tone u8, partId u8,
 *   then depthRaw as int32 little-endian two's complement (4 bytes).
 */
export function serializeRasterGrid(grid: RasterGrid): Uint8Array {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  if (w > 255 || h > 255) {
    throw new RangeError(`raster: serialized grid dimensions must fit u8, got ${w}×${h}`);
  }
  const bytes: number[] = [w, h];
  for (const row of grid) {
    if (row.length !== w) {
      throw new RangeError("raster: ragged grid cannot be serialized");
    }
    for (const px of row) {
      if (px === null) {
        bytes.push(0);
        continue;
      }
      bytes.push(1, ROLE_IDS[px.role], px.tone, px.partId);
      // int32 LE two's complement.
      const d = px.depthRaw < 0 ? px.depthRaw + 4294967296 : px.depthRaw;
      bytes.push(d % 256, Math.floor(d / 256) % 256, Math.floor(d / 65536) % 256, Math.floor(d / 16777216) % 256);
    }
  }
  return Uint8Array.from(bytes);
}
