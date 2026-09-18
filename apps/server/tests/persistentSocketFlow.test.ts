import type {
  BattleSnapshot,
  PlayerStateSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterRepository } from "../src/persistence/CharacterRepository";
import {
  onceWithTimeout as onceBattleEvent,
  winBattle
} from "./helpers/battleTestHelpers";
import { startTestApp, type TestApp } from "./helpers/testApp";

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function onceWithTimeout<T>(
  socket: Socket,
  event: string,
  timeoutMs = 1500
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeoutMs
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe("persistent authenticated socket flow", () => {
  it("hydrates the stable character identity from the bearer session", async () => {
    app = await startTestApp();
    await app.register("socket-owner");
    const firstLogin = await app.login("socket-owner");
    const character = await app.createCharacter(firstLogin.token, "Owczy");
    const secondLogin = await app.login("socket-owner");

    const socket = await app.connectSocket(secondLogin.token);
    const worldPromise = onceWithTimeout<WorldStateSnapshot>(socket, "worldState");
    socket.emit("requestWorldState");
    const world = await worldPromise;

    expect(world.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: character.id,
          nickname: "Owczy"
        })
      ])
    );
  });

  it("restores the last flushed world position on reconnect", async () => {
    app = await startTestApp();
    await app.register("position-owner");
    const initialLogin = await app.login("position-owner");
    const character = await app.createCharacter(initialLogin.token, "Walker");
    const playableLogin = await app.login("position-owner");
    const socket = await app.connectSocket(playableLogin.token);
    const readyWorld = onceWithTimeout<WorldStateSnapshot>(socket, "worldState");
    socket.emit("requestWorldState");
    await readyWorld;

    app.game.services.world.movePlayer(
      character.id,
      { x: 845, y: 612 },
      Date.now() + 10_000
    );
    app.game.services.positions!.markDirty(character.id);
    await app.game.services.positions!.flushPlayer(character.id);
    socket.disconnect();

    const reconnectLogin = await app.login("position-owner");
    const restoredSocket = await app.connectSocket(reconnectLogin.token);
    const worldPromise = onceWithTimeout<WorldStateSnapshot>(
      restoredSocket,
      "worldState"
    );
    restoredSocket.emit("requestWorldState");
    const world = await worldPromise;
    const restored = world.players.find((player) => player.id === character.id);

    expect(restored?.x).toBeCloseTo(845, 0);
    expect(restored?.y).toBeCloseTo(612, 0);
  });

  it("persists healer HP changes across reconnect", async () => {
    app = await startTestApp();
    await app.register("healer-owner");
    const initialLogin = await app.login("healer-owner");
    const character = await app.createCharacter(
      initialLogin.token,
      "HealedHero"
    );
    const playableLogin = await app.login("healer-owner");
    const socket = await app.connectSocket(playableLogin.token);

    const readyWorld = onceWithTimeout<WorldStateSnapshot>(
      socket,
      "worldState"
    );
    socket.emit("requestWorldState");
    await readyWorld;

    const damaged = app.game.services.characters.applyBattleResult(
      character.id,
      {
        hp: 20,
        severelyInjured: false,
        injuries: []
      }
    );
    await new CharacterRepository(app.pool).updateVitals(damaged);

    app.game.services.world.movePlayer(
      character.id,
      { x: 720, y: 535 },
      Date.now() + 10_000
    );

    const healedState = onceWithTimeout<PlayerStateSnapshot>(
      socket,
      "playerState"
    );
    socket.emit("healAtNpc", { npcId: "healer-ada" });
    expect((await healedState).character.hp).toBe(100);

    socket.disconnect();

    const reconnectLogin = await app.login("healer-owner");
    const restoredSocket = await app.connectSocket(
      reconnectLogin.token
    );
    const restoredState = onceWithTimeout<PlayerStateSnapshot>(
      restoredSocket,
      "playerState"
    );
    restoredSocket.emit("requestPlayerState");

    expect((await restoredState).character.hp).toBe(100);
  });

  it("persists battle loot across reconnect", async () => {
    app = await startTestApp();
    await app.register("loot-owner");
    const initialLogin = await app.login("loot-owner");
    const character = await app.createCharacter(
      initialLogin.token,
      "LootHero"
    );
    const playableLogin = await app.login("loot-owner");
    const socket = await app.connectSocket(playableLogin.token);

    const readyWorld = onceWithTimeout<WorldStateSnapshot>(
      socket,
      "worldState"
    );
    socket.emit("requestWorldState");
    await readyWorld;

    app.game.services.world.movePlayer(
      character.id,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const startedPromise = onceBattleEvent<BattleSnapshot>(
      socket,
      "battleStarted"
    );
    socket.emit("startEncounter", {
      encounterId: "wolf-pack-01"
    });
    const started = await startedPromise;
    const ended = await winBattle(
      socket,
      started,
      character.id
    );

    expect(ended.outcome).toBe("victory");
    expect(
      ended.inventory.items.some(
        (item) => item.itemId === "wolf-pelt"
      )
    ).toBe(true);

    socket.disconnect();

    const reconnectLogin = await app.login("loot-owner");
    const restoredSocket = await app.connectSocket(
      reconnectLogin.token
    );
    const restoredState = onceWithTimeout<PlayerStateSnapshot>(
      restoredSocket,
      "playerState",
      2000
    );
    restoredSocket.emit("requestPlayerState");
    const state = await restoredState;

    expect(
      state.inventory.items.some(
        (item) => item.itemId === "wolf-pelt"
      )
    ).toBe(true);
  });

  it("kicks the old live socket when the same account logs in again", async () => {
    app = await startTestApp();
    await app.register("same-account");
    const firstLogin = await app.login("same-account");
    await app.createCharacter(firstLogin.token, "Owczy");
    const playableLogin = await app.login("same-account");
    const firstSocket = await app.connectSocket(playableLogin.token);

    const replaced = onceWithTimeout<void>(firstSocket, "sessionReplaced");
    await app.login("same-account");

    await replaced;
    expect(firstSocket.connected).toBe(false);
  });
});
