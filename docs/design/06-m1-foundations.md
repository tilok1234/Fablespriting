# Design 06 — M1 foundations: locus schema, wire format, deterministic math

This is the implementation contract for M1's first production line
(TypeScript, per decisions D1–D3 in `ASSESSMENT.md` §5). Design 01 defines
*what* the genome must guarantee; its §5 deferred the concrete formats to M1
start. This document decides them. The bar throughout: **a second
implementer, in another language, must produce byte-identical output from
this spec alone.** Everything here is normative unless marked informative;
per design 01 requirement 1 and the standing practices in `ROADMAP.md`,
violations are review-blockers because they cannot be retrofitted.

Notation: `fp` means 16.16 fixed point (§5). **Every decimal constant in
this document denotes the fp raw value `RHE(d · 65536)`** — round half to
even of the exact decimal — so "2.1" always means raw 137626, unambiguously.
Phases and angles that drive oscillators are in **turns** (1.0 = full
cycle), not radians; hues are in degrees.

## 0. Definitions & conventions

Small normative glue used throughout:

- **wrap360(x)** — mathematical modulo into [0, 360):
  `x − 360·floor(x/360)` (raw: reduce mod 23592960 to a non-negative
  result). Negative inputs wrap **up**: wrap360(13.0 − 84.0) = 289.0 —
  consistent with the normative outline hue of §1.3.
- **clamp(x, lo, hi)** = `min(max(x, lo), hi)`.
- **Domain bounds are inclusive in RAW units**: a domain written
  [lo, hi] admits every raw from `RHE(lo·2^16)` to `RHE(hi·2^16)`. For a
  half-open authored domain like [0, 360), the pinned rule is hi_raw =
  the largest raw value inside the domain: `palette.base_hue`'s hi_raw
  is 23592959 (= 360·2^16 − 1).
- **Default draw name.** Wherever a sampler paragraph does not name a
  draw, the draw name is `sample` (§4).
- **Adler-32 scope (§6).** The Adler-32 that closes the PNG zlib stream
  runs over the full uncompressed stream **including each scanline's
  leading filter byte** — exactly what the 1×1 vector in §6 implies (its
  adler 0x00050001 covers all 5 stream bytes, filter byte included).

## 1. The M1 quadruped locus schema

One plan (quadruped), one hardcoded part-graph template (R10: no grammar
before M1 exits), full pipeline: genome → part graph → skeleton/gait →
slabs → projection → craft v1 → PNG+JSON, 32×32, idle+walk, 4 directions.
The schema below is the complete v1 locus list. Two rules governed it:

- **The all-defaults genome reproduces Spike S1's wolf.** Every default is
  pulled from `spikes/spike01_slab_projection.py::wolf()`; §1.2 documents
  the mapping. "Reproduces" is approximate, not byte-equal to the spike
  PNGs: M1 re-derives the same geometry in fixed point (the spike used
  floats) and generates the palette from loci (the spike hardcoded ramps).
  M1's own golden tests then pin the production bytes exactly (D3).
- **No speculative loci.** Every locus is consumed by the M1 pipeline.
  Deferred loci (attack `anticipation`, ornament kinds, remap gains) are
  *not* reserved — the wire format makes later additions free (§3.5).

### 1.1 Locus table (canonical registry, version 1)

The **id** column is the canonical locus numbering used by serialization
(§3): append-only per version-table, never renumbered, never reused.
`meta.version` is the tape's version prefix, not a field, so it has no id.

| id | path | type / domain | default (raw) |
|----|------|---------------|---------------|
| 0 | `meta.plan` | enum { quadruped = 0 } | 0 |
| 1 | `meta.seed` | u64 [0, 2^64) | 0 |
| 2 | `meta.trait_tags` | set of 0–2 tags from { chitin=0, fleshy=1, spectral=2, mechanical=3, verdant=4 } | empty |
| 3 | `palette.base_hue` | fp deg [0, 360) | 13.0 (851968) |
| 4 | `palette.hue_shift` | fp deg [−45, 45] | 18.0 (1179648) |
| 5 | `palette.contrast` | fp [0.10, 0.35] | 0.215 (14090) |
| 6 | `palette.ramp_len` | int {3, 4, 5} | 4 |
| 7 | `anim.quadruped.gait_freq` | int {1, 2} | 1 |
| 8 | `anim.quadruped.bob_amp` | fp px [0, 2] | 0.5 (32768) |
| 9 | `anim.quadruped.leg_swing_amp` | fp px [0, 4] | 2.1 (137626) |
| 10 | `anim.quadruped.leg_lift_amp` | fp px [0, 4] | 1.5 (98304) |
| 11 | `anim.quadruped.tail_lag` | fp turns [0, 0.5] | 0.9 rad = 0.1432394 turns (9387) |
| 12 | `anim.quadruped.tail_amp` | fp px [0, 4] | 1.4 (91750) |
| 13 | `body.core.length` | fp px [4, 12] | 7.6 (498074) |
| 14 | `body.core.girth` | fp px [2, 6] | 3.9 (255590) |
| 15 | `body.core.depth` | fp px [2, 6] | 3.4 (222822) |
| 16 | `body.head.scale` | fp [0.6, 1.6] | 1.0 (65536) |
| 17 | `body.head.snout_len` | fp px [1, 4] | 2.2 (144179) |
| 18 | `body.head.ear_size` | fp [0.5, 1.8] | 1.0 (65536) |
| 19 | `body.head.eye_size` | fp [0.6, 1.5] | 1.0 (65536) |
| 20 | `body.head.eye_offset` | fp px [1.0, 2.4] | 1.6 (104858) |
| 21 | `body.leg[FL].length` | fp px [2.4, 5] | 3.1 (203162) |
| 22 | `body.leg[FL].girth` | fp px [0.8, 2] | 1.15 (75366) |
| 23 | `body.leg[FL].phase_group` | enum {0, 1} | 0 |
| 24 | `body.leg[FR].length` | as id 21 | 3.1 |
| 25 | `body.leg[FR].girth` | as id 22 | 1.15 |
| 26 | `body.leg[FR].phase_group` | enum {0, 1} | 1 |
| 27 | `body.leg[BL].length` | as id 21 | 3.1 |
| 28 | `body.leg[BL].girth` | as id 22 | 1.15 |
| 29 | `body.leg[BL].phase_group` | enum {0, 1} | 1 |
| 30 | `body.leg[BR].length` | as id 21 | 3.1 |
| 31 | `body.leg[BR].girth` | as id 22 | 1.15 |
| 32 | `body.leg[BR].phase_group` | enum {0, 1} | 0 |
| 33 | `body.tail.length` | fp px [1.5, 6] | 3.2 (209715) |
| 34 | `body.tail.girth` | fp px [0.6, 2] | 1.1 (72090) |

The default phase groups encode the trot: diagonal pairs {FL, BR} = group 0
(offset 0.0 turns), {FR, BL} = group 1 (offset 0.5 turns) — the spike's
`(0, π, π, 0)` hip offsets.

Trims and extensions relative to the sketch in design 01 §2, with reasons:

- **`anim` is plan-scoped** (`anim.quadruped.*`): design 01 §5's "leaning
  yes" is adopted. A hover frequency is meaningless to a quadruped;
  plan-scoping keeps cross-plan homology honest. The cost is named, not
  ignored: path-aligned crossover (design 01 §3) matches zero `anim`
  loci across plans, so the gait-temperament transfer design 01 §3
  promises (wolf × levitant) cannot ride on raw path identity. Pinned
  resolution: cross-plan `anim` transfer happens through a
  **crossover-time semantic map** — when the second plan lands (M2), it
  ships a per-plan-pair leaf correspondence table (e.g.
  `quadruped.gait_freq ↔ levitant.hover_freq`) that crossover consults
  for `anim.*` only. The map lives beside the registry table, is an
  additive change, and never touches paths, stream keys, or wire bytes —
  nothing pinned in this document moves. Design 01 §3's promise is
  thereby deferred to M2 with its mechanism fixed, not narrowed.
- **`anticipation` is dropped.** It is consumed only by the attack
  envelope (design 03 §2), and M1 ships idle+walk only. Adding it at M2 is
  an additive registry append — no version bump, no reserved slot needed.
- **`body.core.taper` → `body.core.depth`.** Nothing in the wolf template
  consumes a taper; the third core extent (vertical) does need a locus.
- **Tail lag lives in `anim`, not `body.tail`.** It is a phase, not
  geometry; one home per locus (design 01's tree sketch had it ambiguous).
- **`body.ornaments` gets no v1 ids.** The wolf has none. The *path
  grammar* for ornaments is specified in §2 so future ids attach to stable
  paths, but allocating ids for unconsumed loci is exactly the speculation
  this schema bans.
- **Ears/eyes carry no per-side loci.** They are unbroken `mirror`
  symmetry groups (design 02 §1): one gene places both members. Legs *do*
  get per-socket loci because gait phase and future asymmetry
  (aberrations, injury variants) are per-leg by nature.
- **`meta.trait_tags` is carried but gates nothing until M2.** Its M1
  consumer is the export metadata (design 05 §2: a sheet is reproducible
  from its own metadata, tags included). It is in the schema now so that
  M2's tag-gating changes no wire bytes for already-issued genomes.

### 1.2 The wolf template (locus → slab mapping)

The hardcoded M1 part graph, i.e. the production transcription of
`wolf()`. All arithmetic is fp (§5); `b` = bob, `sin` = `sin_fp` (§5.3);
`g` = `gait_freq`; multiplications locus×constant are `fp_mul`. Pinned
template constants appear inline as decimals (raw = `RHE(d·65536)`).
Symmetry: `±` rows are mirror pairs placed by one locus.

| part (kind) | center (x, y, z) | half-extents (x, y, z) | material role |
|------|------------------|------------------------|---------------|
| core | (0, −0.5, CZ + b) | (girth, length, depth) | hide |
| core underside | (0, UY, UZ + b) | (0.769·girth, 0.737·length, 0.647·depth) | underside |
| head | H = (0, HY, HZ + b) | scale·(3.0, 3.4, 3.0) | hide |
| snout | H + scale·(0, 3.3, −1.2) | (scale·1.6, snout_len, scale·1.5) | underside |
| ears (±) | H + scale·(±2.0, −1.1, 2.8) | ear_size·(0.9, 1.0, 1.7) | hide |
| eyes (±) | H + (±scale·eye_offset, EY, scale·0.6) | (EHX, EHY, EHZ) | focal |
| legs ×4 | (hip_x, hip_y + dy_i, length_i + asr(dz_i,1) + asr(b,1)) | (girth_i, 1.5, length_i) | hide |
| tail | (wag, TY, TZ + b) | (tail.girth, tail.length, tail.girth) | hide |

Snout cross-extents scale with the head, and the eye row's EY/EHX/
EHY/EHZ are derived values — see **eye visibility coupling** below; at
the all-default loci both rows reduce exactly to the original wolf
constants (1.6, ·, 1.5) and (2.6 forward, eye_size·(0.8, 0.7, 0.8)).

**Slab-list order is normative** (part-tag ids index it): core, core
underside, head, snout, ear −x, ear +x, eye −x, eye +x, legs FL, FR,
BL, BR, tail — 13 slabs; each mirror pair emits its −x member first,
matching the FL-before-FR socket convention. (The S1 spike interleaved
ears/eyes per side; the table's row order above is the contract.)

Hips: FL = (−hip_x, fore hip_y), FR = (+hip_x, fore hip_y),
BL = (−hip_x, hind hip_y), BR = (+hip_x, hind hip_y) — derived anchors
per the coupling table below; at all-default dims they are exactly the
spike's (±2.6, 4.6) / (±2.6, −5.2). Legs stand on the ground plane: the
slab spans z ∈ [0, 2·length] at rest. `asr` = arithmetic shift right
(§5.1); child offsets of the head scale with `head.scale` so grown heads
keep their features attached (the lesson of S4-F18: scale-only ops can't
fix placement, so placement must follow scale).

**Anchor coupling.** `CZ, UY, UZ, HY, HZ, TY, TZ, hip_x, hip_y` are
**derived anchors, not constants**. The spike pinned every attachment
anchor as an absolute number; that is the degenerate-anchor trap the
moment a core dimension leaves its default — S4-F18's lesson one level
up: scaling a part cannot fix where it attaches, so the attachment
itself must track the dimension that carries it. Every anchor that must
track a sampled core dimension is pinned as the wolf constant plus a
proportional correction:

```
anchor(dim) = C + fp_mul(σ, dim − D)
```

with `C` the wolf constant (raw), `D` the tracked dimension's registry
default (raw), and `σ` a pinned 16.16 slope — mathematically the line
`σ·dim` through the wolf point (D, C). The delta evaluation is
load-bearing: `fp_mul(σ, 0) = 0`, so **at the all-default core dims
every derived anchor equals the original wolf constant exactly in raw
16.16** (machine-verified; no per-anchor adjustments needed). The direct
form `fp_mul(σ, dim)` cannot honor that requirement: its output moves in
steps of D/2^16 (≈ 7.6 raw for `core.length`, ≈ 3.4 for `core.depth`),
and no ±1-ulp slope adjustment lands on the wolf constants
(machine-verified: best achievable error is 1–3 raw for every anchor
below), which is why the delta form is pinned.

| anchor | C (raw) | tracks (D raw) | σ (raw) | slope |
|--------|---------|----------------|---------|-------|
| HY head center y | 8.3 (543949) | core.length (498074) | 71572 | 8.3/7.6 |
| HZ head center z | 9.8 (642253) | core.depth (222822) | 107942 | 1 + 2.2/3.4 |
| hip_y fore (FL, FR) | 4.6 (301466) | core.length | 39667 | 4.6/7.6 |
| hip_y hind (BL, BR) | −5.2 (−340787) | core.length | −44840 | −5.2/7.6 |
| hip_x (± per socket) | 2.6 (170394) | core.girth (255590) | 43691 | 2.6/3.9 |
| CZ core center z | 7.6 (498074) | core.depth | 65536 | 1 |
| UY underside center y | 1.5 (98304) | core.length | 17246 | 2.0/7.6 |
| UZ underside center z | 5.9 (386662) | core.depth | 32768 | 1 − 1.7/3.4 |
| TY tail center y | −8.8 (−576717) | core.length | −65536 | −1 |
| TZ tail center z | 9.6 (629146) | core.depth | 104087 | 1 + 2.0/3.4 |

σ = RHE(slope·2^16). Slope derivations: HY and the hip_y rows are the
wolf ratios anchor/length; hip_x is ⅔·girth. CZ has slope 1 so the
**underside line** CZ − depth stays fixed at raw 275252 (≈ 4.2 px; it is
derived as 498074 − 222822 — one raw ulp above RHE(4.2·2^16) — not
pinned as a decimal): deeper bodies grow upward, and leg tops always
face the same target. UZ keeps the belly slab half a depth below the
core center; HZ and TZ keep head and tail at the wolf's
offset-per-depth above the core center, riding the body's vertical
mass. TY tracks the rear face −0.5 − length at the wolf's 0.7 px
overhang (a pure −8.8/7.6 ratio would outrun the rear by 1.4 px at
length 12 and leave a minimum-length tail attached by only 0.1 px). UY
is the underside slab's 2.0 offset from the core center (−0.5, itself a
constant) as a fraction of length; combined with the pinned
0.737·length half-extent this keeps the slab's front edge flush with
the core front to < 0.002 px across the whole length domain.

Connectedness at the domain extremes (machine-verified worst cases,
rest pose):

- **Head overlaps the body front.** Worst y-overlap 0.435 px at
  length 12, head.scale 0.6 (head rear edge 11.07 vs core front 11.5);
  worst z-overlap 2.51 px at depth 2, scale 0.6.
- **Hips stay inside the body.** Worst footprint value
  (hip_x/girth)² + ((hip_y + 0.5)/length)² = 0.978 < 1, at length 4,
  fore hips — independent of girth because hip_x/girth ≈ ⅔ is constant.
- **Legs reach the body underside.** Leg top = 2·length ≥ 4.8 px against
  the fixed underside line ≈ 4.2 px. The binding pose is the idle bob
  peak: at bob_amp = 2 the body rises b = 1 px while legs rise
  asr(b, 1) = 0.5 px, costing 0.5 px of overlap (walk frames cost
  nothing: at K = 4, sin(2·g·φ_k) = 0 exactly, so the rendered walk bob
  is identically zero). **`body.leg[*].length` is therefore narrowed
  from [1.8, 5] to [2.4, 5]** (lo raw 157286, §1.1): below 2.35 the
  shortest legs detach from the underside at the idle peak, while 2.4
  keeps ≈ 0.1 px of contact (exactly 6552 raw = 0.099976 px at the
  worst case) in every rendered frame of both clips for every genome. The default (3.1) is unchanged, and the worst-case tape
  size (§3.5) is unaffected — the hi extreme dominates that locus's
  payload either way.
- **Tail stays attached.** Its front edge penetrates the core's rear
  face by tail.length − 0.7 ≥ 0.8 px for every length; TZ sits at a
  constant relative height (CZ + 0.588·depth), inside the core's
  z-range at every depth.

No other domain produces disconnection at its extremes. Raw defaults
are unchanged by the coupling, so the §3.4 worked example still stands
(its leg value 3.6 lies inside the narrowed domain).

**Eye visibility coupling.** Rasterization exposed a failure family the
anchor coupling doesn't cover: eyes are the template's only
sub-pixel-scale feature, and merely *placing* them left 323 of the
first 2000 sampled genomes eyeless in the down view — 72 buried (the
eye's front face never leaves the head ellipsoid), the rest occluded by
the snout on small heads or lost to sub-pixel straddling (an eye disc
under ~1 px splits its ≤ 16 supersamples across 2–4 pixels and loses
every §1.2 majority vote to the single-tone head behind it, however far
it protrudes — F18 again: one lever cannot fix a different-dimensional
failure). Three derived guarantees repair this, all delta-form — at the
all-default loci the extent floors equal the genomic raws exactly and
the EY max takes the plain wolf branch, so the default wolf is
byte-identical, pinned golden included (machine-verified):

```
EHX = max(fp_mul(eye_size, 52429), 52429)   half-extents floored at the
EHY = max(fp_mul(eye_size, 45875), 45875)   default wolf's raws — no
EHZ = max(fp_mul(eye_size, 52429), 52429)   rendered eye smaller than
                                            eye_size 1.0 · (0.8, 0.7, 0.8)
Xn     = fp_div(eye_offset, 196608)         eye column in the head frame —
                                            head scale cancels exactly
inside = fp_sub(62915, fp_mul(Xn, Xn))      62915 = RHE(0.96·2^16); 0.96 =
                                            1 − (0.6/3.0)²; also identically
                                            FP_ONE − fp_mul(13107, 13107)
ySurf  = fp_mul(fp_mul(scale, 222822), fp_sqrt(inside))
EY     = max(fp_mul(scale, 170394),
             fp_sub(ySurf, fp_mul(19661, EHY)))
```

The step order is normative (floors first: the slack term uses the
FLOORED forward half-extent EHY). `inside` stays positive over the
whole domain (max Xn = 0.8 raw 52429 → inside = 20972 ≥ 0.32).

- **Protrusion floor** (buries): `ySurf` is the head surface's forward
  extent at the eye's own (x, z) column, so the EY floor guarantees
  protrusion `EY + EHY − ySurf ≥ 0.7·EHY` (slack raw 19661 =
  RHE(0.3·2^16)). κ = 0.7 is the largest round ratio below the default
  wolf's own ≈ 0.7221 (= 33128/45875 in raws): the default genome takes
  the plain branch by 1016 raw (170394 vs floor 169378,
  machine-verified); any κ ≥ 0.7222 would lift the default and break
  the golden.
- **Footprint floor** (straddles): a 0.8 px half-extent disc claims
  ≥ 8 of a pixel's 16 samples in the worst straddle positions where the
  genomic minimum (0.48 px at eye_size 0.6) claims 3.
- **Snout cross-extent scaling** (occlusions): fixed (1.6, ·, 1.5)
  cross-extents on a scale-0.6 head are ~42% of head height (1.5/3.6)
  vs the authored 25% (1.5/6.0), ride up over the eye rows, and win
  every depth contest (the snout is nearer the camera). Scaling them
  with the head restores the authored proportion at every scale.

Vote-rule repairs were evaluated and are **rejected** — the default
wolf itself contains focal-tie pixels, so any §1.2 vote amendment
breaks all-default byte-identity somewhere: pooling focal samples
changes the default at walk φ = 0.25 down pixel (18, 21); focal
priority on count ties changes idle φ = 0.25 right pixel (26, 16).
The §1.2 vote is frozen.

Coupled result (empirical, seeds 0..1999, down, walk φ = 0): eyeless
323 → 1. The residual is seed 1142 (scale 1.297, eye_size 0.893,
eye_offset 1.480): its floored eye claims exactly 8 of 16 samples in
two pixels — a dead tie against the head's 8 — and the pinned
first-seen tie-break resolves both to the head (plus two 9 vs 7
near-misses); profile views render its eye. All three floors sit at
their maximum default-byte-identical values, so this residual is the
principled optimum for M1; it is pinned as a characterization in
tests/raster.test.ts and revisits with M2's template work (D4).

Oscillators, per frame k of K (M1 pins K = 4 for both clips, uniform
sampling and uniform durations per S2/F10; φ_k = k · 16384 raw turns —
exact):

```
walk:  b     = fp_mul(bob_amp,        sin(2·g·φ))
       dy_i  = fp_mul(leg_swing_amp,  sin(g·φ + G_i))            G_i ∈ {0, 32768}
       dz_i  = max(0, fp_mul(leg_lift_amp, sin(g·φ + G_i + 16384)))
       wag   = fp_mul(tail_amp,       sin(g·φ − tail_lag))
idle:  b     = fp_mul(asr(bob_amp,1), sin(φ));   dy_i = dz_i = 0
       wag   = fp_mul(asr(tail_amp,1), sin(φ − tail_lag))
```

This matches the spike exactly: walk bob `0.5·sin(2φ)`, idle bob
`0.25·sin(φ)` (idle amplitude = walk >> 1, a pipeline rule, not a locus),
leg swing `2.1·sin(φ+off)`, lift `max(0, 1.5·sin(φ+off+¼))`, tail
`1.4·sin(φ−0.9 rad)` walking and `0.7·…` idle. Projection, rasterization,
and craft are per designs 03/04 with the constants pinned here: TILT = 0.5
(D3), light direction raw (−29565, −36135, 45990) — the normalized
(−0.45, −0.55, 0.70) — coverage threshold 0.42 (27525) at 32×32 (S1/F4).

Rasterization frame constants, pinned for pixel-identical output (from
`spike01_slab_projection.py` lines 222–223): the frame anchor is
ox = size/2, oy = size·(26.5/32) — at 32×32, (ox, oy) = (16.0, 26.5),
raw (1048576, 1736704); oy is the ground line. Supersampling is an S×S
grid with S = 4: for output pixel (px, py), sample (ix, iy) is cast at
(px + (ix+0.5)/S − ox, py + (iy+0.5)/S − oy); the per-sample offsets
(ix+0.5)/S are the exact raws {8192, 24576, 40960, 57344}. Pinned scan
order: iy outer ascending, ix inner ascending. A pixel is opaque iff
hits/S² ≥ the coverage threshold; its (material, tone) key is the one
with the most contributing samples, and **ties on vote count are broken
in favor of the (material, tone) key whose first contributing sample
occurs earliest in the pinned scan order**. The tie-break was previously
unspecified even by the spike — its Python dict ordering happens to
implement exactly this first-seen-wins rule — and it matches the spike
renders at defaults.

### 1.3 Palette derivation

Three role ramps: **hide**, **underside**, **focal**. The hide and
underside ramps are `ramp_len` colors: slot 0 = outline (consumed by
selout), slots 1..ramp_len−1 = body tones dark→light. The focal ramp is
**always 4 entries**, independent of `palette.ramp_len` (rule below).
Colors are built in fp HSV and converted with the exact integer
conversion below.

Tone slot t (0-based over the `n = ramp_len − 1` body tones), with
half-step offset `oh = 2t − (n−1)`:

```
H = wrap360(hue_base + asr(oh · hue_shift, 1))       # oh is a plain int
S = S_role
V = clamp(V_role + asr(oh · contrast, 1), 0, 65536)
```

The half-step arithmetic is pinned exactly: `oh = 2t − (n−1)` is a
**plain integer**, never a raw; `oh · hue_shift` and `oh · contrast` are
plain integer products of that small int with the locus raw (int32-safe
by domain: |oh| ≤ 3, so the worst magnitude is 3·2949120 = 8847360 —
machine-verified), then `asr(…, 1)` per §5.1 (floor, also for negative
products). `hue_base` sums are plain int32 adds performed **unwrapped**
(underside's `base_hue + hue_shift` may leave [0, 360) in either
direction); wrapping happens exactly once, at H, via §0's wrap360 —
mathematical mod 360.0, i.e. mod raw 23592960, result in
[0, 23592960), negative inputs wrapping up (the `base_hue` locus hi is
raw 23592959, the largest in-domain raw; the worst unwrapped H input,
23592959 + 2949120 + asr(3·2949120, 1), stays far inside int32 —
machine-verified). `H div 60.0` / `H mod 60.0` below are integer floor
division and mathematical mod of the wrapped H raw by raw 3932160
(= 60.0); `byte(c) = RHE(c·255 / 65536)` is the exact integer rounding
`rheDiv(c·255, 65536)`.

Pinned role constants: hide `hue_base = base_hue`, S = 0.41, V = 0.58;
underside `hue_base = base_hue + hue_shift`, S = 0.30, V = 0.77. The
outline (shared by hide and underside, per design 04 §5) is
`H = wrap360(base_hue − 84.0)`, S = 0.37, V = 0.18. Per the §0 notation
rule these decimals are the raws S/V hide (26870, 38011), underside
(19661, 50463), outline (24248, 11796), offset 84.0 = 5505024 — all
machine-verified `RHE(d·2^16)`. The **focal** ramp is
the pinned constant table [(20,14,24), (20,14,24), (30,22,34), (52,44,58)]
(the spike's `eye` ramp), independent of palette loci and merge-protected
(F16).

HSV → RGB8, all fp ops per §5 (`H` already wrapped to [0, 360)):

```
sector = H div 60.0                       # integer 0..5 (floor division)
f = fp_div(H mod 60.0, 60.0)
p = fp_mul(V, 65536 − S)
q = fp_mul(V, 65536 − fp_mul(S, f))
t = fp_mul(V, 65536 − fp_mul(S, 65536 − f))
(r,g,b) = [(V,t,p),(q,V,p),(p,V,t),(p,q,V),(t,p,V),(V,p,q)][sector]
byte(c) = RHE(c · 255 / 65536)
```

Normative output for the all-defaults genome (ramp_len = 4), which any
implementation must reproduce exactly — informally compare the spike's
hardcoded wolf ramps (informative), which it approximates:

| ramp | slot 0 (outline) | dark | mid | light |
|------|------------------|------|-----|-------|
| hide | (43, 29, 46) | (93, 55, 58) | (148, 100, 87) | (203, 163, 120) |
| — spike `fur` | (43, 29, 46) | (94, 60, 64) | (148, 98, 84) | (205, 158, 115) |
| underside | (43, 29, 46) | (142, 108, 99) | (196, 168, 137) | (251, 237, 176) |
| — spike `belly` | (43, 29, 46) | (140, 110, 96) | (196, 168, 138) | (238, 218, 183) |

The rasterizer's shading dot product `d` (unit normal · LIGHT, fp)
quantizes to body tones by pinned per-ramp_len thresholds (rasterizer tone
t maps to ramp slot t+1). Hide and underside pixels use the row selected
by `palette.ramp_len`; **focal pixels always use the ramp_len = 4 row**,
whatever the genome says — the focal table has exactly slots 0..3, so
focal tone t ∈ {0, 1, 2} maps to focal slots 1..3 for every genome. A
ramp_len = 5 genome must not push an eye pixel to a nonexistent focal
slot 4, and a ramp_len = 3 genome must not leave two implementations
guessing which row eyes follow:

| ramp_len | thresholds (dark ← → light) |
|----------|------------------------------|
| 3 | light iff d > 0.025 |
| 4 | mid iff d > −0.25, light iff d > 0.30 (the S1 values) |
| 5 | d > −0.35, d > 0.15, d > 0.55 |

**Application: crafted pixel → RGBA8 (normative).** The palette layer
consumes §1.5 craft pixels; only `(role, tone, edge)` select the color.
A transparent cell emits exactly RGBA (0, 0, 0, 0) — the §6 artifact-1
rule, no hidden color under zero alpha; every opaque cell emits
alpha 255. The pixel's ramp is its role's ramp — hide and underside the
derived `ramp_len`-entry ramps above, focal **always** the pinned
4-entry focal table (edge = 1 on a focal pixel takes the focal table's
own slot 0: the focal ramp carries its own outline color, never the
shared hide/underside outline). The slot:

```
edge = 1  →  slot 0                    (outline)
edge = 2  →  slot tone                 (one darker than body slot tone+1)
edge = 0  →  slot tone + 1             (body tone)
```

**edge = 2 may reach slot 0** — there is no floor at slot 1, for focal
exactly as for hide/underside. Rationale: slot 0 is not a foreign
color — design 04 §5 pins it as the ramp's shared *darkest tone* used
as outline — so design 04 §4 rule 4's "one-tone-darker edge" applied to
the darkest body tone (rasterizer tone 0, slot 1) lands on slot 0
naturally; flooring at slot 1 would render edge = 2 identically to the
body tone and erase the interior-boundary cue exactly where the form
is darkest. Evidence: Spike S3's `colorize()`
(`spikes/spike03_craft_clip.py`) implements exactly `slot = tone` with
no floor, uniformly for every material including the focal `eye` ramp,
and the accepted S3 renders were produced with it. For focal the
reading is additionally safe by construction: focal slots 0 and 1 are
the same color (20, 14, 24) in the pinned table, so a focal edge = 2 at
tone 0 is byte-identical to its body color.

The pinned output form is the §6 artifact-1 buffer: `applyPalette`
returns the flat RGBA byte array — width·height·4 bytes, rows
top-to-bottom, pixels left-to-right, byte order R, G, B, A — chosen so
the buffer is byte-identical to what the §6 RGBA hash and the M1 PNG
encoder consume, with no intermediate reshaping.

A pixel whose tone lies outside its ramp's body-tone range
(tone > ramp_len − 2 for hide/underside, tone > 2 for focal) is a
grid/palette ramp mismatch: implementations trap (throw), never clamp
— **whatever the edge**. The tone-range form is deliberate: an edge = 2
pixel selects slot `tone`, which can land inside a too-short ramp and
silently mask a mismatch that the edge = 0 slot `tone + 1` would trap
on; validating the tone itself catches the mismatch on every edge
path.

### 1.4 Rasterization arithmetic (normative)

The §1.2 rasterization block pins the frame constants and the vote
tie-break; this section pins the fixed-point arithmetic itself — step
orders, the remaining tie rules, the per-pixel tags, and the golden
serialization — so a second implementer reproduces the tagged grid
bit-exactly from this document. All ops are the §5 fixed-point ops; the
input is the §1.2 slab list in its normative order, yawed for the facing
direction. Directions are quarter-turn CCW yaws of the creature about z —
down/left/up/right = 2/1/0/3 turns; each turn maps a slab center
(x, y) → (−y, x) and an odd turn count swaps the (x, y) half-extents, an
exact integer permutation/negation with no resampling error.

**Camera and ray/ellipsoid intersection (P1–P4, C1, R1, Q1–Q5).** The
fixed camera of design 04 §2: screen `sx = x`, `sy = −z − TILT·y`,
depth `= y` — smaller depth is closer to the camera, and the −TILT term
puts closer geometry lower in the sprite (invariant P1). For a yawed slab
with center (cx, cy, cz) and half-extents (hx, hy, hz), the entry depth
of the sample ray through (sx, sy) is the smaller root in y of the
ellipsoid quadratic, evaluated in the **ellipsoid-normalized frame**:
substituting X = (sx−cx)/hx, Y = (y−cy)/hy, Z = (z−cz)/hz with
z = −TILT·y − sy gives Z = Z0 + Zs·Y and X² + Y² + (Z0 + Zs·Y)² = 1,
whose discriminant factors as disc/4 = (1+Zs²)(1−X²) − Z0². This is
algebraically the spike's literal A/B/C quadratic over the reals, but the
A/B/C form is **not conformant**: its B² intermediate overflows int32 for
legal domain-extreme genomes, while every intermediate below stays inside
the 16.16 domain. The normative steps and their order (P-steps once per
slab; C1 once per sample column; R1 once per sample row; Q-steps once per
sample):

```
P1. tiltCy = fp_mul(TILT, cy)
P2. Zs     = fp_sub(0, fp_div(fp_mul(TILT, hy), hz))
P3. A      = fp_add(1.0, fp_mul(Zs, Zs))
P4. invA   = fp_div(1.0, A)
C1. X = fp_div(fp_sub(sx, cx), hx);  if |X| > 1.0 → miss in x;
    else oneMinusX2 = fp_sub(1.0, fp_mul(X, X))
R1. w  = fp_sub(fp_sub(fp_sub(0, tiltCy), sy), cz)
    Z0 = fp_div(w, hz);   Z0sq = fp_mul(Z0, Z0);   B0 = fp_mul(Z0, Zs)
Q1. Q = fp_sub(fp_mul(A, oneMinusX2), Z0sq)
Q2. if Q < 0 → miss  (disc < 0; Q = 0 is a tangent hit)
Q3. sqrtQ = fp_sqrt(Q)
Q4. Y = fp_mul(fp_sub(fp_sub(0, B0), sqrtQ), invA)     — the smaller
    root = the entry (camera-side) intersection
Q5. depth = fp_add(cy, fp_mul(hy, Y))
    hit z = fp_sub(fp_sub(0, fp_mul(TILT, depth)), sy)
    hit point p = (sx, depth, hit z)
```

C1's |X| > 1.0 miss test is exactly equivalent to oneMinusX2 < 0 —
fp_mul is monotone in |X| on integer raws (RHE(X²/2^16) > 2^16 ⟺
|X| > 2^16) — and it is **required, not an optimization**: it keeps both
C1's squaring and Q1's fp_mul inside int32 for arbitrarily distant sample
columns.

**Nearest-sample selection and the depth tie rule.** Per sample, slabs
are scanned in ascending slab-index order and the smallest entry depth
wins, compared with strict `<` — so on exactly equal entry-depth raws
**the lower slab index wins**.

**Surface tone (T1–T7).** The tone of a hit (design 04 §3): the ellipsoid
normal at the hit point p, normalized, dotted with the pinned light
direction L = raw (−29565, −36135, 45990), quantized by the §1.3
threshold table:

```
T1. invE2_i = fp_div(1.0, fp_mul(h_i, h_i))          (per slab, per axis i ∈ {x, y, z})
T2. n_i     = fp_mul(fp_sub(p_i, c_i), invE2_i)      ((p − c)/h² per axis)
T3. len     = fp_sqrt(fp_add(fp_add(fp_mul(nx,nx), fp_mul(ny,ny)), fp_mul(nz,nz)))
T4. invL    = len == 0 ? 1.0 : fp_div(1.0, len)      (zero guard: a degenerate
    normal is used unnormalized)
T5. u_i     = fp_mul(n_i, invL)
T6. d       = fp_add(fp_add(fp_mul(ux, Lx), fp_mul(uy, Ly)), fp_mul(uz, Lz))
T7. tone    = the number of row thresholds d strictly exceeds
```

T7's row is selected by the genome's `palette.ramp_len` for hide and
underside samples; **focal samples always use the ramp_len = 4 row**
(§1.3), so focal tone stays in {0, 1, 2} for every genome. Tone ranges
over [0, ramp_len − 2] (rasterizer tone t maps to ramp slot t + 1).

**Coverage.** §1.2's "opaque iff hits/S² ≥ 0.42" is evaluated as plain
integer arithmetic, bit-exact against the raw threshold — a pixel is
opaque iff

```
hits · 2^16 ≥ S² · 27525
```

(at S = 4, 32×32: hits·65536 ≥ 440400, i.e. hits ≥ 7) — **not** a
precomputed rounded sample count.

**Per-pixel tags.** The winning (material, tone) key is the §1.2 majority
vote with the first-seen tie-break. The pixel then carries:

- **part tag** — the slab index (into the normative §1.2 slab list) with
  the most contributing samples *among the winning key's samples*; ties
  on the part vote count break to the part whose first contributing
  sample (again among the winning key's samples) occurs earliest in the
  pinned scan order — the same first-seen rule as the key vote.
- **depth tag** — the mean entry depth of the winning key's samples,
  RHE-rounded to a 16.16 raw: `RHE(Σ entry_depth_raw / sample_count)`,
  an exact integer division rounded half to even. This is the per-pixel
  depth design 04 §4 rule 4 consumes.

**Canonical serialization and the raster golden.** The tagged grid
serializes to the byte form the raster goldens hash (SHA-256 over exactly
these bytes):

- header: width u8, height u8 (grids beyond 255 px per side do not
  serialize);
- then every pixel in scan order (py outer ascending, px inner
  ascending): a transparent pixel is the single byte 0x00; an opaque
  pixel is 0x01, role id u8 (hide = 0, underside = 1, focal = 2 — the
  §1.3 role order), tone u8, part tag u8, then the depth tag as int32
  little-endian two's complement (4 bytes).

Pinned raster golden: the all-defaults genome, walk φ = 0, facing down,
32×32 serializes and hashes to SHA-256
`3121cea8d4833a2fa5a5a7f51c56cf253d8bfd0827a9f460244f3e67a8a477ed`.

**Size scope.** Only size = 32 is normative in M1 (16×16 was descoped,
D5). The frame generalizes as ox = size/2 → raw size·2^15,
oy = size·(26.5/32) → raw size·54272 (26.5·2^16/32 = 54272 exactly),
scale = size/32 → raw size·2^11 (exact), with sample coordinates
`fp_div(cell·2^16 + OFF − o, scale)` — at size 32 the divide is by 1.0
and is the identity. Other sizes exist to give craft rules resolution
context (constraint row 8) and are not golden-pinned.

### 1.5 Craft pass (normative)

Design 04 §4's rule pipeline as amended by S3 (constraint rows 2, 3, 4,
6, 7, 8), pinned to the bit. Everything here is integer arithmetic over
the §1.4 tagged grids — no floats anywhere (R6). Rules 6 and 7 are
M2/M3 and must not leak into M1 (R10); the flicker *metric* and its CI
gate (constraint row 5) are a separate unit and not part of this pass.

**Scope: clip-scoped only.** The unit of work is one clip × direction
cell: the K tagged §1.4 grids of that cell (M1: K = 4, §1.2), rendered
with the chain-snap offsets below. The craft pass takes the K grids and
returns K crafted grids plus a decisions record; every clip-wide
decision (budget merges, selout exemptions) is computed once from
clip aggregates and applied to every frame identically (design 03 §4).
The spike's per-frame flavor was an S3 comparison arm and does not
ship. K ≥ 1 is legal (aggregates degrade to the single frame); all K
grids must share one width × height.

**Craft pixel.** An opaque cell carries
`(role, tone, partId, depthRaw, edge)` — the four §1.4 tags plus
`edge ∈ {0, 1, 2}`: 0 = none, 1 = boundary-vs-transparent (outline —
the palette layer will draw ramp slot 0), 2 = farther side of an
interior part boundary (one tone darker). Input grids are cloned,
never mutated (edge enters as 0); budget merges reassign (role, tone)
only — partId and depthRaw keep their rasterizer provenance on every
surviving pixel. The donor-based repairs of rules 2 and 3 adopt donor
tags exactly as specified per rule below.

**Constants (the 32×32 row).** Every craft threshold is
resolution-scoped in principle (S1/F4, constraint row 8); M1 pins the
size-32 row only (D5) and hardcodes it:

| constant | value | meaning |
|----------|-------|---------|
| MAX_CLUSTERS | 14 | rule 5 cluster-key budget |
| MIN_CLUSTER_PX | 4 | rule 5 sub-threshold size |
| SOFT_MIN_PX | 6 | F7 softening: part size threshold |
| SOFT_MIN_DIM | 3 | F7 softening: part bbox-min threshold |
| MAX_PASS_ITERS | 40 | fixpoint safety cap, one craft pass |
| MAX_MERGE_ITERS | 300 | safety cap inside rule 5 |

Exceeding either iteration cap is a spec violation — implementations
must trap (throw), never emit a half-crafted clip.

**Shared machinery.** The pinned 4-neighborhood order is N4 = (0, −1),
(0, 1), (−1, 0), (1, 0) — up, down, left, right; out-of-bounds cells
are transparent. A **cluster** is a 4-connected region of opaque
pixels sharing (role, tone). Its clip-stable **key** is the integer
triple `(partId, roleId, tone)` — roleId the §1.3 wire ids (hide 0,
underside 1, focal 2) — where partId is the majority part tag over the
region's pixels, ties on the part count breaking to the LOWEST partId.
Key order is lexicographic on the triple. **Doubled presence-medians**
(R6 — no float halves, ever): a per-key/per-part statistic over the
clip is medianed over the frames where the key/part is *present*
(value > 0, F13); the median of n sorted integer samples is carried
DOUBLED — odd n: 2·middle; even n: the sum of the two middle samples —
and every threshold comparison happens on doubled values
(doubled-median < 2·threshold), so no half is ever materialized.
**Contact counts**: for each frame, each 4-adjacent pixel pair lying
in two distinct clusters is counted once (scan every opaque pixel,
look at its (+1, 0) and (0, +1) neighbors only); pair counts map to
unordered key pairs, pairs whose two clusters share a key are dropped,
and counts sum over the K frames.

**Rule 2 — orphan cull.** Per frame; detect on the pre-rule grid, then
apply. For every opaque pixel p: if p has **no** opaque 4-neighbor, p
is culled (deleted). Else if p has exactly 4 opaque 4-neighbors and
none of them shares p's (role, tone), p is an interior 1-px island and
is reassigned: the dominant neighbor key = the (roleId, tone) with the
most of the 4 neighbors, ties to the lexicographically smallest
(roleId, tone); the donor is the FIRST neighbor in N4 order carrying
that key; p becomes (donor's role, donor's tone, donor's partId, p's
own depthRaw, edge 0). Donor tags are read from the pre-rule grid —
all culls and reassignments are detected, and their donor values
captured, before any is applied, so two adjacent islands that are each
other's donors both copy pre-rule tags, never each other's
reassignment. **Focal pixels are exempt from rule 2
entirely** (neither culled nor reassigned): a 1-px eye straddling into
an island position is exactly the face pixel F16 exists to protect,
and constraint row 6's "a craft rule may never erase a face" is
normative for every rule, not only rule 5. (Deviation from the spike,
which predates F16.)

**Rule 3 — jaggy repair.** Per frame; detect on the pre-rule grid,
then apply. Define v(x, y) = the (role, tone) of an opaque cell, or ⊥
for transparent/out-of-bounds; transparent cells participate (a 1-px
notch in an otherwise straight silhouette edge is filled, a 1-px tooth
into transparency is shaved). For every cell (x, y) — opaque or not —
scan d ∈ N4 in the pinned order and fire on the FIRST d matching all
of (then stop scanning directions for this cell):

- v(x+d) = v(x, y) — one 4-neighbor continues p's own cluster;
- the other three 4-neighbors (N4 order minus d) all carry one common
  value w ≠ v — p is a 1-px tooth of v into w;
- with the perpendiculars p1 = (−dy, dx), p2 = (dy, −dx): the two
  diagonal cells beside the v-neighbor, (x+dx+p1x, y+dy+p1y) and
  (x+dx+p2x, y+dy+p2y), are both v, and the two diagonals beside the
  opposite neighbor, (x−dx+p1x, y−dy+p1y) and (x−dx+p2x, y−dy+p2y),
  are both w — the boundary is otherwise straight, so the repair is
  locally stable and cannot cascade.

Repair: if w = ⊥ the cell is deleted; otherwise the cell becomes a
full copy of the opposite neighbor (x−dx, y−dy) — role, tone, partId,
depthRaw — with edge 0. (The opposite neighbor is one of the three
w-neighbors, so it is opaque exactly when w ≠ ⊥.) One repair per cell
per invocation; all repairs are detected before any is applied. Rule 3
can never erase a cluster's last pixel: the pattern requires a
same-value 4-neighbor, and two mutually-supporting pixels of a 2-px
cluster cannot both match (each would need the other's flank diagonals
to be v and w simultaneously).

**Focal pixels are exempt from rule 3 entirely**, exactly as from
rule 2 (F16 / constraint row 6): a cell whose v is focal never fires.
Without the exemption the shave branch could delete a face pixel and
the copy branch could recolor one away from focal — the no-last-pixel
argument above only protects a cluster's LAST pixel, so on its own it
would still let rule 3 whittle a ≥ 2-px eye down. The exemption is
one-sided, matching rule 2's donor behavior: a transparent notch in a
focal silhouette still fills (v = ⊥, w focal — the donor copy ADDS a
face pixel), and a non-focal tooth may still adopt a focal donor.
Rule 3 may grow a face, never shrink it.

**Rule 5 — cluster budget (clip-scoped).** Operates on all K frames
jointly. Maintain a skip set (empty at each rule-5 invocation) and
loop (≤ MAX_MERGE_ITERS):

1. Stats: per frame, find clusters; size[key][frame] = total pixels of
   that key in that frame (same-key clusters sum); contacts as pinned
   above; dmed[key] = doubled presence-median of the present sizes.
2. **Focal keys (roleId = 2) are merge-protected (F16): never
   selectable as src — neither merged nor deleted.** They still count
   toward the budget and may be chosen as dst.
3. under = the non-focal, non-skipped keys with
   dmed < 2·MIN_CLUSTER_PX. If under is empty and the total key count
   ≤ MAX_CLUSTERS: converged, stop.
4. pool = under if non-empty, else all non-focal non-skipped keys. If
   pool is empty: **stop at the floor** — over budget with only
   protected/skipped keys left is a normal stop, not an error (a craft
   rule may never erase a face).
5. src = the pool minimum by (dmed, key) — smallest doubled median,
   ties to the smallest key.
6. Sum src's contact counts per neighboring key. If src has none:
   if dmed[src] < 2·MIN_CLUSTER_PX it is floating debris — dst = ∅
   (delete); else add src to the skip set and continue (a large
   contact-less cluster — a whole thin body — is skipped, never
   deleted).
7. Else dst = the neighbor minimum by (−contact, −dmed, key) — most
   contact, then largest doubled median, then smallest key.
8. Apply to EVERY frame: each pixel of each cluster whose key = src is
   deleted (dst = ∅) or reassigned to dst's (role, tone), keeping its
   own partId and depthRaw, edge 0. Record the decision (src, dst) —
   deletions record dst = ∅.

**Rule 4 — selout, decided and applied post-merge (F13).**

- **F7 exemptions from PART-LEVEL stats (F15).** Computed ONCE per
  craft pass, from the POST-FIXPOINT grids (immediately before selout,
  after the rules-2/3/5 loop below converges), superseding the spike's
  post-merge per-KEY stats: per frame, per partId, over the part's
  full pixel set (every opaque pixel tagged partId, regardless of
  role/tone/connectivity): size = pixel count, bboxMin =
  min(bounding-box width, height); a part is present in a frame iff
  size > 0; the part is **exempt** iff its doubled presence-median
  size < 12 (= 2·SOFT_MIN_PX) OR its doubled presence-median
  bboxMin < 6 (= 2·SOFT_MIN_DIM). Part-level stats are what defeats
  the F15 failure: rule-5 merges reassign (role, tone) only, so the
  budget merge can never inflate a part's size or bbox out of its
  exemption — the thin body stays soft however its clusters
  consolidate. The stats are pinned at the FIXPOINT rather than at
  the pass's input because idempotence demands it (machine-verified:
  input-grid stats broke the idempotence contract on 5 of the first
  50 sampled walk cells — rules 2/3/5 shave a few pixels off
  borderline parts, so a second run computed a strictly larger exempt
  set from the crafted grids and re-decided edges; fixpoint stats are
  identical on every re-run by construction, and they describe the
  geometry selout actually paints).
- **Part mean depths, compared exactly.** Over all K post-fixpoint
  grids: depthSum[part] and count[part] over every opaque pixel. Part
  a is *strictly farther* than part b iff
  `depthSum[a]·count[b] > depthSum[b]·count[a]` — an exact integer
  cross-multiplication of the (sum, count) rationals (counts are
  positive; implementations must use exact arithmetic — the spike's
  1e-9 epsilon is superseded by exact strict >).
- Per frame: find clusters; a cluster is exempt iff its majority part
  (its key's partId) is exempt. Reset every edge flag to 0, then for
  every opaque pixel p: p is *open* iff any 4-neighbor is
  transparent/out-of-bounds. If p's cluster is exempt, edge stays 0.
  Else if p is open, edge = 1. Else if any opaque 4-neighbor n has
  n.partId ≠ p.partId and p's part is strictly farther than n's part,
  edge = 2. Else 0.

**Orchestration (one craft pass).** Clone the K input grids; iterate —
rule 2 over every frame in ascending frame order, rule 3 likewise,
then one rule-5 invocation — until an iteration reports zero rule-2
changes, zero rule-3 repairs, and zero rule-5 decisions
(≤ MAX_PASS_ITERS, else trap). Then compute the F15 exempt-part set
from the fixpoint grids, and rule 4 decides and applies edges. The decisions record
carries, at minimum: the per-iteration counts (rule-2 changes, rule-3
repairs, rule-5 decisions), the ordered merge-decision list, the
exempt part ids (ascending), and the number of work rounds
(iterations with any change). **Idempotence is a hard contract**
(constraint row 2, CI property test): running the pass on its own
output must reproduce that output exactly.

**Chain-grouped pixel snapping (constraint row 3, F14/F16).** Snapping
is a pre-rasterization step of the same unit: slabs are grouped by
skeleton chain so assemblies shift together (per-slab snapping
reshaped the wolf's head — F16). The M1 quadruped chain table, over
the §1.2 normative slab order, is pinned (and exported beside
PART_NAMES):

| chain | slab indices |
|-------|--------------|
| body | 0, 1 |
| head | 2, 3, 4, 5, 6, 7 |
| leg_fl | 8 |
| leg_fr | 9 |
| leg_bl | 10 |
| leg_br | 11 |
| tail | 12 |

A chain's screen position is the continuous (pre-snap) projected
screen center of its FIRST slab (its anchor: core, head, each leg,
tail), in 16.16 raws, reusing the §1.4 screen mapping: after yawSlab
for the direction, `sx = cx`,
`sy = fp_sub(fp_sub(0, cz), fp_mul(TILT_RAW, cy))`. (These are
model-scale screen raws without the §1.2 frame anchor; the anchor is a
constant and plays no role in displacements, and the whole-sprite
placement rounding is pinned on THIS form.) Per clip × direction ×
chain, per axis:

```
mean       = rheDiv(Σ_f pos(f), K)         K divides exactly or RHE
                                           ties-to-even applies (§5.1)
roundPx(x) = rheDiv(x, 65536) · 65536      whole-pixel raw, ties-to-even
                                           (F14 — a ±0.5 px oscillation
                                           parks instead of strobing)
snapped(f) = roundPx(mean) + roundPx(pos(f) − mean)
offset(f)  = snapped(f) − pos(f)
```

One (dx, dy) raw pair per chain per frame, applied to EVERY slab of
the chain. Snapped positions are whole-pixel raws by construction;
offsets are general int32 raws (fractional in general — they carry the
slab from its continuous position onto the snapped one).

**Rasterizer offset hook.** `rasterize` accepts an optional per-slab
screen-space offset list (raws), index-aligned with the slab list.
After yawSlab, the slab is translated `cx += dx`, `cz −= dy` — plain
int32 adds, exact for any raw offset. Because screen y = −z − TILT·y
(§1.4), the −dy on cz shifts the slab's screen y by exactly +dy
without touching the depth axis y: snapping can never change occlusion
order or depth tags. An absent offset list (and equally an all-zero
one) is byte-identical to the un-hooked rasterizer — the §1.4 pinned
raster golden is rendered without offsets and stands unchanged.

### 1.6 Flicker metric (normative)

The CI flicker gate of constraint row 5 (S3/F12; design 03 §4 as
built), transcribed to exact fixed point. The metric is diagnostic
instrumentation over the §6.1 pipeline's outputs — it adds nothing to
the render path and no goldens hash it — but its arithmetic is pinned
here so two implementations agree on every pass/fail verdict.

**Inputs.** One clip × direction cell: the K final RGBA frames (the
§1.3 artifact-1 buffers, post-palette — the shipped bytes; K = 4 in
M1) and the K continuous PRE-SNAP model-space slab lists that produced
them (the §1.2 13-slab template — snapping never enters the energy
side). Frame pairs wrap: the K scored pairs are (f, (f+1) mod K) for
f = 0..K−1, so the (K−1, 0) pair is included.

**changed(f, g)** = the count of pixel positions whose 4 RGBA bytes
differ in any byte. Transparent is exactly (0, 0, 0, 0) (§1.3), so the
byte comparison is total — no alpha special-casing.

**motion_energy(f, g)** = the sum over the 13 slabs of the Euclidean
screen-space displacement of the slab's CONTINUOUS pre-snap projected
center between the two frames. The center mapping is byte-for-byte the
§1.5 snap-position mapping, applied here to EVERY slab (not only chain
anchors): after yawSlab for the direction, `sx = cx`,
`sy = fp_sub(fp_sub(0, cz), fp_mul(TILT, cy))` — model-scale screen
raws; the §1.2 frame anchor is a constant and cancels in
displacements. Per slab, with dx, dy the int32 raw center differences:

```
disp   = RHE(√(dx² + dy²))               exact integer square sum
energy = Σ over the 13 slabs of disp     exact integer, 16.16 raw
```

The square sum is computed EXACTLY: it exceeds int32 over the locus
domains (machine-verified worst case: |dx| = 524288 raw = 8 px — tail
wag at gait_freq 2, tail_amp 4, tail_lag 0.25 — square sum 2^38), so
fp_mul is not a legal carrier; the reference implementation uses
BigInt (the sum stays below 2^53, so exact doubles also conform).
RHE(√n) is the §5.2 fp_sqrt rounding applied to the exact sum — a tie
is impossible ((q+½)² is never an integer) — decided by the remainder
test `q = isqrt(n); if n − q² > q: q += 1`. The form is identically
fp_sqrt with its input scale shifted: fp_sqrt(a) = RHE(√(a·2^16)), and
here a·2^16 is replaced by the exact 2^32-scale square sum instead of
RHE((dx² + dy²)/2^16) — chosen to eliminate the two intermediate
fp_mul roundings along with their range ceiling.

**Gate.** The pinned gate is the rational GATE_NUM / GATE_DEN =
32 / 1 = 32.0 (recalibration evidence below). Scoring one pair, in
this order:

- energy = 0 and changed = 0 → the pair passes (score 0 — the S3/F12
  zero-motion convention);
- energy = 0 and changed > 0 → INF: churn at zero motion — the pair
  auto-fails;
- otherwise the pair passes iff, in exact integer arithmetic (the gate
  never divides): `changed · 2^16 · GATE_DEN < GATE_NUM · energy` —
  strict `<`, so a score exactly at the gate fails.

A cell passes iff all K pairs pass. The CI gate applies to every
**walk** clip × direction cell (idle cells are measurable but ungated —
walk is where motion must justify churn); tests/flicker.test.ts
enforces seeds 0..49 (200 cells) plus the all-defaults wolf on every
CI run, and the INF branch via constructed frames.

**Recalibration evidence (the F12 mandate).** Measured on the
production renderer, seeds 0..199 × 4 directions = 800 walk cells =
3200 pairs (2026-07-11): mean 5.93, median 5.89, p90 9.81, p99 18.70,
max 25.1166 (seed 199, down, pair 0: changed 30, energy 78278 raw);
zero INF pairs. Histogram (score bin: pairs) — [0,1): 322, [1,2): 71,
[2,3): 189, [3,4): 376, [4,5): 299, [5,6): 389, [6,7): 413,
[7,8): 373, [8,9): 281, [9,10): 200, [10,11): 96, [11,12): 60,
[12,13): 48, [13,14): 20, [14,15): 15, [15,16): 6, [16,17): 4,
[17,18): 3, [18,19): 14, [19,20): 4, [20,21): 4, [21,22): 1,
[23,24): 4, [24,25): 4, [25,26): 4. The S3 gate 12.0 does NOT hold in
production — 131/3200 pairs exceed it. Cause, recorded honestly: the
S3 substrate (wolf variants) never reached the sampled domain's
low-motion corners — a gait_freq = 2 genome freezes legs and bob
entirely at K = 4 (sin(2·g·φ_k) and sin(g·φ_k + G_i) are identically
0 on the quarter-phase grid, leaving only the tail moving), and
small-amplitude g = 1 genomes move ~1 px per pair — so legitimate
few-pixel silhouette changes divide by near-zero energies. All nine
seeds in 0..199 with a pair above 15 are such genomes (four of nine
gait_freq = 2). **32.0** is the tightest round value with ≥ 1.25×
margin over the measured max (25.1166 · 1.25 = 31.40 required;
32/25.1166 = 1.274× actual). Per F12 the gate remains a BACKSTOP
against egregious churn (INF and runaway ratios), not a regression
detector; the pinned-contact-sheet human QA (constraint row 10) stays
the quality guard.

## 2. Path identity: socket names, never positional indices

Locus paths key three load-bearing mechanisms: PRNG streams (§4),
crossover homology (design 01 §3), and the serialization registry (§3).
A path must therefore survive parts being added or removed. Bare
positional indices (`limbs[0..3]`, as sketched in design 01 §2) do not:
removing limb 1 renames limbs 2–3, reshuffling their streams and breaking
homology — exactly the R5 failure. The rule:

- **Repeated parts are addressed by grammar-assigned socket names.** The
  M1 quadruped vocabulary: `body.leg[FL]`, `body.leg[FR]`, `body.leg[BL]`,
  `body.leg[BR]` (fore/back × left/right). Future quadruped-family sockets
  (e.g. `ML`/`MR` for hexapod mid-legs) extend the vocabulary; they never
  renumber existing sockets.
- **Ordinals are allowed only *within* one named socket, for true
  multiples:** `body.ornaments[dorsal:0]`, `body.ornaments[dorsal:1]` —
  the socket name carries the identity. Homology aligns on (socket,
  ordinal); a serial(N) chain (design 02 §1) is the canonical user of
  this form.
- **Ordinals are stable once assigned — removal never compacts.**
  Deleting `[dorsal:0]` leaves the survivor spelled `[dorsal:1]`: its
  path, stream keys (§4), and registry ids are untouched, and the gap is
  legal (compacting survivors would be the R5 renumbering failure,
  merely confined to one socket). A new sibling takes the **lowest
  unused ordinal** in its socket — the only rule computable from genome
  state alone. A serial(N) chain shrinks from the tail (highest ordinals
  removed first) and grows by appending, so a length mutation is always
  a pure add/remove of tail segments, never a rename of survivors.
  Encoders and decoders need no extra rule: entries key on registry ids
  (§3), and ids bind to exact (socket, ordinal) paths, so sparse
  ordinals serialize like any other absent loci.
- **Optional and repeated parts must carry an existence-marking locus
  whose DEFAULT means absent** (e.g. a future
  `body.ornaments[dorsal:0].kind` defaulting to `none`) — an M2
  forward-constraint on registry appends, pinned now: defaults serialize
  as absent (§3.2), so tape-absence must be able to represent
  part-nonexistence, which is what design 01 §3's crossover case "locus
  present in one parent only" aligns on.
- Path syntax: segments joined by `.`; a repeated-part segment is
  `name[SOCKET]` or `name[SOCKET:ordinal]`. The canonical spelling in the
  registry table is the exact byte string hashed in §4 — no aliases, no
  normalization.

## 3. Serialization: the varint tape

Design 01 requires: defaults absent, compact (≤ ~200 chars base64url),
and **additive schema changes must not bump the version** — so the tape
cannot be positional. Two candidates: length-prefixed path strings
(self-describing, ~20 bytes per field) or a canonical id registry
(1 byte per field, needs the version's registry table to decode). The
registry wins: the version prefix already selects a growth-rule table
(design 01 §4), so a per-version registry adds no new coupling, and it is
5–10× smaller. **Chosen: id registry, append-only per version-table**
(§1.1 is the version-1 table).

### 3.1 Primitives

- **uvarint** — LEB128: little-endian base-128 groups, 7 payload bits per
  byte, high bit = continuation. **Minimal length is mandatory**: an
  encoding with a redundant trailing `0x00` group (e.g. `80 00` for 0) is
  invalid. **uvarint is a u64 primitive in every position** (version, id,
  payload): an encoding longer than 10 bytes or encoding a value ≥ 2⁶⁴
  is *malformed* — not UpgradeRequired — so implementations agree on the
  error class without unbounded-integer support.
- **zigzag64** — `zz(n) = (n << 1) XOR (n >> 63)` on a signed 64-bit
  value (arithmetic shift). zz(0)=0, zz(−1)=1, zz(1)=2, zz(−2)=3.
- **base64url** — RFC 4648 §5 alphabet (`A–Z a–z 0–9 - _`), **no
  padding**.

### 3.2 Tape layout

```
tape  := uvarint(version) entry*          # version = 1
entry := uvarint(id) payload              # ids strictly ascending
```

Payload by locus type:

| type | payload | presence rule |
|------|---------|---------------|
| scalar (fp, int, enum) | `uvarint(zz(value_raw − default_raw))` | present iff value ≠ default (payload 0 is invalid) |
| u64 (`meta.seed`) | `uvarint(value)` | present iff ≠ 0 |
| tag-set (`meta.trait_tags`) | `uvarint(count)` then `count` strictly-ascending `uvarint(tag)` | present iff non-empty |

Scalars encode the **delta from the registry default**, zigzagged: default
serializes as absent by construction, and drift mutations (small deltas)
stay 1–2 bytes even for large-magnitude loci. The delta is computed in
64-bit (int32 − int32 always fits).

### 3.3 Canonical form and the round-trip law

There is exactly one encoding of any genome. The decoder **rejects** (an
error, never silent normalization): a non-minimal uvarint; an id ≤ the
previous id; a scalar payload of 0; a seed of 0; an empty or non-ascending
tag set; a value outside its locus domain; a truncated entry; trailing
bytes. An id (or enum value) beyond the version's registry — and equally
a version prefix beyond the build's known tables — is rejected as
`UpgradeRequired`: old builds refuse rather than misrender, which is what
lets *new* builds keep old strings pixel-identical (design 01 §4 promise;
additive appends never bump the version, behavioral changes do and freeze
the old table).

Law, enforced by property test on every CI run:
`decode(encode(g)) == g` for every valid genome `g`, and
`encode(decode(b)) == b` for every byte string `b` that decodes at all.

### 3.4 Worked example (normative test vector)

A wolf mutant: seed 42, hue rotated to 200°, tail amplitude 2.0, back-left
leg lengthened to 3.6.

```
byte(s)          field                      meaning
01               version                    1
01 2a            id 1  meta.seed            uvarint 42
03 80 80 d8 0b   id 3  palette.base_hue     zz⁻¹(24510464) = +12255232 raw
                                            → 851968 + 12255232 = 13107200 = 200.0°
0c b4 e6 04      id 12 anim.quadruped.tail_amp
                                            zz⁻¹(78644) = +39322 → 131072 = 2.0
1b 80 80 04      id 27 body.leg[BL].length  zz⁻¹(65536) = +32768 → 235930 = 3.6
```

Tape (16 bytes): `01 01 2a 03 80 80 d8 0b 0c b4 e6 04 1b 80 80 04`
→ base64url `AQEqA4CA2AsMtOYEG4CABA` (22 chars).

The all-defaults wolf is the single byte `01` → `AQ` (2 chars).

### 3.5 Size budget

Typical genomes (a seed plus a dozen edited loci) run 20–80 chars. The
pathological bound — a max u64 seed, a full tag set, and every other
locus pushed to its most expensive domain extreme (`meta.plan` cannot
move: its enum has a single value) — is exactly **134 bytes = 179
base64url chars**, machine-verified from the §3.1–§3.2 rules: the
≤ ~200-char target of design 01 requirement 4 holds even for fully
adversarial genomes, and the format degrades linearly, not
catastrophically. Additive registry growth costs absent genomes nothing.
*Amended with U2 (2026-07-12): the locus-35 append (07 §4.4.3) adds 4
worst-case bytes (id uvarint 1 + worst zigzag value 3), moving the
adversarial bound to **138 bytes = 184 base64url chars** —
machine-verified, CI-pinned in `tests/genome.test.ts`, still comfortably
within the ≤ ~200-char target.*

*Amended with U3 (2026-07-15): `meta.plan` gains member 1 (levitant)
and the registry gains ids 36–46 (07 §2.3.1). Since sampling is
plan-scoped, per-plan worst cases replace the single bound:
the **quadruped sampler-reachable worst stays exactly 138 B =
184 chars** (byte model validated against the U2 pin); the largest
sampler-reachable **levitant** tape (plan entry + shared loci +
ids 36–46 at costliest extremes) is **85 B = 114 chars** — the ≤
~200-char target holds for every genome any pinned sampler can emit.
The FULLY adversarial hand-edited cross-plan tape (all 44 movable
scalars at their costliest extremes across BOTH plans, which no
sampler emits) is **179 B = 239 chars**, exceeding the guidance for
that case alone — accepted and recorded: the target was calibrated to
issued genomes, degradation stays linear, and the U4 append will grow
the hand-edited bound regardless. All three bounds machine-verified,
CI-pinned in `tests/genome.test.ts` and `tests/levitant.test.ts`.*

*Amended with U4 (2026-07-16): `meta.plan` gains member 2 (amorphous)
and the registry gains ids 47–50 (07 §2.4.1). The quadruped and
levitant sampler-reachable worsts stay exactly **138 B** and **85 B**
(their scope sets did not move); the largest sampler-reachable
**amorphous** tape (plan entry + max seed + 2 tags + shared loci +
ids 47–50 at costliest extremes — worst payloads 1 B for id 47, 3 B
each for ids 48–50) is **60 B = 80 chars**. The fully adversarial
hand-edited cross-plan tape grows by the predicted 14 B to **193 B =
258 chars** — still emitted by no sampler, degradation still linear,
recorded and accepted. All bounds machine-verified, CI-pinned in
`tests/genome.test.ts` and `tests/amorphous.test.ts`.*

## 4. Stream keying: hash(seed, path, draw) → PCG32

Design 01 §2's stability rule, made executable. Every random draw in the
pipeline gets its own stream named by (locus path, draw name); nothing
ever draws from a shared sequence. M1's consumer is the genome sampler
(contact-sheet CLI `--seed-range`, the 200-genome property tests); growth
draws (clearance re-rolls, grammar choices) join at M2 with the same
mechanism.

### 4.1 Stream construction

All arithmetic mod 2^64. FNV-1a 64: offset basis `0xcbf29ce484222325`,
prime `0x100000001b3`, over the UTF-8 bytes of `path`, then one `0x00`
byte, then the UTF-8 bytes of `draw_name`. splitmix64 is the standard
finalizer: `z = x + 0x9E3779B97F4A7C15; z = (z ^ z>>30)·0xBF58476D1CE4E5B9;
z = (z ^ z>>27)·0x94D049BB133111EB; return z ^ z>>31`.

```
k         = fnv1a64(utf8(path) ‖ 0x00 ‖ utf8(draw_name))
u         = k XOR genome_seed
initstate = splitmix64(u)
initseq   = splitmix64(initstate)
```

PCG32, **XSH-RR 64/32** (O'Neill reference variant), multiplier
`6364136223846793005`. Seeding is the reference `pcg32_srandom_r`:

```
state = 0;  inc = (initseq << 1) | 1
advance()                 # state = state·MULT + inc
state = state + initstate
advance()
```

Output function (`advance` returns from the *pre-advance* state):

```
old        = state;  state = old·MULT + inc            (mod 2^64)
xorshifted = ((old >> 18) XOR old) >> 27               (take low 32 bits)
rot        = old >> 59
out        = (xorshifted >> rot) | (xorshifted << ((−rot) & 31))   (32-bit rotate)
```

Implementations must reproduce the published PCG32 check vector: seeding
with (initstate 42, initseq 54) directly yields `0xa15c02b7 0x7b47f409
0xba1d3330 …`. The 64-bit multiplies happen per draw, not per pixel — in
JS, BigInt here is fine (draws are rare; the rasterizer hot path uses no
PRNG).

### 4.2 Draw API

- `nextU32()` — one PCG32 output.
- `nextRange(n)` for n ≥ 1 — **unbiased rejection** (O'Neill's bounded
  variant, pinned): `threshold = 2^32 mod n`; loop `r = nextU32()` until
  `r ≥ threshold`; return `r mod n`. No fixed-modulo shortcut: bias is
  nondeterminism's quiet cousin across future refactors of n.
- `nextFp(lo, hi)` — `lo + nextRange(hi − lo + 1)` on raw values.

The M1 sampler, pinned for cross-implementation sheet identity: given a
sheet seed s, the sampled genome has `meta.seed = s`, `meta.plan = 0`, and
each scalar locus drawn as `nextFp(domain)` (enums: `nextRange(card)`)
from `stream(s, path, "sample")`. `meta.trait_tags` uses its own stream
(`path = meta.trait_tags`, draw name `sample` — the §0 default, like
every sampler draw): draw `n = nextRange(2) + 1`, so n ∈ {1, 2} and
never zero — design 02 §3 pins tags as the anti-oatmeal archetype
attractor ("carries 1–2 tags"), so a sampled genome always commits to a
theme. The empty set stays wire-legal: it is the registry default and
structurally necessary (defaults serialize as absent, §3.2) — reachable
by editing, never by sampling. Then, until the set holds n distinct
tags, draw one tag as `nextRange(5)` (the tag ids of §1.1) and discard
the draw if that tag is already in the set — redraw immediately, per
position, always over the full 5-tag enum, never over the remaining
tags. The set serializes in ascending tag order regardless of draw
order (§3.2).

*Amended with U3 (2026-07-15): the pin above now reads over a
plan-scoped sampler, in two respects. First, `meta.plan` is a **caller
parameter**, not a draw — `sampleGenome(seed, plan = 0)` consumes no
PRNG output for the plan choice, so `meta.plan = 0` above becomes
`meta.plan = plan` and every pre-U3 sheet seed keeps its bytes
(plan-MIX sampling defers to U6, which if it samples must use the
reserved `stream(seed, "meta.plan", "sample")`). Second, "each scalar
locus" no longer means the whole registry: the drawn set is
`LOCUS_SCOPES.shared ∪ scope(plan)` — a sampled quadruped draws
exactly ids 3..35 (the identical set U2 drew under this section's
original text, DNA byte-identical, CI-asserted) and a sampled levitant
draws the shared loci plus ids 36–46; neither plan draws the other's
scope. A second implementation reading this section verbatim against
the 47-locus registry MUST apply the scope filter or it will emit
different bytes. Scope column and full rationale: 07 §2.3.1 (D-a).*

*Amended with U4 (2026-07-16): the scope table gains
`amorphous = {47–50}` and `sampleGenome` accepts plan 2 (07 §2.4.1
D-a). The existing scope sets do not move — sampled quadruped AND
levitant DNA stay byte-identical to the U3-close build's strings,
CI-asserted against committed-build vectors in
`tests/amorphous.test.ts`.*

### 4.3 Test vectors (normative)

| seed | path | draw | k (FNV) | initstate | first two u32 |
|------|------|------|---------|-----------|----------------|
| 0 | `body.leg[FL].length` | `sample` | `0x1e6bba6b6e570af9` | `0xea6b245aee22f862` | `0xb13ea62e`, `0xbc57dc41` |
| 42 | `body.tail.girth` | `sample` | `0x997e16fde0e664b3` | `0xb3c9bfbb240bd70d` | `0xd5e5d99d`, `0xb301febf` |
| 0xDEADBEEF | `palette.base_hue` | `sample` | `0xd296c909b6113670` | `0x9fb66eaf1999411a` | `0x3d2fddb9`, `0x2ffdaa65` |

For the first vector, `initseq = 0xe4da9a2f45e57663`. On a **fresh**
stream, the first four `nextRange(100)` draws are 6, 25, 32, 11 — the
threshold is 2^32 mod 100 = 96 and no output falls below it, so these are
u32 outputs 1–4 mod 100. After consuming the two u32s above, the next
four `nextRange(100)` draws are 32, 11, 56, 12.

## 5. Fixed-point 16.16

Floats are banned in core (R6): all creature-space math uses the ops
below. Normative definitions are mathematical (the exact real result,
rounded); the algorithms shown are reference implementations proven exact.

### 5.1 Representation and rounding

- **fp32**: signed 32-bit two's complement raw; value = raw / 2^16; domain
  [−32768, +32768). Overflow of any op's true result outside int32 is a
  spec violation (implementations should trap in debug builds); the locus
  domains and template keep M1 far from the edges.
- **RHE(x)** — round half to even of an exact real x. **Ties-to-even is
  the rounding mode everywhere a value rounds to a coarser grid**: op
  results below, `byte()` in §1.3, and pixel snapping in the craft pass.
  This is load-bearing, not stylistic: half-up rounding turned the wolf's
  exactly-±0.5 px bob into a 1-px square wave and dominated flicker until
  ties-to-even parked it (S3 finding F14, wolf/walk/down max 9.20 → 1.75).
- **asr(x, k)** — arithmetic shift right = floor(x / 2^k). Where this spec
  truncates instead of rounding, it always **floors** (toward −∞), never
  toward zero — pinned explicitly for negative operands: `asr(−1, 1) = −1`.
- add/sub: plain int32 addition/subtraction.

### 5.2 Multiply, divide, square root

**`fp_mul(a, b)`** = RHE(a·b / 2^16). The trap: the 64-bit intermediate
a·b exceeds 2^53, so naive JS `a*b` is inexact. **Chosen: split multiply
in doubles** (not BigInt) — `fp_mul` is the innermost rasterizer operation
(S×S supersamples × slabs × pixels × frames); per-op BigInt allocation is
an order of magnitude slower and F6's perf headroom is worth keeping.
Reference algorithm, every intermediate < 2^53 (exact in doubles), sign
handled by symmetry (RHE is an odd function, so sign-magnitude is exact):

```
fp_mul(a, b):
  s = +1; if a < 0: s = −s, a = −a;  if b < 0: s = −s, b = −b
  ah = a >> 16; al = a & 0xFFFF; bh = b >> 16; bl = b & 0xFFFF
  low = al·bl                                   # < 2^32
  q   = ah·bh·65536 + ah·bl + al·bh + floor(low / 65536)    # < 2^47
  r   = low mod 65536
  if r > 32768: q += 1
  elif r == 32768: q += (q mod 2)               # ties to even
  return s·q
```

(In JS use `Math.floor`/`%`, not `&`/`>>` — bitwise ops force operands
through ToInt32. That applies to q, which outgrows 32 bits, and equally
to the sign-magnitude decomposition of a and b: after negation the
magnitude of raw −2147483648 is 2^31, which is not int32-representable,
so `2147483648 >> 16` ToInt32-wraps to −32768 and silently flips the
product's sign — reproduced in Node. Raw −2^31 stays domain-legal; the
fix is `ah = Math.floor(a / 65536)`, `al = a % 65536`, and likewise for
b.)

**`fp_div(a, b)`** = RHE(a·2^16 / b), b ≠ 0. Divides occur per slab per
frame (projection setup), never per sample, so exactness may use BigInt or
two-word integer long division — either conforms; only the mathematical
result is normative.

**`fp_sqrt(a)`** = RHE(√(a·2^16)) for a ≥ 0 (that is, RHE of
√(value)·2^16). A tie is impossible — (q+½)² is never an integer — so
nearest is decided by integer remainder comparison against q² + q:
`q = isqrt(a << 16); if a·2^16 − q² > q: q += 1`.

### 5.3 sin/cos

Lookup table, no interpolation, arguments in fp turns. **SIN_TABLE** has
4096 entries; entry i = RHE(sin(2π·i/4096) · 65536). The generation rule
is deterministic: no entry lies within 5×10⁻⁴ of a rounding tie (verified
over the full table), so any ≥ double-precision sine reproduces it
exactly; generate offline, embed as constants.

```
sin_fp(x) = SIN_TABLE[(x >> 4) & 4095]      # x = fp turns; asr; index wraps
cos_fp(x) = sin_fp(x + 16384)
```

Pinned table identity: FNV-1a64 over the 4096 entries serialized as
little-endian int32 = **`0x00361da115eb6196`**; entry sum = 0; samples:
T[0]=0, T[1]=101, T[2]=201, T[512]=46341, T[1024]=65536, T[1536]=46341,
T[2048]=0, T[3072]=−65536, T[4095]=−101. Resolution 2^−12 turns ≈ 0.088°;
at M1's ≤ 4 px amplitudes the worst positional error is ~0.006 px, two
orders below the snap grid.

### 5.4 Test vectors (normative; raws in hex, two's complement)

| op | inputs | result |
|----|--------|--------|
| fp_mul | 0x0002199A (2.1), 0xFFFF199A (−0.9) | 0xFFFE1C29 (−123863) |
| fp_mul | 0x00008000 (0.5), 0x00000001 | 0x00000000 (tie → even) |
| fp_mul | 0x00008000 (0.5), 0x00000003 | 0x00000002 (tie → even) |
| fp_mul | 0xFFFF8000 (−0.5), 0x00000001 | 0x00000000 (tie, symmetric) |
| fp_mul | 0x0007999A (7.6), 0x00018000 (1.5) | 0x000B6667 (747111) |
| fp_mul | 0xFFFC999A (−3.4), 0xFFFC999A (−3.4) | 0x000B8F59 (757593) |
| fp_div | 0x00010000, 0x00030000 (1/3) | 0x00005555 (21845) |
| fp_div | 0xFFFF0000, 0x00030000 (−1/3) | 0xFFFFAAAB (−21845) |
| fp_div | 0x0002199A, 0xFFFF199A (2.1/−0.9) | 0xFFFDAAA9 (−152919) |
| fp_div | 0x00000001, 0x00000002 | 0x00008000 (exact) |
| fp_div | 0x00000003, 0x00020000 (3·2^−16 / 2) | 0x00000002 (tie → even) |
| fp_sqrt | 0x00020000 (2.0) | 0x00016A0A (92682) |
| fp_sqrt | 0x00090000 (9.0) | 0x00030000 (3.0) |
| fp_sqrt | 0x00004000 (0.25) | 0x00008000 (0.5) |
| sin_fp | 0x00004000 (0.25 turns) | 65536 |
| sin_fp | 0xFFFFC000 (−0.25 turns) | −65536 |

## 6. Golden and export determinism

The promise is identical output **bytes** (design 01 requirement 1). The
spike phase proved that delegating encoding breaks this: the committed
spike PNGs/GIFs re-render pixel-identically but *not* byte-identically
across Pillow versions (encoder drift — why this repo's practice is
`git restore spikes/out` after verification runs, and why ASSESSMENT §4's
golden-image testing cannot sit on a third-party encoder). Decisions:

**Two canonical artifacts per rendered frame set, both golden-tested:**

1. **Raw RGBA buffer hash** — SHA-256 over width·height·4 bytes, rows
   top-to-bottom, pixels left-to-right, byte order R,G,B,A. Pinned:
   fully transparent pixels are exactly (0,0,0,0) — no hidden color under
   zero alpha. This is the determinism ground truth (renderer-only, no
   container).
2. **Per-frame PNG bytes from M1's own encoder** — one 32×32 PNG per
   rendered frame, fully determined by the recipe below; the shipped
   file format, compared byte-equal in CI on two platforms (R6). The
   packed sprite-sheet layout (design 05 §2) is pinned in §6.2 and its
   PNG joins the golden set alongside the per-frame PNGs.

**M1 ships its own minimal PNG encoder, using zlib stored blocks** (chosen
over fixed-Huffman: zero bit-packing logic and no length/distance coding
to specify, for ~4 KB vs ~2 KB per 32×32 sprite — size is irrelevant to
goldens and shipping sizes stay tiny). Byte-exact recipe:

- PNG signature `89 50 4E 47 0D 0A 1A 0A`.
- `IHDR`: width, height (u32 BE), bit depth 8, color type 6 (RGBA),
  compression 0, filter 0, interlace 0.
- One `IDAT` chunk containing one zlib stream: header `78 01`; deflate
  stored blocks — each block `BFINAL|BTYPE=00` as the byte `00` (`01` on
  the final block), then LEN (u16 LE), NLEN = LEN XOR 0xFFFF, then data;
  blocks split at 65535 bytes (a 32×32 frame is one block). Stream data =
  scanlines, each prefixed by filter byte 0 (no filtering, ever).
  Adler-32 over the full uncompressed stream — every scanline
  **including its leading filter byte** (§0) — u32 BE, closes the zlib
  stream.
- `IEND`. **No ancillary chunks** — no tEXt, pHYs, gAMA, sRGB, nothing.
- Chunk CRCs: standard PNG CRC-32 (reflected 0xEDB88320) over type+data.

Normative vector — the 1×1 fully-transparent frame is exactly these 73
bytes:

```
89504e47 0d0a1a0a                            signature
0000000d 49484452 00000001 00000001          IHDR len, type, w=1, h=1
08 06 00 00 00 1f15c489                      depth 8, RGBA, crc
00000010 49444154                            IDAT len 16
7801                                         zlib header
01 0500 faff                                 final stored block, LEN=5, NLEN
00 00000000                                  filter 0 + RGBA(0,0,0,0)
00050001                                     adler32
64789538                                     IDAT crc
00000000 49454e44 ae426082                   IEND
```

**JSON metadata** (design 05 §2) is canonicalized: UTF-8 without BOM, no
whitespace, object keys in byte-lexicographic order, integers only (fp
values export as raw ints in `*_fp` fields, durations in ms), single
line. String escaping is RFC 8785 (JCS) string serialization: escape
only what RFC 8259 requires (`"`, `\`, and controls U+0000–U+001F),
using the two-character short forms where they exist (`\b \t \n \f \r
\" \\`) and lowercase `\u00XX` otherwise; the solidus is never escaped.
Its SHA-256 joins the golden set. A golden entry is therefore
(genome string, version) → {per-frame RGBA hashes, per-frame PNG bytes,
sheet PNG bytes, JSON hash}, checked on every CI run on two platforms.

### 6.1 The M1 frame set (normative)

The frame set per creature: clips **[walk, idle]** × directions
**[down, left, up, right]** (the §1.4 DIRECTIONS order) × **K = 4**
phases (§1.2, φ_k = k·16384 raw turns), in exactly that nesting order —
clip outer, direction middle, phase inner — **32 frames** of 32×32.
Frame index i decomposes as clip = i div 16, direction = (i div 4) mod
4, phase k = i mod 4.

Pipeline per clip × direction cell, pinned: `poseQuadruped` per phase →
`snapOffsets(slabLists, direction)` (§1.5) → `rasterize(slabs,
direction, 32, palette.ramp_len, offsets)` (§1.4) → `craftClip` (§1.5)
→ `applyPalette` with the creature's **one** `derivePalette(genome)`
palette (§1.3). Poses are direction-independent (design 03 §2:
direction handling is projection); snapping, rasterization, and craft
are per cell.

**Durations are uniform 140 ms per frame, both clips.** Uniformity is
the S2/F10 verdict (constraint row 1); the millisecond value is pinned
here because no design doc had pinned one: 140 ms is the cadence every
accepted spike GIF was rendered and judged at (S1, S1b, S2's 560 ms =
4 × 140 ms cycles, S3), so the pinned cadence is exactly the judged
look. Duration metadata emits the constant per frame (design 05 §2's
non-uniform-capable field, degraded to constants per F10).

### 6.2 Sheet packing (normative)

A grid of 32×32 cells: **one row per (clip, direction) cell in
frame-set order (8 rows), K = 4 columns, row-major, no padding** —
sheet = 128×256 RGBA. Frame i occupies the cell at column i mod 4, row
i div 4, i.e. pixels x ∈ [32·(i mod 4), …+32), y ∈ [32·(i div 4),
…+32); uncovered sheet pixels are exactly (0, 0, 0, 0). The sheet PNG
uses the §6 encoder (its stream is 256·513 = 131328 bytes — three
stored blocks).

**No mirror optimization in M1.** The trot phase groups make left and
right views non-mirror-identical in general (the diagonal pairs {FL,
BR} / {FR, BL} swap roles under reflection, so a mirrored left view
plays the gait half a cycle out of phase — and per-leg loci may differ
besides). The metadata schema nevertheless keeps a per-direction
`mirror` boolean, **false everywhere in M1**, so an M2 mirror
optimization for genuinely symmetric cells is an additive metadata
change, not a schema break.

### 6.3 Metadata schema (normative — the JSON is golden-hashed)

Top-level keys (serialized in the §6 key order): `clips`, `frames`,
`generator_version`, `genome`, `hitboxes`, `palette`, `sheet`. All
numbers are integers; fp raws live in `*_fp` fields; booleans are
legal; null never appears.

- `generator_version` — the build's GENERATOR_VERSION (int).
- `genome` — the canonical DNA string (§3): the sheet is reproducible
  from its own metadata (design 05 §2), trait tags included via the
  tape.
- `sheet` — `{cell: 32, h: 256, w: 128}`.
- `frames` — 32 entries in frame-set order:
  `{duration_ms: 140, pivot: {x_fp, y_fp}, rect: {h, w, x, y}}`.
  `rect` is the frame's §6.2 sheet cell in integer pixels. `pivot` is
  the ground anchor in **cell-local** fp raws — the §1.2 frame anchor
  (ox, oy) = (16.0, 26.5), raws (1048576, 1736704); constant across M1
  frames by construction (the renderer never moves the anchor).
- `clips` — clip name → direction name →
  `{frames: [i, i+1, i+2, i+3], mirror: false}` — the cell's frame
  indices in phase order, and the §6.2 mirror flag.
- `hitboxes` — 32 entries, index-aligned with `frames`:
  `{aabb: {h, w, x, y}, shadow: {cx_fp, cy_fp, rx_fp, ry_fp}}`, both
  derived from the frame's **snapped slab set** (slabs, not pixels —
  design 05 §2), arithmetic pinned below.
- `palette` — `{focal, hide, underside}`: the role ramps as arrays of
  `[r, g, b]` byte triples (slot 0 = outline; hide/underside have
  `ramp_len` entries, focal always 4 — §1.3), plus
  `roles: ["hide", "underside", "focal"]` — the §1.3 wire-id order,
  recording the role↔ramp correspondence for engine-side recolors.

**Hitbox arithmetic (pinned).** Per frame, per slab, after
`yawSlab(direction)` and the frame's §1.5 snap offset translation
(cx += dx, cz −= dy) — the same slab set the rasterizer consumed:

```
sxc = cx
syc = fp_sub(fp_sub(0, cz), fp_mul(TILT, cy))       §1.4 screen mapping
t   = fp_mul(TILT, hy)
ry  = fp_sqrt(fp_add(fp_mul(hz, hz), fp_mul(t, t)))
```

`ry` is the exact screen-y half-extent of the sheared ellipsoid (the
extremum of the linear form −z − TILT·y over an axis-aligned ellipsoid
is √(hz² + (TILT·hy)²); x never enters); the screen-x half-extent is
plain hx. The body AABB is the min/max over **all 13 slabs** of
sxc ∓ hx and syc ∓ ry, anchored to the frame (add the §1.2 ox/oy raws)
and rounded **outward** to integer pixels — floor on mins, ceil on
maxes: x0 = asr(ox + minX, 16), x1 = −asr(−(ox + maxX), 16), likewise
y — emitted as the half-open rect {x: x0, y: y0, w: x1 − x0,
h: y1 − y0}. It is **not clamped** to the 32×32 canvas: the hitbox is
geometry-derived and may legally overhang the frame.

The **ground-shadow ellipse** comes from the body chain's x-extent on
the ground line (§1.5 chain table, slabs 0–1):

```
bMinX = min over slabs {0, 1} of fp_sub(sxc, hx)
bMaxX = max over slabs {0, 1} of fp_add(sxc, hx)
cx_fp = fp_add(ox, asr(fp_add(bMinX, bMaxX), 1))
cy_fp = oy                       (the ground line — raw 1736704)
rx_fp = asr(fp_sub(bMaxX, bMinX), 1)
ry_fp = asr(rx_fp, 2)            (pinned ¼ flattening)
```

All four shadow fields are frame-local fp raws (`*_fp`). The ¼
flattening approximates the TILT = 0.5 foreshortening of a ground
disc at sprite scale while keeping the shadow inside the leg span; it
is an aesthetic pin, not a derivation.

### 6.4 Serializer details (amending the §6 rules)

- **Key order is UTF-8 BYTE-lexicographic** — the §6 rule made
  precise. This coincides with RFC 8785 (JCS)'s UTF-16 code-unit order
  for every key the M1 schema emits (all ASCII), but diverges when a
  non-BMP key (UTF-8 `F0`–`F4`, UTF-16 surrogates `D800`–`DBFF`) meets
  a key in U+E000–U+FFFF (UTF-8 `EE`–`EF`): bytes put the non-BMP key
  AFTER, UTF-16 puts it before. The byte order is the pin
  (machine-verified vectors in tests/export.test.ts).
- **Numbers must be safe integers**; implementations trap on floats,
  non-finite values, and anything past 2^53 − 1 — never round, never
  emit an exponent. Negative zero serializes as `0` (its ECMAScript
  ToString, matching RFC 8785 §3.2.2.3).
- Booleans serialize as `true`/`false`; null is not part of the M1
  value domain and traps.

### 6.5 The all-defaults golden (normative values)

The first full golden entry — the all-defaults wolf (DNA `AQ`),
version 1. Pinned in tests/export.test.ts: all 32 per-frame PNG
SHA-256s and RGBA-buffer SHA-256s, plus

```
sheet PNG  sha256 efd38af16fb8b1b1e3c8c9bbec17c77a453f27256684b13fc1461d65bfaaac84
sheet RGBA sha256 08b70125c46b5d00b91f75068c7e8a944f7628830b2b7981b06c07bc72e6bdcd
JSON       sha256 ec506673c30aba31a40f3049d80b936c44f4a0a4e6ab400d0913f10c4558157f
```

The committed artifacts `tests/goldens/defaults.sheet.png` and
`tests/goldens/defaults.json` (the full canonical string: UTF-8, no
BOM, single line, no trailing newline) are byte-compared against a
fresh render on every CI run. Provenance: the hashes were pinned only
after an independent differential pass — every frame PNG and sheet PNG
of the defaults and seeds 0..14 decoded with Python PIL and
pixel-compared against the RGBA buffers, the JSON re-canonicalized
byte-identically by an independent Python serializer, and the hitboxes
recomputed from the slab math by a from-spec Python oracle
(2026-07-11).

## 7. What M1 consumes from the spikes

The constraint map an M1 implementer starts from; each row is decided
evidence, not a suggestion. Pointers are findings in `ASSESSMENT.md` §2.

| # | Constraint | Source |
|---|-----------|--------|
| 1 | Uniform frame sampling and uniform durations; K = 4 for idle and walk; duration metadata emits constant values | S2 / F10 |
| 2 | Craft order: quantize → rules 2/3/5 iterated to joint fixpoint → selout decided *and* applied post-merge; idempotence (2nd run = no-op) is a CI property test | S3 / F13, R4 |
| 3 | Pixel snapping is chain-GROUPED (skeleton chain, not slab), quantizes displacement-from-clip-mean, ties-to-even | F14 / F16 |
| 4 | Rasterizer exports per-pixel part + depth tags; clip-stable cluster key = (part_id, material, tone); aggregates use presence-based medians | design 04 §4 (S3 machinery), F13 |
| 5 | Flicker CI gate: max pair ratio < 12.0 per walk clip × direction, INF (churn at zero motion) auto-fails; a backstop, recalibrated on the production renderer | F12 |
| 6 | Focal materials (eyes, emitters) are merge-protected in the cluster budget — a craft rule may never erase a face | F16 (extends F5) |
| 7 | Selout thin-cluster (F7) exemptions decided from PART-level stats (merge-invariant: budget merges reassign role/tone only), pinned at the rules-2/3/5 fixpoint — §1.5, which supersedes the finding's "pre-merge" phrasing (fixpoint stats are what row 2's idempotence contract requires) | F15 |
| 8 | Coverage threshold 0.42 at 32×32; every craft rule takes resolution context | S1 / F4 |
| 9 | House style pinned: selout outlines, TILT = 0.5, hue-shifted ramps; projection sign invariant P1 locked by a golden | D3, F1 / F2 |
| 10 | Pinned-contact-sheet human QA remains the readability guard — the flicker gate alone is not a quality gate | F16, ROADMAP standing practices |

Everything upstream of these rows — schema, tape, streams, math — is this
document. Everything downstream — grammar breadth, more plans, craft rules
6–7 — is M2+ and must not leak into M1 (R10).
