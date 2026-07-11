import { describe, expect, test } from "vitest";

import type { CraftGrid, CraftPixel } from "../src/craft.js";
import { getScalar, makeGenome, sampleGenome } from "../src/genome.js";
import type { MaterialRole } from "../src/pose.js";
import {
  DEG_360_RAW,
  DEG_60_RAW,
  FOCAL_RAMP,
  HIDE_S_RAW,
  HIDE_V_RAW,
  OUTLINE_HUE_OFFSET_RAW,
  OUTLINE_S_RAW,
  OUTLINE_V_RAW,
  UNDERSIDE_S_RAW,
  UNDERSIDE_V_RAW,
  applyPalette,
  derivePalette,
  hsvToRgb8,
  wrap360,
} from "../src/palette.js";
import type { Palette, RGBA8 } from "../src/palette.js";

// ---------------------------------------------------------------------------
// Every expected value below was derived by the scratchpad Python oracle
// (palette_oracle.py, 2026-07-11), which implements the design 06 §1.3
// formulas independently — never by running this implementation. The oracle
// also re-verified the §1.3 normative all-defaults table and every pinned
// raw before the spec amendment landed.
// ---------------------------------------------------------------------------

const DEFAULTS = makeGenome();

function rgb(ramp: readonly RGBA8[], slot: number): readonly [number, number, number] {
  const c = ramp[slot]!;
  return [c[0], c[1], c[2]];
}

describe("pinned constants (design 06 §1.3 — machine-verified raws)", () => {
  test("degree and role raws", () => {
    expect(DEG_360_RAW).toBe(23592960); // 360.0
    expect(DEG_60_RAW).toBe(3932160); // 60.0
    expect(OUTLINE_HUE_OFFSET_RAW).toBe(5505024); // 84.0
    expect(HIDE_S_RAW).toBe(26870); // 0.41
    expect(HIDE_V_RAW).toBe(38011); // 0.58
    expect(UNDERSIDE_S_RAW).toBe(19661); // 0.30
    expect(UNDERSIDE_V_RAW).toBe(50463); // 0.77
    expect(OUTLINE_S_RAW).toBe(24248); // 0.37
    expect(OUTLINE_V_RAW).toBe(11796); // 0.18
  });

  test("the focal table is the pinned spike eye ramp, alpha 255", () => {
    expect(FOCAL_RAMP).toEqual([
      [20, 14, 24, 255],
      [20, 14, 24, 255],
      [30, 22, 34, 255],
      [52, 44, 58, 255],
    ]);
  });
});

describe("wrap360 (design 06 §0)", () => {
  test("negative inputs wrap up — the normative outline example", () => {
    // wrap360(13.0 − 84.0) = 289.0 (§0)
    expect(wrap360(851968 - 5505024)).toBe(18939904);
  });

  test("mathematical mod: identity inside, reduction above, exact multiples to 0", () => {
    expect(wrap360(0)).toBe(0);
    expect(wrap360(23592959)).toBe(23592959); // locus hi stays in-domain
    expect(wrap360(23592960)).toBe(0);
    expect(wrap360(23592960 + 851968)).toBe(851968);
    expect(wrap360(-1)).toBe(23592959);
  });
});

describe("HSV→RGB8 (design 06 §1.3, oracle vectors across all 6 sectors)", () => {
  const S = 31000;
  const V = 52000;
  const vectors: readonly (readonly [number, readonly [number, number, number]])[] = [
    [1234567, [202, 137, 107]], // ~18.8° sector 0
    [4567890, [187, 202, 107]], // ~69.7° sector 1
    [8888888, [107, 202, 132]], // ~135.6° sector 2
    [13111111, [107, 170, 202]], // ~200.1° sector 3
    [17000003, [138, 107, 202]], // ~259.4° sector 4
    [21999999, [202, 107, 145]], // ~335.7° sector 5
    [0, [202, 107, 107]], // sector-0 boundary, f = 0
    [3932160, [202, 202, 107]], // exactly 60.0° → sector 1, f = 0
    [23592959, [202, 107, 107]], // largest legal hue raw (sector 5, f → 1)
  ];

  test.each(vectors)("h raw %d", (h, expected) => {
    expect(hsvToRgb8(h, S, V)).toEqual(expected);
  });

  test("unwrapped or non-raw hue traps", () => {
    expect(() => hsvToRgb8(23592960, S, V)).toThrow(RangeError);
    expect(() => hsvToRgb8(-1, S, V)).toThrow(RangeError);
    expect(() => hsvToRgb8(1.5, S, V)).toThrow(RangeError);
  });
});

describe("the §1.3 normative all-defaults table (byte-exact)", () => {
  const palette = derivePalette(DEFAULTS);

  test("hide ramp — outline + 3 body tones", () => {
    expect(rgb(palette.hide, 0)).toEqual([43, 29, 46]);
    expect(rgb(palette.hide, 1)).toEqual([93, 55, 58]);
    expect(rgb(palette.hide, 2)).toEqual([148, 100, 87]);
    expect(rgb(palette.hide, 3)).toEqual([203, 163, 120]);
  });

  test("underside ramp — outline + 3 body tones", () => {
    expect(rgb(palette.underside, 0)).toEqual([43, 29, 46]);
    expect(rgb(palette.underside, 1)).toEqual([142, 108, 99]);
    expect(rgb(palette.underside, 2)).toEqual([196, 168, 137]);
    expect(rgb(palette.underside, 3)).toEqual([251, 237, 176]);
  });

  test("shared outline, opaque alpha, focal table", () => {
    expect(palette.hide[0]).toEqual(palette.underside[0]);
    for (const ramp of [palette.hide, palette.underside, palette.focal]) {
      for (const c of ramp) expect(c[3]).toBe(255);
    }
    expect(palette.focal).toEqual(FOCAL_RAMP);
  });
});

describe("ramp derivation across ramp_len and hue wraps (oracle vectors)", () => {
  // Each case: [base_hue, hue_shift, contrast, ramp_len] → hide/underside
  // ramps, oracle-derived. Cases exercise: hue at the domain hi with max
  // +shift (wrap ≥ 360 after shift), hue 0 with max −shift (negative wrap),
  // a negative shift at 200°, and a small-shift ramp_len 3.
  const cases: readonly {
    loci: readonly [number, number, number, number];
    hide: readonly (readonly [number, number, number])[];
    underside: readonly (readonly [number, number, number])[];
  }[] = [
    {
      loci: [23592959, 2949120, 22938, 5],
      hide: [
        [39, 29, 46],
        [13, 8, 14],
        [103, 61, 77],
        [193, 143, 114],
        [242, 255, 150],
      ],
      underside: [
        [39, 29, 46],
        [62, 44, 51],
        [152, 123, 106],
        [232, 241, 169],
        [188, 255, 178],
      ],
    },
    {
      loci: [0, -2949120, 6554, 3],
      hide: [
        [39, 29, 46],
        [135, 101, 80],
        [161, 95, 119],
      ],
      underside: [
        [39, 29, 46],
        [184, 129, 149],
        [201, 146, 209],
      ],
    },
    {
      loci: [13107200, -1310720, 17000, 5],
      hide: [
        [30, 46, 29],
        [29, 32, 49],
        [68, 91, 115],
        [107, 169, 181],
        [146, 247, 230],
      ],
      underside: [
        [30, 46, 29],
        [68, 83, 97],
        [114, 155, 163],
        [161, 229, 218],
        [178, 255, 217],
      ],
    },
    {
      loci: [6553600, 655360, 9000, 3],
      hide: [
        [46, 33, 29],
        [99, 130, 77],
        [115, 165, 98],
      ],
      underside: [
        [46, 33, 29],
        [139, 179, 125],
        [155, 214, 150],
      ],
    },
    {
      // asr-FLOOR discriminator (§1.3 pins asr per §5.1: floor, also for
      // negative products). ramp_len 3 makes oh odd (±1) and the odd
      // hue_shift/contrast raws make oh·shift and oh·contrast odd, so
      // floor vs truncate-toward-zero diverge on the t = 0 (oh = −1)
      // slot — byte-visibly: hide slot 1 is (61, 89, 103) under floor
      // but (61, 89, 104) under truncation. Oracle-derived; a port that
      // truncates passes every even-product vector above and fails here.
      loci: [13351230, 330403, 22823, 3],
      hide: [
        [29, 46, 29],
        [61, 89, 103],
        [113, 158, 192],
      ],
      underside: [
        [29, 46, 29],
        [106, 132, 152],
        [169, 203, 241],
      ],
    },
  ];

  test.each(cases)("loci $loci", ({ loci, hide, underside }) => {
    const [baseHue, hueShift, contrast, rampLen] = loci;
    const palette = derivePalette(
      makeGenome({
        values: [
          ["palette.base_hue", baseHue],
          ["palette.hue_shift", hueShift],
          ["palette.contrast", contrast],
          ["palette.ramp_len", rampLen],
        ],
      }),
    );
    expect(palette.hide.length).toBe(rampLen);
    expect(palette.underside.length).toBe(rampLen);
    expect(palette.hide.map((c) => [c[0], c[1], c[2]])).toEqual(hide);
    expect(palette.underside.map((c) => [c[0], c[1], c[2]])).toEqual(underside);
  });

  test("focal is identical for ramp_len 3 and 5 genomes (locus-independent)", () => {
    const p3 = derivePalette(makeGenome({ values: [["palette.ramp_len", 3]] }));
    const p5 = derivePalette(
      makeGenome({
        values: [
          ["palette.ramp_len", 5],
          ["palette.base_hue", 13107200],
          ["palette.hue_shift", -655360],
        ],
      }),
    );
    expect(p3.focal).toEqual(FOCAL_RAMP);
    expect(p5.focal).toEqual(FOCAL_RAMP);
    expect(p3.focal).toEqual(p5.focal);
  });
});

describe("applyPalette (design 06 §1.3 application rule)", () => {
  function cell(role: MaterialRole, tone: number, edge: number): CraftPixel {
    return { role, tone, partId: 0, depthRaw: 0, edge };
  }

  function pixelAt(buf: Uint8Array, w: number, px: number, py: number): readonly number[] {
    const o = (py * w + px) * 4;
    return [buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!];
  }

  const palette = derivePalette(DEFAULTS);

  test("edge/tone/role slot arithmetic, incl. edge = 2 reaching slot 0 (no floor)", () => {
    // 3 wide × 9 tall: rows = (role × edge), cols = tone 0..2.
    const roles: readonly MaterialRole[] = ["hide", "underside", "focal"];
    const grid: CraftGrid = [];
    for (const role of roles) {
      for (const edge of [0, 1, 2]) {
        grid.push([cell(role, 0, edge), cell(role, 1, edge), cell(role, 2, edge)]);
      }
    }
    const buf = applyPalette(grid, palette);
    expect(buf.length).toBe(3 * 9 * 4);

    // Oracle application vectors (palette_oracle.py application_defaults).
    const expected: Record<MaterialRole, readonly (readonly number[])[][]> = {
      // [edge][tone] → RGBA
      hide: [
        [
          [93, 55, 58, 255],
          [148, 100, 87, 255],
          [203, 163, 120, 255],
        ], // edge 0 → slot tone+1
        [
          [43, 29, 46, 255],
          [43, 29, 46, 255],
          [43, 29, 46, 255],
        ], // edge 1 → slot 0
        [
          [43, 29, 46, 255], // edge 2 tone 0 → SLOT 0 (outline reachable)
          [93, 55, 58, 255],
          [148, 100, 87, 255],
        ],
      ],
      underside: [
        [
          [142, 108, 99, 255],
          [196, 168, 137, 255],
          [251, 237, 176, 255],
        ],
        [
          [43, 29, 46, 255],
          [43, 29, 46, 255],
          [43, 29, 46, 255],
        ],
        [
          [43, 29, 46, 255], // edge 2 tone 0 → shared outline
          [142, 108, 99, 255],
          [196, 168, 137, 255],
        ],
      ],
      focal: [
        [
          [20, 14, 24, 255],
          [30, 22, 34, 255],
          [52, 44, 58, 255],
        ],
        [
          [20, 14, 24, 255], // focal edge 1 → the FOCAL table's slot 0
          [20, 14, 24, 255],
          [20, 14, 24, 255],
        ],
        [
          [20, 14, 24, 255], // focal edge 2 tone 0 → focal slot 0 (= slot 1)
          [20, 14, 24, 255],
          [30, 22, 34, 255],
        ],
      ],
    };
    roles.forEach((role, ri) => {
      for (let edge = 0; edge < 3; edge++) {
        for (let tone = 0; tone < 3; tone++) {
          expect(pixelAt(buf, 3, tone, ri * 3 + edge)).toEqual(expected[role][edge]![tone]!);
        }
      }
    });
  });

  test("transparent pixels are exactly (0, 0, 0, 0); layout is row-major RGBA", () => {
    const grid: CraftGrid = [
      [null, cell("hide", 0, 1)],
      [cell("underside", 2, 0), null],
    ];
    const buf = applyPalette(grid, palette);
    expect([...buf]).toEqual([
      0, 0, 0, 0, // (0,0) transparent
      43, 29, 46, 255, // (1,0) hide outline
      251, 237, 176, 255, // (0,1) underside light (tone 2 → slot 3)
      0, 0, 0, 0, // (1,1) transparent
    ]);
  });

  test("empty and zero-width grids produce empty buffers", () => {
    expect(applyPalette([], palette).length).toBe(0);
    expect(applyPalette([[], []], palette).length).toBe(0);
  });

  test("ramp_len mismatch and bad edge trap, never clamp", () => {
    // Tone 3 exists only for ramp_len 5 grids; DEFAULTS palette has 4 slots.
    expect(() => applyPalette([[cell("hide", 3, 0)]], palette)).toThrow(/ramp_len mismatch/);
    // Focal tone must stay 0..2 for every genome (§1.3); tone 3 traps.
    expect(() => applyPalette([[cell("focal", 3, 0)]], palette)).toThrow(RangeError);
    expect(() => applyPalette([[cell("hide", 0, 3)]], palette)).toThrow(/edge/);
    // Ragged grid traps.
    expect(() => applyPalette([[null, null], [null]], palette)).toThrow(/rectangular/);
  });

  test("edge = 2 cannot mask a ramp mismatch (§1.3 tone-range trap)", () => {
    // A ramp_len-5 grid's tone-3 pixel with edge = 2 selects slot 3 —
    // inside DEFAULTS' 4-slot ramp, so a slot-bounds check would pass it
    // silently with the wrong color. §1.3 pins tone-range validation
    // (tone > ramp_len − 2 traps whatever the edge); this must throw.
    expect(() => applyPalette([[cell("hide", 3, 2)]], palette)).toThrow(/ramp_len mismatch/);
    // Focal likewise: tone 3 with edge = 2 is slot 3 of the 4-entry
    // focal table — in bounds, still illegal (focal tone ∈ {0, 1, 2}).
    expect(() => applyPalette([[cell("focal", 3, 2)]], palette)).toThrow(RangeError);
  });
});

describe("sampled-genome property sweep (200 seeds)", () => {
  test("derivePalette is total, byte-ranged, shape-correct, outline-shared", () => {
    for (let seed = 0; seed < 200; seed++) {
      const genome = sampleGenome(BigInt(seed));
      const rampLen = getScalar(genome, "palette.ramp_len");
      const palette: Palette = derivePalette(genome);
      expect(palette.hide.length).toBe(rampLen);
      expect(palette.underside.length).toBe(rampLen);
      expect(palette.focal).toEqual(FOCAL_RAMP);
      expect(palette.hide[0]).toEqual(palette.underside[0]); // shared outline
      for (const ramp of [palette.hide, palette.underside]) {
        for (const c of ramp) {
          expect(c.length).toBe(4);
          for (const ch of c) {
            expect(Number.isInteger(ch)).toBe(true);
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(255);
          }
          expect(c[3]).toBe(255);
        }
      }
    }
  });
});
