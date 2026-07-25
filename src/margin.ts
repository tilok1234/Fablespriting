/**
 * Fablesprite — the frame-fit margin law's instruments (design 08 §2, V1).
 *
 * The law, normative from V1: **for every genome, every direction, the
 * rendered ink bbox of every walk and idle frame satisfies `1 ≤ x_min` and
 * `x_max ≤ 30`** — at least one clear pixel column on each vertical frame
 * edge. It binds RENDERED INK only; hitboxes stay free to overhang (design
 * 07 §6.1's canvas note). The x axis is the law because x is the measured
 * failure axis; y stays governed by the standing corner-sweep guarantees.
 *
 * One-shot clips (attack, hurt, death) carry a **transient allowance**
 * instead (design 08 §2 as amended at V1, ruling R-V1a): ink may briefly
 * contact or cross the frame edge, and NO clamp or cap exists to stop it —
 * the attack lunge, hurt recoil and death stagger ship fully intact. What is
 * forbidden is the M2 owner verdict's flag criteria, which are CELL
 * properties and not frame properties. The verdict locks TWO frame-edge
 * criteria and a cell is flagged if it meets EITHER:
 *
 * > **sliced** — a ≥ 4-row flat edge run (`edgeSliceRun ≥ 4`) persists in
 * > ≥ 20 of the cell's 72 frames;
 * > **overrun** — ink reaches BOTH the left and the right frame edge in
 * > ≥ 25 of the cell's 72 frames ("both ends cut").
 *
 * (72 = (walk 4 + idle 4 + attack 4 + hurt 2 + death 4) × 4 directions. The
 * persistence half of each criterion is what separates "the nose touches the
 * edge for one lunge frame" — which the owner shipped unflagged in M2 — from
 * "the body is sliced flat", which he flagged.)
 *
 * The overrun criterion is UNMEETABLE on the fitted build, by construction
 * rather than by policy: walk/idle ink is confined to columns [1, 30], so
 * those 32 frames cannot touch either edge; and the down/up views' worst
 * model-x extent is 6.0 px (design 08 §2.1.3 rows 11–12), so only the two
 * PROFILE directions can reach an edge column at all. That leaves at most
 * the 2 × (attack 4 + hurt 2 + death 4) = 20 profile one-shot frames — below
 * the threshold of 25. The leg is asserted anyway, because a derivation is
 * not a measurement and the sweeps are cheap.
 *
 * Three legs, all enforced here:
 *
 * 1. {@link marginVerdict}`.flagged` — zero cells may meet EITHER criterion.
 * 2. A per-clip **transient backstop**: the measured post-fit count of
 *    slice-signature frames per clip per direction, pinned CI-forever by the
 *    fixtures and the qa sheet ({@link MarginVerdict.perClipSliceFrames}).
 * 3. {@link inkBounds} / {@link violatesMarginLaw} for the strict walk/idle
 *    law above; {@link edgeSliceRun} / {@link hasSliceSignature} for
 *    criterion 1 and {@link spansBothEdges} for criterion 2. One
 *    implementation, shared by sweeps, tests and the qa guard.
 *
 * Note that legs 1–2 need the walk/idle law to be arithmetic, not policy: a
 * frame whose ink is confined to columns [1, 30] has NO ink in column 0 or
 * 31, so its `edgeSliceRun` is 0 by construction. Every slice frame the
 * backstop can ever count is a one-shot frame.
 *
 * These functions read finished RGBA frames, so they measure the pipeline's
 * actual output (craft pass, palette and snap included) rather than a model
 * of it — the same discipline as the §5.1 self-check judging a genome by its
 * own pipeline. Alpha is binary throughout the project (design 08 §0.2), so
 * "ink" is `a !== 0`.
 */

import { FRAME_SIZE } from "./export.js";

/** An ink bounding box in frame pixel coordinates, inclusive. */
export interface InkBounds {
  readonly xMin: number;
  readonly xMax: number;
  readonly yMin: number;
  readonly yMax: number;
  /** Inked pixel count (0 ⇒ the frame is empty and `bounds` is null). */
  readonly count: number;
}

/** The pinned margin law + both verdict criteria (design 08 §2). */
export const MARGIN_LAW = Object.freeze({
  /** Lowest legal inked column on walk/idle frames. */
  xMin: 1,
  /** Highest legal inked column on walk/idle frames. */
  xMax: 30,
  /** A run of this many consecutive inked rows in an edge column is a slice. */
  sliceRows: 4,
  /** The clips the x-margin law binds; the rest carry the transient allowance. */
  lawClips: Object.freeze(["walk", "idle"] as const),
  /** The M2 verdict's persistence half, criterion 1 ("silhouette sliced"):
   * a cell is FLAGGED iff at least this many of its frames carry a slice
   * signature. */
  verdictSliceFrames: 20,
  /** The M2 verdict's criterion 2 ("body overruns frame"): a cell is FLAGGED
   * iff at least this many of its frames ink BOTH vertical edge columns. */
  verdictBothEdgeFrames: 25,
  /** A full cell: (walk 4 + idle 4 + attack 4 + hurt 2 + death 4) × 4 dirs. */
  cellFrames: 72,
});

/**
 * The ink bounding box of one RGBA frame, or `null` for an empty frame.
 * `width`/`height` default to the 32×32 export frame.
 */
export function inkBounds(
  rgba: Uint8Array,
  width: number = FRAME_SIZE,
  height: number = FRAME_SIZE,
): InkBounds | null {
  let xMin = width;
  let xMax = -1;
  let yMin = height;
  let yMax = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      count++;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  return count === 0 ? null : Object.freeze({ xMin, xMax, yMin, yMax, count });
}

/**
 * The M2 verdict's slice signature, machine form: the LONGEST run of
 * consecutive rows carrying ink in either vertical edge column (x = 0 or
 * x = width − 1). The two columns are measured independently and the longer
 * run wins — a body flat against the left edge and a tail tip touching the
 * right are different findings, and the criterion is per edge.
 */
export function edgeSliceRun(
  rgba: Uint8Array,
  width: number = FRAME_SIZE,
  height: number = FRAME_SIZE,
): number {
  let best = 0;
  for (const x of [0, width - 1]) {
    let run = 0;
    for (let y = 0; y < height; y++) {
      if (rgba[(y * width + x) * 4 + 3] !== 0) {
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
  }
  return best;
}

/** True iff `bounds` breaks the x-margin law (an empty frame cannot). */
export function violatesMarginLaw(bounds: InkBounds | null): boolean {
  if (bounds === null) return false;
  return bounds.xMin < MARGIN_LAW.xMin || bounds.xMax > MARGIN_LAW.xMax;
}

/**
 * True iff `bounds` inks BOTH vertical edge columns — the frame-level half of
 * the verdict's "body overruns frame" criterion ("both ends cut").
 */
export function spansBothEdges(
  bounds: InkBounds | null,
  width: number = FRAME_SIZE,
): boolean {
  if (bounds === null) return false;
  return bounds.xMin === 0 && bounds.xMax === width - 1;
}

/** True iff the frame carries a slice signature. */
export function hasSliceSignature(
  rgba: Uint8Array,
  width: number = FRAME_SIZE,
  height: number = FRAME_SIZE,
): boolean {
  return edgeSliceRun(rgba, width, height) >= MARGIN_LAW.sliceRows;
}

/** One frame's margin measurement, keyed by its clip/direction/phase. */
export interface FrameMargin {
  readonly clip: string;
  readonly direction: string;
  readonly phase: number;
  readonly bounds: InkBounds | null;
  readonly sliceRun: number;
  /** True iff this frame is bound by the x-margin law and breaks it. */
  readonly marginViolation: boolean;
  /** True iff this frame carries a slice signature (all clips). */
  readonly sliceViolation: boolean;
  /** True iff this frame inks both edge columns (verdict criterion 2). */
  readonly bothEdge: boolean;
}

/** The minimal shape {@link measureFrameMargins} reads from an export. */
export interface MarginMeasurable {
  readonly clip: string;
  readonly direction: string;
  readonly phase: number;
  readonly rgba: Uint8Array;
}

/**
 * Measure every frame of one export. `exportCreature(genome).frames` is the
 * intended argument; the parameter type is structural so the sweeps can feed
 * a subset without rebuilding a CreatureExport.
 */
export function measureFrameMargins(
  frames: readonly MarginMeasurable[],
): readonly FrameMargin[] {
  const lawClips = new Set<string>(MARGIN_LAW.lawClips);
  return frames.map((f) => {
    const bounds = inkBounds(f.rgba);
    const sliceRun = edgeSliceRun(f.rgba);
    return Object.freeze({
      clip: f.clip,
      direction: f.direction,
      phase: f.phase,
      bounds,
      sliceRun,
      marginViolation: lawClips.has(f.clip) && violatesMarginLaw(bounds),
      sliceViolation: sliceRun >= MARGIN_LAW.sliceRows,
      bothEdge: spansBothEdges(bounds),
    });
  });
}

/** Aggregate verdict over a measured frame set — a whole cell, when the set
 * is a whole cell (which is what the R-V1a criterion needs). */
export interface MarginVerdict {
  readonly frames: number;
  /** Frames breaking the strict walk/idle x-margin law — must be empty. */
  readonly marginViolations: readonly FrameMargin[];
  /** Frames carrying a slice signature. NOT violations in themselves: the
   * transient allowance permits them on one-shot clips. They are counted,
   * attributed per clip, and bounded by the backstop. */
  readonly sliceFrames: readonly FrameMargin[];
  /** Slice frames that appear on a clip bound by the strict law — these ARE
   * violations, and are impossible while the margin law holds. */
  readonly lawClipSliceFrames: readonly FrameMargin[];
  /** Worst walk/idle x_min over the set (32 when no walk/idle frame inks). */
  readonly worstXMin: number;
  /** Worst walk/idle x_max over the set (−1 when no walk/idle frame inks). */
  readonly worstXMax: number;
  /** Longest edge-column run over ALL clips. */
  readonly worstSliceRun: number;
  /** Slice-frame count per clip, worst single direction — the quantity the
   * per-clip transient backstop pins. Clips with zero slice frames are
   * absent from the map. */
  readonly perClipSliceFrames: ReadonlyMap<string, number>;
  /** Frames inking BOTH edge columns — the count criterion 2 thresholds. */
  readonly bothEdgeFrames: readonly FrameMargin[];
  /** True iff the set meets verdict criterion 1 (a slice signature
   * persisting in ≥ `verdictSliceFrames` of the cell's frames). */
  readonly flaggedSliced: boolean;
  /** True iff the set meets verdict criterion 2 (both edge columns inked in
   * ≥ `verdictBothEdgeFrames` of the cell's frames). */
  readonly flaggedOverrun: boolean;
  /** True iff the set meets EITHER of the M2 verdict's two frame-edge
   * criteria — the owner's flag, in machine form. */
  readonly flagged: boolean;
  /** The gate: strict law intact AND the cell not flagged. */
  readonly pass: boolean;
}

/** Roll a measured frame set up into the gate verdict. */
export function marginVerdict(measured: readonly FrameMargin[]): MarginVerdict {
  const lawClips = new Set<string>(MARGIN_LAW.lawClips);
  let worstXMin = FRAME_SIZE;
  let worstXMax = -1;
  let worstSliceRun = 0;
  // Slice frames per (clip, direction); the backstop reads the worst
  // direction, because the law is stated per direction per clip.
  const perClipDir = new Map<string, number>();
  for (const m of measured) {
    if (m.sliceRun > worstSliceRun) worstSliceRun = m.sliceRun;
    if (m.sliceViolation) {
      const k = `${m.clip} ${m.direction}`;
      perClipDir.set(k, (perClipDir.get(k) ?? 0) + 1);
    }
    if (!lawClips.has(m.clip) || m.bounds === null) continue;
    if (m.bounds.xMin < worstXMin) worstXMin = m.bounds.xMin;
    if (m.bounds.xMax > worstXMax) worstXMax = m.bounds.xMax;
  }
  const perClipSliceFrames = new Map<string, number>();
  for (const [k, n] of perClipDir) {
    const clip = k.slice(0, k.indexOf(" "));
    if (n > (perClipSliceFrames.get(clip) ?? 0)) perClipSliceFrames.set(clip, n);
  }
  const marginViolations = measured.filter((m) => m.marginViolation);
  const sliceFrames = measured.filter((m) => m.sliceViolation);
  const lawClipSliceFrames = sliceFrames.filter((m) => lawClips.has(m.clip));
  const bothEdgeFrames = measured.filter((m) => m.bothEdge);
  const flaggedSliced = sliceFrames.length >= MARGIN_LAW.verdictSliceFrames;
  const flaggedOverrun =
    bothEdgeFrames.length >= MARGIN_LAW.verdictBothEdgeFrames;
  const flagged = flaggedSliced || flaggedOverrun;
  return Object.freeze({
    frames: measured.length,
    marginViolations: Object.freeze(marginViolations),
    sliceFrames: Object.freeze(sliceFrames),
    lawClipSliceFrames: Object.freeze(lawClipSliceFrames),
    worstXMin,
    worstXMax,
    worstSliceRun,
    perClipSliceFrames,
    bothEdgeFrames: Object.freeze(bothEdgeFrames),
    flaggedSliced,
    flaggedOverrun,
    flagged,
    pass: marginViolations.length === 0 && !flagged,
  });
}
