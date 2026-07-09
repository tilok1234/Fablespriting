#!/usr/bin/env python3
"""Spike S2 — pose-salience frame sampling (blind A/B/C readability test).

Question under test:
    Design 03 section 3 claims two separate mechanisms each improve how a
    4-frame walk reads: (a) SAMPLING — picking salient poses instead of
    uniform quarter-cycle phases — and (b) TIMING — giving each chosen frame
    a display duration proportional to the phase arc it covers. The original
    two-condition A/B conflated the mechanisms (assessment finding), so this
    spike runs three conditions over the same 560 ms cycle, 32x32 only
    (16x16 is deferred to Spike S4 per finding F3):

      A  uniform phases (0, pi/2, pi, 3pi/2) + uniform 140 ms frames
         (byte-comparable to spike01's frames);
      B  salience-sampled phases + uniform 140 ms frames   -> isolates (a);
      C  salience-sampled phases + arc-proportional timing -> isolates (b).

Salience selection (per creature, computed once in model space so all
directions share the same frames): 64 dense phases; pose distance = sum over
slabs of Euclidean distance between corresponding slab centers; seed with
the phase pair (p, p+pi) of maximal mutual distance (dominant-oscillator
extremes, operationalized genome-free); grow to 4 frames by farthest-point
sampling; re-time each frame by the cyclic arc between its neighboring
midpoints, rounded to 10 ms (GIF granularity), sum pinned to 560 ms.

Pixel snapping (design 03 section 3 step 5) is deliberately DEFERRED to
Spike S3 — this spike's renderer has no snapping hook.

Note: when a creature's salience phases come out near-evenly spaced, its C
durations legitimately round to uniform at the 10 ms GIF granularity and
panels B and C become identical (the watcher does this). Those cells are
expected ties for the timing effect — an honest algorithm outcome, not a
bug; the timing comparison then rests on the remaining creatures.

Rater protocol (full version goes into docs later): 2+ humans each watch the
six spike02_ab_*.gif files BLIND and rank the three panels of each GIF,
best to worst, for "reads best as a natural gait cycle" (ties allowed).
Only after rating do they open spike02_mapping.txt — and only after that,
spike02_sheet.png. Sampling effect = B vs A across the 6 cells; timing
effect = C vs B. Unambiguous = both raters agree on the same winner for an
effect and each prefers that winner in at least 4 of 6 cells. Fallback if
ambiguous or uniform wins: M1 uses uniform sampling + uniform durations
(export metadata degrades gracefully).

Run:  python spikes/spike02_pose_salience.py
Outputs (written to spikes/out/):
    spike02_ab_<creature>_<dir>.gif  - blind 3-panel side-by-side (6 files)
    spike02_sheet.png                - de-blinded diagnostic contact sheet
    spike02_selection.json           - phases/durations + blind mapping
    spike02_mapping.txt              - sealed de-blinding key
"""

import json
import math
import os
import random
import sys
from bisect import bisect_right

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spike01_slab_projection as s1  # noqa: E402

# NOTE: pixel snapping (design 03 section 3 step 5) is DEFERRED to Spike S3.
# s1.render has no snapping hook, so all three conditions share its raw
# (unsnapped) projection; the comparison is between sampling/timing only.

TAU = 2 * math.pi
DENSE_N = 64          # dense phase samples for salience analysis
FRAMES = 4            # frames per condition
TOTAL_MS = 560        # full cycle, matches spike01 (4 x 140 ms)
DIRS = ["right", "down"]
CONDITIONS = ["A", "B", "C"]
COND_LABELS = {"A": "A uniform", "B": "B salience", "C": "C salience+retime"}
BLIND_SEED = 20260709
TEXT = (235, 232, 240, 255)


# ----------------------------------------------------------------------------
# Salience selection — model space, pre-yaw, pose functions only (no renders).
# Pose vector at phase p = the slab centers of fn(p); the slab list order is
# stable across phases, so index correspondence holds.
# ----------------------------------------------------------------------------

def pose_centers(fn, phase):
    return [sl.center for sl in fn(phase)]


def pose_dist(a, b):
    return sum(math.dist(p, q) for p, q in zip(a, b))


def select_salience(fn):
    """Return (4 sorted salience phases, 2 sorted seed phases)."""
    poses = [pose_centers(fn, TAU * k / DENSE_N) for k in range(DENSE_N)]
    half = DENSE_N // 2
    # seed pair: the dense phase most opposed to its antipode (contact
    # extremes for footfall gaits; works for hover/flap too)
    seed = max(range(DENSE_N),
               key=lambda k: pose_dist(poses[k], poses[(k + half) % DENSE_N]))
    selected = [seed, (seed + half) % DENSE_N]
    # farthest-point sampling up to FRAMES
    while len(selected) < FRAMES:
        best = max((k for k in range(DENSE_N) if k not in selected),
                   key=lambda k: min(pose_dist(poses[k], poses[s])
                                     for s in selected))
        selected.append(best)
    selected.sort()
    phases = [TAU * k / DENSE_N for k in selected]
    seeds = sorted(TAU * k / DENSE_N for k in (seed, (seed + half) % DENSE_N))
    return phases, seeds


def _cyc_mid(a, b):
    """Midpoint of the cyclic arc from a forward to b."""
    return (a + ((b - a) % TAU) / 2.0) % TAU


def retime(phases):
    """Condition C durations: frame i covers the cyclic arc between the
    midpoints to its neighbors; scaled to TOTAL_MS, rounded to 10 ms, and
    the largest frame absorbs the rounding residue so the sum is exact."""
    n = len(phases)
    durs = []
    for i in range(n):
        start = _cyc_mid(phases[(i - 1) % n], phases[i])
        end = _cyc_mid(phases[i], phases[(i + 1) % n])
        arc = (end - start) % TAU
        durs.append(int(round(arc / TAU * TOTAL_MS / 10.0)) * 10)
    durs[durs.index(max(durs))] += TOTAL_MS - sum(durs)
    return durs


# ----------------------------------------------------------------------------
# Drawing helpers
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


# ----------------------------------------------------------------------------
# Blind A/B/C GIF — three panels on one canvas, one composite timeline.
# Panels animate on different schedules, so the composite frame boundaries
# are the union of all panels' frame-start times within the cycle.
# ----------------------------------------------------------------------------

PANEL = 192   # 32 -> 6x nearest
PAD = 12
LABEL_H = 40


def frame_starts(durs):
    starts = [0]
    for d in durs[:-1]:
        starts.append(starts[-1] + d)
    return starts


def build_ab_gif(path, panels, font):
    """panels = [(frame_images, durations_ms), ...] in panel order 1..3."""
    w = 3 * PANEL + 4 * PAD
    h = LABEL_H + PANEL + 2 * PAD
    base = Image.new("RGBA", (w, h), (*s1.BG, 255))
    tile = s1.checker(PANEL)
    draw = ImageDraw.Draw(base)
    for i in range(3):
        x = PAD + i * (PANEL + PAD)
        base.alpha_composite(tile, (x, PAD + LABEL_H))
        _center_text(draw, str(i + 1), x + PANEL / 2, PAD + LABEL_H / 2, font)

    starts = [frame_starts(durs) for _, durs in panels]
    bounds = sorted({t for st in starts for t in st})
    frames, lengths = [], []
    for bi, t in enumerate(bounds):
        end = bounds[bi + 1] if bi + 1 < len(bounds) else TOTAL_MS
        fr = base.copy()
        for i, (imgs, _) in enumerate(panels):
            j = bisect_right(starts[i], t) - 1
            fr.alpha_composite(s1.upscale(imgs[j], PANEL),
                               (PAD + i * (PANEL + PAD), PAD + LABEL_H))
        frames.append(fr.convert("P", palette=Image.ADAPTIVE))
        lengths.append(end - t)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=lengths, loop=0)


# ----------------------------------------------------------------------------
# Diagnostic contact sheet — NOT blind: rows carry the true condition label.
# ----------------------------------------------------------------------------

CELL = 160
CAP_H = 22
LABEL_W = 160
HDR_H = 26


def build_sheet(path, renders, selection, font_hdr, font_txt):
    block_w = LABEL_W + FRAMES * CELL
    block_h = HDR_H + 3 * (CELL + CAP_H)
    sheet = Image.new("RGBA", (2 * block_w + 3 * PAD, 3 * block_h + 4 * PAD),
                      (*s1.BG, 255))
    draw = ImageDraw.Draw(sheet)
    tile = s1.checker(CELL)
    for ci, (name, _) in enumerate(s1.CREATURES):
        sel = selection[name]
        for di, d in enumerate(DIRS):
            bx = PAD + di * (block_w + PAD)
            by = PAD + ci * (block_h + PAD)
            draw.text((bx + 4, by + 3), f"{name} / {d}", font=font_hdr,
                      fill=TEXT)
            for ri, cond in enumerate(CONDITIONS):
                ry = by + HDR_H + ri * (CELL + CAP_H)
                draw.text((bx + 4, ry + CELL // 2 - 9), COND_LABELS[cond],
                          font=font_txt, fill=TEXT)
                phases = (sel["uniform_phases"] if cond == "A"
                          else sel["salience_phases"])
                durs = sel["durations_ms"][cond]
                imgs = renders[name][d]["uniform" if cond == "A"
                                        else "salience"]
                for fi in range(FRAMES):
                    fx = bx + LABEL_W + fi * CELL
                    sheet.alpha_composite(tile, (fx, ry))
                    sheet.alpha_composite(s1.upscale(imgs[fi], CELL),
                                          (fx, ry))
                    draw.text((fx + 6, ry + CELL + 3),
                              f"{phases[fi]:.2f} rad  {durs[fi]} ms",
                              font=font_txt, fill=TEXT)
    sheet.convert("RGB").save(path)


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(out_dir, exist_ok=True)
    font_big = _font(30)
    font_hdr = _font(18)
    font_txt = _font(14)
    uniform_phases = [i * TAU / FRAMES for i in range(FRAMES)]

    # --- salience selection + renders (32x32 only, both eval dirs) ---------
    selection = {}
    renders = {}
    for name, fn in s1.CREATURES:
        sal_phases, seeds = select_salience(fn)
        selection[name] = {
            "dense_n": DENSE_N,
            "seed_phases": [round(p, 6) for p in seeds],
            "salience_phases": [round(p, 6) for p in sal_phases],
            "uniform_phases": [round(p, 6) for p in uniform_phases],
            "durations_ms": {"A": [140] * FRAMES, "B": [140] * FRAMES,
                             "C": retime(sal_phases)},
        }
        print(name + ": salience phases ["
              + ", ".join(f"{p:.2f}" for p in sal_phases)
              + "] rad, C durations "
              + "/".join(str(d) for d in selection[name]["durations_ms"]["C"])
              + " ms")
        if selection[name]["durations_ms"]["C"] == [140] * FRAMES:
            print(f"  note: {name} retiming rounds to uniform at 10 ms "
                  "granularity -> panels B and C are identical (expected "
                  "ties for the timing effect)")
        renders[name] = {}
        for d in DIRS:
            q = s1.DIRECTIONS[d]
            renders[name][d] = {
                "uniform": [s1.render(fn(p), 32, q) for p in uniform_phases],
                "salience": [s1.render(fn(p), 32, q) for p in sal_phases],
            }
        print(f"rendered {name}")

    # --- blinding: fixed iteration order, creatures outer, dirs inner ------
    rng = random.Random(BLIND_SEED)
    blind = {}
    for name, _ in s1.CREATURES:
        for d in DIRS:
            blind[f"{name}/{d}"] = rng.sample(CONDITIONS, 3)

    # --- blind A/B/C GIFs ---------------------------------------------------
    for name, _ in s1.CREATURES:
        for d in DIRS:
            panels = []
            for cond in blind[f"{name}/{d}"]:
                imgs = renders[name][d]["uniform" if cond == "A"
                                        else "salience"]
                panels.append((imgs, selection[name]["durations_ms"][cond]))
            gif_path = os.path.join(out_dir, f"spike02_ab_{name}_{d}.gif")
            build_ab_gif(gif_path, panels, font_big)
            print("wrote", gif_path)

    # --- diagnostic sheet ---------------------------------------------------
    sheet_path = os.path.join(out_dir, "spike02_sheet.png")
    build_sheet(sheet_path, renders, selection, font_hdr, font_txt)
    print("wrote", sheet_path)

    # --- selection JSON -----------------------------------------------------
    payload = {
        "blind_mapping": {key: {str(i + 1): c for i, c in enumerate(order)}
                          for key, order in blind.items()},
        "creatures": selection,
    }
    json_path = os.path.join(out_dir, "spike02_selection.json")
    with open(json_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, sort_keys=True, indent=2)
        f.write("\n")
    print("wrote", json_path)

    # --- sealed de-blinding key ---------------------------------------------
    lines = ["SEALED — rate all 6 GIFs (and do not open "
             "spike02_sheet.png) before reading below.", ""]
    for name, _ in s1.CREATURES:
        for d in DIRS:
            order = blind[f"{name}/{d}"]
            lines.append(f"spike02_ab_{name}_{d}.gif: " + ", ".join(
                f"panel {i + 1} = {COND_LABELS[c]}"
                for i, c in enumerate(order)))
    map_path = os.path.join(out_dir, "spike02_mapping.txt")
    with open(map_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote", map_path)


if __name__ == "__main__":
    main()
