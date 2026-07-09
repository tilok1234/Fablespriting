#!/usr/bin/env python3
"""Spike S1b — two more body plans: serpentine + amorphous.

Extends S1's evidence to the two plans it didn't cover:

  * serpentine (centipede): tests the traveling-phase-wave gait — segment k
    oscillates at offset k*delta, producing slither/scuttle from one gene;
  * amorphous (slime): tests the METABALL RENDERER FORK (risk R7) — no
    skeleton, no ellipsoid slabs; a field of weighted balls is ray-marched
    and thresholded, with squash/stretch driven by the same oscillators.

Reuses S1's projection convention, palette machinery, and sheet/GIF layout.

Run:  python3 spikes/spike01b_more_plans.py
Outputs: spikes/out/spike01b_sheet.png, spikes/out/spike01b_walk.gif
"""

import math
import os
import sys

from PIL import Image

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import spike01_slab_projection as s1  # noqa: E402
from spike01_slab_projection import (  # noqa: E402
    Slab, ray_hit, surface_tone, yaw_point, yaw_extents,
    RAMPS, TILT, DIRECTIONS, LIGHT, checker, upscale, craft_lite,
)

RAMPS["chitin"] = [(20, 40, 34), (74, 112, 80), (116, 156, 98), (172, 200, 128)]
RAMPS["slime"] = [(24, 44, 58), (36, 96, 108), (56, 148, 138), (110, 208, 172)]
RAMPS["slimehi"] = [(24, 44, 58), (110, 208, 172), (170, 235, 200), (232, 252, 235)]


# ----------------------------------------------------------------------------
# Metaball blob — the amorphous renderer fork.
# field(p) = sum of w * (1 - d^2)^2 over balls (d = per-axis normalized
# distance, so squash/stretch is just per-axis radii). Surface at field = TH.
# NOTE (finding F8): TH must sit well below the per-ball peak weight or the
# surface collapses to points at ball centers — a single ball of weight 1
# reaches field 1.0 only AT its center. TH=0.3 puts the visible surface at
# ~0.67x the ball radius, so radii are authored ~1.5x the intended size.
# ----------------------------------------------------------------------------

TH = 0.30

class Blob:
    def __init__(self, balls, material):
        # balls: list of (center, per-axis radii, weight)
        self.balls = balls
        self.material = material

    def yawed(self, q):
        return Blob([(yaw_point(c, q), yaw_extents(r, q), w)
                     for c, r, w in self.balls], self.material)

    def field(self, p):
        f = 0.0
        for (cx, cy, cz), (rx, ry, rz), w in self.balls:
            dx = (p[0] - cx) / rx
            if dx * dx >= 1.0:
                continue
            d2 = dx * dx + ((p[1] - cy) / ry) ** 2 + ((p[2] - cz) / rz) ** 2
            if d2 < 1.0:
                f += w * (1.0 - d2) ** 2
        return f

    def hit(self, sx, sy):
        """March the screen ray (x=sx, z=-TILT*y-sy) front-to-back; return
        (entry_y, point, normal) at the field=TH crossing, or None."""
        # prune: only balls whose x-slice the ray can enter define the range
        ys = []
        for (cx, cy, cz), (rx, ry, rz), _ in self.balls:
            if abs(sx - cx) < rx:
                ys.append(cy - ry)
                ys.append(cy + ry)
        if not ys:
            return None
        y0, y1 = min(ys), max(ys)
        step = 0.30
        y = y0
        while y <= y1:
            p = (sx, y, -TILT * y - sy)
            f = self.field(p)
            if f >= TH:
                lo, hi = y - step, y
                for _ in range(6):  # bisect refine
                    mid = (lo + hi) / 2
                    pm = (sx, mid, -TILT * mid - sy)
                    if self.field(pm) >= TH:
                        hi = mid
                    else:
                        lo = mid
                ph = (sx, hi, -TILT * hi - sy)
                e = 0.25
                n = s1._norm((
                    self.field((ph[0] - e, ph[1], ph[2])) - self.field((ph[0] + e, ph[1], ph[2])),
                    self.field((ph[0], ph[1] - e, ph[2])) - self.field((ph[0], ph[1] + e, ph[2])),
                    self.field((ph[0], ph[1], ph[2] - e)) - self.field((ph[0], ph[1], ph[2] + e)),
                ))
                return (hi, ph, n)
            y += step
        return None


def tone_from_normal(n):
    d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    return 2 if d > 0.30 else (1 if d > -0.25 else 0)


# ----------------------------------------------------------------------------
# Creatures
# ----------------------------------------------------------------------------

def centipede(phase, clip="walk"):
    """Serpentine: 7 segments, traveling wave x-offset, per-segment leg nubs."""
    s = []
    amp = 2.4 if clip == "walk" else 0.9
    delta = 0.85  # phase step per segment — THE serpentine gene
    n_seg = 7
    for i in range(n_seg):
        y = 9.5 - i * 3.0
        x = amp * math.sin(phase - i * delta)
        taper = 1.0 - 0.06 * i
        if i == 0:  # head
            s.append(Slab((x, y + 0.8, 3.6), (2.9, 3.0, 3.0), "chitin"))
            for sx in (-1, 1):
                s.append(Slab((x + sx * 1.6, y + 2.9, 4.4), (0.8, 0.7, 0.8), "glow"))
                # antennae sweep with the head's wave motion
                ax = x + sx * (2.2 + 0.6 * math.sin(phase))
                s.append(Slab((ax, y + 4.0, 5.2), (0.5, 1.8, 0.5), "chitin"))
        else:
            s.append(Slab((x, y, 2.9 * taper + 0.4),
                          (2.5 * taper, 2.2, 2.5 * taper), "chitin"))
            # leg nubs: lifted by the same wave, quarter-phase ahead
            lift = max(0.0, 1.0 * math.sin(phase - i * delta + math.pi / 2))
            for sx in (-1, 1):
                s.append(Slab((x + sx * 2.7 * taper, y, 1.1 + lift),
                              (0.6, 0.65, 1.2), "chitin"))
    return s


def slime(phase, clip="walk"):
    """Amorphous: metaball field + hop-squash locomotion; eyes are slabs."""
    # NOTE (finding F9): hop/stretch amplitudes must be resolution-remapped
    # like proportions (F3) — at full stretch the 16x16 render collapsed to
    # a 3px bar until the amplitudes below were moderated.
    if clip == "walk":
        hop = max(0.0, 1.2 * math.sin(phase))
        squash = 1.0 - 0.15 * math.sin(phase)          # wide when landed
    else:
        hop = 0.0
        squash = 1.0 + 0.10 * math.sin(phase)          # idle breathing
    stretch = 1.0 / squash
    z0 = 4.4 * stretch + hop
    # radii authored ~1.5x intended visible size (see TH note above)
    balls = [((0, 0, z0), (8.2 * squash, 7.8 * squash, 6.8 * stretch), 1.0),
             # crest wobbles a quarter-phase behind the hop (soft-body lag)
             ((1.6 * math.sin(phase - 1.3), -0.8, z0 + 3.6 * stretch),
              (4.0, 3.8, 3.4), 0.8),
             # skirt ball keeps the ground contact fat
             ((0, 0.6, 1.9 + hop), (7.4 * squash, 7.0 * squash, 3.6), 0.7)]
    # trailing drip that lags the hop
    drip = max(0.0, 1.1 * math.sin(phase - 1.9))
    balls.append(((0, -5.4 - 1.2 * math.sin(phase - 1.9), 1.6 + drip + hop * 0.3),
                  (2.3, 2.3, 2.0), 0.55))
    blob = Blob(balls, "slime")
    parts = [blob]
    # face: slabs sit proud of the field surface, depth-sorted normally
    fy = 4.6 * squash
    for sx in (-1, 1):
        parts.append(Slab((sx * 2.0, fy, z0 + 0.8), (0.85, 0.6, 1.1), "eye"))
    # glossy highlight blob-let riding the crest
    parts.append(Slab((-2.4, 2.6, z0 + 3.0 * stretch), (1.2, 0.9, 1.0), "slimehi"))
    return parts


CREATURES = [("centipede", centipede), ("slime", slime)]


# ----------------------------------------------------------------------------
# Renderer handling both Slabs and Blobs
# ----------------------------------------------------------------------------

def render_mixed(parts, size, quarter_turns, supersample=4, min_coverage=0.42):
    posed = []
    for p in parts:
        if isinstance(p, Blob):
            posed.append(p.yawed(quarter_turns))
        else:
            posed.append(Slab(yaw_point(p.center, quarter_turns),
                              yaw_extents(p.extents, quarter_turns), p.material))
    scale = size / 32.0
    grid = [[None] * size for _ in range(size)]
    ox = size / 2.0
    oy = size * (26.5 / 32.0)
    for py in range(size):
        for px in range(size):
            votes = {}
            hits = 0
            for iy in range(supersample):
                for ix in range(supersample):
                    sx = (px + (ix + 0.5) / supersample - ox) / scale
                    sy = (py + (iy + 0.5) / supersample - oy) / scale
                    best = None
                    for obj in posed:
                        if isinstance(obj, Blob):
                            h = obj.hit(sx, sy)
                            if h and (best is None or h[0] < best[0]):
                                best = (h[0], obj.material, tone_from_normal(h[2]))
                        else:
                            h = ray_hit(obj, sx, sy)
                            if h and (best is None or h[0] < best[0]):
                                best = (h[0], obj.material, surface_tone(obj, h[1]))
                    if best:
                        hits += 1
                        key = (best[1], best[2])
                        votes[key] = votes.get(key, 0) + 1
            if hits / (supersample * supersample) >= min_coverage:
                grid[py][px] = max(votes, key=votes.get)
    return craft_lite(grid, size)


# ----------------------------------------------------------------------------
# Sheet + GIF (S1 layout)
# ----------------------------------------------------------------------------

FRAMES = 4
CELL = 160
BG = (36, 34, 44)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out_dir, exist_ok=True)
    dirs = ["down", "left", "up", "right"]
    phases = [i * 2 * math.pi / FRAMES for i in range(FRAMES)]

    renders = {}
    for name, fn in CREATURES:
        renders[name] = {}
        for size in (32, 16):
            renders[name][size] = {}
            for d in dirs:
                q = DIRECTIONS[d]
                renders[name][size][d] = [
                    render_mixed(fn(ph), size, q,
                                 min_coverage=0.42 if size == 32 else 0.34)
                    for ph in phases]
        print(f"rendered {name}")

    pad = 12
    block_w = FRAMES * CELL + pad
    cols = 2 * len(CREATURES)
    sheet = Image.new("RGBA", (cols * block_w + pad, 4 * CELL + 2 * pad),
                      (*BG, 255))
    cell_bg = checker(CELL)
    for ci, (name, _) in enumerate(CREATURES):
        for si, size in enumerate((32, 16)):
            bx = pad + (ci * 2 + si) * block_w
            for di, d in enumerate(dirs):
                for fi in range(FRAMES):
                    tile = cell_bg.copy()
                    spr = upscale(renders[name][size][d][fi], CELL)
                    off = (CELL - spr.width) // 2
                    tile.alpha_composite(spr, (off, off))
                    sheet.alpha_composite(tile, (bx + fi * CELL, pad + di * CELL))
    sheet_path = os.path.join(out_dir, "spike01b_sheet.png")
    sheet.convert("RGB").save(sheet_path)
    print("wrote", sheet_path)

    gcell = 96
    gif_frames = []
    for fi in range(FRAMES):
        fr = Image.new("RGBA", (len(CREATURES) * 4 * gcell + 2 * pad,
                                2 * gcell + 2 * pad), (*BG, 255))
        for ci, (name, _) in enumerate(CREATURES):
            for di, d in enumerate(dirs):
                for si, size in enumerate((32, 16)):
                    spr = upscale(renders[name][size][d][fi], gcell)
                    off = (gcell - spr.width) // 2
                    fr.alpha_composite(spr, (pad + (ci * 4 + di) * gcell + off,
                                             pad + si * gcell + off))
        gif_frames.append(fr.convert("P", palette=Image.ADAPTIVE))
    gif_path = os.path.join(out_dir, "spike01b_walk.gif")
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                       duration=140, loop=0)
    print("wrote", gif_path)


if __name__ == "__main__":
    main()
