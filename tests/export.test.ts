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
// Frame set (design 07 §4.1 — pinned nesting order, per-clip K)
// ---------------------------------------------------------------------------

/**
 * The pinned frame-set layout (design 07 §4.1): per frame index, its
 * clip, direction, phase, and sheet cell (row = cell index, col = phase).
 * Derived here from the pinned per-clip K — the tests' own independent
 * layout arithmetic.
 */
const LAYOUT: Array<{ clip: string; direction: string; phase: number; row: number }> = [];
for (const [clip, k] of [
  ["walk", 4],
  ["idle", 4],
  ["attack", 4],
  ["hurt", 2],
  ["death", 4],
] as const) {
  for (const direction of DIRECTIONS) {
    const row = LAYOUT.length === 0 ? 0 : LAYOUT[LAYOUT.length - 1]!.row + 1;
    for (let phase = 0; phase < k; phase++) LAYOUT.push({ clip, direction, phase, row });
  }
}

describe("frame set — 72 frames, clip outer / direction middle / phase inner", () => {
  test("pinned constants", () => {
    expect(EXPORT_CLIPS).toEqual(["walk", "idle", "attack", "hurt", "death"]);
    expect(FRAMES_PER_CELL).toBe(4);
    expect(FRAME_COUNT).toBe(72); // 16 + 16 + 16 + 8 + 16 (design 07 §4.1)
    expect(FRAME_SIZE).toBe(32);
    expect(SHEET_COLS).toBe(4);
    expect(SHEET_ROWS).toBe(20);
    expect(SHEET_WIDTH).toBe(128);
    expect(SHEET_HEIGHT).toBe(640);
    expect(FRAME_DURATION_MS).toBe(140); // uniform, ALL clips (U2 pin)
  });

  test("frame order is pinned", () => {
    expect(LAYOUT.length).toBe(72);
    expect(EXPORT.frames.length).toBe(72);
    for (let i = 0; i < 72; i++) {
      const f = EXPORT.frames[i]!;
      expect(f.clip).toBe(LAYOUT[i]!.clip);
      expect(f.direction).toBe(LAYOUT[i]!.direction);
      expect(f.phase).toBe(LAYOUT[i]!.phase);
      expect(f.rgba.length).toBe(32 * 32 * 4);
    }
  });

  test("frames 0..31 keep their exact M1 meaning (§4.3)", () => {
    for (let i = 0; i < 32; i++) {
      expect(LAYOUT[i]).toEqual({
        clip: i < 16 ? "walk" : "idle",
        direction: DIRECTIONS[Math.floor(i / 4) % 4],
        phase: i % 4,
        row: Math.floor(i / 4),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Sheet assembly (design 07 §4.1 — 20×4 grid, transparent padding cells)
// ---------------------------------------------------------------------------

describe("sheet assembly", () => {
  test("cell placement is exact: every frame blits at (phase·32, row·32)", () => {
    expect(EXPORT.sheetRgba.length).toBe(128 * 640 * 4);
    for (let i = 0; i < 72; i++) {
      const { row, phase: col } = LAYOUT[i]!;
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

  test("hurt rows pad with exactly-(0,0,0,0) cells (design 07 §4.1)", () => {
    // Hurt is rows 12..15; its K = 2, so columns 2 and 3 of each hurt row
    // are uncovered sheet pixels and must be exactly transparent black.
    for (let row = 12; row < 16; row++) {
      for (let y = 0; y < 32; y++) {
        for (let x = 64; x < 128; x++) {
          const p = ((row * 32 + y) * 128 + x) * 4;
          if (
            EXPORT.sheetRgba[p] !== 0 ||
            EXPORT.sheetRgba[p + 1] !== 0 ||
            EXPORT.sheetRgba[p + 2] !== 0 ||
            EXPORT.sheetRgba[p + 3] !== 0
          ) {
            throw new Error(`hurt padding pixel (${x}, ${row * 32 + y}) is not (0,0,0,0)`);
          }
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
    expect(meta.generator_version).toBe(2); // design 07 §4.3
    expect(meta.genome).toBe("AQ"); // the all-defaults tape (design 06 §3.4)
    expect(meta.sheet).toEqual({ cell: 32, h: 640, w: 128 });
  });

  test("frames: pinned rects, uniform 140 ms, ground-line pivot", () => {
    expect(meta.frames.length).toBe(72);
    for (let i = 0; i < 72; i++) {
      expect(meta.frames[i]).toEqual({
        duration_ms: 140,
        pivot: { x_fp: 1048576, y_fp: 1736704 }, // (16.0, 26.5) — §1.2 anchor
        rect: {
          h: 32,
          w: 32,
          x: LAYOUT[i]!.phase * 32,
          y: LAYOUT[i]!.row * 32,
        },
      });
    }
  });

  test("clips: pinned index sequences, mirror false everywhere, flash on hurt only", () => {
    expect(Object.keys(meta.clips).sort()).toEqual(["attack", "death", "hurt", "idle", "walk"]);
    let i = 0;
    for (const clip of EXPORT_CLIPS) {
      for (const dir of DIRECTIONS) {
        const k = LAYOUT.filter((e) => e.clip === clip && e.direction === dir).length;
        const indices = Array.from({ length: k }, (_, j) => i + j);
        expect(meta.clips[clip]![dir]).toEqual(
          clip === "hurt"
            ? { flash: true, frames: indices, mirror: false }
            : { frames: indices, mirror: false },
        );
        i += k;
      }
    }
    expect(i).toBe(72);
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
    expect(meta.hitboxes.length).toBe(72);
    // Python hitbox oracle (M1: export_diff_verify.py; U2:
    // hitbox_oracle.py + envelope_oracle.py, 2026-07-11) — yaw, screen
    // mapping, sheared-ellipsoid y-extent, outward rounding, shadow form
    // — applied to the all-defaults wolf's slab lists + snap offsets.
    // M1 spots (frames 0..31 — value-identical to the v1 vectors):
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
    // U2 spots (new clips; frame index = 32 + …, design 07 §4.1 layout):
    expect(meta.hitboxes[32]).toEqual({
      // attack/down f0 — the anticipation crouch
      aabb: { h: 20, w: 10, x: 11, y: 10 },
      shadow: { cx_fp: 1048576, cy_fp: 1736704, rx_fp: 255590, ry_fp: 63897 },
    });
    expect(meta.hitboxes[33]).toEqual({
      // attack/down f1 — the strike
      aabb: { h: 21, w: 10, x: 11, y: 10 },
      shadow: { cx_fp: 1048576, cy_fp: 1736704, rx_fp: 255590, ry_fp: 63897 },
    });
    expect(meta.hitboxes[49]).toEqual({
      // hurt/down f1 — the return frame
      aabb: { h: 20, w: 10, x: 11, y: 10 },
      shadow: { cx_fp: 1048576, cy_fp: 1736704, rx_fp: 255590, ry_fp: 63897 },
    });
    expect(meta.hitboxes[68]).toEqual({
      // death/right f0 — the stagger
      aabb: { h: 18, w: 28, x: 2, y: 11 },
      shadow: { cx_fp: 983079, cy_fp: 1736704, rx_fp: 498113, ry_fp: 124528 },
    });
    expect(meta.hitboxes[71]).toEqual({
      // death/right f3 — the held collapse (equals f2 by construction)
      aabb: { h: 13, w: 28, x: 2, y: 16 },
      shadow: { cx_fp: 983079, cy_fp: 1736704, rx_fp: 498113, ry_fp: 124528 },
    });
  });
});

// ---------------------------------------------------------------------------
// THE FULL GOLDEN — the all-defaults wolf (design 06 §6 as extended by
// design 07 §4; v2 goldens re-pinned at U2, frames 0..31 byte-identical
// to the v1 golden arrays — the §4.3 anchor law at frame granularity)
// ---------------------------------------------------------------------------

/** Per-frame PNG SHA-256, frames 0..71 in pinned frame-set order. */
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
  "3c906d3dde7276d7a374e3e552ea399ed27ccc988ffffcb94735753c4502177e",
  "e9ee59731f828939b8630af38df9fdcda191cae0dd5555337324d75b28c9f8f1",
  "976301a213560dc9cd45fe8a44c157241ed37444ccd40ce7040a04977d2893d7",
  "32a9a89dbace3f635ae46f58106ff0ee8766473c326c19de0a287576c8e951eb",
  "d8a21bb95d93e030e4431f98fcc10495f6ec30f00107babd3c8e95a03c43d1c9",
  "7ea3e6664566d25457a3df4f0bfee72e755f04c6d16683199f9f1f87b1693139",
  "dc4efe01f4073a3c0a59d5b3b68bf45f543f7de9c628ec02200df58c47aef950",
  "032ba954f5d2a7516fc4b46c5f852c2bf9225392d69e773cbd535ff8e5db2661",
  "a8fbfc0cab2336afaa3f765c1625670193f819bcbd3afbdf113da8d35d8f827e",
  "40b6004a04d2c11e865bbedf754117e3fa41429976cf211ca2d9a1cd7994a876",
  "5dc8771a9cc879583a81106bcc2e54d51936d29dd9d584331fbb3e56c414a852",
  "b6b4dff1943fe6aa4db6afbeaf5eb53b961bdc5cbb3d61573e09ecb051dd135b",
  "8e5cfef2dc7c148a05d84deaa1393b69f5e47b352766b99df6886bf0de24ab81",
  "6fd9929be914fa32b26f1eb8ae2092f8f1b032279f51b48048ecdc38e2665d1d",
  "77e7daf8968f465508725039bdf68b0408138296c626f4819e0a9daea685ef06",
  "d98aaaa1ebf2cf5df05778e3bf4876c9e8168536739c9688305dc4053e227284",
  "c6a62be52f95e9a1f6f4400fd49315108f61ae0a9af0c5ca48e464ab64f8c332",
  "976301a213560dc9cd45fe8a44c157241ed37444ccd40ce7040a04977d2893d7",
  "cf759f49562573ee8951a8e11f1e06e844dc4718695166ae490502b57b0f75a7",
  "d2205599700d4550543d4a7bdd88760e5bde10813194470c121441e2645a130e",
  "faf56523ca4b41686266d62b74005a7e470a9f7f6f44583283a23e81a4e55524",
  "97423442636c368b1395fa155438f5b5f9144da510246d4e26ceaf572e396cb2",
  "743a9c702c27d4b881ba9e80aadf35e6ad4bf4a5e615b35fa5277e3bf459ee8d",
  "8c673425ede951bb9ea34a8f27a4e3d6b9e6a3e69026ee3dd212a51d5ed71e4f",
  "b6a4044a714c9ed716b619f9f879bc4e8e6f79c3d7c5f9e0d82315b7a9b58acd",
  "2e676465848de7ae719282053764022e17d61fd7a5dfd42ec05905b59e24e9f2",
  "bba10426bb87ebceb8e93b641f02c030c4eeea08209291f7d0cbf762f8d615f0",
  "bba10426bb87ebceb8e93b641f02c030c4eeea08209291f7d0cbf762f8d615f0",
  "70301bed8cefd77a06c3577adebf8ecc91aa263069c6c143921d0418843c13e7",
  "7ac4e92d657d0220547055e7a05c6b45a6f7a6abfebe00029f45f3e1b74a1849",
  "4319f187a056fa4809f561434135837a63abdb3225301cabc2aa80afd17fda4a",
  "4319f187a056fa4809f561434135837a63abdb3225301cabc2aa80afd17fda4a",
  "31db0df0e8bcf622160f998bf063808e53d08ca8be1227877c9e0be8aedf8d86",
  "aca5abf484dc8671f59485e88a46cbfa2f793e7cc3383f453d1a0ea08191fcc2",
  "ba02b6432f8fb7fab9637caf9e18761c78e93141ded6c0c2232b6b0c75f8526d",
  "ba02b6432f8fb7fab9637caf9e18761c78e93141ded6c0c2232b6b0c75f8526d",
  "8e93139cb585a62156f9be00f8e59306540db7db4b52d8dc6776696e076a46c9",
  "61c8e3b0cd4c4c178814aeb769b50bb82bbbcc8538e36f5ea6f7b23b3aaf100a",
  "876282a5e3569d31d928b71cb9b2fafd1db4c3fd5bc0fd9d72b01f1951733c0f",
  "876282a5e3569d31d928b71cb9b2fafd1db4c3fd5bc0fd9d72b01f1951733c0f",
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
  "83f02cce86fc57e9522a6152f300a75e11bf23bd93b20e11e27a1408aa6b436d",
  "f8d90a8f5dffce8e2510c62ca3630c4fabbd06f475e733bdc9becf5781a6669c",
  "07afa94854c2186165c8d1e104cfa453429c8ca1c875cd4aad4c56583672f159",
  "63a83794635a920ceaeccb2dad629d5f9517c85c83bf10d382c2279703e3763a",
  "ef91ec99ce62963a8e486becb804a3873349c131d2e7a839937a609236971967",
  "194ce8ca184475760939ff15076ffc9a2f1858c79a39639ba2837b850026d590",
  "93d5e4bb54a02410802aed574553c234526479e608c5538f023915f9638e0e7c",
  "42046bc6359223d823c66905584aa018b0964d0ae92c0ff33a0fbf2ec5ba6e13",
  "69a336d7a1a8a31da3afb07495110817309c4ed9a103f5ccb7989249a294143f",
  "cfeb4a5fc1efa6b69201bc0ce2b250d992354a8f0797aa1577daa10e2979929f",
  "18312c23b5d2e1b3dcf283c0480c3a2a6223c1ba7e6ac34d02b601f9ca5d2659",
  "755584c7f7aa0ffb3d5cadfc40fa58e63edde08461632cf550c1bb9c17b4cd02",
  "a56f192f75fa2aea9e354f810a2ed61ba05d18de4be8931b78423d3ae2438446",
  "3045f27b3cebb8471c1171865f24a9a2694088c4dafa46a0312a5a53d266df98",
  "7586940717362ba7149ac180f22ed458ff9446cc6372609c18b7077960870292",
  "0246c0b75401756cba254091bec25d73ac777cc3834cce6cead85c2958979873",
  "a46db406d8f43705db48114c65c556b74c935c4faa0c77186b3a1b5a89d61c88",
  "07afa94854c2186165c8d1e104cfa453429c8ca1c875cd4aad4c56583672f159",
  "3584b55e87ba84cf1ec543dfff586e72d8c2f84cb32894d3601ef1d998c7c145",
  "01e54bff826b77648055494d944c3de5212bdc6964104ec60666d93db148b1b7",
  "98d155a6565ba2e1fcff78ba45ef6401a3c42b7bfd1b2f0eb5343c494fdaebfb",
  "3613e87f923ea2f6380c68cc07ef1c8051e0164affd44d8aaa656e479d92cfb4",
  "8ca4ee9252de55557d50be448e588602d954dc66d639c811edddf04973f78f28",
  "9588b88aad9df6dc24a37b2df746bfe565a4479c1029d2abb1eb8d2590b35c9c",
  "705a54b8cf540d19bd8954c5507d40aaa50e88fdbdc3e731c50c6b477cfca191",
  "4e4a4246f2568a8f195a0599caf7bb3afe0b36cadc632fdfae011e47f72d9ca3",
  "9a659cce9fda1fa632892f7f75bdfd22a14d936a3f9c8271d7ff073c7831de7b",
  "9a659cce9fda1fa632892f7f75bdfd22a14d936a3f9c8271d7ff073c7831de7b",
  "11fc8111e3fd9565829a808de76b213b5a074c1076ede27d8dbb2e01dba88f43",
  "1a4d6d310614b63eaa3ee0b4bcdb39e6fb2614a47dd4e5d20ded77bdfb63fe55",
  "a0530163a56209854b5825dc313476d0bbf7a3af8687372d222bb44a534246f1",
  "a0530163a56209854b5825dc313476d0bbf7a3af8687372d222bb44a534246f1",
  "4c6f978da9b561e4a09453a79b0bebcc606f94d578be7eb401f37cf6f2aebb5b",
  "67f3fda2072a9b0f3595c8295a00eec3275984fd3e9febaf4a943fc034c81071",
  "749f95127d3b23473c66278b205a75e9d8486c19050b462bc6870cfbcee3d4c1",
  "749f95127d3b23473c66278b205a75e9d8486c19050b462bc6870cfbcee3d4c1",
  "53c8dcbbbeffd6c4d1cd6931141ae80551b53e2e3d38a08eb249a1b881abeb40",
  "c7221b97d1efcb476aa99cd02f4a391922e80ca87c67d2e55a76adc6ffcf2208",
  "2c5bb064191dfa342f5ed5eac883b665043fc3e22e427223a6e5c149fc80e66b",
  "2c5bb064191dfa342f5ed5eac883b665043fc3e22e427223a6e5c149fc80e66b",
] as const;

const GOLDEN_SHEET_PNG_SHA256 =
  "9fa3db255cd622318e2a0a0f49e16fcbb1e6a8d47bf7e7e94ac8f6a9d3ac57a4";
const GOLDEN_SHEET_RGBA_SHA256 =
  "1f9c569b7054a625bd44fa0c1e0b200080ebd46fe190e508ab5ef3e21e4fa346";
const GOLDEN_JSON_SHA256 =
  "94abf46c766dc1426380b434fefefe98c34157202de6df4f3f34374e902c9748";

describe("the all-defaults full golden (design 06 §6 / design 07 §4)", () => {
  test("72 frame PNG SHA-256s (0..31 = the v1 golden array, unchanged)", () => {
    expect(EXPORT.pngSha256).toEqual(GOLDEN_PNG_SHA256);
  });

  test("72 frame RGBA SHA-256s (artifact 1)", () => {
    expect(EXPORT.rgbaSha256).toEqual(GOLDEN_RGBA_SHA256);
  });

  test("death holds its final frame: f3 = f2 per cell, byte-identical", () => {
    // Frames 56..71 are death; per direction cell the last two frames
    // are the held collapse (design 07 §4.4).
    for (let d = 0; d < 4; d++) {
      expect(GOLDEN_RGBA_SHA256[56 + d * 4 + 3]).toBe(GOLDEN_RGBA_SHA256[56 + d * 4 + 2]);
      expect(GOLDEN_PNG_SHA256[56 + d * 4 + 3]).toBe(GOLDEN_PNG_SHA256[56 + d * 4 + 2]);
    }
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
      expect(a.frames.length).toBe(72);
      for (const f of a.frames) {
        expect(pngLooksStructural(f.png, 32, 32)).toBe(true);
      }
      expect(pngLooksStructural(a.sheetPng, 128, 640)).toBe(true);
      expect(() => JSON.parse(a.json)).not.toThrow();
      const b = exportCreature(genome);
      expect(b.pngSha256).toEqual(a.pngSha256);
      expect(b.rgbaSha256).toEqual(a.rgbaSha256);
      expect(b.sheetPngSha256).toBe(a.sheetPngSha256);
      expect(b.jsonSha256).toBe(a.jsonSha256);
    }
  }, 120000);
});
