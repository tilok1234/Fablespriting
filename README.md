# Fablespriting

A procedural sprite generator for top-down games: 16×16 and 32×32 player
characters and non-humanoid enemies, animated, in 4 directions — built
creature-first, pixels-last.

**Currently in planning + spike phase.** Reading order:

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
