# Risk register & open questions

Likelihood/impact: L/M/H. Sorted by exposure (likelihood × impact).

| ID | Risk | L | I | Mitigation | Trigger to act |
|----|------|---|---|------------|----------------|
| R2 | Procedural oatmeal: valid but forgettable creatures | H | H | Trait tags, exclusion groups, budgets (design 02 §3); *scheduled* human taste reviews on pinned sheets from M2 | <80% "would ship" in M2 review |
| R3 | 16×16 readability (S1-F3: faces vanish on naive scale) | H | M | Proportion remap stage (design 04 §6); Spike S4 | S4 fails → consider 16×16 as derived-but-hand-tunable output tier |
| R4 | Craft rules fight each other (jaggy repair vs cluster merge loops) | M | M | Fixed pipeline order; idempotence property test (2nd run = no-op) | idempotence test flakes |
| R5 | Genome instability under edit (one gene edit reshuffles creature) | M | H | Locus-path-keyed PRNG streams from first production line (design 01 §2); review-blocker rule | any golden test shows unrelated diffs after a single-locus edit |
| R6 | Cross-platform nondeterminism | M | H | Fixed-point core, no floats; goldens run on 2 platforms in CI | golden mismatch across CI runners |
| R8 | Cross-plan breeding produces nonsense hybrids | M | M | Homology limited to matched locus paths; hybrid sheets in M5 review | hybrids fail taste review → restrict crossover to same-plan + trait transfer |
| R9 | Readability-solver thresholds miscalibrated (over-rerolls kill families' coherence) | M | L | Human calibration session in M4; warn-don't-loop escalation policy | reroll rate >30% on typical sets |
| R10 | Scope creep before M1 (grammar breadth is seductive) | H | M | M1 is ONE hardcoded quadruped; breadth is gated behind M1's determinism/property tests | any grammar work started pre-M1 exit |

Retired risks: ~~slab projection can't produce readable 4-dir sprites~~
(S1, was the #1 risk — validated), ~~oscillator gaits die under 4-frame
quantization~~ (S1), ~~rendering too slow for interactive/runtime use~~
(S1-F6), ~~R7 amorphous renderer fork underestimated~~ (S1b: fork built in
~100 LOC, interface unchanged, slab face-parts compose with the blob
surface; residual work is grammar-side authoring rules F8/F9),
~~R1 craft-pass flicker across animation frames~~ (S3, was the #1 risk —
validated: clip-scoped decisions + chain-keyed snapping + fixpoint rule
ordering hold the metric, walk max 15.17 → 8.87, wolf idle mean
12.98 → 0.18;
flicker gate 12.0 enters M1 CI; findings F12–F14; residual work is
M1-side: chain-GROUPED snapping per F16 and the F7 thinness-criterion
rework per F15).

## Open questions (need owner input — mirrors ASSESSMENT.md §5)

1. **D1 Stack:** ✅ Decided 2026-07-09 — TypeScript + browser tool.
2. **D2 Product shape:** ✅ Decided 2026-07-09 — editor-first; library
   extracted later.
3. **D3 Art direction lock:** ✅ Decided 2026-07-09 — selout outlines,
   TILT=0.5, hue-shifted ramps (as rendered in Spike S1's sheet) approved
   as the house style. M1's golden tests pin exactly this rendering.
4. **D4 M2 plan trio:** open — quadruped + levitant + amorphous
   recommended. Blocks M2 only; decide during M1.
5. **Licensing/distribution:** ✅ Decided 2026-07-09 — open source under a
   permissive license (MIT or Apache-2.0; pick the exact text when the
   LICENSE file is added, before M1's CI setup).
