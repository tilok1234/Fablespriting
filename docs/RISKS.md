# Risk register & open questions

Likelihood/impact: L/M/H. Sorted by exposure (likelihood × impact).

| ID | Risk | L | I | Mitigation | Trigger to act |
|----|------|---|---|------------|----------------|
| R2 | Procedural oatmeal: valid but forgettable creatures | H | H | Trait tags, exclusion groups, budgets (design 02 §3); *scheduled* human taste reviews on pinned sheets from M2 | <80% "would ship" in M2 review |
| R4 | Craft rules fight each other (jaggy repair vs cluster merge loops) | M | M | Fixed pipeline order; idempotence property test (2nd run = no-op) | idempotence test flakes |
| R5 | Genome instability under edit (one gene edit reshuffles creature) | M | H | Locus-path-keyed PRNG streams from first production line (design 01 §2); review-blocker rule | any golden test shows unrelated diffs after a single-locus edit |
| R6 | Cross-platform nondeterminism | M | H | Fixed-point core, no floats; goldens run on 2 platforms in CI | golden mismatch across CI runners |
| R8 | Cross-plan breeding produces nonsense hybrids | M | M | Homology limited to matched locus paths; hybrid sheets in M5 review | hybrids fail taste review → restrict crossover to same-plan + trait transfer |
| R9 | Readability-solver thresholds miscalibrated (over-rerolls kill families' coherence) | M | L | Human calibration session in M4; warn-don't-loop escalation policy | reroll rate >30% on typical sets |

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
rework per F15),
~~R3 16×16 readability~~ (S4, was the #1 risk after S3 — retired by
descope, not mitigation: the remap measurably improved faces but not to a
shippable bar, and the owner decision D5 dropped 16×16 as a generated
tier entirely; the S4 machinery and findings F17–F19 stay in `spikes/`
and `ASSESSMENT.md` §2 if it is ever revisited),
~~R10 scope creep before M1~~ (retired 2026-07-11: M1 accepted and
shipped; grammar breadth is now the in-scope work, under contract in
design 07).

## Open questions (need owner input — mirrors ASSESSMENT.md §5)

1. **D1 Stack:** ✅ Decided 2026-07-09 — TypeScript + browser tool.
2. **D2 Product shape:** ✅ Decided 2026-07-09 — editor-first; library
   extracted later.
3. **D3 Art direction lock:** ✅ Decided 2026-07-09 — selout outlines,
   TILT=0.5, hue-shifted ramps (as rendered in Spike S1's sheet) approved
   as the house style. M1's golden tests pin exactly this rendering.
4. **D4 M2 plan trio:** ✅ Decided 2026-07-11 — quadruped + levitant +
   amorphous (owner accepted the recommendation at M2 kickoff; design
   07 §0).
5. **Licensing/distribution:** ✅ Decided 2026-07-09 — open source under a
   permissive license. Text picked at M2 U1 (2026-07-11): **MIT** — the
   LICENSE file, owed since M1, landed in the U1 commit.
6. **D5 16×16 output tier:** ✅ Decided 2026-07-10 — dropped as a
   generated tier (owner call on S4 evidence); revisit post-M5 only on
   real demand.
