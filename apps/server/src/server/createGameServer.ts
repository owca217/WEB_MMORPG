import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import { Server } from "socket.io";
import { BattleService } from "../battle/BattleService";
import { InventoryService } from "../inventory/InventoryService";
import { LootService } from "../loot/LootService";
import { SessionStore } from "../session/SessionStore";
import { WorldService } from "../world/WorldService";

export function createGameServer(httpServer: HttpServer) {
  const sessions = new SessionStore();
  const world = new WorldService();
  const inventory = new InventoryService();
  const loot = new LootService();
  const battles = new BattleService();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let playerId: PlayerId | null = null;

    socket.on("login", ({ nickname }, ack) => {
      const result = sessions.login(nickname);
      if (!result.ok) {
        ack(result);
        return;
      }

      playerId = result.playerId;
      const session = sessions.get(result.playerId);
      world.addPlayer({ id: result.playerId, nickname: session?.nickname ?? nickname.trim() });
      socket.join(`location:${result.locationId}`);
      ack(result);
      io.to(`location:${result.locationId}`).emit("worldState", world.snapshot(result.locationId));
    });

    socket.on("moveIntent", (intent) => {
      if (!playerId || battles.hasBattle(playerId)) return;

      try {
        world.movePlayer(playerId, intent);
        io.to("location:meadow-01").emit("worldState", world.snapshot("meadow-01"));
      } catch (error) {
        socket.emit("commandRejected", {
          code: error instanceof Error ? error.message : "MOVE_REJECTED",
          message: "Movement was rejected by the server."
        });
      }
    });

    socket.on("startEncounter", ({ encounterId }) => {
      if (!playerId) return;
      const session = sessions.get(playerId);
      if (!session) return;

      try {
        world.startEncounter(playerId, encounterId);
        const snapshot = battles.startBattle(playerId, session.nickname, encounterId);
        socket.leave(`location:${session.locationId}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        socket.emit("commandRejected", {
          code: error instanceof Error ? error.message : "ENCOUNTER_REJECTED",
          message: "Encounter could not be started."
        });
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

      if (applied.victory && applied.encounterId && applied.seed !== undefined) {
        const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
        inventory.addItems(playerId, reward);
      }

      socket.emit("battleEnded", { inventory: inventory.getSnapshot(playerId) });
      battles.removeBattleForPlayer(playerId);
      socket.join("location:meadow-01");
      io.to("location:meadow-01").emit("worldState", world.snapshot("meadow-01"));
    });

    socket.on("disconnect", () => {
      if (!playerId) return;
      const session = sessions.get(playerId);
      battles.removeBattleForPlayer(playerId);
      world.removePlayer(playerId);
      sessions.remove(playerId);
      if (session) {
        io.to(`location:${session.locationId}`).emit("worldState", world.snapshot(session.locationId));
      }
    });
  });

  return {
    io,
    services: { sessions, world, inventory, loot, battles }
  };
}
