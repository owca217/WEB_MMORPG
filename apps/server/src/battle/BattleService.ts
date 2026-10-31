import { randomUUID } from "node:crypto";
import {
  getCharacterStatistics,
  getEnemyDefinition,
  getEquipmentCombatStatistics,
  getEquippedWeaponFamily,
  hasEquippedShield,
  MAX_CHARACTER_LEVEL,
  BATTLE_ITEM_AP_COST,
  type ConsumableEffects,
  type InventorySnapshot,
  type CombatStatistics,
  type BattleCommand,
  type BattleSnapshot,
  type CharacterSnapshot,
  type InjuryKind,
  type PlayerId,
  type WeaponFamily
} from "@web-mmorpg/shared";
import { generateArena } from "./arenaGenerator";
import {
  applyBattleCommand,
  applyNpcBattleCommand,
  createBattleState,
  removeBattleCombatant,
  type BattleResult,
  type BattleState
} from "./BattleEngine";
import { chooseWolfCommand } from "./NpcBattleAi";
import { chooseAutoBattleCommand } from "./AutoBattleAi";
import { getEncounterDefinition, LEGACY_WOLF_DEFINITION } from "../world/encounterDefinitions";

interface ActiveBattle {
  participants: Map<PlayerId, { weaponFamily:WeaponFamily|undefined; shield:boolean; used:Set<WeaponFamily>; auto: boolean }>;
  initialParticipantCount: number;
  encounterId: string;
  seed: number;
  state: BattleState;
  experienceReward: number;
  itemUsePending?: boolean;
}

export interface PlayerBattleOutcome {
  hp: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface TrainingAward { weaponTraining?: { family: WeaponFamily; amount: number }; shieldTraining?: number; }

export interface AppliedBattleCommand {
  participantIds?: PlayerId[];
  usedWeaponFamilies?:Record<PlayerId,WeaponFamily[]>;
  playerOutcomes?: Record<PlayerId, PlayerBattleOutcome>;
  trainingAwards?: Record<PlayerId, TrainingAward>;
  initialParticipantCount?: number;
  weaponTraining?: { family: WeaponFamily; amount: number };
  shieldTraining?: number;
  result: BattleResult;
  snapshot?: BattleSnapshot;
  finished: boolean;
  victory: boolean;
  encounterId?: string;
  seed?: number;
  playerOutcome?: PlayerBattleOutcome;
  experienceReward?: number;
}

export class BattleService {
  private readonly battlesByPlayer = new Map<PlayerId, ActiveBattle>();

  startBattle(character: CharacterSnapshot, encounterId: string): BattleSnapshot {
    const old = this.battlesByPlayer.get(character.playerId);
    if (old?.itemUsePending) throw new Error("BATTLE_ACTION_PENDING");
    // Preserve solo restart behavior without replacing one alias of a shared arena.
    if (old?.initialParticipantCount === 1) this.removeBattleForPlayer(character.playerId);
    return this.startPartyBattle([character], encounterId);
  }

  startPartyBattle(characters: readonly CharacterSnapshot[], encounterId: string): BattleSnapshot {
    if (characters.length < 1 || characters.length > 5 || new Set(characters.map(c => c.playerId)).size !== characters.length) throw new Error("INVALID_BATTLE_PARTICIPANTS");
    for (const character of characters) {
      const old = this.battlesByPlayer.get(character.playerId);
      if (old?.itemUsePending) throw new Error("BATTLE_ACTION_PENDING");
      if (old) throw new Error("BATTLE_ALREADY_STARTED");
      if (character.hp <= 0) throw new Error("COMBATANT_DOWN");
    }
    const initiator = characters[0]!, seed = 12345;
    const arena = generateArena({ radius: 4, obstacleCount: 6, coverCount: 4 }, seed);
    const definition = getEncounterDefinition(encounterId) ?? LEGACY_WOLF_DEFINITION;
    const enemy = definition.enemyId ? getEnemyDefinition(definition.enemyId) : undefined;
    const level = Math.max(definition.minimumLevel, ...characters.map(character => Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(character.level) || 1))));
    const soloCount = level >= 25 ? 3 : level >= 10 ? 2 : 1;
    const wolfCount = enemy ? 1 : Math.min(5, soloCount + characters.length - 1);
    const healthFactor = soloCount === 3 ? 0.65 : soloCount === 2 ? 0.75 : 1;
    const damageFactor = soloCount === 3 ? 0.35 : soloCount === 2 ? 0.5 : 1;
    const wolfHp = enemy?.maxHp ?? Math.round((definition.baseHp + definition.hpPerLevel * (level - 1)) * healthFactor);
    const wolfDamage = enemy?.combatStats.meleeDamage ?? Math.round((definition.baseDamage + definition.damagePerLevel * (level - 1)) * damageFactor);
    const wolfArmor = enemy?.combatStats.armor ?? Math.floor(definition.baseArmor + definition.armorPerLevel * (level - 1) + 3 * Math.max(0, level - 25));
    const wolfInitiative = enemy?.initiative ?? initiator.initiative - (initiator.injuries.includes("concussion") ? 2 : 0) - 1;
    const enemyStarts = arena.enemyStartCells.slice(0, wolfCount);
    if (arena.playerStartCells.length < characters.length || enemyStarts.length !== wolfCount) throw new Error("ARENA_START_POSITION_MISSING");
    const state = this.runNpcTurns(createBattleState({
id: `battle:${initiator.playerId}:${encounterId}:${randomUUID()}`, seed, arena, combatants: [
        ...characters.map((character, index) => {
          const characterLevel = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(character.level) || 1));
          const equipped=getEquipmentCombatStatistics(getCharacterStatistics(characterLevel),character.weaponTraining,character.equipment);
          const stats=character.statistics??equipped;
          const combatStats: CombatStatistics = {
meleeDamage: equipped.meleeEnabled?stats.meleeDamage:0, rangedDamage: equipped.rangedEnabled?stats.rangedDamage:0, armor: stats.armor,meleeEnabled:Boolean(equipped.meleeEnabled),rangedEnabled:Boolean(equipped.rangedEnabled),
            ...(equipped.healingPower !== undefined ? { healingPower: equipped.healingPower } : {}), ...(equipped.blockPercent !== undefined ? { blockPercent: equipped.blockPercent } : {})
};
          return {
id: `hero:${character.playerId}`, ownerPlayerId: character.playerId, side: "player" as const, name: character.nickname, level: characterLevel, combatStats,
            hp: character.hp, maxHp: character.maxHp, maxAp: character.maxAp, initiative: character.initiative, position: arena.playerStartCells[index]!, severelyInjured: character.severelyInjured, injuries: [...character.injuries]
};
        }),
        ...enemyStarts.map((position, index) => ({
id: enemy ? `enemy:${encounterId}` : index === 0 ? `${definition.enemyKind}:${encounterId}` : `${definition.enemyKind}:${encounterId}:${index + 1}`, ...(enemy ? { enemyId: enemy.id } : {}), side: "enemy" as const, name: enemy?.name ?? definition.enemyName, level: enemy?.level ?? level,
          combatStats: { meleeDamage: wolfDamage, rangedDamage: enemy?.combatStats.rangedDamage ?? 0, armor: wolfArmor }, hp: wolfHp, maxHp: wolfHp, maxAp: enemy?.maxAp ?? 4, initiative: wolfInitiative, position, severelyInjured: false, injuries: []
}))
      ]
}));
    const participants = new Map(characters.map(character => [character.playerId, { weaponFamily:getEquippedWeaponFamily(character.equipment),shield:hasEquippedShield(character.equipment),used:new Set<WeaponFamily>(),auto: false }]));
    const active: ActiveBattle = { participants, initialParticipantCount: characters.length, encounterId, seed, state, experienceReward: enemy?.experienceReward ?? wolfCount * (25 + 15 * level) };
    for (const id of participants.keys()) this.battlesByPlayer.set(id, active);
    return this.snapshotFor(active, initiator.playerId);
  }

  getParticipantIds(playerId: PlayerId): PlayerId[] { return [...(this.battlesByPlayer.get(playerId)?.participants.keys() ?? [])]; }
  getActivePlayerId(playerId: PlayerId): PlayerId | undefined {
    const active = this.battlesByPlayer.get(playerId);
    return active && !active.state.finished ? active.state.combatants[active.state.activeCombatantId]?.ownerPlayerId : undefined;
  }
  isItemUsePending(playerId: PlayerId): boolean { return Boolean(this.battlesByPlayer.get(playerId)?.itemUsePending); }

  hasBattle(playerId: PlayerId): boolean {
    return this.battlesByPlayer.has(playerId);
  }

  getSnapshot(playerId: PlayerId): BattleSnapshot | undefined {
    const active = this.battlesByPlayer.get(playerId);
    return active ? this.snapshotFor(active, playerId) : undefined;
  }

  setAuto(playerId: PlayerId, enabled: boolean): BattleSnapshot {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) throw new Error("BATTLE_NOT_FOUND");
    if (active.state.finished) throw new Error("BATTLE_FINISHED");
    if (active.itemUsePending) throw new Error("BATTLE_ACTION_PENDING");
    active.participants.get(playerId)!.auto = enabled;
    return this.snapshotFor(active, playerId);
  }

  isAuto(playerId: PlayerId): boolean {
    const active = this.battlesByPlayer.get(playerId);
    return Boolean(active?.participants.get(playerId)?.auto && !active.state.finished);
  }

  applyAutoCommand(playerId: PlayerId): AppliedBattleCommand {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) return this.rejected("BATTLE_NOT_FOUND", "No active battle.");
    if (!active.participants.get(playerId)?.auto) return this.rejected("AUTO_BATTLE_DISABLED", "Automatic combat is disabled.");
    if (active.state.finished) return this.rejected("BATTLE_FINISHED", "Battle is already finished.");
    const actor = active.state.combatants[active.state.activeCombatantId];
    if (actor?.ownerPlayerId !== playerId) return this.rejected("NOT_ACTIVE_TURN", "The player is not active.");
    return this.applyPlayerCommand(playerId, chooseAutoBattleCommand(active.state, playerId));
  }

  applyCommand(playerId: PlayerId, command: BattleCommand): AppliedBattleCommand {
    if (this.battlesByPlayer.get(playerId)?.participants.get(playerId)?.auto) return this.rejected("AUTO_BATTLE_ACTIVE", "Przejmij sterowanie, aby wydać polecenie.");
    return this.applyPlayerCommand(playerId, command);
  }

  private rejected(code: string, message: string): AppliedBattleCommand {
    return { result: { ok: false, code, message }, finished: false, victory: false };
  }

  private applyPlayerCommand(playerId: PlayerId, command: BattleCommand): AppliedBattleCommand {
    const active = this.battlesByPlayer.get(playerId);
    if (active?.itemUsePending) {
      return {
        result: { ok: false, code: "BATTLE_ACTION_PENDING", message: "An item is being used." },
        finished: false,
        victory: false
      };
    }
    if (!active) {
      return {
        result: { ok: false, code: "BATTLE_NOT_FOUND", message: "No active battle." },
        finished: false,
        victory: false
      };
    }

    const beforeBlocks = this.shieldCounters(active);
    const playerResult = applyBattleCommand(active.state, playerId, command);
    if (!playerResult.ok) return { result: playerResult, finished: false, victory: false };
    active.state = this.runNpcTurns(playerResult.state);
    return this.applied(active, playerId, beforeBlocks, command);
  }

  private shieldCounters(active: ActiveBattle): Map<PlayerId, number> {
    return new Map(Object.values(active.state.combatants).flatMap(unit => unit.ownerPlayerId ? [[unit.ownerPlayerId, unit.shieldBlocks ?? 0] as const] : []));
  }
  private applied(active: ActiveBattle, actorId: PlayerId, beforeBlocks: Map<PlayerId, number>, command?: BattleCommand): AppliedBattleCommand {
    const participantIds=[...active.participants.keys()];
    for(const unit of Object.values(active.state.combatants)) {
      if(!unit.ownerPlayerId)continue;
      const participant=active.participants.get(unit.ownerPlayerId);
      if(participant?.shield && (unit.shieldBlocks??0)>(beforeBlocks.get(unit.ownerPlayerId)??0))participant.used.add("shield");
    }
    const actor=active.participants.get(actorId);
    if(command && actor?.weaponFamily && ["meleeAttack","rangedAttack","healSelf","healAlly"].includes(command.type))actor.used.add(actor.weaponFamily);
    const playerOutcomes: Record<PlayerId, PlayerBattleOutcome> = {};
    for (const unit of Object.values(active.state.combatants)) if (unit.ownerPlayerId && active.participants.has(unit.ownerPlayerId)) playerOutcomes[unit.ownerPlayerId] = { hp: unit.hp, severelyInjured: unit.severelyInjured, injuries: [...unit.injuries] };
    const victory = active.state.finished && Object.values(active.state.combatants).some(unit => unit.side === "player" && unit.hp > 0);
    return {
result: { ok: true, state: active.state }, snapshot: this.snapshotFor(active, actorId), finished: active.state.finished, victory,
      participantIds, initialParticipantCount: active.initialParticipantCount, encounterId: active.encounterId, seed: active.seed,
      ...(active.state.finished ? {usedWeaponFamilies:Object.fromEntries([...active.participants].map(([id,participant])=>[id,[...participant.used]]))}:{}),
      ...(active.state.finished ? { playerOutcomes, ...(playerOutcomes[actorId] ? { playerOutcome: playerOutcomes[actorId] } : {}) } : {}), ...(victory ? { experienceReward: active.experienceReward } : {})
};
  }

  detachPlayer(playerId: PlayerId): { outcome?: PlayerBattleOutcome; applied?: AppliedBattleCommand } {
    const active = this.battlesByPlayer.get(playerId); if (!active) return {};
    if (active.itemUsePending) throw new Error("BATTLE_ACTION_PENDING");
    const unit = Object.values(active.state.combatants).find(combatant => combatant.ownerPlayerId === playerId);
    const outcome = unit ? { hp: unit.hp, severelyInjured: unit.severelyInjured, injuries: [...unit.injuries] } : undefined;
    const beforeBlocks = this.shieldCounters(active);
    this.battlesByPlayer.delete(playerId); active.participants.delete(playerId);
    if (unit) active.state = removeBattleCombatant(active.state, unit.id);
    active.state = this.runNpcTurns(active.state);
    const remaining = [...active.participants.keys()];
    return { ...(outcome ? { outcome } : {}), ...(remaining[0] ? { applied: this.applied(active, remaining[0], beforeBlocks) } : {}) };
  }

  async useConsumable(
    playerId: PlayerId,
    combatantId: string,
    consume: (prepare: (effects: ConsumableEffects) => PlayerBattleOutcome) => Promise<InventorySnapshot>
  ): Promise<{ snapshot: BattleSnapshot; inventory: InventorySnapshot; playerOutcome: PlayerBattleOutcome }> {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) throw new Error("BATTLE_NOT_FOUND");
    if (active.itemUsePending) throw new Error("BATTLE_ACTION_PENDING");
    if (active.state.finished) throw new Error("BATTLE_FINISHED");
    if (active.participants.get(playerId)?.auto) throw new Error("AUTO_BATTLE_ACTIVE");
    const actor = active.state.combatants[combatantId];
    if (!actor) throw new Error("COMBATANT_NOT_FOUND");
    if (actor.ownerPlayerId !== playerId) throw new Error("NOT_OWNER");
    if (active.state.activeCombatantId !== combatantId) throw new Error("NOT_ACTIVE_TURN");
    if (actor.hp <= 0) throw new Error("COMBATANT_DOWN");
    if (actor.ap < BATTLE_ITEM_AP_COST) throw new Error("INSUFFICIENT_AP");

    active.itemUsePending = true;
    let staged: BattleState | undefined;
    let outcome: PlayerBattleOutcome | undefined;
    try {
      const inventory = await consume((effects) => {
        if (staged) throw new Error("ITEM_ALREADY_PREPARED");
        const hp = Math.min(actor.maxHp, actor.hp + Math.max(0, Math.floor(effects.healHp ?? 0)));
        const ap = Math.min(actor.maxAp, actor.ap - BATTLE_ITEM_AP_COST + Math.max(0, Math.floor(effects.restoreAp ?? 0)));
        if (!Number.isFinite(hp) || !Number.isFinite(ap) || (hp <= actor.hp && ap <= actor.ap)) {
          throw new Error("ITEM_NO_EFFECT");
        }
        staged = structuredClone(active.state);
        staged.combatants[combatantId]!.hp = hp;
        staged.combatants[combatantId]!.ap = ap;
        outcome = { hp, severelyInjured: actor.severelyInjured, injuries: [...actor.injuries] };
        return outcome;
      });
      if (!staged || !outcome) throw new Error("ITEM_EFFECT_MISSING");
      active.state = staged;
      return { snapshot: this.snapshotFor(active, playerId), inventory, playerOutcome: outcome };
    } finally {
      active.itemUsePending = false;
    }
  }

  removeBattleForPlayer(playerId: PlayerId): void {
    const active = this.battlesByPlayer.get(playerId);
    this.battlesByPlayer.delete(playerId);
    active?.participants.delete(playerId);
  }

  private runNpcTurns(state: BattleState): BattleState {
    let next = state;

    for (let guard = 0; guard < 32 && !next.finished; guard += 1) {
      const active = next.combatants[next.activeCombatantId];
      if (!active || active.ownerPlayerId !== undefined || active.side !== "enemy") {
        break;
      }

      const command = chooseWolfCommand(next, active.id);
      const result = applyNpcBattleCommand(next, command);
      if (!result.ok) {
        throw new Error(`NPC_COMMAND_REJECTED:${result.code}`);
      }

      next = result.state;
    }

    return next;
  }

  private snapshotFor(active: ActiveBattle, viewerId: PlayerId): BattleSnapshot {
    const snapshot = this.toSnapshot(active.state, active.participants.get(viewerId)?.auto ?? false);
    if (active.initialParticipantCount > 1) snapshot.participantIds = [...active.participants.keys()];
    return snapshot;
  }

  private toSnapshot(state: BattleState, autoBattle = false): BattleSnapshot {
    return {
      ...(autoBattle ? { autoBattle: true } : {}),
      id: state.id,
      round: state.round,
      activeCombatantId: state.activeCombatantId,
      turnOrder: [...state.turnOrder],
      cells: state.arena.cells.map((cell) => ({ ...cell })),
      blockedCells: state.arena.blockedCells.map((cell) => ({ ...cell })),
      coverCells: state.arena.coverCells.map((cell) => ({ ...cell })),
      combatants: Object.values(state.combatants).map((combatant) => ({
        id: combatant.id,
        ...(combatant.enemyId ? { enemyId: combatant.enemyId } : {}),
        side: combatant.side,
        ...(combatant.ownerPlayerId !== undefined
          ? { ownerPlayerId: combatant.ownerPlayerId }
          : {}),
        name: combatant.name,
        ...(combatant.level !== undefined ? { level: combatant.level } : {}),
        ...(combatant.combatStats ? { combatStats: { ...combatant.combatStats } } : {}),
        ...(combatant.healingUsedThisTurn ? { healingUsedThisTurn: true } : {}),
        hp: combatant.hp,
        maxHp: combatant.maxHp,
        ap: combatant.ap,
        maxAp: combatant.maxAp,
        initiative: combatant.initiative,
        position: { ...combatant.position },
        severelyInjured: combatant.severelyInjured,
        injuries: [...combatant.injuries]
      })),
      finished: state.finished
    };
  }
}
