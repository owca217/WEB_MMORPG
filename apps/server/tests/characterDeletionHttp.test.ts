import type {
  CharacterLifecycleSummary,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  onceWithTimeout
} from "./helpers/battleTestHelpers";
import {
  startTestApp,
  type TestApp
} from "./helpers/testApp";

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(`HTTP_${response.status}`),
      { status: response.status, body }
    );
  }
  return body as T;
}

describe("character deletion HTTP API", () => {
  it("requires the account password and disconnects the live character", async () => {
    app = await startTestApp();
    await app.register("delete-api-owner");
    const login = await app.login("delete-api-owner");
    await app.createCharacter(login.token, "DeleteApiHero");
    const socket = await app.connectSocket(login.token);

    const ready = onceWithTimeout<WorldStateSnapshot>(
      socket,
      "worldState"
    );
    socket.emit("requestWorldState");
    await ready;

    const wrongPassword = await fetch(
      app.baseUrl + "/api/character/delete-request",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${login.token}`
        },
        body: JSON.stringify({ password: "wrong password" })
      }
    );
    expect(wrongPassword.status).toBe(401);
    expect(socket.connected).toBe(true);

    const disconnected = onceWithTimeout<string>(
      socket,
      "disconnect"
    );
    const deletion = await json<CharacterLifecycleSummary>(
      await fetch(
        app.baseUrl + "/api/character/delete-request",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${login.token}`
          },
          body: JSON.stringify({
            password: "correct horse battery"
          })
        }
      )
    );

    expect(deletion).toMatchObject({
      state: "pendingDeletion",
      nickname: "DeleteApiHero"
    });
    await disconnected;
    expect(socket.connected).toBe(false);

    const cancelled = await json<CharacterLifecycleSummary>(
      await fetch(
        app.baseUrl + "/api/character/delete-cancel",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${login.token}`
          }
        }
      )
    );
    expect(cancelled).toMatchObject({
      state: "active",
      nickname: "DeleteApiHero"
    });
  });
});
