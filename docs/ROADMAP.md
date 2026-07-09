# Roadmap

Quality-over-speed plan: evidence first (spikes), then vertical slice, then
breadth, then polish. Every milestone has acceptance criteria; nothing
advances on vibes.

## Phase 0 — Spikes (throwaway Python, `spikes/`)

| ID | Question | Status | Verdict / exit criterion |
|----|----------|--------|--------------------------|
| S1 | Does slab projection give consistent 4-dir sprites at 32 & 16, across body plans, with oscillator gaits? | ✅ done | **Yes.** Findings F1–F6 folded into designs 03/04 and `ASSESSMENT.md` §2 |
| S1b | Do the two unproven plans work — serpentine traveling wave, and the amorphous metaball fork (risk R7)? | ✅ done | **Yes.** R7 retired; findings F7–F9 in `ASSESSMENT.md` §2 |
| S2 | Does pose-salience frame sampling + non-uniform timing beat uniform 4-frame sampling? | ✅ done | **No.** Neither effect unambiguous under the pre-registered bar (2 blind raters); fallback locked: M1 = uniform sampling + uniform durations. Findings F10–F11 in `ASSESSMENT.md` §2 |
| S3 | Can a clip-scoped craft pass hold the flicker metric under threshold while applying jaggy repair + cluster merge? | ✅ done | **Yes.** Walk max pair ratio 15.17 → 8.87, wolf idle mean 12.98 → 0.18 (per-frame → clip-scoped + chain-snapped); pipeline idempotent on 2nd run after two ordering fixes; M1 CI gate = 12.0. Findings F12–F16 in `ASSESSMENT.md` §2 |
| S4 | Does proportion remap make 16×16 front views readable where naive 0.5× scaling fails (S1-F3)? | after S2 | remapped 16×16 wolf/imp faces readable on contact sheet at 1× viewing distance |

S2–S4 extend `spike01`'s code. Estimated: each is a day-scale effort.

## Phase 1 — M1 "one wolf, end to end" (production code begins)

First production code in the chosen stack (Decision D1 — decided:
TypeScript + web). Scope: ONE plan
(quadruped), full pipeline: genome (locus tree, streams, fixed-point) →
hardcoded-grammar part graph → skeleton/gait → slabs → projection → craft
pipeline v1 (rules 1–5) → PNG+JSON export, 32×32, idle+walk, 4 dirs.

Accepts when: same DNA string renders byte-identical twice and across two
machines; every craft property test passes on 200 random genomes; contact
sheet of 50 genomes contains zero degenerate creatures; flicker metric under
the S3 gate (max pair ratio < 12.0 per walk clip × direction cell; churn at
zero motion fails — a backstop gate, recalibrated on the production
renderer; caveat in `ASSESSMENT.md` F12).

## Phase 2 — M2 grammar breadth

Real grammar replaces the hardcoded graph. Ship 3 plans with maximum spread
(D4 recommendation: quadruped, levitant, amorphous — the amorphous renderer
fork lands here), trait tags, exclusion groups, part budgets, degeneracy
defenses. Attack/hurt/death clips. Form-follows-function prior mapping.

Accepts when: 100-genome pinned contact sheet reviewed and ≥80% judged
"would ship in a game jam" by review; plan mix visibly distinct at
thumbnail distance; scheduled taste-review loop established (the
anti-oatmeal instrument).

## Phase 3 — M3 craft & palette maturity

Craft rules 6–7, 16×16 remap productionized, palette engine with faction
palettes, selout depth-aware edges. Optional: search-based polish evaluation.

Accepts when: blind test — a mixed sheet of generated + hand-made 32×32
sprites; uninvolved viewers misclassify ≥50% of generated ones. (This is the
project's quality north star; design docs reference it as the "Turing
sheet".)

## Phase 4 — M4 sets & export presets

Readability solver (+ human threshold calibration), threat ladders, faction
palettes end-to-end, Aseprite/Godot/Unity presets, GIF previews, CLI batch
mode.

## Phase 5 — M5 breeding & editor

Browser editor: genome inspector (locus tree UI), breed/mutate buttons,
cousin sheets, faction generator. Homologous crossover incl. cross-plan.
Stability-under-edit becomes user-visible — the editor is its acceptance
test.

## Standing engineering practices (from M1, non-negotiable)

- Golden-image tests pin determinism per genome+version.
- Craft rules are property tests run on every generated sprite in CI.
- Flicker metric in CI for every clip.
- Contact-sheet CLI (`fablesprite sheet --seed-range`) is the human QA tool;
  pinned sheets re-render on every grammar/craft change.
- Fixed-point only in core; PRNG draws keyed to locus paths (design 01) —
  violations are review-blockers because they can't be retrofitted.
