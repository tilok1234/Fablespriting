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
budget closes remaining sockets. *(U4 note: design 02 §3's band is
literally "~8–14" — tilde-loose. The amorphous PlanSpec pins
[7, 14]: its honest mandatory census is 7 parts (the spike's exact
part list) and inventing an 8th to satisfy the band would be exactly
the speculation the schema bans. Recorded deviation, §2.4.1.)*

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
  **U3 vocabulary amendment (§2.3.1):** the watcher has horns and a
  layered eye, so U3 adds `body.ornament[L]`/`[R]` (mirror pair, kind
  `ornament` from design 02's closed list — mandatory fill, the ears
  precedent: the parts exist at defaults, so 06 §2's existence-locus
  optional-ornament form cannot apply) and the sensor-stack child
  sockets `body.sensor[C].iris` / `body.sensor[C].pupil` (canonical
  socket order `body.sensor[C]: [iris, pupil]` — both direct children
  of the sclera node, which IS `body.sensor[C]`).
- Amorphous: `body.blob` (core field), `body.ball[B:0..]` (serial
  metaball control points), `body.eye[L]`/`[R]` (mirror slab face
  parts, S1b-proven composition).
  **U4 vocabulary amendment (§2.4.1):** `body.blob` IS a grown node —
  the plan's core (growth must start at a core node; it carries the
  main body ball's slab) and the field owner (the field is the union
  of the blob chain's ball slabs, evaluated only by the §3 fork); the
  serial group holds the three AUXILIARY balls `body.ball[B:0..2]`
  (crest, skirt, drip — four ball nodes total, the spike's four
  balls). S1b's asymmetric gloss highlight adds `body.ornament[C]`
  (kind `ornament` from design 02's closed list, mandatory fill — the
  U3 horns precedent: the part exists at defaults, so 06 §2's
  existence-locus optional-ornament form cannot apply; `[C]`
  single-central spelling per the `body.sensor[C]` precedent; `single`
  symmetry legally places it off-axis at x = −2.4).

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

**U3 status:** `levitant = 1` LANDED (§2.3.1; registry ids 36–46).
`amorphous = 2` deliberately did NOT land with it — U4 appends it: an
enum member that decodes but cannot grow would be a landmine (a plan-2
tape would decode fine and then fail at growth; better that old builds
raise UpgradeRequired at decode, the correct 06 §3.3 behavior — which
is also exactly what pre-U3 builds do with `plan = 1`). One codec
repair landed with the append: `encodeGenome` emitted the seed (id 1)
and tag (id 2) entries before the scalar loop under a comment assuming
id 0 could never be non-default (true while the enum had one member);
a plan-1 genome broke strict-ascending id order. The id-0 entry now
emits FIRST (CI-tested; the all-defaults levitant tape is bytes
`01 00 02` = DNA `AQAC`).

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

#### 2.3.1 U3 amendment — the levitant plan (delivered)

Notation: design 06 §0 — every decimal below denotes the fp raw
`RHE(d · 65536)`; phases/lags in TURNS. Every raw in this amendment was
machine-verified against its authored decimal before pinning (scratch
scripts `verify_raws.py` / the adjudication `verify.py`/`verify2.py`,
zero mismatches); derivations, not decimals, are the pins where the two
disagree by 1 ulp (the M1 underside-line precedent).

**Registry append (ids 36–46, 11 loci).** Bounds inclusive, in raws;
every locus has exactly one pipeline consumer (no speculative loci).

| id | path | kind | [lo, hi] | default | consumer |
|----|------|------|----------|---------|----------|
| 36 | `anim.levitant.hover_freq` | int | [1, 2] | 1 | gait base phase θ = h·φ (watcher sin(φ)); h = 2 freezes hover AND flap at K = 4 (sin of half-turn multiples ≡ 0) — recorded degeneracy, the gait_freq-2 precedent |
| 37 | `anim.levitant.hover_amp` | fp px | [0, 131072] | 85197 (1.3) | hover bob (watcher 1.3·sin(φ)); bob_amp domain precedent |
| 38 | `anim.levitant.flap_ratio` | int | [1, 3] | 3 | wing flap phase r·h·φ (watcher sin(3φ), S1's integer CPG ratio); r = 2 frozen at K = 4 (recorded) |
| 39 | `anim.levitant.tendril_lag` | fp turns | [0, 8192] | 7301 (0.7 rad = 0.11140846 turns) | tendril signal sin(θ − (i+1)·λ); TURNS per the tail_lag precedent (cross-check 0.9 rad → 9387 = id 11). Narrow hi: 3·λ at wide lags puts adjacent tendrils toward anti-phase (visible chain breaks); domains cannot shrink post-ship |
| 40 | `anim.levitant.tendril_amp` | fp px | [0, 131072] | 98304 (1.5) | tendril x-swing base (per-ordinal factors are template constants); hi 2: amp 4 × XF 1.3 would shatter the ≤ 0.9 px tendril chain |
| 41 | `anim.levitant.anticipation` | fp | [32768, 131072] | 65536 (1.0) | attack f0 scale — the exact id-35 analog (§4.4.3 rule: f0 only) |
| 42 | `body.core.altitude` | fp px | [753664, 851968] (11.5–13) | 786432 (12.0) | rest orb center z0 (watcher 12.0). Domain narrowed from the sketch corners: alt-lo 11 + hover 2 + deep orb + long tendrils runs the tendril tip off the canvas bottom; [11.5, 13] clears — production-fp corner-sweep worst case ≈ 0.63 px bottom / 1.03 px top margin against the true canvas edges |
| 43 | `body.sensor[C].scale` | fp | [39322, 98304] (0.6–1.5) | 65536 | eye-stack scale — ONE gene: stack extents AND offsets scale together (S4-F18); the eye_size domain precedent verbatim. Pupil half-extents FLOOR at their default raws (below) |
| 44 | `body.core.locomotor_size` | fp | [32768, 117965] (0.5–1.8) | 65536 | wing half-extents × size, one gene for the mirror pair; the ear_size precedent (domain AND parent-path-joined-leaf spelling) |
| 45 | `body.core.tendril_girth` | fp px | [45875, 91750] (0.7–1.4) | 58982 (0.9) | tendril x/y halves with additive taper `girth_i = girth − i·9830`; at default reproduces the watcher raws [58982, 49152, 39322] exactly |
| 46 | `body.core.tendril_len` | fp px | [52429, 98304] (0.8–1.5) | 85197 (1.3) | tendril z half; drop spacing derives from it (below). Hi capped at 1.5 by the canvas-bottom corner |

**The big call (no orb-dimension loci):** the orb consumes the EXISTING
`body.core.length/girth/depth` (ids 13/14/15) through delta-form anchor
couplings — 06 §1.1 plan-scopes ONLY `anim` and makes body paths the
raw-path-identity homology carrier (design 01 §3: wolf × levitant
crossover aligns body genes BY PATH; the §2.5 semantic map is anim-only
by architecture). A levitant-only `body.core.radius` would make
body.core crossover vacuous and leave two rival dimension vocabularies
on one path node forever. Exact at defaults because `fp_mul(σ, 0) = 0`.

Template constants (NOT loci — the U2 scope line: only anticipation is
a locus): FLAP_AMP 104858 (1.6), TENDRIL_ZBOB 32768 (0.5),
XF[0..2] = 32768/58982/85197 (0.5/0.9/1.3), TAPER_STEP 9830 (0.15),
every geometry offset and coupling slope below, every envelope delta.
The watcher's flap amplitude stays a constant; a variety locus is
U5/U6 taste territory and a later append is free. Tendril count is
FIXED at 3 (the legs precedent): a count locus defaulting to 3 would
collide with 06 §2's existence-defaults-absent law (tape-absence must
mean part-nonexistence) — recorded tension; count variation waits for
the unit that resolves it. Horn geometry = template constants
(ornament loci are U5 tag-gating territory).

**D-a sampling policy — plan is a caller parameter.**
`sampleGenome(seed, plan = 0)`: plan consumes NO draw (06 §4.2 governs
draw *spending*; plan is not drawn at all in U3 — plan-MIX sampling
defers to U6, which if it samples must use the reserved
`stream(seed, "meta.plan", "sample")`). Scope column (registry
METADATA, not wire data): shared = {0–6, 13–15},
quadruped = {7–12, 16–35}, levitant = {36–46}; the sampler draws
shared + the requested plan's loci, each from its own path-keyed
stream as before. Consequences (CI-asserted): a sampled quadruped
draws exactly ids 3..35 — the identical set U2 drew — so its DNA is
byte-identical to U2's (verified against strings generated from the
committed U2 build for seeds 0/1/7/40/1132; keeps the seed-1132 v2
golden intact without a re-pin); a sampled levitant draws
palette + core dims + ids 36–46, and its girth/length/depth genes are
meaningful (homology). Unconsumed loci on any genome stay wire-legal
and inert. CLI: `fablesprite sheet --plan quadruped|levitant`
(default quadruped; unknown → usage error) — the mini-sheet
instrument.

**Node table (11 nodes, one slab per node, budget 8–14).** Names are
the levitant PART_NAMES; raster part tags index this order (the
depth-first expansion of the canonical socket orders
`body.core: [sensor, locomotors, ornaments, tendrils]`,
`body.sensor[C]: [iris, pupil]` reproduces it). Every socket is a
single-candidate mandatory fill ⇒ **zero draws for every levitant
genome** (CI-asserted); `mirror_broken` false always.

| id | name | path | kind | role | chain | symmetry |
|----|------|------|------|------|-------|----------|
| 0 | orb | body.core | core | hide | body | single |
| 1 | sclera | body.sensor[C] | sensor | underside | body | single |
| 2 | iris | body.sensor[C].iris | sensor | hide | body | single |
| 3 | pupil | body.sensor[C].pupil | sensor | focal | body | single |
| 4 | wing_l | body.locomotor[L] | locomotor | underside | wing_l | mirror:locomotors |
| 5 | wing_r | body.locomotor[R] | locomotor | underside | wing_r | mirror:locomotors |
| 6 | horn_l | body.ornament[L] | ornament | underside | body | mirror:ornaments |
| 7 | horn_r | body.ornament[R] | ornament | underside | body | mirror:ornaments |
| 8 | tendril_0 | body.tendril[T:0] | segment | hide | tendril_0 | serial:tendrils |
| 9 | tendril_1 | body.tendril[T:1] | segment | hide | tendril_1 | serial:tendrils |
| 10 | tendril_2 | body.tendril[T:2] | segment | hide | tendril_2 | serial:tendrils |

Roles (the F5 read): concentric contrast rings — bright underside
sclera, mid hide iris, dark focal pupil (the spike's `eye` ramp IS the
pinned focal table, F16 merge-protected); wings/horns underside to
separate from the hide orb at thumbnail distance. Recorded fallback if
the mini-sheet flags it: iris↔sclera swap (one golden re-pin, before
U3 closes, never after). Spike-order deviation (recorded): watcher()
interleaves wing/horn per side; the engine's contiguous-mirror law
(§1.4) emits wing_l, wing_r, horn_l, horn_r — the M1 de-interleave
precedent. Chain names follow the quadruped convention (the chain
holding `body.core` is named `body`); symmetry groups default to the
socket names (locomotors/ornaments/tendrils).

**Chain table** (F16: orb + eye stack + horns ride z0 rigidly — one
hover signal, the face never scrambles; wings flap independently; each
tendril is its own lagged chain; F14 ties-to-even parks their ±0.5 px
oscillations):

| chain | slab indices | anchor |
|-------|--------------|--------|
| body | 0, 1, 2, 3, 6, 7 (non-contiguous is legal) | orb |
| wing_l / wing_r | 4 / 5 | wing_l / wing_r |
| tendril_0/1/2 | 8 / 9 / 10 | themselves |

**Rest geometry (slab builders).** G/L/D = ids 14/13/15, ALT = 42,
s = 43, w = 44, tg = 45, tl = 46. Derived anchors (exact at defaults):

```
ORB_HX = fp_add(353894, fp_mul(90742, fp_sub(G, 255590)))   # 5.4, σ 5.4/3.9
ORB_HY = fp_add(340787, fp_mul(44840, fp_sub(L, 498074)))   # 5.2, σ 5.2/7.6 (= |hip_y hind σ|, 06 cross-check)
ORB_HZ = fp_add(353894, fp_mul(32768, fp_sub(D, 222822)))   # 5.4, σ 0.5 — DAMPED
z0     = ALT
SCL_Y  = fp_sub(ORB_HY, fp_mul(s, 85197))                   # 3.9 at defaults
DROP_0 = fp_add(fp_sub(ORB_HZ, 32768), tl)                  # 6.2 at defaults (406323, exact)
SPACING_STEP = fp_add(111411, fp_sub(tl, 85197))            # 1.7 at defaults
DROP_i = DROP_0 + i·SPACING_STEP; girth_i = tg − i·9830     # plain int multiples
```

The ORB_HZ σ is 0.5, NOT the full watcher ratio 5.4/3.4 = 104087: the
full slope blows the canvas (at depth 6 the orb hz reaches 9.53 and
the horn/attack-rise corner tops out < 0.5 px under the frame edge
while the tendril-2 tip falls ~4 px off the bottom). σ 0.5 bounds hz
to [4.7, 6.7] and clears both edges by construction — measured on the
production fp path (the §2.3.1 corner sweep against the true canvas
edges): worst-case top margin 1.03 px (67646 raw; corner 13, walk
φ = 0.25, left), bottom 0.63 px (41259 raw; corner 196, walk φ = 0.75,
right). Depth still reads; homology stays honest.

| node | center (x, y, z) | half-extents |
|------|------------------|--------------|
| orb | (0, 0, z0) | (ORB_HX, ORB_HY, ORB_HZ) |
| sclera | (0, SCL_Y, z0) | s × (196608, 131072, 196608) |
| iris | (0, SCL_Y + s·78643, z0) | s × (104858, 72090, 104858) |
| pupil | (0, phase-repaired SCL_Y + s·131072 (below), z0) | max(s × P, P), P = (49152, 39322, 49152) — FLOORED (the M1 eye-floor mechanism; identity at s = 1) |
| wing_l/r | (∓(ORB_HX + 39322), −78643, z0 + 144179) | w × (137626, 58982, 85197) |
| horn_l/r | (∓(222822 + fp_mul(57134, G − 255590)), 65536, z0 + ORB_HZ − 26214) | (52429, 52429, 98304) constants |
| tendril_i | (0, 0, z0 − DROP_i) | (girth_i, girth_i, tl) |

Attachment-by-construction (the S4-F18 anchor lesson, all verified on
the production fp path at all 256 geometry corners, CI): the eye stack
embeds a scale-proportional 1.3 into the orb front (protrudes at every
orb size); wings track the orb flank at constant 0.6 gap (overlap
2.1w − 0.6 ≥ 0.45 px at w-lo); horn z tracks the orb top at constant
1.1 px protrusion (rel = ORB_HZ − 0.4); horn x tracks girth at ratio
σ 57134 = 3.4/3.9 (machine-verified — a hand-derived 57139 was wrong,
the machine-verify law at work; a constant 3.4 would out-run the flank
at girth 2); tendril_0 hangs at constant 0.5 px overlap with the orb
bottom; adjacent tendrils keep z-overlap tl − 0.4 ≥ 0.4 px across the
domain. Watcher reproduction at all defaults: every derived value
equals the watcher decimal exactly in raw EXCEPT two pinned 1-ulp
derivation notes: iris rest y = 255590 + 78643 = **334233**
(RHE(5.1) = 334234); tendril-2 drop = 406323 + 2·111411 = **629145**
(RHE(9.6) = 629146). Defaults: orb (5.4, 5.2, 5.4) at z 12; sclera
(0, 3.9, 12)(3.0, 2.0, 3.0); iris (0, 5.1−ulp, 12)(1.6, 1.1, 1.6);
pupil (0, 5.9, 12)(0.75, 0.6, 0.75); wings (±6.0, −1.2, 14.2)
(2.1, 0.9, 1.3); horns (±3.4, 1.0, 17.0)(0.8, 0.8, 1.5); tendrils
(0, 0, 5.8/4.1/2.4+ulp)(0.9/0.75/0.6 taper, tl 1.3).

**The D-i pupil pixel-phase coupling (evidence-triggered repair).**
The levitant pupil is structurally centered (cx = 0), so its down-view
footprint always splits its sample columns across a pixel boundary;
whether the 1.5 px focal disc wins any majority vote hinges on its
screen-y sub-pixel phase `fp_mul(TILT, cy) mod 65536` (the chain snap
plants the orb anchor on a whole-pixel raw). Evidence (seeds 0..1999
levitant-forced, down view, 4 walk phases = 8000 frames): WITHOUT a
repair, **408 frames across 102 seeds render ZERO focal pixels**
(9 of the first 200 seeds); WITH it, **0 of 8000**. Repair (pinned):
advance pupil rest cy FORWARD only (+y — more protrusion, never
occlusion, the M1 EY spirit) by `2·((62259 − phase) mod 65536)` so the
phase lands exactly on 62259 — the all-defaults watcher's own phase
(`fp_mul(32768, 386662) mod 65536`, derived not authored). At defaults
the delta is 0: byte-inert, the all-defaults golden untouched. This is
the narrowest coupling that restores the watcher's proven vote
geometry for every genome.

**Gait template.** Oscillators (sin = the 06 §5.3 LUT; φ = fp turns
raw; h·φ, r·h·φ, (i+1)·λ plain integer products, int32-safe):

```
walk:  b     = fp_mul(hover_amp, sin(h·φ))
       flap  = fp_mul(FLAP_AMP, sin(r·h·φ))
       sig_i = sin(h·φ − (i+1)·λ)
       tx_i  = fp_mul(fp_mul(tendril_amp, XF[i]), sig_i)
       dzt_i = −fp_mul(TENDRIL_ZBOB, sig_i)
idle:  b     = fp_mul(asr(hover_amp, 1), sin(φ))    # freq ignored (quadruped idle rule)
       flap  = 0                                     # idle rule below
       sig_i = sin(φ − (i+1)·λ)
       tx_i  = fp_mul(fp_mul(asr(tendril_amp, 1), XF[i]), sig_i)
       dzt_i = −fp_mul(asr(TENDRIL_ZBOB, 1), sig_i)
```

Delta application (exact int32 adds onto rest raws): body chain
`cz += b`; wing chains `cz += b + flap`; tendril chains `cx += tx_i`,
`cz += b + dzt_i`. At all defaults this reproduces watcher() exactly
(fp re-derivation; RHE quantization only — the §2.1 rule); an
independent from-spec Python pose oracle
(`tests/goldens/levitant_pose_oracle.v2.json`) pins the vectors for
the all-defaults genome and one genome with every levitant locus
EXCEPT `hover_freq` non-default (13 overridden loci; `hover_freq`
stays 1 deliberately — its only non-default member, h = 2, is the
recorded hover+flap freeze degeneracy, which would zero the very
oscillators the oracle exists to pin, and h = 2 is pinned by its own
CI tests), every clip × frame, exact raws. K = 4 aliveness: h = 1 hover {0, +1, 0, −1};
h = 2 freezes hover and flap (tendrils stay alive via lag) — accepted,
the gait_freq-2 precedent; r = 3 flap {0, −1, 0, +1}; r = 2 frozen
(recorded).

**The idle rule (pinned):** kinds `limb` AND `locomotor` freeze in
idle (flap = 0); every other oscillator runs at half amplitude
(`asr(amp, 1)`) with the frequency locus ignored. Grounds: the M1 idle
zeroed the locomotion oscillators while halving bob and tail; design
03 §2's idle row names what moves (breath = hover, flick = tendrils,
locomotion absent). The wings still RIDE the half-amp hover bob, so
the idle levitant is not static — recorded mini-sheet WATCH ITEM: if
the owner flags dead-looking idle, revisit by amendment. This rule
also answers D-g's wing question: one-shot clips ride the idle base
(§4.4.2), so attack/hurt/death wings never flap.

**Envelopes** (semantics = §4.4.2 verbatim: frame k = idle preset at
φ_k + pinned per-CHAIN [dy, dz] raw translations; attack f0 scales by
`fp_mul(anticipation, delta)` — id 41, f0 only; one-shot poses defined
ONLY at the K uniform phases, else trap; nothing direction-aware).
Chain classes: body (the core chain), wing (both wings), tendril
(every tendril chain).

attack (K = 4, the 1+1+2): the levitant's axis is vertical — wind-up
rears BACK + UP where the quadruped crouches; the strike is a forward
swoop. Tendrils carry the quadruped tail's pinned trailing-inertia
sign (f0 dy = +0.5 while the body pulls −y); f2 = f1/3 easing:

| k | body [dy, dz] | wing [dy, dz] | tendril [dy, dz] |
|---|---|---|---|
| 0 wind-up (× ant) | [−98304, +45875] (−1.5, +0.7) | [−98304, +65536] (−1.5, +1.0) | [+32768, 0] (+0.5, 0) |
| 1 strike | [+147456, −49152] (+2.25, −0.75) | [+147456, −58982] (+2.25, −0.9) | [+98304, 0] (+1.5, 0) |
| 2 recovery | [+49152, −16384] (+0.75, −0.25) | [+49152, −19661] (+0.75, −0.3) | [+32768, 0] (+0.5, 0) |
| 3 recovered | [0, 0] | [0, 0] | [0, 0] |

hurt (K = 2): f0 = [−147456, 0] (−2.25 px) on EVERY chain — the
U2-tuned value that clears one pixel through TILT in all four views;
f1 = zeros; `flash: true` stays metadata-only.

death (K = 4; altitude loss per §2.3; no limbs ⇒ no fold path):
stagger `cy += −49152` every chain every frame; sink
`dz = −fp_mul(DEATH_SINK[k], max(0, restCz − restHz))` from the chain
ANCHOR's rest slab, applied to every slab of the chain — quadruped
formula + constants verbatim (DEATH_SINK = [9830, 29491, 55706]).
Derived capacities at defaults (machine-verified): body 6.6 px (the
orb bottoms **64878 raw = 0.98996 px** above ground at f2 — exact),
wings 12.9 px (give out fastest), tendrils 4.5/2.8/1.1 px (pool under
the settling orb, never below their own rest-bottom capacity).
**Tendrils go limp** (§2.3 pins TENDRILS only): the idle tendril
deltas tx_i and dzt_i each scale by TENDRIL_LIMP[k] = [32768, 16384, 0]
(one extra fp_mul each); the phase argument sin(φ_k − (i+1)·λ) is
untouched (lag preserved); the hover ride is untouched (the quadruped
death rode the FULL idle base). Wings: no flap in death by the idle
rule. **f3 = f2 WHOLESALE** (base phase + envelope + limp factor):
poseLevitant evaluates k = 3 as k = 2, so every held pair scores
exactly 0.0 (800/800 cells verified in the §4.4.6 sweep — 800 held
pairs, all zero).

**Shadow policy (the §2.3 pin, discharged).** Shadow x-extent from the
FIRST chain of the grown graph (the chain holding slab 0 = the plan's
core chain), ground-line anchored, ¼ flattening — 06 §6.3 arithmetic
unchanged; altitude modulates NOTHING. `deriveHitbox` takes the chain's
slab indices (`shadowSlabs`) instead of the M1 hardcoded `i < 2`:
the quadruped resolves to slabs {0, 1} — byte-identical by construction
(anchor tests prove it, run not assumed); the levitant to
{0, 1, 2, 3, 6, 7} (in profile views the yawed eye stack legitimately
widens it — derived, no special case). `snapOffsets` likewise gains an
optional `chains` parameter (default: the quadruped CHAINS — every
M1-era call site byte-identical); `exportCreature`/flicker pass the
grown graph's chains, dispatched on `meta.plan` (WeakMap growth cache,
the §4.4.8 pattern, one per plan).

**Wire evidence (design 06 §3.5 amendment, machine-verified,
CI-pinned).** All-defaults levitant tape = `01 00 02` = **`AQAC`**
(4 chars). Size model reproduces U2's quadruped pin exactly (138 B =
184 chars — model validated); largest sampler-reachable levitant:
**85 B = 114 chars** (design 01 req-4 holds for every genome any
pinned sampler can emit). Fully-adversarial hand-edited cross-plan
tape (every locus at its costliest extreme): **179 B = 239 chars** —
recorded honestly: exceeds req 4's ~200-char guidance for a tape no
sampler can emit; degradation linear; U4 grows it regardless.
Recommendation: accept.

**Evidence — sensor visibility + tendril connectivity (D-i), RUN
2026-07-15.** Corpus: seeds 0..1999 levitant-forced, down view, 4 walk
phases (8000 frames). Zero-focal-pixel frames: **0/8000** (the §D-i
coupling's counterfactual: 408/8000 across 102 seeds without it).
Tendril connectivity (every rendered tendril cluster 8-connected to
the rigid body-chain mass ∪ higher tendrils; a fully occluded cluster
— 2608 of 24000 links, mostly tendril_0 hidden behind the orb — has
nothing to break and is recorded, not failed): **21273/21392 links
connected = 99.44% ≥ the 99% target**. The 119 failures (77 seeds,
worst offenders for the mini-sheet: seeds 11, 12, 112, 134, 150 …)
are transient 1-px body→tendril_0 gaps at single bob phases —
independent per-chain snap rounding plus the 0.5 px z-bob against the
0.5 px rest overlap. No repair pinned (target holds); mini-sheet
judgment item.

**Evidence — §2.3-corner worst-case table, RUN (CI-permanent).** All
256 geometry-loci corners (ids 13–15 swept at their SHIPPED bounds,
never narrowed; ids 42–46 at the table bounds) × worst-case anim
(hover 2 px, anticipation 2, tendril amp 2 at max lag), every
clip × phase × direction, on the production fp path: every slab inside
the 32×32 frame with ≥ 0.5 px snap margin; all attachment identities
above hold; adjacent-tendril x-gap ≤ 0.5 px at all sampled phases.

**Golden provenance (the M1 ritual, RUN 2026-07-15).** All-defaults
levitant (72 frames, 128×640, genome `AQAC`, hurt flash, mirror false):

```
sheet PNG  sha256 7fef414131a41c63b7fdd6d464b6b0e487eed42c9251c540c2bdd640658de965
sheet RGBA sha256 be0217c318aedb0c4ffabfffa355c4f1ca12cb6a171837685221dcc8ada74ae2
JSON       sha256 1ed5352684f8d71b490ee147c2cabace7b209724bb91e6b108f848c8f80e23ae
```

Pinned only after: PIL pixel-compare of the sheet PNG against the raw
RGBA buffer; independent Python JSON re-canonicalization
(byte-identical); all 72 hitboxes exact-matched by a from-spec Python
snap + hitbox oracle; every sha256 recomputed in Python; two
consecutive renders byte-identical. Files committed as
`tests/goldens/levitant.sheet.png` / `levitant.json`. One sampled
levitant (seed 0) RGBA sha256 additionally pinned in CI
(`838fd7f7…`). Second-platform byte-identity DISCHARGED 2026-07-15:
CI run 29390845264 on commit `c5b2ea2` green on ubuntu-latest +
windows-latest — the ubuntu runner reproduced every golden, levitant
pins included.

**Mini-sheet review (seeds 0..24 levitant-forced, §7 delivery
format).** Owner verdict 2026-07-15: **ACCEPTED, zero flagged seeds**
("i love em"). Delivered as Desktop files (per-seed 4× PNGs, labeled
3× composite, per-seed 5-clip×4-direction GIFs at the judged 140 ms
cadence, and a 25-seed walk overview GIF — all cut from the
committed-pipeline render of `c5b2ea2`). The four watch items (idle
wings frozen / iris↔sclera fallback / tendril tip dips /
frozen-oscillator seeds) were disclosed before review; none was
flagged. The iris↔sclera role fallback is therefore NOT taken; the
M1-rule idle (locomotors frozen, hover-riding) stands.

Scope lines (recorded): no new craft rules, palette changes, 16×16,
plan-mix sampling (U6), amorphous (U4), tag gating (U5), clearance
radii (levitant sockets carry 0). GENERATOR_VERSION stays 2 — U3 adds
output for plan-1 and changes none for plan-0 (the full M1/U2 anchor
suite stays green, run not assumed).

**Suite-time accounting (the ~180 s budget, U3 close-out,
2026-07-15).** U3's first cut landed the suite at 359 tests; recorded
green runs measured 132.3 / 139.0 / 179.5 s wall depending on machine
load (per-file, from the 139 s run's report: clips 138.3 s, export
52.4 s, levitant 48.4 s) — at the budget's edge with no headroom under
load, and the export 20-seed double-render sweep's 120 s per-file cap
was judged load-fragile (review-lens observation; no failing run was
preserved). Repairs, per the M1 scaled-corpus precedent (CI gets
scaled corpora; the full sweeps above stay the recorded unit
evidence): levitant flicker CI corpus defaults + seeds 0..9
(histograms: the 200-seed §4.4.6 addendum); sensor-visibility CI seeds
0..49 (unit: 0/8000 over seeds 0..1999); levitant craft idempotence
defaults + seeds 0..4; U2's one-shot render property sweep seeds
0..199 → 0..49 (the suite's longest file bounded its wall time);
export re-render hash-stability half seeds 0..4 with the cap raised to
240 s (all 20 seeds still render + structurally verify once).
Post-trim, this tree, Windows dev machine: **recorded full runs green
at 69.0 / 73.8 / 74.4 s wall, plus a 68.8 s fix-round re-run** (359
tests; worker-aggregate test time 192.8–216.3 s across those runs;
longest file clips.test.ts 68.4 s in the 69.0 s run's report) — under
budget with ≥ 2.4× load headroom at the slowest recorded run. Every gate value, golden, and anchor is
unchanged by the trims; only corpus sizes moved. *(Evidence-hygiene
correction, U3 fix round 2026-07-15: an earlier draft quoted four run
times, a 243 s upper bound, and a CI-flake failure without saved run
output; this paragraph is restated to the runs whose reports exist.)*

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

#### 2.4.1 U4 amendment — the amorphous plan and the renderer fork (delivered)

Notation: design 06 §0 — every decimal below denotes the fp raw
`RHE(d · 65536)`; phases/lags in TURNS. Every raw in this amendment was
machine-verified against its authored derivation before pinning
(`u4-specwork/verify_u4.py`, the adjudication `u4-adjwork/adjudicate_u4.py`
— ALL CHECKS PASS — and the implementation re-check
`u4-verify/verify_impl_raws.py`, 74/74); derivations, not decimals, are
the pins where they disagree by 1 ulp (the M1 underside-line precedent).

**Registry append (ids 47–50, 4 loci).** Bounds inclusive, in raws;
every locus has exactly one pipeline consumer (no speculative loci —
squash_amp gains a second, growth-time consumer in the wide-pose eye
floor below).

| id | path | kind | [lo, hi] | default | consumer |
|----|------|------|----------|---------|----------|
| 47 | `anim.amorphous.pulse_freq` | int | [1, 2] | 1 | gait base phase θ = p·φ (slime sin(φ)); p = 2 freezes hop AND squash at K = 4 (sin of half-turn multiples ≡ 0) — recorded degeneracy, the gait_freq-2/hover_freq-2 precedent; crest/drip stay alive via lag (the tendril analog) |
| 48 | `anim.amorphous.squash_amp` | fp ratio | [0, 13107] (0–0.2) | 9830 (0.15) | walk squash = 1 − a·sin(θ) (slime 0.15). Domain NARROWED from a 0.25 sketch by the 512-config corner sweep (F9 normative — amplitudes are geometry): at 0.25 the max-squash frames bury the eyes (worst proud margin −344 raw) and detach the drip; 0.2 clears every corner. RATIO-typed, not px: squash is the multiplicative mechanism; the F9 visible-units law binds the px-denominated amplitudes (hop/drip/crest — template constants, which ARE visible units: centers translate 1:1) — recorded honestly |
| 49 | `anim.amorphous.ball_phase_delta` | fp turns | [0, 16384] (0–0.25 turns) | 13559 (1.3 rad = 0.20690143 turns) | soft-body lag λ: crest signal sin(θ − λ); drip lag = λ + DRIP_EXTRA (plain int add). TURNS per the tail_lag/tendril_lag precedent (cross-checks: RHE(0.7 rad) = 7301 = id 39's default, RHE(0.9 rad) = 9387 = id 11 — reproduced). **DRIP_EXTRA = 6259, ADJUDICATED: the spike authors the drip lag as ABSOLUTE 1.9 rad, so the pin is the difference RHE(1.9 rad turns) − RHE(1.3 rad turns) = 19818 − 13559 = 6259 — the all-defaults drip lag is exactly the spike's own raw 19818 (the rejected alternative RHE(0.6 rad) = 6258 lands −1 ulp off the spike, which never authors 0.6).** Hi 0.25 turns: past a quarter turn the crest reads anti-phase to the hop; domains cannot shrink post-ship |
| 50 | `anim.amorphous.anticipation` | fp | [32768, 131072] (0.5–2) | 65536 (1.0) | attack f0 scale — the exact id-35/41 analog (§4.4.3 rule: f0 only) |

**D-a scoping (design 06 §4.2 amendment).** `meta.plan` grows member
`amorphous = 2` (enum hi 1 → 2); `LOCUS_SCOPES` gains
`amorphous = {47–50}`; shared and quadruped/levitant scope sets DO NOT
MOVE, so sampled quadruped AND levitant DNA is byte-identical to the
U3-close build's (CI-asserted against committed-build strings, seeds
0/1/7/40/1132 quadruped + 0/1/7 levitant). Plan stays a caller
parameter consuming no draw (plan-MIX defers to U6). CLI:
`--plan amorphous`. All-defaults amorphous tape = bytes `01 00 04` =
**`AQAE`**.

**The big call (D-d homology, the U3 ruling re-verified).** The main
ball's dims consume the EXISTING `body.core.girth/length/depth`
(ids 13/14/15) through delta-form couplings (anchor table below):
x ↔ girth, y ↔ length, z ↔ depth, exact at defaults because
`fp_mul(σ, 0) = 0`. The skirt, drip position, eye and highlight anchors
couple to the same three ids. No amorphous dimension locus exists —
body-path crossover homology stays honest. **Recorded divergence (the
eye-scale homology gap):** ids 19 (`body.head.eye_size`) and 43
(`body.sensor[C].scale`) have no amorphous member; a
`body.blob.eye_size` variety locus was contested at adjudication and
NOT appended — U4's registry scope is the §2.4-named anim leaves +
anticipation, and append-only makes eye variety a free later append
(the U3 FLAP_AMP ruling). Eye visibility is carried by the forward
floors below instead.

**Template constants (the five-leaf ruling applied — named, one
consumer each, NOT loci):** HOP_AMP 78643 (1.2), IDLE_BREATH 6554
(0.10), DRIP_ZAMP 72090 (1.1), DRIP_YAMP 78643 (1.2), HOP_DRIP 19661
(0.3), CREST_XAMP 104858 (1.6), CREST_ZREL 235930 (3.6), EYE_ZREL
52429 (0.8), DRIP_EXTRA 6259 (the adjudicated difference pin), ball
weights W = [65536, 52429, 45875, 36045] (1.0/0.8/0.7/0.55), every
visible-radius constant, anchor slope, envelope delta, and fork
constant below.

**Node table (7 nodes, one slab per node; names are the amorphous
PART_NAMES; raster part tags index this order — THE part-tag law).**
`body.blob` IS a grown node — the plan's core and the field owner (the
field is the union of the ball slabs, evaluated only by the fork);
the three auxiliary balls are `body.ball[B:0..2]` (crest, skirt, drip
— serial(3), ordinals in placement order; ball count FIXED at 4, the
U3 tendril-count ruling verbatim: a count locus defaulting to 3
collides with 06 §2's existence-defaults-absent law — recorded
tension, deferred). The highlight is `body.ornament[C]` (§1.3 U4
vocabulary amendment — the U3 horns precedent: kind `ornament`,
mandatory fill, `[C]` per the `body.sensor[C]` spelling; a single
part legally placed off-axis at x = −2.4, the spike's asymmetric
gloss). Canonical socket order `body.blob: [balls, eyes, highlight]`;
every socket a single-candidate mandatory fill ⇒ **zero draws for
every amorphous genome** (CI-asserted); `mirror_broken` false always.
Budget pinned [7, 14] — the honest mandatory census is 7 (the spike's
exact part list; design 02 §3's band is "~8–14", tilde-loose, and an
invented 8th part would be banned speculation; §1.1 note added).

| id | name | path | kind | role | chain | symmetry |
|----|------|------|------|------|-------|----------|
| 0 | blob | body.blob | core | hide | blob | single |
| 1 | crest | body.ball[B:0] | segment | hide | blob | serial:balls |
| 2 | skirt | body.ball[B:1] | segment | hide | blob | serial:balls |
| 3 | drip | body.ball[B:2] | segment | hide | blob | serial:balls |
| 4 | eye_l | body.eye[L] | sensor | focal | blob | mirror:eyes |
| 5 | eye_r | body.eye[R] | sensor | focal | blob | mirror:eyes |
| 6 | highlight | body.ornament[C] | ornament | underside | blob | single |

**D-c roles:** blob + balls = hide (one mass, one ramp); eyes = focal
(F16 merge-protected, the pinned focal table); highlight =
**underside** — the F5 contrast read: underside is the palette's
bright ramp, exactly the gloss cue the spike's `slimehi` ramp plays.
Roles used = exactly [hide, underside, focal]. Recorded watch item
(mini-sheet): the dominant-ball part tags create interior part
boundaries inside the hide mass; craft rule 4 may draw edge-2 seams
along ball boundaries where depth differs (the spike's single-material
craft_lite has none). Recorded fallback if the owner flags
segmentation seams: collapse all ball part tags to node 0 (one golden
re-pin before U4 closes, never after) — the iris↔sclera fallback
pattern.

**D-e chains — AMENDED AT IMPLEMENTATION (evidence below): ONE blob
chain holding all seven slabs.** The adjudicated resolution gave the
eyes and highlight their own chains (the wing/tendril own-signal
reading). Production evidence refuted its fitness: under own chains
the 06 §1.5 snap law plants each eye chain's anchor — the eye itself —
on a whole-pixel raw, i.e. a pixel CORNER, every genome, every frame:
the worst possible 4-way sample straddle for a 1.7 px focal part, and
STRUCTURAL — no rest-geometry lever can move it (any rest shift
cancels through the chain's own snap), so the pinned U3 pixel-phase
fallback is mechanically inapplicable. The rendered visibility sweep
found zero-focal-pixel frames with HEALTHY field margins (seed 11 walk
f3: field 6246 raw BELOW TH at the eye front yet zero focal pixels —
the eye's ~4 samples per straddled pixel lose every majority vote;
the raw value is a PRE-REPAIR-BUILD diagnostic whose probe log was not
retained — the zero-focal fact itself is backed by the run-1 shard
record's zff list).
Riding the blob chain restores the spike's exact relative vote
geometry — the accepted S1b renders are the evidence — and the face's
oscillators ARE the squash signal (eye y = restCy·squash, highlight z
rides stretch), the blob's own signal: this is the levitant F16
rigid-face case, not the wing/tendril independent-signal case the
adjudication assumed. Face scramble is impossible by construction
(one chain, one offset; CI asserts all seven slabs share the frame
offset). §3's "face parts keep their own chains" sketch line is
superseded by this record. Within-chain relative motion renders at
raw sub-pixel positions (the levitant pupil-on-body-chain precedent);
the flicker gates below price the resulting breathing shimmer on the
full histogram.

| chain | slab indices | anchor |
|-------|--------------|--------|
| blob | 0, 1, 2, 3, 4, 5, 6 | blob |

**D-k shadow/hitbox.** Ball slabs carry VISIBLE half-extents (F8) —
`deriveHitbox`, the AABB, the shadow, flicker energy, and craft see
visible-radius geometry with NO plan special-case; the fork alone
converts to ball radii. Shadow = `graph.chains[0]` through the
existing plan-aware seam (no code change) — now all seven slabs; the
ball extents dominate its x-span in the front/back views, and a
floor-pushed eye may legitimately widen it in profile (the levitant
eye-stack precedent, derived, no special case). The slime TOUCHES the
ground (rest blob bottom −0.156 px, skirt −0.512 px below the ground
line, constant across the depth domain by the shared σ): the
ground-anchored ellipse reads as a contact shadow. Recorded honestly:
(1) where balls overlap, the summed field bulges past single-ball
visible radii, so rendered pixels can overshoot the slab-derived
hitbox — measured worst case on the full 0..1999 sweep: **1 px**
(seed 3, walk left f0) — legal, the hitbox law is slab-derived;
(2) death hitboxes derive from undeflated extents (weight-only
deflate; overshoot grows on f2/f3 — same clause).

**THE FORK (D-f) — normative fp field rasterization.** Lives entirely
inside `rasterize`; same projection, frame anchors, supersample grid,
coverage rule, majority vote, tie-breaks, per-pixel (part, depth,
material, tone) tags, and the 06 §1.4 canonical serialization
VERBATIM. `Slab` gains optional `fieldWeight` (positive fp raw,
per-frame — death deflates it); slabs carrying it form THE field
group; classic slabs run the Q-steps unchanged; `yawSlab` passes it
through; the §1.5 offset hook applies to ball slabs like classic ones.
Constants: VIS_RATIO 43909 = RHE(0.67·2^16) (F8's normative law),
BALL_FROM_VIS 97815 = fp_div(65536, 43909) — ball radii recover ONCE
per rasterize call as `fp_mul(vis, BALL_FROM_VIS)`, inverses once per
ball per axis (divides never per sample, 06 §5.2; round-trip vs the
spike's authored ball radii ≤ 1 ulp — recorded; the true single-ball
visible ratio at TH 0.3 is 0.6725, so surfaces sit ~0.4% proud of
authored visible radii). TH_RAW = MARCH_STEP = 19661 = RHE(0.3·2^16);
MARCH_CAP = 256 (exceeding it traps — the MAX_PASS_ITERS pattern;
worst legal span 99 steps, headroom 157); BISECT_ITERS = 6 with
`mid = asr(fp_add(lo, hi), 1)` (floor, pinned); ENTRY DEPTH = hi (the
inside point, spike verbatim). Worst-case surface-depth error =
MARCH_STEP/2^6 = **307.2 raw = 0.0046875 px** (machine-verified
≤ 308 raw); determinism does not rest on the bound — every op is a
pinned exact fp op. Field per point: per ball in ascending node id,
per-axis guards |X|,|Y|,|Z| ≤ FP_ONE (they keep every squaring inside
int32 for arbitrarily distant samples), `d2 = X² + Y² + Z²` plain int
adds, term = `fp_mul(w, fp_mul(t, t))`, `t = FP_ONE − d2`, **a ball's
term is 0 when d2 ≥ FP_ONE** (the t ≤ 0 clamp, pinned: the per-axis
guards alone admit d2 up to 3·FP_ONE, so an unclamped t² would
contribute spurious positive field — the march start point would
already read ≥ TH — and the Σ W bound below assumes the clamp), field =
Σ term. **Int32 overflow audit (the 06 §1.4 A/B/C precedent applied):
max field = Σ W = 199885 ≪ 2^31; every intermediate bounded — the
naive 4-ball sum is int32-safe by construction; NO normalized form is
needed** (the precedent demanded the analysis, not a rejection).
March admission per column: strict raw compare |dx| < ballRx (the
spike's prune); y-span from admitted balls; no admitted ball → miss.
March loop form, pinned: evaluate at the admitted span's min y first,
step +MARCH_STEP, stop once past the span max. **INSIDE = field ≥
TH_RAW** — the ≥, not strict >, is the pin for BOTH the march stop and
the bisection keep-side (hi = mid exactly when field(mid) ≥ TH_RAW;
the strict-> alternative changes the pinned fork golden grid —
verified experimentally, so the comparison direction is
determinism-bearing).
Nearest-hit vs classic slabs: the field group contributes at most one
hit per sample at pseudo-slab-index = the lowest ball node id (0);
winner = smallest entry depth, strict <, ties to the lower index —
§1.4's rule verbatim (the blob wins depth ties against face slabs;
CI observes the tie through the pinned depth tag). Part tag =
dominant ball (largest term at the entry point, ties → lowest node
id; the spike renders one material and pins nothing here — our
choice, recorded; it feeds the seam watch item and gives F15
part-level stats real parts). Tone: field-gradient normal by central
differences at the entry point, GRAD_E = 16384 = RHE(0.25·2^16) (the
spike's e), difference orientation pinned: **n_i = field(p − e_i) −
field(p + e_i)** — outward = the NEGATIVE field gradient, matching
T2's outward classic normal (the flipped order changes tones in the
pinned fork golden grid — verified experimentally), then T3–T7 of
06 §1.4 VERBATIM (|n_i| ≤ 199885 ⇒ T3 sum
≤ 1828950 ≪ 2^31 ✓). Per-column precompute (admission/X², march
y-grid + Y², negated-tilt z-bases) is semantics-preserving hoisting
only — every hoisted raw is the identical fp value. A U4 raster
golden pins the all-defaults walk φ=0 down serialized grid
(sha256 `785694ab…`, offset-free — the fork's determinism anchor
beside the M1 classic one).

**Rest geometry.** Visible-radius template constants (single rounding
RHE(0.67·r·2^16)): BLOB_V (360055, 342491, 298582), CREST_V (175636,
166855, 149291), SKIRT_V (324927, 307364, 158073 — z constant),
DRIP_V (100991, 100991, 87818), EYE_HALF (55706, 39322, 72090),
HI_HALF (78643, 58982, 65536). Derived anchors
(`anchor = C + fp_mul(σ, dim − D)`, exact at defaults):

| anchor | C | tracks | σ | slope |
|--------|---|--------|---|-------|
| BLOB_VX | 360055 | girth | 92322 | 0.67·8.2/3.9 |
| BLOB_VY | 342491 | length | 45065 | 0.67·7.8/7.6 |
| BLOB_VZ | 298582 | depth | 87818 | 0.67·6.8/3.4 |
| Z0 (rest blob z) | 288358 (4.4) | depth | 87818 | shares BLOB_VZ's σ ⇒ constant rest ground gap −0.156 px |
| SKIRT_VX | 324927 | girth | 83315 | 0.67·7.4/3.9 |
| SKIRT_VY | 307364 | length | 40443 | 0.67·7.0/7.6 |
| DRIP_Y0 | −353894 (−5.4) | length | −39322 | −0.6 DAMPED, sweep-optimized (0.55 ⇒ 42 corner fails, 0.60 ⇒ 14, 0.65 ⇒ 22 — totals; each carries a constant +4 death-occlusion baseline from the sweep scripts' pre-calibration DEFLATE f2 = 0.35, so drip-only counts are 38/10/18, and the shipped-pin drip residual below is 10) |
| EYE_X | 131072 (2.0) | girth | 33608 | 2.0/3.9 |
| EYE_Y | 301466 (4.6) | length | 45065 | shares BLOB_VY's σ ⇒ constant 0.626 px front setback where the forward floors are inactive (a floor can only shrink it) |
| HI_X | −157286 (−2.4) | girth | −40330 | −2.4/3.9 |
| HI_Y | 170394 (2.6) | length | 22420 | 2.6/7.6 |
| HI_ZREL | 196608 (3.0) | depth | 57826 | 3.0/3.4 (decimal-ratio and fp_div forms agree — no ulp split, adjudication-verified) |

Rest centers: blob (0, 0, Z0); crest (0, −52429, Z0 + 235930); skirt
(0, 39322, 124518); drip (0, DRIP_Y0, 104858); eyes (∓EYE_X,
EYE_Y_final, Z0 + 52429); highlight (HI_X, HI_Y, Z0 + HI_ZREL).
Reproduction evidence (machine-run, exact fp vs the float spike): all
four walk phases + idle at defaults — worst |fp − float| 0.00126 px
(ball centers), 0.00006 px (radii), 0.00003 px (face slabs). Rendered
fidelity: the fp fork exact-matched the FLOAT spike renderer — **0
silhouette / role / tone differences over all 32 walk+idle × phase ×
direction cells (3706 opaque pixels)**, re-verified at the resume
audit (`u4-verify/compare_spike.py`).

**The eye forward floors (the M1 eye-visibility mechanism, amorphous
form).** At growth time, in the ball-radius frame,
`floor_b = cy_b + fp_mul(ballRy_b, fp_sqrt(q_b − X² − Z²)) −
EYE_HALF.y` with `X = fp_div(eyeX − cx_b, ballRx_b)` and
`Z = fp_div(eyeZ − cz_b, ballRz_b)`, each `ballR_b =
fp_mul(vis_b, BALL_FROM_VIS)` — growth-time per-axis divides (the
06 §5.2 divides-allowed-at-growth path), NOT the fork's per-sample
inverse-multiply convention above: fp_div and the inverse-multiply are
not ulp-equivalent and land a DIFFERENT rest eye_y on real genomes
(inactive if |X| or |Z| > 1 or the radicand ≤ 0);
`EYE_Y_final = max(coupled, active floors)`. Four candidates:
1. REST blob ball, Q_BODY = 32768 exact (term budget 0.25) —
   evidence-triggered by the 512-config corner sweep (**256 buried-eye
   configs without it, 0 with** — re-measured at the round-0 evidence
   audit on the pinned geometry, artifact `u4_audit_nofloor.out`:
   266 corner failures total without the rest floor = 256 buried-eye
   + the 10 drip pinches; the spec draft's "~594" appears in no script
   output — u4-spec.md's own line-700 admission — and did not
   reproduce under any reconstruction, so it is CORRECTED here; the
   mechanism's evidence trigger and the "0 with" half both verify);
2. REST skirt ball, Q_SKIRT = 48021 = FP − fp_sqrt(fp_div(3277,
   45875)) (budget 0.05);
3. **the WIDE-POSE skirt floor (implementation repair,
   evidence-triggered by the rendered 0..1999 sweep):** the same skirt
   arithmetic at the genome's own wide-squash pose — squash_w =
   1 + max(squash_amp, IDLE_BREATH) (the walk-φ0.75 / idle-φ0.25
   extreme; hop = 0 there), skirt halves ×squash_w — order pinned:
   the wide factor multiplies the VISIBLE half first,
   `fp_mul(squash_w, vis)`, exactly as the pose factors apply, and the
   scaled visible half then converts via BALL_FROM_VIS inside the
   floor step; convert-then-scale is NOT fp_mul-equivalent and
   diverges on real genomes' rest eye_y — eye z at
   z0 + EYE_ZREL + dz0_w — mapped back to a REST anchor by the pinned
   division form (pose re-applies ×squash_w exactly up to ≤ 1 ulp of
   the div/mul round-trip; budget slack is thousands of raws).
   Mechanism: squash widens the skirt while dz0 < 0 sinks the eye
   toward it, so rest-proud eyes drown at the wide frames (worst
   observed: seed 11 idle f1, field 1238 raw PAST TH — a
   PRE-REPAIR-BUILD diagnostic, probe log not retained; the shipped
   build's probe gives this eye +5159 proud with the floors active);
4. **the WIDE-POSE blob floor** (same pose; blob halves × (squash_w,
   squash_w, stretch_w) — the same visible-first order: factors
   multiply the VISIBLE halves, which then convert via BALL_FROM_VIS —
   center z rides dz0_w with the eye so their z
   offset stays EYE_ZREL exactly) at its OWN budget
   **Q_BODY_WIDE = FP − fp_sqrt(RHE(0.26·2^16) = 17039) = 32119**
   (machine-derived; a hand 32118 was 1 ulp wrong): a deep blob can
   bury the eye alone (seed 4 walk f3: blob term 18865, total margin
   +796 raw, zero focal pixels — a PRE-REPAIR-BUILD diagnostic, probe
   log not retained and the discarded build not re-runnable; on the
   shipped build the floor lands this eye at +2620 proud). Budget 0.26
   sits strictly above the defaults' own wide-pose blob term (walk-f3
   16751 / idle-f1 16315 — re-verified on the shipped build), so the
   defaults stay exactly inert while pushed eyes land at
   **≥ 2620 raw** of field margin (production-path probe
   `u4-verify/field_probe.mjs` on the shipped dist: seed 4 walk f3 =
   2620 exactly, seed 11 idle f1 = 5159; the draft's "≥ 2622" was
   measured before the DRIP_EXTRA 6258→6259 re-pin, whose ≤ 7.5-raw
   shift accounts for the 2-raw drift — as printed it was false on the
   production path, corrected here) — the defaults' proven league
   (defaults win their pixels at 2910, re-verified).
Counterfactual (run on the pre-repair build, seeds 0..1999
amorphous-forced, down view, walk 4 phases): **237/8000 zero-focal
frames across 114 seeds**; with the floors and the D-e chain merge:
the sweep record below. Every floor is inactive at every default:
rest-body margin 6878 raw, wide-skirt margin 153464 raw, wide-blob
budget clearance above (machine-verified in CI) — byte-inert, the M1
EY-floor pattern; forward-only (+y, protrusion never occlusion).

**Gait template (D-g).** Oscillators (sin = the 06 §5.3 LUT; φ fp
turns; p·φ a plain integer product; a = squash_amp, λ =
ball_phase_delta, p = pulse_freq):

```
walk:  θ = p·φ;  squash = fp_sub(FP, fp_mul(a, sin(θ)))   (wide when landed)
       hop = max(0, fp_mul(HOP_AMP, sin(θ)))
idle:  θ = φ (freq ignored — M1 rule);  squash = fp_add(FP, fp_mul(IDLE_BREATH, sin(φ)));  hop = 0
both:  stretch = fp_div(FP, squash)                        (THE pinned division form)
       sigC = sin(θ − λ);  sigD = sin(θ − (λ + DRIP_EXTRA))
       dripLift = max(0, fp_mul(DRIP_ZAMP, sigD))
       dz0 = fp_add(fp_mul(Z0_rest, fp_sub(stretch, FP)), hop)
```

Per-node deltas/factors (centers = rest + delta, halves = factor ×
rest, VISIBLE units — F9): blob (0, 0, dz0) × (squash, squash,
stretch); crest (CREST_XAMP·sigC, 0, dz0 + CREST_ZREL·(stretch − 1)) ×
(1,1,1); skirt (0, 0, hop) × (squash, squash, 1); drip (0,
−DRIP_YAMP·sigD, dripLift + HOP_DRIP·hop); eyes (0,
EYE_Y_final·(squash − 1), dz0); highlight (0, 0, dz0 +
HI_ZREL·(stretch − 1)). **Rest-pose law — the multiplicative-extents
extension of the U1 decomposition law:** per-frame center deltas stay
exact int32 adds onto rest raws; per-frame EXTENT factors multiply
rest half-extents via fp_mul with every factor exactly FP_ONE at rest
(squash = 65536 ⇒ stretch = fp_div(65536, 65536) = 65536 exactly, and
fp_mul(65536, x) = x identically — machine-verified). **The U4 idle
rule (recorded deviation):** idle is the SPIKE'S OWN preset, not the
M1 half-amplitude rule — hop = 0 (locomotion zeroed, rule honored),
squash flips to +0.10 breathing, crest/drip lag oscillators run at
FULL amplitude (the spike's formulas are clip-independent). Grounds:
the all-defaults-reproduces-slime() law outranks the half-amplitude
convention; S1b's accepted renders ARE the idle evidence; the
levitant flap-freeze established plan-specific idle rules by
justification. Mini-sheet watch item. An independent from-spec Python
pose oracle (`tests/goldens/amorphous_pose_oracle.v2.json`) pins the
vectors for the all-defaults genome and one genome with every
amorphous locus EXCEPT pulse_freq non-default (p = 2 is the recorded
freeze degeneracy, pinned by its own CI tests), every clip × frame,
slab raws + fieldWeights.

**Envelopes (D-h; §4.4.2 semantics; part classes ball vs face inside
the one blob chain — death's per-part deltas extend §2.4's
already-per-part deflate exception, values identical to the
adjudicated singleton-face-chain form).** attack (K = 4, 1+1+2, a
single-mass lunge — every part takes the SAME [dy, dz]; the blob has
no head/limb/tail analog): f0 [−98304, −45875] (−1.5, −0.7 — the
quadruped body-row squat) × anticipation; f1 [+147456, 0] (+2.25);
f2 [+49152, 0] (+0.75 = f1/3 exact); f3 [0, 0]. Corner-swept worst f1
canvas bottom margin 1.241 px. hurt (K = 2): f0 [−147456, 0]
(−2.25, the U2-tuned raw) every part; f1 zeros; `flash: true`
metadata-only. **death (K = 4) = DEFLATE (§2.4's new envelope
mechanism, pinned):** stagger `cy += −49152` every part every frame;
ball fieldWeight at frame k = `fp_mul(DEFLATE[k], W_i)`,
**DEFLATE = [58982, 42598, 29491] (0.9, 0.65, 0.45)** — f0/f1 reuse
the DEATH_FOLD raws (weight is the blob's limb); f2 calibrated UP
from fold's 0.35 by the 16-config death corner sweep (0.35 leaves the
deflated field too thin to occlude the sunken face, worst −1620 raw;
0.45 clears every corner at +634 and still reads as deflation: drip
f2 weight 0.248 < TH — the drip evaporates). Balls sink
`cz −= fp_mul(DEATH_SINK[k], DEFLATE_DROP_CAP)` with
**DEFLATE_DROP_CAP = 196608 (3.0)** — a pinned constant REPLACING the
derived capacity, which is 0 for a grounded blob (the deflation, not
rest clearance, creates the drop room; grounding machine-verified:
blob bottom −0.47/−0.85/−1.06 px at f0/f1/f2). Face parts sink on
their OWN rest capacity `max(0, restCz − restHz)` (quadruped formula
verbatim — eyes ~4.1 px, highlight ~6.4 px at defaults) AND retract
`cy −= fp_mul(DEATH_SINK[k], max(0, restCy))` — the occlusion
mechanism (eye front-probe field ≥ TH at f1/f2 for defaults and all
16 corners, worst margin +634 raw; at f0 the eye is still proud —
the face visibly "goes under" from f1, the intended read;
depth-sorted occlusion only, no alpha exists). The idle base
(breathing) continues through death; **f3 = f2 WHOLESALE** (base
phase + envelope + weights + drop + retract) — every held pair scores
exactly 0.0.

**Flicker (D-i).** Metric arithmetic unchanged (06 §1.6);
`evaluateCell`'s guard accepts the 7-slab amorphous list. The
amorphous FLICKER_GATES row was calibrated in **ONE step on the FULL
seeds 0..1999 amorphous-forced sweep** (the §4.4.6 close-out lesson —
never 200-then-2000), 8000 cells (2000 seeds × 4 directions) per clip
on the FINAL
production path (the pre-repair run-1 histograms were discarded with
the repair; run 2 is the record), gate = tightest integer ≥ 1.25× the
observed max. Idle stays measurable but ungated (M1 policy; the row
carries walk's rational). Energy note, recorded: squash is an EXTENT
oscillation — skirt/drip centers barely move, so amorphous cells have
changed-pixels sources with no energy counterpart; the calibration
prices this in (the U3 one-chain-mass artifact analog). 0 INF on the
full sweep (every clip has a moving center at every pair). The gate
TABLE is single-sourced: exactly one test module
(`tests/flicker-gates.test.ts`) asserts the full FLICKER_GATES object
for ALL THREE plans — the U3 close-out's duplicate pins in
clips.test.ts/levitant.test.ts were consolidated into it (behavioral
gate tests stay in their unit files).

**Calibration record (RUN 2026-07-16, seeds 0..1999 amorphous-forced,
8000 cells (2000 seeds × 4 directions) per gated clip, the final
production path):**

| clip | observed max (seed, dir) | ×1.25 | gate | margin |
|------|--------------------------|-------|------|--------|
| walk | 113.8060 (1933, up) | 142.2575 | **143** | 1.257× |
| attack | 49.7549 (431, up) | 62.1936 | **63** | 1.266× |
| hurt | 22.0728 (864, down) | 27.5910 | **28** | 1.269× |
| death | 22.6905 (900, down) | 28.3632 | **29** | 1.278× |

0 INF over all 88 000 measured pairs; the 8000 death held pairs score
exactly 0.0. Walk histogram (score-floor buckets, 32 000 pairs): the
mass sits at 0–19 (30 087 pairs); a long tail thins through 20–51
(1 863) into 50 squash-loud pairs (buckets 54:13, 57:1, then 58, 59,
62, 64, 70, 81, 84, 98, 113 at 4 each — single seeds × 4 directions).
The tail is the squash mechanism's metric artifact,
priced in by design: squash oscillates EXTENTS, so changed-pixel
counts have no matching center-motion energy in the one-chain mass
(the U3 one-chain artifact, amplified). Attack histogram peaks at 4–9
(16 529) with max 49.75; hurt at 5–8 (4 929) max 22.07; death carries
its 8000 held-pair zeros plus a 2–7 body (13 449) max 22.69.

**Craft debt (D-j — the S3 scope note DISCHARGED).** The full craft
property suite — orphans (rule 2), jaggies (rule 3), budget (rule 5),
selout exemptions (rule 4/F7/F15), and IDEMPOTENCE — runs on the
pinned amorphous corpus: CI-scaled = defaults + seeds 0..4 all clips ×
directions (idempotence defaults + 0..2); unit evidence = the craft
outcomes inside the 0..1999 sweeps (0 craft errors). F7/F15 on
squashed-blob geometry, recorded facts at defaults: down-view walk —
exempt parts [2, 4, 5, 6] (the squash-thinned skirt fringe, both
~4-px eyes, the highlight); left view — the ~2-px drip is exempt; the
drip is fully occluded in the down view (no stats ⇒ no entry).

**Wire (D-l, design 06 §3.5 amendment).** All-defaults tape `AQAE`
(4 chars, CI round-trip). Largest sampler-reachable amorphous tape =
**60 B = 80 chars** (worst payloads: id 47 → 1 B, ids 48/49/50 → 3 B
each); quadruped 138 B and levitant 85 B unchanged (scopes untouched);
the fully-adversarial hand-edited cross-plan bound grows 179 → **193 B
= 258 chars** (the U3 amendment predicted exactly this growth; no
sampler emits it; degradation linear; accepted). **Semantic map** goes
three-column (§2.5 realized as one row set, absent = unmapped): rows
gait_freq↔hover_freq↔pulse_freq, bob_amp↔hover_amp↔squash_amp,
tail_lag↔tendril_lag↔ball_phase_delta, tail_amp↔tendril_amp↔—,
anticipation³. All four amorphous loci are mapped; quadruped
leg_swing_amp/leg_lift_amp and levitant flap_ratio stay unmapped
(recorded). bob_amp ↔ squash_amp is a px-ratio unit mismatch mapped on
semantics ("primary body oscillation amplitude") — correspondence
data, not a converter; M5 resolves units. Integrity CI: every entry
resolves via locusByPath, all `anim.*`, no duplicate endpoints per
column.

**Domain-extreme sanity (adjudication-run 2026-07-16, 512 walk/idle
corner configs + 16 death configs, exact fp).** Eyes proud + attached
everywhere with the floors + amp hi 0.2 (worst proud margin +295 raw,
worst attach +2602 raw; 256 buried-eye configs without the rest floor
— the corrected, artifact-backed figure, see floor candidate 1);
highlight attached everywhere after the HI_Y/HI_ZREL ratio re-coupling
(worst inner-field margin +326 raw; detached at G-hi/L-extreme corners
with constant couplings); crest/skirt attached (worst +28583/+33560);
canvas worst top 4.84 px / bottom 1.82 px (walk), side 5.43 px,
attack-f1 bottom 1.24 px, death bottom 4.60 px; march worst span 99
steps. Residual, ACCEPTED + RECORDED (the U3 tendril-gap precedent):
**10 drip transient pinches** at walk φ = 0.25 L-extreme corners
(worst min-field −13340 raw below TH along the drip→skirt segment) —
the trailing drip briefly pinches ~1 px off the hopping mass at corner
genomes; thematically a drip, single-phase transient; σ_DRIP_Y = −0.6
is the sweep optimum. Gated by the pixel-level connectivity sweep
below; mini-sheet judgment item. (The sweep ran at DRIP_EXTRA 6258;
the adjudicated 6259 re-pin shifts any lag term ≤ 7.5 raw ≈ 0.00012 px
— three orders below the smallest margin; re-verified on the
production path by the sweeps below.)

**Full-sweep evidence (seeds 0..1999 amorphous-forced, the FINAL
production path — RUN 2026-07-16; the pre-repair build's run is kept
only as the visibility counterfactual).**

- **Eye visibility (down view, walk 4 phases, 8000 frames):
  3/8000 zero-focal frames across 3 seeds (805, 1289, 1539 — all at
  walk f3, the wide-squash frame). The pinned target was 0 — MISSED BY
  3, recorded honestly and NOT repaired further, pending ruling.**
  The counterfactual (pre-repair build, same corpus): 237/8000 across
  114 seeds — the two evidence-driven repairs (wide-pose floors + the
  D-e chain merge) removed 98.7% of the family. The residual three are
  field-PROUD at the failing frame (margins +3415/+915/+2623 raw — NOT
  buried): they lose the pixel VOTE by sub-pixel phase, the levitant
  vote-lottery class. The literally-pinned U3 pixel-phase fallback is
  mechanically inapplicable (the amorphous eye's relative screen phase
  varies per frame with squash — no single rest-cy advance lands every
  frame on a proven phase), and any further global geometry nudge
  re-rolls the phase lottery for all 2000 seeds with regression risk
  against the 7997 now-passing frames. Precedent for accept-and-record:
  the U3 tendril-gap residual (119 links) and this unit's own drip
  pinches. Single-phase transients (the eye reappears at f0); disclosed
  as a mini-sheet watch item with the three seeds named.
- **Connectivity (crest/skirt/drip pixel clusters 8-connected to the
  nearer-ball mass ∪ blob, down-view walk frames): 12 357/12 357
  rendered links = 100% ≥ the 99% target**; 11 643 fully occluded
  links (mostly the drip hidden behind the mass in the down
  projection) have nothing to break and are recorded, not failed. The
  §8-predicted corner-genome drip-pinch family did NOT materialize at
  pixel level on the sampled corpus (0 fails); the 10-pinch fp-field
  family stays recorded above as corner-genome evidence.
- **Hitbox/shadow overshoot (rendered pixels vs the slab-derived AABB,
  every rendered cell of the FOUR GATED CLIPS — walk/attack/hurt/death
  — × 4 directions): worst 1 px** (seed 3, walk left f0) — inside the
  predicted sub-pixel-to-~1-px overlap-bulge band; slab-derived law,
  recorded. The sweep worker never rendered idle cells (recorded
  honestly — an earlier "all five clips" phrasing overstated this);
  idle overshoot/render coverage lives at CI scale only.
- **Craft: 0 errors over every swept cell** (the four gated clips × 4
  directions of every seed, crafted through the production path by the
  sweep; idle craft coverage lives in the CI corpora — defaults +
  seeds 0..4 all clips × directions, idempotence defaults + 0..2 —
  not in the 0..1999 sweep).
- Double-render byte-stability: seeds 0..9 exported twice,
  byte-identical sheets/JSON (10/10), plus the two-render golden
  ritual at defaults.

**Golden provenance (the M1 ritual, RUN 2026-07-16 — re-run from
scratch after the visibility repair + chain merge landed).**
All-defaults amorphous (72 frames, 128×640, genome `AQAE`, hurt flash,
mirror false):

```
sheet PNG  sha256 834e00a9c3019c59242ebd230ac29e53e1d49b5bf24478317c51b2d9c3517dee
sheet RGBA sha256 7712bff19d42be221467eb48ac81e0cc47e1b1956f5ec67426ca6a79d01bf5ac
JSON       sha256 66fe432fd38499a86620620afaf67efd8885a0ddc0c6e9837073227cb8bb5be0
```

Pinned only after: PIL pixel-compare of the sheet PNG against the raw
RGBA; independent Python JSON re-canonicalization (byte-identical);
all 72 hitboxes exact-matched by the from-spec Python snap + hitbox
oracle (one-chain table); every sha256 recomputed in Python; two
consecutive renders byte-identical; and the spike-fidelity
pixel-compare above (3706 opaque pixels, 0 diffs). Files committed as
`tests/goldens/amorphous.sheet.png` / `amorphous.json`. One sampled
amorphous (seed 0) RGBA sha256 additionally CI-pinned (`c3172d3d…`).
The fork raster golden (`785694ab…`) is offset-free and survived the
chain merge unchanged. Second-platform byte-identity:
**[EVIDENCE-PENDING: CI run on both platforms after this commit
lands.]**

**Mini-sheet review (seeds 0..24 amorphous-forced, §7 delivery
format).** **[EVIDENCE-PENDING: owner verdict.]** Watch items to
disclose: ball-boundary selout seams (fallback: collapse part tags to
node 0); full-amplitude idle crest/drip (the spike-verbatim idle
rule); pulse_freq-2 frozen hop/squash seeds; drip transient pinches
(corner genomes, walk mid-hop); death f0 face-still-proud read; the
face breathing shimmer under the one-chain snap (spike-faithful, gated
by the calibrated flicker row).

Scope lines (recorded): no new craft rules, palette changes, 16×16,
plan-mix sampling (U6), tag gating (U5); clearance radii 0 throughout;
GENERATOR_VERSION stays 2 — U4 adds output for plan-2 and changes none
for plans 0/1 (the full M1/U2 quadruped anchor suite + U3 levitant
goldens stay green, run not assumed).

**Suite-time accounting (the ~180 s budget, 2026-07-16).** Recorded
runs, this tree, Windows dev machine: solo (quiet machine) **406
tests green at 164.38 s wall** (worker-aggregate test time 369.9 s;
the dominant file is tests/amorphous.test.ts — the fork march is the
pipeline's hot path and its CI corpora price it; no green full-suite
run's per-file log was retained, so its solo cost is cited from the
nearest retained records: ~139.2 s in a 1-failed intermediate
full-suite run, and 275.87 s in a green 45/45 solo-file run under
sweep load, artifact `u4_audit_amorphous_solo.txt`);
one additional green run at 406.65 s wall under a pathological load
(8 CPU-saturated sweep shards — not the normal-load case). The solo
run sits UNDER the ~180 s budget but OVER the unit spec's own 150 s
trim-trigger with only ~1.1× load headroom — recorded honestly: every
CI corpus is already at the spec's own pinned scale (flicker defaults
+ seeds 0..4; craft defaults + 0..4; idempotence defaults + 0..2;
visibility seeds 0..19 — extended at implementation to idle frames,
which guards the repaired burial mode), so trimming further means
cutting below the adjudicated corpus pins; that judgment is left to
the U4 gate with the candidates named (halve the visibility-idle
extension, or thin the craft direction set) rather than taken
unilaterally. **Round-0 verification re-measurement (prior-round
record; unlike every other figure in this paragraph its vitest logs
were NOT retained, so the qualitative pattern — not the decimals — is
the record):** three green 406/406 runs, two over the budget under
~94% external CPU load (Folding@home + two Photos indexer processes)
and the quietest borderline under at ~45% residual load. Fix-round
re-measurement at ~12% load (the nearest
to solo conditions achieved since): **406/406 green at 166.89 s and
162.97 s wall** (two runs, the second on the finished tree) —
corroborates the 164.38 s solo figure. Round-1 verification
re-observed the round-0 pattern (its two mandated runs over budget
under ambient load — Photos/FAH/Discord CPU present but small by
direct measurement, back-to-back all-core runs on a Balanced-power
i7-1255U the plausible inflator — and a later quieter diagnostic run
under; logs likewise not retained, the pattern is the record); the
round-1 fix pass then measured **406/406 green at 163.01 s wall**
(worker-aggregate 366.17 s; log retained). The budget holds on a
quiet machine and is exceeded under load; the question is therefore
load-sensitive and stays with the U4 gate: accept on the four
quiet-machine sub-180 runs, or re-measure on second-platform CI
before commit.

**U4 gate ruling (orchestrator, 2026-07-16): ACCEPTED at the pinned
corpora — no trim.** Two further independent gate-time measurements on
a verified-quiet machine: **406/406 green at 166.3 s and 165.3 s wall**
(six consistent sub-180 solo measurements total across three
sessions). Every over-budget observation traces to measured external
CPU load; the adjudicated corpus pins buy real coverage, and trimming
them to buy margin against a load profile CI runners do not have is a
bad trade. The ~180 s budget stands as the guideline; CI wall time on
the dedicated runners is the operative check from here (watched at
every push).

### 2.5 The anim semantic map (06 §1.1's pinned mechanism)

Ships with U3 as a data table beside the registry: per plan pair, leaf
correspondences for `anim.*` only (e.g. `quadruped.gait_freq ↔
levitant.hover_freq ↔ amorphous.pulse_freq`; amplitude↔amplitude rows
likewise). M2 tests referential integrity (every entry names real
registry paths) and nothing else; crossover consumes it at M5.

**U3 pin — the quadruped ↔ levitant table** (`ANIM_SEMANTIC_MAP`,
frozen data beside REGISTRY in genome.ts; canonical path strings; no
crossover code until M5):

| quadruped | levitant |
|-----------|----------|
| anim.quadruped.gait_freq | anim.levitant.hover_freq |
| anim.quadruped.bob_amp | anim.levitant.hover_amp |
| anim.quadruped.tail_lag | anim.levitant.tendril_lag |
| anim.quadruped.tail_amp | anim.levitant.tendril_amp |
| anim.quadruped.anticipation | anim.levitant.anticipation |

Unmapped, recorded (design 01 §3's "present in one parent only" case):
quadruped `leg_swing_amp` + `leg_lift_amp`; levitant `flap_ratio`.
CI: referential integrity via locusByPath, all paths `anim.*`, no
duplicate endpoints — nothing else.

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
renders. *(U4 delivery note: the second clause did NOT survive contact
with S1b renders — own face chains corner-straddle the eyes'
sample votes structurally; the delivered pin is ONE blob chain holding
all seven slabs. Full evidence record: §2.4.1 D-e.)*

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
4 columns: **72 frames (16+16+16+8+16), 20 rows, sheet = 128×640
RGBA**; row cells
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
zero-motion convention, and INF-fail are unchanged — this section is
gate POLICY only.

Gates are **per-(plan, clip) tables** (U3 amendment, 2026-07-15). Each
plan's row is set by the M1 recalibration method against that plan's
OWN production histogram (per clip, seeds 0..199 × 4 directions = 800
cells; gate = the tightest integer with ≥ 1.25× margin over the plan's
observed max; evidence recorded in the unit amendment). A plan's gate
never prices in the other plan's histogram: a shared global gate wide
enough for the levitant's structurally loud attack cells would let a
quadruped attack regression 4.6× past its own calibrated ceiling pass
silently. A cell asserts the gate row of its genome's `meta.plan`.

| plan | walk | idle | attack | hurt | death |
|------|------|------|--------|------|-------|
| quadruped | 32.0 | ungated | 19.0 | 14.0 | 25.0 |
| levitant | 47.0 | ungated | 144.0 | 22.0 | 19.0 |
| amorphous | 143.0 | ungated | 63.0 | 28.0 | 29.0 |

The quadruped row is **the U2 pins RESTATED, not recalibrated**
(§4.4.6 — its histograms have not moved; walk is the M1 gate). The
levitant row was calibrated at U3 on seeds 0..199 (walk 22 / attack
87) and **recalibrated at U3 close-out on the full 0..1999 sweep**
(walk 47 / attack 144 — §4.4.6 close-out record; hurt and death held
at 2000-seed scale). The amorphous row was calibrated at U4 in ONE
step on the full 0..1999 sweep — the §4.4.6 close-out lesson applied
(record: §2.4.1). Idle stays measurable but ungated in every plan
(M1 policy).

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

### 4.4 U2 amendment — envelopes, versioning evidence, the craft cycle-breaker

*Amended with U2 (2026-07-11), per this doc's header rule. Every
constant below is machine-verified (the independent Python envelope +
hitbox oracles exact-matched all 260 slab vectors and the pinned hitbox
spots before these tables were pinned; PIL decode and an independent
Python re-canonicalization verified the v2 sheet PNG and JSON bytes).
The frame count is **72 (16+16+16+8+16)** — §4.1's arithmetic was
corrected from a 56 slip at U2 kickoff; this amendment inherits 72
everywhere.*

**§4.4.1 Durations.** Uniform **140 ms per frame for ALL five clips**
— the S2/F10 uniformity verdict and the judged 140 ms cadence extend to
attack/hurt/death unchanged. Duration metadata emits the constant per
frame, all 72 entries.

**§4.4.2 Envelope semantics (normative).** A one-shot clip's frame k is
the **idle preset evaluated at the clip's own uniform phase
φ_k = k·(65536/K)** (design 06 §1.2 idle oscillators, unchanged) plus
the pinned envelope deltas below. Deltas are model-space fp raws
applied per CHAIN (rigid per-chain translation — F16's assembly
lesson: faces never scramble); directions stay pure projection, no
envelope constant is direction-aware. One-shot poses are defined ONLY
at the K uniform phases; other phase arguments trap. `poseQuadruped`
evaluates death's k = 3 as k = 2 wholesale (base phase AND envelope),
so the two final slab lists are identical by construction.

- **attack** (K = 4; design 03 §2's 1+1+2 envelope). Per frame,
  [dy, dz] raws added to (cy, cz) of every slab in the chain class;
  **f0's deltas scale by `fp_mul(anticipation, delta)`** (the locus is
  the wind-up depth — "snappy vs heavy"), f1–f3 do not scale:

  | k | body [dy, dz] | head [dy, dz] | tail [dy, dz] | limbs [dy, dz] |
  |---|---|---|---|---|
  | 0 wind-up (×ant) | [−98304, −45875] (−1.5, −0.7) | [−131072, −58982] (−2.0, −0.9) | [+32768, −45875] (+0.5, −0.7) | [0, 0] (planted) |
  | 1 strike | [+147456, 0] (+2.25) | [+196608, 0] (+3.0) | [+98304, 0] (+1.5) | [+147456, 0] |
  | 2 recovery | [+49152, 0] (+0.75) | [+65536, 0] (+1.0) | [+32768, 0] (+0.5) | [+49152, 0] |
  | 3 recovered | [0, 0] | [0, 0] | [0, 0] | [0, 0] |

- **hurt** (K = 2): f0 = whole-body recoil **[dy, dz] = [−147456, 0]
  (−2.25 px) on every chain, limbs included** (no stretch; tuned up
  from −1.75 so the down/up views clear one pixel through the TILT
  projection — a dz "cower" variant was tried and rejected because dy
  and dz foreshortening cancel in one of the front/back views); f1 =
  all zeros (the return). The palette flash is METADATA ONLY:
  `flash: true` on hurt's four per-direction clip entries, no pixel
  effect (design 03 §2).

- **death** (K = 4): every chain adds **DEATH_DY = −49152 (−0.75 px)
  to cy on every frame** (the stagger, held through the collapse).
  Non-limb chains sink: `dz = −fp_mul(DEATH_SINK[k], max(0, restCz −
  restHz))` computed from the chain's ANCHOR node's rest slab (the
  chain's first slab in the grown graph: core, head, tail) and applied
  to every slab of the chain. Limbs fold:
  `cz → fp_mul(DEATH_FOLD[k], cz)`, `hz → fp_mul(DEATH_FOLD[k], hz)`
  (feet stay on the ground line since cz = hz at rest; the leg
  shortens as it folds; folds apply to the post-idle-base raws).

  | k | DEATH_SINK | DEATH_FOLD |
  |---|---|---|
  | 0 stagger | 9830 (0.15) | 58982 (0.9) |
  | 1 sink | 29491 (0.45) | 42598 (0.65) |
  | 2 collapse | 55706 (0.85) | 22938 (0.35) |
  | 3 held | = f2 (whole pose copied) | = f2 |

**§4.4.3 The anticipation locus.** Registry append, id **35**, path
`anim.quadruped.anticipation`, fp domain **[0.5, 2]** raws
[32768, 131072], default **65536** (1.0). The default serializes
ABSENT (06 §3 wire law), so every issued v1 DNA string decodes and
renders v2-identically to the explicit-default genome — CI-tested.
**Deliberate U2 scope line: the hurt and death constants above are
pinned template constants, NOT loci** — no gene beyond anticipation
ships in U2; per-creature death/hurt variation is future registry
work, not a v1-compat concern.

**§4.4.4 Inert emitter rule.** Design 03 §2's only directional clause
— "emitter parts orient along facing during attack" — is **inert text
until a plan grows emitter parts** (v1 quadrupeds have none; the first
candidate is U5's FFF `ranged` preset). No code path implements it in
U2; it is recorded here so the rule has a pinned home when emitters
arrive.

**§4.4.5 The craft cycle-breaker (seed 1132 verdict: FIXED, proven
inert).** Diagnosis: sampled seed 1132's walk/down cell reaches, at
craft iteration 2, a state with two vertically adjacent interior
1-px islands — frame 3, pixels (17,21) hide/2 and (17,22) hide/1 —
whose rule-2 dominant-donor choice is EACH OTHER (all four neighbor
keys tie at count 1 in both cases, and the smallest-(roleId, tone)
tie-break selects the partner). The detect-then-apply simultaneous
update swaps the pair's tones, the swapped state re-selects mutually
again, and the trajectory is a period-2 cycle that can never reach the
fixpoint (the v1 MAX_PASS_ITERS trap fired — correct behavior for v1).
Fix (craft.ts): one simultaneous rules-2/3/5 iteration is a pure
function of the grid state (rule 5's skip set is call-local), so a
post-iteration state equal to ANY previously seen state, while
activity continues, is PROOF of divergence. `craftClip` fingerprints
the grids per iteration; on the first repeat it switches rule 2 to a
**sequential form** (`rule2Sequential`: row-major scan, apply the
FIRST firing change computed from the current grid, restart the scan;
stop on a clean scan; cap MAX_SEQ_CHANGES = 4096, trap past it) for
the remainder of the pass. Sequential update settles mutual-donor
pairs (the scan-first member adopts its partner's key, the partner
then shares a (role, tone) neighbor and stops being an island), and
its fixpoint is a genuine rule-2 fixpoint, so idempotence holds — the
second craft pass converges with zero work and never re-enters the
breaker (CI-tested). Inertness is BY CONSTRUCTION (the trigger
condition "repeated state with activity" is exactly "would have
trapped") and PROVEN by the §4.4.7 sweep: all 2000 non-trapped anchor
entries byte-identical, seed 1132 gains output where none existed.
1132's v2 output is golden-pinned (sheet RGBA sha256
`4701843b52713b6739f7c88b097cad4fc1cd800a112442bce932829ddd2df02d`,
JSON sha256
`545ca06da559760114481b75cd7314fc789846b3f61809711ea5c9f79d402e89`).
The trap itself is NOT weakened: convergence failures that are not
proven cycles still trap at MAX_PASS_ITERS.

**§4.4.6 One-shot flicker gates (the §4.2 pin).** Calibrated on the v2
production renderer, seeds 0..199 × 4 directions = 800 cells per clip,
consecutive pairs only (attack 2400 pairs, hurt 800, death 2400), no
INF anywhere; death's 800 held f2→f3 pairs score exactly 0.0 (zero
changed pixels at zero motion — the zero-motion convention). Gates are
the tightest integers with ≥ 1.25× margin over the observed max and
are wired into CI beside the walk gate (walk 32.0 and ungated idle
unchanged):

| clip | pairs | mean | p50 | p95 | p99 | max | gate | margin |
|------|-------|------|-----|-----|-----|-----|------|--------|
| attack | 2400 | 5.86 | 5.32 | 11.04 | 12.80 | 14.6730 | **19.0** | 1.295× |
| hurt | 800 | 6.43 | 6.35 | 8.48 | 9.66 | 10.8359 | **14.0** | 1.292× |
| death | 2400 | 3.72 | 3.31 | 10.19 | 14.25 | 19.2914 | **25.0** | 1.296× |

Integer-bucket histograms (floor(score): count): attack {0: 100,
1: 73, 2: 194, 3: 331, 4: 404, 5: 260, 6: 192, 7: 222, 8: 243,
9: 149, 10: 109, 11: 63, 12: 41, 13: 13, 14: 6}; hurt {3: 7, 4: 56,
5: 236, 6: 273, 7: 164, 8: 47, 9: 15, 10: 2}; death {0: 801, 1: 61,
2: 248, 3: 280, 4: 208, 5: 206, 6: 172, 7: 133, 8: 95, 9: 60, 10: 45,
11: 25, 12: 24, 13: 16, 14: 9, 15: 9, 16: 3, 17: 1, 18: 3, 19: 1}.

**§4.4.6 U3 addendum — levitant gate evidence + the per-(plan, clip)
gate tables (sweep RUN 2026-07-15).** Same method on the levitant
corpus: seeds 0..199 levitant-forced × 4 directions = 800 cells per
clip, no INF anywhere; death's 800 held f2→f3 pairs (one per cell; 2400
total death pairs measured) all score exactly 0.0. The levitant's one-chain body mass (orb + eye stack + horns snap
as one assembly dominating the 11-slab silhouette) yields many changed
pixels per unit motion energy on low-motion one-shot easing frames —
the a-priori hot spot the unit spec recorded, plus the same
gait_freq-2-family low-amp walk cells the M1 recalibration priced in.
The levitant attack max (68.93) sits 3.6× past the quadruped attack
gate (4.7× the quadruped's own observed attack max of 14.67): rather
than raise the shared gates to cross-plan maxima (which
would let a quadruped attack regression 4.6× past its own calibrated
ceiling pass silently), gates become **per-(plan, clip) tables**
(§4.2): each plan calibrated on its own histogram, the U2 global
values restated verbatim as the quadruped row. The levitant row, from
this sweep's maxima (tightest integers with ≥ 1.25× margin, machine-
verified):

| clip | pairs | mean | p50 | p95 | p99 | max | gate | margin |
|------|-------|------|-----|-----|-----|-----|------|--------|
| walk | 3200 | 3.75 | 3.16 | 10.01 | 14.12 | 17.2966 | **22.0** | 1.272× |
| attack | 2400 | 6.95 | 6.19 | 14.84 | 25.38 | 68.9279 | **87.0** | 1.262× |
| hurt | 800 | 7.69 | 6.78 | 12.69 | 14.86 | 17.2825 | **22.0** | 1.273× |
| death | 2400 | 3.46 | 3.82 | 8.15 | 10.46 | 14.9359 | **19.0** | 1.272× |

Every U2 quadruped verdict is untouched (its row is a restatement,
CI-asserted by the unchanged quadruped flicker suite); every levitant
sweep cell sits under its row by construction. Integer-bucket histograms
(floor(score): count): walk {0: 827, 1: 452, 2: 267, 3: 327, 4: 273,
5: 265, 6: 205, 7: 185, 8: 135, 9: 103, 10: 65, 11: 29, 12: 22,
13: 11, 14: 14, 15: 16, 16: 3, 17: 1}; attack {0: 229, 1: 145, 2: 37,
3: 138, 4: 280, 5: 312, 6: 267, 7: 219, 8: 188, 9: 141, 10: 108,
11: 89, 12: 59, 13: 42, 14: 28, 15: 18, 16: 17, 17: 13, 18: 11,
19: 10, 20: 4, 21: 10, 22: 3, 23: 4, 24: 1, 25: 5, 26: 2, 27: 1,
29: 1, 30: 2, 31: 1, 34: 2, 35: 1, 37: 3, 38: 1, 40: 2, 46: 3, 48: 1,
53: 1, 68: 1}; hurt {3: 4, 4: 104, 5: 152, 6: 171, 7: 73, 8: 61,
9: 58, 10: 64, 11: 43, 12: 40, 13: 18, 14: 5, 15: 5, 16: 1, 17: 1};
death {0: 804, 1: 8, 2: 151, 3: 292, 4: 386, 5: 311, 6: 189, 7: 122,
8: 72, 9: 31, 10: 15, 11: 6, 12: 7, 13: 1, 14: 5}. The attack maximum
(68.93, seed 187 down f2→f3) is the easing-frame family: a sub-pixel
continuous body motion that snaps to a whole-pixel chain jump moves
the entire orb silhouette boundary at near-zero energy. CI gates the
scaled levitant corpus (defaults + seeds 0..9, all clips, all
directions — see the §2.3.1 suite-time accounting) beside the
quadruped suite.

**U3 close-out recalibration (full 0..1999 sweep, RUN 2026-07-15).**
The 200-seed calibration undershot the 2000-seed tail — the same
lesson as M1's 12→32 recalibration, one scale up: 8000 cells per clip
(0 export errors, 0 INF, death held pairs exactly 0.0, pupil-visible
8000/8000 down-view walk frames) put six cells over the 200-seed
gates: walk seeds 519/down, 780/left (max 37.3744, pair 0), 1041/left,
1911/left (32.1886); attack seeds 361/down, 1101/down (max 114.9282,
pair 2). All six were rendered and judged by eye at close-out: the
walk cells are the near-frozen hover_freq/flap_ratio-2 family (calm
hover, ~zero motion energy denominator), the attack cells whole-body
1-px settles on the f2→f3 easing pair — metric artifacts of the
one-chain mass, no visible churn (the seed-1101 attack reads cleanly).
Gates recalibrated on the full-sweep maxima, same tightest-integer
≥ 1.25× rule: **walk 22 → 47** (1.257×), **attack 87 → 144** (1.253×);
hurt (max 17.2825) and death (max 16.1387) hold their 200-seed pins at
2000-seed scale (death's margin vs the 2000-seed max is 1.177×,
recorded honestly — the pin stands, the gate only loosens on
evidence). The 200-seed table above stands as the calibration record;
this paragraph is the shipped-gate authority.

**§4.4.7 Anchor evidence (the §4.3 law, discharged for U2).** Baseline:
from the pristine committed v1 build (HEAD 510e0df), for the
all-defaults genome + sampled seeds 0..1999 (2001 entries), sha256 of
(a) the raw RGBA sheet buffer and (b) the canonical JSON of the
{clips, frames, hitboxes, palette} subset. Post-implementation: the v2
tree's (a′) first 256 sheet rows and (b′) the same subset restricted to
frames[0..32)/clips.walk+idle/hitboxes[0..32)/palette. Result:
**2000/2000 non-error entries equal on both anchors; the single
baseline error entry (seed 1132, the craft trap) renders under v2**
(§4.4.5). Evidence fingerprints (sha256 over the newline-joined hash
values sorted by key, UTF-8; error entries carry their ERROR string):

```
v1 sheet-hash fingerprint  34d443725f21e3802dae8324a3360af37e3993afcb12795764d209e90cd9d580
v1 subset fingerprint      1c5e7f98397936315fc685a9765505d09ac40faa22ba0effab2c882e504f4242
v2 sheet-hash fingerprint  7a6e021ae6efca17210f633ae6c9158fb637589d0e7497d036f4f3a8caf1a976
v2 subset fingerprint      8b76e34c1d7199122c7d29993d3d1bd69300170ff2cafe1c4dd0c7d660fc5343
```

(The v1/v2 fingerprints differ only through the 1132 entry.) The
PERMANENT CI anchor test covers {defaults, seeds 0, 1, 7, 40, 1142}
against committed v1 fixture files (`tests/goldens/<name>.v1.sheet.png`
+ `.v1.json`; the defaults pair is the original M1 golden, renamed —
its sheet PNG sha256 is still
`efd38af16fb8b1b1e3c8c9bbec17c77a453f27256684b13fc1461d65bfaaac84`).
The v2 defaults golden re-pins beside them
(`tests/goldens/defaults.sheet.png` + `.json`):

```
v2 sheet PNG  sha256 9fa3db255cd622318e2a0a0f49e16fcbb1e6a8d47bf7e7e94ac8f6a9d3ac57a4
v2 sheet RGBA sha256 1f9c569b7054a625bd44fa0c1e0b200080ebd46fe190e508ab5ef3e21e4fa346
v2 JSON       sha256 94abf46c766dc1426380b434fefefe98c34157202de6df4f3f34374e902c9748
```

One sampler consequence, recorded honestly: `sampleGenome` draws every
registry locus from its own path-keyed stream, so sampled genomes now
carry a locus-35 value and their DNA strings GREW — the anchor law
covers pixels and the v1 metadata subset, not the `genome` field.
Defaults-tape genomes ("AQ" etc.) are unaffected.

**§4.4.8 Growth cache.** `poseQuadruped` memoizes `growQuadruped` per
genome object identity (WeakMap). Byte-inert by purity (growth is a
pure function of the frozen genome); the 72-frame set grows the graph
once instead of once per pose sample.

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
| U2 | Clip set §4: envelopes, anticipation locus, 72-frame set, 128×640 sheet, flash flag, one-shot flicker policy + recalibrated gates, GENERATOR_VERSION 2, M1 anchors, goldens re-pinned | §4.3 anchors; flicker histogram recorded; goldens byte-identical twice; CI green both platforms |
| U3 | Levitant: registry subtree + defaults from watcher, gait template, shadow policy, death envelope, semantic map table — **CLOSED 2026-07-15 (§2.3.1)**: goldens ritual-pinned + CI-proven on both platforms; 2000-seed close-out sweep (0 export errors, 0 INF, pupil 8000/8000, gates recalibrated walk 47 / attack 144 on the full histogram tail); anchors green; map integrity CI-tested; mini-sheet owner-ACCEPTED, zero flagged seeds | goldens; property sweeps; anchor tests still green; mini-sheet (seeds 0..24, levitant-forced) owner-reviewed; map integrity test |
| U4 | Amorphous: metaball raster path (march constants + error bound), blob chain snapping, grammar rules (F8/F9 authoring), death envelope; craft + flicker coverage on amorphous corpus | craft property suite incl. idempotence on the pinned amorphous corpus; mini-sheet review; goldens; anchors |
| U5 | Defenses §5 (clearance retries, self-check + bands) + tags/FFF §6 | 2000-genome/plan zero-degenerate sweep; band + weight tables machine-verified and amended here |
| U6 | Acceptance instrument §7: pinned 100-sheet, CI hash guard, review delivery | owner review: ≥80% would-ship + plan-mix distinctness → declare M2 |

Risk watch while building: R2 (oatmeal — the whole point of U5/U6),
R8 parks with breeding at M5, R4/R5/R6 remain standing law (idempotence
tests, stream keying, two-platform goldens run on every unit).
