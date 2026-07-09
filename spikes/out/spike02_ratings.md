# Spike S2 — blind panel rankings

Panels ranked best → worst for "reads best as a natural gait cycle";
`=` means tied. Recorded BLIND — mapping unsealed only after all raters
are in. Verdict computed per the protocol in `docs/design/03-animation.md`
§3 (both raters agree on an effect's winner, each ≥4/6 cells).

## Rater 1 (owner, 2026-07-09)

| GIF | Ranking |
|-----|---------|
| spike02_ab_wolf_right.gif | 2 > 3 > 1 |
| spike02_ab_wolf_down.gif | 2 > 3 > 1 |
| spike02_ab_imp_right.gif | 1 > 3 > 2 |
| spike02_ab_imp_down.gif | 2 = 3 > 1 |
| spike02_ab_watcher_right.gif | 2 = 3 > 1 |
| spike02_ab_watcher_down.gif | 1 = 2 > 3 |

## Rater 2 (independent, 2026-07-09)

| GIF | Ranking |
|-----|---------|
| spike02_ab_wolf_right.gif | 2 > 1 > 3 |
| spike02_ab_wolf_down.gif | 1 > 2 > 3 |
| spike02_ab_imp_right.gif | 2 > 1 > 3 |
| spike02_ab_imp_down.gif | 1 > 2 > 3 |
| spike02_ab_watcher_right.gif | 2 = 3 > 1 |
| spike02_ab_watcher_down.gif | 1 = 2 > 3 |

## Verdict

Scored 2026-07-09. The mapping (`spike02_mapping.txt`) was unsealed only
after both ratings above were recorded.

**Sampling effect — B (salience) vs A (uniform):**

| Rater | prefers B | prefers A | ties |
|-------|-----------|-----------|------|
| 1     | 4/6       | 2/6       | 0    |
| 2     | 3/6       | 3/6       | 0    |

Rater 1 meets the ≥4/6 bar for salience; rater 2 has no winner.
→ **AMBIGUOUS** per protocol.

**Timing effect — C (retimed) vs B (salience, uniform timing):**

| Rater | prefers C | prefers B | ties |
|-------|-----------|-----------|------|
| 1     | 1/6       | 2/6       | 3/6  |
| 2     | 3/6       | 1/6       | 2/6  |

Neither rater reaches 4/6 — the two watcher cells are forced ties because
B and C are pixel-identical there (10 ms GIF granularity rounded the
retimed watcher durations back to uniform). → **AMBIGUOUS** per protocol.

**Conclusion:** both effects ambiguous → the pre-registered fallback locks
in: **M1 uses uniform sampling + uniform durations.**

Secondary observations (recorded, not commitments):

- Salience swept all 4 watcher (levitant) cells across both raters — a
  per-plan signal worth revisiting after M1.
- Both raters exactly tied the pixel-identical watcher B/C panels in all
  4 cells — attention check passed; ratings credible.
- Methodological: the degenerate watcher arm spent 2 of 6 timing cells as
  forced ties; future perceptual A/Bs need finer timing granularity or
  stimuli chosen to avoid degenerate arms.
