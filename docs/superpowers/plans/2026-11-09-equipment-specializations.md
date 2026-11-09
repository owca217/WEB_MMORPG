# Equipment Specializations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; independent server/UI/catalog work can be delegated with explicit file ownership. Steps use checkbox syntax.

**Goal:** Remove general character growth and deliver an independent weapon/armor specialization board.
**Architecture:** Preserve historical level/XP and weapon_training data, stop using general level in gameplay. Add armor_training JSONB, shared authoritative armor progression and item classification, and an independent radial window.
**Tech Stack:** TypeScript, Phaser, DOM/CSS/SVG, Socket.IO, PostgreSQL, Capacitor Android.
**Spec:** ../specs/2026-11-09-equipment-specializations-design.md

## Global Constraints

- Preserve IDs, player data, weapon XP/skills, inventory/equipment and authored item versions.
- No new dependencies; fixed naked baseline HP100/PA5/initiative10/STR0/DEX0/VIT0/unarmed5.
- Separate armor pools cloth/leather/plate, ranks0–100, points floor(rank/5).
- Half reward XP to used weapons; half to worn armor families weighted by piece count.
- Save/learn/reset remain authoritative, outside-battle restrictions retained.

## Review Focus

- Old high-level character must have same stats as old level1 with identical equipment/training.
- General XP cap must no longer stop weapon training; armor survives weapon skill mutation/reconnect.
- Broken or invalid/unequipped armor cannot grant stats/XP; mixed families split deterministically.
- Merchant/equip/hydration must all remove general-level gates, preserving ordinary slot/ownership/attribute validation.
- Board selection/panning must survive snapshots and never move the character; phone back closes correct window.

## Contracts and ownership

Root owns packages/shared, shared tests, integration and release. Server agent owns apps/server except item catalog/registry/seed and migration018. Client agent owns apps/client sources/tests. Catalog agent owns apps/server/src/items, migration018 and catalog tests. Agents do not commit, push, run full suite or access player databases.

Shared new module `armorSpecialization.ts` exports ArmorFamily='cloth'|'leather'|'plate', ArmorTraining={experience:Record<ArmorFamily,number>,learnedSkills?:ArmorSkillId[]}, ArmorSkillId=`${ArmorFamily}:${'power'|'technique'|'mastery'|'ultimate'}`. Exports ARMOR_FAMILIES, ARMOR_SKILLS, normalizeArmorTraining(value), getArmorSkill(id), getArmorSkillProgress(value,family), learnArmorSkill(value,id), resetArmorSkillFamily(value,family), getArmorBonuses(value,family), getEquippedArmorFamily(item), allocateArmorExperience(reward,equipment). Progress mirrors weapon getWeaponSkillProgress including level, earnedPoints/spentPoints/availablePoints/learnedSkills plus XP current/required/percentage. ArmorSkillDefinition includes id/family/name/description/requiredLevel/pointCost/prerequisite?/armorBonusPercent/hpBonusPercent.

CharacterSnapshot adds optional armorTraining. EquipmentItemProperties adds optional armorFamily. getEquipmentCombatStatistics(base,weaponTraining,equipment?,armorTraining?) consumes it. getCharacterStatistics(level?) ignores historical argument. getCharacterEquipment keeps optional historical argument but ignores its level. Protocol adds learnArmorSkill({skillId:string},ack:WeaponSkillUpdateResult) and resetArmorSkills({family:ArmorFamily},ack). Existing weapon endpoints stay unchanged. CharacterService provides setArmorTraining(playerId,value) and trainArmor(playerId,family,amount); all recalculations use fixed shared baseline and armor state.

### Task1: Shared stats and armor rules (root)

- [x] Add failing real-behavior tests for historical-level independence, gear-only attack, armor bonuses/scoped eligibility and deterministic mixed XP.
- [x] Implement shared contracts and fixed baseline; preserve weapon passive rules.
- [x] Run focused shared tests and update directly superseded level-growth expectations. Shared new armor4 + affected20 tests pass; shared TypeScript passes.

### Task2: Authoritative persistence/rewards/requirements (server agent)

- [x] Add migration017 armor_training JSONB and repository/hydration/save plumbing. Historical level/experience remain intact but never grow or gate gameplay.
- [x] Add armor learn/reset handling with the existing session reservation/persistence invariants. Award raw reward to weapon/armor training, without general XP delta dependency.
- [x] Fix legacy encounter difficulty to encounter definition; remove character-level equip/merchant gates and LEVEL requirements, retain actual stat and ownership requirements.
- [x] Focused tests: no level growth, half-XP at historical cap, armor persist/learn/reset/reconnect, equipment/merchant access.

### Task3: Independent radial board and level-free UI (client agent)

- [x] Move mutation controller from CharacterPanel to independent SpecializationPanel, retain two character tabs.
- [x] Render radial weapon/armor overview, nodes, details, zoom/pan, accessible controls, mobile layout, selection preservation and busy/session guards.
- [x] Wire WorldScene/WorldHud/GameSocket lifecycle and shortcut K, remove player level/general XP displays and item level eligibility UI. Preserve enemy difficulty labels.
- [x] Focused UI tests for learn/reset, status, selection, windows, level-free displays and two-tab navigation.

### Task4: Armor catalog (catalog agent)

- [x] Add armorFamily registry and migration018 allowed mappings; narrowly retrofit known seeded cloth metadata without changing author content.
- [x] Add leather/plate basic armor sets with deterministic IDs, armorFamily and HP/attribute modifiers; include merchant offers via existing catalog mechanism.
- [x] Verify metadata/seed idempotency and existing instances/version preservation with focused tests. Pure6 and isolated DB11 pass.

### Task5: Integration and release (root)

- [x] TypeScript/workspace builds; fix cross-contract failures. Run full suite once because all character/combat flows use changed shared stats.
- [x] Browser exercise independent board, mouse/touch layout, real learn/reset persistence, equipment changing stats, healer behavior preserved. Use isolated QA DB only.
- [x] Increment Android version/code, build/sign/package verify; preserve certificate.
- Release gate after commit: publish to established production branch; wait RenderLIVE and required CI; compare public assets and release APK hash. Record deployment outcome in final handoff.
- [x] Update this ledger with completed implementation checks and material rulings/limits.

## Execution ledger

- Base7affadc preserved as restore point; existing linked worktree reused, branch codex/equipment-specializations. Production branch fetched and equal before edits.
- Shared RED showed historical level100 still produced STR208/HP3070 and armor APIs absent. GREEN after fixed baseline and new module.
- Ruling: armor percentage bonuses scale positive flat contributions from matching items before existing global item percentage/multiplier modifiers. This avoids multiplying unrelated armor classes or naked HP; percent-only enchantments retain their authored behavior.
- Catalog migration018 and seed tests prove legacy untouchedcloth retrofit and preserve custom versions, owned instances and qualities. New twelve merchant definitions use stable IDs.
- Private PostgreSQL cluster15433 started only for web_mmorpg_test and separate QA database. No player database used.
- Android prepared as0.1.30/code31; same signing key required, build deferred until frontend freeze.
- Full local suite: 428client +548server +82shared executed. One obsolete client gate and four server fixture/old-base expectations failed; corrected test-only and verified affected files25/25,9/9,6/6. No second full local run; required CI will repeat the final entire state.
- Read-only integrated review: no blocking correctness, durability, security or data-loss findings.
- Browser QA: actual armor learn/reset returned points and preserved rank; reconnect retained plate power+technique (8/20 spent). Mobile390x844: no horizontal overflow, zoom/pan worked. Merchant purchase/equip plate chest changed HP100/100 to100/149, VIT0 to3, armor0 to11, preserving currentHP100. Previous injury state remained stable/empty; healer behavior covered by server regression suite.
- Browser viewport reset and QA tab closed; QA server stopped. Screenshots saved outside repo in the authorized visualization directory.
- Signed Android0.1.30/code31 verified same certificate; SHA256a6c4abd6cf8456d17535dafc468f4e409d33236d8c2da80b4a9e4f1c28e8f710. Physical Android device not exercised. Production-comparison JSindex-B9jeiKpY.js/CSSindex-Bk4taPnV.css built.
