import { describe, expect, test } from "vitest";

import { FP_ONE, INT32_MAX, INT32_MIN, asr, fp_div, fp_mul, fp_sqrt } from "../src/fixed.js";
import { getScalar, makeGenome, sampleGenome } from "../src/genome.js";
import type { Genome } from "../src/genome.js";
import { PART_NAMES, PART_ROLES, deriveAnchors } from "../src/grammar.js";
import { clipPhases, poseQuadruped } from "../src/pose.js";
import type { Slab } from "../src/pose.js";

const DEFAULTS = makeGenome();

function centers(slabs: readonly Slab[]): number[][] {
  return slabs.map((s) => [s.cx, s.cy, s.cz]);
}

function centersAndHalves(slabs: readonly Slab[]): number[][] {
  return slabs.map((s) => [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz]);
}

/**
 * Shared structural invariants, as a plain (non-expect) validator so the
 * 2,000-genome sweep stays fast — vitest expect() per raw would cost
 * ~1.2M assertion objects. Returns null when everything holds, else a
 * message pinpointing the first violation.
 */
function structureViolation(slabs: readonly Slab[]): string | null {
  if (slabs.length !== 13) return `slab count ${slabs.length} !== 13`;
  for (let i = 0; i < slabs.length; i++) {
    const s = slabs[i]!;
    if (s.role !== PART_ROLES[i]) {
      return `slab ${i} (${PART_NAMES[i]}) role ${s.role} !== ${PART_ROLES[i]}`;
    }
    for (const v of [s.cx, s.cy, s.cz, s.hx, s.hy, s.hz]) {
      if (!Number.isInteger(v) || v < INT32_MIN || v > INT32_MAX) {
        return `slab ${i} (${PART_NAMES[i]}) raw ${v} not an int32`;
      }
    }
    if (s.hx <= 0 || s.hy <= 0 || s.hz <= 0) {
      return `slab ${i} (${PART_NAMES[i]}) non-positive half-extent`;
    }
  }
  // Mirror pairs: (ear_l, ear_r) = (4, 5), (eye_l, eye_r) = (6, 7) are
  // exact x-mirrors at every phase; legs mirror in x per fore/hind pair.
  for (const [l, r] of [
    [4, 5],
    [6, 7],
  ] as const) {
    const a = slabs[l]!;
    const b = slabs[r]!;
    if (
      a.cx !== -b.cx ||
      a.cy !== b.cy ||
      a.cz !== b.cz ||
      a.hx !== b.hx ||
      a.hy !== b.hy ||
      a.hz !== b.hz
    ) {
      return `mirror pair (${PART_NAMES[l]}, ${PART_NAMES[r]}) not x-symmetric`;
    }
  }
  if (slabs[8]!.cx !== -slabs[9]!.cx) return "FL/FR hips not ±hip_x";
  if (slabs[10]!.cx !== -slabs[11]!.cx) return "BL/BR hips not ±hip_x";
  return null;
}

describe("design 06 §1.2 anchor coupling — anchors at defaults", () => {
  test("every derived anchor at all-default core dims equals the wolf raw constant exactly", () => {
    // The spec pins this as machine-verified: fp_mul(σ, 0) = 0, so the
    // delta form lands on C exactly. Each expected value is the spec
    // table's C raw.
    expect(deriveAnchors(DEFAULTS)).toEqual({
      hy: 543949, // HY 8.3
      hz: 642253, // HZ 9.8
      hipYFore: 301466, // 4.6
      hipYHind: -340787, // −5.2
      hipX: 170394, // 2.6
      cz: 498074, // CZ 7.6
      uy: 98304, // UY 1.5
      uz: 386662, // UZ 5.9
      ty: -576717, // TY −8.8
      tz: 629146, // TZ 9.6
    });
  });

  test("the underside line CZ − depth is fixed at raw 275252 across the depth domain", () => {
    // §1.2: CZ has slope 1 so deeper bodies grow upward and leg tops
    // always face the same target (275252 = 498074 − 222822, one raw ulp
    // above RHE(4.2·2^16) — derived, not pinned as a decimal).
    for (const depth of [131072, 222822, 393216]) {
      const g = makeGenome({ values: [["body.core.depth", depth]] });
      const a = deriveAnchors(g);
      expect(a.cz - depth).toBe(275252);
    }
  });
});

describe("clipPhases — S2 verdict / F10 uniform sampling", () => {
  test("K = 4 gives the exact pinned phase raws {0, 0.25, 0.5, 0.75} turns", () => {
    expect(clipPhases()).toEqual([0, 16384, 32768, 49152]);
    expect(clipPhases(4)).toEqual([0, 16384, 32768, 49152]);
    // Each is an exact multiple of the sin-LUT granularity (16 raw).
    for (const p of clipPhases(4)) expect(p % 16).toBe(0);
  });

  test("rejects k that does not divide one turn", () => {
    expect(() => clipPhases(3)).toThrow(RangeError);
    expect(() => clipPhases(0)).toThrow(RangeError);
    expect(() => clipPhases(2.5)).toThrow(RangeError);
  });
});

describe("structure — slab count, order, roles, mirrors (design 06 §1.2 part table)", () => {
  test("13 parts in the pinned row order", () => {
    expect(PART_NAMES).toEqual([
      "core",
      "core_underside",
      "head",
      "snout",
      "ear_l",
      "ear_r",
      "eye_l",
      "eye_r",
      "leg_fl",
      "leg_fr",
      "leg_bl",
      "leg_br",
      "tail",
    ]);
    expect(PART_ROLES.length).toBe(13);
  });

  test("structural invariants hold at phase 0 for both clips", () => {
    for (const clip of ["walk", "idle"] as const) {
      const slabs = poseQuadruped(DEFAULTS, clip, 0);
      expect(structureViolation(slabs)).toBeNull();
      // At phase 0 both trot groups have dy = sin(0) = sin(0.5 turns) = 0,
      // so the fore legs also share cy.
      expect(slabs[8]!.cy).toBe(slabs[9]!.cy);
      expect(slabs[10]!.cy).toBe(slabs[11]!.cy);
    }
  });

  test("default half-extents transcribe the wolf template", () => {
    const s = poseQuadruped(DEFAULTS, "idle", 0);
    expect([s[0]!.hx, s[0]!.hy, s[0]!.hz]).toEqual([255590, 498074, 222822]); // (girth, length, depth)
    expect([s[2]!.hx, s[2]!.hy, s[2]!.hz]).toEqual([196608, 222822, 196608]); // scale 1 · (3.0, 3.4, 3.0)
    expect([s[3]!.hx, s[3]!.hy, s[3]!.hz]).toEqual([104858, 144179, 98304]); // (1.6, snout_len, 1.5)
    expect([s[4]!.hx, s[4]!.hy, s[4]!.hz]).toEqual([58982, 65536, 111411]); // ear_size 1 · (0.9, 1.0, 1.7)
    expect([s[6]!.hx, s[6]!.hy, s[6]!.hz]).toEqual([52429, 45875, 52429]); // eye_size 1 · (0.8, 0.7, 0.8)
    expect([s[8]!.hx, s[8]!.hy, s[8]!.hz]).toEqual([75366, 98304, 203162]); // (girth_i, 1.5, length_i)
    expect([s[12]!.hx, s[12]!.hy, s[12]!.hz]).toEqual([72090, 209715, 72090]); // (tail.girth, tail.length, tail.girth)
  });

  test("rejects unknown clips and non-integer phases", () => {
    expect(() => poseQuadruped(DEFAULTS, "attack" as never, 0)).toThrow(RangeError);
    expect(() => poseQuadruped(DEFAULTS, "walk", 0.5)).toThrow(RangeError);
  });
});

describe("oscillator vectors — independent oracle (spec equations via the LUT)", () => {
  // Expected raws below were hand-derived by a scratchpad Python script
  // that implements the design 06 §1.2 equations directly (exact integer
  // RHE arithmetic + the §5.3 LUT definition), NOT by running this
  // implementation.

  test("A: all-defaults, walk, φ = 16384 (0.25 turns)", () => {
    // b = 0.5·sin(0.5 turns) = 0; FL/BR dy = +2.1, FR/BL dy = −2.1;
    // all dz = 0 at this phase; wag = 1.4·sin(6997 raw) = fp_mul(91750,
    // LUT[437] = 40715) = 57001.
    expect(centers(poseQuadruped(DEFAULTS, "walk", 16384))).toEqual([
      [0, -32768, 498074], // core
      [0, 98304, 386662], // underside
      [0, 543949, 642253], // head
      [0, 760218, 563610], // snout
      [-131072, 471859, 825754], // ear_l
      [131072, 471859, 825754], // ear_r
      [-104858, 714343, 681575], // eye_l
      [104858, 714343, 681575], // eye_r
      [-170394, 439092, 203162], // leg FL (group 0: dy = +137626)
      [170394, 163840, 203162], // leg FR (group 1: dy = −137626)
      [-170394, -478413, 203162], // leg BL (group 1)
      [170394, -203161, 203162], // leg BR (group 0)
      [57001, -576717, 629146], // tail
    ]);
  });

  test("B: all-defaults, idle, φ = 49152 (0.75 turns)", () => {
    // b = asr(bob_amp, 1)·sin(0.75) = 16384·(−1) = −16384; legs ride at
    // asr(b, 1) = −8192; dy = dz = 0; wag = asr(tail_amp, 1)·
    // sin(39765 raw) = fp_mul(45875, LUT[2485] = −40715) = −28500.
    expect(centers(poseQuadruped(DEFAULTS, "idle", 49152))).toEqual([
      [0, -32768, 481690], // core
      [0, 98304, 370278], // underside
      [0, 543949, 625869], // head
      [0, 760218, 547226], // snout
      [-131072, 471859, 809370], // ear_l
      [131072, 471859, 809370], // ear_r
      [-104858, 714343, 665191], // eye_l
      [104858, 714343, 665191], // eye_r
      [-170394, 301466, 194970], // leg FL
      [170394, 301466, 194970], // leg FR
      [-170394, -340787, 194970], // leg BL
      [170394, -340787, 194970], // leg BR
      [-28500, -576717, 612762], // tail
    ]);
  });

  test("C: domain-extreme genome, gait_freq 2, walk, φ = 4096", () => {
    // Exercises: g = 2 frequency doubling (2·g·φ = 16384 → b = bob_amp =
    // 131072 exactly), off-default anchors on all three core dims,
    // head-child scaling at scale 0.6, per-leg loci with non-default
    // phase groups, and half-turn tail lag.
    const g = makeGenome({
      values: [
        ["anim.quadruped.gait_freq", 2],
        ["anim.quadruped.bob_amp", 131072],
        ["anim.quadruped.leg_swing_amp", 262144],
        ["anim.quadruped.leg_lift_amp", 262144],
        ["anim.quadruped.tail_lag", 16384],
        ["anim.quadruped.tail_amp", 262144],
        ["body.core.length", 786432],
        ["body.core.girth", 393216],
        ["body.core.depth", 131072],
        ["body.head.scale", 39322],
        ["body.head.snout_len", 65536],
        ["body.head.ear_size", 117965],
        ["body.head.eye_size", 39322],
        ["body.head.eye_offset", 157286],
        ["body.leg[FL].length", 157286],
        ["body.leg[FL].girth", 52429],
        ["body.leg[FL].phase_group", 1],
        ["body.leg[FR].length", 327680],
        ["body.leg[FR].girth", 131072],
        ["body.leg[FR].phase_group", 0],
        ["body.leg[BL].length", 203162],
        ["body.leg[BL].girth", 75366],
        ["body.leg[BL].phase_group", 0],
        ["body.leg[BR].length", 249562],
        ["body.leg[BR].girth", 98304],
        ["body.leg[BR].phase_group", 1],
        ["body.tail.length", 393216],
        ["body.tail.girth", 39322],
      ],
    });
    expect(centersAndHalves(poseQuadruped(g, "walk", 4096))).toEqual([
      [0, -32768, 537396, 393216, 786432, 131072], // core
      [0, 174186, 471859, 302382, 579600, 84804], // underside
      [0, 858865, 622207, 117966, 133695, 117966], // head
      [0, 988628, 575021, 62915, 65536, 58983], // snout (scale·(1.6, ·, 1.5))
      [-78644, 815611, 732309, 106168, 117965, 200540], // ear_l
      [78644, 815611, 732309, 106168, 117965, 200540], // ear_r
      [-94373, 961102, 645800, 52429, 45875, 52429], // eye_l (floors; EY base branch)
      [94373, 961102, 645800, 52429, 45875, 52429], // eye_r
      [-262145, 290637, 222822, 52429, 98304, 157286], // leg FL
      [262145, 661365, 485898, 131072, 98304, 327680], // leg FR
      [-262145, -352719, 361380, 75366, 98304, 203162], // leg BL
      [262145, -723447, 315098, 98304, 98304, 249562], // leg BR
      [-185364, -865075, 614497, 39322, 393216, 39322], // tail
    ]);
  });
});

describe("eye visibility coupling (design 06 §1.2)", () => {
  // Expected raws below come from an independent Python transcription of
  // the spec's fp steps (RHE mul/div, isqrt-based fp_sqrt), never from
  // this implementation.

  test("all-default genome renders the original wolf eye raws exactly", () => {
    // Both floors and the EY max take the plain branch (EY margin
    // 1016 raw: base 170394 vs floor 169378 — machine-verified).
    const s = poseQuadruped(DEFAULTS, "walk", 0);
    expect(centersAndHalves(s.slice(6, 8))).toEqual([
      [-104858, 714343, 681575, 52429, 45875, 52429],
      [104858, 714343, 681575, 52429, 45875, 52429],
    ]);
  });

  test("protrusion floor engages: scale 1.6, eye_size 0.6, eye_offset 1.0", () => {
    // Oracle: Xn = 21845, inside = 55633, ySurf = 328479,
    // EY = max(272631, 314716) = 314716 (floor branch); extents floored.
    const g = makeGenome({
      values: [
        ["body.head.scale", 104858],
        ["body.head.eye_size", 39322],
        ["body.head.eye_offset", 65536],
      ],
    });
    const s = poseQuadruped(g, "walk", 0);
    expect(centersAndHalves(s.slice(6, 8))).toEqual([
      [-104858, 858665, 705168, 52429, 45875, 52429],
      [104858, 858665, 705168, 52429, 45875, 52429],
    ]);
  });

  test("footprint floors reproduce the default eye at eye_size 0.8", () => {
    // Genomic extents (41943, 36700, 41943) floor to the default raws;
    // EY stays on the base branch (oracle: floor 169378 < base 170394),
    // so the slab equals the all-default eye byte-for-byte.
    const g = makeGenome({ values: [["body.head.eye_size", 52429]] });
    const s = poseQuadruped(g, "walk", 0);
    expect(centersAndHalves(s.slice(6, 8))).toEqual([
      [-104858, 714343, 681575, 52429, 45875, 52429],
      [104858, 714343, 681575, 52429, 45875, 52429],
    ]);
  });

  test("snout cross-extents scale with the head; identity at scale 1", () => {
    const small = poseQuadruped(
      makeGenome({ values: [["body.head.scale", 39322]] }),
      "walk",
      0,
    )[3]!;
    expect([small.hx, small.hz]).toEqual([62915, 58983]); // fp_mul(0.6, (1.6, 1.5))
    const def = poseQuadruped(DEFAULTS, "walk", 0)[3]!;
    expect([def.hx, def.hy, def.hz]).toEqual([104858, 144179, 98304]); // unchanged
  });

  test("protrusion holds across 2,000 sampled genomes (spec inequality)", () => {
    // The spec's guarantee EY + EHY − ySurf ≥ 0.7·EHY, recomputed from
    // the PUBLISHED slab list only (head slab + eye slab), not from
    // pose.ts internals. Plain non-expect loop for speed; first
    // violation reported.
    for (let seed = 0; seed < 2000; seed++) {
      const g = sampleGenome(BigInt(seed));
      const s = poseQuadruped(g, "walk", 0);
      const head = s[2]!;
      const eye = s[7]!;
      const xn = fp_div(getScalar(g, "body.head.eye_offset"), 196608);
      const inside = 62915 - fp_mul(xn, xn);
      if (inside <= 0) expect.fail(`seed ${seed}: inside ${inside} ≤ 0`);
      const ySurf = fp_mul(head.hy, fp_sqrt(inside));
      const protrusion = eye.cy - head.cy + eye.hy - ySurf;
      const bound = eye.hy - fp_mul(19661, eye.hy);
      if (protrusion < bound) {
        expect.fail(`seed ${seed}: protrusion ${protrusion} < bound ${bound}`);
      }
    }
  });
});

describe("analytical properties (design 06 §1.2 claims)", () => {
  test("walk bob is exactly zero at all four K = 4 phases, for g = 1 and g = 2", () => {
    // sin-LUT indices of 2·g·φ_k are multiples of 2048, all exact zeros —
    // "walk frames cost nothing" in the leg-contact analysis.
    for (const gaitFreq of [1, 2]) {
      const g = makeGenome({
        values: [
          ["anim.quadruped.gait_freq", gaitFreq],
          ["anim.quadruped.bob_amp", 131072], // max amplitude — still zero
        ],
      });
      const cz = deriveAnchors(g).cz;
      for (const phi of clipPhases(4)) {
        expect(poseQuadruped(g, "walk", phi)[0]!.cz).toBe(cz);
      }
    }
  });

  test("legs stand on the ground plane: slab spans z ∈ [0, 2·length] at rest", () => {
    // Rest = idle φ = 0 (b = 0, dy = dz = 0).
    const slabs = poseQuadruped(DEFAULTS, "idle", 0);
    for (const i of [8, 9, 10, 11]) {
      expect(slabs[i]!.cz - slabs[i]!.hz).toBe(0);
      expect(slabs[i]!.cz + slabs[i]!.hz).toBe(2 * 203162);
    }
  });

  test("legs ride a negative odd bob with FLOOR semantics (asr, not trunc)", () => {
    // The one template path where floor-toward−∞ vs truncate-toward-zero
    // is observable end-to-end: idle φ = 0.75 turns (sin = −1 exactly)
    // with bob_amp 98766 → b = −asr(98766, 1) = −49383 (odd), so the
    // legs' asr(b, 1) is −24692 under floor but −24691 under truncation.
    // Expected raw derived by the independent Python differential oracle
    // (2026-07-11), not by this implementation. A port using `x/2|0`
    // truncation passes every other template vector but fails here.
    const g = makeGenome({ values: [["anim.quadruped.bob_amp", 98766]] });
    const slabs = poseQuadruped(g, "idle", 49152);
    for (const i of [8, 9, 10, 11]) {
      expect(slabs[i]!.cz, PART_NAMES[i]).toBe(203162 - 24692); // 178470
    }
  });

  test("idle amplitudes are exactly the asr-halved walk amplitudes", () => {
    // Odd amplitudes so the asr floor is observable (99999 >> 1 = 49999).
    const g = makeGenome({
      values: [
        ["anim.quadruped.bob_amp", 99999],
        ["anim.quadruped.tail_amp", 99999],
      ],
    });
    const a = deriveAnchors(g);
    // Walk bob peak: 2·g·φ = 16384 at φ = 8192 → b = bob_amp exactly.
    const walkBob = poseQuadruped(g, "walk", 8192)[0]!.cz - a.cz;
    expect(walkBob).toBe(99999);
    // Idle bob peak: sin(φ) = 1 at φ = 16384 → b = asr(bob_amp, 1).
    const idleBob = poseQuadruped(g, "idle", 16384)[0]!.cz - a.cz;
    expect(idleBob).toBe(asr(walkBob, 1));
    // Tail: at φ = 16384 + tail_lag (9387) the lagged argument is exactly
    // 0.25 turns in both clips (g = 1), so wag = amplitude exactly.
    const walkWag = poseQuadruped(g, "walk", 25771)[12]!.cx;
    expect(walkWag).toBe(99999);
    const idleWag = poseQuadruped(g, "idle", 25771)[12]!.cx;
    expect(idleWag).toBe(asr(walkWag, 1));
  });
});

describe("connectivity at domain extremes (design 06 §1.2 machine-verified worst cases)", () => {
  test("head overlaps the body front: worst y-overlap ≈ 0.435 px at length 12, scale 0.6", () => {
    const g = makeGenome({
      values: [
        ["body.core.length", 786432],
        ["body.head.scale", 39322],
      ],
    });
    const s = poseQuadruped(g, "idle", 0);
    const coreFront = s[0]!.cy + s[0]!.hy;
    const headRear = s[2]!.cy - s[2]!.hy;
    const overlap = coreFront - headRear;
    expect(overlap).toBe(28494); // 0.434784 px — oracle-derived exact raw
    expect(overlap).toBeGreaterThan(0);
  });

  test("head overlaps the body top: worst z-overlap ≈ 2.51 px at depth 2, scale 0.6", () => {
    const g = makeGenome({
      values: [
        ["body.core.depth", 131072],
        ["body.head.scale", 39322],
      ],
    });
    const s = poseQuadruped(g, "idle", 0);
    const coreTop = s[0]!.cz + s[0]!.hz;
    const headBottom = s[2]!.cz - s[2]!.hz;
    const overlap = coreTop - headBottom;
    expect(overlap).toBe(164227); // 2.505905 px — oracle-derived exact raw
    expect(overlap).toBeGreaterThan(0);
  });

  test("hips stay inside the body: fore footprint < 1 at length 4, across girth extremes", () => {
    // (hip_x/girth)² + ((hip_y + 0.5)/length)² < 1 — spec worst case
    // 0.978, independent of girth because hip_x/girth ≈ ⅔ is constant.
    for (const girth of [131072, 255590, 393216]) {
      const g = makeGenome({
        values: [
          ["body.core.length", 262144],
          ["body.core.girth", girth],
        ],
      });
      const a = deriveAnchors(g);
      const fx = fp_div(a.hipX, girth);
      const fy = fp_div(a.hipYFore + 32768, 262144);
      const footprint = fp_mul(fx, fx) + fp_mul(fy, fy);
      expect(footprint).toBeLessThan(FP_ONE);
      if (girth === 255590) expect(footprint).toBe(64077); // 0.977737 — oracle raw
    }
  });

  test("legs keep contact with the underside at the binding pose (idle bob peak, min length)", () => {
    // §1.2's leg-length narrowing rationale: bob_amp = 2 raises the body
    // 1 px while legs rise asr(b, 1) = 0.5 px. Worst contact = 6552 raw
    // (0.09998 px — the spec's "≥ 0.1 px" narration rounds this raw).
    const g = makeGenome({
      values: [
        ["anim.quadruped.bob_amp", 131072],
        ["body.leg[FL].length", 157286],
        ["body.leg[FR].length", 157286],
        ["body.leg[BL].length", 157286],
        ["body.leg[BR].length", 157286],
      ],
    });
    const s = poseQuadruped(g, "idle", 16384); // sin(φ) = 1: the bob peak
    const coreBottom = s[0]!.cz - s[0]!.hz;
    for (const i of [8, 9, 10, 11]) {
      const legTop = s[i]!.cz + s[i]!.hz;
      expect(legTop - coreBottom).toBe(6552);
      expect(legTop - coreBottom).toBeGreaterThan(0);
    }
  });

  test("tail stays attached: front edge penetrates the rear face by tail.length − 0.7", () => {
    // Worst case is minimum tail length (1.5): penetration 0.8 px, at
    // every core length (TY tracks the rear face at slope −1).
    for (const length of [262144, 498074, 786432]) {
      const g = makeGenome({
        values: [
          ["body.core.length", length],
          ["body.tail.length", 98304],
        ],
      });
      const s = poseQuadruped(g, "idle", 0);
      const coreRear = s[0]!.cy - s[0]!.hy;
      const tailFront = s[12]!.cy + s[12]!.hy;
      expect(tailFront - coreRear).toBe(52429); // 0.8 px exactly (oracle raw)
    }
  });

  test("TZ sits inside the core's z-range at every depth extreme", () => {
    for (const depth of [131072, 393216]) {
      const g = makeGenome({ values: [["body.core.depth", depth]] });
      const a = deriveAnchors(g);
      expect(Math.abs(a.tz - a.cz)).toBeLessThan(depth);
    }
  });
});

describe("determinism and phase wrapping", () => {
  test("same genome + clip + phase twice gives deep-equal output", () => {
    const g = sampleGenome(123n);
    for (const clip of ["walk", "idle"] as const) {
      for (const phi of clipPhases(4)) {
        expect(poseQuadruped(g, clip, phi)).toEqual(poseQuadruped(g, clip, phi));
      }
    }
  });

  test("phases wrap: φ ± one full turn is a no-op (LUT wraps mod 1 turn)", () => {
    const g = sampleGenome(7n);
    for (const clip of ["walk", "idle"] as const) {
      expect(poseQuadruped(g, clip, 16384 + 65536)).toEqual(poseQuadruped(g, clip, 16384));
      expect(poseQuadruped(g, clip, 16384 - 65536)).toEqual(poseQuadruped(g, clip, 16384));
    }
  });
});

describe("2,000-genome sampled sweep (seeds 0..1999)", () => {
  test(
    "every genome poses at all 4 walk + 4 idle phases and holds the structural invariants",
    { timeout: 60000 },
    () => {
      const phases = clipPhases(4);
      for (let seed = 0; seed < 2000; seed++) {
        const g: Genome = sampleGenome(BigInt(seed));
        for (const clip of ["walk", "idle"] as const) {
          for (const phi of phases) {
            const violation = structureViolation(poseQuadruped(g, clip, phi));
            if (violation !== null) {
              expect.fail(`seed ${seed}, ${clip}, φ=${phi}: ${violation}`);
            }
          }
        }
        // Ground contact at rest (idle φ = 0): legs span [0, 2·length].
        const rest = poseQuadruped(g, "idle", 0);
        for (const i of [8, 9, 10, 11]) {
          if (rest[i]!.cz - rest[i]!.hz !== 0) {
            expect.fail(`seed ${seed}: leg ${PART_NAMES[i]} off the ground plane at rest`);
          }
        }
      }
    },
  );
});
