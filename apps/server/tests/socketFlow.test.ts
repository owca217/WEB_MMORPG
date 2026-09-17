import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { BattleSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { createGameServer } from "../src/server/createGameServer";

let client: Socket | undefined;
let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  client?.disconnect();
  client = undefined;
  await closeServer?.();
  closeServer = undefined;
});

async function startTestServer() {
  const httpServer = createServer();
  const game = createGameServer(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;

  closeServer = async () => {
    await new Promise<void>((resolve) => game.io.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };

  client = createClient(`http://127.0.0.1:${address.port}`, {
    transports: ["websocket"],
    forceNew: true
  });

  await new Promise<void>((resolve, reject) => {
    client!.once("connect", () => resolve());
    client!.once("connect_error", reject);
  });

  return game;
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve) => socket.once(event, resolve));
}

describe("Socket.IO game flow", () => {
  it("logs in, broadcasts world state, starts battle and rejects cheating", async () => {
    const game = await startTestServer();
    const worldPromise = once<WorldStateSnapshot>(client!, "worldState");

    const loginResult = await client!.emitWithAck("login", { nickname: "Owczy" });
    expect(loginResult).toMatchObject({ ok: true, locationId: "meadow-01" });
    if (!loginResult.ok) throw new Error("Login unexpectedly failed");

    const world = await worldPromise;
    expect(world.players.some((player) => player.id === loginResult.playerId)).toBe(true);

    game.services.world.movePlayer(
      loginResult.playerId,
      { x: 1050, y: 450 },
      Date.now() + 10_000
    );

    const battlePromise = once<BattleSnapshot>(client!, "battleStarted");
    client!.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const battle = await battlePromise;

    expect(battle.cells.length).toBeGreaterThan(0);
    expect(battle.activeCombatantId).toBeTruthy();

    const wolf = battle.combatants.find((combatant) => combatant.name === "Wolf");
    expect(wolf).toBeDefined();

    const rejectionPromise = once<{ code: string; message: string }>(
      client!,
      "commandRejected"
    );
    client!.emit("battleCommand", {
      type: "endTurn",
      combatantId: wolf!.id
    });

    const rejection = await rejectionPromise;
    expect(rejection.code).toBe("NOT_OWNER");
  });
});
