# Design 01 — Genome: encoding, breeding, determinism

The genome is the contract everything else depends on. Its requirements, in
priority order:

1. **Deterministic** — same DNA + generator version → identical output bytes,
   on every platform, forever.
2. **Stable under edit** — changing one gene changes only the features that
   gene controls. (This is what makes an editor UI feel sane and makes
   "20 cousins of this wolf" produce cousins, not strangers.)
3. **Breedable** — meaningful crossover between any two genomes, including
   across body plans.
4. **Compact & shareable** — a short string; target ≤ ~200 chars base64url.
5. **Versioned** — old strings keep DECODING forever (the registry is
   append-only; design 08 §1 law 5), and render identically under the
   generator version they were issued against — that exact build is
   recoverable from git history via its `generator-vN` tag (design 08 §1
   law 3). Requirement 1 pins per-version byte determinism; cross-version
   pixel identity is not promised.

## 1. Why the two obvious encodings fail

- **Bare PRNG seed.** Maximum compactness, zero structure. Crossover of two
  seeds is meaningless (no locus alignment), single-gene editing is
  impossible, and any change to generation order reshuffles every creature.
  Rejected.
- **Flat fixed-layout bitfield.** Works for one body plan; breaks the moment
  plans have different part sets (a radial creature has no "left arm" bits).
  Rejected.

## 2. Chosen design: locus tree + named PRNG streams

The genome is a **tree of loci** mirroring the body-plan grammar's derivation:

```
genome
├─ meta.version, meta.plan, meta.trait_tags[]
├─ palette.{base_hue, hue_shift, contrast, ramp_len}
├─ anim.{gait_freq, bob_amp, anticipation, ...}
└─ body                            # shape mirrors the grammar derivation
   ├─ core.{length, girth, taper}
   ├─ head.{scale, snout, sensor_count, ...}
   ├─ limbs[k].{length, girth, claw, phase_group}
   └─ ornaments[k].{kind, size, socket}
```

Every locus has a **path** (`body.limbs[2].claw.size`), a typed domain
(int range, enum, fixed-point range), and a default. Serialization is a
depth-first varint tape with a version prefix, base64url-encoded. Loci at
default value serialize as absent, keeping strings short.

### Stability under edit — named streams

Any random draw made during growth is keyed by
`hash(genome_seed, locus_path, draw_name)` via PCG32, **never** by a global
draw sequence. Adding a third eye must not change the tail. This single rule
is the difference between an editor that feels like sculpting and one that
feels like a slot machine. It must be enforced from the first line of
production code — retrofitting it invalidates every genome issued before.

### Fixed-point determinism

All creature-space math is 16.16 fixed-point integers (positions, extents,
oscillator phases). Floats are permitted only in throwaway spikes. JS numbers
handle 16.16 exactly within 32-bit magnitudes, so this is portable across
TS/Rust/Python implementations of the spec.

## 3. Breeding

### Homologous crossover

Crossover aligns the two parents' locus trees **by path** (the biological
analogy is gene homology):

- Locus present in both parents → child takes either value (per-locus coin
  flip, seeded), or blends numeric loci with a small mutation kick.
- Locus present in one parent only (e.g., only one parent has a tail) →
  inherited with probability p_dominant, else absent.
- **Cross-plan breeding:** `meta.plan` is itself a locus; the child commits
  to one parent's plan, then inherits every homologous subtree that plan can
  express (head genes, palette, gait temperament transfer even between a
  quadruped and a levitant; leg loci transfer count-wise where the plan has
  leg sockets). Result: a levitant child of a wolf can carry its parent's
  ears, palette, and nervous gait — visibly related, structurally different.

### Mutation classes

| Class | Touches | Use case |
|-------|---------|----------|
| drift | numeric loci, small jitter | "20 cousins" |
| toggle | optional parts on/off | variants |
| structural | segment/limb counts, plan | speciation across dungeon depth |
| chromatic | palette loci only | faction recolors that stay coherent |

Each mutation call takes a budget so callers control drift distance. "Elite
variant" = 1 structural + 1 chromatic + drift, with the ornament budget
raised — family resemblance guaranteed because everything else is untouched.

## 4. Versioning (amended at M3/V1 — design 08 §1, owner-ratified 2026-07-17)

Two versions, two promises — the pre-V1 text conflated them and is
replaced by this section:

- **Wire promise (genome version — kept at full strength).** The genome
  version prefix selects the locus REGISTRY. Registry changes are
  append-only with absent-meaning defaults (design 06 §3); locus
  domains never shrink; additive appends never bump the genome version.
  Every issued DNA string keeps DECODING forever, in every future
  build, and no build ever guesses at loci it does not know
  (`UpgradeRequired` refusal, design 06 §3.3).
- **Render promise (GENERATOR_VERSION — restated to what is true).**
  Same DNA + same `GENERATOR_VERSION` → identical output bytes, on
  every platform, forever (requirement 1 — unchanged and exact). Every
  export is version-stamped (`generator_version` in the manifest).
  `GENERATOR_VERSION` increments at every unit that changes any
  rendered byte, or any existing JSON value, of output for a
  previously-valid genome — never mid-unit, never silently — with
  exactly the two narrow carve-outs of design 08 §1 law 2 (new output
  for previously `UpgradeRequired` inputs; declared additive
  absent-when-empty metadata keys shipping their affected-population
  enumeration). Cross-version pixel identity is NOT promised.
- **Old versions render via git history.** Each version's final build
  is the tree at its close-out commit, pinned by git tag
  (`generator-v2` at the pre-V1 commit, `generator-vN` at each later
  close-out) and named in design 08 §8. No in-tree parallel render path
  exists for any old version; where a change intends to leave a region
  untouched, an anchor-razor corpus proves it (design 08 §0.1
  byte-identity sense).

The retracted text promised kept growth-rule tables and "a DNA string
pasted into any future build renders pixel-identical". That promise was
retracted on the record at the design 08 §1 ratification (2026-07-17):
behavior lives in code paths (craft fixpoints, snap rounding, the
metaball march), not rule tables, so keeping old renders alive in-tree
means a frozen parallel renderer under permanent test — a cost nobody
would pay in preference to `git checkout generator-vN`. The wire
promise above is untouched by that retraction.

## 5. Open questions

- ~~Exact varint/tape format~~ — decided at M1: the id-registry varint
  tape, design 06 §3.
- ~~Whether `anim` loci should be plan-scoped rather than global~~ —
  decided at M1: plan-scoped (design 06 §1.1), with cross-plan `anim`
  transfer via the M2 crossover-time semantic map (design 07 §2.5).
- Diploid genomes (recessive genes) — fun for breeding-centric games; adds
  complexity; **deferred**, the locus tree doesn't preclude it.
