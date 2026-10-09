import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  NpcInteractionPayload,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { Server } from "socket.io";
import { BattleService } from "../battle/BattleService";
import { CharacterService } from "../character/CharacterService";
import { InventoryService } from "../inventory/InventoryService";
import { LootService } from "../loot/LootService";
import { SessionStore } from "../session/SessionStore";
import { WorldService } from "../world/WorldService";

export interface GameServerOptions {
  pool: Pool;
  sessions?: SessionStore;
}

export function createGameServer(
  httpServer: HttpServer,
  options: GameServerOptions
) {
  const sessions = options.sessions ?? new SessionStore();
  const world = new WorldService();
  const inventory = new InventoryService(options.pool);
  const loot = new LootService();
  const battles = new BattleService();
  const characters = new CharacterService();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let playerId: PlayerId | null = null;

    const emitPlayerState = async (targetPlayerId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetPlayerId);
      if (!character) return;
      socket.emit("playerState", {
        character,
        inventory: await inventory.getLegacySessionSnapshot(targetPlayerId)
      });
    };

    const reject = (error: unknown, fallbackCode: string, message: string): void => {
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

    socket.on("login", ({ nickname, adminToken }, ack) => {
      const result = sessions.login(nickname, adminToken);
      if (!result.ok) {
        ack(result);
        return;
      }

      playerId = result.playerId;
      const session = sessions.get(result.playerId);
      const resolvedNickname = session?.nickname ?? nickname.trim();
      characters.createPlayer(result.playerId, resolvedNickname);
      world.addPlayer({ id: result.playerId, nickname: resolvedNickname });
      socket.join(`location:${result.locationId}`);
      ack(result);
      void emitPlayerState(result.playerId).catch((error) =>
        reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
      );
      io.to(`location:${result.locationId}`).emit(
        "worldState",
        world.snapshot(result.locationId)
      );
    });

    socket.on("requestPlayerState", () => {
      if (!playerId) return;
      void emitPlayerState(playerId).catch((error) =>
        reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
      );
    });

    socket.on("requestWorldState", () => {
      if (!playerId) return;
      const session = sessions.get(playerId);
      if (!session) return;
      socket.emit("worldState", world.snapshot(session.locationId));
    });

    socket.on("moveIntent", (intent) => {
      if (!playerId || battles.hasBattle(playerId)) return;
      const session = sessions.get(playerId);
      if (!session) return;

      try {
        world.movePlayer(playerId, intent);
        io.to(`location:${session.locationId}`).emit(
          "worldState",
          world.snapshot(session.locationId)
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
        reject(error, "NPC_INTERACTION_REJECTED", "Nie możesz teraz porozmawiać z tą postacią.");
      }
    });

    socket.on("healAtNpc", ({ npcId }) => {
      if (!playerId) return;

      try {
        const npc = world.interactNpc(playerId, npcId);
        if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");
        characters.healHp(playerId);
        void emitPlayerState(playerId).catch((error) =>
          reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
        );
      } catch (error) {
        reject(error, "HEAL_REJECTED", "Leczenie nie jest teraz dostępne.");
      }
    });

    socket.on("startEncounter", ({ encounterId }) => {
      if (!playerId) return;
      const session = sessions.get(playerId);
      const character = characters.getSnapshot(playerId);
      if (!session || !character) return;

      try {
        world.startEncounter(playerId, encounterId);
        const snapshot = battles.startBattle(character, encounterId);
        socket.leave(`location:${session.locationId}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!playerId) return;

      const currentPlayerId = playerId;
      const applied = battles.applyCommand(currentPlayerId, command);
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
          characters.applyBattleResult(currentPlayerId, applied.playerOutcome);
        }

        if (applied.victory && applied.encounterId && applied.seed !== undefined) {
          const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
          await inventory.addLegacySessionItems(currentPlayerId, reward);
        } else {
          characters.recoverAfterDefeat(currentPlayerId);
          world.resetPlayerToSpawn(currentPlayerId);
        }

        const character = characters.getSnapshot(currentPlayerId);
        const session = sessions.get(currentPlayerId);
        if (!character || !session) return;

        const inventorySnapshot = await inventory.getLegacySessionSnapshot(currentPlayerId);
        await emitPlayerState(currentPlayerId);
        socket.emit("battleEnded", {
          outcome: applied.victory ? "victory" : "defeat",
          inventory: inventorySnapshot,
          character
        });

        battles.removeBattleForPlayer(currentPlayerId);
        socket.join(`location:${session.locationId}`);
        io.to(`location:${session.locationId}`).emit(
          "worldState",
          world.snapshot(session.locationId)
        );
      } catch (error) {
        reject(error, "BATTLE_REWARD_FAILED", "Battle rewards could not be persisted.");
      }
    });

    socket.on("disconnect", () => {
      if (!playerId) return;
      const session = sessions.get(playerId);
      battles.removeBattleForPlayer(playerId);
      world.removePlayer(playerId);
      inventory.removePlayer(playerId);
      characters.removePlayer(playerId);
      sessions.remove(playerId);
      if (session) {
        io.to(`location:${session.locationId}`).emit(
          "worldState",
          world.snapshot(session.locationId)
        );
      }
    });
  });

  return {
    io,
    services: { sessions, world, inventory, loot, battles, characters }
  };
}
