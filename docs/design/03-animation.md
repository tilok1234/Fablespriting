# Design 03 — Animation: oscillators, clips, frame selection

Spike S1 validated the core bet: coupled oscillators driving the skeleton
produce plausible, plan-appropriate motion in all four directions with no
authored frames, and the motion survives quantization to 4 frames.

## 1. Oscillator network model

Each animated chain (leg, arm, tail, wing, tendril segment, blob control
point) is driven by a phase oscillator:

```
value(t) = A · wave(φ_global · f + offset)      # wave = sin or shaped pulse
```

Genes per chain: amplitude `A`, frequency ratio `f` (integer ratios only —
keeps loops closed), phase `offset`, and waveform shape. Plans ship default
networks (the "gait template"):

- quadruped trot: leg offsets (0, π, π, 0); walk: (0, π/2, π, 3π/2)
- biped: legs (0, π), arms counter-phased to same-side leg
- serpentine: segment k gets offset k·Δ (traveling wave; Δ is a gene —
  small Δ = smooth slither, large Δ = caterpillar scrunch)
- levitant: slow body sine; fast locomotor flap at f=3; trailing parts copy
  the body signal with lag k·λ (S1's tendrils — reads as soft-body for free)
- amorphous: control points on offset phases → squash/stretch

Two S1 lessons: (1) **phase relationships carry the read**, not smoothness —
diagonal-pair timing was legible even at 4 fps-equivalent; (2) secondary
motion via *phase lag* is absurdly cheap character (one gene per chain).

## 2. Clips = oscillator preset + envelope

| Clip | Mechanism |
|------|-----------|
| idle | low-amplitude preset (breath sine, ear/tail flick on slow ratio) |
| walk | full gait preset |
| attack | idle preset + one-shot envelope: anticipation (contract, 1–2 f) → strike (lunge along facing, 1 f) → recovery (2 f) |
| hurt | 1-frame offset against facing + palette flash flag in metadata |
| death | envelope to plan-specific collapse pose (quadruped folds legs; levitant loses altitude; amorphous deflates); aberrations get a scramble gene |
| special | plan-specific preset (burrow, split, inflate) — grammar decides availability |

Envelopes are piecewise fixed-point curves layered onto the oscillator pose;
an `anticipation` gene scales the contract phase (snappy vs heavy — this
single gene is most of "game feel" at this sprite size).

**Direction handling is free:** clips are defined in model space; the four
projections do the rest. The only directional logic anywhere: emitter parts
orient along facing during attack.

## 3. Frame selection — pose-salience sampling (Spike S2)

Uniform-time sampling wastes frames between salient poses and can *miss*
contact extremes at K=4. Proposal:

1. Sample the continuous clip at 64 phases.
2. Define pose distance = sum of joint-position deltas (fixed-point).
3. Pick K frames by farthest-point sampling, seeded with the two extremes
   of the dominant oscillator (guarantees contact poses survive).
4. Re-time: each frame's display duration = the phase interval it covers
   (non-uniform durations, exported in metadata — this is how hand-timed
   pixel animation actually works).
5. Snap the chosen poses to whole-pixel offsets before rasterizing.

Hypothesis to test in S2: salience-sampled 4-frame walks read better than
uniform 4-frame walks, and non-uniform timing beats uniform timing. Cheap to
A/B on a contact sheet + GIF.

**As built (Spike S2)** (`spikes/spike02_pose_salience.py`):

- Joint proxy = slab centers; pose distance = sum of per-slab center deltas
  in model space. Selection runs once, pre-yaw, so all four directions share
  the same frames.
- Dominant-oscillator seed, operationalized genome-free: the dense phase p*
  maximizing D(pose(p), pose(p+π)), paired with p*+π — the two most-opposed
  poses. Captures contact extremes for footfall gaits and generalizes to
  non-footfall plans (hover, flap).
- Step 5 (pixel snapping) is deferred to Spike S3 — the spike renderer has
  no snapping hook.
- The A/B was upgraded to THREE conditions — A uniform, B salience +
  uniform timing, C salience + re-timed — so the sampling claim (B vs A)
  and the timing claim (C vs B) are attributed separately, not conflated.
- Rater protocol: 2+ humans rank the three blind panels of each GIF across
  6 creature × direction cells, then unseal `spikes/out/spike02_mapping.txt`.
  Unambiguous = both raters agree on an effect's winner and each prefers it
  in ≥ 4/6 cells.
- Fallback: if an effect is ambiguous or uniform wins it, M1 adopts uniform
  sampling and/or uniform durations — design 05's per-frame duration
  metadata degrades gracefully to constant values.

**Verdict (judged 2026-07-09, 2 raters):** ambiguous on both effects —
sampling: rater 1 preferred salience 4/6 (meeting the bar) but rater 2
split 3–3; timing: neither rater reached 4/6. The fallback is adopted:
**M1 uses uniform sampling + uniform durations.** Salience sweeping all
four watcher (levitant) cells is recorded as a post-M1 lead, not a
commitment. Scoring in `spikes/out/spike02_ratings.md`; findings F10–F11
in `docs/ASSESSMENT.md` §2.

## 4. Temporal coherence (with the craft pass)

The craft pass must treat a **clip** as the unit of work, not a frame:

- Per-clip, not per-frame, decisions: outline color choices, cluster-budget
  merges, and dither patterns are decided once per clip from aggregate
  statistics, then applied to every frame.
- **Flicker metric** in CI: `changed_pixels(f, f+1) / motion_energy(f, f+1)`
  where motion energy is total joint displacement. High ratio = pixels
  churning without motion to justify it. Threshold set by Spike S3 —
  see the as-built gate below.
- Sub-pixel motion policy: a limb's screen position moves in whole pixels
  only (snap per frame); slabs never "shimmer" between two pixel columns
  across a clip because snapping is keyed to the chain, not the frame.

**As built (Spike S3)** (`spikes/spike03_craft_clip.py`):

- Flicker metric as implemented: per consecutive frame pair,
  `changed_pixels / motion_energy`, where changed_pixels counts final-RGBA
  pixel diffs and motion_energy sums, over slabs, the Euclidean
  screen-space displacement of the slab's *continuous pre-snap* projected
  center, per direction. Clips wrap — the (last, first) pair is included.
  Zero-motion convention: zero changed pixels at zero motion scores 0.0;
  any churn at zero motion is INF = automatic fail.
- Snapping as implemented: per clip × direction × chain, quantize the
  *displacement from the clip mean* of the chain's screen position —
  `snapped(f) = round(mean) + round(pos(f) − mean)` per axis — so
  sub-half-pixel jitter around the mean never flips a pixel column.
  `round()` is ties-to-even, and that is load-bearing (F14): half-up
  rounding turns an exactly ±0.5 px gait bob into a 1-px square wave
  (wolf/walk/down max 9.20 → 1.75 under ties-to-even); the M1 fixed-point
  spec pins ties-to-even. The spike used slab-as-chain as a proxy;
  production must *group* slabs by skeleton chain so assemblies shift
  together — per-slab snapping reshaped the wolf's head and froze its bob
  (F16).
- Gate for M1 CI: every walk clip × direction cell keeps max pair ratio
  < 12.0; INF auto-fails. Caveat, recorded honestly: the spec wanted the
  gate below arm-1 *typical* max, but the data made that window
  unsatisfiable (arm-1 typical 9.27 vs arm-3 max 8.87) — 12.0 is a
  backstop against egregious flicker, not a full regression detector;
  recalibrate on the production renderer at M1.

**Verdict:** clip-scoped decisions + chain snapping hold the metric —
walk aggregates (mean/max) 7.43/15.17 per-frame → 4.01/8.87
clip-scoped + snapped, wolf idle mean 12.98 → 0.18 — with the pipeline
exactly idempotent. Findings F12–F16 in `docs/ASSESSMENT.md` §2.

## 5. Budgets

Per creature, per resolution: idle 2–4 f, walk 4–8 f (gene), attack 3–5 f,
hurt 1–2 f, death 4–6 f, ×4 directions (×~2.5 when L/R mirrors). Worst case
≈ 27 poses × 4 dirs ≈ 108 renders/creature/resolution — S1 perf data (F6)
says this stays interactive with bounding-box culling.
