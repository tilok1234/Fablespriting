# Design 04 — Rendering: slabs, projection, craft pass, palette

## 1. Slab model

Parts carry 1–3 slabs each. Primitive set:

- **ellipsoid** — proven in S1; covers ~90% of needs
- **capsule** — for long thin limbs at 32×32 (ellipsoids taper too fast at
  the ends; a 1px-wide leg needs parallel sides)
- **box** — mechanical/chitin traits, crates/mimics
- **metaball cluster** — amorphous plan only (separate field-sampling path,
  same output interface)

Slabs are bound to skeleton joints; the pose function positions them per
frame. All coordinates fixed-point, in units of the 32×32 grid.

## 2. Projection (invariants from Spike S1)

Model space: x = creature right, y = facing, z = up. Camera orthographic
looking along +y with top-down shear:

```
screen_x = x
screen_y = -z − TILT·y        # NOTE the minus: see invariant P1
depth    = y                  # smaller = closer, painter's order per sample
```

Directions = yawing the creature 0/90/180/270° (extents permute exactly at
quarter turns — no resampling error).

- **P1 (S1 finding F1):** closer-to-camera geometry lands LOWER in the
  sprite. Getting this sign wrong inverts front/back readability (heads
  hide bodies). Locked by a golden test.
- **P2 (F2):** TILT is a global art-direction parameter; 0.5 validated.
  All sprites in a set share it — mixed tilts read as mixed art styles.
- **P3:** per-sample ray/ellipsoid entry solves occlusion exactly (quadratic
  in depth); no z-buffer, no sorting ambiguity.
- **P4:** left/right are true projections; the sheet packer emits a mirror
  flag instead of pixels when the part graph has no broken mirror groups.

## 3. Rasterization

Supersample S×S per pixel (S=4 validated); each sample records the nearest
slab's (material, tone). Pixel resolves by **majority vote** among hitting
samples, subject to a coverage threshold — this produced clean cluster
boundaries in S1 where averaging would produce mush.

- Coverage thresholds are resolution-dependent (S1 F4: 0.42 @32, 0.34 @16 —
  lower keeps 1px limbs alive). Treat as tunable per resolution, per rule.
- Tone comes from the ellipsoid normal vs a **global light direction**
  (upper-left, shared by the whole bestiary), quantized to 3 tones + ramp.

## 4. Craft pass

Architecture decision: **ordered rule pipeline** (predictable, debuggable,
each rule = detect + repair + property test), with a possible search-based
polish later (16×16 = 256 px — small enough for simulated annealing with a
cost of rule violations + raster fidelity + temporal coherence; only if the
pipeline plateaus).

Pipeline v1. Rule numbers below are stable names, but the *executed*
order is not 1-2-3-4-5. As built in Spike S3: quantize (1), then rules
2/3/5 iterated to a joint fixpoint, then selout (4) decided and applied
on post-merge geometry. The naive order fights itself (S3 finding F13):
every budget merge invalidates selout decisions made on pre-merge
geometry, and a merge can expose new orphans/jaggies that a single-shot
pass never revisits — both broke idempotence (2nd run ≠ no-op) until
reordered.

1. **Material/tone quantize** — done by rasterizer (majority vote).
2. **Orphan cull** — no 1px islands (S1 craft-lite ✓).
3. **Jaggy repair** — relax stair-step boundaries toward 1:1 / 2:1 runs;
   must respect cluster ownership (only moves pixels between the two
   adjacent clusters).
4. **Selout** — boundary-vs-transparent pixels take the material ramp's
   darkest tone (S1 ✓); interior boundaries between overlapping forms take
   a one-tone-darker edge on the *farther* form (depth is known — the
   renderer exports a per-pixel depth tag for this). Decided and applied
   after the 2/3/5 fixpoint, on post-merge geometry (F13).
5. **Cluster budget** — merge sub-threshold clusters into their dominant
   neighbor until ≤ N clusters (N: ~14 @32, ~7 @16). This is the rule that
   makes tiny sprites read as deliberate.
6. **Banding & pillow-shade lint** — detect parallel same-width tone bands
   along boundaries and concentric shading; repair by tone reassignment
   toward the light direction.
7. **Focal contrast check (S1 F5)** — focal materials (eyes, emitters) must
   differ from their backing material by ≥ 2 tones or get promoted to a
   glow ramp. Mechanical rule, outsized readability payoff.

All rules take (resolution, clip) context; per-clip decisions are made once
and applied to all frames (see design 03 §4 — anti-flicker).

Shared machinery (as built in Spike S3):

- **Cluster** = a 4-connected region of pixels sharing the same
  (material, tone) after quantization.
- **Cross-frame cluster identity:** the renderer exports per-pixel *part*
  and *depth* tags alongside material/tone; a cluster's clip-stable key is
  `(part_id, material, tone)`, where part_id is the majority part tag over
  the region's pixels. All clip-scoped merge/outline decisions are keyed
  by this.
- **Aggregates use presence-based medians:** per-key statistics are
  medianed over the frames where the key is *present*. Zero-inflating the
  absent frames deleted whole thin bodies whose majority part tag
  oscillates (S3, under F13).
- **F7 refinement (S3 finding F15):** the budget merge defeats F7's
  thinness test — once a thin body merges into one whole-body cluster, its
  bbox-min and size exceed the exemption thresholds, outline softening
  stops firing, and the body drowns in outline. At M1, selout decides F7
  exemptions from *pre-merge* part-level cluster stats, or from a
  local-thickness measure instead of bbox-min.

## 5. Palette engine

- Per-creature ramps generated from genome hue loci: 3–5 tones, hue-shifted
  (shadows cool, highlights warm), shared darkest tone as outline color
  (never pure black — a gene picks the outline's hue bias).
- Color budget: ≤ 10 @32×32, ≤ 6 @16×16 across the whole sprite — enforced
  by ramp sharing (belly ramp reuses fur ramp's ends etc.), then by craft
  rule 5.
- Faction palettes: a set-level base hue + allowed accent hues; creature
  hue loci are expressed *relative* to the faction palette, so a bestiary
  is related by construction and recolors (chromatic mutation) stay
  coherent.

## 6. The 16×16 problem (S1 finding F3 → Spike S4)

16×16 is a redraw, not a rescale. The model renders at 16 through a
**proportion remap stage**:

- head/eye scale up (genes: `remap.head_gain`, `remap.focal_gain`),
- ornament budget halves; sub-pixel ornaments are dropped, not rendered,
- limb girth clamps to ≥ 1px equivalent,
- gait amplitudes re-quantize to the coarser grid (a 2.1px step at 32
  becomes exactly 1px at 16, not 1.05).

Hypothesis for S4: with remap, 16×16 front views regain face readability
that naive 0.5× scaling loses (S1 showed side views survive but faces die).
