import type {
  AppearanceSelection,
  EncounterSnapshot,
  LocationId,
  NpcSnapshot,
  PlayerId,
  WorldPlayerSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { DEFAULT_APPEARANCE } from "@web-mmorpg/shared";
import {
  ENCOUNTER_ACTIVATION_RADIUS,
  FOREST_SETTLEMENT_01,
  MAX_WORLD_SPEED,
  PARTY_BATTLE_VISION_RADIUS
} from "./worldFixtures";

interface WorldPlayerState extends WorldPlayerSnapshot {
  locationId: LocationId;
  lastMoveAt: number;
}

export class WorldService {
  private readonly players = new Map<PlayerId, WorldPlayerState>();

  addPlayer(
    input: {
      id: PlayerId;
      nickname: string;
      appearance?: AppearanceSelection;
      locationId?: LocationId;
      x?: number;
      y?: number;
    },
    now = Date.now()
  ): WorldPlayerSnapshot {
    const player: WorldPlayerState = {
      id: input.id,
      nickname: input.nickname,
      appearance: { ...(input.appearance ?? DEFAULT_APPEARANCE) },
      x: input.x ?? FOREST_SETTLEMENT_01.spawn.x,
      y: input.y ?? FOREST_SETTLEMENT_01.spawn.y,
      locationId: input.locationId ?? FOREST_SETTLEMENT_01.id,
      lastMoveAt: now
    };

    this.players.set(input.id, player);
    return this.toSnapshot(player);
  }

  removePlayer(playerId: PlayerId): void {
    this.players.delete(playerId);
  }

  movePlayer(
    playerId: PlayerId,
    intent: { x: number; y: number },
    now = Date.now()
  ): WorldPlayerSnapshot {
    const player = this.requirePlayer(playerId);
    const elapsed = Math.max(0, (now - player.lastMoveAt) / 1000);
    const maxDistance = MAX_WORLD_SPEED * elapsed;
    const dx = intent.x - player.x;
    const dy = intent.y - player.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxDistance && distance > 0 ? maxDistance / distance : 1;

    player.x = Math.min(
      FOREST_SETTLEMENT_01.width,
      Math.max(0, player.x + dx * scale)
    );
    player.y = Math.min(
      FOREST_SETTLEMENT_01.height,
      Math.max(0, player.y + dy * scale)
    );
    player.lastMoveAt = now;

    return this.toSnapshot(player);
  }

  startEncounter(playerId: PlayerId, encounterId: string): EncounterSnapshot {
    const player = this.requirePlayer(playerId);
    const encounter = FOREST_SETTLEMENT_01.encounters.find((item) => item.id === encounterId);
    if (!encounter) throw new Error("ENCOUNTER_NOT_FOUND");

    const distance = Math.hypot(encounter.x - player.x, encounter.y - player.y);
    if (distance > ENCOUNTER_ACTIVATION_RADIUS) {
      throw new Error("ENCOUNTER_OUT_OF_RANGE");
    }

    return { ...encounter };
  }

  interactNpc(playerId: PlayerId, npcId: string): NpcSnapshot {
    const player = this.requirePlayer(playerId);
    const npc = FOREST_SETTLEMENT_01.npcs.find((item) => item.id === npcId);
    if (!npc) throw new Error("NPC_NOT_FOUND");

    const distance = Math.hypot(npc.x - player.x, npc.y - player.y);
    if (distance > npc.interactionRadius) {
      throw new Error("NPC_OUT_OF_RANGE");
    }

    return { ...npc };
  }

  resetPlayerToSpawn(playerId: PlayerId, now = Date.now()): WorldPlayerSnapshot {
    const player = this.requirePlayer(playerId);
    player.x = FOREST_SETTLEMENT_01.spawn.x;
    player.y = FOREST_SETTLEMENT_01.spawn.y;
    player.lastMoveAt = now;
    return this.toSnapshot(player);
  }

  getPersistenceState(playerId: PlayerId):
    | { locationId: LocationId; x: number; y: number }
    | undefined {
    const player = this.players.get(playerId);
    return player
      ? {
          locationId: player.locationId,
          x: player.x,
          y: player.y
        }
      : undefined;
  }

  getPlayer(playerId: PlayerId): WorldPlayerSnapshot | undefined {
    const player = this.players.get(playerId);
    return player ? this.toSnapshot(player) : undefined;
  }

  isWithinPartyBattleVision(
    leaderPlayerId: PlayerId,
    targetPlayerId: PlayerId,
    radius = PARTY_BATTLE_VISION_RADIUS
  ): boolean {
    const leader = this.players.get(leaderPlayerId);
    const target = this.players.get(targetPlayerId);
    if (!leader || !target || leader.locationId !== target.locationId) {
      return false;
    }

    return Math.hypot(target.x - leader.x, target.y - leader.y) <= radius;
  }

  snapshot(locationId: LocationId = FOREST_SETTLEMENT_01.id): WorldStateSnapshot {
    const isForestSettlement = locationId === FOREST_SETTLEMENT_01.id;

    return {
      locationId,
      players: [...this.players.values()]
        .filter((player) => player.locationId === locationId)
        .map((player) => this.toSnapshot(player)),
      encounters: isForestSettlement
        ? FOREST_SETTLEMENT_01.encounters.map((encounter) => ({ ...encounter }))
        : [],
      npcs: isForestSettlement
        ? FOREST_SETTLEMENT_01.npcs.map((npc) => ({ ...npc }))
        : []
    };
  }

  private requirePlayer(playerId: PlayerId): WorldPlayerState {
    const player = this.players.get(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    return player;
  }

  private toSnapshot(player: WorldPlayerState): WorldPlayerSnapshot {
    return {
      id: player.id,
      nickname: player.nickname,
      appearance: { ...player.appearance },
      x: player.x,
      y: player.y
    };
  }
}
