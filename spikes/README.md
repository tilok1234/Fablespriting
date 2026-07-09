# Spikes

Throwaway evidence code. Rules of this directory:

- Python, floats, brute force — anything goes; **none of this is the
  product.** Production code (fixed-point, locus streams, tests) starts at
  M1 in a separate tree.
- Each spike answers ONE question from `docs/ROADMAP.md` Phase 0 and its
  verdict gets folded into the design docs; the code stays as a record.
- Outputs land in `spikes/out/` (committed — they're the evidence).

## S1 — slab projection feasibility (`spike01_slab_projection.py`)

**Question:** can one micro-volume creature model produce readable,
consistent 4-direction sprites at 32×32 AND 16×16, with oscillator-driven
walk cycles, across multiple body plans?

**Verdict: yes.** Three body plans (quadruped, biped, levitant) share one
renderer; walk gaits read at 4 frames; both resolutions render from the same
model. Findings F1–F6 (tilt sign convention, tilt as style parameter, the
16×16 proportion problem, resolution-dependent thresholds, focal-material
contrast, performance headroom) are written up in `docs/ASSESSMENT.md` §2.

```
python3 spikes/spike01_slab_projection.py
# → spikes/out/spike01_sheet.png  (contact sheet: 4 dirs × 4 frames × 2 sizes)
# → spikes/out/spike01_walk.gif   (animated walk, all creatures/directions)
```

Requires: Python 3.10+, Pillow (`pip install pillow`).

## S1b — serpentine + amorphous (`spike01b_more_plans.py`)

**Question:** do the two plans S1 didn't cover work — the serpentine
traveling-wave gait, and the amorphous metaball renderer fork (risk R7)?

**Verdict: yes.** A centipede (7 segments, phase-lagged wave, leg-nub
ripple) and a hopping slime (marched metaball field, squash/stretch,
lagging drip, slab eyes composited against the blob surface) render through
the same projection/rasterizer/craft path. R7 retired; findings F7–F9
(selout vs thin bodies, threshold-relative metaball authoring, amplitude
remap per resolution) in `docs/ASSESSMENT.md` §2.

```
python3 spikes/spike01b_more_plans.py
# → spikes/out/spike01b_sheet.png / spike01b_walk.gif
```

## S2 — pose-salience frame sampling (`spike02_pose_salience.py`)

**Question:** do the two mechanisms of design 03 §3 each improve how a
4-frame walk reads — (a) SAMPLING salient poses instead of uniform
quarter-cycle phases, and (b) TIMING each frame by the phase arc it covers?
Three conditions over the same 560 ms cycle (32×32 only) attribute the
claims separately: **A** uniform phases + uniform timing (matches S1),
**B** salience phases + uniform timing, **C** salience phases + re-timed
durations. Sampling effect = B vs A; timing effect = C vs B.

**Status: built — verdict pending 2-human judgment.**

```
python spikes/spike02_pose_salience.py
# → spikes/out/spike02_ab_<creature>_<dir>.gif  (6 blind 3-panel GIFs — the test)
# → spikes/out/spike02_sheet.png       (de-blinded diagnostic sheet — do NOT peek)
# → spikes/out/spike02_selection.json  (selected phases/durations + blind mapping)
# → spikes/out/spike02_mapping.txt     (sealed de-blinding key)
```

**Judging:** 2+ humans each watch the six GIFs blind and rank panels 1/2/3
per GIF, best→worst, for "reads best as a natural gait cycle" (ties
allowed) — BEFORE opening `spike02_mapping.txt` or `spike02_sheet.png`.
Unambiguous = both raters agree on an effect's winner and each prefers it
in ≥4/6 cells. Fallback if ambiguous or uniform wins: M1 uses uniform
sampling and/or uniform durations.

## Planned

- **S3** — clip-scoped craft pass + flicker metric
- **S4** — 16×16 proportion remap
