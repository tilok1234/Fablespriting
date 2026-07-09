# Design 05 — Set-level readability & export

## 1. Readability solver (bestiary as a set)

Runs when generating N creatures together (a faction, a dungeon, a game).

**Silhouette distinctness.** For each pair: render down-view silhouettes,
centroid-align, compare by IoU plus two scalar shape features (perimeter²/area
spikiness, aspect ratio). Pairs above a similarity threshold trigger a
bounded re-roll of the newer creature's ornament/limb loci (structural
mutation with small budget) — deterministic because re-rolls are
stream-keyed. Escalate to plan-level re-roll after k failures; then accept
and warn (no silent infinite loops).

**Hue separation.** No two creatures share both silhouette-class and
dominant-hue bucket. Cheap check on the palette loci before rendering.

**Threat ladder.** Within a family, tier must be *monotone* in at least two
of: pixel mass, saturation, spike count (ornaments tagged sharp), silhouette
height. Implemented as an ordering constraint on genome priors rather than a
post-check where possible.

Calibration (what threshold = "too similar") is human work scheduled in M4 —
the metrics are trivial; the taste isn't.

## 2. Export

Per creature, per resolution:

- **PNG sprite sheet**, packed; L/R emitted as mirror flags when the
  creature is symmetric (design 04 P4) — sheet metadata says which.
- **JSON metadata:**
  - frames: rect, duration (non-uniform — see pose-salience re-timing),
    pivot (ground anchor from the model's ground line)
  - clips: name → frame sequence per direction
  - hitboxes: derived from slabs, not pixels — body AABB per frame +
    ground shadow ellipse (slab projection makes these consistent across
    directions by construction)
  - palette: ramps with role tags (enables engine-side recolors)
  - genome: the DNA string + generator version (a sheet is always
    reproducible from its own metadata)
- **Engine presets:** Aseprite JSON (art pipeline interop), Godot
  SpriteFrames, Unity-friendly atlas JSON. Presets are thin transforms of
  the canonical JSON — keep the canonical format engine-neutral.
- **GIF preview** per creature (validated in S1 — ideal for sharing/QA).

## 3. Runtime embedding

The deterministic core (genome → sheets) should compile to a library usable
in-game (breeding mechanics, infinite bestiaries). This mostly falls out of
the determinism discipline (fixed-point, no I/O in core) plus keeping the
core dependency-free. Decision D2 in `ASSESSMENT.md` sequences this: browser
tool first, library extracted later.
