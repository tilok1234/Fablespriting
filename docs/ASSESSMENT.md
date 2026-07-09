# Fablesprite — Detailed Design Assessment

**Status:** planning phase · assessment grounded in Spike S1 (see `spikes/`)
**Companion docs:** deep dives in `docs/design/`, risks in `RISKS.md`, plan in `ROADMAP.md`

This document assesses every pillar of `CONCEPT.md` for value, feasibility,
and risk — including *empirical* results from Spike S1, which implemented the
riskiest slice (slab projection + oscillator gait, three body plans, 4
directions, 32×32 and 16×16) in ~400 lines of throwaway Python.

---

## 1. Executive verdict

The concept is sound and the architecture holds together. The single most
important empirical result: **slab projection works.** One micro-volume model
per creature produced mutually consistent 4-direction sprites at both target
resolutions with readable walk cycles, for three structurally different body
plans, using the *same* renderer and zero per-plan rendering code. The
concept's central bet — creature-first, pixels-last — survived contact with
reality on the first try.

The risk profile has shifted accordingly. Before the spike, projection was
the top risk. After it, the top three risks are:

1. **Craft-pass temporal coherence** (pixel flicker across animation frames) —
   never tested yet, hard to retrofit. → Spike S3.
2. **16×16 readability** — naive scale-down of the 32×32 model loses faces
   and features; needs resolution-specific proportion exaggeration, not
   scaling. → Spike S4.
3. **"Procedural oatmeal"** — the grammar producing endless *valid but
   boring* creatures. A content-design risk, not an engineering one; needs
   archetype attractors and human taste loops from M2 onward.

Recommended next steps are in `ROADMAP.md`; decisions needed from you are at
the bottom of this file.

---

## 2. Spike S1 — what we actually learned

Run: `python3 spikes/spike01_slab_projection.py` → `spikes/out/`.

### Confirmed

- **4-direction consistency is free.** All four views come from one model;
  heights, proportions, and accessory positions agree by construction. This
  was the concept's core promise and it holds.
- **Body-plan breadth is cheap.** Quadruped (trot gait), biped (arm/leg
  counter-swing), and levitant (hover + wing-flap + lagged tendrils) all
  rendered and animated through identical machinery. The only per-plan code
  is the *pose function* — exactly the part the future grammar generates.
  This strongly supports the "not just humanoids" claim.
- **Oscillator gaits read at 4 frames.** Even brutally quantized, the
  diagonal-pair trot and hover-bob are legible. Phase relationships (the CPG
  idea) survive quantization better than absolute smoothness does — which is
  what matters for pixel art.
- **Majority-vote rasterization beats naive coverage.** Assigning each pixel
  to the (material, tone) with the most supersamples produces clean cluster
  boundaries instead of mush. Keep this technique.
- **Craft-lite is already load-bearing.** Just two rules (edge darkening +
  orphan-pixel culling) move output from "rendered" to "pixel art-ish."
  The full craft pass is the highest-leverage quality investment.

### Findings that change the design

- **F1 — Tilt sign convention.** First render had front/back views hiding
  the body behind the head. The fix: in top-down projection, geometry closer
  to the camera must land *lower* in the sprite (a creature facing "down"
  leads with its head at the sprite's bottom edge). This is now a documented
  invariant with the math in `docs/design/04-rendering-craft.md`.
- **F2 — Tilt is a style parameter.** T=0.35 was too flat for elongated
  quadrupeds; T=0.5 reads well. Tilt should be a *global art-direction gene*
  (whole bestiary shares it), possibly with a per-plan nudge.
- **F3 — 16×16 is not small 32×32.** At 16×16 the wolf's side view survives
  but its front view collapses and faces vanish. Real pixel artists redraw
  at 16 with bigger heads and eyes. Consequence: the generator needs a
  **resolution remap stage** — proportion-exaggeration genes applied when
  rendering the 16×16 variant (head/eye scale up, ornament budget down).
  This was in the concept as a hope ("the craft pass keeps each resolution
  honest"); it is now a confirmed requirement with a design (S4).
- **F4 — Craft thresholds are resolution-dependent.** Pixel-ownership
  coverage needed 0.42 at 32×32 vs 0.34 at 16×16 to keep thin limbs alive.
  Every craft rule must take resolution as a parameter.
- **F5 — Contrast is a materials problem.** The imp's dark eyes vanished on
  dark skin; swapping to a bright "glow" ramp fixed readability at both
  resolutions with zero geometry changes. The palette engine should enforce
  a **minimum tonal contrast between "focal" materials (eyes, emitters) and
  their backing material** — a cheap, mechanical rule with outsized payoff.
- **F6 — Performance is a non-issue.** Brute-force pure Python (no bounding
  boxes, no caching) renders a full creature set in seconds. A production
  implementation with per-slab bounding boxes will be interactive-speed even
  in the browser; runtime in-game generation is realistic.

---

## 3. Pillar-by-pillar assessment

Scale: value ●○○ low → ●●● high; risk 🟢 low / 🟡 medium / 🔴 high.

### 3.1 Body-Plan Grammar — value ●●●, risk 🟡

The differentiator. No competitor generates phylum-level variety, and S1
shows the downstream pipeline doesn't care which plan produced the model —
so grammar breadth is *additive* work, not multiplicative.

Risks: (a) oatmeal — valid-but-boring outputs; (b) degenerate geometry
(self-intersecting or unreadable part combos). Mitigations: archetype
attractors (trait tags gating part/material choices so each creature commits
to a theme), per-resolution part budgets, and silhouette-class constraints.
The amorphous plan cannot use ellipsoid slabs and needs a metaball field
path — the one place the renderer forks. Full design:
`docs/design/02-bodyplan-grammar.md`.

### 3.2 Slab Projection — value ●●●, risk 🟡 (was 🔴, de-risked by S1)

Proven at both resolutions. Remaining risks are quality-grade ones: thin
limbs at 16×16 (F3/F4), occlusion artifacts in rare poses, and the amorphous
fork. The "left/right true projections when asymmetric, mirrored when
symmetric" rule is trivially implementable — symmetry is a property the
grammar already knows.

### 3.3 Gait Engine — value ●●●, risk 🟢

The most pleasant surprise of S1. Trot, counter-swing, hover, flap, and
phase-lagged tendrils each took a few lines of oscillator math, and all read
clearly after quantization. The open quality question is **frame selection**:
uniform-time sampling wastes frames between salient poses. Proposal: sample
the continuous gait densely, then pick K frames by farthest-point sampling in
pose space so contact/extreme poses always survive ("pose-salience
sampling"). Design: `docs/design/03-animation.md`. Test in Spike S2.

### 3.4 Craft-Rule Pass — value ●●●, risk 🔴 (now the top engineering risk)

Highest leverage, most engineering. Two design decisions matter:

1. **Pipeline vs solver.** A fixed-order rule pipeline (quantize → orphan
   cull → jaggy repair → selout → cluster-budget merge → banding check) is
   predictable and debuggable. A global optimizer (at 256–1024 pixels,
   simulated annealing is genuinely feasible per frame) could score higher
   but is harder to control. **Recommendation: pipeline first; add a
   search-based final polish only if the pipeline plateaus.**
2. **Temporal coherence.** Rules that make per-frame local decisions will
   flicker across animation frames. The pass must operate on the *clip*, not
   the frame: shared decisions keyed to model-space features, plus an
   explicit flicker metric (pixels changed per frame vs. motion energy) in
   CI. This is untested and hard to retrofit → Spike S3 before M1 completes.

### 3.5 Form-Follows-Function — value ●●, risk 🟢

A mapping table from stats to morphology genes; nearly free once the genome
exists, and F5 (focal-material contrast) already gives ranged enemies their
visible emitters. Keep in scope but sequence after the grammar (M2).

### 3.6 Readability Solver (set-level) — value ●●, risk 🟡

Silhouette IoU + hue-distance + threat-ladder constraints are all cheap to
compute. Risk is calibration (how similar is "too similar"?) — resolvable
only with human eyes on real bestiaries; schedule with M4, after there are
bestiaries to look at.

### 3.7 DNA / Breeding — value ●●●, risk 🟡

The genome design is where correctness matters most:

- A bare PRNG seed **cannot** support breeding (no locus alignment), so the
  genome must be a structured locus tree; crossover aligns homologous
  subtrees by locus path.
- **Stability under edit** is the make-or-break UX property: nudging one
  gene must not reshuffle unrelated features. Solution: every random draw
  keyed to its locus path (named PRNG streams), never to a global sequence.
- Determinism "same DNA + version = identical bytes, forever" requires
  integer/fixed-point math throughout — floats differ across platforms.

All three are design-time decisions that are cheap now and brutal to
retrofit. Full design: `docs/design/01-genome.md`.

---

## 4. Cross-cutting engineering assessment

- **Determinism discipline:** fixed-point (16.16) arithmetic, PCG32 with
  locus-derived streams, versioned genomes. Applies to every module; costs
  little if adopted from the first line of production code.
- **Testing strategy:** craft rules are *properties* ("no orphan pixels",
  "≤N clusters", "flicker below threshold") — assertable on every output,
  which makes property-based testing unusually effective here. Golden-image
  tests pin determinism. A contact-sheet CLI is the primary human QA tool
  (S1's sheet already demonstrates the format).
- **Recommended stack:** production core in **TypeScript** (integer math is
  fine in JS; one codebase serves a browser-based editor, a CLI, and JSON
  export into any engine; wasm port possible later if runtime perf demands).
  Spikes stay in Python where iteration is fastest. This is Decision D1
  below — not yet locked.

## 5. Decisions needed (from you)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Production language/platform | TypeScript+web · Rust+wasm · Python tool | TypeScript+web editor |
| D2 | Primary product shape | in-browser tool · CLI/batch · runtime game library | browser tool first, library extracted later |
| D3 | Art-direction lock | outline style (selout vs hard black), tilt, palette philosophy | selout + T=0.5 + hue-shifted ramps (as in S1) |
| D4 | MVP body plans | which 3 plans ship M2 first | quadruped, levitant, amorphous (max spread) |

None of these block the next spikes (S2–S4), which are language-agnostic
evidence gathering. They block M1.
