import type {
  BattleCommand,
  BattleSnapshot,
  PlayerId
} from "@web-mmorpg/shared";
import { generateArena } from "./arenaGenerator";
import {
  applyBattleCommand,
  createBattleState,
  type BattleResult,
  type BattleState
} from "./BattleEngine";

interface ActiveBattle {
  encounterId: string;
  seed: number;
  state: BattleState;
}

export interface AppliedBattleCommand {
  result: BattleResult;
  snapshot?: BattleSnapshot;
  finished: boolean;
  victory: boolean;
  encounterId?: string;
  seed?: number;
}

export class BattleService {
  private readonly battlesByPlayer = new Map<PlayerId, ActiveBattle>();

  startBattle(playerId: PlayerId, nickname: string, encounterId: string): BattleSnapshot {
    const seed = 12345;
    const arena = generateArena({ radius: 4, obstacleCount: 6, coverCount: 4 }, seed);
    const playerStart = arena.playerStartCells[0];
    const enemyStart = arena.enemyStartCells[0];

    if (!playerStart || !enemyStart) {
      throw new Error("ARENA_START_POSITION_MISSING");
    }

    const state = createBattleState({
      id: `battle:${playerId}:${encounterId}`,
      seed,
      arena,
      combatants: [
        {
          id: `hero:${playerId}`,
          ownerPlayerId: playerId,
          side: "player",
          name: nickname,
          hp: 100,
          maxHp: 100,
          maxAp: 5,
          initiative: 10,
          position: playerStart,
          severelyInjured: false,
          injuries: []
        },
        {
          id: `wolf:${encounterId}`,
          side: "enemy",
          name: "Wolf",
          hp: 60,
          maxHp: 60,
          maxAp: 4,
          initiative: 7,
          position: enemyStart,
          severelyInjured: false,
          injuries: []
        }
      ]
    });

    this.battlesByPlayer.set(playerId, { encounterId, seed, state });
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
    if (!active) {
      return {
        result: { ok: false, code: "BATTLE_NOT_FOUND", message: "No active battle." },
        finished: false,
        victory: false
      };
    }

    const result = applyBattleCommand(active.state, playerId, command);
    if (!result.ok) {
      return { result, finished: false, victory: false };
    }

    active.state = result.state;
    const snapshot = this.toSnapshot(active.state);
    const victory = active.state.finished && Object.values(active.state.combatants).some(
      (combatant) => combatant.side === "player" && combatant.hp > 0
    );

    return {
      result,
      snapshot,
      finished: active.state.finished,
      victory,
      encounterId: active.encounterId,
      seed: active.seed
    };
  }

  removeBattleForPlayer(playerId: PlayerId): void {
    this.battlesByPlayer.delete(playerId);
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
        ownerPlayerId: combatant.ownerPlayerId,
        name: combatant.name,
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
