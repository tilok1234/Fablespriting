#!/usr/bin/env python3
"""Spike S4 — 16x16 proportion remap (blind face-readability test).

Question under test (ROADMAP S4, risk R3):
    Does a proportion-remap stage make 16x16 front views readable where
    naive 0.5x scaling fails? S1 finding F3: at 16x16 the side views
    survive but front views collapse and faces vanish — real pixel artists
    redraw at 16 with bigger heads and eyes. Design 04 section 6 specifies
    the remap; this spike builds it, tunes it by eye, and puts the tuned
    result in front of human raters.

Two conditions, BOTH rendered natively at 16x16 via
s1.render(slabs, 16, q, min_coverage=0.34) — the remap never renders at
32 and downscales:
    N naive - spike01 pose functions rendered directly at 16, exactly as
              Spike S1 did (the failing baseline);
    R remap - the slab list transformed by the remap stage below, then
              rendered at 16 with identical parameters.
A 32x32 reference row (normal render) appears on the diagnostic sheet for
context only. Directions: down (the front view that failed in S1 —
primary) and right (side view — must not regress).

Remap stage (design 04 section 6). The genes are hardcoded REMAP_*
constants; their values were tuned by eye against spike04_sheet.png —
that tuning IS this spike's legitimate design work, and the raters judge
the tuned result. Design 04 names head/focal gain as genome genes
(remap.head_gain, remap.focal_gain), so those two are per-creature
constants — the tuning showed no single global pair exists (see the
notes at REMAP_HEAD_GAIN):
  1 HEAD GAIN    - the head assembly (head + focal slabs) scales about the
                   head slab's center: extents AND offsets-from-head-center
                   of every head-assembly slab scale by REMAP_HEAD_GAIN,
                   so the assembly stays coherent. Minimal reposition (a
                   downward z shift of the whole assembly) fires only if
                   the grown head would clip the canvas top.
  2 FOCAL GAIN   - focal slabs (eyes) get an ADDITIONAL extent-only scale
                   REMAP_FOCAL_GAIN on top of head gain. A 16 px face
                   lives or dies by its eyes.
  3 ORNAMENT DROP- ornament slabs whose projected screen width/height at
                   16 would be sub-pixel (max half-extent * 0.5 <
                   REMAP_ORNAMENT_DROP_PX) are DROPPED, not rendered.
  4 LIMB GIRTH CLAMP - limb slab x/y extents clamp to
                   >= REMAP_LIMB_MIN_EXT model units (2.0 = 1 px at 16).
  5 GAIT AMPLITUDE RE-QUANTIZATION (S1b finding F9; design 04 s6 bullet
                   4) - for the 16x16 walk animation, Spike S3's
                   displacement snapping on the 16-px grid: per slab, per
                   direction, per screen axis,
                     snapped(f) = clip-mean + round((pos(f) - mean) / 2.0) * 2.0
                   in model units (1 output px at 16 = 2.0 model units),
                   round = ties-to-even (S3 finding F14) — a 2.1-unit step
                   becomes exactly 1 px at 16, not 1.05. Static sheet
                   frames are phase-0 poses WITHOUT animation snapping.

Slab role maps (by construction order in spike01's pose functions,
verified against the code; head-gain anchor slab marked *):
    wolf    0 body, 1 belly (body), 2 head*, 3 snout (head), 4/6 ears
            (head), 5/7 eyes (focal), 8-11 legs (limb), 12 tail (ornament)
    imp     0 torso (body), 1 belly (body), 2 head*, 3/6 horns (head),
            4/7 glow-eyes (focal), 5/8 arms (limb), 9/10 legs (limb),
            11 tail (ornament)
    watcher 0 orb (head* — the whole creature is a face), 1 sclera / 2
            iris / 3 pupil (focal), 4/6 wings (limb), 5/7 spikes
            (ornament), 8-10 tendrils (ornament)
Wolf and imp are the REQUIRED evidence (ROADMAP S4 names their faces);
the watcher is bonus evidence.

Rater protocol (pinned): 2+ humans view spikes/out/spike04_judging.png at
100% zoom. It shows, per creature x direction, a blind pair of panels
labeled 1/2 (N and R shuffled per cell with random.Random(20260710),
fixed iteration order creatures-outer/dirs-inner; sealed mapping in
spike04_mapping.txt) — each panel shown at 1x actual size AND 4x
nearest-neighbor, side by side. Per cell each rater answers:
    Q1 per panel (absolute, the primary criterion): "can you locate the
       head and both eyes?" — yes / no.
    Q2 (paired): "which panel reads better as the creature's face?"
       — 1 / 2 / tie.
EXIT CRITERION: S4 passes if the remapped panel gets Q1 = yes from BOTH
raters on wolf/down and imp/down. Q2 majorities are supporting evidence.
HONESTY NOTE: the blinding is weak — bigger heads are identifiable as the
remap condition — which is why the absolute Q1 is primary, not the paired
Q2. Raters must rate the judging sheet BEFORE opening
spike04_mapping.txt, spike04_sheet.png, or the GIFs.
Pre-registered fallback if S4 fails (RISKS.md R3): 16x16 becomes a
derived-but-hand-tunable output tier.

Deterministic: the only randomness is the seeded blind shuffle; re-runs
are byte-identical.

Run:  python spikes/spike04_remap16.py
Outputs (written to spikes/out/):
    spike04_judging.png   - blind rating sheet (the test — rate this first)
    spike04_sheet.png     - de-blinded diagnostic sheet (32 ref / naive 16 /
                            remap 16, with true labels + remap captions)
    spike04_walk_<creature>_down.gif - 16x16 walk, naive vs remap+snapped,
                            blind labels, 8x, 140 ms (wolf, imp)
    spike04_remap.json    - role maps, gains, drops, clamps, amplitude
                            peaks before/after, blind mapping
    spike04_mapping.txt   - sealed de-blinding key
"""

import json
import math
import os
import random
import sys
import time

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike01_slab_projection as s1  # noqa: E402

TAU = 2 * math.pi
SIZE = 16
SCALE = SIZE / 32.0        # model units -> output px at 16
MIN_COV_16 = 0.34          # S1 finding F4 thresholds
MIN_COV_32 = 0.42
DIRS = ["down", "right"]   # down first: the front view that failed in S1
CREATURE_ORDER = ["wolf", "imp", "watcher"]
GIF_CREATURES = ["wolf", "imp"]
WALK_FRAMES = 4            # uniform sampling + uniform timing per S2 verdict
FRAME_MS = 140
BLIND_SEED = 20260710
CONDS = ["naive", "remap"]
COND_LABELS = {"naive": "naive 16", "remap": "remap 16"}
TEXT = (235, 232, 240, 255)

# --- remap genes (design 04 s6), tuned by eye on spike04_sheet.png ----------
# Design 04 names head/focal gain as GENOME genes (remap.head_gain,
# remap.focal_gain), so they are per-creature constants here. Tuning notes
# from this spike (started at the design defaults 1.3 / 1.5):
#   * a global gain pair does not exist: the wolf needs head x1.6 before its
#     eye pixels move off the silhouette edge (edge pixels get recolored to
#     outline tone by craft-lite and vanish), while the watcher — whose whole
#     body IS the head — swallows its own wings for head gain > ~1.3;
#   * focal gain 1.5+ merges the wolf's and imp's eye pair into a single
#     band across the face; 1.3 keeps a 1 px gap between the eyes;
#   * the watcher's LAYERED eye (sclera -> iris -> pupil, stacked along y)
#     tolerates NO extra focal gain: extents grow relative to offsets, and
#     under the TILT=0.5 slanted ray the tall sclera's shoulder then enters
#     the ray before the iris pole — the eye renders as a blank white blob
#     for focal gain >~1.05. Focal gain is a point-eye gene, not a
#     layered-eye-stack gene (S4 finding for the design-04 grammar).
REMAP_HEAD_GAIN = {"wolf": 1.6, "imp": 1.5, "watcher": 1.3}
REMAP_FOCAL_GAIN = {"wolf": 1.3, "imp": 1.3, "watcher": 1.0}
REMAP_ORNAMENT_DROP_PX = 0.5  # drop ornament if max half-extent * SCALE < this
REMAP_LIMB_MIN_EXT = 2.0     # min limb x/y half-extent, model units (1 px @16)
HEAD_Z_CLIP = 26.5           # canvas-top bound: z + TILT*|y| <= 26.5 (model)

# --- slab role maps (verified against spike01 pose-function order) ----------
ROLES = {
    "wolf": {
        "anchor": 2,
        "roles": ["body", "body", "head", "head", "head", "focal", "head",
                  "focal", "limb", "limb", "limb", "limb", "ornament"],
        "names": ["body", "belly", "head", "snout", "ear_l", "eye_l",
                  "ear_r", "eye_r", "leg_fl", "leg_fr", "leg_bl", "leg_br",
                  "tail"],
    },
    "imp": {
        "anchor": 2,
        "roles": ["body", "body", "head", "head", "focal", "limb", "head",
                  "focal", "limb", "limb", "limb", "ornament"],
        "names": ["torso", "belly", "head", "horn_l", "eye_l", "arm_l",
                  "horn_r", "eye_r", "arm_r", "leg_l", "leg_r", "tail"],
    },
    "watcher": {
        "anchor": 0,
        "roles": ["head", "focal", "focal", "focal", "limb", "ornament",
                  "limb", "ornament", "ornament", "ornament", "ornament"],
        "names": ["orb", "sclera", "iris", "pupil", "wing_l", "spike_l",
                  "wing_r", "spike_r", "tendril0", "tendril1", "tendril2"],
    },
}


# ----------------------------------------------------------------------------
# Remap stage — pure slab-list transform, applied per frame before s1.render.
# ----------------------------------------------------------------------------

def remap16(slabs, name):
    """Apply remap ops 1-4 to one posed slab list. Returns (new slab list,
    info) where info records dropped slab indices, girth clamps and the
    head-assembly canvas-clip shift (0.0 = no reposition needed)."""
    spec = ROLES[name]
    head_gain = REMAP_HEAD_GAIN[name]
    focal_gain = REMAP_FOCAL_GAIN[name]
    roles, anchor = spec["roles"], spec["anchor"]
    ax, ay, az = slabs[anchor].center
    scaled = []
    dropped, clamped = [], []
    for i, sl in enumerate(slabs):
        r = roles[i]
        (cx, cy, cz), (ex, ey, ez) = sl.center, sl.extents
        if r in ("head", "focal"):
            g = head_gain
            cx = ax + (cx - ax) * g
            cy = ay + (cy - ay) * g
            cz = az + (cz - az) * g
            eg = g * (focal_gain if r == "focal" else 1.0)
            ex, ey, ez = ex * eg, ey * eg, ez * eg
        elif r == "ornament":
            if max(ex, ey, ez) * SCALE < REMAP_ORNAMENT_DROP_PX:
                dropped.append(i)
                continue
        elif r == "limb":
            nx, ny = max(ex, REMAP_LIMB_MIN_EXT), max(ey, REMAP_LIMB_MIN_EXT)
            if (nx, ny) != (ex, ey):
                clamped.append((i, (ex, ey), (nx, ny)))
                ex, ey = nx, ny
        scaled.append((r, s1.Slab((cx, cy, cz), (ex, ey, ez), sl.material)))
    # minimal reposition: if the grown head assembly would clip the canvas
    # top under any yaw (conservative bound over both screen-y sources),
    # shift the WHOLE assembly down by the overshoot — it must stay coherent
    over = 0.0
    for r, sl in scaled:
        if r in ("head", "focal"):
            (cx, cy, cz), (ex, ey, ez) = sl.center, sl.extents
            top = cz + ez + s1.TILT * max(abs(cx) + ex, abs(cy) + ey)
            over = max(over, top - HEAD_Z_CLIP)
    if over > 0:
        scaled = [(r, s1.Slab((sl.center[0], sl.center[1],
                               sl.center[2] - over), sl.extents, sl.material)
                   if r in ("head", "focal") else sl)
                  for r, sl in scaled]
    return ([sl for _, sl in scaled],
            {"dropped": dropped, "clamped": clamped, "head_shift": over})


# ----------------------------------------------------------------------------
# Remap op 5 — gait amplitude re-quantization (S3 displacement snapping on
# the 16-px grid). Screen shifts are realized as model-space center shifts
# (screen x -> post-yaw x; screen y -> post-yaw -z), un-yawed so s1.render's
# own yaw reproduces them exactly; depth (y) is untouched, so occlusion
# still uses true depths, same as S3's sampling-shift formulation.
# ----------------------------------------------------------------------------

def _rnd(v):
    """round() = ties-to-even — load-bearing per S3 finding F14: gait code
    likes half-pixel amplitudes, and half-up rounding turns an exact
    +-0.5 px oscillation into a 1 px square wave."""
    return round(v)


def project16(center, q):
    """Continuous screen position (output px at 16) of a model point."""
    x, y, z = s1.yaw_point(center, q)
    return (SIZE / 2.0 + x * SCALE,
            SIZE * (26.5 / 32.0) + (-z - s1.TILT * y) * SCALE)


def snap_walk(lists, q):
    """lists = remapped slab lists, one per phase. Returns (shifted lists,
    amplitude stats). Per slab, per screen axis: displacement from the
    clip-mean rounds to the 16 grid (1 output px = 2.0 model units); the
    clip-mean itself stays continuous (design 04 s6 bullet 4)."""
    nf, ns = len(lists), len(lists[0])
    cent = [[project16(sl.center, q) for sl in lst] for lst in lists]
    inv = (4 - q) % 4
    snapped = [[None] * ns for _ in range(nf)]
    disp_b, disp_a = {"x": [], "y": []}, {"x": [], "y": []}
    for j in range(ns):
        mx = sum(cent[i][j][0] for i in range(nf)) / nf
        my = sum(cent[i][j][1] for i in range(nf)) / nf
        for i in range(nf):
            px, py = cent[i][j]
            sx, sy = mx + _rnd(px - mx), my + _rnd(py - my)
            snapped[i][j] = (sx, sy)
            disp_b["x"].append(px - mx)
            disp_b["y"].append(py - my)
            disp_a["x"].append(sx - mx)
            disp_a["y"].append(sy - my)
    shifted = []
    for i in range(nf):
        out = []
        for j, sl in enumerate(lists[i]):
            dx_px = snapped[i][j][0] - cent[i][j][0]
            dy_px = snapped[i][j][1] - cent[i][j][1]
            dv = s1.yaw_point((dx_px / SCALE, 0.0, -dy_px / SCALE), inv)
            cx, cy, cz = sl.center
            out.append(s1.Slab((cx + dv[0], cy + dv[1], cz + dv[2]),
                               sl.extents, sl.material))
        shifted.append(out)
    step_b, step_a = {"x": 0.0, "y": 0.0}, {"x": 0.0, "y": 0.0}
    for j in range(ns):
        for i in range(nf):
            k = (i + 1) % nf
            for ax, ai in (("x", 0), ("y", 1)):
                step_b[ax] = max(step_b[ax],
                                 abs(cent[k][j][ai] - cent[i][j][ai]))
                step_a[ax] = max(step_a[ax],
                                 abs(snapped[k][j][ai] - snapped[i][j][ai]))
    stats = {
        "peak_disp_before_px": {a: max(abs(v) for v in disp_b[a])
                                for a in ("x", "y")},
        "peak_disp_after_px": {a: max(abs(v) for v in disp_a[a])
                               for a in ("x", "y")},
        "peak_step_before_px": step_b,
        "peak_step_after_px": step_a,
    }
    return shifted, stats


# ----------------------------------------------------------------------------
# Drawing helpers (same conventions as spike02/03)
# ----------------------------------------------------------------------------

def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # ancient Pillow: bitmap default only
        return ImageFont.load_default()


def _center_text(draw, text, cx, cy, font, fill=TEXT):
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=font)
    draw.text((cx - (x0 + x1) / 2.0, cy - (y0 + y1) / 2.0),
              text, font=font, fill=fill)


def _tile(img, disp):
    """Sprite composited on a checker tile at integer upscale to disp px."""
    t = s1.checker(disp)
    t.alpha_composite(s1.upscale(img, disp), (0, 0))
    return t


# ----------------------------------------------------------------------------
# Blind judging sheet — per creature x direction, panels 1/2 (shuffled),
# each panel at 1x actual size and 4x, cell headers name creature/direction
# but NOT conditions. Modest total size: 100% zoom fits a screen.
# ----------------------------------------------------------------------------

J_PAD = 14
J_GAP = 8
J_1X, J_4X = SIZE, SIZE * 4
J_PANEL_W = J_1X + J_GAP + J_4X
J_PANEL_GAP = 22
J_LABEL_H = 30
J_HDR_H = 24
J_CELL_W = 2 * J_PANEL_W + J_PANEL_GAP
J_CELL_H = J_HDR_H + J_LABEL_H + J_4X


def build_judging(path, static, blind, font_hdr, font_lab):
    w = J_PAD + len(DIRS) * (J_CELL_W + J_PAD)
    h = J_PAD + len(CREATURE_ORDER) * (J_CELL_H + J_PAD)
    sheet = Image.new("RGBA", (w, h), (*s1.BG, 255))
    draw = ImageDraw.Draw(sheet)
    for ci, name in enumerate(CREATURE_ORDER):
        for di, d in enumerate(DIRS):
            bx = J_PAD + di * (J_CELL_W + J_PAD)
            by = J_PAD + ci * (J_CELL_H + J_PAD)
            draw.text((bx, by + 2), f"{name} / {d}", font=font_hdr, fill=TEXT)
            order = blind[f"{name}/{d}"]
            for pi, cond in enumerate(order):
                px = bx + pi * (J_PANEL_W + J_PANEL_GAP)
                py = by + J_HDR_H
                _center_text(draw, str(pi + 1), px + J_PANEL_W / 2,
                             py + J_LABEL_H / 2 - 2, font_lab)
                img = static[(name, d)][cond]
                iy = py + J_LABEL_H
                sheet.alpha_composite(_tile(img, J_1X),
                                      (px, iy + J_4X - J_1X))
                sheet.alpha_composite(_tile(img, J_4X),
                                      (px + J_1X + J_GAP, iy))
    sheet.convert("RGB").save(path)


# ----------------------------------------------------------------------------
# De-blinded diagnostic sheet — rows = 32 reference / naive 16 / remap 16,
# cells at 1x, 4x and 10x, true condition labels, captions listing what the
# remap did. This is the tuning instrument, not the test.
# ----------------------------------------------------------------------------

D_PAD = 12
D_LABEL_W = 116
D_ROWS = [("32 reference", "ref32", 32), ("naive 16", "naive", SIZE),
          ("remap 16", "remap", SIZE)]
D_SCALES = (1, 4, 10)
D_HDR_H = 26
D_CAP_H = 40


def build_sheet(path, static, captions, font_hdr, font_txt):
    row_w = max(sum(base * f + D_PAD for f in D_SCALES)
                for _, _, base in D_ROWS)
    row_hs = [max(base * f for f in D_SCALES) + D_PAD for _, _, base in D_ROWS]
    block_w = D_LABEL_W + row_w
    block_h = D_HDR_H + sum(row_hs) + D_CAP_H
    w = D_PAD + len(DIRS) * (block_w + D_PAD)
    h = D_PAD + len(CREATURE_ORDER) * (block_h + D_PAD)
    sheet = Image.new("RGBA", (w, h), (*s1.BG, 255))
    draw = ImageDraw.Draw(sheet)
    for ci, name in enumerate(CREATURE_ORDER):
        for di, d in enumerate(DIRS):
            bx = D_PAD + di * (block_w + D_PAD)
            by = D_PAD + ci * (block_h + D_PAD)
            draw.text((bx, by + 2), f"{name} / {d} / phase 0",
                      font=font_hdr, fill=TEXT)
            ry = by + D_HDR_H
            for (label, key, base), rh in zip(D_ROWS, row_hs):
                draw.text((bx, ry + rh // 2 - 10), label,
                          font=font_txt, fill=TEXT)
                img = static[(name, d)][key]
                cx = bx + D_LABEL_W
                for f in D_SCALES:
                    disp = base * f
                    sheet.alpha_composite(_tile(img, disp),
                                          (cx, ry + (rh - D_PAD) - disp))
                    cx += disp + D_PAD
                ry += rh
            for li, line in enumerate(captions[name]):
                draw.text((bx, ry + 2 + li * 17), line,
                          font=font_txt, fill=TEXT)
    sheet.convert("RGB").save(path)


# ----------------------------------------------------------------------------
# Walk GIFs — naive vs remap+snapped side by side, 8x, blind labels
# consistent with the judging-sheet mapping for the same creature/down cell.
# ----------------------------------------------------------------------------

G_PANEL = SIZE * 8
G_PAD = 12
G_LABEL_H = 34


def build_gif(path, frames_by_cond, order, font):
    w = 2 * G_PANEL + 3 * G_PAD
    h = G_LABEL_H + G_PANEL + 2 * G_PAD
    base = Image.new("RGBA", (w, h), (*s1.BG, 255))
    tile = s1.checker(G_PANEL)
    draw = ImageDraw.Draw(base)
    for i in range(2):
        x = G_PAD + i * (G_PANEL + G_PAD)
        base.alpha_composite(tile, (x, G_PAD + G_LABEL_H))
        _center_text(draw, str(i + 1), x + G_PANEL / 2,
                     G_PAD + G_LABEL_H / 2, font)
    frames = []
    for fi in range(WALK_FRAMES):
        fr = base.copy()
        for i, cond in enumerate(order):
            fr.alpha_composite(
                s1.upscale(frames_by_cond[cond][fi], G_PANEL),
                (G_PAD + i * (G_PANEL + G_PAD), G_PAD + G_LABEL_H))
        frames.append(fr.convert("P", palette=Image.ADAPTIVE))
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=FRAME_MS, loop=0)


# ----------------------------------------------------------------------------
# Reporting helpers
# ----------------------------------------------------------------------------

def _r4(v):
    return round(v, 4)


def clamp_text(spec, info, compact=False):
    if not info["clamped"]:
        return "none"
    if compact:  # sheet captions: names only, full numbers live in the JSON
        return (f"x/y ext -> >={REMAP_LIMB_MIN_EXT:g}: "
                + ", ".join(spec["names"][i]
                            for i, _f, _t in info["clamped"]))
    return ", ".join(
        f"{spec['names'][i]} ({fx:g},{fy:g})->({tx:g},{ty:g})"
        for i, (fx, fy), (tx, ty) in info["clamped"])


def drop_text(spec, info):
    if not info["dropped"]:
        return "none"
    return ", ".join(spec["names"][i] for i in info["dropped"])


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    t0 = time.perf_counter()
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out_dir, exist_ok=True)
    fnmap = dict(s1.CREATURES)

    # --- sanity: role maps must cover the pose functions exactly -----------
    for name in CREATURE_ORDER:
        n = len(fnmap[name](0.0))
        assert n == len(ROLES[name]["roles"]) == len(ROLES[name]["names"]), \
            f"{name}: role map has wrong slab count"

    # --- static renders: phase 0, no animation snapping --------------------
    static, remap_info = {}, {}
    for name in CREATURE_ORDER:
        fn = fnmap[name]
        rslabs, info = remap16(fn(0.0), name)
        remap_info[name] = info
        for d in DIRS:
            q = s1.DIRECTIONS[d]
            static[(name, d)] = {
                "ref32": s1.render(fn(0.0), 32, q, min_coverage=MIN_COV_32),
                "naive": s1.render(fn(0.0), SIZE, q,
                                   min_coverage=MIN_COV_16),
                "remap": s1.render(rslabs, SIZE, q,
                                   min_coverage=MIN_COV_16),
            }
        print(f"rendered {name} static (ref32 / naive 16 / remap 16, "
              f"{len(DIRS)} dirs)")

    # --- walk clips for the GIFs: naive vs remap + snapped ------------------
    phases = [i * TAU / WALK_FRAMES for i in range(WALK_FRAMES)]
    walk, amp = {}, {}
    for name in GIF_CREATURES:
        fn = fnmap[name]
        q = s1.DIRECTIONS["down"]
        naive = [s1.render(fn(ph), SIZE, q, min_coverage=MIN_COV_16)
                 for ph in phases]
        rlists = [remap16(fn(ph), name)[0] for ph in phases]
        snapped, stats = snap_walk(rlists, q)
        remap = [s1.render(lst, SIZE, q, min_coverage=MIN_COV_16)
                 for lst in snapped]
        walk[name] = {"naive": naive, "remap": remap}
        amp[f"{name}/down"] = stats
        print(f"rendered {name} walk down ({WALK_FRAMES} frames x 2 conds, "
              "snapped)")

    # --- blinding: fixed iteration order, creatures outer, dirs inner ------
    rng = random.Random(BLIND_SEED)
    blind = {}
    for name in CREATURE_ORDER:
        for d in DIRS:
            blind[f"{name}/{d}"] = rng.sample(CONDS, 2)

    # --- outputs -------------------------------------------------------------
    judging_path = os.path.join(out_dir, "spike04_judging.png")
    build_judging(judging_path, static, blind, _font(16), _font(24))
    print("wrote", judging_path)

    captions = {}
    for name in CREATURE_ORDER:
        spec, info = ROLES[name], remap_info[name]
        hg, fg = REMAP_HEAD_GAIN[name], REMAP_FOCAL_GAIN[name]
        captions[name] = [
            f"remap: head x{hg:g} about {spec['names'][spec['anchor']]},"
            f" focal x{fg:g} extra (x{hg * fg:g} total);"
            f" head shift {info['head_shift']:.2f}",
            f"dropped: {drop_text(spec, info)};"
            f" girth clamp {clamp_text(spec, info, compact=True)}",
        ]
    sheet_path = os.path.join(out_dir, "spike04_sheet.png")
    build_sheet(sheet_path, static, captions, _font(18), _font(14))
    print("wrote", sheet_path)

    gif_paths = []
    for name in GIF_CREATURES:
        p = os.path.join(out_dir, f"spike04_walk_{name}_down.gif")
        build_gif(p, walk[name], blind[f"{name}/down"], _font(20))
        gif_paths.append(p)
        print("wrote", p)

    payload = {
        "params": {
            "size": SIZE, "min_coverage_16": MIN_COV_16,
            "min_coverage_32_ref": MIN_COV_32,
            "remap_head_gain": REMAP_HEAD_GAIN,
            "remap_focal_gain": REMAP_FOCAL_GAIN,
            "gain_note": "per-creature genes per design 04 s6 "
                         "(remap.head_gain / remap.focal_gain)",
            "remap_ornament_drop_px": REMAP_ORNAMENT_DROP_PX,
            "remap_limb_min_extent": REMAP_LIMB_MIN_EXT,
            "walk_frames": WALK_FRAMES, "frame_ms": FRAME_MS,
            "dirs": DIRS, "blind_seed": BLIND_SEED,
        },
        "roles": {
            name: {"anchor": ROLES[name]["anchor"],
                   "slabs": [{"index": i, "name": nm, "role": r}
                             for i, (nm, r) in enumerate(
                                 zip(ROLES[name]["names"],
                                     ROLES[name]["roles"]))]}
            for name in CREATURE_ORDER},
        "remap_ops": {
            name: {
                "dropped": [{"index": i, "name": ROLES[name]["names"][i]}
                            for i in remap_info[name]["dropped"]],
                "clamped": [{"index": i, "name": ROLES[name]["names"][i],
                             "from_xy": [_r4(fx), _r4(fy)],
                             "to_xy": [_r4(tx), _r4(ty)]}
                            for i, (fx, fy), (tx, ty)
                            in remap_info[name]["clamped"]],
                "head_shift": _r4(remap_info[name]["head_shift"]),
            } for name in CREATURE_ORDER},
        "amplitude_px_at_16": {
            clip: {k: {a: _r4(v) for a, v in d.items()}
                   for k, d in stats.items()}
            for clip, stats in amp.items()},
        "blind_mapping": {
            **{cell: {str(i + 1): COND_LABELS[c]
                      for i, c in enumerate(order)}
               for cell, order in blind.items()},
            **{f"gif:{name}/down": {str(i + 1): COND_LABELS[c]
                                    for i, c in
                                    enumerate(blind[f"{name}/down"])}
               for name in GIF_CREATURES},
        },
    }
    json_path = os.path.join(out_dir, "spike04_remap.json")
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, sort_keys=True, indent=2)
        f.write("\n")
    print("wrote", json_path)

    lines = ["SEALED — rate spike04_judging.png fully before reading below.",
             ""]
    for name in CREATURE_ORDER:
        for d in DIRS:
            order = blind[f"{name}/{d}"]
            lines.append(f"spike04_judging.png {name}/{d}: " + ", ".join(
                f"panel {i + 1} = {COND_LABELS[c]}"
                for i, c in enumerate(order)))
    for name in GIF_CREATURES:
        order = blind[f"{name}/down"]
        lines.append(f"spike04_walk_{name}_down.gif: " + ", ".join(
            f"panel {i + 1} = {COND_LABELS[c]}"
            + (" (snapped)" if c == "remap" else "")
            for i, c in enumerate(order)))
    map_path = os.path.join(out_dir, "spike04_mapping.txt")
    with open(map_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote", map_path)

    # --- summary -------------------------------------------------------------
    print()
    print("==== REMAP SUMMARY " + "=" * 40)
    print(f"ornament drop < {REMAP_ORNAMENT_DROP_PX:g} px; "
          f"limb girth >= {REMAP_LIMB_MIN_EXT:g} model units (1 px @16)")
    for name in CREATURE_ORDER:
        spec, info = ROLES[name], remap_info[name]
        print(f"{name:<8} gains: head x{REMAP_HEAD_GAIN[name]:g}, "
              f"focal x{REMAP_FOCAL_GAIN[name]:g} extra")
        print(f"{'':<8} dropped: {drop_text(spec, info)}")
        print(f"{'':<8} clamped: {clamp_text(spec, info)}")
        print(f"{'':<8} head canvas shift: {info['head_shift']:.2f}")
    for clip in sorted(amp):
        st = amp[clip]
        print(f"{clip} walk amplitude (px @16): "
              + "  ".join(
                  f"{a}: disp {st['peak_disp_before_px'][a]:.2f}"
                  f"->{st['peak_disp_after_px'][a]:.2f}, "
                  f"step {st['peak_step_before_px'][a]:.2f}"
                  f"->{st['peak_step_after_px'][a]:.2f}"
                  for a in ("x", "y")))
    print("outputs:")
    for p in ([judging_path, sheet_path] + gif_paths
              + [json_path, map_path]):
        print("  " + p)
    print()
    print("exit criterion: 2 raters, Q1 (head + both eyes locatable) = yes "
          "on the remapped panel for wolf/down and imp/down.")
    print("rate spike04_judging.png BEFORE opening spike04_mapping.txt, "
          "spike04_sheet.png or the GIFs.")
    print(f"total runtime: {time.perf_counter() - t0:.1f}s")


if __name__ == "__main__":
    main()
