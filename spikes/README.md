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

**Verdict: no.** Neither effect was unambiguous — sampling: rater 1
preferred salience in 4/6 cells but rater 2 split 3–3; timing: neither
rater reached 4/6 (the watcher's retimed panel rounded back to
pixel-identical at 10 ms GIF granularity, forcing ties) — so the
pre-registered fallback locked in: M1 uses uniform sampling + uniform
durations. Findings F10–F11 in `docs/ASSESSMENT.md` §2; blind rankings
and scoring in `spikes/out/spike02_ratings.md`.

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

## S3 — clip-scoped craft pass + flicker metric (`spike03_craft_clip.py`)

**Question:** can a clip-scoped craft pass hold the flicker metric
(`changed_pixels / motion_energy`, wrap-around pair included) under
threshold while applying jaggy repair + cluster merge, with the pipeline
idempotent on a second run (no rule fights)? Three arms attribute the
mechanisms separately (S2's lesson): **1** per-frame craft decisions,
unsnapped; **2** clip-scoped decisions, unsnapped; **3** clip-scoped +
chain snapping.

**Verdict: yes.** Walk-clip pair-ratio aggregates (mean/max) fall from
7.43/15.17 (arm 1) to 4.01/8.87 (arm 3), wolf idle mean 12.98 → 0.18 —
clip-scoping alone is a modest win (arm 2: 6.89/14.45); snapping is the
dominant mechanism. The pipeline is exactly idempotent in all three arms
after two ordering fixes (selout decided and applied post-merge; rules
2/3/5 iterated to a joint fixpoint) — the rule fights the spike was sent
to find. Proposed M1 CI gate: max pair ratio < 12.0 per walk cell; churn
at zero motion = INF = fail. Findings F12–F16 in `docs/ASSESSMENT.md` §2.

```
python spikes/spike03_craft_clip.py
# → spikes/out/spike03_flicker.json   (all measurements + verdict data)
# → spikes/out/spike03_sheet.png      (walk frames, rows = arms — diagnostic,
#                                      not blind; the exit bar is numeric)
# → spikes/out/spike03_walk_<creature>_<dir>.gif  (arms side by side, 6×, 140 ms)
```

## S4 — 16×16 proportion remap (`spike04_remap16.py`)

**Question:** does a proportion-remap stage (design 04 §6: head gain,
extra focal gain on eyes, sub-pixel ornament drop, ≥1px limb girth clamp,
gait amplitudes re-quantized to the 16-px grid via S3's ties-to-even
displacement snapping) make 16×16 front views readable where naive 0.5×
scaling fails (S1 finding F3)? Two conditions, both rendered natively at
16×16: **N** naive (untransformed model, exactly as S1) vs **R** remapped.
Gains are per-creature — tuning found no global pair exists (wolf needs
head ×1.6, the watcher swallows its wings above ×1.3, and its layered
sclera/iris/pupil eye tolerates no extra focal gain at all).

**Verdict: no (owner call).** The remap measurably improved faces — the
imp front view goes from a faceless column to a readable chibi face with
two separated glow eyes, the watcher improves, side views don't regress —
but not to a shippable bar: the owner (rater 1) judged the 16×16 outputs
unreadable against the project's own 32×32 quality. The exit required BOTH
raters to answer yes on wolf/down and imp/down, so a definitive owner "no"
fails it without rater 2. The owner went beyond the R3 fallback: 16×16 is
dropped as a generated tier entirely (decision D5) — Fablesprite is a
32×32 sprite generator; revisit post-M5 only on real demand. Findings
F17–F19 in `docs/ASSESSMENT.md` §2.

```
python spikes/spike04_remap16.py
# → spikes/out/spike04_judging.png    (blind pairs at 1× and 4× — the test)
# → spikes/out/spike04_sheet.png      (de-blinded diagnostic — do NOT peek)
# → spikes/out/spike04_walk_<creature>_down.gif  (16×16 walks, blind pair, 8×)
# → spikes/out/spike04_remap.json     (gains, drops, clamps, amplitudes, mapping)
# → spikes/out/spike04_mapping.txt    (sealed de-blinding key)
```

**Judging:** 2+ humans view `spike04_judging.png` at 100% zoom, BEFORE
opening the mapping, the diagnostic sheet, or the GIFs. Per cell and per
panel, Q1 (primary, absolute): "can you locate the head and both eyes?"
yes/no. Per cell, Q2 (paired, supporting): "which panel reads better as
the creature's face?" 1/2/tie. Blinding is weak (bigger heads are
identifiable) — that is why Q1 is primary. **Exit:** S4 passes if the
remapped panel gets Q1 = yes from both raters on wolf/down and imp/down.
Fallback (risk R3): 16×16 becomes a derived-but-hand-tunable output tier
*(superseded in the event: decision D5 dropped the tier entirely)*.
