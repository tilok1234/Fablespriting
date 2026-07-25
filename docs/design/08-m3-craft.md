# Design 08 — M3 craft & palette maturity

> **DRAFT FOR OWNER REVIEW — M3 kickoff.** This contract is NOT
> normative until the owner green-lights it (the M2-kickoff
> precedent). Every **[OWNER-DECISION]** below carries a concrete
> recommendation and is presented at the doc review.

The M3 analogue of designs 06/07: the implementation contract for
ROADMAP Phase 3. Like them, it starts as architecture + policy pins and
grows normative sections **amended in the same change as the unit that
proves them** (07 grew §1.4, §2.3.1, §2.4.1, §4.4, §5.1, §6.1, §7.1
that way). Sections marked *pinned at unit start* name their evidence
source; nothing speculative gets constants here before a
machine-verified derivation exists.

Sources: ROADMAP Phase 3 (the Turing-sheet bar); design 04 §§4–5 (rules
6–7 and the palette engine as designed); design 02 §5 + CONCEPT.md §2
(FFF and palette/faction vision); design 01 §4 + design 06 §3 + design
07 §4.3 (the versioning corpus this doc must reconcile); design 07 §7.1
(the M2 acceptance record — the 16 flagged seeds, the taste backlog,
the distinctness numbers); the two external review artifacts —
`SabelFrite_U6_bestiary_review/VERDICT_response.md` (owner-submitted,
locked criteria, all 7 200 frames measured) and
`SabelFrite_U5_tags_review/_REVIEW_critique.md` (external critique:
its wire-format reverse-engineering is confabulated and its gene map
is NOT evidence, but two kernels were adjudged valid and are M3 scope
— per-tag palette payoff and tag-legibility scaling — and its px-diff
tables of our renders are usable measurements); src/ as of `74362d9`
(craft.ts, palette.ts, raster.ts, genome.ts, grammar.ts).

## 0. Scope

M3 is the craft milestone: the generator's structure is proven (M2:
three plans, tags, defenses, a 475-test suite green on two platforms);
what stands between it and hand-made work is per-pixel craft and color.
The owner's mandate on the M2 verdict was "let's fix them" — the 16
flags and the taste backlog are this milestone's opening work orders,
and the ROADMAP's blind Turing sheet is its only acceptance bar.

In scope, each with a home section and a build-order unit (§8):

1. **Frame-fit margin policy** (§2) — the quadruped side-view frame
   overflow: 15 of the 16 M2 flags, 44% of the sheet's quadruped
   population, the M1-era edge-touching geometry promoted to a fix
   (07 §7.1). Generator v3; the flagged seeds become regression
   fixtures.
2. **Anti-freeze sampling guards** (§3) — the frozen-oscillator family
   (s46 and the 15 single-freeze near-misses), additive-only.
3. **Palette engine breadth** (§4) — per-tag/material ramp
   differentiation (the headline: the biggest adjudged-valid kernel of
   the U5 critique), the spectral treatment decision, faction
   palettes, the glow ramp.
4. **Craft rules 6–7** (§5) — banding/pillow-shade lint and focal
   contrast promotion, as designed in 04 §4; the depth-aware selout
   refinement decision; the thin-part polish debt (1 px wire tail,
   levitant wisp gaps).
5. **Tag-legibility scaling** (§6) — a minimum-visible-effect law per
   (plan, tag) with a pinned measurement method.
6. **The Turing-sheet acceptance instrument** (§7.2) — a blind
   protocol executable by one hobbyist owner.

### 0.1 Standing laws (inherited, restated, not weakened)

- **16.16 fixed-point only** in core; floats only in throwaway spikes
  (design 01 §2, RISKS R6).
- **RHE machine-verified constants**: every pinned raw is verified
  against its authored derivation before pinning; derivations, not
  decimals, are the pins on 1-ulp disagreement (the M1 underside-line
  precedent, applied at U3/U4/U5).
- **Stream-keyed draws**: `hash(seed, locus_path, draw_name)` via
  PCG32, never a global sequence (design 01 §2, design 06 §4).
- **Append-only registry; existence-defaults-absent** (design 06
  §§2–3). Registry stands at ids 0..55 (07 §7.1); M3 appends from 56.
  Locus domains can never shrink.
- **The anchor-razor proof pattern** for every sampler- or
  render-touching change: capture a baseline corpus from the pristine
  committed build, prove byte-identity for everything the change
  claims not to touch (the U5 6003-entry precedent; the U6 60-entry
  spot check).
- **Byte-identity, defined once (every razor in this doc uses this
  definition).** The standing corpus format hashes sheet-RGBA AND
  canonical JSON per entry (07 §5.1), and `generator_version` is a
  top-level key of that canonical JSON (06 §6.3). So at ANY version
  bump every export's JSON bytes move, including for genomes the unit
  does not touch — an unqualified "JSON byte-identical across the
  bump" razor is unpassable by construction, not by defect. The
  razor therefore means, exactly (the 07 §4.3 anchor formulation,
  generalized): **(a) rendered pixel bytes (sheet RGBA, and the PNG
  where pinned) byte-EQUAL; (b) canonical JSON VALUE-equal modulo a
  declared permitted-diff set.** The permitted set is
  `generator_version` at a version-bumping unit, plus any additive
  metadata key the unit itself introduces — and a unit that introduces
  one must enumerate the affected corpus population and ship that
  enumeration as a reviewed diff (§3 is the only M3 unit that does).
  Nothing else may appear in a permitted set; an unexplained JSON
  value diff fails the razor.
- **No fabricated evidence**: unrun measurements are
  `[EVIDENCE-PENDING]`, never numbers; retained artifacts outrank live
  observations (the U6 §7.1 evidence-hygiene corrections are the
  house style).
- **Suite-budget accounting with honest gate rulings**: M3 opens at
  475 tests with retained full-suite walls of 185.5–281.0 s against
  the ~200 s guideline — the suite *straddles* the guideline (07 §7.1
  item 5), and whether ~211 s typical is inside tolerance is an
  explicit gate ruling this milestone's first unit close-out must
  make, not inherit silently. Scaled CI corpora with full sweeps as
  unit evidence remain the standing repair (the M1/U3/U5 precedent).
- **Per-(plan, clip) flicker gates** (07 §4.2 table). A pixel-breaking
  unit re-measures its plan's histograms; the one-step
  union-histogram recalibration is lawful only before that unit's
  goldens/qa pin (the U4/U5 lesson).
- **The qa/ reviewed-regeneration law** (07 §7 + §7.1 item 4): the
  three-leg hash guard stands; any change that moves a shipped byte
  must regenerate `qa/sheet_mix_0_99.*` and the guard fixture in the
  same commit — the regeneration diff is the reviewed artifact.
- **Hybrid workforce** (owner-approved 2026-07-17): implementers and
  fix agents run Opus; spec derivation, adjudication, verify lenses,
  and oracles run Fable. Agents never commit; the orchestrator gates,
  commits, pushes, and watches CI.
- **Review deliverables** go to Downloads with per-cell 4× PNGs, a
  labeled 3× composite, and per-cell clip GIFs at 140 ms (the standing
  format since U4).

### 0.2 Non-goals, with reasons

- **Breeding engine / crossover** — M5. The anim semantic map (07
  §2.5) remains data + integrity test, consumer-less.
- **Set-level readability solver, threat ladders, faction palettes
  end-to-end, export presets, GIF previews, CLI batch** — M4. §4
  ships faction palette *derivation* (caller-scoped, like FFF
  presets); the set-level allocator that assigns factions across a
  bestiary is M4's.
- **16×16** — never (owner decision D5, ROADMAP).
- **New body plans** (serpentine, radial, colonial, aberration) —
  deferred, unscheduled. M3's bar is per-sprite craft; plan breadth
  would dilute it. Design 02 §2 remains the menu.
- **Search-based polish** (design 04 §4's simulated-annealing option)
  — conditional non-goal. Trigger, pinned: only if the V6 dry-run
  (§7.2) lands below the bar AFTER V4+V5 close does a polish
  evaluation spike get scheduled; it is never a standing unit.
  **[OWNER-DECISION]** at that trigger point — recommendation: skip
  unless the dry-run misses by more than 10 points.
- **Partial alpha** — rejected permanently, resolved in §4.2 (M3-b).
  Binary alpha is a pixel-art-honesty pillar; both external reviews
  confirm 0 pixels with 0 < a < 255 across all shipped output.
- **Amorphous silhouette breadth** — deferred. The M2 verdict finds
  the amorphous silhouette vocabulary the narrowest of the three:
  "Not oatmeal, but it is the plan with the least headroom"
  (VERDICT_response.md, within-plan variety; design 07 §7.1
  paraphrases this as "the plan with least silhouette headroom" — the
  phrase is 07's, not the verdict's, and is quoted here to no other
  purpose) — four
  near-twin pairs at IoU distance < 0.05; "rounded blobs varying
  mainly in height and width", hue doing the individuality work —
  while every between-plan distance still exceeds every within-plan
  distance, so the family separation itself is proven healthy). This
  is grammar vocabulary work (ball
  count, profile variety), not craft; the tendril/ball count-locus
  tension (07 §2.3.1) is unresolved; and appends stay free later.
  **[OWNER-DECISION]** — recommendation: defer to M4 and let M3's
  palette + focal work carry amorphous individuality, re-judged on
  the Turing dry-run.

### 0.3 The M2 taste backlog, triaged

Every row of the verdict's backlog gets a home or a recorded deferral:

| backlog item (verdict) | disposition |
|---|---|
| 15 quadruped frame-overflow flags (s02 s05 s19 s22 s26 s29 s32 s35 s40 s42 s51 s53 s67 s69 s99) | §2 / V1 — regression fixtures |
| s46 double-frozen oscillators | §3 / V2 — fixture |
| edge-contact near-misses s00 s01 s11 s28 s48 s74 s81 s83 s95 | §2 / V1 — the margin law covers light contact; joins the fixture corpus |
| single-frozen-anim seeds s01 s16 s18 s19 s28 s30 s31 s45 s60 s64 s70 s76 s83 s95 s99 | §3 / V2 — the guard bar clears these too (the verdict's own expectation) |
| 1 px wire tail (34/72 frames on s06 s17 s28 s60 s95; 25/72 on s53) | §2 / V1 (geometry floor) + §5 / V5 (outline residual) |
| levitant wisp gaps, 1–3 px specks ~36/72 on s55 s56 s76 | §5 / V5 — evidence-first repair |
| featureless amorphous s20 s59 s65 s86 s93 | §4+§5 / V3+V5 — rule 7's focal promotion is aimed at exactly this five-seed corpus |
| lumpy quadruped silhouettes s11 s37 s81 | carried, not owned by a mechanism: silhouette shape is grammar vocabulary (M4), but all three seeds sit in V1's blast radius (s11 and s81 are also edge-contact fixtures) and V3+V5's palette/focal work is the craft-side lever. Disposition: **no law pinned**; the three seeds join the V6 dry-run's judged set and are re-read there, and any residual lumpiness is recorded as an M4 grammar-vocabulary row rather than silently dropped |
| single-frame chunk detach s17 (18 px), s77 (25 px), s58 (tusk-read) | recorded V5 watch item; no law pinned (the owner spared them) |
| amorphous silhouette headroom | deferred (§0.2) |

## 1. Versioning policy (decision M3-a — resolved)

**The tension, stated honestly.** Design 01 §4 promises "a DNA string
pasted into any future build renders pixel-identical" via kept
growth-rule tables. The practiced precedent is different: U2 bumped
`GENERATOR_VERSION` 1→2, kept NO v1 render path, and proved instead
that the v2 build renders v1 genomes' walk/idle region byte-equal to
the committed M1 fixtures (07 §4.3 anchors). M3's frame-fit and
palette changes are the first changes that alter pixels for
already-issued genomes — the letter of design 01 §4 and the practice
can no longer coexist unexamined.

**Ruling: codify the U2 practice.** Rejected: full kept-version render
tables (design 01 §4's letter). The "tables" fiction died the moment
behavior lived in code paths (craft fixpoints, snap rounding, the
metaball march) rather than rule parameters — keeping v2 rendering
alive beside v3 means a frozen parallel copy of craft/raster/pose
under permanent test, roughly doubling the suite the budget law
already shows straddling its guideline (§0.1). Rejected: the scoped
middle (geometry tables kept, craft/palette not) — it preserves the
cost without delivering the promise, since a "geometry-correct,
craft-different" render is not pixel-identical to anything. The
codified law:

The codified law splits design 01 §4's two conflated promises — a
**wire promise**, kept at full strength, and a **render promise**,
restated to what is true:

1. **Determinism promise (render, amended form):** same DNA + same
   `GENERATOR_VERSION` → identical output bytes, on every platform,
   forever. Every export is version-stamped (the JSON already carries
   `generator_version`). Cross-version pixel identity is NOT promised;
   where a change intends to leave a region untouched, the
   anchor-razor pattern is the instrument that proves it.
2. **Version bump law:** `GENERATOR_VERSION` increments at EVERY unit
   that changes any RENDERED byte, or any existing JSON value, of
   output for a previously-valid genome — never mid-unit, never
   silently. Two carve-outs, both precedent, both narrow: adding
   output for previously `UpgradeRequired` inputs (the U3/U4 pattern)
   does not bump; and **appending a declared additive metadata key to
   the manifest does not bump** — the U5 `degenerate` / U2 `flash`
   precedent (07 §5.1: a degenerate genome's canonical JSON gains a
   top-level key, absent when false, landed with no bump), which this
   law would otherwise retroactively condemn. An additive key is only
   inside the carve-out if it is absent-when-empty, changes no
   rendered byte and no existing JSON value, and ships with the
   affected-population enumeration the §0.1 razor definition demands.
   M3
   expects three bumps: **v3** (V1 frame-fit geometry), **v4** (V3
   palette), **v5** (V5 craft) — one honest integer per pixel-breaking
   unit, because two builds with different pixels must never share a
   version stamp (that is requirement 1's whole content). A single
   milestone-wide "v3" whose bytes moved between units would make the
   (DNA, version) → bytes function a lie inside the project's own
   public tree.
3. **Old versions render via git history.** The repo is public and
   MIT; each version's final build is the tree at its close-out
   commit, named in this doc's §8 table as units close, and
   additionally pinned by git tag (`generator-v2` at the pre-V1
   commit; `generator-vN` at each subsequent close-out). No in-tree
   parallel render path exists for any old version.
4. **Anchors prove unchanged regions.** Every bump lands with an
   anchor-razor corpus proving byte-identity of everything the unit
   claims not to touch (§2/§4/§5 name theirs), plus re-pinned goldens
   and the §0.1 qa regeneration in the same commit.
5. **Genome (wire) version stays 1** — the wire promise unweakened:
   every M3 registry change is an append with an absent-meaning
   default (design 06 §3 law); every issued DNA string keeps decoding
   forever. Domains never shrink (§2 and §3 depend on this).
6. **Superseded anchors retire on record.** The 07 §4.3 M1 anchors
   (v1 pixel-region byte-equality against committed M1 fixtures)
   cannot survive v3 for fitted genomes. At V1 they are audited: the
   still-true part is re-scoped to the §2 byte-stable partition, the
   rest is retired in the V1 amendment — leaving them in the tree as
   vacuously-passing tests would be fabricated evidence by omission.

**Three pinned passages must be amended to this wording in the same
commit that lands V1** — the promise as written becomes false the
moment v3 ships, and a design doc that overpromises is a defect (this
is the M2-kickoff honesty discipline applied to our own past text).
Leaving any one of them un-amended leaves a contradicting normative
text in a public tree, which is the same defect wearing a different
file name. The amendment set is pre-agreed here:

- **design 01 §4** — replace the kept-tables policy and the "a DNA
  string pasted into any future build renders pixel-identical"
  sentence with the wire/render split and points 1–6 above, citing
  this section.
- **design 01 requirement 5** ("Versioned — old strings keep rendering
  identically as the generator evolves") — restate to the wire
  promise: old strings keep DECODING forever, and render identically
  under the version they were issued against (build recoverable from
  git history / tag). Requirement 1 ("same DNA + generator version →
  identical output bytes") is already exact and stands unchanged.
- **design 06 §3.3** — the parenthetical "which is what lets *new*
  builds keep old strings pixel-identical (design 01 §4 promise;
  additive appends never bump the version, behavioral changes do and
  freeze the old table)". The `UpgradeRequired` rule it explains is
  correct and stays; the "freeze the old table" clause IS the
  kept-tables policy this section rejects and must be replaced by the
  version-stamp + git-history formulation (points 2–3), including
  law 2's metadata carve-out.

**[OWNER-DECISION]** — ratify this
stance at the doc review; it retracts a stated public promise (MIT
repo). Recommendation: accept — the alternative is a permanent frozen
render fork with doubled goldens and two-platform CI that nobody will
ever run in preference to `git checkout`, and the wire promise (every
issued DNA string decodes forever) is kept at full strength.

## 2. Frame-fit margin policy (decision M3-c — resolved) — *the quadruped geometry unit, V1*

**Evidence.** The U5 external critique first measured it; the M2
verdict quantified it against locked criteria: the quadruped side-view
body exceeds its 32 px frame — snout sliced flat at x = 0, tail off
x = 31, the `y = 19` row spanning all 32 columns — on 44% of the
sheet's quadrupeds; 15 of the 16 M2 flags (07 §7.1). The geometry has
carried since M1 ("present and accepted since M1, now promoted to a
fix" — the close-out commit). Root cause is arithmetic, not chance:
the length-coupled anchors (head center HY = 8.3 + σ 71572·ΔL, tail
center TY = −8.8 − ΔL, grammar.ts) with `body.core.length` ∈ [4, 12]
(default 7.6), `body.head.snout_len` ∈ [1, 4], `body.tail.length` ∈
[1.5, 6] put the snout front near +20 px and the tail tip near −19 px
at domain corners — a ≈39 px rest span in a 32 px frame, before gait
deltas. Long bodies are common, not corner-rare; hence 44%.

**The margin law (normative from V1).** For every genome, every
direction: the rendered bbox of every **walk and idle** frame
satisfies `1 ≤ x_min` and `x_max ≤ 30` (≥1 px clear on both vertical
edges — the critique's pinned acceptance criterion, and the weakest
law that zeroes every one of the verdict's slice/span/edge-contact
findings). The x-axis is the law because it is the measured failure
axis; the y-axis stays governed by the standing in-frame corner-sweep
guarantees (07 §2.3.1/§2.4.1 — the critique confirmed 11 unused rows
on the failing cells), with a y-margin measurement recorded at V1
before any y-law is considered (the shipped levitant bottom corner
sits at 0.63 px snap margin — a blanket 1 px y-law would retroactively
outlaw accepted geometry, so it is not pinned here). One-shot clips (attack,
hurt, death) get a transient allowance *pinned at unit start* from the
post-fit sweep — a pure proposal with NO shipped ink precedent behind
its size. (The one shipped rendered-ink edge record, 07 §6.1's
profile-view maw at core-length-hi corners "the max-length head
already carries the muzzle past the canvas edge", is unquantified; the
±1 px number in that same note is a HITBOX overhang and is not
evidence about ink. Conflating the two would be exactly the citation
slippage the no-fabricated-evidence law forbids.) Whatever the
allowance, the verdict's slice criterion (≥4 consecutive body rows
flat against a frame edge) must measure ZERO on all clips of all
sampled genomes. The law binds **rendered ink only**; hitboxes stay
free to overhang the frame (the shipped U5 behavior, 07 §6.1 canvas
note, ±1 px at default quadruped attack-f1 — reconciled here so the
two rules cannot be read against each other). The law covers all three
plans, but its status differs per plan and the difference is
**[EVIDENCE-PENDING]**, not assumed: the levitant/amorphous corner
sweeps (07 §2.3.1/§2.4.1) prove ≥ 0.5 px SNAP margin inside the 32×32
frame, which is strictly weaker than `1 ≤ x_min ∧ x_max ≤ 30` — a slab
edge between 0.5 and 1.0 px inside the canvas can still ink column
0/31 under the 0.42 coverage threshold with supersamples at
±0.125/0.375. (This doc already respects that gap on the y-axis for
the levitant's 0.63 px bottom corner; assuming it away on x for the
same two plans would be evidence laundering.) **Pinned V1
measurement:** re-run the levitant and amorphous corner products
reporting worst `x_min`/`x_max` per plan against the margin law, BEFORE
the law is asserted in CI. **Pinned fallback if a corner violates:**
the choice — a recorded per-plan exemption at the measured worst
value, or extending §2's compressive coupling mechanism to that plan's
x-extent chain — is made on the measured number at unit start and
amended here; the mechanism is preferred where the violation is a
population, an exemption where it is a domain corner no sampled genome
reaches (the U3/U4 precedent for corner-only findings). Gate (a) is
therefore not allowed to be discovered unpassable mid-unit.

**Mechanism ruling: re-derived length couplings with a compressive
soft-knee — fit by construction.**
Rejected: **reject/re-roll** — at a 44% failure rate the re-roll is
the sampler (massive distribution distortion, and it punishes exactly
the long-bodied variety the plan should keep); it also guards only the
sampler while a hand-edited length-12 tape still overflows. Rejected:
**camera scale** — shrinks every already-accepted creature to fix a
subset; mixed scales across the bestiary read as mixed art styles
(P2's logic). Rejected: **domain narrowing at v3** — illegal
regardless of the version bump: the wire registry (genome version 1 —
§1 law 5) governs decode and 06 §3.3 rejects out-of-domain values, so
narrowing `body.core.length` would make issued DNA strings malformed —
worse than any pixel change; it would also flatten the plan's variety
instead of fitting it. Rejected: **derived per-genome
`FIT = fp_div(SPAN_BUDGET, span)` clamp with identity when in-frame**
— superficially attractive (maximal byte-stability: every in-frame
genome unchanged), but identity all the way up to the budget forces
every overflowing genome to land at exactly `SPAN_BUDGET`: the top
44% of the length distribution collapses onto a single visible
nose-to-tail span. That is flattening dressed as a fix — the sheet
would read "many creatures exactly frame-wide" — and it adds a
permanent runtime special-case branch to growth. Chosen:

- **Re-derive the quadruped's length-additive extent contributions**
  — the length-coupled anchors (HY, hipYFore/hipYHind, TY) and the
  additive snout/tail terms — as piecewise couplings: **identity at
  and below a knee** (raw *pinned at unit start* from the derivation;
  it must at least cover the default population) and a
  **strictly-monotone compressive map above it**, asymptoting inside
  `SPAN_BUDGET` (the 30-column budget in model units, *pinned at unit
  start* — it must price projection and snap margins). This is the
  house method, twice proven: the U3 §2.3.1 damped-coupling + corner
  sweep resolution ("depth still reads; homology stays honest"
  transfers verbatim to length), and grammar.ts already ships a
  damped, sweep-optimized coupling (the amorphous drip rest-y,
  σ −0.6 DAMPED).
- **Fit by construction, machine-verified:** a §2.3.1-style
  corner-product sweep on the production fp path, every walk/idle
  phase, all four views, showing the domain-worst posed extent inside
  the margin law with ≥1 px to spare. **The sweep's factor list is
  DERIVED, not guessed** — it is an audit obligation discharged at
  unit start: enumerate every locus that contributes side-view x
  extent and put each in the product. The starting list is length ×
  head scale × snout × tail × gait-swing extremes (the margin law is
  over POSED extents, so the walk/idle amplitudes are in the product)
  — and it is already known incomplete: the quadruped maw emitter
  (grammar.ts `mawChoice`) fires along the facing axis from
  `snoutFront`, reaching `snoutFront + 2·hy_e − EMIT_EMBED`, with
  `hy_e` driven by the free registry axis `body.emitter[C].size`
  (id 52) — present on 33.9% of ambient genomes (07 §7.1), i.e. a
  common measured x contributor, not a corner curiosity. Ornament slot
  placements and ear/horn geometry are unaudited and must be audited
  the same way. Either every such contributor enters the product — and
  then "every genome, every direction" is proven — or the universal
  claim is honestly re-scoped at unit start to *the swept product plus
  the sampled sweeps*, with the un-swept contributors named. The
  audit's outcome is amended here; the doc will not ship a universal
  claim over a partial product. (§3's opposite stance for hand-edited
  DNA — freeze surfaces as metadata, never an error — is not in
  tension once this is explicit: §2's law is enforced by construction
  over the geometry domain, so a hand-edited tape inside the registry
  domains is covered by the same proof, while §3's property is a
  sampler-time statistic that no construction can guarantee for
  arbitrary tapes.) No per-genome runtime clamp exists; growth stays
  draw-free on the default path (every stream-keying invariant
  untouched).
- **Order preservation is law, in the form fixed-point can actually
  carry:** for any two genomes, `span_a < span_b` under the old
  couplings implies `f(span_a) ≤ f(span_b)` under the new — NON-strict,
  evaluated on the raw 16.16 pre-snap span. The longest genome still
  renders at least as long as any shorter one; the ordering never
  inverts. Strict injectivity is deliberately NOT claimed and must not
  be re-added: any compressive segment whose local slope falls below
  1 ulp/ulp maps consecutive representable inputs to the same output
  by fp_mul rounding alone, an asymptote saturates at ulp granularity
  by definition, and post-snap the visible span is an integer count of
  pixel columns — a span domain of a few px already collapses onto
  ≤ 31 distinct rendered spans TODAY, before any of this work. A gate
  asserting "no two distinct spans map to one" would fail on any
  honest implementation, or force a non-compressive map that breaks
  the budget. What replaces it, and what the sweep actually asserts:
  (i) non-strict order preservation over the swept product; (ii) a
  **resolution floor** — a *pinned at unit start* minimum rendered-span
  separation stated on an explicit grid (proposal: distinct rendered
  span, in whole pixel columns, for inputs separated by a pinned raw
  Δ across the length domain), so the compression's coarseness is a
  measured number in this doc rather than an adjective. The px dynamic
  range compresses; 32 px forces that on any honest solution.
- **The honest price, stated:** strict ordering above the knee means
  genomes between the knee and the budget — in-frame today —
  compress slightly too. The **byte-stable partition** is the
  quadruped population that is BOTH at-or-below the knee AND
  at-or-above the tail-root girth floor (the second mechanism below,
  which rides this same bump), plus the levitant and amorphous plans
  (their geometry untouched). The tail floor is in the partition's
  definition because it moves rendered bytes for any quadruped whose
  `body.tail.girth` sits under it — below-knee genomes included, and
  the six carrier seeds prove that is a real population rather than a
  domain corner — so a partition defined on the knee alone would fail
  its own razor by construction. That partition, so defined, is this
  unit's anchor razor — the 0..1999 mix sweep partitioned into
  (below-knee ∧ at-or-above-floor quadrupeds + other plans:
  byte-proven identical to v2 **in the
  §0.1 sense — rendered bytes equal, JSON value-equal modulo
  `generator_version`, which moves in every export at a bump by
  construction**) and (fitted and/or floored: the review population).
  Proportions shift honestly (a
  fitted 12-length wolf reads stockier); the alternative was a
  sliced face — expectation set in the review delivery note.
  **[OWNER-DECISION]** (taste, ratified at the V1 before/after
  review): the max nose-to-tail shrinks from ~39 px (overflowing) to
  ≤30 px — long bodies WILL read shorter. That is the 32 px frame's
  arithmetic, not a style choice; the decision is the compression
  look on the 24 fixture genomes, judged on pixels.

**Rides the same v3 bump (scope-coherent quadruped geometry):** the
wire-tail root floor. `body.tail.girth` ∈ [0.6, 2] px halves (id 34);
at the low half the tail renders as the verdict's 1 px outline-less
wire (F7's thin-part exemption correctly withholds the outline — the
geometry is the defect). Mechanism: a growth-time floor on the tail
slab's cross-extents (the M1 eye-floor mechanism, third application —
`max(fp_mul(…), FLOOR)`), root ≥ 2 px rendered thickness; FLOOR raw
*pinned at unit start* against the six carrier seeds. Identity above
the floor keeps thick-tailed genomes byte-stable — and ONLY those:
a below-knee quadruped with a sub-floor tail moves bytes here, which
is why the byte-stable partition above is the intersection of the two
conditions and not the knee alone.

**Gate.** (a) Fitted sweep 0..1999 mix: zero margin-law violations,
zero slice signatures, on every clip per its allowance. (b) The
unchanged-partition anchor razor: byte-identity proven, not assumed.
(c) The 24 regression fixtures — the 15 flagged + 9 edge-contact
genomes pinned **by DNA string** (frame-fit is a render-level fix: the
same DNA must now render in-frame; pinning seeds would couple these
fixtures to §3's sampler change) — render in-frame in CI forever.
(d) Quadruped flicker histograms re-measured; any gate motion is the
one-step pre-pin recalibration (§0.1). (e) `GENERATOR_VERSION` → 3;
design 01 §4 amended (§1); goldens re-pinned by ritual; qa regenerated
same-commit. (f) Owner before/after review: the standing Downloads
format, paired composites of the 24 fixture genomes at v2 vs v3 — with
the framing stated in the delivery note that v2 cells are the known
defect, not a candidate (expectation-setting rule).

## 3. Anti-freeze sampling guards — *V2*

**Evidence.** The M2 verdict: 17 of 100 sheet genomes carry ≥1
animation frozen in all 4 directions; 2 carry two (both flagged; s46 —
levitant, chitin — is the surviving M3 case, the 16th flag). The idle
row absorbs 102 of 126 frozen slots, and a frozen idle is a real
static animation (its running amplitude averages 56 px/frame, on par
with walk). Structural roots are recorded, not new: the integer
frequency loci have members that zero every sampled sine at K = 4 —
`gait_freq` 2 (id 7), `hover_freq` 2 (id 36), `flap_ratio` 2 (id 38),
`pulse_freq` 2 (id 47) — the gait_freq-2 precedent family (06 §1.6,
07 §2.3.1/§2.4.1), compounding with zero-reaching amplitude domains
(`bob_amp` lo = 0, etc.). Freezing is a combo property of several
loci, so the guard must test the OUTPUT, not a locus table.

**The freeze census (normative, pure).** A clip is *frozen* for a
genome iff for every direction its K **snapped** posed slab lists are
identical — post-snap pose-level equality, still no raster needed
(the §5.1 self-check precedent of judging the genome by its own
pipeline). Post-snap, not raw-fp, because the verdict's instrument
and the viewer both judge rendered frames: an oscillation below the
snap-visibility floor is exactly as dead as an exact zero, and a
raw-fp census would wave it through. `freezeCensus(genome)` = the set
of frozen clips among [walk, idle, attack, hurt, death]; the full
census is recorded, the **guarded set is {walk, idle}** (the verdict:
idle absorbs 102 of 126 frozen slots and a frozen idle averages
56 px/frame of withheld motion; one-shots ending in held poses are
design, not defect), **minus a plan-aware structural-exemption
table** *pinned at unit start* from a measured 0..1999 per-plan
liveness census run BEFORE the guard is written (the band-table
method). Census first, guard second — a liveness a plan structurally
lacks (the pinned levitant idle wing-freeze rule is part-level and
must not trip a clip-level guard; any sub-snap template motion found
by the census gets an exemption entry, not a re-roll) would otherwise
send whole plans into vain re-rolls, the exact failure the U5
protocol's census-first discipline exists to prevent.

**The guard (additive only — nothing shrinks).** Registry domains,
the wire surface, and the plain default path
(`sampleGenome(seed, plan)`, no opts) are untouched: hand-edited DNA
may still freeze — it surfaces as manifest metadata, never an error.
The guard runs where the U5 self-check already runs — sampler-time in
tag/preset/mix modes (`sampleBestiary` included) — as a second check
in the §5.1 re-roll protocol, verbatim machinery: on census non-empty,
re-draw the plan's ANTIFREEZE set (its frequency loci + the amplitude
and lag loci that feed the frozen clips' oscillators; per-plan sets
*pinned at unit start*) from `stream(seed, locus_path,
"antifreeze:i")`, i = 0..R_AF−1, first empty-census genome wins,
accept-and-tag after the cap (an additive `"frozen": [clips]` manifest
key, absent when empty — the `degenerate`/`flash` precedent; never a
silent loop, design 05 §1).

**R_AF is derived, not proposed — and the arithmetic is why.** The
R_SC precedent's 2 cannot simply be copied: R_SC never fires in
production (07 §5.1: 0 re-rolls over 9 600 mode genomes), whereas this
guard fires on the measured ~17% of genomes carrying a guarded freeze.
Re-drawing the ANTIFREEZE set from FULL domains re-includes the
freezing members, and the domain masses are stated per locus because
they are NOT uniform: `gait_freq` (id 7), `hover_freq` (id 36) and
`pulse_freq` (id 47) are int [1, 2], so the freezing member 2 carries
HALF of each domain's mass; `flap_ratio` (id 38) is int [1, 3]
default 3 (07 §2.3.1 locus table; src/genome.ts), so its freezing
member 2 carries a THIRD. Either way a full-domain re-draw re-freezes
at the same ORDER as the base incidence rather than at a negligible
rate — order 0.1–0.2 per retry on this arithmetic, with the levitant
flap component at the low end of it. This is an order-of-magnitude
sketch, not a pin: the amplitude and lag loci compound it, plan
incidences differ, and only the measured census settles the number. At
R_AF = 2 the expected cap-exhausted (tagged) genomes over 0..1999 are
of order 2000 × 0.17 × 0.17² ≈ 10, i.e. the unit's own close-out sweep
would be EXPECTED to miss the strict empty-census bar below. Two
pinned consequences:

1. **R_AF is pinned at unit start FROM the measured pre-guard census**
   (the same census-first run that produces the exemption table), with
   an explicit target of **zero cap-exhausted genomes on the 0..1999
   corpus** — which the order-of-magnitude sketch above puts at 5–6
   under full-domain re-draws, not 2. The measured per-retry recurrence
   and the resulting R_AF are amended here.
2. **Permitted alternative, if the derived R_AF is unpalatably large:**
   re-draw the frequency loci from the live SUB-domain (excluding the
   member that froze this genome's guarded clip) rather than the full
   domain — noting that the saving is per-locus and unequal, since the
   sub-domain is a single member for the three int [1, 2] loci but
   {1, 3} for `flap_ratio`, which is itself a reason the choice is made
   on the measured census rather than on this sketch. This is legal and
   is not a domain shrink: the wire registry
   and every locus domain are untouched (§1 law 5), the plain default
   path never runs the guard, and the narrowing exists only inside
   this sampler-mode retry — the same class of sampler-side
   restriction the tag/preset weight tables already ship. Choosing it
   is a unit-start ruling recorded with the census.

**If the close-out sweep still misses (ruling, pinned now so it is
not made under gate pressure):** a non-zero tagged residual does NOT
get the bar lowered retroactively and does NOT get R_AF raised after
the sweep and re-run until green (that is bar-shopping). It is either
(a) a structural liveness the exemption table should have carried —
in which case the exemption entry is added, justified from the census,
and the sweep re-runs once, or (b) a genuine residual — in which case
the residual genomes are enumerated in this doc with their census,
the bar is amended to "empty guarded census except the enumerated
structural residual", and the amendment ships as reviewed evidence.

**Bar: the guarded census must be EMPTY on every sampled genome** —
this clears
s46 AND the 15 single-freeze near-misses, which is the verdict's own
stated expectation ("the anti-freeze guard also cleans up the 15
near-misses"). **[OWNER-DECISION]** — the lenient alternative (allow
one frozen clip, matching only the flag criterion) moves fewer seeds'
genomes; recommendation: the strict bar — the owner already asked for
it, and a static idle is the sheet's most visible dead-air.

**Consequences, stated honestly.** A sampler change moves the
seed→genome mapping for affected seeds only (~17% of the sheet class);
no rendered byte and no existing JSON value moves for a fixed DNA, so
NO `GENERATOR_VERSION` bump — lawful under §1 law 2's additive-metadata
carve-out, the U5 `degenerate` precedent exactly. **The `frozen` key's
blast radius, declared:** it is an export-time manifest key, so any
already-valid DNA whose guarded census is non-empty gains it — and
freeze is a pure function of DNA, untouched by a sampler-only fix, so
this is NOT an empty set: on the order of 17% of the fixed-DNA anchor
corpus entries (the verdict's 17/100 incidence; the exact affected
entry list is enumerated at unit start and ships as the reviewed
diff the §0.1 razor definition requires). The razor is therefore
stated in the §0.1 form, not as naked byte-identity: a fixed-DNA
anchor corpus renders **pixel-byte-identical** across the change (the
render function untouched, machine-proven, not argued) and its
canonical JSON is **value-identical modulo the declared `frozen`
key**, with the key's carriers enumerated; separately, the DNA razor
proves every untriggered seed's DNA byte-identical. The qa sheet, fingerprints, and mix-sequence fixtures
regenerate same-commit under the §0.1 guard law. The re-roll
machinery itself is unit-vector-proven by injection (the U5 §5.1
pattern: a synthetic frozen draw must trigger, re-draw on the pinned
stream, and tag on cap). Fixtures pin **by seed** (the fix is
sampler-level): seed 46 and the 15 near-miss seeds assert empty
guarded census post-guard; CI asserts it over the scaled mix corpus
and the 0..1999 close-out sweep asserts it in full.

## 4. Palette engine breadth — *V3*

**Evidence.** The U5 critique's part-B measurement (adjudged valid),
restated exactly as measured: across the 27 `p_*` cells at seed 7 the
entire set uses **8 RGB values**; per plan the color set is identical
for baseline and all 8 tags; within a single seed the tag palettes are
byte-identical **up to one exception — `spectral` adds at most one
extra near-black outline shade (`1e1622`)**. So the honest statement
is "identical modulo spectral's single extra outline entry", not
"every tag byte-identical" — and the correction does not rescue
anything: one extra outline shade is still under the ≥2-RGB-entry
payoff bar §4.1a pins below, so the gap the law exists to close is
exactly as measured. The cause is by design: M2 deliberately kept tags
out of color (07 §0 non-goal). The M2 verdict confirms the seed-driven system
itself is healthy (94 distinct dominant body colors across 100, full
hue coverage) and names the remaining gap precisely: "spectral still
is not translucent — that remains M3 item 1's business." M1's
derivation (design 06 §1.3, palette.ts) is three role ramps from four
loci with pinned role constants (hide S 0.41 / V 0.58, underside
S 0.30 / V 0.77, outline hue −84.0° S 0.37 / V 0.18) and the constant
4-entry FOCAL_RAMP.

### 4.1 Per-tag material ramps

The role constants become **per-material rows**: a table keyed by tag
(chitin, fleshy, spectral, mechanical, verdant) giving each role's
(S, V, hue-offset, outline S/V) — the material read design 04 §5
always intended, expressed inside the existing exact-integer HSV
derivation (no new arithmetic class). The **neutral row IS the M1
constant set, byte-for-byte**, and tag-less genomes take it — so the
all-defaults goldens of all three plans (empty tag set), as they
stand at V3's open, are this unit's anchor razor: byte-identical
across the v4 bump **in the §0.1 sense** — rendered bytes byte-equal,
canonical JSON value-equal modulo `generator_version` (which moves in
every export at a bump by construction, so an unqualified claim here
would be unpassable) — machine-proven.

Two-tag genomes (45/100 on the pinned sheet; 1027/2000 on the
close-out sweep — 07 §7.1): **the primary tag styles the
hide ramp, the secondary styles the underside ramp** (pinned proposal:
primary = lowest tag id, the §6.1 conflict-rule precedent); single-tag
styles both. This makes the second tag *visible in color* — the
verdict found dual-tag genomes cleaner than single-tag; this
compounds that. **[OWNER-DECISION]** (taste) — judged at the V3
mini-sheet; fallback: primary styles both.

Row raws are taste constants *pinned at unit start* — from a
**rendered candidates board** (**[OWNER-DECISION]**, resolved at V3
unit start: 2–3 profile candidates per tag on fixed seeds, delivered
to Downloads; the owner picks per tag, and the pick is then
machine-verified in-gamut and against both laws before pinning) — under two laws: (a) **the payoff law** — for any fixed
seed, any two materials' derived palettes differ in ≥2 RGB entries
(the critique's minimum bar, CI-asserted across all tag × plan × a
pinned seed slice); (b) **the budget law** — ≤10 colors per sprite at
32×32 (design 04 §5) enforced by ramp sharing + rule 5, CI-counted by
census across all 1- and 2-tag combinations **including glow-promoted
cells** (until V5 the glow ramp has no consumer; the combo census
re-runs at V5's gate), not just the qa corpus.

### 4.2 Spectral treatment (decision M3-b — resolved)

Partial alpha does not exist and will not (§0.2): binary alpha is
what makes the output honest pixel art, and both reviews measured the
pipeline keeping that promise. Rejected: **dither-pattern
translucency** — at 32×32 a checker reads as noise at 1×, it
manufactures exactly the 1-px islands rule 2 exists to cull and the
sub-size clusters rule 5 exists to merge (a craft-exemption hole for
one material is a structural lie), and alternating coverage across
frames is a flicker-metric time bomb. Rejected: **outline-only
ghosting** — deletes the body mass that carries silhouette
distinctness, the M2 acceptance's proven asset. **Chosen: the ghost
ramp** — spectral's material row reads translucent the way pixel
artists actually fake it: desaturated, high-value body tones,
cool-shifted hue, and critically a **lightened outline slot** (the
near-black outline is what sells solidity; spectral's outline rises
toward a mid-tone); spectral focals are first in line for rule 7's
glow promotion (§5.2) once it lands. Raws *pinned at unit start* via
the §4.1 candidates board (the spectral row's board renders the
chosen ghost ramp beside the two rejected treatments on fixed seeds —
the owner's final look call is made on pixels, not prose); the payoff
law covers it; craft, flicker, and cluster machinery see nothing
unusual.

### 4.3 Faction palettes and the glow ramp

- **Faction palettes** (design 04 §5, design 02's recolor vision): a
  faction = a named set-level base hue + accent rotation, applied by
  expressing the creature's `palette.base_hue` RELATIVE to the
  faction base at derivation time. Caller-scoped exactly like FFF
  presets (a designer input, absent from the ambient mix and from
  `sampleBestiary` — the U6 presets-don't-enter-the-mix ruling's
  logic): CLI `--faction <name>`, mutually exclusive with `--mix`.
  Roster (names + base hues) is a taste table *pinned at unit start*;
  proposal: 4 factions + the implicit "wild" (no faction).
  **[OWNER-DECISION]** — roster size and hues; recommendation: pin 4,
  judged on a faction-recolor strip in the V3 mini-sheet. Chromatic
  mutation coherence (design 01 §3) is the M5 consumer; M4 wires
  set-level allocation.
- **The glow ramp**: a second pinned constant table beside FOCAL_RAMP
  (same 4-entry shape, F16 merge-protection inherited) — landing here
  as data because it is rule 7's promotion target (§5); no consumer
  until V5. High-value, high-saturation; raws *pinned at unit start*.

**Gate.** Payoff + budget laws CI-green; all-defaults goldens
byte-identical in the §0.1 sense (the empty-tag razor: rendered bytes
equal, JSON value-equal modulo `generator_version`); the
**alpha-channel razor** —
palette is strictly tone→RGB, so every corpus cell's alpha bytes are
byte-identical across the v4 bump, machine-proven (an honest
blast-radius proof for a unit that recolors everything); a spec-time
audit pins whether the flicker metric consumes RGB distance or
alpha/cluster structure — if the latter, V3 is flicker-inert and that
is a free razor; if RGB-weighted, histograms re-measure under the
standing one-step pre-pin recalibration; `GENERATOR_VERSION` → 4;
goldens + qa re-pinned by ritual. Owner mini-sheet: the U5 27-cell format re-rendered
(3 plans × [baseline, 5 tags, 3 presets] at seed 7 + the variety
strips) — a direct before/after against the U5 review that first
exposed the gap, plus the faction strip.

## 5. Craft rules 6–7, selout refinement, thin-part polish — *V5*

The craft pass as built (design 06 §1.5, craft.ts): quantize → rules
2/3/5 to a joint fixpoint → F15 part-level exemptions pinned at the
fixpoint → rule 4 (selout) decided and applied post-merge; idempotence
is a hard contract. **Focal's protection, stated as built** (rules 6–7
integrate into this, so an inflated version of it would mis-specify
them): focal pixels are never culled, never merged away, and never
recolored away from focal — rule 2 skips focal clusters, F16 protects
focal from merge, and rule 3's exemption is explicitly ONE-SIDED
(craft.ts `rule3Jaggy`: "rule 3 may grow a face, never shrink it" — a
non-focal tooth may adopt a focal donor). Focal is NOT untouched by
every rule: rule 4 (selout) does edge focal pixels, and an edged focal
pixel takes the focal table's own slot 0 rather than the shared
outline (design 06 §1.5 / palette §1.3), so its rendered color changes.
Rule 7 (§5.2) promotes focal clusters into a different ramp entirely
— which is a change to focal pixels by design, and is only coherent
against the accurate baseline.

### 5.1 Rule 6 — banding & pillow-shade lint

As designed (design 04 §4): detect parallel same-width tone bands
along boundaries and concentric ("pillow") shading; repair by tone
reassignment toward the global light direction. Clip-scoped like every
craft decision (detect on clip aggregates, apply to all K frames).
Placement in the orchestration, pinned: **after the 2/3/5 fixpoint,
before the F15 stats and selout** — rule 6 reassigns (role-internal)
tones only, so opacity and partId are untouched (no new orphans, no
part-stat motion), but cluster KEYS move, so the pass re-enters the
2/3/5 fixpoint once after rule 6 and idempotence is the proof the
ordering works (the F13 lesson says the naive order will fight itself;
the second-fixpoint-then-prove structure is that lesson applied in
advance). Rule 6 enters with a **convergence argument** (repairs move
monotonically toward the light-direction tone ordering; each pixel is
reassigned at most once per pass) and a **cycle-breaker budget** on
the U2 §4.4 pattern — the repo's own history (F13, the U2
cycle-breaker, the seed-1132 fixpoint trap) says craft-rule ordering
is where idempotence goes to die, so the proof obligation is budgeted
up front and this unit should expect a fix round. Detector thresholds (band length/width, curvature window)
are *pinned at unit start* from a measured false-positive sweep over
the qa corpus — a lint that fires on deliberate M1 shading is worse
than no lint.

### 5.2 Rule 7 — focal contrast promotion

As designed (design 04 §4, S1 F5): after all tone-touching rules, per
clip, a focal cluster whose tone contrast against its backing material
is < 2 tones **promotes to the glow ramp** (§4.3's table; F16
protection extends to it). Mechanical rule, outsized payoff — and its
aimed evidence corpus is the featureless-amorphous five (s20 s59 s65
s86 s93): eyes that exist but do not read at 1×. Gate includes a
before/after of exactly those five genomes' DNA.

### 5.3 Depth-aware selout — the honest scope

M1's rule 4 already implements design 04's interior selout at part
granularity: edge = 2 on the farther side of a part boundary, farther
decided by exact clip-wide part mean depths (design 06 §1.5). What
"selout depth-aware edges" (ROADMAP) still owes is the **per-pixel
refinement**: local `depthRaw` comparison (with a hysteresis threshold
so raster noise cannot flicker an edge) instead of clip-wide part
means — catching same-mean crossings (tendril over tendril, ball over
ball) the part-level rule cannot see. Evidence-gated inside V5: first
measure how many boundary pixels the part-mean decision misjudges on
the qa corpus; the refinement lands only if the measured miss rate is
material *(threshold pinned at unit start)*, else the measurement is
recorded and the part-mean rule is re-affirmed. Either way the flicker
gates and idempotence hold the line.

### 5.4 Thin-part polish debt

- **Wire tail residual**: after V1's girth floor, re-examine the F7
  exemption thresholds (SOFT_MIN_PX 6 / SOFT_MIN_DIM 3) against the
  six carrier genomes — if the floored tail still ships outline-less
  where an outline reads better, the exemption constants move here,
  with idempotence and the full-corpus sweep as the guard.
- **Levitant wisp gaps** (s55 s56 s76; the U3 record: transient 1-px
  body→tendril_0 gaps from independent per-chain snap rounding against
  the 0.5 px rest overlap, 99.44% connectivity at U3). Evidence-first:
  candidates are a cross-chain snap coupling (snap tendril_0 relative
  to the body chain's snapped position) or a craft-side bridge repair;
  mechanism *pinned at unit start* after a measured comparison. The
  critique's single-component criterion is the measured TARGET, not a
  hard CI law — fully-occluded clusters are legal and recorded
  (07 §2.3.1).

**Gate.** Idempotence on the pinned per-plan corpora (the S3/U4
contract); rule-6 false-positive sweep recorded; rule-7 five-seed
before/after in the mini-sheet; wisp-gap connectivity re-measured
against the U3 99.44% baseline (must not regress; target improvement
recorded); the §6 legibility floors and the §4.1b combo color-budget
census re-verified on the v5 build (both properties are live CI —
craft is the last pixel-touching unit, so this is where "measured on
final pixels" is discharged); `GENERATOR_VERSION` → 5; goldens + qa
re-pinned; flicker recalibration lawful pre-pin. No byte-level razor
exists for this unit — craft touches pixels everywhere by design —
so its blast-radius proof is property-level: idempotence, cluster
budgets, flicker gates, and the standing per-clip contracts.

## 6. Tag-legibility scaling — *V4*

The critique's second adjudged-valid kernel: tag visual effect
scaled with nothing — its px-diff measurements (walk clip only, which
isolates styling from freezes) ranged from 0 px
(levitant × fleshy, bit-identical to baseline) to 1264 px
(levitant × spectral), and its structural diagnosis (a fixed small
locus set is invisible on a 26-locus plan and obvious on a small one)
survives even though its gene map does not.

**Why the raw px-diff cannot be the law.** Post-V3, every material
tag recolors the whole body, so a raw differing-pixel count is
dominated by the recolor and clears any plausible floor for every
pair — a law that cannot fail measures nothing. The critique's method
is adopted as the *baseline measurement instrument* (its tables are
the pre-V3 anchor), but the law separates what V3 makes trivial from
what stays hard:

**The law (normative from V4): two floors per (plan, tag).**

1. **Color legibility** — the §4.1a payoff law (≥2 RGB entries),
   owned by V3, re-asserted here as part of the pair's score.
2. **Structural legibility** — over a pinned forced-single-tag corpus
   (proposal: seeds 0..99), per (plan, tag), measured on the walk
   clip, all 4 directions, native 32×32, against the same-seed
   untagged baseline (same plan, same seed, empty tag set). The
   statistic is pinned **here, not at unit start**: this floor runs in
   live CI through V5's gate, and the section's own mandate is a
   pinned measurement method, so two builders must not be able to
   implement it into two different pass/fail grids.

   ```
   per seed s, direction d, frame f = 0..K−1 (walk, K = 4):

     sil(s,d,f)   = # pixel positions whose ALPHA byte differs between
                    the tagged and the untagged frame f — binary alpha
                    (§0.2), so this is exactly the silhouette symmetric
                    difference; native 32×32, no scaling; RGB ignored,
                    because colour is metric 1's business

     dme(s,d,f)   = | E_tag(f, (f+1) mod K) − E_base(f, (f+1) mod K) |
                    where E is the house motion_energy the flicker gate
                    already consumes (design 06 §1.6 / src/flicker.ts),
                    summed over the plan's own slab template; the 16.16
                    raw difference is taken in ABSOLUTE value first,
                    then reduced to whole px by RHE(raw / 65536)

     score(s,d,f) = sil(s,d,f) + dme(s,d,f)          [unweighted sum]
     cell(s,d)    = mean over the K frames of score(s,d,f)
     seed(s)      = mean over the 4 directions of cell(s,d)
     STAT(p,t)    = median over the corpus seeds of seed(s)
   ```

   Both means are over fixed counts (K = 4 frames, 4 directions), so
   the pipeline stays exact-integer: `seed(s)` is carried as the
   integer sum of its 16 `score` terms and the floor is compared
   against that sum scaled by 16 — no float ever enters a CI verdict
   (the 16.16-only law applies to the gate, not just the generator);
   the median over an even corpus takes the lower of the two central
   values, pinned so a 100-seed corpus has one answer.

   Three rulings the formula makes explicit, because each of them
   changes the answer: **(i) absolute value per frame-pair, taken
   before any summing** — a tag that visibly SLOWS or damps the gait
   produces a NEGATIVE energy delta, and a signed sum would let it
   cancel against the silhouette pixels that tag just earned, failing
   a clearly-visible tag by sign arithmetic alone; **(ii) unweighted
   sum of the two addends**, legal only because both are first reduced
   to the same unit (px of visible difference: changed pixel
   positions, and RHE'd px of joint displacement) — no weight is
   pinned because no derivation exists for one, and inventing a
   coefficient would be exactly the constant-without-a-derivation the
   RHE law forbids; if the V4 measurement shows one addend swamping
   the other across all 15 pairs, that is an amendment argued here on
   the measured numbers, never a mid-unit tuning; **(iii) mean over
   frames, mean over directions, median over seeds — in that order.**
   The median sits at the CORPUS level only, where it absorbs the
   temperament no-ops documented below; inside a genome every frame
   and every direction counts, so a tag cannot buy the floor with one
   loud frame. The per-direction and per-frame breakdowns are recorded
   as unit evidence, so a tag that reads in profile and vanishes
   head-on surfaces as a finding instead of being averaged into
   silence.

   `STAT(plan, tag)` must clear a floor.

   **Floor derivation (the anti-tautology rule — read this before
   pinning anything).** A floor taken as a percentile of the same 15
   pairs it gates passes by construction: "all 15 pairs clear both
   floors" would then be vacuous, the remediation mechanism below
   could never fire, and the known-invisible pairs would be
   grandfathered as their own distribution's low tail — the exact
   failure this section's own maxim names ("a law that cannot fail
   measures nothing"). It would be applied to itself. So: floors are
   **ONE cross-pair floor per metric, not a per-pair band** —
   derived from the pooled CROSS-pair distribution of the 15
   `STAT(plan, tag)` values on the post-V3 build (proposal, pinned at unit start
   with the measured numbers: the floor sits at a stated quantile of
   that pooled distribution, chosen so the bottom outliers FAIL), and
   sanity-bounded below by the snap-visibility floor (a pair whose
   structural delta cannot survive snapping fails regardless of where
   the distribution sits). The design-07 §5.1 percentile-band
   discipline governs HOW the number is read off a measured
   distribution; it does not license reading it off the gated
   population per-pair.
   **Named expectation, recorded now so V4's outcome cannot be
   rationalized after the fact:** on the pre-V3 critique tables
   (walk clip, px changed vs same-plan baseline) the weakest cells of
   the 15-pair material grid are **levitant × fleshy (0 px,
   bit-identical to baseline)**, **quadruped × mechanical (16 px)**,
   and **levitant × chitin (28 px)** — against levitant × spectral's
   1264 px at the other end. Those are the pairs the floor exists to
   catch, and V4 opens EXPECTING them to fail and to be remediated —
   V4 is a measurement unit AND a remediation unit, in that order, and
   a V4 that remediates nothing is a result to be explained, not
   assumed. (Scope note, recorded honestly: the FFF presets are NOT in
   the 15-pair grid — the law is per (plan, tag) — yet the same
   critique table measures levitant × speed at 8 px, i.e. a preset is
   among the least-visible cells it measured. Whether the presets get
   their own floors is an open scope question ruled at V4 unit start,
   not silently answered here.)
   (The critique's suggested per-cell 150 px is recorded as an
   external calibration anchor, not adopted: RHE discipline, no
   constant without a derivation on our own measured distribution.)
   **Median over the corpus, not per-seed** (the reason behind
   ruling (iii)'s aggregation order):
   temperament rows are domain sub-range remaps, so a seed whose base
   draw already lands inside the remapped range legitimately no-ops —
   a per-seed gate would force-warp the temperament design.

**The schema law (normative for every future plan).** Each new plan's
tag rows must touch at least a pinned fraction of its plan-scoped
loci (fraction *pinned at unit start* from the shipped three plans'
measured values; deviation requires a written justification in the
plan's amendment). The critique's structural diagnosis — a fixed
gene-count-per-tag that is invisible on a 26-locus plan and loud on a
4-locus one — becomes impossible to reintroduce silently.

Mechanism when a pair fails: widen that pair's temperament rows / add
biased loci for that (plan, tag) — **sampler-level additive table
edits only** under the existing §6.1 machinery (qa re-pin, no version
bump; never domain shrinks, never touching other pairs — per-path
streams guarantee isolation). If a pair cannot be remediated at
sampler level, the render-level fix is recorded and rides V5's bump —
V4 itself never moves rendered bytes for a fixed DNA (that is its
blast-radius razor). CI: the per-(plan, tag) floors join the property
suite on a scaled slice (seeds 0..19); the full 15-pair grid is unit
evidence; **the floor property stays live through V5's gate**, so any
craft-induced floor motion surfaces there and is ruled on the record
(legibility is thereby re-verified on final pixels without ordering
the milestone around it).

## 7. Acceptance instrumentation (decision M3-e)

### 7.1 Per-unit instrumentation

Every unit inherits the M2 instrument set, extended honestly:

- **The qa guard** (07 §7.1 item 4) continues unchanged in law: three
  legs, fixture + sheet regenerate in the same commit as any
  byte-moving change. V1/V3/V5 regenerate under their version bumps,
  V2 under its sampler change, and **V4 whenever its sampler-level
  remediation fires** — which §6 opens EXPECTING: a widened
  temperament row moves the sampled DNA of affected seeds, hence
  shipped qa bytes, hence a same-commit regeneration under this law
  (the V4 gate row's "retunes re-pin qa reviewed" is exactly this
  clause; V4 regenerating nothing means V4 remediated nothing, which
  §6 requires to be explained rather than assumed). Leg-2's six-cell
  coverage property
  (every plan × {ornament, emitter} render path) is re-verified by
  enumeration at every regeneration, as pinned. To keep the
  regenerations (four certain, five if V4 remediates) from becoming
  review fatigue, **each regeneration's
  reviewed diff IS the unit's mini-sheet review** — one artifact set,
  never a double review; superseded PNGs live in git history, not
  in-tree.
- **The blast-radius razor** (the anchor razor, extended for an era
  where changing bytes is the point): every byte-moving unit declares
  its intended blast radius and ships a MACHINE proof of the
  complement. Every "byte-identical" below is the **§0.1 definition**
  — rendered bytes byte-equal, canonical JSON value-equal modulo the
  unit's declared permitted-diff set — because at a version bump
  `generator_version` moves in every export by construction and at V2
  the declared `frozen` key appears on its enumerated carriers; naked
  byte-identity claims here would be unpassable as written, not
  strict. V1: levitant + amorphous corpora and the quadruped partition
  that is below-knee **and** at-or-above the tail-girth floor (both
  conditions — the floor rides the same bump, §2) (permitted diff:
  `generator_version`); V2:
  fixed-DNA renders pixel-byte-identical, JSON value-identical modulo
  the declared `frozen` key with its carriers enumerated, and
  untriggered seeds' DNA byte-identical (§3); V3: empty-tag goldens
  (permitted diff: `generator_version`) and every corpus cell's alpha
  channel byte-identical (§4); V4: no rendered byte and no existing
  JSON value moves for fixed DNA (§6); V5: property-level only, named
  honestly (§5 gate).
- **Regression fixtures**: §2's 24 DNA-pinned frame-fit fixtures,
  §3's seed-pinned census fixtures, §5.2's five-seed focal corpus,
  §5.4's wire-tail (s06 s17 s28 s53 s60 s95) and wisp (s55 s56 s76)
  seeds — DNA-pinned where the fix is render-level, seed-pinned where
  it is sampler-level, so the two fixture classes cannot invalidate
  each other.
- **The 0..1999 close-out sweep** before every qa pin (the U6 order:
  sweep, then pin — recalibration is legal only pre-pin).
- **Owner review per unit**: Downloads + GIFs, standing format;
  pixel-breaking units deliver paired before/after composites with
  expectation-framing in the delivery note.
- **Suite budget**: honest accounting at every gate; the open ~200 s
  guideline ruling (§0.1) must be made at the V1 close-out and
  re-checked per unit (V1's corner sweeps and V4's measurement slices
  are the priced additions).
- **Distinctness regression**: the M2 silhouette-IoU measurement
  (between-plan > within-plan, 07 §7.1) re-runs in the V6 close-out
  sweep — frame-fit compression could narrow quadruped within-plan
  spread, and the check is cheap.
- **Document blast radius per unit** (the design-07 practice): V1
  amends **design 01 §4, design 01 requirement 5, and design 06 §3.3**
  — all three carry the retracted render promise and the §1 amendment
  set names each (leaving one behind would leave a contradicting
  pinned text in a public tree); V3 amends design 04 §5; V5 amends
  design 04 §4 — each in the unit's own commit.

### 7.2 The Turing-sheet protocol (S6 — the M3 acceptance instrument, V6)

ROADMAP Phase 3 accepts on: a mixed sheet of generated + hand-made
32×32 sprites; uninvolved viewers misclassify ≥50% of the generated
ones. The protocol below is executable by one hobbyist owner — no
lab, no IRB, no paid panel — and pins everything that could be
gamed, before it could be gamed.

1. **Reference pool.** ≥30 hand-made 32×32 single-creature sprites
   from **≥4 distinct artists** (a single artist's style is learnable
   and defeats the test), **CC0 preferred** (OpenGameArt's CC0
   filter, Kenney, and peers) — CC0 makes in-repo redistribution
   legal with no attribution burden; source URL, author, license, and
   sha256 recorded per file in `qa/turing/MANIFEST.json`. Fallback if
   the style-matched pool cannot be filled CC0-only: CC-BY items are
   permitted with full per-file attribution in the MANIFEST and an
   `ATTRIBUTION.md` beside it (attribution makes committed
   redistribution legal); NC/ND/GPL-art and ripped commercial work
   are excluded outright under any framing. No sprite the owner or
   this project's agents authored. **Style-match constraint (the
   confound killer):** references must be 32×32-native (no
   downscales), limited-palette, outlined, transparent-background
   creature sprites — raters must be forced to judge craft, not art
   style; residual style mismatch is this instrument's main validity
   threat and is recorded as such. **[OWNER-DECISION]** — the owner
   approves the realized pool before composition (comparability of
   subject matter is a taste call: creatures, not crates; one
   afternoon of sourcing).
2. **Comparability normalization.** One STATIC frame per cell for
   both populations (hand-made references rarely animate; animation
   would leak class). Generated cells contribute one pinned pose
   (proposal: profile walk f0 — most hand-made game sprites read in
   profile); the choice is *pinned at unit start* from the realized
   reference pool's view census, before any rendering. All cells
   composited identically: same magnification, same background, same
   cell frame, no per-cell labels beyond an index.
3. **Sheet composition.** 48 cells: 24 generated + 24 references.
   Generated seeds are **pre-registered before rendering** as
   `sampleBestiary` seeds 100..123 — inside the structurally-swept
   0..1999 range but outside the owner-reviewed 0..99, so no
   taste-based cherry-pick is possible even in principle. Reference
   cells drawn from the pool, and grid placement shuffled, by pinned
   PCG32 streams (seed and draw names recorded in the manifest). A
   `fablesprite turing-sheet` CLI composes it reproducibly.
4. **Panel.** Uninvolved raters — people who have never seen this
   project's output (friends, or a pixel-art community post),
   *screened for that, not assumed*: prior exposure is a pinned
   invalidating answer on the form (point 5), and the recruitment
   hygiene below is what keeps the screen from having to fire; the
   owner and every project agent are excluded from the metric.
   **Target 5–8, floor 3** (the floor keeps the protocol executable
   by one hobbyist; the realized N is reported with the verdict, and
   3 × 24 = 72 judgments is the honest minimum, not the goal).
   Delivery: a self-contained scoring form (printed sheet or a static
   HTML page), self-paced, one pass, no aids beyond the fixed
   magnification. Raters are told, truthfully, the sheet is half
   generated and half hand-made (hiding the ratio inflates
   misclassification — this is the honest hard mode), and give a
   forced binary judgment per cell ("computer-generated" / "drawn by
   a person") on a numbered answer form. **[OWNER-DECISION]** —
   recruitment channel (a public community post also outs the project
   — the owner's call); recommendation: 3 friends + an r/pixelart or
   discord call, target 5–8 raters.

   **Recruitment hygiene (protocol law, not etiquette).** The repo is
   public and `qa/sheet_mix_0_99.png` ships 100 generated sprites
   in-tree, so anyone who follows a recruitment post back to this
   project can learn the house style and then classify the generated
   cells on style alone — and the pre-registered seeds 100..123 do not
   protect against that, because the tell is the style, not the
   specific sprites. Therefore: **the recruitment text names neither
   this project nor its repo nor any of its public artifacts** (a
   community call describes only "a pixel-art spotting exercise, 48
   sprites, five minutes"), and no rater is shown project material
   before their form is complete. Screening for prior exposure is
   point 5's second validity criterion, and it is the enforcement.

   **Stopping rule (PRE-REGISTERED, because adaptive stopping on the
   gated statistic is bar-shopping wearing a lab coat).** Nothing in
   "target 5–8, floor 3" says *when* to stop, and an owner scoring
   raters one at a time could lawfully stop the moment the running
   estimate crosses 50%, or keep recruiting while it sits below.
   So: the panel size N is **committed in writing in the
   pre-registration commit** (§8, V6 gate) before the sheet is
   composed, at a value in [3, 8]; recruitment then runs to a single
   close — every rater who returns a form inside a pinned window
   (proposal: 21 days from the first form going out, *pinned at
   pre-registration*) is scored, and **no pooled estimate is computed,
   by anyone, until the window closes and all forms are in.** Validity
   screening (point 5) is then applied per rater to the sealed forms;
   if replacements are needed the window extends once by a pinned 14
   days and the extension is recorded with the reason. The committed N
   may rise only to admit volunteers who arrived inside the window —
   never fall, and never in response to a partial result nobody is
   permitted to have computed.
5. **Rater validity (PRE-REGISTERED here, so it is never a post-hoc
   exclusion).** The bias control alone does not defend the metric: a
   single politeness-biased rater answering "drawn by a person"
   throughout contributes 100% generated-misclassification, and at the
   floor N = 3 that is a third of all judgments — the instrument could
   pass on courtesy while the M3 declaration rides on it. Naming that
   channel and pinning no defense would be the vacuous pass this
   project's whole verification architecture exists to prevent.

   **But the screen must be symmetric, and a reference-cell accuracy
   floor is not** — which is why the obvious criterion is rejected
   here rather than pinned. An all-"person" rater scores 24/24 on the
   reference cells and passes such a screen with their 100% generated
   misclassification fully intact; the only raters it removes are
   computer-leaning ones, whose judgments DEFLATE the gated number. It
   is a screen that can only help the project pass. Worse, it
   misbehaves precisely at the success condition: at true
   indistinguishability an honest rater who has been told the sheet is
   half generated calls "person" on roughly half the cells including
   the hand-made ones, so their expected reference accuracy is ≈ 50%,
   under any 60% bar — honest raters would be systematically
   invalidated exactly when the generator is good, "replaced, not
   dropped" recruitment might never terminate, and the surviving panel
   would be selected for person-leaning bias, inflating the metric a
   second time. **No accuracy floor is pinned.** The two criteria,
   both fixed BEFORE any panel runs:
   - **Response balance (the symmetric screen).** The 50/50
     composition is disclosed to raters (point 4), so any rater
     engaging with the task distributes their calls near that ratio.
     A rater's judgments count only if their overall
     **"computer-generated" call count across all 48 cells lies in
     15..33 inclusive** — the integer realization of a 30–70% band
     (48 × 0.30 = 14.4, 48 × 0.70 = 33.6), stated in counts so the
     rounding cannot be argued after the fact. The band is justified
     from the disclosed composition: an honest rater at true
     indistinguishability has expected rate 50% with
     SD = √(0.25/48) ≈ 7.2 points over 48 forced-binary calls, so each
     edge sits ≈ 2.8 SD out and honest raters are essentially never
     excluded, while both degenerate patterns
     — all-"person" (0%) and all-"computer" (100%) — fail. It cuts in
     BOTH directions by the same arithmetic: it removes the courtesy
     rater who inflates the metric and the cynic who deflates it.
   - **Exposure.** The scoring form carries a pinned final question,
     asked AFTER all 48 judgments so it cannot prime them: *"before
     today, had you seen sprites generated by this project (SabelFrite
     / Fablesprite), in any form — a repo, a sheet, a post?"* A yes
     invalidates that rater's judgments. This is the enforcement half
     of point 4's recruitment hygiene: with 100 generated sprites in a
     public repo, an exposed rater is measuring their memory of the
     house style, not craft.
   An invalid rater under either criterion is **replaced, not
   dropped**: their tables are published with the record, marked
   invalid together with the criterion that caught them, and
   recruitment continues (inside point 4's window) until the reported
   N of valid raters meets the floor. These are the only two exclusion
   rules; no other rater and no cell may be excluded for any reason,
   and neither rule may be edited after the sheet is composed (editing
   one is bar-shopping under the failure discipline below).
6. **Scoring, and what the numbers can honestly support.** Pass iff
   pooled misclassification of GENERATED cells ≥ 50%: of all (valid
   rater × generated-cell) judgments, at least half say "drawn by a
   person". Reference-cell misclassification is recorded alongside as
   the bias control — **reported, never a validity screen** (point 5
   explains why gating on it would be asymmetric); reporting both
   keeps the instrument honest. The
   ROADMAP bar remains on the generated number alone, met or not on
   the pooled point estimate. **Minimum reporting, pinned:** the
   pooled estimate WITH a binomial confidence interval, the per-rater
   range, the realized valid N, and this standing caveat — judgments
   are clustered by rater and by cell, so effective N is well below
   the nominal count (72 at the floor, 120 at target N = 5), and even
   under the false assumption of independence the standard error at
   p = 0.5 over 72 judgments is ≈ 6%. **A result in 50–56% is
   therefore statistically indistinguishable from the bar and must be
   reported as such** — it still passes the ROADMAP bar as written
   (the bar is a point estimate, and rewriting it at declaration time
   would be bar-shopping in the other direction), but the declaration
   records the ambiguity rather than laundering it into confidence.
   Per-rater splits and per-cell vote counts are recorded — the
   worst-scoring generated cells feed the next taste backlog
   regardless of pass/fail.
7. **Failure discipline.** One attempt per composition — a failed
   panel is evidence, not a retry ticket. On a miss: a
   failure-analysis follow-up unit (which cells betrayed generation,
   and why) is scoped, and the re-test uses a NEW pre-registered seed
   range and either new raters or a ≥4-week gap (no memory of the old
   board). No bar-shopping, no re-runs of the same board.
   **[OWNER-DECISION]** — accept this appetite up front: a <50%
   result means M3 does not declare on schedule; the north-star bar
   is only worth having if it can be failed.
8. **Dry-run.** One calibration run of the full pipeline (sheet +
   scoring form) with the owner as sole rater is allowed at V6 start
   to debug logistics; its numbers are quarantined from the
   acceptance record. It doubles as the §0.2 search-based-polish
   trigger measurement.
9. **Secondary panel (informative, never gating).** An animated GIF
   panel of the same cells may be shown to the same raters AFTER the
   static verdict is recorded — animation is this generator's
   differentiator and the data is nearly free — but the ROADMAP bar
   stays static-sheet as written.
10. **Record.** Raw per-rater tables (valid and invalid alike), the
    sheet, the manifest, the pooled estimate with its CI, and the
    verdict land in `qa/turing/` — the same public-history discipline
    as every qa artifact. M3 is declared on this record + CI green,
    in a close-out commit amending this doc's §8 (the M2 declaration
    pattern).

## 8. Build order (decision M3-d)

Strictly serial (the M1/M2 discipline: one unit, one ultracode
workflow, one commit, CI green both platforms, then the next; each
unit amends this doc's *pinned at unit start* sections in the same
change; the hybrid workforce per §0.1). Order argued: **V1 first** —
it carries 15/16 of the flag mass AND is the first pixel-breaking
change, so §1's versioning mechanics land with it by construction
(the design 01 §4 amendment cannot trail the change it legitimizes —
a pixel-breaking unit shipping before the versioning law would be a
sequencing landmine), and its fixtures underpin every later razor.
**V2 before V3** so sampler churn settles before the palette
mini-sheet is composed — the owner reviews the population that will
actually ship. **V3 before V4** — the structural-legibility floors
can only be measured once V3 makes the color contribution separable
(§6's two-metric split). **V3 before V5** — rule 7 promotes into
V3's glow ramp, and rule 6 reassigns tones that must already mean
their final materials. **V5 last of the pixel units** — craft is
downstream-most; doing its idempotence work after geometry (V1) and
palette (V3) churn means doing it once, and §6's floors plus §4's
combo census get their final-pixels re-verification at its gate.
**V6 last** — the milestone bar is judged on the finished generator,
and its seeds/protocol are pre-registered here, not tuned then.

| Unit | Delivers | Gate |
|------|----------|------|
| V1 | Quadruped geometry v3 (§2): margin law (rendered ink, [1,30]), re-derived soft-knee length couplings (non-strict order preservation + pinned resolution floor), tail-root floor, GENERATOR_VERSION 3 + git tag, the three-passage versioning amendment (design 01 §4, design 01 requirement 5, design 06 §3.3) + §4.3-anchor retirement (§1), 24 DNA regression fixtures, goldens + qa re-pin | x-extent contributor audit discharged (emitter/ornament/horn loci in or named out); corner-product sweep fit-by-construction on the production fp path; levitant + amorphous worst x_min/x_max measured against the margin law before it is asserted, exemption-vs-mechanism ruling recorded; 0..1999 sweep zero margin/slice violations at the swept scope; blast-radius razor (quadrupeds that are below-knee AND at-or-above the tail-girth floor, + levitant + amorphous, §0.1 sense, permitted diff `generator_version`); fixtures green; flicker re-measured (pre-pin recalibration lawful); owner before/after review; suite-guideline ruling made |
| V2 | Anti-freeze guards (§3): post-snap freeze census + plan-aware exemption table (census-first), antifreeze:i re-roll via the §5.1 protocol with R_AF DERIVED from the measured pre-guard census (zero cap-exhausted target), `frozen` manifest key with its carrier population enumerated, seed fixtures | before/after liveness census 0..1999: guarded dead-clip incidence → 0, or the §3 residual ruling applied on the record (never a post-sweep R_AF raise); s46 + 15 near-miss seed fixtures green; fixed-DNA razor in the §0.1 sense (pixels byte-equal, JSON value-equal modulo the declared `frozen` key) + untriggered-seed DNA razor; re-roll proven by injection; qa re-pin (no version bump — §1 law 2 metadata carve-out, the U5 `degenerate` precedent) |
| V3 | Palette engine v4 (§4): per-tag material rows (neutral = M1 constants) from the candidates board, two-tag hide/underside rule, spectral ghost ramp, faction palettes (caller-scoped), glow ramp table, payoff + budget laws | payoff law CI-green all (plan, tag); combo color-budget census; all-defaults goldens byte-identical in the §0.1 sense (empty-tag razor, permitted diff `generator_version`); alpha-channel razor full corpus; flicker-metric input audit; GENERATOR_VERSION 4; goldens + qa re-pin; owner mini-sheet (U5-format before/after + faction strip) |
| V4 | Tag-legibility law (§6): pinned two-metric method (color + structural), cross-pair-derived floors measured post-V3 then pinned (a floor that CAN fail — §6's anti-tautology rule), the floors asserted per (plan, tag) in CI on the scaled slice and live through V5's gate, schema law for future plans, sampler-level remediation only | floors derived from the pooled cross-pair distribution, not per-pair bands; §6's three named pre-V3 weak MATERIAL pairs (levitant × fleshy 0 px, quadruped × mechanical 16 px, levitant × chitin 28 px) expected to fail and remediated, or their passing explained on the record; levitant × speed (8 px) is a PRESET, outside the 15-pair grid — it is gated here only if the open preset-floor scope question (§6) is ruled IN at V4 unit start, and its exclusion is otherwise recorded, not silently assumed; all 15 pairs clear both floors AFTER remediation; full grid recorded as unit evidence; zero rendered-byte and zero existing-JSON-value motion for fixed DNA (the V4 razor); retunes re-pin qa reviewed; escalations recorded for V5 |
| V5 | Craft v5 (§5): rule 6 (post-fixpoint, re-entrant, convergence argument + cycle-breaker budget), rule 7 → glow promotion, depth-aware selout refinement decision (evidence-gated on an as-built audit), wisp-gap repair, wire-tail outline residual | idempotence on all-plan corpora; rule-6 false-positive sweep recorded; featureless-five before/after; connectivity ≥ U3 99.44% baseline; §6 floors + §4.1b census re-verified on final pixels; GENERATOR_VERSION 5; goldens + qa re-pin; owner mini-sheet |
| V6 | Turing instrument (§7.2): reference pool + MANIFEST, turing-sheet CLI, protocol run, verdict record; distinctness-IoU regression re-run | pre-registration committed before rendering (seeds, committed panel N + recruitment window, the two rater-validity rules, scoring rule); pooled generated-cell misclassification ≥ 50% over VALID raters (validity = symmetric response-balance band, 15..33 "computer" calls of 48, + the post-form exposure question; NO reference-accuracy floor, which would be asymmetric and would invalidate honest raters at indistinguishability — §7.2 point 5; invalid raters replaced, never silently dropped; committed N in [3, 8], realized N reported); no pooled estimate computed before the recruitment window closes (the pre-registered stopping rule); pooled estimate reported with binomial CI + per-rater range + the clustering caveat (a 50–56% result is declared as statistically indistinguishable from the bar); bias control + per-cell votes reported → **declare M3** (close-out commit: this doc + ROADMAP Phase 3 + README) |

Risk watch while building: the suite-budget guideline (open ruling,
V1); rule-6 idempotence blowup — the highest-risk item in M3, a fix
round is priced in (V5); rule-6 false positives on deliberate shading
(V5's measured sweep exists for it); the V3 flicker-metric input
audit; qa-regeneration review fatigue (mitigated: the regeneration
review IS the mini-sheet review, §7.1); Turing-sheet reference
comparability (the **[OWNER-DECISION]** pool approval + style-match
law exist for it); R4/R5/R6 remain standing law (idempotence, stream
keying, two-platform goldens on every unit).
