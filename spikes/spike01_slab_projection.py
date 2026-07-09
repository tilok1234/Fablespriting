#!/usr/bin/env python3
"""Spike S1 — slab projection feasibility test.

Question under test:
    Can a single micro-volume "slab" creature model produce readable,
    mutually-consistent 4-direction sprites at 32x32 AND 16x16, with
    oscillator-driven walk animation, across several body plans?

This is deliberately throwaway evidence code, not the product:
  * three hardcoded creatures (quadruped / biped / levitant) stand in for
    the future body-plan grammar;
  * shading + outline is a "craft-lite" pass, not the real craft solver;
  * no genome, no palette engine, no export metadata.

Outputs (written to spikes/out/):
    spike01_sheet.png  - contact sheet: all creatures, 4 dirs x 4 frames,
                         at 32x32 and 16x16 (upscaled for viewing)
    spike01_walk.gif   - animated walk cycles, all creatures & directions

Run:  python3 spikes/spike01_slab_projection.py
"""

import math
import os
from PIL import Image

# ----------------------------------------------------------------------------
# Projection
#
# Creature model space: x = creature's right, y = forward (facing), z = up.
# Units are pixels of the 32x32 target. The camera is orthographic, looking
# along +y, with a top-down shear TILT so depth-along-y reads as screen height
# (the classic 3/4 top-down JRPG view). A sprite direction is produced by
# yawing the whole creature in front of this fixed camera.
# ----------------------------------------------------------------------------

TILT = 0.5

# yaw (about z) applied to the creature for each facing, in 90-degree steps
DIRECTIONS = {"down": 2, "left": 1, "up": 0, "right": 3}  # value = #90deg CCW

LIGHT = (-0.45, -0.55, 0.70)  # from upper-left, slightly toward camera


def _norm(v):
    l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)


LIGHT = _norm(LIGHT)


def yaw_point(p, quarter_turns):
    x, y, z = p
    for _ in range(quarter_turns % 4):
        x, y = -y, x  # 90deg CCW about z
    return (x, y, z)


def yaw_extents(e, quarter_turns):
    a, b, c = e
    if quarter_turns % 2 == 1:
        a, b = b, a
    return (a, b, c)


class Slab:
    """Axis-aligned ellipsoid bound to the (implicit) skeleton pose."""

    def __init__(self, center, extents, material):
        self.center = center
        self.extents = extents
        self.material = material


def ray_hit(slab, sx, sy):
    """Intersect the screen-sample ray with an ellipsoid slab.

    Screen mapping: sx = x, sy = -z - TILT*y  =>  along the view ray,
    x = sx and z = -TILT*y - sy, parameterized by depth y. The -TILT term
    puts closer-to-camera geometry lower in the sprite (top-down convention:
    a creature facing "down" leads with its head at the sprite's bottom).
    Returns (entry_y, hit_point) or None.
    """
    cx, cy, cz = slab.center
    a, b, c = slab.extents
    dx = (sx - cx) / a
    # (y - cy)/b and (-TILT*y - sy - cz)/c are both linear in y
    k1, k0 = 1.0 / b, -cy / b
    m1, m0 = -TILT / c, (-sy - cz) / c
    A = k1 * k1 + m1 * m1
    B = 2 * (k1 * k0 + m1 * m0)
    C = dx * dx + k0 * k0 + m0 * m0 - 1.0
    disc = B * B - 4 * A * C
    if disc < 0:
        return None
    y = (-B - math.sqrt(disc)) / (2 * A)  # smaller y = closer to camera
    return (y, (sx, y, -TILT * y - sy))


def surface_tone(slab, p):
    """0=dark, 1=mid, 2=light, from the ellipsoid normal vs the light."""
    cx, cy, cz = slab.center
    a, b, c = slab.extents
    n = _norm(((p[0] - cx) / a ** 2, (p[1] - cy) / b ** 2, (p[2] - cz) / c ** 2))
    d = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]
    return 2 if d > 0.30 else (1 if d > -0.25 else 0)


# ----------------------------------------------------------------------------
# Palette: 4-tone ramps per material (outline, dark, mid, light)
# ----------------------------------------------------------------------------

RAMPS = {
    "fur":    [(43, 29, 46), (94, 60, 64), (148, 98, 84), (205, 158, 115)],
    "belly":  [(43, 29, 46), (140, 110, 96), (196, 168, 138), (238, 218, 183)],
    "imp":    [(38, 24, 51), (108, 44, 86), (172, 74, 96), (224, 130, 112)],
    "horn":   [(38, 24, 51), (150, 140, 130), (208, 200, 184), (246, 242, 228)],
    "flesh":  [(34, 26, 56), (86, 56, 118), (134, 92, 168), (186, 144, 210)],
    "wing":   [(34, 26, 56), (60, 70, 110), (96, 116, 158), (142, 170, 198)],
    "sclera": [(34, 26, 56), (190, 190, 180), (228, 228, 216), (250, 250, 242)],
    "iris":   [(34, 26, 56), (140, 30, 40), (196, 52, 48), (236, 100, 70)],
    "eye":    [(20, 14, 24), (20, 14, 24), (30, 22, 34), (52, 44, 58)],
    "glow":   [(120, 70, 20), (216, 150, 40), (244, 200, 70), (255, 240, 150)],
}


# ----------------------------------------------------------------------------
# Creatures — each is a function (phase, clip) -> [Slab]
# The oscillator "gait engine" lives inside these pose functions.
# ----------------------------------------------------------------------------

def wolf(phase, clip="walk"):
    s = []
    walking = clip == "walk"
    bob = 0.5 * math.sin(2 * phase) if walking else 0.25 * math.sin(phase)
    s.append(Slab((0, -0.5, 7.6 + bob), (3.9, 7.6, 3.4), "fur"))          # body
    s.append(Slab((0, 1.5, 5.9 + bob), (3.0, 5.6, 2.2), "belly"))         # belly
    s.append(Slab((0, 8.3, 9.8 + bob), (3.0, 3.4, 3.0), "fur"))           # head
    s.append(Slab((0, 11.6, 8.6 + bob), (1.6, 2.2, 1.5), "belly"))        # snout
    for sx in (-1, 1):
        s.append(Slab((sx * 2.0, 7.2, 12.6 + bob), (0.9, 1.0, 1.7), "fur"))   # ears
        s.append(Slab((sx * 1.6, 10.9, 10.4 + bob), (0.8, 0.7, 0.8), "eye"))  # eyes
    # legs: diagonal trot phasing
    hips = [(-2.6, 4.6, 0.0), (2.6, 4.6, math.pi),
            (-2.6, -5.2, math.pi), (2.6, -5.2, 0.0)]
    for hx, hy, off in hips:
        if walking:
            dy = 2.1 * math.sin(phase + off)
            dz = max(0.0, 1.5 * math.sin(phase + off + math.pi / 2))
        else:
            dy = dz = 0.0
        s.append(Slab((hx, hy + dy, 3.1 + dz / 2 + bob * 0.5),
                      (1.15, 1.5, 3.1), "fur"))
    # tail: lagged swing
    wag = math.sin(phase - 0.9) * (1.4 if walking else 0.7)
    s.append(Slab((wag, -8.8, 9.6 + bob), (1.1, 3.2, 1.1), "fur"))
    return s


def imp(phase, clip="walk"):
    s = []
    walking = clip == "walk"
    bob = 0.5 * math.sin(2 * phase) if walking else 0.3 * math.sin(phase)
    s.append(Slab((0, 0, 9.5 + bob), (3.3, 2.7, 4.6), "imp"))              # torso
    s.append(Slab((0, 1.2, 8.2 + bob), (2.4, 2.2, 3.0), "belly"))          # belly
    s.append(Slab((0, 0.4, 16.6 + bob), (3.9, 3.6, 3.8), "imp"))           # head
    for sx in (-1, 1):
        s.append(Slab((sx * 2.6, 0.4, 20.6 + bob), (0.8, 0.8, 1.7), "horn"))
        s.append(Slab((sx * 1.6, 3.4, 17.2 + bob), (0.95, 0.7, 1.05), "glow"))
        # arms swing opposite to same-side leg
        ady = 1.6 * math.sin(phase + (0 if sx < 0 else math.pi) + math.pi) if walking else 0.0
        s.append(Slab((sx * 3.9, ady * 0.8, 11.3 + bob), (1.05, 1.05, 2.9), "imp"))
    for sx, off in ((-1, 0.0), (1, math.pi)):
        if walking:
            dy = 1.9 * math.sin(phase + off)
            dz = max(0.0, 1.3 * math.sin(phase + off + math.pi / 2))
        else:
            dy = dz = 0.0
        s.append(Slab((sx * 1.8, dy, 2.9 + dz / 2), (1.25, 1.35, 2.9), "imp"))
    # tail with phase lag
    tx = 2.2 * math.sin(phase - 1.2)
    s.append(Slab((tx, -3.4, 7.0 + bob), (0.9, 2.6, 0.9), "imp"))
    return s


def watcher(phase, clip="walk"):
    """Levitant: no legs — hover bob + flap + trailing tendrils."""
    s = []
    hover = 1.3 * math.sin(phase)
    z0 = 12.0 + hover
    s.append(Slab((0, 0, z0), (5.4, 5.2, 5.4), "flesh"))                   # orb
    s.append(Slab((0, 3.9, z0), (3.0, 2.0, 3.0), "sclera"))                # sclera
    s.append(Slab((0, 5.1, z0), (1.6, 1.1, 1.6), "iris"))                  # iris
    s.append(Slab((0, 5.9, z0), (0.75, 0.6, 0.75), "eye"))                 # pupil
    flap = 1.6 * math.sin(3 * phase)                                       # fast CPG
    for sx in (-1, 1):
        s.append(Slab((sx * 6.0, -1.2, z0 + 2.2 + flap), (2.1, 0.9, 1.3), "wing"))
        s.append(Slab((sx * 3.4, 1.0, z0 + 5.0), (0.8, 0.8, 1.5), "horn"))  # spikes
    # tendrils trail the hover with increasing phase lag
    for i in range(3):
        lag = 0.7 * (i + 1)
        tx = 1.5 * math.sin(phase - lag) * (0.5 + 0.4 * i)
        tz = z0 - 6.2 - 1.7 * i - 0.5 * math.sin(phase - lag)
        s.append(Slab((tx, 0, tz), (0.9 - 0.15 * i, 0.9 - 0.15 * i, 1.3), "flesh"))
    return s


CREATURES = [("wolf", wolf), ("imp", imp), ("watcher", watcher)]


# ----------------------------------------------------------------------------
# Rasterizer: supersample -> majority-vote pixel ownership -> craft-lite pass
# ----------------------------------------------------------------------------

def render(slabs, size, quarter_turns, supersample=4, min_coverage=0.42):
    posed = [Slab(yaw_point(sl.center, quarter_turns),
                  yaw_extents(sl.extents, quarter_turns), sl.material)
             for sl in slabs]
    scale = size / 32.0
    img = [[None] * size for _ in range(size)]
    ox = size / 2.0
    oy = size * (26.5 / 32.0)  # ground line near sprite bottom
    for py in range(size):
        for px in range(size):
            votes = {}
            hits = 0
            for iy in range(supersample):
                for ix in range(supersample):
                    # screen sample in model units
                    sx = (px + (ix + 0.5) / supersample - ox) / scale
                    sy = (py + (iy + 0.5) / supersample - oy) / scale
                    best = None
                    for sl in posed:
                        h = ray_hit(sl, sx, sy)
                        if h and (best is None or h[0] < best[0]):
                            best = (h[0], sl, h[1])
                    if best:
                        hits += 1
                        key = (best[1].material, surface_tone(best[1], best[2]))
                        votes[key] = votes.get(key, 0) + 1
            total = supersample * supersample
            if hits / total >= min_coverage:
                mat, tone = max(votes, key=votes.get)
                img[py][px] = (mat, tone)
    return craft_lite(img, size)


def craft_lite(grid, size):
    """Minimal stand-in for the future craft pass: edge darkening (selout)
    and orphan-pixel culling. Returns an RGBA image."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    def opaque(x, y):
        return 0 <= x < size and 0 <= y < size and grid[y][x] is not None

    # cull orphan pixels (no 4-neighbors)
    for y in range(size):
        for x in range(size):
            if grid[y][x] and not any(
                    opaque(x + dx, y + dy)
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                grid[y][x] = None

    for y in range(size):
        for x in range(size):
            cell = grid[y][x]
            if not cell:
                continue
            mat, tone = cell
            edge = not all(opaque(x + dx, y + dy)
                           for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            color = RAMPS[mat][0] if edge else RAMPS[mat][tone + 1]
            out.putpixel((x, y), (*color, 255))
    return out


# ----------------------------------------------------------------------------
# Sheet + GIF assembly
# ----------------------------------------------------------------------------

FRAMES = 4
CELL = 160  # display cell size in the contact sheet
BG = (36, 34, 44)
GRID_BG = (46, 44, 56)


def checker(cell, n=8):
    im = Image.new("RGBA", (cell, cell), GRID_BG)
    step = cell // n
    for y in range(n):
        for x in range(n):
            if (x + y) % 2:
                for yy in range(step):
                    for xx in range(step):
                        im.putpixel((x * step + xx, y * step + yy),
                                    (*BG, 255))
    return im


def upscale(im, cell):
    f = cell // im.width
    return im.resize((im.width * f, im.height * f), Image.NEAREST)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out_dir, exist_ok=True)
    dirs = ["down", "left", "up", "right"]
    phases = [i * 2 * math.pi / FRAMES for i in range(FRAMES)]

    # render everything once: renders[creature][size][dir] = [frames]
    renders = {}
    for name, fn in CREATURES:
        renders[name] = {}
        for size in (32, 16):
            renders[name][size] = {}
            for d in dirs:
                q = DIRECTIONS[d]
                renders[name][size][d] = [
                    render(fn(ph), size, q,
                           min_coverage=0.42 if size == 32 else 0.34)
                    for ph in phases]
        print(f"rendered {name}")

    # --- contact sheet: per creature, [4 dirs x 4 frames]@32 then @16 -------
    pad = 12
    block_w = FRAMES * CELL + pad
    cols = 2 * len(CREATURES)  # 32 and 16 blocks per creature
    sheet = Image.new("RGBA",
                      (cols * block_w + pad, 4 * CELL + 2 * pad),
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
                    sheet.alpha_composite(
                        tile, (bx + fi * CELL, pad + di * CELL))
    sheet_path = os.path.join(out_dir, "spike01_sheet.png")
    sheet.convert("RGB").save(sheet_path)
    print("wrote", sheet_path)

    # --- GIF: all creatures walking, rows = sizes, cols = creature x dir ----
    gcell = 96
    gif_frames = []
    for fi in range(FRAMES):
        fr = Image.new("RGBA",
                       (len(CREATURES) * 4 * gcell + 2 * pad,
                        2 * gcell + 2 * pad), (*BG, 255))
        for ci, (name, _) in enumerate(CREATURES):
            for di, d in enumerate(dirs):
                for si, size in enumerate((32, 16)):
                    spr = upscale(renders[name][size][d][fi], gcell)
                    off = (gcell - spr.width) // 2
                    fr.alpha_composite(
                        spr, (pad + (ci * 4 + di) * gcell + off,
                              pad + si * gcell + off))
        gif_frames.append(fr.convert("P", palette=Image.ADAPTIVE))
    gif_path = os.path.join(out_dir, "spike01_walk.gif")
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                       duration=140, loop=0)
    print("wrote", gif_path)


if __name__ == "__main__":
    main()
