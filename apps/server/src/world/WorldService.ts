import type {
  EncounterSnapshot,
  LocationId,
  NpcSnapshot,
  PlayerId,
  WorldPlayerSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import {
  ENCOUNTER_ACTIVATION_RADIUS,
  FOREST_SETTLEMENT_01,
  getWorldFixture,
  MAX_WORLD_SPEED
} from "./worldFixtures";

interface WorldPlayerState extends WorldPlayerSnapshot {
  locationId: LocationId;
  lastMoveAt: number;
}

export class WorldService {
  private readonly players = new Map<PlayerId, WorldPlayerState>();
  private readonly encounterAvailability = new Map<string, { status: "alive" | "engaged" | "respawning"; respawnAt?: number }>();

  setEncounterAvailability(encounterId: string, value: { status: "alive" | "engaged" | "respawning"; respawnAt?: number }): void {
    this.encounterAvailability.set(encounterId, { ...value });
  }

  addPlayer(
    input: {
      id: PlayerId;
      nickname: string;
      appearance?: Record<string, unknown>;
      locationId?: LocationId;
      x?: number;
      y?: number;
    },
    now = Date.now()
  ): WorldPlayerSnapshot {
    const fixture = getWorldFixture(input.locationId ?? FOREST_SETTLEMENT_01.id) ?? FOREST_SETTLEMENT_01;
    const player: WorldPlayerState = {
      id: input.id,
      nickname: input.nickname,
      ...(input.appearance !== undefined ? { appearance: structuredClone(input.appearance) } : {}),
      x: input.x ?? fixture.spawn.x,
      y: input.y ?? fixture.spawn.y,
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
    if (!intent || !Number.isFinite(intent.x) || !Number.isFinite(intent.y)) throw new Error("INVALID_MOVE_INTENT");
    const fixture = getWorldFixture(player.locationId) ?? FOREST_SETTLEMENT_01;
    const elapsed = Math.max(0, (now - player.lastMoveAt) / 1000);
    const maxDistance = MAX_WORLD_SPEED * elapsed;
    const dx = intent.x - player.x;
    const dy = intent.y - player.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > maxDistance && distance > 0 ? maxDistance / distance : 1;

    player.x = Math.min(
      fixture.width,
      Math.max(0, player.x + dx * scale)
    );
    player.y = Math.min(
      fixture.height,
      Math.max(0, player.y + dy * scale)
    );
    player.lastMoveAt = now;

    const portal = fixture.teleports.find(zone => player.x >= zone.x && player.x <= zone.x + zone.width && player.y >= zone.y && player.y <= zone.y + zone.height);
    if (portal) {
      player.locationId = portal.destinationLocationId;
      player.x = portal.destination.x;
      player.y = portal.destination.y;
    }

    return this.toSnapshot(player);
  }

  startEncounter(playerId: PlayerId, encounterId: string): EncounterSnapshot {
    const player = this.requirePlayer(playerId);
    const encounter = getWorldFixture(player.locationId)?.encounters.find((item) => item.id === encounterId);
    if (!encounter) throw new Error("ENCOUNTER_NOT_FOUND");

    const availability = this.encounterAvailability.get(encounterId);
    if (availability?.status === "engaged") throw new Error("ENCOUNTER_BUSY");
    if (availability?.status === "respawning") throw new Error("ENCOUNTER_RESPAWNING");

    const distance = Math.hypot(encounter.x - player.x, encounter.y - player.y);
    if (distance > ENCOUNTER_ACTIVATION_RADIUS) {
      throw new Error("ENCOUNTER_OUT_OF_RANGE");
    }

    return { ...encounter, ...availability };
  }

  interactNpc(playerId: PlayerId, npcId: string): NpcSnapshot {
    const player = this.requirePlayer(playerId);
    const npc = getWorldFixture(player.locationId)?.npcs.find((item) => item.id === npcId);
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
    player.locationId = FOREST_SETTLEMENT_01.id;
    player.lastMoveAt = now;
    return this.toSnapshot(player);
  }

  getPlayer(playerId: PlayerId): WorldPlayerSnapshot | undefined {
    const player = this.players.get(playerId);
    return player ? this.toSnapshot(player) : undefined;
  }

  getPlayerLocationId(playerId: PlayerId): LocationId | undefined {
    return this.players.get(playerId)?.locationId;
  }

  snapshot(locationId: LocationId = FOREST_SETTLEMENT_01.id): WorldStateSnapshot {
    const fixture = getWorldFixture(locationId);

    return {
      locationId,
      players: [...this.players.values()]
        .filter((player) => player.locationId === locationId)
        .map((player) => this.toSnapshot(player)),
      encounters: fixture?.encounters.map(encounter => ({ ...encounter, ...this.encounterAvailability.get(encounter.id) })) ?? [],
      npcs: fixture?.npcs.map(npc => ({ ...npc })) ?? [],
      ...(fixture ? { location: { name: fixture.name, width: fixture.width, height: fixture.height, theme: fixture.theme } } : {}),
      teleports: fixture?.teleports.map(({ destination: _destination, ...zone }) => ({ ...zone })) ?? [],
      serverTime: Date.now()
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
      ...(player.appearance !== undefined ? { appearance: structuredClone(player.appearance) } : {}),
      x: player.x,
      y: player.y
    };
  }
}
