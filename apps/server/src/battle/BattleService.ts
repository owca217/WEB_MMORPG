import {
  getCharacterStatistics,
  MAX_CHARACTER_LEVEL,
  BATTLE_ITEM_AP_COST,
  type ConsumableEffects,
  type InventorySnapshot,
  type CombatStatistics,
  type BattleCommand,
  type BattleSnapshot,
  type CharacterSnapshot,
  type InjuryKind,
  type PlayerId
} from "@web-mmorpg/shared";
import { generateArena } from "./arenaGenerator";
import {
  applyBattleCommand,
  applyNpcBattleCommand,
  createBattleState,
  type BattleResult,
  type BattleState
} from "./BattleEngine";
import { chooseWolfCommand } from "./NpcBattleAi";

interface ActiveBattle {
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

export interface AppliedBattleCommand {
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
    if (this.battlesByPlayer.get(character.playerId)?.itemUsePending) {
      throw new Error("BATTLE_ACTION_PENDING");
    }
    const seed = 12345;
    const arena = generateArena({ radius: 4, obstacleCount: 6, coverCount: 4 }, seed);
    const playerStart = arena.playerStartCells[0];
    const level = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(character.level) || 1));
    const statistics = character.statistics ?? getCharacterStatistics(level);
    const combatStats: CombatStatistics = {
      meleeDamage: statistics.meleeDamage,
      rangedDamage: statistics.rangedDamage,
      armor: statistics.armor
    };
    const wolfCount = level >= 25 ? 3 : level >= 10 ? 2 : 1;
    const healthFactor = wolfCount === 3 ? 0.65 : wolfCount === 2 ? 0.75 : 1;
    const damageFactor = wolfCount === 3 ? 0.35 : wolfCount === 2 ? 0.5 : 1;
    const wolfHp = Math.round((120 + 28 * (level - 1)) * healthFactor);
    const wolfDamage = Math.round((10 + 2 * (level - 1)) * damageFactor);
    // Mature packs need more mitigation as the hero gains additional attacks per turn.
    const wolfArmor = Math.floor(1.5 * (level - 1) + 3 * Math.max(0, level - 25));
    const wolfInitiative = character.initiative - (character.injuries.includes("concussion") ? 2 : 0) - 1;
    const enemyStarts = arena.enemyStartCells.slice(0, wolfCount);

    if (!playerStart || enemyStarts.length !== wolfCount) {
      throw new Error("ARENA_START_POSITION_MISSING");
    }

    const state = createBattleState({
      id: `battle:${character.playerId}:${encounterId}`,
      seed,
      arena,
      combatants: [
        {
          id: `hero:${character.playerId}`,
          ownerPlayerId: character.playerId,
          side: "player",
          name: character.nickname,
          level,
          combatStats,
          hp: character.hp,
          maxHp: character.maxHp,
          maxAp: character.maxAp,
          initiative: character.initiative,
          position: playerStart,
          severelyInjured: character.severelyInjured,
          injuries: [...character.injuries]
        },
        ...enemyStarts.map((position, index) => ({
          id: index === 0 ? `wolf:${encounterId}` : `wolf:${encounterId}:${index + 1}`,
          side: "enemy" as const,
          name: "Wolf",
          level,
          combatStats: {
            meleeDamage: wolfDamage,
            rangedDamage: 0,
            armor: wolfArmor
          },
          hp: wolfHp,
          maxHp: wolfHp,
          maxAp: 4,
          initiative: wolfInitiative,
          position,
          severelyInjured: false,
          injuries: []
        }))
      ]
    });

    this.battlesByPlayer.set(character.playerId, {
      encounterId, seed, state, experienceReward: wolfCount * (25 + 15 * level)
    });
    return this.toSnapshot(state);
  }

  hasBattle(playerId: PlayerId): boolean {
    return this.battlesByPlayer.has(playerId);
  }

  getSnapshot(playerId: PlayerId): BattleSnapshot | undefined {
    const active = this.battlesByPlayer.get(playerId);
    return active ? this.toSnapshot(active.state) : undefined;
  }

  applyCommand(playerId: PlayerId, command: BattleCommand): AppliedBattleCommand {
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

    const playerResult = applyBattleCommand(active.state, playerId, command);
    if (!playerResult.ok) {
      return { result: playerResult, finished: false, victory: false };
    }

    active.state = this.runNpcTurns(playerResult.state);
    const result: BattleResult = { ok: true, state: active.state };
    const snapshot = this.toSnapshot(active.state);
    const playerCombatant = Object.values(active.state.combatants).find(
      (combatant) => combatant.ownerPlayerId === playerId
    );
    const victory = active.state.finished && Boolean(playerCombatant && playerCombatant.hp > 0);
    const playerOutcome = active.state.finished && playerCombatant
      ? {
          hp: playerCombatant.hp,
          severelyInjured: playerCombatant.severelyInjured,
          injuries: [...playerCombatant.injuries]
        }
      : undefined;

    return {
      result,
      snapshot,
      finished: active.state.finished,
      victory,
      encounterId: active.encounterId,
      seed: active.seed,
      ...(playerOutcome ? { playerOutcome } : {}),
      ...(victory ? { experienceReward: active.experienceReward } : {})
    };
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
      return { snapshot: this.toSnapshot(staged), inventory, playerOutcome: outcome };
    } finally {
      active.itemUsePending = false;
    }
  }

  removeBattleForPlayer(playerId: PlayerId): void {
    this.battlesByPlayer.delete(playerId);
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

  private toSnapshot(state: BattleState): BattleSnapshot {
    return {
      id: state.id,
      round: state.round,
      activeCombatantId: state.activeCombatantId,
      turnOrder: [...state.turnOrder],
      cells: state.arena.cells.map((cell) => ({ ...cell })),
      blockedCells: state.arena.blockedCells.map((cell) => ({ ...cell })),
      coverCells: state.arena.coverCells.map((cell) => ({ ...cell })),
      combatants: Object.values(state.combatants).map((combatant) => ({
        id: combatant.id,
        side: combatant.side,
        ...(combatant.ownerPlayerId !== undefined
          ? { ownerPlayerId: combatant.ownerPlayerId }
          : {}),
        name: combatant.name,
        ...(combatant.level !== undefined ? { level: combatant.level } : {}),
        ...(combatant.combatStats ? { combatStats: { ...combatant.combatStats } } : {}),
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
