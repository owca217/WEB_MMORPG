// Run from the repository root: node --import tsx scripts/verify-weapon-balance.mjs
// Offline measurement, not a duel simulator or a test of copied combat formulas.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  emptyCharacterEquipment, getCharacterStatistics, getEquipmentItemProperties,
  getEquipmentCombatStatistics, getWeaponProficiency, MAX_WEAPON_EXPERIENCE,
  WEAPON_FAMILIES, meleeAttackApCost, rangedAttackApCost, mitigatedBattleDamage,
  getBattleHealingPreview, STAFF_HEAL_AP_COST, ENEMY_DEFINITIONS
} from "../packages/shared/src/index.ts";
import { PROGRESSION_WEAPON_ITEMS } from "../apps/server/src/items/progressionWeaponItems.ts";
import { BASIC_EQUIPMENT_ITEMS } from "../apps/server/src/items/basicEquipment.ts";
import { BattleService } from "../apps/server/src/battle/BattleService.ts";
import { ENCOUNTER_DEFINITIONS } from "../apps/server/src/world/encounterDefinitions.ts";

const root = new URL("../", import.meta.url);
const levels = [1, 5, 10, 11, 15, 20, 21, 25, 30];
const masteries = [0, 50, 100];
const tiers = [...new Set(PROGRESSION_WEAPON_ITEMS.map(item => item.minimumLevel))].sort((a, b) => a - b);
const categories = [...new Set(PROGRESSION_WEAPON_ITEMS.map(item => item.subcategoryId))];
const melee = ["sword", "axe", "hammer", "dagger", "spear"];
const uninjured = { injuries: [] };
// Sensitivity model only: smooth multiplicative mitigation without integer rounding.
// All authoritative hit/action counts below still call the actual runtime functions.
const continuousHit = (damage, armor, block = 0) => damage / (1 + Math.max(0, armor) / 100) * (1 - Math.max(0, Math.min(100, block)) / 100);
const continuousEhp = (hp, armor, block = 0) => hp * (1 + Math.max(0, armor) / 100) / (1 - Math.max(0, Math.min(100, block)) / 100);
const masteryExperience = new Map();
for (let xp = 0; xp <= MAX_WEAPON_EXPERIENCE; xp++) {
  const level = getWeaponProficiency(xp).level;
  if (masteries.includes(level) && !masteryExperience.has(level)) masteryExperience.set(level, xp);
}

function training(mastery) {
  return { experience: Object.fromEntries(WEAPON_FAMILIES.map(family => [family.id, masteryExperience.get(mastery)])) };
}

// Project the real seed data through the same public equipment parser as inventory.
function inventoryItem(seed) {
  const equipment = getEquipmentItemProperties({
    category: seed.categoryId, subcategory: seed.subcategoryId, minimumLevel: seed.minimumLevel ?? 1,
    stats: seed.stats, specialData: seed.specialData ?? (seed.categoryId === "armor" ? { armorSlot: seed.subcategoryId } : {})
  });
  if (!equipment) throw new Error(`Unusable equipment: ${seed.itemId}`);
  return { instanceId: seed.itemId, itemId: seed.itemId, itemDefinitionId: seed.itemId, name: seed.name,
    category: seed.categoryId, description: seed.description ?? "", rarity: seed.rarity ?? "COMMON", quantity: 1,
    upgradeLevel: 0, durability: 40, maxDurability: 40, equipment, equippedSlot: equipment.slot };
}

if (PROGRESSION_WEAPON_ITEMS.length !== 66 || categories.length !== 11 || tiers.length !== 6) {
  throw new Error("Expected the approved 66-item, 11-category, six-tier manifest");
}
const defensiveShield = inventoryItem(BASIC_EQUIPMENT_ITEMS.find(item => item.itemId === "training-shield"));
const itemAt = (category, tier) => {
  const seed = PROGRESSION_WEAPON_ITEMS.find(item => item.subcategoryId === category && item.minimumLevel === tier);
  if (!seed) throw new Error(`Missing ${category} tier ${tier}`);
  return inventoryItem(seed);
};

// Actual BattleService encounter construction provides fixed overrides, level floors,
// scaling, group counts and the 25+ armor surcharge. No duplicate scaling formula.
const encounterDefinitions = ENCOUNTER_DEFINITIONS.filter((entry, index, all) =>
  entry.id !== "forest-boars-02" && all.findIndex(other => other.id === entry.id) === index);
const encounters = levels.flatMap(level => encounterDefinitions.map(definition => {
  const base = getCharacterStatistics(level);
  const snapshot = new BattleService().startBattle({
    ...base, playerId: "balance-reference", nickname: "Balance reference", level,
    hp: base.maxHp, injuries: [], severelyInjured: false, equipment: emptyCharacterEquipment()
  }, definition.id);
  const enemies = snapshot.combatants.filter(actor => actor.side === "enemy");
  if (!enemies.length) throw new Error(`No enemies: ${definition.id}`);
  const enemy = enemies[0];
  return { key: `${level}/${definition.id}`, characterLevel: level, encounterId: definition.id,
    kind: definition.enemyId ? "fixed" : "scaling", enemyCount: enemies.length,
    enemyLevel: enemy.level, maxHp: enemy.maxHp, maxAp: enemy.maxAp,
    meleeDamage: enemy.combatStats.meleeDamage, armor: enemy.combatStats.armor,
    blockPercent: enemy.combatStats.blockPercent ?? 0 };
}));

const profiles = [];
const measurements = [];
for (const level of levels) for (const mastery of masteries) {
  const tier = Math.max(...tiers.filter(tier => tier <= level));
  const base = getCharacterStatistics(level);
  const loadouts = [
    ...[...melee, "wand"].flatMap(category => ["defensive", "offensive"].map(shield => ({ category, shield }))),
    ...["two-handed", "bow", "crossbow", "staff"].map(category => ({ category, shield: "none" }))
  ];
  for (const { category, shield } of loadouts) {
    const equipment = emptyCharacterEquipment();
    equipment.mainHand = itemAt(category, tier);
    if (shield === "defensive") equipment.offHand = defensiveShield;
    if (shield === "offensive") equipment.offHand = itemAt("offensive-shield", tier);
    const stats = getEquipmentCombatStatistics(base, training(mastery), equipment);
    const ranged = Boolean(stats.rangedEnabled);
    const apCost = ranged ? rangedAttackApCost(uninjured) : meleeAttackApCost(uninjured);
    const attacksPerTurn = Math.floor(stats.maxAp / apCost);
    const rawDamage = ranged ? stats.rangedDamage : stats.meleeDamage;
    const referenceHit = mitigatedBattleDamage(rawDamage, base.armor);
    const referenceIncomingHit = mitigatedBattleDamage(base.meleeDamage, stats.armor, stats.blockPercent);
    const effectiveHp = stats.maxHp * base.meleeDamage / referenceIncomingHit;
    const smoothEhp = continuousEhp(stats.maxHp, stats.armor, stats.blockPercent);
    const smoothDpt = continuousHit(rawDamage, base.armor) * attacksPerTurn;
    const profile = { key: `${level}/${mastery}/${category}/${shield}`, level, tier, mastery, category, shield,
      itemId: equipment.mainHand.itemId, offHandItemId: equipment.offHand?.itemId ?? null,
      stats, apCost, attacksPerTurn, rawDamage,
      reference: { outgoingHit: referenceHit, incomingHit: referenceIncomingHit,
        damagePerTurn: referenceHit * attacksPerTurn, effectiveHp,
        score: referenceHit * attacksPerTurn * effectiveHp,
        continuous: { effectiveHp: smoothEhp, damagePerTurn: smoothDpt, score: smoothEhp * smoothDpt } } };
    if (category === "staff") {
      const actor = { id: "staff", ...uninjured, hp: 1, maxHp: stats.maxHp, ap: stats.maxAp,
        side: "player", position: { q: 0, r: 0 }, combatStats: stats };
      const snapshot = { finished: false, activeCombatantId: "staff", combatants: [actor], blockedCells: [] };
      const preview = getBattleHealingPreview(snapshot, "staff");
      const usedPreview = getBattleHealingPreview({ ...snapshot, combatants: [{ ...actor, healingUsedThisTurn: true }] }, "staff");
      if (!preview.available || usedPreview.available || preview.apCost !== STAFF_HEAL_AP_COST) throw new Error("Staff healing contract changed");
      profile.healing = { power: stats.healingPower, usableAmountAtOneHp: preview.amount,
        apCost: preview.apCost, secondHealAvailableSameTurn: usedPreview.available,
        attacksPerTurnWithOneHeal: Math.floor((stats.maxAp - preview.apCost) / apCost) };
    }
    profiles.push(profile);
    for (const encounter of encounters.filter(entry => entry.characterLevel === level)) {
      const outgoingHit = mitigatedBattleDamage(rawDamage, encounter.armor, encounter.blockPercent);
      const incomingHit = mitigatedBattleDamage(encounter.meleeDamage, stats.armor, stats.blockPercent);
      const hitsPerEnemy = Math.ceil(encounter.maxHp / outgoingHit);
      // Each enemy's final hit discards overkill; unused AP can attack the next enemy.
      const totalAttackActions = hitsPerEnemy * encounter.enemyCount;
      const enemyAttacksPerTurn = Math.floor(encounter.maxAp / meleeAttackApCost(uninjured));
      const incomingFullGroupDpt = incomingHit * enemyAttacksPerTurn * encounter.enemyCount;
      const encounterEffectiveHp = stats.maxHp * encounter.meleeDamage / incomingHit;
      const smoothDpt = continuousHit(rawDamage, encounter.armor, encounter.blockPercent) * attacksPerTurn;
      measurements.push({ profileKey: profile.key, encounterKey: encounter.key, outgoingHit, incomingHit,
        damagePerTurn: outgoingHit * attacksPerTurn, effectiveHp: encounterEffectiveHp,
        score: outgoingHit * attacksPerTurn * encounterEffectiveHp,
        continuous: { effectiveHp: smoothEhp, damagePerTurn: smoothDpt, score: smoothEhp * smoothDpt },
        hitsPerEnemy, totalAttackActions, stationaryAttackTurnsToClear: Math.ceil(totalAttackActions / attacksPerTurn),
        incomingFullGroupDpt, incomingHitsToDefeatHero: Math.ceil(stats.maxHp / incomingHit),
        fullGroupTurnsToDefeatHero: Math.ceil(Math.ceil(stats.maxHp / incomingHit) / (enemyAttacksPerTurn * encounter.enemyCount)),
        ...(profile.healing ? { withOneHeal: {
          healingPerTurn: profile.healing.power,
          attackDamagePerTurn: outgoingHit * profile.healing.attacksPerTurnWithOneHeal,
          netHpLossPerFullGroupTurn: incomingFullGroupDpt - profile.healing.power
        } } : {}) });
    }
  }
}

const profileIndex = new Map(profiles.map(profile => [profile.key, profile]));
const measurementIndex = new Map(measurements.map(row => [`${row.profileKey}|${row.encounterKey}`, row]));
const comparisons = [];
for (const level of levels) for (const mastery of masteries) {
  const pairs = [
    ...melee.map(category => ({ comparison: "melee-defensive-vs-two-handed", category, left: `${category}/defensive`, right: "two-handed/none" })),
    { comparison: "wand-defensive-vs-bow", category: "wand", left: "wand/defensive", right: "bow/none" },
    ...[...melee, "wand"].map(category => ({ comparison: "offensive-vs-defensive-shield", category, left: `${category}/offensive`, right: `${category}/defensive` }))
  ];
  for (const pair of pairs) {
    const left = `${level}/${mastery}/${pair.left}`, right = `${level}/${mastery}/${pair.right}`;
    const observations = [{ context: "same-level-neutral-reference", left: profileIndex.get(left).reference.score,
      right: profileIndex.get(right).reference.score, smoothLeft: profileIndex.get(left).reference.continuous.score,
      smoothRight: profileIndex.get(right).reference.continuous.score },
    ...encounters.filter(entry => entry.characterLevel === level).map(encounter => ({ context: encounter.encounterId,
      left: measurementIndex.get(`${left}|${encounter.key}`).score,
      right: measurementIndex.get(`${right}|${encounter.key}`).score,
      smoothLeft: measurementIndex.get(`${left}|${encounter.key}`).continuous.score,
      smoothRight: measurementIndex.get(`${right}|${encounter.key}`).continuous.score }))];
    for (const observation of observations) comparisons.push({ comparison: pair.comparison, category: pair.category,
      level, mastery, context: observation.context, leftProfile: left, rightProfile: right,
      leftScore: observation.left, rightScore: observation.right,
      leftToRightRatio: observation.left / observation.right,
      // Symmetric spread: the stronger score divided by weaker, minus one.
      spreadPercent: (Math.max(observation.left, observation.right) / Math.min(observation.left, observation.right) - 1) * 100,
      continuous: { leftScore: observation.smoothLeft, rightScore: observation.smoothRight,
        leftToRightRatio: observation.smoothLeft / observation.smoothRight,
        spreadPercent: (Math.max(observation.smoothLeft, observation.smoothRight) / Math.min(observation.smoothLeft, observation.smoothRight) - 1) * 100 } });
  }
}

const summarize = rows => ({ observations: rows.length, outside15Percent: rows.filter(row => row.spreadPercent > 15 + 1e-9).length,
  minimumLeftToRightRatio: Math.min(...rows.map(row => row.leftToRightRatio)),
  maximumLeftToRightRatio: Math.max(...rows.map(row => row.leftToRightRatio)),
  worst: rows.reduce((worst, row) => row.spreadPercent > worst.spreadPercent ? row : worst) });
const comparisonKinds = ["sword-defensive-vs-two-handed", ...new Set(comparisons.map(row => row.comparison))];
const summary = Object.fromEntries(comparisonKinds.map(kind => {
  const rows = comparisons.filter(row => kind === "sword-defensive-vs-two-handed"
    ? row.comparison === "melee-defensive-vs-two-handed" && row.category === "sword" : row.comparison === kind);
  const reference = rows.filter(row => row.context === "same-level-neutral-reference");
  const encounters = rows.filter(row => row.context !== "same-level-neutral-reference");
  return [kind, {
    neutralReference: summarize(reference), encounters: summarize(encounters),
    neutralContinuousSensitivity: summarize(reference.map(row => ({ ...row, ...row.continuous }))),
    encountersContinuousSensitivity: summarize(encounters.map(row => ({ ...row, ...row.continuous })))
  }];
}));
const sources = [
  "apps/server/src/items/progressionWeaponItems.ts", "apps/server/src/items/basicEquipment.ts",
  "packages/shared/src/equipment.ts", "packages/shared/src/equipmentCombat.ts", "packages/shared/src/weapons.ts",
  "packages/shared/src/characterProgression.ts", "packages/shared/src/battleRules.ts", "packages/shared/src/enemies.ts",
  "apps/server/src/battle/BattleService.ts", "apps/server/src/world/encounterDefinitions.ts", "scripts/verify-weapon-balance.mjs"
];
const sourceSha256 = Object.fromEntries(await Promise.all(sources.map(async source =>
  [source, createHash("sha256").update(await readFile(new URL(source, root))).digest("hex")])));
const report = {
  command: "node --import tsx scripts/verify-weapon-balance.mjs", sourceSha256,
  method: {
    characterLevels: levels, masteryLevels: masteries, masteryExperience: Object.fromEntries(masteryExperience),
    itemCount: PROGRESSION_WEAPON_ITEMS.length, categories, tiers,
    baselineGear: "Only main hand plus specified shield; all other slots empty; no injuries, upgrades or consumables.",
    defensiveShield: { itemId: defensiveShield.itemId, modifiers: defensiveShield.equipment.modifiers },
    reference: "Same-level getCharacterStatistics armor and raw meleeDamage; no enemy block. EHP = maxHp * incoming raw hit / actual mitigated incoming hit. DPT = actual mitigated outgoing hit * floor(AP / attack AP). Score = DPT * EHP.",
    continuousSensitivity: "Explicit approximation only: EHP = HP * (1 + armor/100) / (1 - block/100); outgoing hit = raw / (1 + target armor/100) * (1 - target block/100), with no integer rounding. Store continuous DPT and score alongside authoritative rounded hits. Sword is also summarized separately; other 1H utility such as initiative is not valued by this metric.",
    spread: "100 * (stronger score / weaker score - 1); approximately 15% is a heuristic, not a failing assertion. Outside-target counts use 1e-9 percentage-point tolerance to avoid treating floating-point 15.000000000000014 as an overrun; exact observed values remain stored.",
    encounters: "Actual BattleService.startBattle outputs, solo. Fixed enemies retain their fixed stats; scaling enemies use service level floors and 10/25 group changes. Duplicate forest-boars-02 omitted because it shares the forest-boars-01 profile.",
    turns: "Stationary, legal in-range/LOS attacks, fresh full AP every turn; attack actions count overkill per enemy. Incoming group DPT holds all enemies alive, so it is a pressure bound, not a duel result.",
    healing: "Live getBattleHealingPreview confirms 3 AP and second heal unavailable. One heal/turn plus attacks from remaining AP; full power requires enough missing HP. Negative net loss is capacity, not invulnerability.",
    limitations: "No movement, blocked LOS, ranged approach advantage, initiative/turn-order kills, injury proc, focus-fire, ally healing or PvP win-rate simulation. Score comparisons do not establish perfect PvP balance. Enemy generation has random IDs; only deterministic stat outputs are retained."
  },
  manifest: PROGRESSION_WEAPON_ITEMS.map(seed => ({ itemId: seed.itemId, minimumLevel: seed.minimumLevel,
    category: seed.subcategoryId, modifiers: seed.stats.map(({ statCode, modifierType, value }) => ({ statCode, modifierType, value })) })),
  summary, encounters, profiles, measurements, comparisons
};

const num = value => Number(value.toFixed(3)).toString();
const getProfile = (level, mastery, suffix) => profileIndex.get(`${level}/${mastery}/${suffix}`);
const getMeasurement = (profile, encounterId) => measurementIndex.get(`${profile.key}|${profile.level}/${encounterId}`);
const lines = ["# Weapon package balance measurements", "",
  "Reproduce from repository root: `node --import tsx scripts/verify-weapon-balance.mjs`. The adjacent JSON contains exact values, all 66 authored item profiles, source hashes and every observation. No database, seed, assets or product statistics are modified.", "",
  `Measured ${profiles.length} loadouts and ${measurements.length} encounter/loadout combinations at levels ${levels.join(", ")} with masteries ${masteries.join("/")}. Latest eligible item tier is used (level 25 uses tier 20). Every weapon and offensive shield tier is covered.`, "",
  "Only main hand and the specified offhand are equipped. Defensive offhand is the real `training-shield` (+10 BLOCK_POWER): total block 20/27.5/35%; offensive shields have total block 10/17.5/25% at mastery 0/50/100. Main-hand and shield mastery are equal in these comparisons. Bow/crossbow/staff/two-handed cannot equip the shield.", "",
  "Score = stationary damage per turn × effective HP. Outgoing and incoming hits call `mitigatedBattleDamage`, including both rounding stages. EHP = HP × incoming raw hit / actual incoming mitigated hit. Neutral reference uses the same-level ungeared character's armor and raw melee damage. Reported spread = stronger/weaker − 1, expressed as a percentage; approximately 15% is an advisory target.", "",
  "Continuous sensitivity replaces integer mitigation with smooth multipliers: EHP = HP × (1 + armor/100) ÷ (1 − block/100). Its outgoing DPT uses the same smooth target mitigation; AP/action counts and rounded mastery-derived attack stats remain unchanged. This supplementary approximation isolates mitigation rounding. Actual hit/turn counts always use the runtime. Sword+shield is summarized separately from other one-handed families, whose initiative utility this metric omits.", "",
  "## Maximum score spreads", "", "| Comparison | Context set | Ratio left/right range | Maximum spread | Worst level/mastery/category/context | Outside 15% |", "|---|---|---:|---:|---|---:|"];
for (const [kind, sets] of Object.entries(summary)) for (const [context, result] of Object.entries(sets)) {
  const w = result.worst;
  lines.push(`| ${kind} | ${context} | ${num(result.minimumLeftToRightRatio)}–${num(result.maximumLeftToRightRatio)} | ${num(w.spreadPercent)}% | ${w.level}/${w.mastery}/${w.category}/${w.context} | ${result.outside15Percent}/${result.observations} |`);
}
lines.push("", "These maxima are measurements of the approved profiles, not automatic balance gates. The JSON preserves each maximum's exact ratio, both scores, and loadout keys. Enemy-specific round-off can move a case over 15% even when the neutral reference is within range.", "",
  "## AP boundaries (mastery 50; neutral reference)", "", "| Level | Tier | AP | Melee attacks/turn | Ranged attacks/turn | Sword+defense hit/DPT | Two-handed hit/DPT | Wand+defense hit/DPT | Bow hit/DPT |", "|---:|---:|---:|---:|---:|---|---|---|---|");
for (const level of [10, 11, 20, 21, 25, 30]) {
  const p = ["sword/defensive", "two-handed/none", "wand/defensive", "bow/none"].map(suffix => getProfile(level, 50, suffix));
  lines.push(`| ${level} | ${p[0].tier} | ${p[0].stats.maxAp} | ${p[0].attacksPerTurn} | ${p[2].attacksPerTurn} | ${p.map(x => `${x.reference.outgoingHit}/${x.reference.damagePerTurn}`).join(" | ")} |`);
}
lines.push("", "## Fixed enemy hit counts (mastery 0)", "", "Fixed enemy stats below come directly from `BattleService.startBattle`. Turns are attack turns with zero movement cost; ranged combat may need fewer approach turns in actual play.", "",
  "| Hero level / item tier | Enemy | HP / armor / raw hit | Sword+defense hit; actions/turns | Two-handed hit; actions/turns | Wand+defense hit; actions/turns | Bow hit; actions/turns |", "|---|---|---|---|---|---|---|");
for (const enemy of ENEMY_DEFINITIONS) {
  const level = enemy.id === "feral-rat" || enemy.id === "forest-wolf" ? 1 : enemy.id === "outlaw-guard" ? 10 : 5;
  const p = ["sword/defensive", "two-handed/none", "wand/defensive", "bow/none"].map(suffix => getProfile(level, 0, suffix));
  const enc = encounters.find(x => x.key === `${level}/${enemy.id}-01`);
  lines.push(`| ${level}/${p[0].tier} | ${enemy.id} | ${enc.maxHp}/${enc.armor}/${enc.meleeDamage} | ${p.map(x => { const m = getMeasurement(x, `${enemy.id}-01`); return `${m.outgoingHit}; ${m.totalAttackActions}/${m.stationaryAttackTurnsToClear}`; }).join(" | ")} |`);
}
lines.push("", "The wolf is deliberately also shown against tier 1, and bandit against tier 5; this avoids implying extra item tiers at levels 3 and 7. Full JSON includes every fixed enemy at every sampled hero level and mastery.", "",
  "## Higher scaling encounters", "", "| Level | Encounter | Enemies × HP / armor / raw hit |", "|---:|---|---|");
for (const encounter of encounters.filter(x => [25, 30].includes(x.characterLevel) && x.kind === "scaling")) {
  lines.push(`| ${encounter.characterLevel} | ${encounter.encounterId} | ${encounter.enemyCount} × ${encounter.maxHp} / ${encounter.armor} / ${encounter.meleeDamage} |`);
}
lines.push("", "| Level | Mastery | Loadout | Outgoing hit | Incoming hit | Actions / attack turns to clear wolf-pack-01 | Full living group DPT |", "|---:|---:|---|---:|---:|---|---:|");
for (const level of [25, 30]) for (const mastery of masteries) for (const suffix of ["sword/defensive", "two-handed/none", "wand/defensive", "bow/none"]) {
  const m = getMeasurement(getProfile(level, mastery, suffix), "wolf-pack-01");
  lines.push(`| ${level} | ${mastery} | ${suffix} | ${m.outgoingHit} | ${m.incomingHit} | ${m.totalAttackActions}/${m.stationaryAttackTurnsToClear} | ${m.incomingFullGroupDpt} |`);
}
lines.push("", "## Staff healing is separate", "", "Healing uses the actual preview: 3 AP, once per turn, no simultaneous two-handed shield. Values below assume enough missing HP, no injuries, and all wolves alive. Healing does not increase the damage×EHP comparison score.", "",
  "| Level/tier | Mastery | Heal/turn | Attacks after one heal | Staff hit vs wolf pack | Attack DPT with one heal | Full group incoming DPT | Net HP loss/turn |", "|---|---:|---:|---:|---:|---:|---:|---:|");
for (const level of [...new Set([...tiers, 25])].sort((a, b) => a - b)) for (const mastery of masteries) {
  const p = getProfile(level, mastery, "staff/none"), m = getMeasurement(p, "wolf-pack-01");
  lines.push(`| ${level}/${p.tier} | ${mastery} | ${p.healing.power} | ${p.healing.attacksPerTurnWithOneHeal} | ${m.outgoingHit} | ${m.withOneHeal.attackDamagePerTurn} | ${m.incomingFullGroupDpt} | ${m.withOneHeal.netHpLossPerFullGroupTurn} |`);
}
lines.push("", "Negative net loss indicates spare healing capacity against this stationary incoming bound. It does not prove that actual damage timing, focused attacks, movement, healing targets and injuries permit survival.", "",
  "## Limits and interpretation", "",
  "All encounter counts and statistics are real service outputs, while hit/action/turn totals are deterministic arithmetic on real shared damage/AP outputs. These are stationary bounds, not automated full battles: no approach movement, LOS obstruction, initiative kills, injury procs, AI choices or focus fire are simulated. In particular, dagger/spear initiative and ranged positional advantage are not priced by this score. HP EHP depends on incoming hit size because mitigation rounds to integers. No PvP win-rate or perfect balance claim is made.", "",
  "The approved stats are preserved. Neutral-reference departures are material enough to document: the strongest melee comparison exceeds 15%, as does the weakest wand comparison; the JSON summary identifies the exact cases. Weak fixed enemies magnify rounding differences. Staff can heal more than the whole stationary legacy wolf pack deals at the measured tiers, while still attacking; that sustain is a separate design question, not evidence that its direct damage is balanced against other weapons.", "",
  "Interpretation: retain the approved profiles with these measured advisory-target departures and scope limits documented. The approximate target does not require an implicit rebalance. A strict 15% guarantee would be a new profile design decision; this artifact does not silently change item stats.", "");

await mkdir(new URL("docs/", root), { recursive: true });
await writeFile(new URL("docs/weapon-package-balance.json", root), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(new URL("docs/weapon-package-balance.md", root), lines.join("\n"));
console.log(JSON.stringify({ itemCount: PROGRESSION_WEAPON_ITEMS.length, profiles: profiles.length,
  measurements: measurements.length, comparisons: comparisons.length,
  summary: Object.fromEntries(Object.entries(summary).map(([kind, contexts]) => [kind,
    Object.fromEntries(Object.entries(contexts).map(([context, result]) => [context, {
      observations: result.observations, outside15Percent: result.outside15Percent,
      maxSpreadPercent: result.worst.spreadPercent,
      worst: `${result.worst.level}/${result.worst.mastery}/${result.worst.category}/${result.worst.context}`
    }]))])) }, null, 2));
