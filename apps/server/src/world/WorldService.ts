import type {
  EncounterSnapshot,
  LocationId,
  PlayerId,
  WorldPlayerSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import {
  ENCOUNTER_ACTIVATION_RADIUS,
  MAX_WORLD_SPEED,
  MEADOW_01
} from "./worldFixtures";

interface WorldPlayerState extends WorldPlayerSnapshot {
  locationId: LocationId;
  lastMoveAt: number;
}

export class WorldService {
  private readonly players = new Map<PlayerId, WorldPlayerState>();

  addPlayer(input: { id: PlayerId; nickname: string }, now = Date.now()): WorldPlayerSnapshot {
    const player: WorldPlayerState = {
      id: input.id,
      nickname: input.nickname,
      x: MEADOW_01.spawn.x,
      y: MEADOW_01.spawn.y,
      locationId: MEADOW_01.id,
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
    const player = this.players.get(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");

    const elapsed = Math.max(0, (now - player.lastMoveAt) / 1000);
    const maxDistance = MAX_WORLD_SPEED * elapsed;
    const dx = intent.x - player.x;
    const dy = intent.y - player.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxDistance && distance > 0 ? maxDistance / distance : 1;

    player.x = Math.min(MEADOW_01.width, Math.max(0, player.x + dx * scale));
    player.y = Math.min(MEADOW_01.height, Math.max(0, player.y + dy * scale));
    player.lastMoveAt = now;

    return this.toSnapshot(player);
  }

  startEncounter(playerId: PlayerId, encounterId: string): EncounterSnapshot {
    const player = this.players.get(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");

    const encounter = MEADOW_01.encounters.find((item) => item.id === encounterId);
    if (!encounter) throw new Error("ENCOUNTER_NOT_FOUND");

    const distance = Math.hypot(encounter.x - player.x, encounter.y - player.y);
    if (distance > ENCOUNTER_ACTIVATION_RADIUS) {
      throw new Error("ENCOUNTER_OUT_OF_RANGE");
    }

    return encounter;
  }

  getPlayer(playerId: PlayerId): WorldPlayerSnapshot | undefined {
    const player = this.players.get(playerId);
    return player ? this.toSnapshot(player) : undefined;
  }

  snapshot(locationId: LocationId = MEADOW_01.id): WorldStateSnapshot {
    return {
      locationId,
      players: [...this.players.values()]
        .filter((player) => player.locationId === locationId)
        .map((player) => this.toSnapshot(player)),
      encounters: locationId === MEADOW_01.id ? [...MEADOW_01.encounters] : []
    };
  }

  private toSnapshot(player: WorldPlayerState): WorldPlayerSnapshot {
    return {
      id: player.id,
      nickname: player.nickname,
      x: player.x,
      y: player.y
    };
  }
}
