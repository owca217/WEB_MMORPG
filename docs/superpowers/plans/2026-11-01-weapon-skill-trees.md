# Weapon Skill Trees Implementation Plan

**Goal:** Dostarczyć działające i zapisujące się drzewka dziewięciu rodzin broni w kliencie WWW i Androidzie.
**Architecture:** Wspólny katalog/reguły, zapis w istniejącym JSON treningu, serwer autorytatywny dla nauki i walki, responsywny panel postaci i pasek technik.
**Tech Stack:** TypeScript, Phaser, Socket.IO, PostgreSQL, Vitest, Capacitor.
**Spec:** docs/superpowers/specs/2026-11-01-weapon-skill-trees-design.md

## Global Constraints
- Zachować nazwę Kroniki Pogranicza, obecne XP, ekwipunek, urazy oraz dane kont.
- Nie zmieniać głównego checkoutu ani używać bazy graczy do testów.
- Testować tylko dotknięte reguły, zapis, integrację i UI; zachować automatyczne bramki wydania.

## Review Focus
- Istniejący wysoki poziom otrzymuje punkty bez resetu XP.
- Zakup nie omija poziomu, kosztu, poprzednika ani rodziny i jest odporny na powtórzenie.
- Równoległa nauka, zapis XP, zmiana sesji i rozpoczęcie walki nie gubią danych.
- Niedozwolona technika nie zużywa AP ani odnowienia; klient nie steruje listą umiejętności aktora.
- Drzewko i cel techniki działają po aktualizacji snapshotu oraz przy sterowaniu dotykowym.

## Tasks
- [x] Shared: katalog36węzłów, punkty/normalizacja/nauka/reset, pasywy sprzętu; celowane testy z red/green.
- [x] Server persistence: zdarzenia learnWeaponSkill/resetWeaponSkills, trwały zapis i blokady; testy sesji i zapisu.
- [x] Battle: useWeaponSkill command, wspólny podgląd, AP/cele/odnowienia, snapshoty, XP i Auto; testy efektów i odrzuceń.
- [x] Client: drzewka, nauka/reset, pasek aktywnych technik i integracja scen; celowane testy DOM.
- [ ] Integration: kompilacja, pojedynczy przegląd spójności, lokalny przepływ, podpisany Android0.1.27/code28, publikacja i kontrola faktycznego wydania.

## Shared contract
WeaponSkillId = `${WeaponFamily}:${"power"|"technique"|"mastery"|"ultimate"}`.
WeaponTraining.learnedSkills?: WeaponSkillId[].
WeaponSkillDefinition: id/family/name/description/branch("power"|"tactics")/requiredLevel/pointCost/prerequisite?/kind("attack"|"heal"|"guard"|"passive")/target("enemy"|"ally"|"self")/apCost/cooldownTurns; optional damageMultiplier, armorPenetration(0..1), healingMultiplier, healPercentMaxHp(0..1), blockBonus, armorBonus, durationTurns, passiveBonusPercent, attackMode("meleeAttack"|"rangedAttack"), range, injury:{kind,duration}.
Exports: WEAPON_SKILLS, getWeaponSkill(id:unknown), getWeaponSkillProgress(training:unknown,family), getLearnedWeaponSkills(training:unknown,families?:readonly WeaponFamily[]), learnWeaponSkill(training:unknown,id:unknown), resetWeaponSkillFamily(training:unknown,family:unknown).
Progress: {level,earnedPoints,spentPoints,availablePoints,learnedSkills:WeaponSkillId[]}.
Socket events: learnWeaponSkill({skillId:string},ack), resetWeaponSkills({family:WeaponFamily},ack), result WeaponSkillUpdateResult = {ok:true,character:CharacterSnapshot}|{ok:false,code,message}.
BattleCommand: {type:"useWeaponSkill",combatantId,skillId:WeaponSkillId,targetId?:string}.
CombatantSnapshot optional weaponSkills:WeaponSkillId[], weaponSkillCooldowns:Partial<Record<WeaponSkillId,number>>, weaponSkillBuffs:{armorBonus:number,blockBonus:number,remainingTurns:number}[]; server owns these values.
Engine owner defines/exports getWeaponSkillPreview(snapshot,actorId,skillId,targetId?) in shared/battleSkillRules.ts; returns {available,reason?,apCost,cooldownRemaining,amount,targetId?} and enforces same restrictions server uses.
