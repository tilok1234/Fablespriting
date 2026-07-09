# Fablesprite — a Procedural Sprite Generator Concept

**Target:** 16×16 and 32×32 pixel-art sprites for top-down games
**Scope:** player characters + a wide bestiary of non-humanoid enemies
**Output:** 4-directional (down / up / left / right) animated sprite sheets

This document describes the core concept and the ideas that set it apart from
existing generators (template mixers, part-swappers, and noise-based "alien"
generators). The guiding principle: **don't generate pixels — generate a
creature, then let the creature produce its own pixels, poses, and animations.**

---

## 1. The core inversion: Creature-first, pixels-last

Almost every existing sprite generator works at the *image* layer: it swaps
pre-drawn parts, recolors templates, or mirrors random noise. That approach
caps out fast — you can't get novel body plans, animations are hand-authored
per template, and the four directions must each be drawn by a human at some
point.

Fablesprite instead builds a tiny internal **creature model** and derives
everything else from it:

```
DNA string ──► Body-Plan Graph ──► Micro-Skeleton + Volume Slabs
                                        │
              Gait Engine (oscillators) ┤
                                        ▼
                 4-direction projection ──► Pixel Rasterizer ──► Craft-Rule Pass
                                                                      │
                                                                      ▼
                                                          Animated sprite sheet
```

Every stage is deterministic from the seed, so a sprite is fully described by
a short DNA string — shareable, breedable, and mutable.

---

## 2. Never-tried-before pillars

### 2.1 Body-Plan Grammar (real biology, not part-swapping)

Instead of "pick a head, pick a torso," creatures are grown from a **body-plan
grammar** inspired by how actual animal phyla differ. The genome's first genes
choose a *symmetry class and segmentation strategy*, which unlocks wildly
different morphologies from one system:

| Body plan        | Symmetry     | Example outputs                                  |
|------------------|--------------|--------------------------------------------------|
| Bilateral biped  | mirror L/R   | humanoids, birds, imps, mushroom-folk            |
| Bilateral quadruped/hexapod | mirror L/R | wolves, beetles, spider-crabs, chitin hounds |
| Serpentine       | segmental    | snakes, worms, centipedes, chained spirits       |
| Radial           | N-fold       | starfish horrors, flower turrets, sea-urchin mines |
| Amorphous        | none (blob field) | slimes, oozes, shadow puddles, mimics       |
| Levitant         | vertical axis | eyes, wisps, jellyfish, floating idols, ghosts  |
| Colonial         | cluster      | swarms, rat-kings, bat clouds, spore clusters    |
| Asymmetric aberration | broken   | eldritch things, tumorous bosses, glitch beasts  |

The grammar recursively attaches parts (limbs, sensors, weapons, ornaments) to
attachment sockets defined by the plan. A quadruped and a floating eye share
*no templates* — only the grammar. This is what makes "not just humanoids" a
first-class feature rather than a bolt-on.

**Novelty:** part-based generators exist; a *phylum-level grammar with
symmetry classes and recursive socket growth at 16×16 scale* does not.

### 2.2 Slab Projection — consistent 4 directions without drawing 4 sprites

The classic pain of 4-direction sprites: the side view never quite matches the
front view. Fablesprite solves this with **volume slabs**: each body part is
not a bitmap but a tiny volumetric primitive (an ellipsoid/box/tube of ~2–10
"cells") positioned on the skeleton in 3D-ish creature space.

To render a direction, the slab model is **orthographically projected** onto
the pixel grid from that direction, with painter's-algorithm depth ordering.
The four views are therefore *guaranteed consistent* — same height, same
proportions, same accessory positions — because they're four projections of
one model, not four drawings.

This is *not* full 3D rendering: slabs are deliberately crude (a handful of
cells) so the projection lands on the pixel grid at native resolution, and the
craft-rule pass (2.5) restores hand-drawn character. Think "voxel thumbnail
that never exists as an asset."

**Novelty:** voxel-to-pixel tools exist for large sprites; using throwaway
micro-volumes purely as a *directional consistency oracle* for 16×16 art,
combined with a pixel-art repair pass, is new.

### 2.3 Gait Engine — animation from oscillators, not frame templates

Animations are not stored frames. Each skeleton joint is driven by a small
network of coupled **phase oscillators** — the same "central pattern
generator" idea biology uses for locomotion. Genes set frequency, amplitude,
phase offsets, and coupling per limb chain:

- A quadruped gene set phase-shifts diagonal legs → trot.
- A serpentine plan couples segments with a traveling phase wave → slither.
- A levitant uses a single slow vertical oscillator + trailing-part lag → hover-bob.
- An amorphous plan oscillates its blob field's control points → squash/stretch.

Standard clips (idle, walk, attack, hurt, death, special) are just different
oscillator presets plus one-shot envelopes (attack = a lunge envelope layered
on idle). Because animation is *derived from the body plan*, every creature
the grammar can grow automatically animates plausibly in all four directions —
no animator in the loop, ever.

Frame counts stay pixel-art-honest: the continuous motion is **sampled and
quantized** to 4–8 frames with snapping to whole-pixel offsets, so output
looks hand-timed rather than tweened.

**Novelty:** CPG/oscillator locomotion is known in robotics and 3D creature
sims (e.g. Spore-likes); nobody has driven *quantized micro pixel-art
animation* with it.

### 2.4 Form-Follows-Function: stats in, silhouette out

The generator optionally accepts a **role/stat block** as input and maps it to
morphology genes, so a sprite *telegraphs its gameplay*:

- `speed↑` → longer limbs, forward-leaning idle, higher gait frequency
- `hp/armor↑` → wider low silhouette, shell/plate parts, slower heavier bob
- `ranged` → visible emitter part (eye, orifice, barrel) oriented per direction
- `explodes on death` → pulsing glow ramp + swollen core slab
- `elite/boss` → asymmetric aberration genes + ornament budget increase

Designers can go both ways: generate a sprite from stats, or read suggested
stats back out of a bred sprite. Enemies become *readable at a glance* because
appearance is causally linked to behavior — a principle pixel artists apply by
hand that no generator encodes.

### 2.5 Craft-Rule Pass — pixel-artist rules as a constraint solver

Raw rasterization looks "procedural." The final pass enforces the actual craft
rules pixel artists follow, as automated constraints:

1. **No orphan pixels** — lone pixels are merged into clusters or culled.
2. **Jaggy repair** — stair-step edges are relaxed to clean 1:1/2:1 pixel lines.
3. **Selective outline** — dark outline outside, lighter "selout" where forms
   overlap; outline color is hue-shifted, never pure black (gene-controlled).
4. **Cluster budget** — a 16×16 sprite may contain at most N distinct color
   clusters; small clusters merge until the budget is met (this is what makes
   tiny sprites read as deliberate).
5. **Banding & pillow-shade detection** — classic beginner mistakes are
   detected and corrected.
6. **Ramp discipline** — all colors come from generated 3–5 step ramps with
   hue-shifting (shadows toward cool, highlights toward warm), sharing a
   global light direction across the whole bestiary.

**Novelty:** encoding pixel-art *craft criticism* (the stuff of Pixel Joint
tutorials) as a post-process constraint solver is unexplored territory.

### 2.6 Readability Solver — the bestiary is generated as a *set*

Sprites aren't generated in isolation. When producing an enemy family or a
whole dungeon's bestiary, Fablesprite runs a **set-level distinctness check**:

- Silhouettes are compared pairwise (downsampled shape hashing); too-similar
  pairs trigger re-rolls of ornament/limb genes on the newer sprite.
- Palettes are allocated from a faction palette so allies look related but
  no two enemies share both silhouette class *and* dominant hue.
- A "threat ladder" constraint makes higher-tier enemies measurably bigger,
  spikier, or more saturated than lower tiers.

The output isn't 50 random sprites — it's a *legible ecosystem*.

### 2.7 DNA, breeding, and speciation

Every sprite is a compact gene string (target: fits in a tweet). This enables:

- **Breeding:** crossover of two parents' genes → hybrid creatures (players
  could literally breed monsters in-game; the generator is small enough to run
  at runtime).
- **Mutation dials:** "give me 20 cousins of this wolf" with controlled drift.
- **Speciation across depth:** the same species genome re-expressed with
  depth-indexed modifier genes → cave rats visibly evolve as you descend.
- **Elite variants for free:** one mutation pass = mini-boss version with the
  family resemblance intact.

---

## 3. Output specification

- **Resolutions:** 16×16 and 32×32 native (same creature model renders both —
  the slab projection just changes cell density; the craft-rule pass keeps
  each resolution honest instead of naive downscaling).
- **Directions:** down, up, left, right. Left/right are true projections, not
  mirrors, when the creature has asymmetry genes (held weapon, wounded eye).
  Symmetric creatures get mirrored L/R automatically to save sheet space.
- **Clips per creature:** idle (4f), walk (4–8f), attack (3–5f), hurt (2f),
  death (4–6f), plus plan-specific specials (burrow, split, inflate…).
- **Sheet formats:** packed PNG sprite sheet + JSON metadata (frame timings,
  anchor/pivot, hitbox suggestion derived from the slab volume, palette,
  DNA string) — engine-agnostic, with Godot/Unity/Aseprite export presets.
- **Determinism:** same DNA + version = identical bytes, forever.

## 4. Suggested architecture (implementation-agnostic)

| Module        | Responsibility                                            |
|---------------|-----------------------------------------------------------|
| `genome`      | DNA encode/decode, crossover, mutation, versioning        |
| `bodyplan`    | grammar → part graph with sockets, symmetry, segments     |
| `skeleton`    | part graph → joints, chains, rest pose in creature space  |
| `gait`        | oscillator networks, clip envelopes, pose sampling        |
| `slabs`       | volumetric primitives bound to bones                      |
| `project`     | 4-direction orthographic projection + depth sort          |
| `palette`     | ramp generation, hue-shifting, faction palettes           |
| `craft`       | pixel-art rule solver (outline, clusters, jaggies…)       |
| `set`         | bestiary-level readability + threat-ladder constraints    |
| `export`      | sheets, JSON metadata, engine presets                     |

A reasonable MVP slice: `genome → bodyplan (biped + quadruped + amorphous) →
skeleton → gait (idle/walk) → slabs → project → craft → export`, at 16×16,
then widen the grammar before deepening anything else — breadth of body plans
is the differentiator.

## 5. What this is *not*

- Not an ML/diffusion model — everything is deterministic, tiny, inspectable,
  and runnable at runtime inside a game.
- Not a template library — there are zero pre-drawn bitmaps in the pipeline.
- Not a 3D renderer — volumes are disposable scaffolding; the pixel is the
  only real artifact, and the craft pass has final authority over every pixel.
