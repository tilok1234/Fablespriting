# Design 02 — Body-Plan Grammar

The grammar turns genome loci into a **part graph**: typed parts bound to
sockets, with symmetry groups, ready for the skeleton/slab stages. This is
the differentiating module — everything downstream is plan-agnostic (proven
by Spike S1, where quadruped/biped/levitant shared one renderer).

## 1. Formalism

**Part node:** `{kind, slabs[], sockets[], material_role, anim_chain}`
Kinds: `core`, `segment`, `limb`, `head`, `sensor`, `emitter`, `ornament`,
`locomotor` (wing/fin/tendril — moves but doesn't touch ground).

**Socket:** a named attachment point on a part, carrying:
- position (fixed-point, in the part's local frame),
- an allowed-kind set (a head socket won't accept a leg),
- a **symmetry group**: `single`, `mirror` (L/R pair), `radial(N)`,
  `serial(N)` (repeated along a chain).

**Production:** growth is a budgeted, deterministic expansion: start from the
plan's core, repeatedly fill sockets with parts chosen by genome loci, each
placement consuming part budget. Symmetry groups place all members at once
(one gene → both ears), which is also what makes the mirror-vs-true-side
rendering decision trivial: a creature is symmetric iff no `mirror` group
was broken by an asymmetry gene.

## 2. The eight plans

| Plan | Core | Signature rules | Gait template |
|------|------|-----------------|---------------|
| Biped | upright torso | head above, mirror arms/legs | counter-swing (S1 ✓) |
| Quadruped/hexapod | horizontal spine | mirror leg pairs ×2..3, head socket fore, tail aft | trot/wave (S1 ✓) |
| Serpentine | serial(N) segments | head at segment 0, taper gene | traveling phase wave |
| Radial | disc/sphere core | radial(N) sockets, N ∈ {3,4,5,6,8} | rotation/pulse |
| Amorphous | metaball cluster | no skeleton; control-point field | blob oscillation |
| Levitant | floating core | no ground contact; locomotors + trailing parts | hover + lag chains (S1 ✓) |
| Colonial | virtual core | K micro-creatures (recursive, tiny budget) around a shared anchor | flock phase noise |
| Aberration | any of the above | symmetry-breaking post-pass: delete/scale/offset members of symmetry groups | base plan's gait, disturbed |

Notes:

- **Aberration as a modifier, not a plan.** It's a post-pass over any plan —
  this gets boss variants of *every* family for free and keeps the grammar
  small.
- **Colonial is recursion.** A colonial creature's members are grown by the
  same grammar with a tiny part budget. One implementation, swarms included.
- **Amorphous forks the renderer.** No slabs — a metaball field sampled the
  same way (majority-vote pixels). The *interface* stays "model → 4
  projections", so downstream is untouched. This is the only renderer fork
  in the system; budget for it explicitly (M2).

## 3. Anti-oatmeal measures

The failure mode of every creature generator: infinite valid, forgettable
outputs. Three structural defenses, all cheap:

1. **Trait tags (archetype attractors).** Genome carries 1–2 tags
   (`chitin`, `fleshy`, `spectral`, `mechanical`, `verdant`…). Tags gate
   part choices AND material roles AND gait temperament (spectral → slow
   hover genes; chitin → segmented parts, jerky high-frequency gait). A
   creature *commits to a theme* instead of averaging over all of them.
   This converts combinatorial mush into legible families.
2. **Part budgets by resolution.** 32×32: ~8–14 parts. 16×16: ~4–8
   (16×16: descoped, see D5). Budgets force silhouette-level decisions;
   ornaments compete for scarce slots.
3. **Exclusion groups.** Wings XOR arm-blades; single-eye XOR eye-pair. The
   grammar's version of "a good design says no."

Validation is human-in-the-loop by design: every grammar change re-renders a
pinned 100-genome contact sheet (the S1 sheet format), and taste review of
that sheet is a *scheduled activity* in M2, not an afterthought.

## 4. Degenerate-geometry defenses

- Sockets carry clearance radii; placements that overlap a sibling beyond a
  threshold re-draw from their locus stream (bounded retries, then drop —
  deterministic because retries are stream-keyed).
- A post-growth **readability self-check** renders the down-view silhouette
  and rejects creatures whose silhouette fill ratio or bounding-box aspect
  falls outside plan-specific bands (catches "all legs, no body" etc.).

## 5. Form-follows-function hook

Stat blocks map to *gene priors*, not direct geometry: `speed↑` biases limb
length and gait frequency loci; `armor↑` biases girth, shell ornaments, and
lowers bob amplitude; `ranged` guarantees one `emitter` part and (per S1
finding F5) the palette engine gives emitters a high-contrast focal ramp.
Because the mapping targets the genome, bred/mutated descendants inherit the
*tendency* — an elite of a fast enemy stays fast-looking.
