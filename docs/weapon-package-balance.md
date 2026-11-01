# Weapon package balance measurements

Reproduce from repository root: `node --import tsx scripts/verify-weapon-balance.mjs`. The adjacent JSON contains exact values, all 66 authored item profiles, source hashes and every observation. No database, seed, assets or product statistics are modified.

Measured 432 loadouts and 3888 encounter/loadout combinations at levels 1, 5, 10, 11, 15, 20, 21, 25, 30 with masteries 0/50/100. Latest eligible item tier is used (level 25 uses tier 20). Every weapon and offensive shield tier is covered.

Only main hand and the specified offhand are equipped. Defensive offhand is the real `training-shield` (+10 BLOCK_POWER): total block 20/27.5/35%; offensive shields have total block 10/17.5/25% at mastery 0/50/100. Main-hand and shield mastery are equal in these comparisons. Bow/crossbow/staff/two-handed cannot equip the shield.

Score = stationary damage per turn × effective HP. Outgoing and incoming hits call `mitigatedBattleDamage`, including both rounding stages. EHP = HP × incoming raw hit / actual incoming mitigated hit. Neutral reference uses the same-level ungeared character's armor and raw melee damage. Reported spread = stronger/weaker − 1, expressed as a percentage; approximately 15% is an advisory target.

Continuous sensitivity replaces integer mitigation with smooth multipliers: EHP = HP × (1 + armor/100) ÷ (1 − block/100). Its outgoing DPT uses the same smooth target mitigation; AP/action counts and rounded mastery-derived attack stats remain unchanged. This supplementary approximation isolates mitigation rounding. Actual hit/turn counts always use the runtime. Sword+shield is summarized separately from other one-handed families, whose initiative utility this metric omits.

## Maximum score spreads

| Comparison | Context set | Ratio left/right range | Maximum spread | Worst level/mastery/category/context | Outside 15% |
|---|---|---:|---:|---|---:|
| sword-defensive-vs-two-handed | neutralReference | 0.889–1.18 | 18.012% | 15/100/sword/same-level-neutral-reference | 3/27 |
| sword-defensive-vs-two-handed | encounters | 0.832–1.425 | 42.466% | 30/100/sword/feral-rat-01 | 49/243 |
| sword-defensive-vs-two-handed | neutralContinuousSensitivity | 0.907–1.18 | 18.004% | 25/100/sword/same-level-neutral-reference | 4/27 |
| sword-defensive-vs-two-handed | encountersContinuousSensitivity | 0.907–1.18 | 18.004% | 25/100/sword/forest-bandit-01 | 36/243 |
| melee-defensive-vs-two-handed | neutralReference | 0.841–1.182 | 18.899% | 20/0/dagger/same-level-neutral-reference | 17/135 |
| melee-defensive-vs-two-handed | encounters | 0.799–1.425 | 42.466% | 30/100/sword/feral-rat-01 | 203/1215 |
| melee-defensive-vs-two-handed | neutralContinuousSensitivity | 0.853–1.18 | 18.004% | 25/100/sword/same-level-neutral-reference | 16/135 |
| melee-defensive-vs-two-handed | encountersContinuousSensitivity | 0.853–1.18 | 18.004% | 25/100/sword/forest-bandit-01 | 144/1215 |
| wand-defensive-vs-bow | neutralReference | 0.854–1.094 | 17.151% | 10/0/wand/same-level-neutral-reference | 3/27 |
| wand-defensive-vs-bow | encounters | 0.812–1.152 | 23.214% | 15/0/wand/feral-rat-01 | 32/243 |
| wand-defensive-vs-bow | neutralContinuousSensitivity | 0.87–1.096 | 15% | 15/0/wand/same-level-neutral-reference | 0/27 |
| wand-defensive-vs-bow | encountersContinuousSensitivity | 0.87–1.096 | 15% | 15/0/wand/wolf-pack-01 | 0/243 |
| offensive-vs-defensive-shield | neutralReference | 0.943–1.049 | 6.075% | 5/100/axe/same-level-neutral-reference | 0/162 |
| offensive-vs-defensive-shield | encounters | 0.861–1.167 | 16.667% | 1/50/wand/feral-rat-01 | 8/1458 |
| offensive-vs-defensive-shield | neutralContinuousSensitivity | 0.969–1.025 | 3.147% | 5/100/axe/same-level-neutral-reference | 0/162 |
| offensive-vs-defensive-shield | encountersContinuousSensitivity | 0.969–1.025 | 3.147% | 5/100/axe/wolf-pack-01 | 0/1458 |

These maxima are measurements of the approved profiles, not automatic balance gates. The JSON preserves each maximum's exact ratio, both scores, and loadout keys. Enemy-specific round-off can move a case over 15% even when the neutral reference is within range.

## AP boundaries (mastery 50; neutral reference)

| Level | Tier | AP | Melee attacks/turn | Ranged attacks/turn | Sword+defense hit/DPT | Two-handed hit/DPT | Wand+defense hit/DPT | Bow hit/DPT |
|---:|---:|---:|---:|---:|---|---|---|---|
| 10 | 10 | 5 | 2 | 1 | 58/116 | 81/162 | 48/48 | 69/69 |
| 11 | 10 | 6 | 3 | 2 | 59/177 | 82/246 | 49/98 | 69/138 |
| 20 | 20 | 6 | 3 | 2 | 76/228 | 106/318 | 64/128 | 91/182 |
| 21 | 20 | 7 | 3 | 2 | 76/228 | 106/318 | 64/128 | 91/182 |
| 25 | 20 | 7 | 3 | 2 | 78/234 | 107/321 | 63/126 | 89/178 |
| 30 | 30 | 7 | 3 | 2 | 89/267 | 125/375 | 75/150 | 107/214 |

## Fixed enemy hit counts (mastery 0)

Fixed enemy stats below come directly from `BattleService.startBattle`. Turns are attack turns with zero movement cost; ranged combat may need fewer approach turns in actual play.

| Hero level / item tier | Enemy | HP / armor / raw hit | Sword+defense hit; actions/turns | Two-handed hit; actions/turns | Wand+defense hit; actions/turns | Bow hit; actions/turns |
|---|---|---|---|---|---|---|
| 1/1 | feral-rat | 110/0/9 | 32; 4/2 | 45; 3/2 | 27; 5/5 | 38; 3/3 |
| 1/1 | forest-wolf | 170/4/15 | 31; 6/3 | 43; 4/2 | 26; 7/7 | 37; 5/5 |
| 5/5 | wild-boar | 230/8/18 | 42; 6/3 | 58; 4/2 | 35; 7/7 | 50; 5/5 |
| 5/5 | forest-bandit | 280/12/23 | 40; 7/4 | 56; 5/3 | 34; 9/9 | 48; 6/6 |
| 10/10 | outlaw-guard | 340/16/27 | 53; 7/4 | 73; 5/3 | 44; 8/8 | 63; 6/6 |

The wolf is deliberately also shown against tier 1, and bandit against tier 5; this avoids implying extra item tiers at levels 3 and 7. Full JSON includes every fixed enemy at every sampled hero level and mastery.

## Higher scaling encounters

| Level | Encounter | Enemies × HP / armor / raw hit |
|---:|---|---|
| 25 | wolf-pack-01 | 3 × 515 / 36 / 20 |
| 25 | forest-boars-01 | 3 × 559 / 38 / 21 |
| 25 | forest-spiders-01 | 3 × 405 / 28 / 20 |
| 25 | forest-wolves-01 | 3 × 521 / 36 / 21 |
| 30 | wolf-pack-01 | 3 × 606 / 58 / 24 |
| 30 | forest-boars-01 | 3 × 657 / 60 / 25 |
| 30 | forest-spiders-01 | 3 × 476 / 49 / 23 |
| 30 | forest-wolves-01 | 3 × 612 / 58 / 24 |

| Level | Mastery | Loadout | Outgoing hit | Incoming hit | Actions / attack turns to clear wolf-pack-01 | Full living group DPT |
|---:|---:|---|---:|---:|---|---:|
| 25 | 0 | sword/defensive | 76 | 10 | 21/7 | 60 |
| 25 | 0 | two-handed/none | 103 | 14 | 15/5 | 84 |
| 25 | 0 | wand/defensive | 61 | 11 | 27/14 | 66 |
| 25 | 0 | bow/none | 86 | 14 | 18/9 | 84 |
| 25 | 50 | sword/defensive | 85 | 9 | 21/7 | 54 |
| 25 | 50 | two-handed/none | 116 | 14 | 15/5 | 84 |
| 25 | 50 | wand/defensive | 68 | 10 | 24/12 | 60 |
| 25 | 50 | bow/none | 97 | 14 | 18/9 | 84 |
| 25 | 100 | sword/defensive | 95 | 8 | 18/6 | 48 |
| 25 | 100 | two-handed/none | 129 | 14 | 12/4 | 84 |
| 25 | 100 | wand/defensive | 76 | 9 | 21/11 | 54 |
| 25 | 100 | bow/none | 107 | 14 | 15/8 | 84 |
| 30 | 0 | sword/defensive | 79 | 11 | 24/8 | 66 |
| 30 | 0 | two-handed/none | 111 | 15 | 18/6 | 90 |
| 30 | 0 | wand/defensive | 66 | 12 | 30/15 | 72 |
| 30 | 0 | bow/none | 95 | 15 | 21/11 | 90 |
| 30 | 50 | sword/defensive | 89 | 10 | 21/7 | 60 |
| 30 | 50 | two-handed/none | 125 | 15 | 15/5 | 90 |
| 30 | 50 | wand/defensive | 75 | 11 | 27/14 | 66 |
| 30 | 50 | bow/none | 107 | 15 | 18/9 | 90 |
| 30 | 100 | sword/defensive | 99 | 9 | 21/7 | 54 |
| 30 | 100 | two-handed/none | 139 | 15 | 15/5 | 90 |
| 30 | 100 | wand/defensive | 83 | 10 | 24/12 | 60 |
| 30 | 100 | bow/none | 119 | 15 | 18/9 | 90 |

## Staff healing is separate

Healing uses the actual preview: 3 AP, once per turn, no simultaneous two-handed shield. Values below assume enough missing HP, no injuries, and all wolves alive. Healing does not increase the damage×EHP comparison score.

| Level/tier | Mastery | Heal/turn | Attacks after one heal | Staff hit vs wolf pack | Attack DPT with one heal | Full group incoming DPT | Net HP loss/turn |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1/1 | 0 | 32 | 1 | 26 | 26 | 20 | -12 |
| 1/1 | 50 | 36 | 1 | 29 | 29 | 20 | -16 |
| 1/1 | 100 | 40 | 1 | 33 | 33 | 20 | -20 |
| 5/5 | 0 | 45 | 1 | 35 | 35 | 34 | -11 |
| 5/5 | 50 | 51 | 1 | 40 | 40 | 34 | -17 |
| 5/5 | 100 | 56 | 1 | 43 | 43 | 34 | -22 |
| 10/10 | 0 | 61 | 1 | 44 | 44 | 48 | -13 |
| 10/10 | 50 | 69 | 1 | 50 | 50 | 48 | -21 |
| 10/10 | 100 | 76 | 1 | 56 | 56 | 48 | -28 |
| 15/15 | 0 | 77 | 1 | 52 | 52 | 60 | -17 |
| 15/15 | 50 | 87 | 1 | 59 | 59 | 60 | -27 |
| 15/15 | 100 | 96 | 1 | 65 | 65 | 60 | -36 |
| 20/20 | 0 | 93 | 1 | 59 | 59 | 68 | -25 |
| 20/20 | 50 | 105 | 1 | 67 | 67 | 68 | -37 |
| 20/20 | 100 | 116 | 1 | 74 | 74 | 68 | -48 |
| 25/20 | 0 | 103 | 2 | 63 | 126 | 84 | -19 |
| 25/20 | 50 | 116 | 2 | 71 | 142 | 84 | -32 |
| 25/20 | 100 | 129 | 2 | 79 | 158 | 84 | -45 |
| 30/30 | 0 | 125 | 2 | 65 | 130 | 90 | -35 |
| 30/30 | 50 | 141 | 2 | 73 | 146 | 90 | -51 |
| 30/30 | 100 | 156 | 2 | 81 | 162 | 90 | -66 |

Negative net loss indicates spare healing capacity against this stationary incoming bound. It does not prove that actual damage timing, focused attacks, movement, healing targets and injuries permit survival.

## Limits and interpretation

All encounter counts and statistics are real service outputs, while hit/action/turn totals are deterministic arithmetic on real shared damage/AP outputs. These are stationary bounds, not automated full battles: no approach movement, LOS obstruction, initiative kills, injury procs, AI choices or focus fire are simulated. In particular, dagger/spear initiative and ranged positional advantage are not priced by this score. HP EHP depends on incoming hit size because mitigation rounds to integers. No PvP win-rate or perfect balance claim is made.

The approved stats are preserved. Neutral-reference departures are material enough to document: the strongest melee comparison exceeds 15%, as does the weakest wand comparison; the JSON summary identifies the exact cases. Weak fixed enemies magnify rounding differences. Staff can heal more than the whole stationary legacy wolf pack deals at the measured tiers, while still attacking; that sustain is a separate design question, not evidence that its direct damage is balanced against other weapons.

Interpretation: retain the approved profiles with these measured advisory-target departures and scope limits documented. The approximate target does not require an implicit rebalance. A strict 15% guarantee would be a new profile design decision; this artifact does not silently change item stats.
