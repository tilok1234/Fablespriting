/**
 * THE single-source flicker gate-table pin (design 07 §4.2 as amended at
 * U3/U4). Exactly ONE test module asserts the full FLICKER_GATES object
 * for ALL plans — the U3 close-out found duplicate pins in clips.test.ts
 * AND levitant.test.ts (a silent-divergence risk); U4 consolidated them
 * here (the behavioral gate tests stay in their unit files; only the
 * table PIN lives here).
 *
 * Calibration record (each row by the M1 method against that plan's OWN
 * production histogram; gate = tightest integer ≥ 1.25× the observed
 * max; full histograms in design 07):
 *
 * - quadruped: the U2 §4.4.6 pins restated (walk 25.1166 / attack
 *   14.6730 / hurt 10.8359 / death 19.2914 → 32/19/14/25).
 * - levitant: U3 close-out full 0..1999 sweep (walk 37.3744 / attack
 *   114.9282 / hurt 17.2825 / death 16.1387 → 47/144/22/19).
 * - amorphous: U4 one-step full 0..1999 amorphous-forced sweep on the
 *   FINAL production path (design 07 §2.4.1 — the §4.4.6 close-out
 *   lesson: never 200-then-2000; 8000 cells (2000 seeds × 4
 *   directions) per clip,
 *   0 INF, death held pairs exactly 0.0): walk 113.8060 / attack
 *   49.7549 / hurt 22.0728 / death 22.6905 → 143/63/28/29 (margins
 *   1.257× / 1.266× / 1.269× / 1.278×).
 *
 * Idle rows carry the plan's walk rational; idle stays ungated (M1
 * policy) — the row exists for callers that measure idle cells.
 */

import { describe, expect, test } from "vitest";

import { FLICKER_GATES } from "../src/flicker.js";
import { PLAN_NAMES } from "../src/genome.js";

describe("the flicker gate table (single-source pin, all plans)", () => {
  test("FLICKER_GATES is exactly the pinned per-(plan, clip) table", () => {
    expect(FLICKER_GATES).toEqual({
      quadruped: {
        walk: { num: 32n, den: 1n },
        idle: { num: 32n, den: 1n },
        attack: { num: 19n, den: 1n },
        hurt: { num: 14n, den: 1n },
        death: { num: 25n, den: 1n },
      },
      levitant: {
        walk: { num: 47n, den: 1n },
        idle: { num: 47n, den: 1n },
        attack: { num: 144n, den: 1n },
        hurt: { num: 22n, den: 1n },
        death: { num: 19n, den: 1n },
      },
      amorphous: {
        walk: { num: 143n, den: 1n },
        idle: { num: 143n, den: 1n },
        attack: { num: 63n, den: 1n },
        hurt: { num: 28n, den: 1n },
        death: { num: 29n, den: 1n },
      },
    });
  });

  test("every plan has a row (the type forces it; the runtime agrees)", () => {
    for (const plan of PLAN_NAMES) {
      expect(FLICKER_GATES[plan], plan).toBeDefined();
      for (const clip of ["walk", "idle", "attack", "hurt", "death"] as const) {
        const gate = FLICKER_GATES[plan][clip];
        expect(gate.den).toBe(1n);
        expect(gate.num > 0n).toBe(true);
      }
    }
  });
});
