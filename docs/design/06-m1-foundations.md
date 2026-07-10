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
| snout | H + scale·(0, 3.3, −1.2) | (1.6, snout_len, 1.5) | underside |
| ears (±) | H + scale·(±2.0, −1.1, 2.8) | ear_size·(0.9, 1.0, 1.7) | hide |
| eyes (±) | H + scale·(±eye_offset, 2.6, 0.6) | eye_size·(0.8, 0.7, 0.8) | focal |
| legs ×4 | (hip_x, hip_y + dy_i, length_i + asr(dz_i,1) + asr(b,1)) | (girth_i, 1.5, length_i) | hide |
| tail | (wag, TY, TZ + b) | (tail.girth, tail.length, tail.girth) | hide |

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
  keeps ≥ 0.1 px of contact in every rendered frame of both clips for
  every genome. The default (3.1) is unchanged, and the worst-case tape
  size (§3.5) is unaffected — the hi extreme dominates that locus's
  payload either way.
- **Tail stays attached.** Its front edge penetrates the core's rear
  face by tail.length − 0.7 ≥ 0.8 px for every length; TZ sits at a
  constant relative height (CZ + 0.588·depth), inside the core's
  z-range at every depth.

No other domain produces disconnection at its extremes. Raw defaults
are unchanged by the coupling, so the §3.4 worked example still stands
(its leg value 3.6 lies inside the narrowed domain).

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

Pinned role constants: hide `hue_base = base_hue`, S = 0.41, V = 0.58;
underside `hue_base = base_hue + hue_shift`, S = 0.30, V = 0.77. The
outline (shared by hide and underside, per design 04 §5) is
`H = wrap360(base_hue − 84.0)`, S = 0.37, V = 0.18. The **focal** ramp is
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
   packed sprite-sheet layout (design 05 §2) is pinned at M1 alongside
   the export layer and joins the golden set then; until it does, the
   per-frame PNGs are the canonical pixel container.

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
JSON hash}, checked on every CI run on two platforms.

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
| 7 | Selout thin-cluster (F7) exemptions decided from pre-merge part-level stats, or a local-thickness measure instead of bbox-min | F15 |
| 8 | Coverage threshold 0.42 at 32×32; every craft rule takes resolution context | S1 / F4 |
| 9 | House style pinned: selout outlines, TILT = 0.5, hue-shifted ramps; projection sign invariant P1 locked by a golden | D3, F1 / F2 |
| 10 | Pinned-contact-sheet human QA remains the readability guard — the flicker gate alone is not a quality gate | F16, ROADMAP standing practices |

Everything upstream of these rows — schema, tape, streams, math — is this
document. Everything downstream — grammar breadth, more plans, craft rules
6–7 — is M2+ and must not leak into M1 (R10).
