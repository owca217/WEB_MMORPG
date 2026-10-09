import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  LocationId,
  NpcInteractionPayload,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { Server } from "socket.io";
import type { AuthService } from "../auth/AuthService";
import { BattleService } from "../battle/BattleService";
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { CharacterService } from "../character/CharacterService";
import { InventoryService } from "../inventory/InventoryService";
import { LootService } from "../loot/LootService";
import { WorldService } from "../world/WorldService";
import { ActiveConnectionRegistry } from "./ActiveConnectionRegistry";

export interface GameServerOptions {
  pool: Pool;
  authService: AuthService;
  characterLifecycle: CharacterLifecycleService;
  connections?: ActiveConnectionRegistry;
}

export function createGameServer(
  httpServer: HttpServer,
  options: GameServerOptions
) {
  const world = new WorldService();
  const inventory = new InventoryService(options.pool);
  const loot = new LootService();
  const battles = new BattleService();
  const characters = new CharacterService();
  const connections = options.connections ?? new ActiveConnectionRegistry();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let characterId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let unregisterConnection: (() => void) | null = null;

    const emitPlayerState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      if (!character) return;
      socket.emit("playerState", {
        character,
        inventory: await inventory.getSnapshot(targetCharacterId)
      });
    };

    const reject = (error: unknown, fallbackCode: string, message: string): void => {
      socket.emit("commandRejected", {
        code: error instanceof Error ? error.message : fallbackCode,
        message
      });
    };

    const persistGameplayState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      const player = world.getPlayer(targetCharacterId);
      const currentLocationId = world.getPlayerLocationId(targetCharacterId) ?? locationId;
      if (!character || !player || !currentLocationId) return;

      await options.characterLifecycle.saveGameplayState(targetCharacterId, {
        locationId: currentLocationId,
        x: player.x,
        y: player.y,
        level: character.level,
        hp: character.hp,
        maxHp: character.maxHp,
        maxAp: character.maxAp,
        initiative: character.initiative,
        severelyInjured: character.severelyInjured,
        injuries: character.injuries
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

    socket.on("authenticate", async ({ sessionToken }, ack) => {
      try {
        const validated = await options.authService.validateToken(sessionToken);
        if (!validated) {
          ack({
            ok: false,
            code: "INVALID_SESSION",
            message: "The gameplay session is invalid or expired."
          });
          return;
        }

        const persisted = await options.characterLifecycle.getCharacter(validated.account.id);
        if (!persisted || persisted.deletionEffectiveAt) {
          ack({
            ok: false,
            code: "CHARACTER_REQUIRED",
            message: "An active character is required before entering the world."
          });
          return;
        }

        if (characterId) {
          await persistGameplayState(characterId);
          battles.removeBattleForPlayer(characterId);
          world.removePlayer(characterId);
          characters.removePlayer(characterId);
        }
        unregisterConnection?.();

        accountId = validated.account.id;
        characterId = persisted.id;
        locationId = persisted.locationId;

        connections.closeAccount(accountId, "SESSION_REPLACED", socket.id);
        unregisterConnection = connections.register(accountId, socket.id, (reason) => {
          socket.emit("commandRejected", {
            code: reason,
            message: "This gameplay connection is no longer active."
          });
          socket.disconnect(true);
        });

        characters.hydrate({
          playerId: persisted.id,
          nickname: persisted.nickname,
          level: persisted.level,
          hp: persisted.hp,
          maxHp: persisted.maxHp,
          maxAp: persisted.maxAp,
          initiative: persisted.initiative,
          severelyInjured: persisted.severelyInjured,
          injuries: persisted.injuries
        });
        world.addPlayer({
          id: persisted.id,
          nickname: persisted.nickname,
          locationId: persisted.locationId,
          x: persisted.x,
          y: persisted.y
        });

        socket.join(`location:${persisted.locationId}`);
        ack({
          ok: true,
          characterId: persisted.id,
          locationId: persisted.locationId
        });
        await emitPlayerState(persisted.id);
        io.to(`location:${persisted.locationId}`).emit(
          "worldState",
          world.snapshot(persisted.locationId)
        );
      } catch (error) {
        ack({
          ok: false,
          code: "AUTHENTICATION_FAILED",
          message: "The gameplay session could not be authenticated."
        });
      }
    });

    socket.on("requestPlayerState", () => {
      if (!characterId) return;
      void emitPlayerState(characterId).catch((error) =>
        reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
      );
    });

    socket.on("requestWorldState", () => {
      if (!characterId || !locationId) return;
      socket.emit("worldState", world.snapshot(locationId));
    });

    socket.on("moveIntent", (intent) => {
      if (!characterId || battles.hasBattle(characterId)) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      if (!currentLocationId) return;

      try {
        world.movePlayer(currentCharacterId, intent);
        io.to(`location:${currentLocationId}`).emit(
          "worldState",
          world.snapshot(currentLocationId)
        );
        void persistGameplayState(currentCharacterId).catch((error) =>
          reject(error, "CHARACTER_SAVE_FAILED", "Character position could not be persisted.")
        );
      } catch (error) {
        reject(error, "MOVE_REJECTED", "Movement was rejected by the server.");
      }
    });

    socket.on("interactNpc", ({ npcId }) => {
      if (!characterId) return;

      try {
        const npc = world.interactNpc(characterId, npcId);
        socket.emit("npcInteraction", npcPayload(npc.id));
      } catch (error) {
        reject(error, "NPC_INTERACTION_REJECTED", "Nie możesz teraz porozmawiać z tą postacią.");
      }
    });

    socket.on("healAtNpc", ({ npcId }) => {
      if (!characterId) return;
      const currentCharacterId = characterId;

      try {
        const npc = world.interactNpc(currentCharacterId, npcId);
        if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");
        characters.healHp(currentCharacterId);
        void persistGameplayState(currentCharacterId).catch((error) =>
          reject(error, "CHARACTER_SAVE_FAILED", "Character state could not be persisted.")
        );
        void emitPlayerState(currentCharacterId).catch((error) =>
          reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
        );
      } catch (error) {
        reject(error, "HEAL_REJECTED", "Leczenie nie jest teraz dostępne.");
      }
    });

    socket.on("startEncounter", ({ encounterId }) => {
      if (!characterId) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      const character = characters.getSnapshot(currentCharacterId);
      if (!currentLocationId || !character) return;

      try {
        world.startEncounter(currentCharacterId, encounterId);
        const snapshot = battles.startBattle(character, encounterId);
        socket.leave(`location:${currentLocationId}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!characterId) return;

      const currentCharacterId = characterId;
      const applied = battles.applyCommand(currentCharacterId, command);
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

      try {
        if (applied.playerOutcome) {
          characters.applyBattleResult(currentCharacterId, applied.playerOutcome);
        }

        if (applied.victory && applied.encounterId && applied.seed !== undefined) {
          const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
          await inventory.addItems(currentCharacterId, reward);
        } else {
          characters.recoverAfterDefeat(currentCharacterId);
          world.resetPlayerToSpawn(currentCharacterId);
          locationId = world.getPlayerLocationId(currentCharacterId) ?? locationId;
        }

        await persistGameplayState(currentCharacterId);
        const character = characters.getSnapshot(currentCharacterId);
        const currentLocationId = locationId;
        if (!character || !currentLocationId) return;

        const inventorySnapshot = await inventory.getSnapshot(currentCharacterId);
        await emitPlayerState(currentCharacterId);
        socket.emit("battleEnded", {
          outcome: applied.victory ? "victory" : "defeat",
          inventory: inventorySnapshot,
          character
        });

        battles.removeBattleForPlayer(currentCharacterId);
        socket.join(`location:${currentLocationId}`);
        io.to(`location:${currentLocationId}`).emit(
          "worldState",
          world.snapshot(currentLocationId)
        );
      } catch (error) {
        reject(error, "BATTLE_REWARD_FAILED", "Battle rewards could not be persisted.");
      }
    });

    socket.on("disconnect", () => {
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      unregisterConnection?.();
      unregisterConnection = null;
      accountId = null;
      characterId = null;
      locationId = null;

      if (!currentCharacterId) return;
      void persistGameplayState(currentCharacterId).finally(() => {
        battles.removeBattleForPlayer(currentCharacterId);
        world.removePlayer(currentCharacterId);
        characters.removePlayer(currentCharacterId);
        if (currentLocationId) {
          io.to(`location:${currentLocationId}`).emit(
            "worldState",
            world.snapshot(currentLocationId)
          );
        }
      });
    });
  });

  return {
    io,
    services: { world, inventory, loot, battles, characters, connections }
  };
}
