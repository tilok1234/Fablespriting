# Design 07 — M2 foundations: grammar, plan trio, clip set

The M2 analogue of design 06: the implementation contract for ROADMAP
Phase 2. Like 06, it starts as architecture + policy pins and grows
normative sections **amended in the same change as the unit that proves
them** (06 grew §1.4–§1.6 and §6 that way). Sections marked *pinned at
unit start* name their evidence source; nothing speculative gets
constants here before a machine-verified derivation exists.

Sources: design 02 (grammar formalism), design 03 (clips/envelopes),
S1/S1b findings F5–F9 (levitant/serpentine/amorphous evidence), S3 scope
note (metaball craft coverage owed), design 06 §§1.1/2/3 (registry,
path, and wire laws M2 must extend without breaking).

## 0. Scope

**D4 is decided (2026-07-11): the M2 trio is quadruped, levitant,
amorphous** — maximum spread: the proven baseline, the no-ground-contact
plan, and the renderer fork. Owner accepted the standing recommendation
when green-lighting M2.

In scope: real grammar (replaces the hardcoded part graph), the two new
plans, attack/hurt/death clips, degeneracy defenses, trait-tag gating,
form-follows-function prior presets, the pinned 100-genome sheet + taste
loop, generator version 2.

Non-goals, with reasons:

- **Craft rules 6–7 and palette breadth** — M3 (ROADMAP). M2 keeps
  material roles exactly `[hide, underside, focal]`; trait tags gate
  *structure and motion*, not new ramps.
- **Readability solver / set-level constraints** — M4. The M2
  self-check (§5) is per-creature only.
- **Breeding engine** — M5. Exception, kept because 06 §1.1 pinned it:
  the cross-plan `anim` **semantic map table** ships with the second
  plan (§2.5) as data + a referential-integrity test; no crossover code
  consumes it until M5.
- **Mirror optimization** — stays off; every `mirror` flag remains
  `false`. Per-leg loci and phase groups make truly mirror-identical
  cells rare, and nothing in the M2 acceptance needs the bytes saved.
- **16×16** (D5), **salience sampling** (F10; the levitant-sweep lead
  stays a recorded observation — do not fold it into U3).
- **LICENSE file** — resolved in U1: the owner picked **MIT**; the
  LICENSE file and the package.json `license` field land in the U1
  commit (owed since the 2026-07-09 licensing decision, "before M1's CI
  setup"; M1 shipped without it).

## 1. Architecture: the grammar replaces the template

### 1.1 Part graph (design 02 §1, made concrete)

Growth produces a **PartGraph**: nodes
`{path, kind, slabs[], sockets[], material_role, anim_chain}`, kinds
from design 02 (`core`, `segment`, `limb`, `head`, `sensor`, `emitter`,
`ornament`, `locomotor`). A socket carries `{name, allowed_kinds,
symmetry, clearance_fp}`; symmetry ∈ {single, mirror, radial(N),
serial(N)} places all members from one draw. Expansion is budgeted and
deterministic: start at the plan's core, fill sockets in **canonical
socket order** (pinned per plan in this doc's unit amendments — never
iteration order of a map), every draw stream-keyed by
`hash(seed, locus_path, draw_name)` exactly as 06 §4. Part budget at
32×32: 8–14 (design 02 §3); each placement consumes budget; exhausted
budget closes remaining sockets.

Exclusion groups are socket-level: a group name + max-one rule enforced
at draw time by removing excluded candidates from the choice set
*before* the draw (so exclusion changes never reshuffle sibling draws).

### 1.2 The M1-fidelity law (load-bearing)

The quadruped grammar is a **re-derivation of the M1 template, not a
reinterpretation**: for EVERY genome (not just defaults), the grammar's
PartGraph must drive the pipeline to **byte-identical output** with the
M1 hardcoded path — same slabs, same chains, same part ids, same raster
tags, same craft decisions, same PNG/JSON bytes. Verified by sweep
(seeds 0..1999, full export hash diff, both walk and idle cells) before
the hardcoded path is deleted. `pose.ts`'s frozen `PART_NAMES` /
`CHAINS` / `PART_ROLES` become the *output* of the quadruped grammar;
gait templates (pose functions) stay per-plan code consuming the graph.
This law is what makes "replace the hardcoded graph" a refactor with a
proof instead of a rewrite with a hope.

### 1.3 Paths and sockets for the new plans

06 §2's rules bind: socket names, never positional indices; ordinals
only within a named socket; existence-marking loci default to absent.
Vocabulary (pinned now so registry ids can append against stable
paths):

- Levitant: `body.core`, `body.sensor[C]` (single central),
  `body.locomotor[L]`/`[R]` (mirror pair), `body.tendril[T:0..]`
  (serial, grows/shrinks at the tail per 06 §2).
- Amorphous: `body.blob` (core field), `body.ball[B:0..]` (serial
  metaball control points), `body.eye[L]`/`[R]` (mirror slab face
  parts, S1b-proven composition).

### 1.4 U1 amendment — engine pins and the quadruped grammar

*Amended with U1 (2026-07-11), per this doc's header rule. Evidence:
the §1.2 fidelity sweep (all-defaults + seeds 0..1999,
sha256(sheet PNG ‖ canonical JSON) equal to the M1 hardcoded path for
all 2001 genomes — including identical trap behavior on seed 1132, the
pre-existing craft fixpoint trap, unchanged by U1; comparison run and
confirmed by the orchestrator 2026-07-11 against a baseline
authenticated on a pristine `d084325` worktree; evidence fingerprint =
sha256 over the newline-joined hash values sorted by key, as UTF-8
bytes — a cp1252 read of the seed-1132 ERROR entry's `§` yields a
different digest:
`d90e1e0084dbaa89fc494fc7bd76c4e0af4298cc4138c75a95950f796a3067f7`),
and a 101-graph differential corpus (all-defaults + seeds 0..99)
exact-matched against an independent Python oracle on every field
class.*

**Engine discipline** (grammar.ts `growPlan`, proven by U1's
synthetic-plan tests):

- **Expansion is depth-first**: all members of one fill emit
  contiguously, then each member's own sockets fill in member order,
  then the parent's next socket. Canonical socket order = the pinned
  array order of each part's socket list, never map iteration.
- **Fill draws**: a socket fill with more than one surviving candidate
  consumes exactly one draw from `stream(seed, draw_path, "fill")`
  (draw paths pinned per socket). Single-candidate and closed sockets
  consume **no** draw — the `meta.plan` precedent (06 §4.2: a draw that
  could only return one value is not spent).
- **Pre-draw pruning order**: budget, then allowed kinds, then
  exclusion groups (max-one per group) — never draw-then-reject. A
  socket whose symmetry needs more members than the remaining budget
  closes without drawing; later, smaller sockets may still fill.
- **Symmetry recording**: nodes record `single` or
  `<mirror|radial|serial>:<group>`, the group name defaulting to the
  socket name. Mirror fills emit the −x member first (06 §1.2's
  FL-before-FR convention); serial/radial ordinals run 0..N−1 in
  placement order within their socket (06 §2).
- **Rest pose**: graph slabs carry every oscillator term at zero
  (b = wag = dy_i = dz_i = 0) — growth precedes animation. Gait
  templates (pose.ts, per-plan code) add per-frame deltas: b to cz on
  every non-limb chain, wag to the tail chain's cx, and per-limb
  cy += dy_i, cz += asr(dz_i, 1) + asr(b, 1). Deltas are exact int32
  additions onto rest raws, which is what makes the growth/gait
  decomposition byte-identical to the retired template.
- `clearance_fp` is carried on every socket but **inert until U5**
  (quadruped sockets carry 0; U5 pins real radii with the retry
  machinery).

**The quadruped plan** (its 13 nodes, kinds, and paths — two readings
diverged here before this pin):

- **Node decomposition: one node per normative slab — 13 nodes.**
  Forced by three committed facts: a node carries ONE `material_role`
  (design 02 §1) while core (hide) and core underside (underside)
  differ; raster part-tag ids index the normative 13-slab list
  (06 §1.2); and 13 lands inside the 8–14 budget (design 02 §3) where
  coarser locus-path groupings (7 nodes) fall below it.
  This supersedes §1.1's abstract node shape in two respects: `slabs[]`
  collapses to exactly one slab per grown node, and grown nodes carry
  no socket list (sockets exist on the plan's part choices during
  growth, not on the output graph).
- **Node table** (id, name, path, kind, role, chain, symmetry group —
  names are the frozen M1 `PART_NAMES`, 06 §1.2's normative slab list):

  | id | name | path | kind | role | chain | symmetry |
  |----|------|------|------|------|-------|----------|
  | 0 | core | body.core | core | hide | body | single |
  | 1 | core_underside | body.core.underside | segment | underside | body | single |
  | 2 | head | body.head | head | hide | head | single |
  | 3 | snout | body.head.snout | segment | underside | head | single |
  | 4 | ear_l | body.head.ear[L] | sensor | hide | head | mirror:ears |
  | 5 | ear_r | body.head.ear[R] | sensor | hide | head | mirror:ears |
  | 6 | eye_l | body.head.eye[L] | sensor | focal | head | mirror:eyes |
  | 7 | eye_r | body.head.eye[R] | sensor | focal | head | mirror:eyes |
  | 8 | leg_fl | body.leg[FL] | limb | hide | leg_fl | mirror:legs_fore |
  | 9 | leg_fr | body.leg[FR] | limb | hide | leg_fr | mirror:legs_fore |
  | 10 | leg_bl | body.leg[BL] | limb | hide | leg_bl | mirror:legs_hind |
  | 11 | leg_br | body.leg[BR] | limb | hide | leg_br | mirror:legs_hind |
  | 12 | tail | body.tail | segment | hide | tail | single |

- **Canonical socket order (quadruped)**:
  `body.core: [underside, head, leg_fore, leg_hind, tail]`;
  `body.head: [snout, ears, eyes]` — the unique depth-first order that
  reproduces the 06 §1.2 normative slab order.
- **Paths of un-locus'd parts** are the table's: `body.core.underside`,
  `body.head.snout`, `body.head.ear[L]`/`[R]`, `body.head.eye[L]`/`[R]`
  — the `[L]`/`[R]` member spelling per §1.3's levitant vocabulary; the
  −x member is L and emits first. Locus'd parts reconstruct their
  subtrees from their paths (`body.leg[FL].phase_group` etc. — how the
  gait template reads per-leg loci off the graph, no side table).
- **Mirror groups**: ears and eyes are unbroken one-gene pairs
  (06 §1.1); the legs record as two mirror pairs `legs_fore`/`legs_hind`
  (design 02 §2 "mirror leg pairs ×2") while keeping per-socket loci,
  so only their ±hip_x placement mirrors. `mirror_broken` is false for
  every v1 genome (no asymmetry loci exist).
- **Zero draws**: every quadruped socket is a single-candidate
  mandatory fill, so growth consumes no stream draw for any genome (the
  fidelity law fixes the 13-part set) — machine-verified over the
  101-graph corpus. Growth draws first appear with the M2 plans.
- **Module seam**: the geometry (template constants, derived anchors,
  eye visibility coupling) lives in grammar.ts as the quadruped plan's
  slab builders; `PART_NAMES` / `CHAINS` / `PART_ROLES` are now derived
  from the grown graph (the §1.2 promise, discharged); pose.ts keeps
  only clip phases and the gait template.

## 2. The plan trio

### 2.1 Wire compatibility

`meta.plan` (locus id 0) extends its enum: `{quadruped=0, levitant=1,
amorphous=2}` — an append, no v1 byte changes. Registry ids for new
loci append from 35 per 06 §1.1's append-only law; the id table is
*pinned at unit start* (U3/U4) in an amendment here, defaults sourced
exactly like M1's: **the all-defaults levitant reproduces S1's watcher;
the all-defaults amorphous reproduces S1b's slime** (same
approximate-reproduction rule as 06 §1: fixed-point re-derivation, then
M2 goldens pin production bytes).

### 2.2 Quadruped

Output unchanged (§1.2). Its only M2 additions are the three new clips
(§4), shared by all plans.

### 2.3 Levitant

From S1: slow body sine (hover bob), locomotor flap at integer ratio
f=3, trailing tendrils copying the body signal with per-segment lag k·λ
(the "soft-body for free" read). `anim.levitant.*` subtree: hover_freq,
hover_amp, flap_ratio, tendril_lag, tendril_amp (domains/defaults
*pinned at unit start* from `spikes/spike01_slab_projection.py::
watcher()`). No ground contact: the ground-shadow ellipse derivation
(06 §6.3) still anchors to the ground line; the levitant's shadow
x-extent derives from the **core** chain only, and altitude modulates
nothing in M2 (shadow constancy is the cheap, stable read at 32 px) —
*pinned at unit start* against the watcher render.
Death = altitude loss: envelope drives the core's z toward the ground
line with tendrils going limp (lag preserved, amplitude → 0).

### 2.4 Amorphous

From S1b: metaball cluster with oscillating control points
(squash/stretch), slab face parts depth-sorting correctly against the
blob surface. Normative now (F8): the field threshold is **TH = 0.3 of
per-ball peak weight**, and grammar-authored ball radii are expressed
relative to the **visible** radius (0.67× ball radius at TH = 0.3) —
authoring rules bake this in so loci read in visible pixels, like every
other plan. F9's lesson (amplitudes are geometry too) applies at 32:
oscillator amplitudes author in visible-radius units. `anim.amorphous.*`
subtree: pulse_freq, squash_amp, ball_phase_delta (*pinned at unit
start* from `spikes/spike01b_more_plans.py::slime()`).
Death = deflate: envelope scales ball weights down, blob sinks to the
ground line, face parts fade behind the collapsing surface.

### 2.5 The anim semantic map (06 §1.1's pinned mechanism)

Ships with U3 as a data table beside the registry: per plan pair, leaf
correspondences for `anim.*` only (e.g. `quadruped.gait_freq ↔
levitant.hover_freq ↔ amorphous.pulse_freq`; amplitude↔amplitude rows
likewise). M2 tests referential integrity (every entry names real
registry paths) and nothing else; crossover consumes it at M5.

## 3. The renderer fork (metaball field path)

The single fork the system allows (design 02). Interface law: the fork
lives entirely inside rasterization — same projection, same supersample
grid, same majority vote, same per-pixel `(part, depth, material,
tone)` tags — so craft, palette, flicker, and export cannot tell which
renderer ran. Ray/surface intersection: marched field threshold along
the ray (S1b, ~100 LOC) instead of the ellipsoid quadratic; the march
step and iteration cap are *pinned at unit start* as fixed-point
constants with a machine-verified worst-case error bound (they are
determinism-bearing).

Chain semantics for snapping (06 §1.5 requires every slab in a chain):
each metaball control point is a chain member of the **blob chain**
(one chain — the blob shifts as a unit, per F16's assembly lesson);
face parts keep their own chains. *Pinned at unit start* against S1b
renders.

**Craft coverage debt (S3 scope note) is discharged in U4:** the full
craft property suite (orphans, jaggies, budget, selout exemptions,
idempotence) runs on a pinned amorphous corpus, and the F7/F15 thin-body
exemption logic is re-verified on blob geometry (a squashed blob is the
new thinness stress case).

## 4. The M2 clip set

### 4.1 Frame set, sheet, and schema (extends 06 §6.1–6.3)

Clip roster in frame-set order: **[walk, idle, attack, hurt, death]**.
The first two keep their M1 definitions and — because clip is the outer
index — **frames 0..31 keep their exact M1 meaning**. Per-clip K is
pinned: walk 4, idle 4 (M1), **attack 4** (anticipation, strike,
recovery, recovery — design 03 §2's 1+1+2 envelope at K=4), **hurt 2**
(offset-against-facing, return), **death 4** (envelope to the plan's
collapse pose, holding the final frame). All K ≤ 4, so the sheet stays
4 columns: **56 frames, 20 rows, sheet = 128×640 RGBA**; row cells
beyond a clip's K are exactly (0,0,0,0) and the frames/rects metadata
is authoritative (M1 already reads rects, not arithmetic, from JSON).
Envelopes are piecewise fixed-point curves layered on the idle preset
(design 03 §2); the `anticipation` locus (dropped from v1 per 06 §1.1)
appends to the registry here. Hurt additionally emits `flash: true` on
its clip entries — an additive metadata key.

Directions unchanged (4, same order); one-shot clips render per
direction like loops. The only directional logic anywhere stays design
03's: emitters orient along facing during attack.

### 4.2 Flicker policy for one-shot clips

Looping clips (walk, idle) keep the wrap pair (last, first). One-shot
clips (attack, hurt, death) measure **consecutive pairs only — no
wrap** (a death's final pose legitimately differs from its first
frame; wrapping would gate on a transition that never plays). Metric,
zero-motion convention, and INF-fail are unchanged. The walk gate stays
32.0; per-clip gates for the new clips are set by the M1 recalibration
method (production histogram over ≥800 cells, gate above observed max
with margin, evidence recorded in the unit amendment) — *pinned at unit
end*, mechanism pinned now.

### 4.3 Versioning and the M1 anchors

`GENERATOR_VERSION` → **2**, landing with U2 (the first
output-changing unit). Genome version stays **1**: every M2 registry
change is an append with an absent-meaning default (06 §3 law), so
every issued v1 DNA string decodes unchanged.

Normative regression anchors, tested from U2 onward against committed
M1 fixtures:

1. For any v1 genome: the v2 sheet's pixel region y ∈ [0, 256) is
   **byte-equal** to the v1 sheet (walk+idle cells untouched).
2. The v2 JSON's `frames[0..31]`, `clips.walk`, `clips.idle`,
   `palette`, and `hitboxes[0..31]` are **value-equal** to v1's (the
   only permitted diffs: `generator_version`, the appended frames /
   clips / hitboxes, and `sheet.h`).

M2 goldens re-pin the full v2 output; the M1 goldens stay in the tree
as the anchor fixtures.

## 5. Degeneracy defenses (design 02 §4, made normative)

- **Clearance retries:** a placement overlapping a sibling beyond its
  socket's `clearance_fp` re-draws from its own locus stream with draw
  names `place:0..R-1` (retry cap R pinned at unit; then the part is
  dropped). Retries are stream-keyed, so a retry in one socket never
  perturbs another socket's draws.
- **Readability self-check:** after growth, render the default-frame
  down-view silhouette; reject when silhouette fill ratio or
  bounding-box aspect falls outside the plan's band. Violators re-draw
  ornament/limb loci (bounded, stream-keyed), then **accept-and-tag**:
  a `degenerate` flag in the manifest, never a silent loop (design 05
  §1's escalation philosophy). Bands are percentile envelopes measured
  on a 2000-genome per-plan corpus, machine-verified, *pinned at unit
  start of U5* in an amendment table here.
- **Property law (CI):** on the pinned corpus, zero exported creatures
  carry the degenerate flag, and the U5 sweep asserts it.

## 6. Trait tags and form-follows-function priors

Tags (`meta.trait_tags`, carried since v1, gating nothing until now)
gate two things in M2, both at generation time:

1. **Part-choice weights** in socket fills (chitin → segmented
   ornaments up-weighted, spectral → tendrils/emitters up-weighted,
   …); zero-weight prunes before the draw, like exclusion groups.
2. **Gait temperament priors** in `sampleGenome` (spectral biases
   hover_freq low; chitin biases gait_freq/flap high, amplitudes
   jerky-short).

Tag→weight tables are *pinned at unit start of U5* (they are taste
constants; the pinned 100-sheet is their test). Material roles do not
change in M2.

FFF v1 = three named prior presets (`speed`, `armor`, `ranged`)
applied as locus-prior biases in sampling; `ranged` guarantees one
`emitter` part (F5's focal machinery already handles its contrast).
Mapping tables live beside the tag tables; same pin point.

## 7. Acceptance instrumentation

- **Pinned sheet:** seeds 0..99 through the M2 sampler, rendered by
  `fablesprite sheet` into `qa/`; CI re-renders and hash-compares on
  every grammar/craft change (a hash move without a reviewed
  regeneration commit fails).
- **Taste reviews are scheduled, not ad-hoc (R2):** after each of
  U3/U4/U5 the orchestrator delivers a mini-sheet review; the full
  100-sheet review gates acceptance. Delivery format per the M1
  acceptance: per-seed 4× PNGs in a Desktop folder + one labeled 3×
  composite; verdict = "accepted" or flagged seed list.
- **Acceptance (ROADMAP Phase 2):** ≥80% of the 100 judged "would ship
  in a game jam" by the owner; plan mix visibly distinct at thumbnail
  distance; the review loop demonstrably ran (the qa/ history is the
  record).

## 8. Build order

Strictly serial (M1 discipline: one unit, one ultracode workflow, one
commit, CI green, then the next). Each unit amends this doc's *pinned
at unit* sections in the same change.

| Unit | Delivers | Gate |
|------|----------|------|
| U1 | Grammar core: PartGraph, budgeted expansion, symmetry groups, exclusion machinery, canonical socket order; quadruped grammar; hardcoded template deleted. LICENSE lands here once the owner picks the text | §1.2 fidelity sweep: seeds 0..1999 byte-identical vs the M1 path (kept in-tree until the sweep passes, then deleted in the same commit); suite green |
| U2 | Clip set §4: envelopes, anticipation locus, 56-frame set, 128×640 sheet, flash flag, one-shot flicker policy + recalibrated gates, GENERATOR_VERSION 2, M1 anchors, goldens re-pinned | §4.3 anchors; flicker histogram recorded; goldens byte-identical twice; CI green both platforms |
| U3 | Levitant: registry subtree + defaults from watcher, gait template, shadow policy, death envelope, semantic map table | goldens; property sweeps; anchor tests still green; mini-sheet (seeds 0..24, levitant-forced) owner-reviewed; map integrity test |
| U4 | Amorphous: metaball raster path (march constants + error bound), blob chain snapping, grammar rules (F8/F9 authoring), death envelope; craft + flicker coverage on amorphous corpus | craft property suite incl. idempotence on the pinned amorphous corpus; mini-sheet review; goldens; anchors |
| U5 | Defenses §5 (clearance retries, self-check + bands) + tags/FFF §6 | 2000-genome/plan zero-degenerate sweep; band + weight tables machine-verified and amended here |
| U6 | Acceptance instrument §7: pinned 100-sheet, CI hash guard, review delivery | owner review: ≥80% would-ship + plan-mix distinctness → declare M2 |

Risk watch while building: R2 (oatmeal — the whole point of U5/U6),
R8 parks with breeding at M5, R4/R5/R6 remain standing law (idempotence
tests, stream keying, two-platform goldens run on every unit).
