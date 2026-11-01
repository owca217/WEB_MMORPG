# Weapon Injuries Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development; implement the independent server, battle and client tasks against the shared interfaces below. Track completion here and in `.superpowers/weapon-injuries/progress.md`.

**Goal:** Let players consume a stone to roll one persistent injury upgrade on an EXCELLENT+ weapon and apply its temporary effects in real battles.

**Architecture:** Shared definitions own the catalog, eligibility and approved duration formula. PostgreSQL stores each weapon's rolled effect and idempotent upgrade receipts. The authoritative battle engine keeps temporary weapon injuries separate from permanent defeat injuries; the existing inventory interface applies upgrades and displays effects.

**Tech Stack:** TypeScript, PostgreSQL, Express/Socket.IO, Phaser/DOM, Vitest; existing dependencies only.

**Spec:** `docs/superpowers/specs/2026-10-31-weapon-injury-algorithm-design.md`.

## Global Constraints

- Eligible qualities: EXCELLENT, PERFECT, MASTERWORK, with duration bonuses 0, 1, 2.
- One effect per weapon; random injury kind and integer chance 5–15 inclusive; a reroll may repeat a kind and replaces the previous roll.
- `points=15-chancePercent+qualityBonus-2*severity`; duration `min(5,max(2,2+floor(points/3)))`; MASTERWORK + light injury + chance 5 or 6 means `"battle"`.
- Duration counts full own turns of the target. Refresh without stacking or shortening; temporary injuries never become persistent character injuries, including consumable save, defeat and disconnect paths.
- Server generates rolls and validates ownership, instance quality, item type, current session, out-of-battle/out-of-trade state. Retries do not reroll or consume twice.
- Work in the existing feature checkout, preserving the user's untracked attachments and specification. No production deployment, pushing or production-database mutation.
- Only focused tests for changed behavior and builds; DB suites run serially against a verified disposable local test database.

## Implementation decisions

These fill gaps the approved algorithm left to implementation. One `injury-stone` (Kamień urazu), category `upgrade-item`, costs 50 gold at Miro and is consumed for one roll. Application is from the stone's item details, choosing an owned weapon; equipped weapons are allowed outside combat/trade. No new art or dependency is needed. The stone does not grant a quality upgrade: players must already own a qualifying weapon.

The pool contains 15 injuries: the seven existing IDs and eight additions, including hand injury used in the approved algorithm examples. Persistent defeat injury selection stays unchanged; the added pool is available to weapon upgrades. Existing permanent injuries and temporary copies of the same kind apply a penalty only once. Temporary injuries are capped at three distinct kinds per target. Only weapon attacks can proc an effect, at most one attempt per attacker/target during the attacker's turn; periodic damage and healing cannot proc it.

| ID | Name | Severity | Penalty |
|---|---|---:|---|
| brokenArm | Złamana ręka | 2 | Ranged attack +1 AP |
| legTrauma | Uraz nogi | 2 | Movement costs 2 AP per hex |
| bleeding | Krwawienie | 1 | 5 HP at end of own turn |
| concussion | Wstrząśnienie | 0 | Initiative -2; temporary application must affect subsequent turn order |
| chestWound | Rana klatki piersiowej | 2 | Start own turn with 1 AP less |
| burn | Oparzenie | 1 | Incoming attack damage +10% |
| poison | Zatrucie | 1 | 2% base max HP at end of own turn, rounded up |
| dislocatedShoulder | Zwichnięty bark | 2 | First melee attack each turn +1 AP |
| handInjury | Uszkodzona dłoń | 1 | Weapon attack damage -15% |
| eyeInjury | Uszkodzone oko | 0 | Ranged reach 5 instead of 6 |
| tendonStrain | Naderwane ścięgno | 2 | At most 3 movement hexes each own turn |
| thighWound | Rana uda | 1 | Movement loses 2 HP/hex, capped at 6 HP/own turn |
| abdominalWound | Rana brzucha | 1 | Received healing -25% |
| backInjury | Uraz pleców | 1 | First movement after an attack +1 AP |
| deepWound | Głęboka rana | 1 | Effective max HP -10%; expiry restores cap, never grants healing |

## Review Focus

- Concurrent/replayed upgrade requests consume exactly once and do not return another roll; a request ID with different inputs is rejected.
- Temporary status never leaks into persistent injuries when using a potion, disconnecting or losing the battle.
- First/end-of-turn duration and proc-attempt counters are based on target/attacker own turns, never global rounds or command spam.
- Battle previews and both auto/NPC decisions respect the same injury costs/ranges and cannot get stuck issuing rejected actions.
- Equipped weapon upgrades update character equipment objects as well as inventory IDs; pending or stale client ACKs cannot mutate another session.

## Task 1 — Shared catalog and contracts (root)

Files: new `packages/shared/src/injuries.ts`, `packages/shared/src/weaponInjuryUpgrade.ts`; extend battle, inventory, protocol and index exports; focused shared tests.

Interfaces: `WeaponInjuryUpgrade={kind:InjuryKind;chancePercent:number;duration:2|3|4|5|"battle"}`; `BattleInjuryEffect={kind:InjuryKind;remainingTurns:number|null}`. `InventoryItem.injuryUpgrade?`; `CombatantSnapshot.temporaryInjuries?`. `WeaponInjuryUpgradeRequest={requestId,weaponInstanceId,stoneInstanceId}`; success `{ok:true,inventory,character,upgrade}`, otherwise standard code/message. Exports: `INJURY_DEFINITIONS`, `getInjuryDefinition`, `getActiveInjuryKinds`, `hasInjury`, `calculateWeaponInjuryDuration(quality,kind,chancePercent)`, `rollWeaponInjuryUpgrade(quality,random?)`, `isWeaponInjuryUpgrade`, `canApplyWeaponInjury`, `isWeaponInjuryStone`, stone ID/category/price constants. Event: `applyWeaponInjury`.

- [x] Add behavior tests covering the five approved examples, all 99 quality/severity/chance combinations, invalid inputs and quality/type gates.
- [x] Implement definitions, pure helpers and shared request/snapshot types.
- [x] Run shared focused tests; publish exact interfaces to implementers.

## Task 2 — Durable upgrades and material (server implementer)

Files: new upgrade service and migration 015; extend migrate, InventoryService, seeds, MerchantService, createGameServer and necessary trade copy preservation; focused service/socket tests.

- [x] Write focused tests for atomic consumption, instance eligibility/ownership, replay/conflict/concurrency, persistence and live-state guards.
- [x] Implement nullable per-instance JSON effect, durable receipts and transactional application with current-session assertion.
- [x] Seed stone and Miro stock; integrate handler with equipment mutation reservations, refresh equipment objects and snapshots.
- [x] Run DB tests serially on a disposable local database and server typecheck. Do not use the user's preview database.

## Task 3 — Battle integration (battle implementer)

Files: injuries, BattleEngine, BattleService, AutoBattleAi, NpcBattleAi, shared battleRules and needed snapshot state; focused engine/service/AI tests.

- [x] Add meaningful tests for proc and per-turn attempt limits, costs, full-target-turn expiry, refresh, permanent/temporary overlap, DOT/healing, cleanup on consumable/defeat/disconnect and affected AI.
- [x] Implement temporary status state and all catalog penalties using shared helpers; preserve permanent defeat mechanics.
- [x] Include equipped weapon's validated roll at battle start; expose temporary status durations in snapshots; persist only permanent injuries.
- [x] Update previews and AIs to obey the same rules; run affected pure battle suites and typecheck.

## Task 4 — Usable UI and integration (client implementer + root)

Files: ContainerContentsPanel, WorldScene, GameSocket, EquipmentIcon, HudEquipmentSlots, BattleHud, CharacterPanel labels and directly affected tests/styles.

- [x] Add focused UI tests for stone target filtering, explicit replacement, pending/retry/session guards, equipped effect display and battle timers.
- [x] Implement stone use in item details with owned eligible target selection, server-confirmed result and same request ID on uncertain retry.
- [x] Display rolled kind/chance/duration on weapon details and equipment; display temporary injury timers on own/enemy combatants.
- [x] Run affected client suites and client/shared/server builds; inspect actual browser flow using an isolated test account/server if available.
- [x] One independent integration review, fix concrete findings, document actual verification and any untested native Android behavior.

## Execution record

The user explicitly requested implementation after approving the algorithm. Implementation proceeds in this session without another approval round. Concrete reversible defaults above are implementation decisions, not additional claims of prior user agreement.

All four tasks are implemented. The final independent review's receipt-recovery and potion-preview findings were fixed and the scoped re-review is clean. Commands, results and runtime evidence are recorded in `docs/weapon-injuries-verification.md`. Production deployment and physical/browser UI acceptance were not performed.
