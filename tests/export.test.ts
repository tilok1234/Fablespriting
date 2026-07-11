import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  EXPORT_CLIPS,
  FRAMES_PER_CELL,
  FRAME_COUNT,
  FRAME_DURATION_MS,
  FRAME_SIZE,
  SHEET_COLS,
  SHEET_HEIGHT,
  SHEET_ROWS,
  SHEET_WIDTH,
  canonicalJson,
  exportCreature,
} from "../src/export.js";
import { makeGenome, sampleGenome } from "../src/genome.js";
import { DIRECTIONS } from "../src/raster.js";

// ---------------------------------------------------------------------------
// Oracle provenance: the canonical-JSON vectors and the hitbox vectors
// below were derived by independent scratchpad Python oracles
// (json_oracle.py and export_diff_verify.py's from-spec hitbox oracle,
// 2026-07-11), never by running this implementation. The golden hashes
// were pinned only AFTER the full differential run: every frame PNG and
// sheet PNG of defaults + seeds 0..14 PIL-decoded and pixel-compared to
// the RGBA buffers, the JSON re-canonicalized byte-identically by the
// Python canonicalizer, and every hash recomputed in Python.
// ---------------------------------------------------------------------------

const DEFAULTS = makeGenome();
const EXPORT = exportCreature(DEFAULTS);

// ---------------------------------------------------------------------------
// canonicalJson (design 06 §6 serializer rules)
// ---------------------------------------------------------------------------

describe("canonicalJson — RFC 8259-minimal escaping, byte-lexicographic keys", () => {
  test("empty object and array", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  test("keys sort", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ "10": 1, "1": 2, "2": 3 })).toBe('{"1":2,"10":1,"2":3}');
    expect(canonicalJson({ "": "empty key" })).toBe('{"":"empty key"}');
  });

  test("non-ASCII keys sort by UTF-8 BYTES (the §6 pin — diverges from RFC 8785's UTF-16 order at the 😀-vs-\\ufb33 pairing)", () => {
    const value = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\u{1f600}": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    // Python oracle, sorted by key.encode("utf-8"): \r, 1, U+0080, ö, €,
    // דּ (ef ac b3), 😀 (f0 9f 98 80). RFC 8785's UTF-16 order would put
    // the emoji (surrogates d83d de00) BEFORE דּ — byte order is
    // the pinned rule.
    expect(canonicalJson(value)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis",' +
        '"€":"Euro Sign","דּ":"Hebrew Letter Dalet With Dagesh","\u{1f600}":"Emoji: Grinning Face"}',
    );
  });

  test("escaping: quote, backslash, controls (short forms + lowercase \\u00xx), solidus never escaped", () => {
    expect(
      canonicalJson({ esc: 'quote" back\\slash sol/idus \u0000\u0001\u001f \b\t\n\f\r end' }),
    ).toBe('{"esc":"quote\\" back\\\\slash sol/idus \\u0000\\u0001\\u001f \\b\\t\\n\\f\\r end"}');
  });

  test("non-ASCII string content passes through unescaped", () => {
    expect(canonicalJson({ "unicode passthrough": "é€\u{1f43a}" })).toBe(
      '{"unicode passthrough":"é€\u{1f43a}"}',
    );
  });

  test("nesting, booleans, integers", () => {
    expect(canonicalJson({ nested: { z: [1, -2, 0], y: { k: false }, x: true } })).toBe(
      '{"nested":{"x":true,"y":{"k":false},"z":[1,-2,0]}}',
    );
    expect(canonicalJson([0, -1, 1, 2147483647, -2147483648, 9007199254740991])).toBe(
      "[0,-1,1,2147483647,-2147483648,9007199254740991]",
    );
  });

  test("negative zero serializes as 0 (RFC 8785 §3.2.2.3)", () => {
    expect(canonicalJson(-0)).toBe("0");
  });

  test("traps on floats, non-finite and unsafe numbers, and null", () => {
    expect(() => canonicalJson(1.5)).toThrow(RangeError);
    expect(() => canonicalJson(Number.NaN)).toThrow(RangeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => canonicalJson(9007199254740992)).toThrow(RangeError);
    expect(() => canonicalJson(null as never)).toThrow(RangeError);
    expect(() => canonicalJson({ a: [0.1] })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Frame set (design 06 §6 extension — pinned nesting order)
// ---------------------------------------------------------------------------

describe("frame set — 32 frames, clip outer / direction middle / phase inner", () => {
  test("pinned constants", () => {
    expect(EXPORT_CLIPS).toEqual(["walk", "idle"]);
    expect(FRAMES_PER_CELL).toBe(4);
    expect(FRAME_COUNT).toBe(32);
    expect(FRAME_SIZE).toBe(32);
    expect(SHEET_COLS).toBe(4);
    expect(SHEET_ROWS).toBe(8);
    expect(SHEET_WIDTH).toBe(128);
    expect(SHEET_HEIGHT).toBe(256);
    expect(FRAME_DURATION_MS).toBe(140);
  });

  test("frame order is pinned", () => {
    expect(EXPORT.frames.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      const f = EXPORT.frames[i]!;
      expect(f.clip).toBe(EXPORT_CLIPS[Math.floor(i / 16)]);
      expect(f.direction).toBe(DIRECTIONS[Math.floor(i / 4) % 4]);
      expect(f.phase).toBe(i % 4);
      expect(f.rgba.length).toBe(32 * 32 * 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Sheet assembly (design 06 §6 extension — 8×4 grid, no padding)
// ---------------------------------------------------------------------------

describe("sheet assembly", () => {
  test("cell placement is exact: every frame blits at (col·32, row·32)", () => {
    expect(EXPORT.sheetRgba.length).toBe(128 * 256 * 4);
    for (let i = 0; i < 32; i++) {
      const row = Math.floor(i / SHEET_COLS);
      const col = i % SHEET_COLS;
      const frame = EXPORT.frames[i]!;
      // Probe pixels: full row-by-row compare of this frame's cell.
      for (let y = 0; y < 32; y++) {
        const src = frame.rgba.subarray(y * 128, (y + 1) * 128);
        const dst = EXPORT.sheetRgba.subarray(
          ((row * 32 + y) * 128 + col * 32) * 4,
          ((row * 32 + y) * 128 + col * 32) * 4 + 128,
        );
        if (!Buffer.from(src).equals(Buffer.from(dst))) {
          throw new Error(`frame ${i} row ${y} does not match its sheet cell`);
        }
      }
    }
  });

  test("known probe: frame 0 pixel (16, 16) appears at sheet (16, 16); frame 5 at (row 1, col 1)", () => {
    const at = (buf: Uint8Array, w: number, x: number, y: number): readonly number[] => [
      buf[(y * w + x) * 4]!,
      buf[(y * w + x) * 4 + 1]!,
      buf[(y * w + x) * 4 + 2]!,
      buf[(y * w + x) * 4 + 3]!,
    ];
    expect(at(EXPORT.sheetRgba, 128, 16, 16)).toEqual(at(EXPORT.frames[0]!.rgba, 32, 16, 16));
    expect(at(EXPORT.sheetRgba, 128, 32 + 13, 32 + 17)).toEqual(
      at(EXPORT.frames[5]!.rgba, 32, 13, 17),
    );
  });
});

// ---------------------------------------------------------------------------
// Metadata schema (design 06 §6, normative — golden-hashed)
// ---------------------------------------------------------------------------

describe("metadata schema", () => {
  const meta = JSON.parse(EXPORT.json) as {
    clips: Record<string, Record<string, { frames: number[]; mirror: boolean }>>;
    frames: { duration_ms: number; pivot: { x_fp: number; y_fp: number }; rect: { h: number; w: number; x: number; y: number } }[];
    generator_version: number;
    genome: string;
    hitboxes: unknown[];
    palette: { focal: number[][]; hide: number[][]; roles: string[]; underside: number[][] };
    sheet: { cell: number; h: number; w: number };
  };

  test("top-level fields", () => {
    expect(Object.keys(meta).sort()).toEqual([
      "clips",
      "frames",
      "generator_version",
      "genome",
      "hitboxes",
      "palette",
      "sheet",
    ]);
    expect(meta.generator_version).toBe(1);
    expect(meta.genome).toBe("AQ"); // the all-defaults tape (design 06 §3.4)
    expect(meta.sheet).toEqual({ cell: 32, h: 256, w: 128 });
  });

  test("frames: pinned rects, uniform 140 ms, ground-line pivot", () => {
    expect(meta.frames.length).toBe(32);
    for (let i = 0; i < 32; i++) {
      expect(meta.frames[i]).toEqual({
        duration_ms: 140,
        pivot: { x_fp: 1048576, y_fp: 1736704 }, // (16.0, 26.5) — §1.2 anchor
        rect: {
          h: 32,
          w: 32,
          x: (i % 4) * 32,
          y: Math.floor(i / 4) * 32,
        },
      });
    }
  });

  test("clips: pinned index sequences per direction, mirror false everywhere (M1)", () => {
    expect(Object.keys(meta.clips).sort()).toEqual(["idle", "walk"]);
    for (let c = 0; c < 2; c++) {
      const clip = EXPORT_CLIPS[c]!;
      for (let d = 0; d < 4; d++) {
        const dir = DIRECTIONS[d]!;
        expect(meta.clips[clip]![dir]).toEqual({
          frames: [c * 16 + d * 4, c * 16 + d * 4 + 1, c * 16 + d * 4 + 2, c * 16 + d * 4 + 3],
          mirror: false,
        });
      }
    }
  });

  test("palette: the §1.3 normative all-defaults ramps as RGB triples", () => {
    expect(meta.palette.roles).toEqual(["hide", "underside", "focal"]);
    expect(meta.palette.hide).toEqual([
      [43, 29, 46],
      [93, 55, 58],
      [148, 100, 87],
      [203, 163, 120],
    ]);
    expect(meta.palette.underside).toEqual([
      [43, 29, 46],
      [142, 108, 99],
      [196, 168, 137],
      [251, 237, 176],
    ]);
    expect(meta.palette.focal).toEqual([
      [20, 14, 24],
      [20, 14, 24],
      [30, 22, 34],
      [52, 44, 58],
    ]);
  });

  test("hitboxes: oracle-derived vectors (from-spec slab math, not from export)", () => {
    expect(meta.hitboxes.length).toBe(32);
    // Python hitbox oracle (export_diff_verify.py) — yaw, screen mapping,
    // sheared-ellipsoid y-extent, outward rounding, shadow form — applied
    // to the all-defaults wolf's slab lists + snap offsets:
    expect(meta.hitboxes[0]).toEqual({
      aabb: { h: 19, w: 10, x: 11, y: 10 },
      shadow: { cx_fp: 1048576, cy_fp: 1736704, rx_fp: 255590, ry_fp: 63897 },
    });
    expect(meta.hitboxes[5]).toEqual({
      aabb: { h: 18, w: 27, x: 2, y: 10 },
      shadow: { cx_fp: 1048537, cy_fp: 1736704, rx_fp: 498113, ry_fp: 124528 },
    });
    expect(meta.hitboxes[17]).toEqual({
      aabb: { h: 19, w: 10, x: 11, y: 10 },
      shadow: { cx_fp: 1048576, cy_fp: 1736704, rx_fp: 255590, ry_fp: 63897 },
    });
    expect(meta.hitboxes[31]).toEqual({
      aabb: { h: 18, w: 27, x: 3, y: 10 },
      shadow: { cx_fp: 1048615, cy_fp: 1736704, rx_fp: 498113, ry_fp: 124528 },
    });
  });
});

// ---------------------------------------------------------------------------
// THE FULL GOLDEN — the all-defaults wolf (design 06 §6)
// ---------------------------------------------------------------------------

/** Per-frame PNG SHA-256, frames 0..31 in pinned frame-set order. */
const GOLDEN_PNG_SHA256 = [
  "83a31995bb0953dea115897cecdff3597d37b638c9a831e558b4974e6197b68e",
  "8613026f39073017576a0875a250a5af972106b20538858131a650a63d0608d2",
  "5c90442adef582da5c01c602f1dd46dbd62e93d8514c0da56b9a980b40568acd",
  "01e63778b3d088130c0e20d783b4fcc214170edff7405145106d206b5bd3d11e",
  "409f48caccbfa2ef6f8f300816dafd74a549dd7813d667a15aeeddd3c8ac5926",
  "46a64cbf2755150746b79be22d261af8b07f09f0b4bd2c2ab9e7437cad3f39b1",
  "defe6e7e3f602c752e76c32c20bc5128608a5154c1793ffdcb0e238255bd11a7",
  "7aa8a9967e2bca602ce88b5c81ee104c991021d9efa963d73a80a45c9a77f48e",
  "ffd9d0111edc6163c006ffa97d3971c1a978aaf605a47e12b02585a0cc6e368a",
  "8eed4a52cbc4aaea4a893abb527bc0633613e03c194a3bc05e216bc9b156bed3",
  "05ed98e344b62b17b610c8749e1b434ab4ae9fca003fe6ece9deacc1b0783758",
  "32e836f14887538ee826e215b038b8345da02bd73438d80c9dff0ba168ecbd5b",
  "ed5c5c20dab33b4dbd86897638f031fd239fa47166d8e32fb81af88961a445db",
  "d79d78bb134a9d2ccab1daafc7bf3d74e1c0e49ab78620a1365b557a3c1ef7f2",
  "e8038e958c913863c2a57ef9802195bcfd931a9c30079aea6a5fcbb000c9d336",
  "e673abb7296f73da5126c908d9801c33d82464f5a6f97aea2a8d7d74659fe2aa",
  "f7b45fe6e4e06e66d6550e97789d82849041305b9271b5241578276f0a725304",
  "29eb2b9f044350a035358b549684eb94ee8b55e6982e5598f1d4c7eac9415c9f",
  "0a84832d60ca19a64b1fdb1aa3e293feda1bfa827f4a2f54a33949e8dd672cc5",
  "29eb2b9f044350a035358b549684eb94ee8b55e6982e5598f1d4c7eac9415c9f",
  "7f9f3ff3399d79a59119b86887fdb546800d17d3c5c40117c4b2f6ad5a531b48",
  "7f9f3ff3399d79a59119b86887fdb546800d17d3c5c40117c4b2f6ad5a531b48",
  "7f9f3ff3399d79a59119b86887fdb546800d17d3c5c40117c4b2f6ad5a531b48",
  "7f9f3ff3399d79a59119b86887fdb546800d17d3c5c40117c4b2f6ad5a531b48",
  "dd2ff53ffc62a233ff03bd94f03ee483f7d6c6e1c50cc5ca6e8d5ab695b1b96a",
  "66a34a55c7a03fca0027a6e9da444d274a0a55e8bd7aa447bfe6dd630e57fc86",
  "85c142d68945312397ae6edd5f72c419807b3ff87dedd161fa923d7dd9c2f3bd",
  "66a34a55c7a03fca0027a6e9da444d274a0a55e8bd7aa447bfe6dd630e57fc86",
  "3f0c63a80af69dd59f758ef26ef616e6f8075ef644baa837b803b658a3bb7b09",
  "3f0c63a80af69dd59f758ef26ef616e6f8075ef644baa837b803b658a3bb7b09",
  "3f0c63a80af69dd59f758ef26ef616e6f8075ef644baa837b803b658a3bb7b09",
  "3f0c63a80af69dd59f758ef26ef616e6f8075ef644baa837b803b658a3bb7b09",
] as const;

/** Per-frame RGBA-buffer SHA-256 (§6 artifact 1), same order. */
const GOLDEN_RGBA_SHA256 = [
  "6100cf0391608eb504ab18ab2b8cae8db8cde07e19cbc9e9ec6420b2e884773c",
  "63a4640aad796beb0e92ce3b0bd4ad163f383b55b8fe2c6943089be1b2f40d2a",
  "34688869d00f9a03af35ad7b2c16df79c47c3e6f4c29a830bfa8a39a43ed2d70",
  "33f08c7291aeff2fdceb7739f0c829cdacb8960b9624aa6550ffb494e0d4d91c",
  "58c40b7a9dcf67f280b4600b5cdf21f5fac41ae9dfe3f975c35775cfacf9d171",
  "4c45c664dbe3fe42c230f3580a6f076de98b20fbf7e5eda07e5078b1f4f7e069",
  "97d7819ff4d3a7ed8f21d693c2f3bb65eb062d467b1b7527df619403a38e7d40",
  "9906765588fe06779cdaae0ab5f23083c970276496605c9e428264d7799a6a42",
  "3550ab14255e1cfb8dc4f1b591e997f47d0c53faf1ff4da22974426e5726079e",
  "da35a1466e1fedadf623b326195ef383658e8bd47e0fb3334b1088e52b42558f",
  "095354d693e14a024ad7f7d599869a2ae45c2a5586e4527907692271b4120434",
  "c27a7981ffea9e821d8673827f713908800e0b9331b72183fe4206e2f3c0e1e1",
  "3c1bd767582ccf7edf42109ddf903eef172701f32e85837a7a19c1db3c36f24e",
  "fecc2e95e6219b018a28c63056e19da1f2b522c305caa6707ab8b7f99ba7bc51",
  "e80929014dc03d123f778ce998d3d83be38b37693dcc6388c0b031c3cb14eba1",
  "35acd094ad3bb9cedef21336e7a0bb29bc2b91aeb139b318a9becd528731d428",
  "dc8e86b94fe9f740882cd53374c2e013cc56befa910bf6c5f5f25783dec2ae83",
  "50c64c1e5e620cf1c509e734e82e371cd61f2b80e09afde1f0e8ddaa6b26ebe1",
  "4647d1cd01553afe8af85acc4ecd49700f7b4324f8a2ebd825c8920806580515",
  "50c64c1e5e620cf1c509e734e82e371cd61f2b80e09afde1f0e8ddaa6b26ebe1",
  "1770dda62f05fe40a7792f7fad78ecb5bc0b754ef605ac4a2c4e603f62ae7692",
  "1770dda62f05fe40a7792f7fad78ecb5bc0b754ef605ac4a2c4e603f62ae7692",
  "1770dda62f05fe40a7792f7fad78ecb5bc0b754ef605ac4a2c4e603f62ae7692",
  "1770dda62f05fe40a7792f7fad78ecb5bc0b754ef605ac4a2c4e603f62ae7692",
  "7f01416b3e0c5c40efb2afcc131e5f0736504edd29dba54fc755ba0aacdc1f15",
  "9c8463b11e30b2cb3da7a97efb917f976a0c0dbadc6fd5883efd184bb213fd76",
  "6862aac75e6bd81b3b328e5ff027b526ddeff108e45182b384fd67955237ec58",
  "9c8463b11e30b2cb3da7a97efb917f976a0c0dbadc6fd5883efd184bb213fd76",
  "0d9e844214f267b3f673d57004de490d811597a6c0c32f5c8e59645fc78aef92",
  "0d9e844214f267b3f673d57004de490d811597a6c0c32f5c8e59645fc78aef92",
  "0d9e844214f267b3f673d57004de490d811597a6c0c32f5c8e59645fc78aef92",
  "0d9e844214f267b3f673d57004de490d811597a6c0c32f5c8e59645fc78aef92",
] as const;

const GOLDEN_SHEET_PNG_SHA256 =
  "efd38af16fb8b1b1e3c8c9bbec17c77a453f27256684b13fc1461d65bfaaac84";
const GOLDEN_SHEET_RGBA_SHA256 =
  "08b70125c46b5d00b91f75068c7e8a944f7628830b2b7981b06c07bc72e6bdcd";
const GOLDEN_JSON_SHA256 =
  "ec506673c30aba31a40f3049d80b936c44f4a0a4e6ab400d0913f10c4558157f";

describe("the all-defaults full golden (design 06 §6)", () => {
  test("32 frame PNG SHA-256s", () => {
    expect(EXPORT.pngSha256).toEqual(GOLDEN_PNG_SHA256);
  });

  test("32 frame RGBA SHA-256s (artifact 1)", () => {
    expect(EXPORT.rgbaSha256).toEqual(GOLDEN_RGBA_SHA256);
  });

  test("sheet PNG + sheet RGBA + JSON SHA-256s", () => {
    expect(EXPORT.sheetPngSha256).toBe(GOLDEN_SHEET_PNG_SHA256);
    expect(EXPORT.sheetRgbaSha256).toBe(GOLDEN_SHEET_RGBA_SHA256);
    expect(EXPORT.jsonSha256).toBe(GOLDEN_JSON_SHA256);
  });

  test("idle side/back cells are frame-constant (F14 parks the 0.25 px idle bob)", () => {
    // Not an accident: at bob_amp 0.5 the idle amplitude is 0.25 px,
    // sub-half-pixel around the clip mean, so chain snapping renders the
    // left/up/right idle cells as four identical frames. Down differs
    // (the visible face pixels respond to the bob's tone shift).
    expect(new Set(GOLDEN_PNG_SHA256.slice(20, 24)).size).toBe(1);
    expect(new Set(GOLDEN_PNG_SHA256.slice(28, 32)).size).toBe(1);
    expect(new Set(GOLDEN_PNG_SHA256.slice(16, 20)).size).toBeGreaterThan(1);
  });

  test("the committed golden FILES byte-match a fresh render", () => {
    const sheetFile = readFileSync(
      fileURLToPath(new URL("./goldens/defaults.sheet.png", import.meta.url)),
    );
    expect(Buffer.from(EXPORT.sheetPng).equals(sheetFile)).toBe(true);
    const jsonFile = readFileSync(
      fileURLToPath(new URL("./goldens/defaults.json", import.meta.url)),
    );
    // The file is the FULL pinned canonical JSON string: UTF-8, no BOM,
    // single line, no trailing newline.
    expect(jsonFile.toString("utf8")).toBe(EXPORT.json);
  });
});

// ---------------------------------------------------------------------------
// Determinism + property sweep
// ---------------------------------------------------------------------------

/** Light structural PNG check: signature, IHDR first, IEND last. */
function pngLooksStructural(png: Uint8Array, w: number, h: number): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) return false;
  if (String.fromCharCode(...png.slice(12, 16)) !== "IHDR") return false;
  const iw = png[16]! * 16777216 + png[17]! * 65536 + png[18]! * 256 + png[19]!;
  const ih = png[20]! * 16777216 + png[21]! * 65536 + png[22]! * 256 + png[23]!;
  if (iw !== w || ih !== h) return false;
  return String.fromCharCode(...png.slice(png.length - 8, png.length - 4)) === "IEND";
}

describe("determinism and the seed sweep", () => {
  test("two exports of the defaults genome are byte-identical", () => {
    const again = exportCreature(makeGenome());
    expect(again.pngSha256).toEqual(EXPORT.pngSha256);
    expect(again.rgbaSha256).toEqual(EXPORT.rgbaSha256);
    expect(again.jsonSha256).toBe(EXPORT.jsonSha256);
    expect(Buffer.from(again.sheetPng).equals(Buffer.from(EXPORT.sheetPng))).toBe(true);
    expect(again.json).toBe(EXPORT.json);
  });

  test("seeds 0..19: export never throws, PNGs parse structurally, hashes stable across a re-render", () => {
    for (let s = 0; s < 20; s++) {
      const genome = sampleGenome(BigInt(s));
      const a = exportCreature(genome);
      expect(a.frames.length).toBe(32);
      for (const f of a.frames) {
        expect(pngLooksStructural(f.png, 32, 32)).toBe(true);
      }
      expect(pngLooksStructural(a.sheetPng, 128, 256)).toBe(true);
      expect(() => JSON.parse(a.json)).not.toThrow();
      const b = exportCreature(genome);
      expect(b.pngSha256).toEqual(a.pngSha256);
      expect(b.rgbaSha256).toEqual(a.rgbaSha256);
      expect(b.sheetPngSha256).toBe(a.sheetPngSha256);
      expect(b.jsonSha256).toBe(a.jsonSha256);
    }
  }, 120000);
});
