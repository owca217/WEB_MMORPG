import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  LocationId,
  NpcInteractionPayload,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import { Server } from "socket.io";
import type { AuthService } from "../auth/AuthService";
import { BattleService } from "../battle/BattleService";
import { CharacterService } from "../character/CharacterService";
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { InventoryService } from "../inventory/InventoryService";
import { CharacterRepository } from "../persistence/CharacterRepository";
import { PositionPersistenceCoordinator } from "../persistence/PositionPersistenceCoordinator";
import { LootService } from "../loot/LootService";
import { SessionStore } from "../session/SessionStore";
import { FOREST_SETTLEMENT_01 } from "../world/worldFixtures";
import { WorldService } from "../world/WorldService";
import {
  type ActiveConnection,
  ActiveConnectionRegistry
} from "./ActiveConnectionRegistry";

export interface PersistentGameServerDeps {
  authService: AuthService;
  characters: CharacterLifecycleService;
  activeConnections: ActiveConnectionRegistry;
  characterRepository: CharacterRepository;
  positionCheckpointMs?: number;
}

export function createGameServer(
  httpServer: HttpServer,
  persistentDeps?: PersistentGameServerDeps
) {
  const sessions = new SessionStore();
  const world = new WorldService();
  const inventory = new InventoryService();
  const loot = new LootService();
  const battles = new BattleService();
  const characters = new CharacterService();
  const positions = persistentDeps
    ? new PositionPersistenceCoordinator({
        intervalMs: persistentDeps.positionCheckpointMs ?? 2000,
        readPosition: (targetPlayerId) =>
          world.getPersistenceState(targetPlayerId),
        writePosition: async (targetPlayerId, state) => {
          await persistentDeps.characterRepository.updatePosition(
            targetPlayerId,
            state.locationId,
            state.x,
            state.y
          );
        }
      })
    : undefined;
  positions?.start();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  if (persistentDeps) {
    io.use(async (socket, next) => {
      try {
        const token =
          typeof socket.handshake.auth.token === "string"
            ? socket.handshake.auth.token
            : "";
        const auth = await persistentDeps.authService.validateToken(token);
        if (!auth) {
          next(new Error("UNAUTHORIZED"));
          return;
        }

        socket.data.accountId = auth.account.id;
        socket.data.authToken = token;
        next();
      } catch {
        next(new Error("UNAUTHORIZED"));
      }
    });
  }

  io.on("connection", async (socket) => {
    let playerId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let activeConnection: ActiveConnection | null = null;
    let closedByRegistry = false;

    const emitPlayerState = (targetPlayerId: PlayerId): void => {
      const character = characters.getSnapshot(targetPlayerId);
      if (!character) return;
      socket.emit("playerState", {
        character,
        inventory: inventory.getSnapshot(targetPlayerId),
        equipment: { items: [] }
      });
    };

    const reject = (
      error: unknown,
      fallbackCode: string,
      message: string
    ): void => {
      socket.emit("commandRejected", {
        code: error instanceof Error ? error.message : fallbackCode,
        message
      });
    };

    const npcPayload = (npcId: string): NpcInteractionPayload => {
      if (npcId === "guide-boran") {
        return {
          npcId: "guide-boran",
          npcName: "Boran",
          kind: "guide",
          title: "Droga przez las",
          lines: [
            "Wilki kręcą się przy wschodniej ścieżce.",
            "Trzymaj się drogi i nie lekceważ ran."
          ],
          canHeal: false
        };
      }

      return {
        npcId: "healer-ada",
        npcName: "Ada",
        kind: "healer",
        title: "Lecznica Ady",
        lines: [
          "Mogę opatrzyć cię i przywrócić siły.",
          "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."
        ],
        canHeal: true
      };
    };

    const currentLocationId = (): LocationId | null => {
      if (locationId) return locationId;
      if (!playerId) return null;
      return sessions.get(playerId)?.locationId ?? null;
    };

    const removeRuntimePlayer = async (
      flushPosition: boolean
    ): Promise<void> => {
      if (!playerId) return;
      const targetPlayerId = playerId;
      const targetLocation = currentLocationId();

      if (flushPosition) {
        await positions?.flushPlayer(targetPlayerId);
      }

      battles.removeBattleForPlayer(targetPlayerId);
      world.removePlayer(targetPlayerId);
      inventory.removePlayer(targetPlayerId);
      characters.removePlayer(targetPlayerId);

      if (!persistentDeps) {
        sessions.remove(targetPlayerId);
      }

      if (targetLocation) {
        io.to(`location:${targetLocation}`).emit(
          "worldState",
          world.snapshot(targetLocation)
        );
      }
    };

    if (persistentDeps) {
      accountId =
        typeof socket.data.accountId === "string"
          ? socket.data.accountId
          : null;

      if (!accountId) {
        socket.disconnect(true);
        return;
      }

      const lifecycle = await persistentDeps.characters.getLifecycle(
        accountId,
        new Date()
      );
      if (lifecycle.state !== "active") {
        socket.disconnect(true);
        return;
      }

      const persisted =
        await persistentDeps.characterRepository.findByAccountId(accountId);
      if (!persisted || persisted.id !== lifecycle.characterId) {
        socket.disconnect(true);
        return;
      }

      await persistentDeps.activeConnections.closeAccount(
        accountId,
        "sessionReplaced"
      );

      playerId = persisted.id;
      locationId = persisted.locationId;
      characters.hydratePlayer({
        playerId: persisted.id,
        nickname: persisted.nickname,
        appearance: persisted.appearance,
        level: persisted.level,
        hp: persisted.hp,
        maxHp: persisted.maxHp,
        maxAp: persisted.maxAp,
        initiative: persisted.initiative,
        severelyInjured: persisted.severelyInjured,
        injuries: []
      });
      inventory.hydratePlayer(persisted.id, { items: [] });
      world.addPlayer({
        id: persisted.id,
        nickname: persisted.nickname,
        appearance: persisted.appearance,
        locationId: persisted.locationId,
        x: persisted.x,
        y: persisted.y
      });
      socket.join(`location:${locationId}`);

      activeConnection = {
        async close(reason) {
          if (closedByRegistry) return;
          closedByRegistry = true;
          await removeRuntimePlayer(true);
          if (reason === "sessionReplaced") {
            socket.emit("sessionReplaced");
          }
          socket.disconnect(true);
        }
      };
      persistentDeps.activeConnections.attach(accountId, activeConnection);

      emitPlayerState(persisted.id);
      io.to(`location:${locationId}`).emit(
        "worldState",
        world.snapshot(locationId)
      );
    } else {
      socket.on("login", ({ nickname }, ack) => {
        const result = sessions.login(nickname);
        if (!result.ok) {
          ack(result);
          return;
        }

        playerId = result.playerId;
        locationId = result.locationId;
        const session = sessions.get(result.playerId);
        const resolvedNickname = session?.nickname ?? nickname.trim();
        characters.createPlayer(result.playerId, resolvedNickname);
        world.addPlayer({ id: result.playerId, nickname: resolvedNickname });
        socket.join(`location:${result.locationId}`);
        ack(result);
        emitPlayerState(result.playerId);
        io.to(`location:${result.locationId}`).emit(
          "worldState",
          world.snapshot(result.locationId)
        );
      });
    }

    socket.on("requestPlayerState", () => {
      if (!playerId) return;
      emitPlayerState(playerId);
    });

    socket.on("requestWorldState", () => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      if (!targetLocation) return;
      socket.emit("worldState", world.snapshot(targetLocation));
    });

    socket.on("moveIntent", (intent) => {
      if (!playerId || battles.hasBattle(playerId)) return;
      const targetLocation = currentLocationId();
      if (!targetLocation) return;

      try {
        world.movePlayer(playerId, intent);
        positions?.markDirty(playerId);
        io.to(`location:${targetLocation}`).emit(
          "worldState",
          world.snapshot(targetLocation)
        );
      } catch (error) {
        reject(error, "MOVE_REJECTED", "Movement was rejected by the server.");
      }
    });

    socket.on("interactNpc", ({ npcId }) => {
      if (!playerId) return;

      try {
        const npc = world.interactNpc(playerId, npcId);
        socket.emit("npcInteraction", npcPayload(npc.id));
      } catch (error) {
        reject(
          error,
          "NPC_INTERACTION_REJECTED",
          "Nie możesz teraz porozmawiać z tą postacią."
        );
      }
    });

    socket.on("healAtNpc", ({ npcId }) => {
      if (!playerId) return;

      try {
        const npc = world.interactNpc(playerId, npcId);
        if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");
        characters.healHp(playerId);
        emitPlayerState(playerId);
      } catch (error) {
        reject(error, "HEAL_REJECTED", "Leczenie nie jest teraz dostępne.");
      }
    });

    socket.on("startEncounter", async ({ encounterId }) => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      const character = characters.getSnapshot(playerId);
      if (!targetLocation || !character) return;

      try {
        world.startEncounter(playerId, encounterId);
        const snapshot = battles.startBattle(character, encounterId);
        await positions?.flushPlayer(playerId);
        socket.leave(`location:${targetLocation}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!playerId) return;

      const applied = battles.applyCommand(playerId, command);
      if (!applied.result.ok) {
        socket.emit("commandRejected", {
          code: applied.result.code,
          message: applied.result.message
        });
        return;
      }

      if (!applied.snapshot) return;
      socket.emit("battleState", applied.snapshot);

      if (!applied.finished) return;

      if (applied.playerOutcome) {
        characters.applyBattleResult(playerId, applied.playerOutcome);
      }

      if (
        applied.victory
        && applied.encounterId
        && applied.seed !== undefined
      ) {
        const reward = loot.rollEncounterLoot(
          applied.encounterId,
          applied.seed
        );
        inventory.addItems(playerId, reward);
      } else {
        characters.recoverAfterDefeat(playerId);
        world.resetPlayerToSpawn(playerId);
        positions?.markDirty(playerId);
      }

      const character = characters.getSnapshot(playerId);
      const targetLocation = currentLocationId();
      if (!character || !targetLocation) return;

      const inventorySnapshot = inventory.getSnapshot(playerId);
      await positions?.flushPlayer(playerId);
      emitPlayerState(playerId);
      socket.emit("battleEnded", {
        outcome: applied.victory ? "victory" : "defeat",
        inventory: inventorySnapshot,
        character
      });

      battles.removeBattleForPlayer(playerId);
      socket.join(`location:${targetLocation}`);
      io.to(`location:${targetLocation}`).emit(
        "worldState",
        world.snapshot(targetLocation)
      );
    });

    socket.on("disconnect", () => {
      void (async () => {
        if (persistentDeps && accountId && activeConnection) {
          persistentDeps.activeConnections.detach(accountId, activeConnection);
        }

        if (!closedByRegistry) {
          await removeRuntimePlayer(Boolean(persistentDeps));
        }
      })();
    });
  });

  return {
    io,
    services: {
      sessions,
      world,
      inventory,
      loot,
      battles,
      characters,
      positions
    }
  };
}
