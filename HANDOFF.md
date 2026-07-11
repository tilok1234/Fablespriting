# HANDOFF — M1 in progress (updated 2026-07-11)

Working state for whoever (or whatever agent) picks this up. The repo is
the source of truth; this file is the bookmark. Delete it when M1 ships.

## Where the project stands

**Phase 0 (spikes): closed.** S1 ✅ · S1b ✅ · S2 ❌ (uniform sampling
locked) · S3 ✅ (flicker solved, gate 12.0) · S4 ❌ (16×16 dropped,
decision D5). Findings F1–F19 in `docs/ASSESSMENT.md` §2. Decisions
D1–D5 recorded in `docs/ASSESSMENT.md` §5 (TypeScript+web · browser
tool first · S1 art style locked · D4 open for M2 · 16×16 dropped).

**M1 (production TypeScript, 32×32 wolf end-to-end): roughly half built.**
Everything below is committed and pushed through `c9d4e86`; suite =
124 green tests, CI (ubuntu+windows, Node 24) on every push.

| Done | Module | Notes |
|------|--------|-------|
| ✅ | `docs/design/06-m1-foundations.md` | THE implementation contract — read before touching anything |
| ✅ | toolchain | strict tsconfig, vitest, zero runtime deps, `npm run typecheck` / `npm test` |
| ✅ | `src/fixed.ts` | 16.16 kernel, RHE everywhere, checksum-locked sin LUT |
| ✅ | `src/prng.ts` | FNV-1a64 → splitmix64 → PCG32 streams keyed (seed, path, draw) |
| ✅ | `src/genome.ts` | locus registry ids 0–34, varint tape codec, sampler |
| ✅ | `src/pose.ts` | 13-slab quadruped template (order is normative), derived anchors, walk/idle |
| ✅ | `src/raster.ts` | tagged-pixel rasterizer; first golden: SHA-256 `3121cea8…a477ed` (all-defaults wolf, down, walk φ=0) |

## In flight at handoff time

A workflow ("eye-coupling-spec-pins") was running when this handoff was
written. It does two coupled things:

1. Writes the rasterizer's documented arithmetic (overflow-safe
   quadratic steps, tone steps, tie rules, golden serialization) into
   design 06 as normative text.
2. Fixes a real finding: **78/500 sampled genomes render eyeless wolves**
   (buried or corner-straddling eyes). Fix = derived eye forward-offset
   guaranteeing protrusion (S4-F18 pattern), delta-form so the
   all-defaults wolf — and the pinned golden hash — stay byte-identical.
   Acceptance: 0 eyeless in seeds 0..1999, golden unchanged.

**How to pick this up:**
- `git status` clean + design 06 contains "1.4 Rasterization arithmetic"
  and an eye-coupling paragraph → it landed and was committed. Continue.
- Tree dirty (only design 06 / src/pose.ts / src/index.ts /
  tests/pose.test.ts / tests/raster.test.ts) → it finished but wasn't
  committed: review the diff, `npm run typecheck && npm test`, verify the
  golden test still passes, commit, push.
- Neither → it died mid-run. Redo it: the mandate is in this file
  (above) and the old workflow script (if this machine) is at
  `~/.claude/projects/C--Users-Harald-Documents-SabelFrite/*/workflows/scripts/eye-coupling-spec-pins-*.js`.
  Rebuilding fresh from the mandate is also fine — all inputs are in the
  repo.

## Remaining M1 build order (each unit: implement → adversarial verify → commit)

1. **Craft pass** (`src/craft.ts`) — design 04 §4 as amended by S3:
   quantize → rules 2/3/5 to a joint fixpoint → selout decided/applied
   on POST-merge geometry. Clip-scoped decisions keyed by
   (part_id, material, tone); presence-based medians; chain-GROUPED
   snapping with ties-to-even (F14/F16 — chains group slabs, e.g. the
   whole head assembly); focal materials merge-protected (F16); F7
   thinness exemptions from PRE-merge part-level stats (F15).
2. **Palette** (`src/palette.ts`) — design 06 §1.3: fp HSV ramps, pinned
   HSV→RGB, focal ramp constant table, tone→color application.
3. **PNG encoder + export** (`src/png.ts`, `src/export.ts`) — design 06
   §6: OWN encoder, zlib stored blocks, normative 1×1 vector; per-frame
   PNGs are the golden artifacts; canonical JSON per RFC 8785; sheet
   packing gets pinned here (design 05 §2) and joins the goldens.
4. **Contact-sheet CLI** (`fablesprite sheet --seed-range`, ROADMAP
   standing practice) + flicker metric in CI (gate: max pair ratio <
   12.0 per walk cell, INF auto-fail, recalibrate per F12 caveat).
5. **M1 acceptance** (ROADMAP Phase 1): byte-identical goldens twice
   locally + across the two CI platforms; craft property tests on 200
   random genomes; 50-genome sheet with zero degenerates; flicker gate.

## Working method that got us here (keep it)

- Ultracode workflows: one implement agent (effort high) → three
  parallel adversarial verifiers → fix loop until 0 must-fix. The three
  lenses: (a) spec fidelity line-by-line; (b) INDEPENDENT differential —
  a Python implementation written from the spec alone (never
  transliterated), exact-diffed against the TS on shared corpora; (c)
  toolchain/hygiene/visual. Scratchpad Python oracles are rebuilt per
  session from the spec — that's the point, don't copy them.
- Agents never `git commit` (say so in every brief). The orchestrator
  reviews diffs, commits, pushes. Owner gave standing commit+push
  authorization; don't push unreviewed work.
- Every pinned constant gets machine-verified by script before it enters
  spec or code. Test vectors must come from independent oracles, never
  from the implementation under test.
- Spec gaps found during implementation get pinned back into design 06
  in the same change (see the uvarint, slab-order, and quadratic
  precedents).

## Environment (this machine — Harald's secondary PC)

Run Python as `python` (the `py` launcher was fixed but `python` is the
habit); Node 24 + npm; `npm run typecheck && npm test` is the gate;
never byte-compare spike PNG re-renders (Pillow encoder drift — compare
pixels; production PNGs avoid this via our own encoder). Spikes stay
untouched — they're evidence.

## Owner context

Owner (Tilok / Harald) wants decisive recommendations, not option menus;
direct casual tone; set expectations explicitly before showing anything
that is SUPPOSED to look rough (that lesson was learned the hard way
with S4's 16×16 judging sheet). The 32×32 output quality of the spikes
(see `spikes/out/spike03_walk_wolf_right.gif`) is the bar he cares
about.
