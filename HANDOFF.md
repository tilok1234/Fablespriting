# HANDOFF — M2 U1 built and fidelity-PROVEN, verification 1.5/3 lenses done (2026-07-11)

The repo is the source of truth; this file is the bookmark. Delete it in
the commit that lands U1.

## Where the project stands

**M1: ACCEPTED and shipped** (owner signed off 2026-07-11, commit
`8b81f45`). **M2: open** — contract is `docs/design/07-m2-grammar.md`
(committed `d084325`, CI green; D4 decided: quadruped/levitant/amorphous;
build order in its §8). Owner picked **MIT** for the license.

**U1 (grammar core + quadruped migration) is IMPLEMENTED and sits
UNCOMMITTED in the working tree:** new `src/grammar.ts` +
`tests/grammar.test.ts` + `LICENSE`; modified: design 07 (§1.4 U1
amendment), package.json (license field), src/{pose,raster,craft,
flicker,index}.ts, tests/{craft,palette,pose,raster}.test.ts. Net
−394/+189 (the hardcoded template tables are deleted per the §1.2
fidelity law). **Do not discard; do not commit until the OWED list
below is done.**

## How U1 actually ran (so the workflow journal doesn't mislead you)

Ultracode workflow `wf_15a38c53-e63` (this session's dir): the
implement agent **died to an API server error with zero repo output**
→ round-0 verifiers correctly reported "no implementation" (their
scary findings in the journal are about the EMPTY tree, since fixed) →
the round-0 **fix agent then did the entire implementation** but
returned mid-sweep without the byte-comparison or final gate → round 1:
the differential lens **PASSED completely**; the spec + hygiene lenses
**died on the Claude session usage limit** (was resetting 18:50
Europe/Oslo 2026-07-11). The workflow's "0 must-fix" exit is therefore
**vacuous** — treat verification as INCOMPLETE despite the green run.

## Evidence ledger — PROVEN, don't redo

1. **The §1.2 M1-fidelity sweep PASSES: 2001/2001 byte-identical**
   (all-defaults + seeds 0..1999, sha256(sheetPng ‖ canonical JSON),
   working tree vs committed `d084325` baseline). Run by the
   orchestrator personally after the workflow died; fingerprint
   `d90e1e0084dbaa89fc494fc7bd76c4e0af4298cc4138c75a95950f796a3067f7`
   recorded in design 07 §1.4. Baseline authenticity was independently
   confirmed against a pristine `d084325` worktree (21/21 spot seeds)
   by the spec verifier before it died.
2. **Gate green on the U1 tree:** build + typecheck clean, **284/284
   tests, 13 files** (up from M1's 260/12; grammar tests are new).
   Nothing but docs changed after that run.
3. **Differential lens: full pass.** Independent from-spec-only Python
   oracle matched all 101 corpus PartGraphs on every field class
   (1313/1313 per part field) AND re-derived every genome through the
   pinned sampler (3232/3232 loci) — the sampler/stream/growth chain is
   independently confirmed.
4. LICENSE (MIT, Tilok) + package.json `"license": "MIT"` in place.

Artifacts (in THIS dead session's scratchpad —
`C:\Users\Harald\AppData\Local\Temp\claude\C--Users-Harald-Documents-SabelFrite\d19f0ff9-c2db-473d-a4d0-b5025f032135\scratchpad\`):
`u1_baseline_hashes.json` (2001 entries, from committed HEAD),
`u1_working_hashes_full.json`, `u1_full_sweep.mjs` (the comparator),
`verify_hashes.mjs` (hash formula), `u1_partgraph_corpus.json`,
`u1_oracle.py` (the from-spec oracle), `gate.log`. Temp dirs can
vanish: if gone, everything regenerates — baseline from a pristine
`d084325` worktree via the same formula (keys `"defaults"` and
`String(seed)`; export errors stored as `ERROR:<name>:<message>`
strings and compared as such).

## OWED before committing U1 (in order)

1. **Re-run the two dead lenses** — briefs are verbatim in the
   workflow script
   (`C:\Users\Harald\.claude\projects\C--Users-Harald-Documents-SabelFrite\d19f0ff9-c2db-473d-a4d0-b5025f032135\workflows\scripts\u1-grammar-core-wf_15a38c53-e63.js`,
   consts `VERIFY_SPEC` and `VERIFY_HYG`). Already banked (skip):
   baseline authenticity, 21-seed identity, the full sweep, the gate.
   Still unexamined: rule-by-rule engine code read (symmetry/serial/
   exclusion/budget vs design 07 §1 as amended), part-identity
   reconstruction vs `git show d084325:src/pose.ts`, R5
   stream-discipline instrumentation (a dead verifier left
   `dist_instr/` mid-flight), deletion completeness/dead-code grep,
   the exclusion-pruning mutation check, docs-consistency scan. Fix
   loop to 0 must-fix from BOTH lenses.
2. **Orchestrator diff review** of all 13 files. Test edits are small
   (+11/−12 over 4 files) and should be pure plumbing (imports/moved
   tables) — confirm; anything behavioral in an M1 test is a red flag.
   src/{raster,craft,flicker}.ts touches should be seam/type changes
   only.
3. Fresh gate (`npm run build && npm run typecheck && npm test`), then
   **one commit**: U1 + LICENSE + package.json + design 07 §1.4 +
   delete this HANDOFF. Push, `gh run watch` — CI on ubuntu+windows.
4. Then **U2** (clip set + GENERATOR_VERSION 2) per design 07 §8 —
   next unit, new ultracode workflow; steal the U1 script's structure.

## Known open items (documented, none blocking U1)

- **Seed 1132's export THROWS — in committed M1 code too** (the "craft
  fixpoint trap": identical `ERROR:` entry on both sides of the
  fidelity sweep, so U1 is clean). A pre-existing latent M1 bug that
  M1's QA never full-exported. Investigate alongside U2 (any future
  gate that needs 1132 to export will trip on it); distinct from the
  seed-1142 eyeless quirk pinned in tests/raster.test.ts.
- Suite is now 284 tests / ~30 s locally — fine; keep watching as M2
  adds sweeps (design 07 flagged the budget).

## Method + environment (unchanged from M1 — keep it)

Ultracode unit workflows: implement (effort high) → 3 adversarial
lenses (spec / independent-Python differential / toolchain-hygiene) →
fix loop to 0 must-fix. Agents NEVER git commit/push (say so in every
brief). Orchestrator reviews diffs, runs the gate, commits, pushes,
watches CI. Standing owner authorization to commit+push reviewed work.
Every pinned constant machine-verified before entering spec or code;
spec gaps pinned into design 07 in the same change. Python as
`python`; Node 24; spikes/ read-only evidence; scratchpad oracles are
session-local. Owner wants decisive calls, no option menus; sheet
reviews as local Desktop files (per-seed PNGs + labeled composite).
