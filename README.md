# Fablespriting

A procedural sprite generator for top-down games: 32×32 player characters
and non-humanoid enemies, animated, in 4 directions — built creature-first,
pixels-last.

**Currently in production build: M1 accepted 2026-07-11; M2 (grammar
breadth — three body plans, full clip set, trait tags, the 100-genome
bestiary) accepted 2026-07-17. Next: M3, craft & palette maturity**
(contract doc 08, opening). Reading order:

1. [`CONCEPT.md`](CONCEPT.md) — the vision and the seven novel pillars
2. [`docs/ASSESSMENT.md`](docs/ASSESSMENT.md) — detailed per-pillar
   assessment, grounded in spike evidence
3. [`docs/design/`](docs/design/) — deep dives:
   [genome](docs/design/01-genome.md) ·
   [body-plan grammar](docs/design/02-bodyplan-grammar.md) ·
   [animation](docs/design/03-animation.md) ·
   [rendering & craft](docs/design/04-rendering-craft.md) ·
   [sets & export](docs/design/05-set-export.md)
4. [`docs/ROADMAP.md`](docs/ROADMAP.md) — spikes S1–S4, milestones M1–M5
5. [`docs/RISKS.md`](docs/RISKS.md) — risk register + open decisions
6. [`spikes/`](spikes/README.md) — evidence code; S1 (slab projection) is
   done and validated the core rendering bet:

![Spike S1 contact sheet](spikes/out/spike01_sheet.png)

*Three body plans (quadruped, biped, levitant), one renderer, 4 directions ×
4 walk frames, at 32×32 and 16×16 — all projected from a single micro-volume
model per creature.*

7. [`src/`](src/) — production code (M1, TypeScript), with tests in [`tests/`](tests/)

## Contact-sheet CLI (human QA)

The ROADMAP standing-practice QA tool. It is **not normative
rendering** — it composes the golden-tested `exportCreature()` sheets
(design 06 §6) into one review grid; the design docs pin nothing about
it, this section is its contract.

```
npm run build
node dist/cli.js sheet --seed-range 0..49 [--plan quadruped|levitant|amorphous]
                       [--tags T1[,T2]] [--preset speed|armor|ranged]
                       [--mix] [--out DIR]                # or the
                                                          # `fablesprite`
                                                          # bin after
                                                          # npm link
```

- Renders the **sampled genome** of every seed in the inclusive range
  (design 06 §4.2 sampler, so sheets are reproducible across
  implementations) through the full pipeline, ~1.5 s per genome on a
  desktop (50 genomes ≈ 75 s — fine for a QA tool, don't put it in a
  hot loop).
- `--plan` (since U3, design 07 §2.3.1; `amorphous` since U4,
  §2.4.1) forces every sampled genome onto that body plan (default
  `quadruped`). Plan is a sampler parameter, not a draw — shared loci
  (palette, core dims) sample identically across plans for the same
  seed. A non-default plan is recorded as a `plan` key in the JSON
  manifest (absent for quadruped, so committed manifests are
  unchanged). The U3 owner mini-sheet:
  `node dist/cli.js sheet --seed-range 0..24 --plan levitant`; the U4
  one: `node dist/cli.js sheet --seed-range 0..24 --plan amorphous`
  (the amorphous renders through the metaball field fork — expect a
  few seconds per genome, the march is the pipeline's hot path).
- `--tags` / `--preset` (since U5, design 07 §6.1) open the sampler
  MODES: `--tags` forces the trait-tag set (at most 2 distinct names of
  `chitin, fleshy, spectral, mechanical, verdant` — tag-gated ornament/
  emitter draws and gait-temperament priors activate), `--preset`
  applies an FFF prior preset (`ranged` guarantees an emitter part;
  `armor` forces a shell ornament). Both are recorded in the JSON
  manifest ONLY when supplied (`tags` as names, `preset` as its name) —
  committed manifests stay byte-intact. Without these flags the sampler
  is byte-identical to pre-U5 (the anchor razor). The U5 owner
  mini-sheet cells: e.g.
  `node dist/cli.js sheet --seed-range 7..7 --plan levitant --preset ranged`.
- `--mix` (since U6, design 07 §7.1) samples the **default bestiary
  mix** instead: every seed goes through `sampleBestiary(seed)` — plan
  drawn per seed from the reserved `stream(seed, "meta.plan", "sample")`
  (uniform weights `PLAN_MIX_WEIGHTS = [1, 1, 1]`), tags drawn from the
  seed's own default-path tag stream and GATING growth (the U5 tag mode
  with the drawn set forced — the identity `sampleBestiary(s) ≡
  sampleGenome(s, P, { tags: T })` is CI-asserted). `--mix` is a
  valueless boolean flag, **mutually exclusive** with
  `--plan`/`--tags`/`--preset` (they force exactly what mix draws —
  combining is a usage error, exit 2). Output basename becomes
  `sheet_mix_<A>_<B>.*`; the manifest gains top-level `"mix": true` and
  per-cell `plan`/`tags` name strings (self-describing — and every
  `dna` string alone reproduces its cell). The pinned acceptance sheet:
  `node dist/cli.js sheet --seed-range 0..99 --mix --out qa`.
- Each genome contributes its full 128×640 export sheet at 1× (since
  U2: 20 rows — [walk, idle, attack, hurt, death] × 4 directions),
  composed row-major into `ceil(√N)` columns (capped at 31 so the
  output stays under ~4096 px wide) with a 2-px transparent gutter.
- Output: `sheet_<A>_<B>.png` + `sheet_<A>_<B>.json` in `--out`
  (default `./out`). The JSON manifest maps every grid position to
  `{seed, dna}` (plus grid geometry and `generator_version`), so
  creatures stay identifiable without in-image text — M1 renders no
  fonts.
- **Build step**: the repo is ESM TypeScript with `.js` import
  specifiers; Node 24's type stripping does not remap those onto `.ts`
  files, so the bin runs from `dist/` via `npm run build` (plain
  `tsc`, no new dependencies). CI builds before testing, which also
  arms the CLI subprocess smoke test in `tests/cli.test.ts`.
- Pinned QA sheets live in [`qa/`](qa/) (first entry:
  `sheet_0_49.png`; since U6: `sheet_mix_0_99.png` + `.json`, the M2
  acceptance sheet — seeds 0..99 through the mix). Plain sheets
  **re-render on every grammar/craft change by design** — reviewed
  artifacts for human judgment (constraint row 10: the flicker gate
  alone is not a quality gate), never byte-pinned goldens. The MIX
  sheet is the exception (design 07 §7 guard law, U6):
  `tests/qa-guard.test.ts` re-derives its manifest and re-renders a
  6-cell slice against committed hashes on every CI run — **a hash
  move without a reviewed regeneration commit (new qa artifacts + new
  fixture in the same change) fails CI.**
