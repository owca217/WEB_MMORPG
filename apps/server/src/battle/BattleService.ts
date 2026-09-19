import { randomUUID } from "node:crypto";
import type {
  BattleCommand,
  BattleSnapshot,
  CharacterSnapshot,
  InjuryKind,
  PlayerId
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
  playerIds: PlayerId[];
}

export interface PlayerBattleOutcome {
  playerId: PlayerId;
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
  playerIds: PlayerId[];
  playerOutcomes?: PlayerBattleOutcome[];
}

export interface BattlePlayerDeparture {
  playerIds: PlayerId[];
  snapshot?: BattleSnapshot;
  finished: boolean;
}

export class BattleService {
  private readonly battlesByPlayer = new Map<PlayerId, ActiveBattle>();

  startBattle(
    character: CharacterSnapshot,
    encounterId: string
  ): BattleSnapshot {
    return this.startPartyBattle([character], encounterId);
  }

  startPartyBattle(
    characters: CharacterSnapshot[],
    encounterId: string
  ): BattleSnapshot {
    if (characters.length === 0) {
      throw new Error("BATTLE_REQUIRES_PLAYER");
    }

    const uniquePlayers = new Set(characters.map((character) => character.playerId));
    if (uniquePlayers.size !== characters.length) {
      throw new Error("BATTLE_DUPLICATE_PLAYER");
    }
    for (const character of characters) {
      if (this.battlesByPlayer.has(character.playerId)) {
        throw new Error("PLAYER_ALREADY_IN_BATTLE");
      }
    }

    const seed = 12345;
    const arena = generateArena(
      { radius: 4, obstacleCount: 6, coverCount: 4 },
      seed
    );

    if (
      arena.playerStartCells.length < characters.length ||
      arena.enemyStartCells.length < characters.length
    ) {
      throw new Error("ARENA_START_POSITION_MISSING");
    }

    const heroes = characters.map((character, index) => ({
      id: `hero:${character.playerId}`,
      ownerPlayerId: character.playerId,
      side: "player" as const,
      name: character.nickname,
      hp: character.hp,
      maxHp: character.maxHp,
      maxAp: character.maxAp,
      initiative: character.initiative,
      position: arena.playerStartCells[index]!,
      severelyInjured: character.severelyInjured,
      injuries: [...character.injuries]
    }));

    const wolves = characters.map((_character, index) => ({
      id: `wolf:${encounterId}:${index + 1}`,
      side: "enemy" as const,
      name: characters.length === 1 ? "Wolf" : `Wolf ${index + 1}`,
      hp: 60,
      maxHp: 60,
      maxAp: 4,
      initiative: 7,
      position: arena.enemyStartCells[index]!,
      severelyInjured: false,
      injuries: []
    }));

    const state = createBattleState({
      id: `battle:${randomUUID()}`,
      seed,
      arena,
      combatants: [...heroes, ...wolves]
    });

    const active: ActiveBattle = {
      encounterId,
      seed,
      state,
      playerIds: characters.map((character) => character.playerId)
    };
    for (const character of characters) {
      this.battlesByPlayer.set(character.playerId, active);
    }

    return this.toSnapshot(state);
  }

  hasBattle(playerId: PlayerId): boolean {
    return this.battlesByPlayer.has(playerId);
  }

  getSnapshot(playerId: PlayerId): BattleSnapshot | undefined {
    const active = this.battlesByPlayer.get(playerId);
    return active ? this.toSnapshot(active.state) : undefined;
  }

  getPlayerIds(playerId: PlayerId): PlayerId[] {
    return [...(this.battlesByPlayer.get(playerId)?.playerIds ?? [])];
  }

  applyCommand(
    playerId: PlayerId,
    command: BattleCommand
  ): AppliedBattleCommand {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) {
      return {
        result: {
          ok: false,
          code: "BATTLE_NOT_FOUND",
          message: "No active battle."
        },
        finished: false,
        victory: false,
        playerIds: []
      };
    }

    const playerResult = applyBattleCommand(active.state, playerId, command);
    if (!playerResult.ok) {
      return {
        result: playerResult,
        finished: false,
        victory: false,
        playerIds: [...active.playerIds]
      };
    }

    active.state = this.runNpcTurns(playerResult.state);
    const result: BattleResult = { ok: true, state: active.state };
    const snapshot = this.toSnapshot(active.state);
    const victory =
      active.state.finished &&
      Object.values(active.state.combatants).some(
        (combatant) => combatant.side === "player" && combatant.hp > 0
      ) &&
      !Object.values(active.state.combatants).some(
        (combatant) => combatant.side === "enemy" && combatant.hp > 0
      );

    const playerOutcomes = active.state.finished
      ? Object.values(active.state.combatants)
          .filter(
            (combatant): combatant is typeof combatant & {
              ownerPlayerId: PlayerId;
            } => combatant.ownerPlayerId !== undefined
          )
          .map((combatant) => ({
            playerId: combatant.ownerPlayerId,
            hp: combatant.hp,
            severelyInjured: combatant.severelyInjured,
            injuries: [...combatant.injuries]
          }))
      : undefined;

    return {
      result,
      snapshot,
      finished: active.state.finished,
      victory,
      encounterId: active.encounterId,
      seed: active.seed,
      playerIds: [...active.playerIds],
      ...(playerOutcomes ? { playerOutcomes } : {})
    };
  }

  finishBattle(playerId: PlayerId): PlayerId[] {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) return [];

    const playerIds = [...active.playerIds];
    for (const targetPlayerId of playerIds) {
      this.battlesByPlayer.delete(targetPlayerId);
    }
    return playerIds;
  }

  removeBattleForPlayer(playerId: PlayerId): BattlePlayerDeparture | undefined {
    const active = this.battlesByPlayer.get(playerId);
    if (!active) return undefined;

    this.battlesByPlayer.delete(playerId);
    active.playerIds = active.playerIds.filter((id) => id !== playerId);

    const combatant = Object.values(active.state.combatants).find(
      (candidate) => candidate.ownerPlayerId === playerId
    );
    if (combatant && combatant.hp > 0) {
      combatant.hp = 0;
      combatant.ap = 0;
    }

    active.state.finished = this.isFinished(active.state);

    if (
      combatant &&
      active.state.activeCombatantId === combatant.id &&
      !active.state.finished
    ) {
      this.advanceFromUnavailableCombatant(active.state, combatant.id);
      active.state = this.runNpcTurns(active.state);
    }

    if (active.playerIds.length === 0) {
      active.state.finished = true;
    }

    return {
      playerIds: [...active.playerIds],
      snapshot:
        active.playerIds.length > 0 ? this.toSnapshot(active.state) : undefined,
      finished: active.state.finished
    };
  }

  private advanceFromUnavailableCombatant(
    state: BattleState,
    unavailableId: string
  ): void {
    const currentIndex = state.turnOrder.indexOf(unavailableId);
    if (currentIndex < 0) return;

    for (let offset = 1; offset <= state.turnOrder.length; offset += 1) {
      const nextIndex = (currentIndex + offset) % state.turnOrder.length;
      const nextId = state.turnOrder[nextIndex]!;
      const candidate = state.combatants[nextId];
      if (!candidate || candidate.hp <= 0) continue;

      if (nextIndex <= currentIndex) state.round += 1;
      state.activeCombatantId = nextId;
      candidate.ap = candidate.maxAp;
      return;
    }
  }

  private isFinished(state: BattleState): boolean {
    const playerAlive = Object.values(state.combatants).some(
      (combatant) => combatant.side === "player" && combatant.hp > 0
    );
    const enemyAlive = Object.values(state.combatants).some(
      (combatant) => combatant.side === "enemy" && combatant.hp > 0
    );
    return !playerAlive || !enemyAlive;
  }

  private runNpcTurns(state: BattleState): BattleState {
    let next = state;

    for (let guard = 0; guard < 64 && !next.finished; guard += 1) {
      const active = next.combatants[next.activeCombatantId];
      if (
        !active ||
        active.ownerPlayerId !== undefined ||
        active.side !== "enemy"
      ) {
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
        ...(combatant.ownerPlayerId !== undefined
          ? { ownerPlayerId: combatant.ownerPlayerId }
          : {}),
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
