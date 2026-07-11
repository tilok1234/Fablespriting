# HANDOFF — M1 build complete, acceptance pending (updated 2026-07-11)

Working state for whoever (or whatever agent) picks this up. The repo is
the source of truth; this file is the bookmark. Delete it when M1 ships.

## Where the project stands

**Phase 0 (spikes): closed.** S1 ✅ · S1b ✅ · S2 ❌ (uniform sampling
locked) · S3 ✅ (flicker solved) · S4 ❌ (16×16 dropped, D5). Findings
F1–F19 in `docs/ASSESSMENT.md` §2, decisions D1–D5 in §5.

**M1 (production TypeScript, 32×32 wolf end-to-end): ALL BUILD UNITS
DONE.** Everything committed and pushed through `c532c65`; suite = 260
green tests; CI (ubuntu+windows, Node 24) on every push — at handoff
time the run for `c532c65` was in progress (~1 min typical; check
`gh run list` before anything else; every prior run this session
passed).

| Done | Module | Notes |
|------|--------|-------|
| ✅ | `docs/design/06-m1-foundations.md` | THE implementation contract. Now carries normative §1.4 (raster arithmetic), §1.5 (craft), §1.6 (flicker), §§6.1–6.5 (export) — a second implementer needs nothing else, proven by differential verifiers each unit |
| ✅ | `src/fixed.ts`, `src/prng.ts`, `src/genome.ts` | 16.16 kernel · PCG32 streams · locus registry/tape/sampler (pre-session) |
| ✅ | `src/pose.ts` | quadruped template + derived anchors + **eye visibility coupling** (§1.2: eyeless 323→1 over seeds 0..1999; sole residual seed 1142 pinned in tests; vote-rule fixes REJECTED — they break default-frame byte-identity, evidence in §1.2) |
| ✅ | `src/raster.ts` | tagged rasterizer; golden `3121cea8…a477ed`; §1.5 offset hook (golden-safe) |
| ✅ | `src/craft.ts` | clip-scoped rules 2/3/5 fixpoint → selout; chain snapping; focal never erased (F16 extended to rules 2/3); F15 stats pinned at the fixpoint (supersedes "pre-merge" — idempotence required it) |
| ✅ | `src/palette.ts` | fp HSV ramps, exact HSV→RGB8, application rule (§1.3 as amended; edge=2 has NO floor, slot 0 reachable) |
| ✅ | `src/png.ts` + `src/export.ts` | own §6 encoder (73-byte vector); canonical JSON (UTF-8-byte key order); 32-frame set, 140 ms, 8×4 sheet, slab hitboxes; goldens in `tests/goldens/` (sheet `efd38af1…`, JSON `ec506673…`) |
| ✅ | `src/flicker.ts` + `src/cli.ts` | §1.6 metric, gate **recalibrated 12.0→32.0** per F12 (production max 25.12 over 800 cells; evidence + histogram in §1.6; ROADMAP amended); `fablesprite sheet` CLI (needs `npm run build` → dist/cli.js) |

Session commits, in order: `53749d6` (spec pins §1.4) · `ae07499` (eye
coupling) · `23c4dc0` (craft) · `c173760` (palette) · `8de0e01`
(PNG/export) · `c532c65` (flicker+CLI). Each unit: ultracode workflow
(implement → 3 adversarial verifiers → fix loop to 0 must-fix), then
orchestrator diff review, gate, commit, push, CI watch.

## The ONLY remaining M1 step: acceptance (ROADMAP Phase 1)

Acceptance criteria and their status:

1. **Byte-identical goldens twice locally + across two CI platforms** —
   effectively in hand: the full golden set (raster hash, palette
   table, sheet PNG bytes, JSON hash) passes on ubuntu+windows on every
   push. For the formal record, run the suite twice locally back-to-back
   and confirm the `c532c65` CI run went green.
2. **Craft property tests on 200 random genomes** — in the suite
   (tests/craft.test.ts sweeps) and green.
3. **50-genome sheet, zero degenerates** — `qa/sheet_0_49.png` is
   committed and pre-screened (hygiene verifier cell-by-cell + this
   orchestrator: 50 distinct coherent creatures, zero degenerates
   spotted). **THE OWNER'S REVIEW IS THE REMAINING HUMAN GATE** — the
   manifest `qa/sheet_0_49.json` maps grid cells to seeds. Show him the
   sheet; his standing preference: set expectations first, decisive
   framing, no option menus.
4. **Flicker gate** — live in CI at the recalibrated 32.0 (§1.6).

When the owner signs off on the sheet: declare M1 accepted, delete this
file (per its own header), and update ROADMAP Phase 1 to done. M2 opens
with grammar breadth (D4 recommendation: quadruped, levitant, amorphous).

## Known open items (all documented, none blocking)

- Seed 1142 renders eyeless in the down view (dead 8v8 vote tie; profile
  views fine) — pinned as `[1142]` in tests/raster.test.ts; revisit in M2
  template work.
- The 32.0 flicker gate is a weak backstop by construction (low-motion
  gait_freq=2 genomes legitimately score 18–25). If a tighter regression
  detector is ever wanted, the principled fix is an energy floor or a
  changed-count cap, not a smaller gate (noted in §1.6 discussion).
- Shadow ellipse ¼-flattening (§6.3) is a fresh aesthetic pin with no
  spike precedent, golden-hashed via the JSON — if the owner wants a
  different shadow, change it BEFORE anything consumes the metadata.
- Suite ~47 s incl. build; fine, but watch it as M2 adds sweeps.

## Working method that got us here (keep it)

- Ultracode workflows: one implement agent (effort high) → three
  parallel adversarial verifiers → fix loop until 0 must-fix. Lenses:
  (a) spec fidelity line-by-line; (b) INDEPENDENT differential — Python
  written from the spec alone (never transliterated, never reading the
  TS), exact-diffed on dumped corpora; (c) toolchain/hygiene/visual.
  Convergence history: craft 2 fix rounds, palette/export/flicker 0 —
  the briefs got better; steal their structure from the workflow scripts
  under `~/.claude/projects/C--Users-Harald-Documents-SabelFrite/*/workflows/scripts/`.
- Agents never `git commit` (say so in every brief). The orchestrator
  reviews diffs, runs the gate, commits, pushes, watches CI
  (`gh run watch <id> --exit-status` in background). Standing owner
  authorization to commit+push reviewed work.
- Every pinned constant machine-verified by script before it enters
  spec or code; test vectors only from independent oracles.
- Spec gaps found during implementation get pinned into design 06 in
  the same change — and superseded findings (F15's "pre-merge", the
  12.0 gate) get amended at their SOURCE docs too, with the evidence.

## Environment (this machine — Harald's secondary PC)

Python as `python`; Node 24 + npm; gate = `npm run typecheck && npm
test` (CI also runs `npm run build` before tests — the CLI smoke test
needs dist/). Never byte-compare spike PNG re-renders (Pillow drift);
spikes stay untouched — they're evidence. Scratchpad oracles are
session-local; rebuild them from spec, don't copy.

## Owner context

Owner (Tilok / Harald) wants decisive recommendations, not option
menus; direct casual tone; set expectations explicitly before showing
anything that is SUPPOSED to look rough. The 32×32 spike output quality
(`spikes/out/spike03_walk_wolf_right.gif`) is the bar. He has NOT yet
reviewed qa/sheet_0_49.png — that review is M1's last gate.
