/**
 * Fablesprite — the M1 export layer (design 06 §6 as extended at this
 * unit; design 05 §2 narrowed to M1 scope).
 *
 * genome → the full M1 frame set → the two canonical artifact families:
 * per-frame RGBA buffers + PNGs, the packed sheet PNG, and the canonical
 * JSON metadata — every byte pinned, every hash golden-testable.
 *
 * The M1 frame set (§6, pinned): clips [walk, idle] × directions
 * [down, left, up, right] × K = 4 phases, in exactly that nesting order
 * (clip outer, direction middle, phase inner) — 32 frames of 32×32.
 * Per clip × direction cell the pipeline is: poseQuadruped per phase →
 * snapOffsets → rasterize (with the genome's ramp_len and the snap
 * offsets) → craftClip → applyPalette with the creature's ONE derived
 * palette.
 *
 * Sheet (§6, pinned): a grid of 32×32 cells, one row per
 * (clip, direction) cell in frame-set order (8 rows), K = 4 columns,
 * row-major, no padding — 128×256 RGBA. NO mirror optimization in M1:
 * the trot phase groups make left/right views non-mirror-identical in
 * general; the schema keeps a per-direction `mirror` boolean, false
 * everywhere in M1.
 *
 * JSON: the §6 canonical form — UTF-8, no whitespace, UTF-8
 * byte-lexicographic key order, RFC 8259-minimal escaping, integers only
 * (fp raws in `*_fp` fields), single line. The schema is normative (§6):
 * top-level keys clips, frames, generator_version, genome, hitboxes,
 * palette, sheet.
 *
 * Engine presets (Aseprite/Godot/Unity), GIF previews, and faction/set
 * features are M2 (design 05 §2) and deliberately absent (R10). Hashing
 * uses node:crypto (the CI golden idiom); the render path itself stays
 * dependency-free.
 */

import { createHash } from "node:crypto";

import type { CraftGrid } from "./craft.js";
import { craftClip, snapOffsets } from "./craft.js";
import { asr, fp_add, fp_mul, fp_sqrt, fp_sub } from "./fixed.js";
import type { Genome } from "./genome.js";
import { encodeGenome, getScalar } from "./genome.js";
import { GENERATOR_VERSION } from "./index.js";
import type { ClipName, Slab } from "./pose.js";
import { clipPhases, poseQuadruped } from "./pose.js";
import type { Direction, SlabOffset } from "./raster.js";
import { DIRECTIONS, DIRECTION_TURNS, TILT_RAW, rasterize, yawSlab } from "./raster.js";
import type { Palette } from "./palette.js";
import { applyPalette, derivePalette } from "./palette.js";
import { encodePng } from "./png.js";

// ---------------------------------------------------------------------------
// Canonical JSON (design 06 §6, normative)
// ---------------------------------------------------------------------------

/**
 * The value domain of M1 canonical JSON: integers, strings, booleans,
 * arrays, and objects — no floats ever (fp values export as raw ints in
 * `*_fp` fields), no null (nothing in the schema is optional).
 */
export type JsonValue =
  | number
  | string
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const JSON_SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
]);

/** RFC 8259-minimal string escaping per design 06 §6 (see canonicalJson). */
function escapeJsonString(s: string): string {
  let out = '"';
  for (const ch of s) {
    if (ch === '"') {
      out += '\\"';
    } else if (ch === "\\") {
      out += "\\\\";
    } else {
      const c = ch.codePointAt(0)!;
      if (c < 0x20) {
        out += JSON_SHORT_ESCAPES.get(c) ?? `\\u${c.toString(16).padStart(4, "0")}`;
      } else {
        out += ch;
      }
    }
  }
  return out + '"';
}

const UTF8 = new TextEncoder();

/** UTF-8 byte-lexicographic key comparator (design 06 §6, pinned). */
function compareKeysUtf8(a: string, b: string): number {
  const ba = UTF8.encode(a);
  const bb = UTF8.encode(b);
  const n = Math.min(ba.length, bb.length);
  for (let i = 0; i < n; i++) {
    const d = ba[i]! - bb[i]!;
    if (d !== 0) return d;
  }
  return ba.length - bb.length;
}

/**
 * Serialize a {@link JsonValue} to the canonical single-line form of
 * design 06 §6: UTF-8 (the caller encodes; no BOM), no whitespace,
 * object keys in **UTF-8 byte-lexicographic** order, string escaping
 * exactly RFC 8259's minimum — `"`, `\`, and controls U+0000–U+001F,
 * two-character short forms where they exist (`\b \t \n \f \r \" \\`),
 * lowercase `\u00xx` otherwise, the solidus NEVER escaped — and numbers
 * as integers only. Traps (RangeError), never coerces: a non-integer or
 * unsafe number, a null/undefined, or any non-JSON object is a spec
 * violation. Negative zero serializes as `0` (its ECMAScript ToString,
 * per RFC 8785 §3.2.2.3).
 *
 * The §6 key order is BYTE-lexicographic, which coincides with RFC 8785
 * (JCS)'s UTF-16 code-unit order for every key the M1 schema emits
 * (all ASCII) but diverges for keys pairing a non-BMP character against
 * U+E000–U+FFFF — the byte order is the pin.
 */
export function canonicalJson(value: JsonValue): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        `export: canonical JSON numbers must be safe integers (fp values go in *_fp fields as raws), got ${value}`,
      );
    }
    return String(value); // −0 stringifies as "0" (RFC 8785 §3.2.2.3)
  }
  if (typeof value === "string") return escapeJsonString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v as JsonValue)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const obj = value as { readonly [key: string]: JsonValue };
    const keys = Object.keys(obj).sort(compareKeysUtf8);
    return `{${keys.map((k) => `${escapeJsonString(k)}:${canonicalJson(obj[k]!)}`).join(",")}}`;
  }
  throw new RangeError(`export: value ${String(value)} is not canonical-JSON-serializable`);
}

// ---------------------------------------------------------------------------
// Pinned frame-set / sheet constants (design 06 §6 extension)
// ---------------------------------------------------------------------------

/** Frame edge in pixels — the only normative M1 resolution (D5). */
export const FRAME_SIZE = 32;

/** Frames per clip × direction cell (K = 4, §1.2 per S2/F10). */
export const FRAMES_PER_CELL = 4;

/**
 * The M1 clip roster in pinned frame-set order (clip is the OUTER
 * nesting level): walk first, idle second.
 */
export const EXPORT_CLIPS: readonly ClipName[] = Object.freeze(["walk", "idle"]);

/** Total frames: 2 clips × 4 directions × K = 32. */
export const FRAME_COUNT = EXPORT_CLIPS.length * DIRECTIONS.length * FRAMES_PER_CELL;

/** Sheet columns = K (one row per clip × direction cell). */
export const SHEET_COLS = FRAMES_PER_CELL;

/** Sheet rows = clips × directions = 8. */
export const SHEET_ROWS = EXPORT_CLIPS.length * DIRECTIONS.length;

/** Sheet pixel width: 4 × 32 = 128. */
export const SHEET_WIDTH = SHEET_COLS * FRAME_SIZE;

/** Sheet pixel height: 8 × 32 = 256. */
export const SHEET_HEIGHT = SHEET_ROWS * FRAME_SIZE;

/**
 * Uniform per-frame duration, both clips (design 06 §6 extension): the
 * S2/F10 verdict pins uniform durations; 140 ms/frame is the cadence
 * every accepted spike GIF ran at (S1/S1b/S2/S3 all rendered 140 ms
 * frames — a 560 ms walk cycle at K = 4), so the judged look IS the
 * 140 ms look.
 */
export const FRAME_DURATION_MS = 140;

/** Frame anchor ox at 32×32 in fp raw (design 06 §1.2): 16.0. */
const OX_RAW = 1048576;

/** Frame anchor oy — the ground line — at 32×32 in fp raw: 26.5. */
const OY_RAW = 1736704;

// ---------------------------------------------------------------------------
// Hitbox derivation (design 06 §6 extension — slab-derived, not pixels)
// ---------------------------------------------------------------------------

/** Integer pixel rect: x, y = top-left, w × h; half-open in both axes. */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The ground-shadow ellipse in fp raws, frame-local coordinates:
 * center (cx_fp, cy_fp), radii (rx_fp, ry_fp); cy_fp is always the
 * ground line oy (design 05 §2: slab projection makes hitboxes
 * consistent across directions by construction).
 */
export interface ShadowEllipse {
  readonly cx_fp: number;
  readonly cy_fp: number;
  readonly rx_fp: number;
  readonly ry_fp: number;
}

/** One frame's slab-derived hitboxes (design 06 §6 extension). */
export interface FrameHitbox {
  readonly aabb: PixelRect;
  readonly shadow: ShadowEllipse;
}

/** floor of an fp raw to whole pixels: asr(r, 16). */
function floorPx(raw: number): number {
  return asr(raw, 16);
}

/** ceil of an fp raw to whole pixels: −floor(−r). */
function ceilPx(raw: number): number {
  return -asr(-raw, 16);
}

/**
 * Derive one frame's hitboxes from its SNAPPED slab set (design 06 §6
 * extension, exact arithmetic): `slabs` is the §1.2 model-space list and
 * `offsets` that frame's chain-snap offsets — the same inputs the
 * rasterizer consumed, so the hitboxes describe exactly the rendered
 * geometry. Per slab, after yawSlab(direction) and the §1.5 offset
 * translation (cx += dx, cz −= dy):
 *
 * ```
 * sxc = cx                                        screen center x
 * syc = fp_sub(fp_sub(0, cz), fp_mul(TILT, cy))   screen center y (§1.4)
 * t   = fp_mul(TILT, hy)
 * ry  = fp_sqrt(fp_add(fp_mul(hz, hz), fp_mul(t, t)))
 * ```
 *
 * ry is the exact screen-y half-extent of the sheared ellipsoid (the
 * extremum of −z − TILT·y over the surface); the screen-x half-extent is
 * hx. The body AABB is the min/max over ALL slabs of sxc ∓ hx and
 * syc ∓ ry, anchored to the frame (add OX/OY raws) and rounded OUTWARD
 * to integer pixels — floor on mins, ceil on maxes (half-open rect). It
 * is NOT clamped to the 32×32 frame: the hitbox is geometry-derived and
 * may legally overhang the canvas.
 *
 * The shadow ellipse comes from the body chain (§1.5 chain table: slabs
 * 0–1, core + underside) x-extent on the ground line:
 *
 * ```
 * bMinX = min over slabs {0, 1} of fp_sub(sxc, hx)
 * bMaxX = max over slabs {0, 1} of fp_add(sxc, hx)
 * cx_fp = fp_add(OX, asr(fp_add(bMinX, bMaxX), 1))
 * cy_fp = OY (the ground line, 26.5 → 1736704)
 * rx_fp = asr(fp_sub(bMaxX, bMinX), 1)
 * ry_fp = asr(rx_fp, 2)              (pinned ¼ flattening)
 * ```
 */
export function deriveHitbox(
  slabs: readonly Slab[],
  direction: Direction,
  offsets: readonly SlabOffset[],
): FrameHitbox {
  const turns = DIRECTION_TURNS[direction];
  if (offsets.length !== slabs.length) {
    throw new RangeError(
      `export: offsets length ${offsets.length} must match slab count ${slabs.length}`,
    );
  }
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let bMinX = 0;
  let bMaxX = 0;
  for (let i = 0; i < slabs.length; i++) {
    const yawed = yawSlab(slabs[i]!, turns);
    const cx = fp_add(yawed.cx, offsets[i]!.dx);
    const cz = fp_sub(yawed.cz, offsets[i]!.dy);
    const sxc = cx;
    const syc = fp_sub(fp_sub(0, cz), fp_mul(TILT_RAW, yawed.cy));
    const t = fp_mul(TILT_RAW, yawed.hy);
    const ry = fp_sqrt(fp_add(fp_mul(yawed.hz, yawed.hz), fp_mul(t, t)));
    const x0 = fp_sub(sxc, yawed.hx);
    const x1 = fp_add(sxc, yawed.hx);
    const y0 = fp_sub(syc, ry);
    const y1 = fp_add(syc, ry);
    if (i === 0) {
      minX = x0;
      maxX = x1;
      minY = y0;
      maxY = y1;
    } else {
      if (x0 < minX) minX = x0;
      if (x1 > maxX) maxX = x1;
      if (y0 < minY) minY = y0;
      if (y1 > maxY) maxY = y1;
    }
    if (i < 2) {
      // Body chain (§1.5 chain table: slabs 0, 1) drives the shadow.
      if (i === 0) {
        bMinX = x0;
        bMaxX = x1;
      } else {
        if (x0 < bMinX) bMinX = x0;
        if (x1 > bMaxX) bMaxX = x1;
      }
    }
  }
  const px0 = floorPx(fp_add(OX_RAW, minX));
  const py0 = floorPx(fp_add(OY_RAW, minY));
  const px1 = ceilPx(fp_add(OX_RAW, maxX));
  const py1 = ceilPx(fp_add(OY_RAW, maxY));
  const rxFp = asr(fp_sub(bMaxX, bMinX), 1);
  return Object.freeze({
    aabb: Object.freeze({ x: px0, y: py0, w: px1 - px0, h: py1 - py0 }),
    shadow: Object.freeze({
      cx_fp: fp_add(OX_RAW, asr(fp_add(bMinX, bMaxX), 1)),
      cy_fp: OY_RAW,
      rx_fp: rxFp,
      ry_fp: asr(rxFp, 2),
    }),
  });
}

// ---------------------------------------------------------------------------
// exportCreature — the full M1 render + artifacts
// ---------------------------------------------------------------------------

/** One rendered frame of the M1 frame set, in pinned order. */
export interface ExportedFrame {
  readonly clip: ClipName;
  readonly direction: Direction;
  /** Phase index k ∈ [0, K): the pose phase is φ_k = k·16384 raw turns. */
  readonly phase: number;
  /** §6 artifact 1: the 32×32×4 RGBA buffer from applyPalette. */
  readonly rgba: Uint8Array;
  /** §6 artifact 2: the frame's PNG bytes from the M1 encoder. */
  readonly png: Uint8Array;
}

/** Everything exportCreature renders and derives for one genome. */
export interface CreatureExport {
  /** The 32 frames in pinned frame-set order. */
  readonly frames: readonly ExportedFrame[];
  /** The packed 128×256 sheet as a flat RGBA buffer. */
  readonly sheetRgba: Uint8Array;
  /** The sheet PNG bytes. */
  readonly sheetPng: Uint8Array;
  /** The canonical JSON metadata (design 06 §6 schema), single line. */
  readonly json: string;
  /** SHA-256 hex of each frame's RGBA buffer (§6 artifact-1 hashes). */
  readonly rgbaSha256: readonly string[];
  /** SHA-256 hex of each frame's PNG bytes. */
  readonly pngSha256: readonly string[];
  /** SHA-256 hex of the sheet RGBA buffer. */
  readonly sheetRgbaSha256: string;
  /** SHA-256 hex of the sheet PNG bytes. */
  readonly sheetPngSha256: string;
  /** SHA-256 hex of the canonical JSON (UTF-8 bytes). */
  readonly jsonSha256: string;
}

/** SHA-256 hex digest (node:crypto — the repo's golden idiom). */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Render one genome to the complete M1 export (design 06 §6 as extended;
 * design 05 §2 M1 subset): the 32-frame set, the packed sheet, the
 * canonical JSON, and every golden hash. Deterministic — two calls on
 * one genome are byte-identical, property-tested in CI.
 *
 * Pipeline per clip × direction cell (pinned): poseQuadruped per phase →
 * snapOffsets(slabLists, direction) → rasterize(slabs, direction, 32,
 * ramp_len, offsets) → craftClip → applyPalette with the creature's one
 * derivePalette(genome) palette.
 */
export function exportCreature(genome: Genome): CreatureExport {
  const dna = encodeGenome(genome); // also validates the genome's version
  const palette: Palette = derivePalette(genome);
  const rampLenRaw = getScalar(genome, "palette.ramp_len");
  if (rampLenRaw !== 3 && rampLenRaw !== 4 && rampLenRaw !== 5) {
    throw new RangeError(`export: palette.ramp_len must be 3, 4, or 5, got ${rampLenRaw}`);
  }
  const rampLen: 3 | 4 | 5 = rampLenRaw;
  const phases = clipPhases(FRAMES_PER_CELL);

  const frames: ExportedFrame[] = [];
  const hitboxes: FrameHitbox[] = [];
  const clipsJson: Record<string, Record<string, JsonValue>> = {};

  for (const clip of EXPORT_CLIPS) {
    const perDirection: Record<string, JsonValue> = {};
    // Slab lists are direction-independent (poses live in model space —
    // design 03 §2 "direction handling is free"); snapping is per
    // direction.
    const slabLists = phases.map((phi) => poseQuadruped(genome, clip, phi));
    for (const direction of DIRECTIONS) {
      const offsets = snapOffsets(slabLists, direction);
      const rawGrids = slabLists.map((slabs, f) =>
        rasterize(slabs, direction, FRAME_SIZE, rampLen, offsets[f]!),
      );
      const { grids } = craftClip(rawGrids);
      const indices: number[] = [];
      for (let k = 0; k < FRAMES_PER_CELL; k++) {
        indices.push(frames.length);
        const rgba = applyPalette(grids[k] as CraftGrid, palette);
        frames.push(
          Object.freeze({
            clip,
            direction,
            phase: k,
            rgba,
            png: encodePng(rgba, FRAME_SIZE, FRAME_SIZE),
          }),
        );
        hitboxes.push(deriveHitbox(slabLists[k]!, direction, offsets[k]!));
      }
      perDirection[direction] = Object.freeze({
        frames: Object.freeze(indices),
        mirror: false, // pinned false everywhere in M1 (§6 extension)
      });
    }
    clipsJson[clip] = perDirection;
  }

  // Sheet: one row per (clip, direction) cell in frame-set order, K
  // columns, row-major, no padding (§6 extension).
  const sheetRgba = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT * 4);
  for (let i = 0; i < frames.length; i++) {
    const row = Math.floor(i / SHEET_COLS);
    const col = i % SHEET_COLS;
    const frame = frames[i]!;
    for (let y = 0; y < FRAME_SIZE; y++) {
      const src = y * FRAME_SIZE * 4;
      const dst = ((row * FRAME_SIZE + y) * SHEET_WIDTH + col * FRAME_SIZE) * 4;
      sheetRgba.set(frame.rgba.subarray(src, src + FRAME_SIZE * 4), dst);
    }
  }
  const sheetPng = encodePng(sheetRgba, SHEET_WIDTH, SHEET_HEIGHT);

  // Canonical JSON metadata (§6 schema, normative).
  const rgb = (ramp: readonly (readonly number[])[]): JsonValue =>
    ramp.map((c) => [c[0]!, c[1]!, c[2]!]);
  const meta: JsonValue = {
    clips: clipsJson,
    frames: frames.map((_, i) => ({
      duration_ms: FRAME_DURATION_MS,
      pivot: { x_fp: OX_RAW, y_fp: OY_RAW },
      rect: {
        h: FRAME_SIZE,
        w: FRAME_SIZE,
        x: (i % SHEET_COLS) * FRAME_SIZE,
        y: Math.floor(i / SHEET_COLS) * FRAME_SIZE,
      },
    })),
    generator_version: GENERATOR_VERSION,
    genome: dna,
    hitboxes: hitboxes.map((hb) => ({
      aabb: { h: hb.aabb.h, w: hb.aabb.w, x: hb.aabb.x, y: hb.aabb.y },
      shadow: {
        cx_fp: hb.shadow.cx_fp,
        cy_fp: hb.shadow.cy_fp,
        rx_fp: hb.shadow.rx_fp,
        ry_fp: hb.shadow.ry_fp,
      },
    })),
    palette: {
      focal: rgb(palette.focal),
      hide: rgb(palette.hide),
      roles: ["hide", "underside", "focal"],
      underside: rgb(palette.underside),
    },
    sheet: { cell: FRAME_SIZE, h: SHEET_HEIGHT, w: SHEET_WIDTH },
  };
  const json = canonicalJson(meta);

  return Object.freeze({
    frames: Object.freeze(frames),
    sheetRgba,
    sheetPng,
    json,
    rgbaSha256: Object.freeze(frames.map((f) => sha256Hex(f.rgba))),
    pngSha256: Object.freeze(frames.map((f) => sha256Hex(f.png))),
    sheetRgbaSha256: sha256Hex(sheetRgba),
    sheetPngSha256: sha256Hex(sheetPng),
    jsonSha256: sha256Hex(UTF8.encode(json)),
  });
}
