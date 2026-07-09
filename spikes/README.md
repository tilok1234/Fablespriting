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

## Planned

- **S2** — pose-salience frame sampling vs uniform (extends S1 code)
- **S3** — clip-scoped craft pass + flicker metric
- **S4** — 16×16 proportion remap
