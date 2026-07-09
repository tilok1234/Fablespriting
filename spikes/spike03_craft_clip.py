#!/usr/bin/env python3
"""Spike S3 — clip-scoped craft pass + flicker metric.

Question under test (ROADMAP S3):
    Can a clip-scoped craft pass hold the flicker metric under threshold
    while applying jaggy repair + cluster merge, with the pipeline
    idempotent on a second run (no rule fights)?

Three arms (S2's lesson: attribute mechanisms separately):
    arm 1  baseline            - unsnapped renders + per-frame craft decisions
    arm 2  clip-scoped         - unsnapped renders + clip-scoped decisions
                                 (isolates decision scoping)
    arm 3  snapped+clip-scoped - chain-snapped renders + clip-scoped decisions
                                 (adds chain snapping)
Arms 1-2 share one render set; identical rule parameters everywhere.

Research decisions implemented here:
  * CLUSTER = a 4-connected region of pixels sharing the same
    (material, tone) after majority-vote quantization.
  * CROSS-FRAME CLUSTER IDENTITY: the rasterizer exports a per-pixel PART
    tag (index of the slab that won the majority vote) and a DEPTH tag
    (mean entry depth of the winning samples) alongside material and tone.
    A cluster's clip-stable key is (part_id, material, tone), where part_id
    is the majority part tag over the region's pixels. Aggregate statistics
    and merge/outline decisions are keyed by this.
  * CHAIN SNAPPING (chain = slab, for this spike): per clip, per direction,
    per slab, compute the slab's continuous projected screen center over
    all frames and its clip mean; the rendered position quantizes the
    DISPLACEMENT from the clip mean:
        snapped(f) = round(mean) + round(pos(f) - mean)     (per axis)
    implemented by shifting that slab's screen-space sampling by
    (snapped - continuous) during rasterization. Sub-half-pixel jitter
    around the mean then never flips a pixel column; a slab crossing a
    half-pixel from its mean moves crisply. Occlusion still uses the
    slab's true y-depth (entry depths are compared unmodified). round()
    is ties-to-even, which is load-bearing: gait code likes half-pixel
    amplitudes, and half-up rounding turns an exactly +-0.5 px bob into a
    four-jump 1-px square wave (see _rnd).
  * FLICKER METRIC per consecutive frame pair (clips wrap - the
    (last, first) pair is included): changed_pixels / motion_energy, where
    changed_pixels = final-RGBA diffs and motion_energy = sum over slabs of
    the Euclidean screen-space displacement (output px, continuous,
    pre-snap) of the slab's projected center, per direction.
    Zero-motion convention: if motion_energy < 1e-9 the ratio is 0.0 when
    changed_pixels == 0, else INF and the clip FAILS (pixels churning with
    no motion is never acceptable).
  * SELOUT SOFTENING (S1b finding F7): clusters with pixel count < 6 or
    bounding-box min dimension < 3 px are exempt from outlining/darkening -
    thin bodies must not drown in outline color. The spike03-local SNAKE
    (8 thin ellipsoid segments on a traveling phase wave, 2-3 px on screen)
    is the stress body for this rule.

Craft pipeline (design 04 section 4 v1; rules 6-7 are M3, out of scope),
operating on tagged grids, colors applied at the very end via the ramps:
    rule 2 orphan cull  (per-frame in all arms)
    rule 3 jaggy repair (per-frame in all arms; detect-then-apply, so scan
                         order cannot matter; only single-pixel teeth /
                         notches that break an otherwise straight run, and
                         only between the two clusters at that boundary)
    rule 4 selout       (boundary-vs-transparent -> ramp darkest tone;
                         interior part boundaries -> one-tone-darker edge
                         on the farther part by mean depth tag; F7 applies)
    rule 5 cluster budget (merge sub-threshold clusters into their dominant
                         neighbor until <= 14 clusters @32; min 4 px)
In clip-scoped mode rule 4/5 decisions are computed ONCE per clip from
aggregate statistics per cluster key (sizes medianed per key over the
frames where the key is present; adjacency contact counts summed over the
clip) and applied identically to every frame; in per-frame mode the same
rules decide independently per frame. A contact-less cluster is deleted
only when sub-threshold (floating debris) - a large isolated body (the
snake IS one) is left alone.

Two ordering findings vs the naive 2-3-4-5 sequence, both required for
idempotence (they ARE the rule fights this spike was sent to find):
  * selout must be DECIDED AND APPLIED after the cluster-budget merge:
    outline decisions made on pre-merge geometry are invalidated by every
    merge (a second run would re-outline merged regions and fail).
  * rules 2/3/5 iterate to a joint fixpoint inside one pass: a merge can
    expose a new orphan or jaggy pattern that the single-shot order never
    revisits. The iteration log reports how many work rounds each clip
    needed (1 round = the naive order was already fight-free).

Deterministic by construction: no randomness anywhere; re-runs are
byte-identical.

Run:  python spikes/spike03_craft_clip.py
Outputs (written to spikes/out/):
    spike03_flicker.json              - all measurements + verdict data
    spike03_sheet.png                 - walk frames, rows = arms (diagnostic,
                                        not blind - the exit bar is numeric)
    spike03_walk_<creature>_<dir>.gif - arms side by side, 6x, 140 ms
"""

import json
import math
import os
import sys
import time

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike01_slab_projection as s1  # noqa: E402

TAU = 2 * math.pi
INF = float("inf")
SIZE = 32                 # resolution 32x32 only in S3
SUPER = 4
MIN_COV = 0.42
DIRS = ["right", "down"]
WALK_FRAMES = 8           # uniform sampling per S2's verdict
IDLE_FRAMES = 4
MAX_CLUSTERS = 14         # rule 5 budget @32 (keys in clip mode)
MIN_CLUSTER_PX = 4        # rule 5 sub-threshold @32
SOFT_MIN_PX = 6           # rule 4 F7 softening thresholds
SOFT_MIN_DIM = 3
MAX_PASS_ITERS = 40       # fixpoint safety cap for one craft pass
MAX_MERGE_ITERS = 300     # safety cap inside rule 5
ARMS = (1, 2, 3)
ARM_NAMES = {1: "baseline per-frame", 2: "clip-scoped", 3: "snapped+clip"}
N4 = ((0, -1), (0, 1), (-1, 0), (1, 0))
TEXT = (235, 232, 240, 255)

RAMPS = dict(s1.RAMPS)    # local copy - spike01 stays untouched
RAMPS["scale"] = [(22, 38, 30), (56, 100, 62), (92, 146, 82), (142, 192, 110)]


# ----------------------------------------------------------------------------
# Spike03-local creature: the SNAKE - F7 stress body. Eight small ellipsoid
# segments (extents ~1.0-1.3 px at 32 -> 2-3 px wide on screen) following a
# traveling phase wave: segment k gets phase offset k*0.8.
# ----------------------------------------------------------------------------

def snake(phase, clip="walk"):
    s = []
    amp = 2.2 if clip == "walk" else 0.8
    for k in range(8):
        y = 7.9 - k * 2.2
        x = amp * math.sin(phase - k * 0.8)
        r = 1.3 - 0.04 * k          # head 1.3 -> tail ~1.02
        s.append(s1.Slab((x, y, 1.4), (r, r, r), "scale"))
    return s


CREATURES = [("wolf", s1.wolf), ("imp", s1.imp),
             ("watcher", s1.watcher), ("snake", snake)]


# ----------------------------------------------------------------------------
# Tagged rasterizer - spike01's projection and majority vote, extended with
# per-pixel PART and DEPTH tags and a per-slab screen-space snap offset hook.
# Pixel cell = [material, tone, part, depth, edge]; edge is written by rule 4.
# ----------------------------------------------------------------------------

def _rnd(v):
    """Ties-to-even (Python round). The tie handling is load-bearing for
    the snap rule: gait code likes half-pixel amplitudes (wolf/imp bob is
    exactly +-0.5 px), and half-up rounding maps that oscillation's
    displacements {-0.5, 0, +0.5} to {0, 0, 1} - a 1-px square wave, four
    whole-body jumps per cycle, which dominated arm 3's worst frame pairs.
    Ties-to-even sends both half-pixel extremes to 0: a knife-edge
    oscillation parks instead of strobing, and anything past the half
    pixel still moves crisply."""
    return round(v)


def project_center(center, quarter_turns):
    """Continuous screen position (output px) of a model-space point."""
    x, y, z = s1.yaw_point(center, quarter_turns)
    scale = SIZE / 32.0
    return (SIZE / 2.0 + x * scale,
            SIZE * (26.5 / 32.0) + (-z - s1.TILT * y) * scale)


def snap_offsets(fn, poseclip, phases, quarter_turns):
    """Per-frame, per-slab (dx, dy) sampling shifts in output px that
    realize the chain-snapping rule (see module docstring)."""
    centers = [[project_center(sl.center, quarter_turns)
                for sl in fn(ph, poseclip)] for ph in phases]
    nf, ns = len(phases), len(centers[0])
    offs = [[None] * ns for _ in range(nf)]
    for j in range(ns):
        mx = sum(centers[i][j][0] for i in range(nf)) / nf
        my = sum(centers[i][j][1] for i in range(nf)) / nf
        for i in range(nf):
            px, py = centers[i][j]
            offs[i][j] = (_rnd(mx) + _rnd(px - mx) - px,
                          _rnd(my) + _rnd(py - my) - py)
    return offs


def render_tagged(slabs, quarter_turns, offsets=None):
    posed = [s1.Slab(s1.yaw_point(sl.center, quarter_turns),
                     s1.yaw_extents(sl.extents, quarter_turns), sl.material)
             for sl in slabs]
    scale = SIZE / 32.0
    ox, oy = SIZE / 2.0, SIZE * (26.5 / 32.0)
    offs = offsets or [(0.0, 0.0)] * len(posed)
    grid = [[None] * SIZE for _ in range(SIZE)]
    total = SUPER * SUPER
    for py in range(SIZE):
        for px in range(SIZE):
            votes = {}                 # (mat, tone) -> sample count
            samples = []               # (key, slab index, entry depth)
            hits = 0
            for iy in range(SUPER):
                for ix in range(SUPER):
                    sx = (px + (ix + 0.5) / SUPER - ox) / scale
                    sy = (py + (iy + 0.5) / SUPER - oy) / scale
                    best = None
                    for i, sl in enumerate(posed):
                        h = s1.ray_hit(sl, sx - offs[i][0] / scale,
                                       sy - offs[i][1] / scale)
                        if h and (best is None or h[0] < best[0]):
                            best = (h[0], i, sl, h[1])
                    if best:
                        hits += 1
                        key = (best[2].material,
                               s1.surface_tone(best[2], best[3]))
                        votes[key] = votes.get(key, 0) + 1
                        samples.append((key, best[1], best[0]))
            if hits / total >= MIN_COV:
                mat, tone = max(votes, key=votes.get)
                win = [s for s in samples if s[0] == (mat, tone)]
                pc = {}
                for _, i, _d in win:
                    pc[i] = pc.get(i, 0) + 1
                part = max(pc, key=lambda i: (pc[i], -i))
                depth = sum(s[2] for s in win) / len(win)
                grid[py][px] = [mat, tone, part, depth, 0]
    return grid


def clone_grid(g):
    return [[list(c) if c else None for c in row] for row in g]


# ----------------------------------------------------------------------------
# Cluster machinery
# ----------------------------------------------------------------------------

def _median(vals):
    v = sorted(vals)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2.0


def find_clusters(grid):
    """4-connected same-(material, tone) regions; returns (clusters, label
    grid). Cluster key = (majority part, material, tone)."""
    label = [[-1] * SIZE for _ in range(SIZE)]
    clusters = []
    for y0 in range(SIZE):
        for x0 in range(SIZE):
            if grid[y0][x0] is None or label[y0][x0] != -1:
                continue
            idx = len(clusters)
            mat, tone = grid[y0][x0][0], grid[y0][x0][1]
            stack = [(x0, y0)]
            label[y0][x0] = idx
            pixels = []
            pc = {}
            while stack:
                x, y = stack.pop()
                pixels.append((x, y))
                pc[grid[y][x][2]] = pc.get(grid[y][x][2], 0) + 1
                for dx, dy in N4:
                    nx, ny = x + dx, y + dy
                    if (0 <= nx < SIZE and 0 <= ny < SIZE
                            and label[ny][nx] == -1):
                        nc = grid[ny][nx]
                        if nc is not None and nc[0] == mat and nc[1] == tone:
                            label[ny][nx] = idx
                            stack.append((nx, ny))
            part = max(pc, key=lambda p: (pc[p], -p))
            xs = [p[0] for p in pixels]
            ys = [p[1] for p in pixels]
            clusters.append({
                "idx": idx, "mat": mat, "tone": tone, "part": part,
                "key": (part, mat, tone), "pixels": pixels,
                "size": len(pixels),
                "bbox_min": min(max(xs) - min(xs) + 1, max(ys) - min(ys) + 1),
                "first": min(pixels, key=lambda p: (p[1], p[0])),
            })
    return clusters, label


def cluster_contacts(grid, label):
    """4-adjacency pixel-pair counts between distinct clusters."""
    contacts = {}
    for y in range(SIZE):
        for x in range(SIZE):
            if grid[y][x] is None:
                continue
            a = label[y][x]
            for dx, dy in ((1, 0), (0, 1)):
                nx, ny = x + dx, y + dy
                if nx < SIZE and ny < SIZE and grid[ny][nx] is not None:
                    b = label[ny][nx]
                    if b != a:
                        k = (min(a, b), max(a, b))
                        contacts[k] = contacts.get(k, 0) + 1
    return contacts


# ----------------------------------------------------------------------------
# Rule 2 - orphan cull. Base semantics = spike01 craft-lite (cull pixels
# with no opaque 4-neighbor at all), plus: an interior 1-px island (4 opaque
# neighbors, none sharing its cluster) is reassigned to the dominant
# 4-neighbor cluster instead of deleted. Detect-then-apply.
# ----------------------------------------------------------------------------

def rule2_orphan(grid):
    def cell(x, y):
        return grid[y][x] if 0 <= x < SIZE and 0 <= y < SIZE else None

    culls, reassigns = [], []
    for y in range(SIZE):
        for x in range(SIZE):
            c = grid[y][x]
            if c is None:
                continue
            neigh = [cell(x + dx, y + dy) for dx, dy in N4]
            opq = [n for n in neigh if n is not None]
            if not opq:
                culls.append((x, y))
                continue
            if (len(opq) == 4
                    and not any(n[0] == c[0] and n[1] == c[1] for n in opq)):
                counts = {}
                for n in opq:
                    k = (n[0], n[1])
                    counts[k] = counts.get(k, 0) + 1
                dom = min(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
                donor = next(n for n in neigh
                             if n is not None and (n[0], n[1]) == dom)
                reassigns.append((x, y, dom[0], dom[1], donor[2]))
    for x, y in culls:
        grid[y][x] = None
    for x, y, m, t, p in reassigns:
        grid[y][x] = [m, t, p, grid[y][x][3], 0]
    return len(culls) + len(reassigns)


# ----------------------------------------------------------------------------
# Rule 3 - jaggy repair, deliberately conservative: only a single-pixel
# tooth/notch that breaks an otherwise straight run between exactly two
# clusters (transparent counts as a cluster) is smoothed. Pattern for pixel
# p of cluster v: one 4-neighbor (direction d) is v, the other three share
# one cluster w != v, the two diagonals beside the v-neighbor are v and the
# two beside the opposite neighbor are w. p is reassigned to w (donor tags
# from the opposite neighbor); the repaired boundary is locally stable, so
# repairs cannot cascade. Detect on the pre-pass grid, then apply.
# ----------------------------------------------------------------------------

def rule3_jaggy(grid):
    def cl(x, y):
        if 0 <= x < SIZE and 0 <= y < SIZE and grid[y][x] is not None:
            return (grid[y][x][0], grid[y][x][1])
        return None

    repairs = []
    for y in range(SIZE):
        for x in range(SIZE):
            v = cl(x, y)
            for dx, dy in N4:
                if cl(x + dx, y + dy) != v:
                    continue
                others = [(ox, oy) for ox, oy in N4 if (ox, oy) != (dx, dy)]
                w = cl(x + others[0][0], y + others[0][1])
                if w == v:
                    continue
                if any(cl(x + ox, y + oy) != w for ox, oy in others[1:]):
                    continue
                p1, p2 = (-dy, dx), (dy, -dx)      # perpendiculars to d
                if cl(x + dx + p1[0], y + dy + p1[1]) != v:
                    continue
                if cl(x + dx + p2[0], y + dy + p2[1]) != v:
                    continue
                if cl(x - dx + p1[0], y - dy + p1[1]) != w:
                    continue
                if cl(x - dx + p2[0], y - dy + p2[1]) != w:
                    continue
                donor = grid[y - dy][x - dx]
                repairs.append((x, y, list(donor) if donor else None))
                break
    for x, y, donor in repairs:
        if donor is None:
            grid[y][x] = None
        else:
            grid[y][x] = [donor[0], donor[1], donor[2], donor[3], 0]
    return len(repairs)


# ----------------------------------------------------------------------------
# Rule 5 - cluster budget. Per-frame flavor works on concrete clusters;
# clip-scoped flavor works on cluster keys with sizes medianed per key over
# the frames where the key is PRESENT and adjacency summed, decisions
# applied to every frame identically. (Zero-inflating the median with
# absent frames looked attractive as an extra anti-flicker lever, but a
# whole-body cluster whose majority part tag oscillates across frames
# splits into sibling keys that are each "absent" half the clip - the
# zero-inflated median then deleted the entire snake. Presence-based
# medians keep aggregation honest; presence gaps still show up in the
# flicker metric where they belong.) Merges reassign (material, tone)
# only - part and depth tags keep their rasterizer provenance. A cluster
# with no opaque neighbor anywhere is deleted only when sub-threshold
# (floating debris); a large contact-less cluster (e.g. a whole thin body)
# is skipped, never deleted.
# ----------------------------------------------------------------------------

def rule5_frame(grid):
    decisions = []
    skip = set()
    for _ in range(MAX_MERGE_ITERS):
        clusters, label = find_clusters(grid)
        under = [c for c in clusters
                 if c["size"] < MIN_CLUSTER_PX and c["key"] not in skip]
        over_budget = len(clusters) > MAX_CLUSTERS
        if not under and not over_budget:
            break
        pool = under or [c for c in clusters if c["key"] not in skip]
        if not pool:
            break
        src = min(pool, key=lambda c: (c["size"], c["key"], c["first"]))
        contacts = cluster_contacts(grid, label)
        nbr = {}
        for (a, b), n in contacts.items():
            if a == src["idx"]:
                nbr[b] = nbr.get(b, 0) + n
            elif b == src["idx"]:
                nbr[a] = nbr.get(a, 0) + n
        if not nbr:
            if src["size"] < MIN_CLUSTER_PX:
                for x, y in src["pixels"]:
                    grid[y][x] = None
                decisions.append((src["key"], None))
            else:
                skip.add(src["key"])
            continue
        dst = min((clusters[i] for i in nbr),
                  key=lambda c: (-nbr[c["idx"]], -c["size"],
                                 c["key"], c["first"]))
        for x, y in src["pixels"]:
            c = grid[y][x]
            grid[y][x] = [dst["mat"], dst["tone"], c[2], c[3], 0]
        decisions.append((src["key"], dst["key"]))
    else:
        raise RuntimeError("rule5_frame did not converge")
    return decisions


def _present_median(vals):
    pos = [v for v in vals if v > 0]
    return _median(pos) if pos else 0.0


def _key_stats(grids):
    nf = len(grids)
    sizes, contacts = {}, {}
    for fi, g in enumerate(grids):
        clusters, label = find_clusters(g)
        for c in clusters:
            sizes.setdefault(c["key"], [0] * nf)[fi] += c["size"]
        for (a, b), n in cluster_contacts(g, label).items():
            ka, kb = clusters[a]["key"], clusters[b]["key"]
            if ka == kb:
                continue
            k = (min(ka, kb), max(ka, kb))
            contacts[k] = contacts.get(k, 0) + n
    med = {k: _present_median(v) for k, v in sizes.items()}
    return sizes, med, contacts


def rule5_clip(grids):
    decisions = []
    skip = set()
    for _ in range(MAX_MERGE_ITERS):
        sizes, med, contacts = _key_stats(grids)
        keys = sorted(sizes)
        under = [k for k in keys
                 if med[k] < MIN_CLUSTER_PX and k not in skip]
        over_budget = len(keys) > MAX_CLUSTERS
        if not under and not over_budget:
            break
        pool = under or [k for k in keys if k not in skip]
        if not pool:
            break
        src = min(pool, key=lambda k: (med[k], k))
        nbr = {}
        for (a, b), n in contacts.items():
            if a == src:
                nbr[b] = nbr.get(b, 0) + n
            elif b == src:
                nbr[a] = nbr.get(a, 0) + n
        if not nbr:
            if med[src] < MIN_CLUSTER_PX:
                dst = None
            else:
                skip.add(src)
                continue
        else:
            dst = min(nbr, key=lambda k: (-nbr[k], -med[k], k))
        for g in grids:
            clusters, _ = find_clusters(g)
            for c in clusters:
                if c["key"] != src:
                    continue
                for x, y in c["pixels"]:
                    if dst is None:
                        g[y][x] = None
                    else:
                        cell = g[y][x]
                        g[y][x] = [dst[1], dst[2], cell[2], cell[3], 0]
        decisions.append((src, dst))
    else:
        raise RuntimeError("rule5_clip did not converge")
    return decisions


# ----------------------------------------------------------------------------
# Rule 4 - selout, decided and applied on post-merge geometry (see module
# docstring for why). Edge flags: 1 = boundary-vs-transparent (ramp darkest
# tone), 2 = farther side of an interior part boundary (one tone darker).
# F7 softening exempts small/thin clusters from both.
# ----------------------------------------------------------------------------

def _apply_edges(grid, label, exempt_idx, part_mean):
    for y in range(SIZE):
        for x in range(SIZE):
            if grid[y][x]:
                grid[y][x][4] = 0
    for y in range(SIZE):
        for x in range(SIZE):
            cell = grid[y][x]
            if cell is None:
                continue
            nbrs = []
            open_edge = False
            for dx, dy in N4:
                nx, ny = x + dx, y + dy
                if 0 <= nx < SIZE and 0 <= ny < SIZE and grid[ny][nx]:
                    nbrs.append(grid[ny][nx])
                else:
                    open_edge = True
            if label[y][x] in exempt_idx:
                continue
            if open_edge:
                cell[4] = 1
            else:
                me = part_mean[cell[2]]
                for n in nbrs:
                    if n[2] != cell[2] and me > part_mean[n[2]] + 1e-9:
                        cell[4] = 2
                        break


def _part_depths(grids):
    dsum, dn = {}, {}
    for g in grids:
        for y in range(SIZE):
            for x in range(SIZE):
                cell = g[y][x]
                if cell:
                    dsum[cell[2]] = dsum.get(cell[2], 0.0) + cell[3]
                    dn[cell[2]] = dn.get(cell[2], 0) + 1
    return {p: dsum[p] / dn[p] for p in dsum}


def rule4_clip(grids):
    nf = len(grids)
    ksize, kbb = {}, {}
    frames = []
    for fi, g in enumerate(grids):
        clusters, label = find_clusters(g)
        frames.append((clusters, label))
        for c in clusters:
            ksize.setdefault(c["key"], [0] * nf)[fi] += c["size"]
            bb = kbb.setdefault(c["key"], [0] * nf)
            bb[fi] = max(bb[fi], c["bbox_min"])
    exempt = {k for k in ksize
              if _present_median(ksize[k]) < SOFT_MIN_PX
              or _present_median(kbb[k]) < SOFT_MIN_DIM}
    part_mean = _part_depths(grids)
    for (clusters, label), g in zip(frames, grids):
        exempt_idx = {c["idx"] for c in clusters if c["key"] in exempt}
        _apply_edges(g, label, exempt_idx, part_mean)
    return exempt, len(ksize)


def rule4_frame(grid):
    clusters, label = find_clusters(grid)
    exempt_idx = {c["idx"] for c in clusters
                  if c["size"] < SOFT_MIN_PX or c["bbox_min"] < SOFT_MIN_DIM}
    part_mean = _part_depths([grid])
    _apply_edges(grid, label, exempt_idx, part_mean)
    exempt_keys = {c["key"] for c in clusters if c["idx"] in exempt_idx}
    return exempt_keys, len(clusters)


# ----------------------------------------------------------------------------
# The craft pass - one clip in, one clip out. Rules 2/3 are per-frame in
# both modes; rules 4/5 decide per frame (arm 1) or once per clip from
# aggregates (arms 2-3). Rules 2/3/5 iterate to a joint fixpoint so a second
# run is a guaranteed no-op unless a rule is fighting - the iteration log is
# the rule-fight evidence either way.
# ----------------------------------------------------------------------------

def craft_clip(raw_grids, clip_scoped):
    grids = [clone_grid(g) for g in raw_grids]
    info = {"mode": "clip" if clip_scoped else "frame",
            "rule2": 0, "rule3": 0, "iter_log": []}
    if clip_scoped:
        merges = []
        for _ in range(MAX_PASS_ITERS):
            c2 = sum(rule2_orphan(g) for g in grids)
            c3 = sum(rule3_jaggy(g) for g in grids)
            dec = rule5_clip(grids)
            info["rule2"] += c2
            info["rule3"] += c3
            merges.extend(dec)
            info["iter_log"].append((c2, c3, len(dec)))
            if c2 == 0 and c3 == 0 and not dec:
                break
        else:
            raise RuntimeError("craft pass (clip) did not reach a fixpoint")
        exempt, nkeys = rule4_clip(grids)
        info["merge_decisions"] = merges
        info["exempt_keys"] = exempt
        info["n_keys_at_selout"] = nkeys
        info["work_rounds"] = sum(1 for e in info["iter_log"] if any(e))
    else:
        fmerges, fexempt, ncl, worst = [], [], [], 0
        for g in grids:
            decs, log = [], []
            for _ in range(MAX_PASS_ITERS):
                c2 = rule2_orphan(g)
                c3 = rule3_jaggy(g)
                d = rule5_frame(g)
                info["rule2"] += c2
                info["rule3"] += c3
                decs.extend(d)
                log.append((c2, c3, len(d)))
                if c2 == 0 and c3 == 0 and not d:
                    break
            else:
                raise RuntimeError(
                    "craft pass (frame) did not reach a fixpoint")
            info["iter_log"].append(log)
            worst = max(worst, sum(1 for e in log if any(e)))
            ex, nc = rule4_frame(g)
            fmerges.append(set(decs))
            fexempt.append(ex)
            ncl.append(nc)
        info["frame_merge_decisions"] = fmerges
        info["frame_exempt_keys"] = fexempt
        info["n_clusters"] = ncl
        info["work_rounds"] = worst
    return grids, info


# ----------------------------------------------------------------------------
# Coloring + flicker metric
# ----------------------------------------------------------------------------

def colorize(grid):
    """Returns (RGBA image, flat pixel list) - the list feeds the metric."""
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    data = []
    for y in range(SIZE):
        for x in range(SIZE):
            cell = grid[y][x]
            if cell is None:
                data.append((0, 0, 0, 0))
                continue
            mat, tone, _p, _d, edge = cell
            if edge == 1:
                color = RAMPS[mat][0]
            elif edge == 2:
                color = RAMPS[mat][tone]       # one tone darker
            else:
                color = RAMPS[mat][tone + 1]
            rgba = (*color, 255)
            im.putpixel((x, y), rgba)
            data.append(rgba)
    return im, data


def flicker_stats(datas, energy):
    n = len(datas)
    pairs = []
    failed = False
    for i in range(n):
        j = (i + 1) % n
        changed = sum(1 for a, b in zip(datas[i], datas[j]) if a != b)
        e = energy[i]
        if e < 1e-9:
            ratio = 0.0 if changed == 0 else INF
        else:
            ratio = changed / e
        failed = failed or ratio == INF
        pairs.append({"frames": [i, j], "changed": changed,
                      "energy": e, "ratio": ratio})
    ratios = [p["ratio"] for p in pairs]
    return {"pairs": pairs, "failed": failed,
            "changed_total": sum(p["changed"] for p in pairs),
            "energy_total": sum(p["energy"] for p in pairs),
            "ratio_mean": INF if failed else sum(ratios) / len(ratios),
            "ratio_max": max(ratios)}


# ----------------------------------------------------------------------------
# Idempotence property test
# ----------------------------------------------------------------------------

def idempotence_detail(g1, g2, info2):
    total = edge_only = 0
    for fa, fb in zip(g1, g2):
        for ra, rb in zip(fa, fb):
            for ca, cb in zip(ra, rb):
                if ca != cb:
                    total += 1
                    if ca is not None and cb is not None \
                            and ca[:4] == cb[:4]:
                        edge_only += 1
    nmerge = (len(info2.get("merge_decisions", []))
              if info2["mode"] == "clip"
              else sum(len(s) for s in info2.get(
                  "frame_merge_decisions", [])))
    return {"cells_differing": total, "edge_flag_only": edge_only,
            "rule2_changes": info2["rule2"], "rule3_changes": info2["rule3"],
            "rule5_merges": nmerge,
            "rule4_fight": total > 0 and total == edge_only}


# ----------------------------------------------------------------------------
# Visual evidence - same assembly conventions as spike02
# ----------------------------------------------------------------------------

PAD = 12
CELL = 160
LABEL_W = 190
HDR_H = 26
PANEL = 192            # 32 -> 6x nearest
LABEL_H = 34


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def build_sheet(path, colored, font_hdr, font_row):
    tile = s1.checker(CELL)
    block_w = LABEL_W + WALK_FRAMES * CELL
    block_h = HDR_H + 3 * CELL
    sheet = Image.new(
        "RGBA",
        (2 * block_w + 3 * PAD, len(CREATURES) * (block_h + PAD) + PAD),
        (*s1.BG, 255))
    draw = ImageDraw.Draw(sheet)
    for ci, (name, _) in enumerate(CREATURES):
        for di, d in enumerate(DIRS):
            bx = PAD + di * (block_w + PAD)
            by = PAD + ci * (block_h + PAD)
            draw.text((bx + 4, by + 3), f"{name} / {d} / walk",
                      font=font_hdr, fill=TEXT)
            for ai, arm in enumerate(ARMS):
                ry = by + HDR_H + ai * CELL
                draw.text((bx + 4, ry + CELL // 2 - 9),
                          f"{arm} {ARM_NAMES[arm]}", font=font_row, fill=TEXT)
                imgs = colored[(arm, name, "walk", d)]
                for fi in range(WALK_FRAMES):
                    fx = bx + LABEL_W + fi * CELL
                    sheet.alpha_composite(tile, (fx, ry))
                    sheet.alpha_composite(s1.upscale(imgs[fi], CELL),
                                          (fx, ry))
    sheet.convert("RGB").save(path)


def build_gif(path, per_arm, font):
    w = 3 * PANEL + 4 * PAD
    h = LABEL_H + PANEL + 2 * PAD
    base = Image.new("RGBA", (w, h), (*s1.BG, 255))
    tile = s1.checker(PANEL)
    draw = ImageDraw.Draw(base)
    for i, arm in enumerate(ARMS):
        x = PAD + i * (PANEL + PAD)
        base.alpha_composite(tile, (x, PAD + LABEL_H))
        draw.text((x + 4, PAD + 6), f"{arm} {ARM_NAMES[arm]}",
                  font=font, fill=TEXT)
    frames = []
    for fi in range(WALK_FRAMES):
        fr = base.copy()
        for i, arm in enumerate(ARMS):
            fr.alpha_composite(s1.upscale(per_arm[arm][fi], PANEL),
                               (PAD + i * (PANEL + PAD), PAD + LABEL_H))
        frames.append(fr.convert("P", palette=Image.ADAPTIVE))
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=140, loop=0)


# ----------------------------------------------------------------------------
# Reporting helpers
# ----------------------------------------------------------------------------

def key_str(k):
    return "-" if k is None else f"{k[0]}/{k[1]}/{k[2]}"


def _num(v, nd=4):
    if v == INF:
        return "INF"
    return round(v, nd) if isinstance(v, float) else v


def fmt(v, width=7):
    return ("INF" if v == INF else f"{v:.2f}").rjust(width)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    t0 = time.perf_counter()
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out_dir, exist_ok=True)
    fnmap = dict(CREATURES)

    # (creature, clip name, pose-branch passed to the pose fn, phases)
    clip_defs = [(name, "walk", "walk",
                  [i * TAU / WALK_FRAMES for i in range(WALK_FRAMES)])
                 for name, _ in CREATURES]
    clip_defs.append(("wolf", "idle", "idle",
                      [i * TAU / IDLE_FRAMES for i in range(IDLE_FRAMES)]))
    # static pseudo-clip: the same wolf idle pose twice - exercises the
    # zero-motion convention (changed_pixels must be 0, ratio 0.0)
    clip_defs.append(("wolf", "static", "idle", [0.0, 0.0]))

    # --- render both sets: unsnapped (arms 1-2) and snapped (arm 3) --------
    raw, snp, energies = {}, {}, {}
    for name, fn in CREATURES:
        for cname, poseclip, phases in [(c, p, ph) for n, c, p, ph
                                        in clip_defs if n == name]:
            for d in DIRS:
                q = s1.DIRECTIONS[d]
                key = (name, cname, d)
                slabsets = [fn(ph, poseclip) for ph in phases]
                raw[key] = [render_tagged(ss, q) for ss in slabsets]
                offs = snap_offsets(fn, poseclip, phases, q)
                snp[key] = [render_tagged(ss, q, offs[i])
                            for i, ss in enumerate(slabsets)]
                centers = [[project_center(sl.center, q) for sl in ss]
                           for ss in slabsets]
                n = len(phases)
                energies[key] = [
                    sum(math.dist(a, b) for a, b
                        in zip(centers[i], centers[(i + 1) % n]))
                    for i in range(n)]
        print(f"rendered {name}")

    # --- craft + color + measure -------------------------------------------
    crafted, infos, colored, results = {}, {}, {}, {}
    for arm in ARMS:
        src = snp if arm == 3 else raw
        for key in sorted(src):
            g, info = craft_clip(src[key], clip_scoped=(arm >= 2))
            crafted[(arm,) + key] = g
            infos[(arm,) + key] = info
            pairs = [colorize(fr) for fr in g]
            colored[(arm,) + key] = [im for im, _ in pairs]
            results[(arm,) + key] = flicker_stats(
                [data for _, data in pairs], energies[key])
        print(f"crafted arm {arm} ({ARM_NAMES[arm]})")

    # --- idempotence property test ------------------------------------------
    idem = {}
    for arm in ARMS:
        failures = {}
        for key in sorted(raw):
            g1 = crafted[(arm,) + key]
            g2, info2 = craft_clip(g1, clip_scoped=(arm >= 2))
            if g2 != g1:
                failures["/".join(key)] = idempotence_detail(g1, g2, info2)
        idem[arm] = failures
        status = "PASS" if not failures else f"FAIL ({len(failures)} clips)"
        print(f"idempotence arm {arm}: {status}")
        for cid, det in failures.items():
            print(f"  {cid}: {det}")

    # --- decision non-vacuousness (arm 1 per-frame variance) ----------------
    variance = {}
    for key in sorted(raw):
        info = infos[(1,) + key]
        ms, es = info["frame_merge_decisions"], info["frame_exempt_keys"]
        variance[key] = (
            len(set.union(*ms)) - len(set.intersection(*ms)),
            len(set.union(*es)) - len(set.intersection(*es)))
    walk_keys = [k for k in sorted(raw) if k[1] == "walk"]
    vacuous = all(variance[k] == (0, 0) for k in walk_keys)
    if vacuous:
        print("WARNING: arm 1 shows zero decision variance on every walk "
              "clip - the clip-scoping experiment is vacuous")

    # --- snake F7 softening --------------------------------------------------
    snake_f7 = {}
    for d in DIRS:
        key = ("snake", "walk", d)
        i1 = infos[(1,) + key]
        per_frame = [(len(e), n) for e, n
                     in zip(i1["frame_exempt_keys"], i1["n_clusters"])]
        snake_f7[d] = {
            "arm1_exempt_per_frame": per_frame,
            "arm2_exempt_keys": len(infos[(2,) + key]["exempt_keys"]),
            "arm2_total_keys": infos[(2,) + key]["n_keys_at_selout"],
            "arm3_exempt_keys": len(infos[(3,) + key]["exempt_keys"]),
            "arm3_total_keys": infos[(3,) + key]["n_keys_at_selout"],
        }

    # --- readable table -------------------------------------------------------
    print()
    print(f"{'clip':<22}{'arm':>4}{'mean':>8}{'max':>8}"
          f"{'changed':>9}{'energy':>9}{'rounds':>8}")
    for key in sorted(raw):
        for arm in ARMS:
            r = results[(arm,) + key]
            print(f"{'/'.join(key):<22}{arm:>4}"
                  f"{fmt(r['ratio_mean'], 8)}{fmt(r['ratio_max'], 8)}"
                  f"{r['changed_total']:>9}{r['energy_total']:>9.2f}"
                  f"{infos[(arm,) + key]['work_rounds']:>8}")
        mv, ev = variance[key]
        print(f"{'':<22}     arm-1 decision variance: "
              f"{mv} merge, {ev} outline")

    # --- static clip check -----------------------------------------------------
    static_ok = True
    static_report = {}
    for d in DIRS:
        for arm in ARMS:
            r = results[(arm, "wolf", "static", d)]
            ok = (r["changed_total"] == 0 and r["ratio_max"] == 0.0
                  and not r["failed"])
            static_ok = static_ok and ok
            static_report[f"arm{arm}/{d}"] = {
                "changed_total": r["changed_total"],
                "ratio_max": _num(r["ratio_max"]), "ok": ok}

    # --- per-arm walk aggregates + proposed threshold ---------------------------
    arm_walk = {}
    for arm in ARMS:
        allr = [p["ratio"] for k in walk_keys
                for p in results[(arm,) + k]["pairs"]]
        clip_maxes = [results[(arm,) + k]["ratio_max"] for k in walk_keys]
        arm_walk[arm] = {"mean": sum(allr) / len(allr),
                         "max": max(clip_maxes), "clip_maxes": clip_maxes}
    arm3_max = arm_walk[3]["max"]
    arm1_worst = arm_walk[1]["max"]
    arm1_typical_max = _median(arm_walk[1]["clip_maxes"])
    ladder = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0,
              6.0, 8.0, 10.0, 12.0, 15.0, 20.0, 25.0, 30.0, 40.0, 50.0]
    proposed = next((c for c in ladder if c >= arm3_max * 1.25),
                    float(math.ceil(arm3_max * 1.25)))
    margin_ok = proposed < arm1_worst

    # --- verdict block -----------------------------------------------------------
    print()
    print("==== VERDICT" + " =" * 30)
    for arm in ARMS:
        print(f"arm {arm} ({ARM_NAMES[arm]:<18}) walk flicker: "
              f"mean {fmt(arm_walk[arm]['mean'])} "
              f"max {fmt(arm_walk[arm]['max'])}")
    for arm in ARMS:
        print(f"idempotence arm {arm}: "
              + ("PASS" if not idem[arm] else "FAIL"))
    print("static pseudo-clip: "
          + ("PASS (changed 0, ratio 0.0 in all arms)" if static_ok
             else "FAIL " + str(static_report)))
    for d in DIRS:
        sf = snake_f7[d]
        a1 = _median([e for e, _n in sf["arm1_exempt_per_frame"]])
        print(f"snake F7 softening ({d}): arm3 exempted "
              f"{sf['arm3_exempt_keys']}/{sf['arm3_total_keys']} cluster "
              f"keys from outlining (arm2 "
              f"{sf['arm2_exempt_keys']}/{sf['arm2_total_keys']}, arm1 "
              f"median {a1:g} clusters/frame)")
    print("  note: once the budget merge consolidates the snake into one "
          "whole-body cluster (arms 1-2), its bbox min dim exceeds 3 and "
          "the F7 criterion stops firing - bbox-min is a weak thinness "
          "proxy after merging; the snapped arm keeps a thin tail key "
          "exempt. Recorded as an S3 finding.")
    total_var = sum(sum(variance[k]) for k in walk_keys)
    print(f"arm-1 decision variance across walk clips: {total_var} "
          f"differing decisions total ("
          + ("VACUOUS - experiment says nothing" if vacuous
             else "non-vacuous") + ")")
    print(f"PROPOSED M1 CI FLICKER THRESHOLD: {proposed}")
    print(f"  gate semantics: every walk clip x direction cell's max pair "
          f"ratio must stay under {proposed}; zero-motion churn (INF) is "
          f"an automatic fail.")
    print(f"  margin logic: smallest round value >= 1.25 x arm-3's worst "
          f"observed walk cell ({arm3_max:.2f} -> {arm3_max * 1.25:.2f}).")
    if margin_ok:
        print(f"  the gate sits below arm-1's worst cell ({arm1_worst:.2f})"
              f", so a regression to per-frame decisions + unsnapped "
              f"renders trips it at its worst cells; arm-1's typical cell "
              f"max ({arm1_typical_max:.2f}) is under the gate, so "
              f"mid-range regressions pass - it is a backstop, not a "
              f"detector.")
    else:
        print(f"  WARNING: the gate does not sit below arm-1's worst cell "
              f"({arm1_worst:.2f}) - it cannot catch a regression to "
              f"arm-1 behavior; flag for review.")

    # --- JSON ---------------------------------------------------------------------
    payload = {
        "params": {"size": SIZE, "supersample": SUPER,
                   "min_coverage": MIN_COV, "max_clusters": MAX_CLUSTERS,
                   "min_cluster_px": MIN_CLUSTER_PX,
                   "selout_soften_min_px": SOFT_MIN_PX,
                   "selout_soften_min_dim": SOFT_MIN_DIM,
                   "walk_frames": WALK_FRAMES, "idle_frames": IDLE_FRAMES,
                   "dirs": DIRS, "arms": {str(a): ARM_NAMES[a]
                                          for a in ARMS}},
        "clips": {}, "idempotence": {}, "static_check": static_report,
        "snake_f7": snake_f7,
        "arm_walk_aggregates": {
            str(a): {"ratio_mean": _num(arm_walk[a]["mean"]),
                     "ratio_max": _num(arm_walk[a]["max"]),
                     "per_clip_max": [_num(v) for v
                                      in arm_walk[a]["clip_maxes"]]}
            for a in ARMS},
        "proposed_threshold": {
            "value": proposed,
            "arm3_walk_max": _num(arm3_max),
            "headroom_factor": 1.25,
            "arm1_worst_max": _num(arm1_worst),
            "arm1_typical_max": _num(arm1_typical_max),
            "trips_on_arm1_worst_cells": margin_ok,
            "logic": "CI gate: every walk clip x direction cell's max "
                     "pair ratio must stay under the value; INF (churn "
                     "with no motion) always fails. Value = smallest "
                     "round number >= 1.25 x arm-3's worst observed walk "
                     "cell, checked to sit below arm-1's worst cell so a "
                     "regression to per-frame decisions + unsnapped "
                     "renders trips the gate; arm-1's typical cell is "
                     "below the gate (backstop, not detector)"},
    }
    for key in sorted(raw):
        cid = "/".join(key)
        entry = {"n_frames": len(raw[key]), "arms": {},
                 "arm1_decision_variance": {"merge": variance[key][0],
                                            "outline": variance[key][1]}}
        for arm in ARMS:
            r = results[(arm,) + key]
            info = infos[(arm,) + key]
            nmerge = (len(info["merge_decisions"])
                      if info["mode"] == "clip"
                      else sum(len(s) for s
                               in info["frame_merge_decisions"]))
            entry["arms"][str(arm)] = {
                "pairs": [{"frames": p["frames"], "changed": p["changed"],
                           "energy": _num(p["energy"]),
                           "ratio": _num(p["ratio"])} for p in r["pairs"]],
                "ratio_mean": _num(r["ratio_mean"]),
                "ratio_max": _num(r["ratio_max"]),
                "changed_total": r["changed_total"],
                "energy_total": _num(r["energy_total"]),
                "failed": r["failed"],
                "work_rounds": info["work_rounds"],
                "rule2_changes": info["rule2"],
                "rule3_changes": info["rule3"],
                "rule5_merge_decisions": nmerge,
            }
            if info["mode"] == "clip":
                entry["arms"][str(arm)]["merge_decisions"] = [
                    [key_str(a), key_str(b)]
                    for a, b in info["merge_decisions"]]
                entry["arms"][str(arm)]["exempt_keys"] = sorted(
                    key_str(k) for k in info["exempt_keys"])
        payload["clips"][cid] = entry
    for arm in ARMS:
        payload["idempotence"][str(arm)] = {
            "pass": not idem[arm], "failures": idem[arm]}
    json_path = os.path.join(out_dir, "spike03_flicker.json")
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, sort_keys=True, indent=2)
        f.write("\n")
    print("wrote", json_path)

    # --- visual evidence -------------------------------------------------------
    sheet_path = os.path.join(out_dir, "spike03_sheet.png")
    build_sheet(sheet_path, colored, _font(20), _font(14))
    print("wrote", sheet_path)
    font_gif = _font(15)
    for name, _ in CREATURES:
        for d in DIRS:
            per_arm = {arm: colored[(arm, name, "walk", d)] for arm in ARMS}
            gif_path = os.path.join(out_dir, f"spike03_walk_{name}_{d}.gif")
            build_gif(gif_path, per_arm, font_gif)
            print("wrote", gif_path)

    print(f"total runtime: {time.perf_counter() - t0:.1f}s")

    # hard exit criteria (after all evidence is on disk)
    assert all(not idem[a] for a in ARMS), \
        "idempotence failed: " + str({a: idem[a] for a in ARMS if idem[a]})
    assert static_ok, "static pseudo-clip check failed: " + str(static_report)


if __name__ == "__main__":
    main()
