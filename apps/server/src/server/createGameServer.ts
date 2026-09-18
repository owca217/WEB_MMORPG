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
        inventory: inventory.getSnapshot(targetPlayerId)
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

    const removeRuntimePlayer = (): void => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      battles.removeBattleForPlayer(playerId);
      world.removePlayer(playerId);
      inventory.removePlayer(playerId);
      characters.removePlayer(playerId);

      if (!persistentDeps) {
        sessions.remove(playerId);
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

      const profile = await persistentDeps.characters.getCharacter(accountId);
      if (!profile || profile.id !== lifecycle.characterId) {
        socket.disconnect(true);
        return;
      }

      await persistentDeps.activeConnections.closeAccount(
        accountId,
        "sessionReplaced"
      );

      playerId = profile.id;
      locationId = FOREST_SETTLEMENT_01.id;
      characters.createPlayer(profile.id, profile.nickname, profile.appearance);
      world.addPlayer({
        id: profile.id,
        nickname: profile.nickname,
        appearance: profile.appearance
      });
      socket.join(`location:${locationId}`);

      activeConnection = {
        async close(reason) {
          if (closedByRegistry) return;
          closedByRegistry = true;
          if (reason === "sessionReplaced") {
            socket.emit("sessionReplaced");
          }
          removeRuntimePlayer();
          socket.disconnect(true);
        }
      };
      persistentDeps.activeConnections.attach(accountId, activeConnection);

      emitPlayerState(profile.id);
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

    socket.on("startEncounter", ({ encounterId }) => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      const character = characters.getSnapshot(playerId);
      if (!targetLocation || !character) return;

      try {
        world.startEncounter(playerId, encounterId);
        const snapshot = battles.startBattle(character, encounterId);
        socket.leave(`location:${targetLocation}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", (command) => {
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
      }

      const character = characters.getSnapshot(playerId);
      const targetLocation = currentLocationId();
      if (!character || !targetLocation) return;

      const inventorySnapshot = inventory.getSnapshot(playerId);
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
      if (persistentDeps && accountId && activeConnection) {
        persistentDeps.activeConnections.detach(accountId, activeConnection);
      }

      if (!closedByRegistry) {
        removeRuntimePlayer();
      }
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
      characters
    }
  };
}
