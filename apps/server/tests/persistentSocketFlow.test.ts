import type { WorldStateSnapshot } from "@web-mmorpg/shared";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
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
