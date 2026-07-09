# Risk register & open questions

Likelihood/impact: L/M/H. Sorted by exposure (likelihood × impact).

| ID | Risk | L | I | Mitigation | Trigger to act |
|----|------|---|---|------------|----------------|
| R1 | Craft-pass flicker across animation frames (per-frame decisions churn pixels) | H | H | Clip-scoped decisions (design 03 §4); flicker metric in CI; Spike S3 before M1 exits | S3 fails threshold → move to per-clip global solve |
| R2 | Procedural oatmeal: valid but forgettable creatures | H | H | Trait tags, exclusion groups, budgets (design 02 §3); *scheduled* human taste reviews on pinned sheets from M2 | <80% "would ship" in M2 review |
| R3 | 16×16 readability (S1-F3: faces vanish on naive scale) | H | M | Proportion remap stage (design 04 §6); Spike S4 | S4 fails → consider 16×16 as derived-but-hand-tunable output tier |
| R4 | Craft rules fight each other (jaggy repair vs cluster merge loops) | M | M | Fixed pipeline order; idempotence property test (2nd run = no-op) | idempotence test flakes |
| R5 | Genome instability under edit (one gene edit reshuffles creature) | M | H | Locus-path-keyed PRNG streams from first production line (design 01 §2); review-blocker rule | any golden test shows unrelated diffs after a single-locus edit |
| R6 | Cross-platform nondeterminism | M | H | Fixed-point core, no floats; goldens run on 2 platforms in CI | golden mismatch across CI runners |
| R7 | Amorphous renderer fork underestimated | M | M | Scoped to M2 with explicit budget; interface unchanged (model → projections) | fork exceeds budget → ship M2 with serpentine instead, amorphous to M3 |
| R8 | Cross-plan breeding produces nonsense hybrids | M | M | Homology limited to matched locus paths; hybrid sheets in M5 review | hybrids fail taste review → restrict crossover to same-plan + trait transfer |
| R9 | Readability-solver thresholds miscalibrated (over-rerolls kill families' coherence) | M | L | Human calibration session in M4; warn-don't-loop escalation policy | reroll rate >30% on typical sets |
| R10 | Scope creep before M1 (grammar breadth is seductive) | H | M | M1 is ONE hardcoded quadruped; breadth is gated behind M1's determinism/property tests | any grammar work started pre-M1 exit |

Retired risks: ~~slab projection can't produce readable 4-dir sprites~~
(S1, was the #1 risk — validated), ~~oscillator gaits die under 4-frame
quantization~~ (S1), ~~rendering too slow for interactive/runtime use~~
(S1-F6).

## Open questions (need owner input — mirrors ASSESSMENT.md §5)

1. **D1 Stack:** TypeScript + browser tool recommended. Confirm or redirect.
2. **D2 Product shape:** editor-first vs library-first.
3. **D3 Art direction lock:** selout outlines, TILT=0.5, hue-shifted ramps
   (all as rendered in Spike S1's sheet) — approve as the house style?
4. **D4 M2 plan trio:** quadruped + levitant + amorphous recommended.
5. Licensing/distribution intent (open source? asset-store tool?) — affects
   nothing technical yet, but affects repo layout and CI choices soon.
