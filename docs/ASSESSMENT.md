# Fablesprite — Detailed Design Assessment

**Status:** planning phase · assessment grounded in Spikes S1–S4 (see `spikes/`)
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
the top risk. After S1 the top risk was craft-pass temporal coherence;
Spike S3 tested it and it holds (F12–F16). Next up was 16×16 readability;
Spike S4 closed it by descope rather than mitigation — the remap improved
faces but not to a shippable bar, and the owner dropped 16×16 as a
generated tier (D5, F17–F19). The top three risks are now:

1. **"Procedural oatmeal"** — the grammar producing endless *valid but
   boring* creatures. A content-design risk, not an engineering one; needs
   archetype attractors and human taste loops from M2 onward.
2. **Craft-pass engineering breadth** — temporal coherence is validated on
   the spike substrate, but the craft pass is still the biggest single
   work item: pipeline v1 with S3's ordering fixes, the F15/F16
   refinements, and rules 6–7 at M3.
3. **Genome stability & determinism discipline** — stability under edit
   (locus-path-keyed streams) and byte-identical cross-platform output
   (fixed-point core) are cheap now and brutal to retrofit; they become
   load-bearing with M1's first production line (§3.7, §4).

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
  honest"); it became a confirmed requirement with a design (S4) — though
  the tier it served was later descoped (S4 verdict + D5).
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

### Spike S1b — serpentine + amorphous (the two unproven plans)

Run: `python3 spikes/spike01b_more_plans.py`. A centipede validated the
traveling-phase-wave gait (one `delta` gene turns segment oscillators into a
slither; leg nubs riding the same wave a quarter-phase ahead produce a leg
ripple for free), and a slime validated the **metaball renderer fork** —
risk R7 — in ~100 lines: same projection, same majority-vote rasterizer,
same craft-lite; only the ray/surface intersection differs (marched field
threshold instead of a quadratic). Slab-based face parts (eyes, highlight)
depth-sort correctly against the blob surface, so amorphous creatures can
still have grammar-attached focal features. Additional findings:

- **F7 — Selout eats thin bodies.** A 2px-wide creature is *all* edge
  pixels, so the outline rule painted the first centipede entirely in
  near-background outline color. Consequences: minimum-girth clamps in the
  grammar (per resolution), and the craft pass must skip or soften outlines
  on sub-3px clusters. Serpentine plans are the stress test for this rule.
- **F8 — Metaball fields need threshold-relative authoring.** The field
  surface must sit well below per-ball peak weight (TH≈0.3 validated), and
  ball radii must be authored relative to the *visible* radius (~0.67× the
  ball radius at TH=0.3). The grammar's amorphous rules must bake this in.
- **F9 — Animation amplitudes need resolution remap, not just proportions.**
  At full hop-stretch the 16×16 slime collapsed into a 3px bar. Extends F3:
  the remap stage (design 04 §6) must also scale oscillator amplitudes.

### Spike S2 — pose-salience sampling (the blind A/B)

Run: `python spikes/spike02_pose_salience.py`. Two raters ranked six blind
three-panel GIFs (A uniform / B salience / C salience+retime; sampling
effect = B vs A, timing effect = C vs B); the mapping was unsealed only
after both ratings were recorded. Full scoring:
`spikes/out/spike02_ratings.md`. Findings:

- **F10 — Salience sampling did not beat uniform; M1 ships uniform.** On
  the sampling effect, rater 1 preferred salience in 4/6 cells (meeting
  the bar) but rater 2 split 3–3; on the timing effect, rater 1 counted
  C=1 / B=2 / ties=3 and rater 2 C=3 / B=1 / ties=2 — neither reached
  4/6. Both effects are ambiguous under the pre-registered bar, so the
  fallback locks in: **M1 uses uniform sampling + uniform durations**
  (design 05's per-frame duration metadata degrades gracefully to
  constant values). One per-plan lead, recorded as observation rather
  than commitment: salience swept all 4 watcher (levitant) cells across
  both raters while splitting on the quadruped/biped — worth revisiting
  after M1.
- **F11 — Coarse GIF timing degenerates the timing arm.** The watcher's
  salience-selected phases were near-evenly spaced, so at 10 ms GIF
  granularity its retimed durations rounded back to uniform — B and C
  were pixel-identical there, spending 2 of 6 timing cells as forced
  ties. The degenerate arm doubled as an attention check: both raters
  exactly tied the identical panels in all 4 watcher cells, so the
  ratings are credible. Future perceptual A/Bs need finer timing
  granularity (or stimuli chosen so no arm degenerates), verified before
  sealing the blind.

### Spike S3 — clip-scoped craft pass + flicker (the idempotence gauntlet)

Run: `python spikes/spike03_craft_clip.py`. Three arms attribute the
mechanisms separately (the S2 lesson): arm 1 = per-frame craft decisions,
unsnapped; arm 2 = clip-scoped decisions, unsnapped; arm 3 = clip-scoped +
chain snapping. Findings:

- **F12 — Clip-scoped decisions + chain snapping hold flicker under a
  CI-able threshold; snapping is the dominant mechanism.** Walk-clip
  pair-ratio aggregates (mean/max): arm 1 = 7.43/15.17, arm 2 =
  6.89/14.45, arm 3 = 4.01/8.87; wolf idle mean 12.98 (arm 1) → 0.18
  (arm 3). Clip-scoping alone is a modest win — snapping does the heavy
  lifting. The pipeline is exactly idempotent (asserted on tagged grids
  for every frame, all three arms) and the comparison is non-vacuous (143
  per-frame decision variances in arm 1 across walk clips). A static
  pseudo-clip validated the zero-motion convention: 0 changed pixels at 0
  motion scores 0.0; churn with no motion is INF = auto-fail. The metric,
  gate, and convention are now defined and validated on the spike
  substrate. Proposed M1 CI gate: every walk clip × direction cell keeps
  max pair ratio < 12.0; INF auto-fails. Margin logic: ≥ 1.25× arm-3
  worst (8.87), below arm-1 worst (15.17). Honest caveat: the spec wanted
  the gate below arm-1 *typical* max, but the data made that window
  unsatisfiable (arm-1 typical 9.27 vs arm-3 max 8.87) — 12.0 is a
  backstop against egregious flicker, not a full regression detector;
  recalibrate on the production renderer at M1.
- **F13 — The design-04 pipeline v1 order fights itself.** (a) Selout
  decided before the cluster-budget merge is invalidated by every merge —
  selout must be decided *and applied* on post-merge geometry. (b) Rules
  2/3/5 must iterate to a joint fixpoint within one pass: the naive
  single-shot order left work for a second run (= idempotence failure);
  baseline clips needed 2 work rounds. Also: aggregate stats must use
  presence-based medians — zero-inflated per-frame medians deleted whole
  thin bodies whose majority part tag oscillates.
- **F14 — Snap rounding mode is load-bearing.** Half-up rounding turned
  the wolf/imp exactly-half-pixel bob into a 1-px square wave that
  dominated arm-3 worst pairs; ties-to-even parks the knife edge
  (wolf/walk/down max 9.20 → 1.75). The M1 fixed-point spec must pin
  ties-to-even for snapping.
- **F15 — The budget merge defeats F7's thinness criterion.** Once the
  thin snake merges into one whole-body cluster, its bbox-min exceeds
  3 px and its size exceeds 6 px, so outline softening stops firing and
  the snake drowns in outline (the exact failure F7 exists to prevent) in
  arms 1–2. M1 selout must decide F7 exemptions from *pre-merge*
  part-level cluster stats, or use a local-thickness measure instead of
  bbox-min.
- **F16 — Per-slab snapping distorts multi-slab assemblies.** The arm-3
  wolf visibly flattens on the contact sheet. A follow-up probe *refuted*
  the obvious mechanism (per-frame relative slab jitter feeding the
  merge): the head-assembly slabs share the same motion, so the relative
  snap offsets are constant sub-pixel shifts (max 0.7 px, identical
  across all 8 frames); the ears survive arm 3 *better* than arm 2 (a
  stable 6-px ear block in every frame), and no merge decision in either
  arm ever touches an ear key. The actual mechanisms, all downstream of
  the snap (the only variable between arms 2 and 3): (a) ties-to-even
  freezes the ±0.5 px gait bob — the silhouette locks at height 16 in all
  frames while arm 2 breathes 16–17 (the 25–35 px/frame arm-2-vs-3 diff
  is mostly body/leg rows); (b) the constant relative shifts reshape the
  head/snout (head part pixels 31 → 27); (c) snapping made the left eye
  rasterize (3 px vs 0 unsnapped) and the budget merge then recolored it
  as body fur. Consequences: production snapping must group slabs by
  skeleton **chain** (design 03's wording — "keyed to the chain" —
  already says this) so assemblies shift together; the cluster budget
  must treat focal materials (eyes, emitters) as merge-protected —
  extending F5's focal-contrast rule so a craft rule can never erase a
  face; and the flicker gate alone is not a quality gate — the
  pinned-contact-sheet human QA (a standing practice) remains the
  readability guard.

Scope note: S3 exercised the slab path only; craft coverage of the
amorphous/metaball path lands with M2 (when amorphous ships per the D4
recommendation).

### Spike S4 — 16×16 proportion remap (the descope)

Run: `python spikes/spike04_remap16.py`. Two conditions, both rendered
natively at 16×16 and judged blind at 1× and 4×: N naive (untransformed
model, exactly as S1) vs R remapped (design 04 §6: head gain, focal gain,
sub-pixel ornament drop, girth clamp, amplitude re-quantization). Verdict:
**no.** The remap measurably improves faces — the imp front view goes from
a faceless column to a readable chibi face with two separated glow eyes,
the watcher improves, side views do not regress — but the result does not
reach a shippable bar: the owner (rater 1) judged the 16×16 outputs
unreadable against the project's own 32×32 output quality, and the exit
criterion required BOTH raters to answer yes on the remapped wolf/down and
imp/down panels, so a definitive owner "no" fails it without needing
rater 2. The owner decision (D5, §5) goes beyond the pre-registered R3
fallback: 16×16 is dropped as a generated tier entirely. Findings:

- **F17 — Remap gains are per-creature genome genes, not global style
  constants.** No global gain pair exists: the wolf needs head ×1.6 before
  eye pixels leave the silhouette edge, while the watcher swallows its own
  wings above ~×1.3. Tuned values: wolf head ×1.6 / focal ×1.3; imp ×1.5 /
  ×1.3; watcher ×1.3 / ×1.0. This validates design 04 §6 naming them as
  genes, and stands as evidence for any future per-part-scaling work at
  any resolution.
- **F18 — Focal gain is a point-eye gene, and gains cannot fix placement.**
  (a) The watcher's layered sclera→iris→pupil eye stack tolerates no extra
  focal gain: above ~×1.05 the tilted ray enters the grown sclera's
  shoulder before the iris pole and renders a blank white blob. (b) The
  wolf's eyes are authored at the edge of its head — head-gain scales
  offsets and extents together, so no gain setting can move eyes inward;
  at 16×16, eye *placement* itself would need remapping. The remap-op
  vocabulary (scale-only) is structurally insufficient for
  authored-at-the-edge faces.
- **F19 — Scope notes.** The sub-pixel ornament-drop op is implemented but
  fired zero times on the three test creatures (smallest ornament =
  0.65 px at 16, above the 0.5 px bar) — that path is unexercised
  evidence. Amplitude re-quantization worked as specified: every walk step
  landed on integer 16-px steps, including the design doc's literal
  1.03 → 1.00 px case on the imp.

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
limbs at 16×16 (F3/F4; 16×16: descoped, D5), occlusion artifacts in rare
poses, and the amorphous fork. The "left/right true projections when
asymmetric, mirrored when symmetric" rule is trivially implementable —
symmetry is a property the grammar already knows.

### 3.3 Gait Engine — value ●●●, risk 🟢

The most pleasant surprise of S1. Trot, counter-swing, hover, flap, and
phase-lagged tendrils each took a few lines of oscillator math, and all read
clearly after quantization. The open quality question is **frame selection**:
uniform-time sampling wastes frames between salient poses. Proposal: sample
the continuous gait densely, then pick K frames by farthest-point sampling in
pose space so contact/extreme poses always survive ("pose-salience
sampling"). Design: `docs/design/03-animation.md`. Test in Spike S2.
S2's verdict: pose-salience sampling did not beat uniform in the blind A/B
(F10), so M1 ships uniform sampling + uniform durations.

### 3.4 Craft-Rule Pass — value ●●●, risk 🟡 (was 🔴, temporal coherence de-risked by S3)

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
   CI. This was untested and hard to retrofit → Spike S3 before M1 completes.
   S3's verdict: clip-scoped decisions + chain snapping hold the metric
   under a CI-able gate (walk max 15.17 → 8.87, wolf idle mean
   12.98 → 0.18)
   and the pipeline is exactly idempotent once the rule order is fixed
   (F12–F14). What remains is M1 engineering breadth plus two S3-surfaced
   refinements: F7 exemptions from pre-merge stats (F15) and chain-grouped
   snapping (F16).

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
  below — decided 2026-07-09: TypeScript + web.

## 5. Owner decisions

| # | Decision | Options | Resolution |
|---|----------|---------|------------|
| D1 | Production language/platform | TypeScript+web · Rust+wasm · Python tool | ✅ 2026-07-09: **TypeScript + web editor** |
| D2 | Primary product shape | in-browser tool · CLI/batch · runtime game library | ✅ 2026-07-09: **browser tool first, library extracted later** |
| D3 | Art-direction lock | outline style (selout vs hard black), tilt, palette philosophy | ✅ 2026-07-09: **selout + TILT=0.5 + hue-shifted ramps, as rendered in S1's sheet** |
| D4 | MVP body plans | which 3 plans ship M2 first | Open — recommendation: quadruped, levitant, amorphous (max spread) |
| D5 | 16×16 output tier | keep as generated tier · derived-but-hand-tunable side output · drop | ✅ 2026-07-10: **dropped as a generated tier** (owner call on S4 evidence); revisit post-M5 only on real demand |

D1–D3 were decided 2026-07-09; M1 is unblocked (they never blocked spikes
S2–S4, which are language-agnostic evidence gathering). D4 blocks M2 only
and stays open until M2 planning. D5 was decided 2026-07-10 after Spike
S4, and goes beyond the pre-registered R3 fallback (which would have kept
16×16 as a derived-but-hand-tunable side output): Fablesprite is a 32×32
sprite generator. At a quarter of the pixel budget the generator's honest
output starts far below the owner's quality bar, so investment goes to the
32×32 tier instead; the S4 evidence and machinery stay in `spikes/` as the
record.
