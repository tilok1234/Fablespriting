/**
 * Fablesprite — the M1 palette layer (design 06 §1.3, normative;
 * design 04 §5 context).
 *
 * genome palette loci → three role ramps → crafted pixels → RGBA bytes:
 * this module derives the hide/underside ramps in fp HSV (loci 3–6:
 * `palette.base_hue`, `hue_shift`, `contrast`, `ramp_len`), converts
 * them with the §1.3 exact integer HSV→RGB, and applies a palette to a
 * crafted grid, producing the flat RGBA buffer of §6 artifact 1. The
 * focal ramp is the pinned constant table — independent of every
 * palette locus and merge-protected (F16). Faction palettes, color
 * budgets beyond ramp sharing, and glow ramps are M2 (design 04 §5)
 * and deliberately absent (R10).
 *
 * All arithmetic is exact integer / 16.16 fixed point (R6): the
 * half-step offset `oh` is a PLAIN integer, its products with locus
 * raws are plain int products (int32-safe by domain, §1.3), hue
 * wrapping is §0's wrap360 (mathematical mod 360), and `byte()` rounds
 * half to even. A second implementer must reproduce every byte from
 * design 06 §1.3 alone.
 */

import type { CraftPixel } from "./craft.js";
import { FP_ONE, asr, fp_div, fp_mul, rheDiv } from "./fixed.js";
import type { Genome } from "./genome.js";
import { getScalar } from "./genome.js";

// ---------------------------------------------------------------------------
// Pinned constants (design 06 §1.3 — machine-verified RHE(d·2^16) raws)
// ---------------------------------------------------------------------------

/** 360.0° in fp raw (23592960); wrap360's modulus. */
export const DEG_360_RAW = 23592960; // 360.0
/** 60.0° in fp raw (3932160); the HSV sector width. */
export const DEG_60_RAW = 3932160; // 60.0
/** Outline hue offset below base_hue (§1.3: wrap360(base_hue − 84.0)). */
export const OUTLINE_HUE_OFFSET_RAW = 5505024; // 84.0
/** Hide ramp saturation. */
export const HIDE_S_RAW = 26870; // 0.41
/** Hide ramp base value (mid tone). */
export const HIDE_V_RAW = 38011; // 0.58
/** Underside ramp saturation. */
export const UNDERSIDE_S_RAW = 19661; // 0.30
/** Underside ramp base value (mid tone). */
export const UNDERSIDE_V_RAW = 50463; // 0.77
/** Outline saturation (shared hide/underside slot 0). */
export const OUTLINE_S_RAW = 24248; // 0.37
/** Outline value (shared hide/underside slot 0). */
export const OUTLINE_V_RAW = 11796; // 0.18

/** One palette color: RGBA bytes, each 0..255. */
export type RGBA8 = readonly [r: number, g: number, b: number, a: number];

/**
 * The pinned focal ramp (design 06 §1.3): the spike's `eye` table,
 * always exactly 4 entries — slot 0 its OWN outline color (a focal
 * edge = 1 pixel takes this, never the shared hide/underside outline),
 * slots 1..3 the focal body tones. Independent of every palette locus
 * (a ramp_len 3 or 5 genome gets this identical table) and
 * merge-protected in craft rule 5 (F16). Slots 0 and 1 are the same
 * color by design — see the §1.3 application rule's edge = 2 note.
 */
export const FOCAL_RAMP: readonly RGBA8[] = Object.freeze([
  Object.freeze([20, 14, 24, 255] as const),
  Object.freeze([20, 14, 24, 255] as const),
  Object.freeze([30, 22, 34, 255] as const),
  Object.freeze([52, 44, 58, 255] as const),
]);

/**
 * A derived creature palette (design 06 §1.3): hide and underside are
 * `ramp_len` entries — slot 0 the shared outline (identical arrays of
 * bytes in both ramps), slots 1..ramp_len−1 body tones dark→light —
 * and focal is always the 4-entry {@link FOCAL_RAMP}.
 */
export interface Palette {
  readonly hide: readonly RGBA8[];
  readonly underside: readonly RGBA8[];
  readonly focal: readonly RGBA8[];
}

// ---------------------------------------------------------------------------
// wrap360 and HSV → RGB8 (design 06 §0, §1.3)
// ---------------------------------------------------------------------------

/**
 * §0's wrap360 on fp degree raws: mathematical modulo into
 * [0, 23592960) — `x − 360·floor(x/360)`, so negative inputs wrap UP
 * (wrap360(13.0 − 84.0) = 289.0, the normative outline hue example).
 * The §1.3 hue arithmetic wraps exactly once, here: `hue_base` sums
 * arrive unwrapped and stay far inside int32 by domain
 * (machine-verified, §1.3).
 */
export function wrap360(x: number): number {
  if (!Number.isInteger(x)) {
    throw new RangeError(`palette: wrap360 needs an integer raw, got ${x}`);
  }
  return ((x % DEG_360_RAW) + DEG_360_RAW) % DEG_360_RAW;
}

/**
 * The exact integer HSV → RGB8 of design 06 §1.3. `h` must already be
 * wrapped to [0, 23592960); `s` and `v` are fp raws in [0, FP_ONE].
 * `sector = H div 60.0` is integer floor division of the wrapped raw by
 * raw 3932160, `f = fp_div(H mod 60.0, 60.0)`, and
 * `byte(c) = RHE(c·255/65536)` = rheDiv(c·255, 65536) — ties to even.
 */
export function hsvToRgb8(h: number, s: number, v: number): readonly [number, number, number] {
  if (!Number.isInteger(h) || h < 0 || h >= DEG_360_RAW) {
    throw new RangeError(`palette: hsvToRgb8 hue raw must lie in [0, ${DEG_360_RAW}), got ${h}`);
  }
  if (!Number.isInteger(s) || s < 0 || s > FP_ONE || !Number.isInteger(v) || v < 0 || v > FP_ONE) {
    throw new RangeError(`palette: hsvToRgb8 s/v raws must lie in [0, 65536], got (${s}, ${v})`);
  }
  const sector = Math.floor(h / DEG_60_RAW); // integer 0..5
  const f = fp_div(h - sector * DEG_60_RAW, DEG_60_RAW);
  const p = fp_mul(v, FP_ONE - s);
  const q = fp_mul(v, FP_ONE - fp_mul(s, f));
  const t = fp_mul(v, FP_ONE - fp_mul(s, FP_ONE - f));
  let rgbFp: readonly [number, number, number];
  switch (sector) {
    case 0:
      rgbFp = [v, t, p];
      break;
    case 1:
      rgbFp = [q, v, p];
      break;
    case 2:
      rgbFp = [p, v, t];
      break;
    case 3:
      rgbFp = [p, q, v];
      break;
    case 4:
      rgbFp = [t, p, v];
      break;
    default:
      rgbFp = [v, p, q]; // sector 5 — h < DEG_360_RAW guarantees ≤ 5
      break;
  }
  return [byte(rgbFp[0]), byte(rgbFp[1]), byte(rgbFp[2])];
}

/** `byte(c) = RHE(c·255 / 65536)` (design 06 §1.3). */
function byte(c: number): number {
  return rheDiv(c * 255, FP_ONE);
}

// ---------------------------------------------------------------------------
// derivePalette (design 06 §1.3 ramp derivation)
// ---------------------------------------------------------------------------

function rgba(rgb: readonly [number, number, number]): RGBA8 {
  return Object.freeze([rgb[0], rgb[1], rgb[2], 255] as const);
}

/**
 * Derive the three role ramps from a genome's palette loci
 * (design 06 §1.3, exact). Hide and underside are `ramp_len` entries:
 * slot 0 the shared outline `HSV(wrap360(base_hue − 84.0), 0.37, 0.18)`,
 * then the `n = ramp_len − 1` body tones dark→light at half-step offset
 * `oh = 2t − (n−1)` (a PLAIN integer; its products with the `hue_shift`
 * and `contrast` raws are plain int products, int32-safe by domain):
 *
 * ```
 * H = wrap360(hue_base + asr(oh · hue_shift, 1))
 * S = S_role
 * V = clamp(V_role + asr(oh · contrast, 1), 0, 65536)
 * ```
 *
 * with hide `hue_base = base_hue` and underside
 * `hue_base = base_hue + hue_shift` (an UNWRAPPED plain add — wrapping
 * happens once, at H). Focal is always the constant {@link FOCAL_RAMP}.
 */
export function derivePalette(genome: Genome): Palette {
  const baseHue = getScalar(genome, "palette.base_hue");
  const hueShift = getScalar(genome, "palette.hue_shift");
  const contrast = getScalar(genome, "palette.contrast");
  const rampLen = getScalar(genome, "palette.ramp_len");

  const outline = rgba(
    hsvToRgb8(wrap360(baseHue - OUTLINE_HUE_OFFSET_RAW), OUTLINE_S_RAW, OUTLINE_V_RAW),
  );

  const n = rampLen - 1; // body tones per ramp
  const buildBody = (hueBase: number, sRole: number, vRole: number): RGBA8[] => {
    const ramp: RGBA8[] = [outline];
    for (let t = 0; t < n; t++) {
      const oh = 2 * t - (n - 1); // plain int, |oh| ≤ 3
      const h = wrap360(hueBase + asr(oh * hueShift, 1));
      const v = Math.min(Math.max(vRole + asr(oh * contrast, 1), 0), FP_ONE);
      ramp.push(rgba(hsvToRgb8(h, sRole, v)));
    }
    return ramp;
  };

  return Object.freeze({
    hide: Object.freeze(buildBody(baseHue, HIDE_S_RAW, HIDE_V_RAW)),
    underside: Object.freeze(buildBody(baseHue + hueShift, UNDERSIDE_S_RAW, UNDERSIDE_V_RAW)),
    focal: FOCAL_RAMP,
  });
}

// ---------------------------------------------------------------------------
// applyPalette (design 06 §1.3 application rule)
// ---------------------------------------------------------------------------

/**
 * Apply a derived palette to a crafted grid (design 06 §1.3 application
 * rule, normative): returns the flat RGBA buffer of §6 artifact 1 —
 * width·height·4 bytes, rows top-to-bottom, pixels left-to-right, byte
 * order R, G, B, A — exactly what the §6 RGBA hash and the M1 PNG
 * encoder consume.
 *
 * Per cell: transparent → exactly (0, 0, 0, 0); opaque → alpha 255 and
 * the color from the pixel's role ramp (focal ALWAYS the 4-entry
 * {@link FOCAL_RAMP}, whatever `ramp_len` the palette was derived at) at
 * slot
 *
 * ```
 * edge = 1 → 0          (outline; focal takes the focal table's slot 0)
 * edge = 2 → tone       (one darker than the body slot tone + 1 —
 *                        MAY reach slot 0, no floor: §1.3, spike-exact)
 * edge = 0 → tone + 1   (body tone)
 * ```
 *
 * A tone whose slot falls outside the ramp is a spec violation (a grid
 * crafted at one ramp_len applied with a palette derived at another) —
 * traps, never clamps.
 */
export function applyPalette(
  grid: ReadonlyArray<ReadonlyArray<CraftPixel | null>>,
  palette: Palette,
): Uint8Array {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  for (const row of grid) {
    if (row.length !== w) {
      throw new RangeError("palette: applyPalette needs a rectangular grid");
    }
  }
  const out = new Uint8Array(w * h * 4); // zero-filled: transparent = (0,0,0,0)
  let o = 0;
  for (let py = 0; py < h; py++) {
    const row = grid[py]!;
    for (let px = 0; px < w; px++) {
      const cell = row[px];
      if (cell === null || cell === undefined) {
        o += 4;
        continue;
      }
      const ramp =
        cell.role === "focal"
          ? palette.focal
          : cell.role === "underside"
            ? palette.underside
            : palette.hide;
      let slot: number;
      if (cell.edge === 1) {
        slot = 0;
      } else if (cell.edge === 2) {
        slot = cell.tone;
      } else if (cell.edge === 0) {
        slot = cell.tone + 1;
      } else {
        throw new RangeError(`palette: edge must be 0, 1, or 2, got ${cell.edge}`);
      }
      // §1.3 trap: validate the TONE range (tone ≤ ramp_len − 2), not just
      // the selected slot — edge = 2's slot = tone can land inside a
      // too-short ramp and silently mask a mismatch edge = 0 would catch.
      if (!Number.isInteger(cell.tone) || cell.tone < 0 || cell.tone > ramp.length - 2) {
        throw new RangeError(
          `palette: tone ${cell.tone} (edge ${cell.edge}) outside the body-tone range of ` +
            `the ${cell.role} ramp (length ${ramp.length}) — grid/palette ramp_len mismatch`,
        );
      }
      const color = ramp[slot]!;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = color[3];
      o += 4;
    }
  }
  return out;
}
