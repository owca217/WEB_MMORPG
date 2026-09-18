import type {
  BattleSnapshot,
  PlayerStateSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import type { Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { CharacterRepository } from "../src/persistence/CharacterRepository";
import {
  defaultAppearance,
  startTestApp,
  type TestApp
} from "./helpers/testApp";
import {
  onceWithTimeout,
  winBattle
} from "./helpers/battleTestHelpers";

let app: TestApp | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function sessionResponse(
  baseUrl: string,
  token: string
): Promise<Response> {
  return fetch(baseUrl + "/api/auth/session", {
    headers: {
      authorization: `Bearer ${token}`,
      origin: "https://client.test"
    }
  });
}

async function expectConnectError(baseUrl: string, token: string): Promise<void> {
  const { io } = await import("socket.io-client");
  const socket = io(baseUrl, {
    transports: ["websocket"],
    forceNew: true,
    auth: { token }
  });

  try {
    const error = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for connect_error")),
        1500
      );
      socket.once("connect_error", (caught) => {
        clearTimeout(timer);
        resolve(caught);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        reject(new Error("Invalid token unexpectedly connected."));
      });
    });
    expect(error.message).toBe("UNAUTHORIZED");
  } finally {
    socket.disconnect();
  }
}

describe("persistent account lifecycle end to end", () => {
  it("restores position, battle loot, HP and equipment after reconnect", async () => {
    app = await startTestApp();

    const registration = await app.register("owczy217");
    expect(registration.recoveryCode).toBeTruthy();

    const firstLogin = await app.login("owczy217");
    expect(firstLogin.session.character).toEqual({ state: "none" });

    const character = await app.createCharacter(
      firstLogin.token,
      "Owczy",
      defaultAppearance
    );

    const playableLogin = await app.login("owczy217");
    const socket = await app.connectSocket(playableLogin.token);

    const worldReady = onceWithTimeout<WorldStateSnapshot>(
      socket,
      "worldState"
    );
    socket.emit("requestWorldState");
    await worldReady;

    app.game.services.world.movePlayer(
      character.id,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const startedPromise = onceWithTimeout<BattleSnapshot>(
      socket,
      "battleStarted"
    );
    socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    const ended = await winBattle(socket, started, character.id);

    expect(ended.outcome).toBe("victory");
    expect(
      ended.inventory.items.some((item) => item.itemId === "wolf-pelt")
    ).toBe(true);

    app.game.services.world.movePlayer(
      character.id,
      { x: 900, y: 500 },
      Date.now() + 20_000
    );
    app.game.services.positions?.markDirty(character.id);
    await app.game.services.positions?.flushPlayer(character.id);

    socket.disconnect();

    const secondLogin = await app.login("owczy217");
    const restoredSocket = await app.connectSocket(secondLogin.token);

    const worldPromise = onceWithTimeout<WorldStateSnapshot>(
      restoredSocket,
      "worldState"
    );
    restoredSocket.emit("requestWorldState");
    const world = await worldPromise;
    const me = world.players.find((player) => player.id === character.id);

    expect(me?.x).toBeCloseTo(900, 0);
    expect(me?.y).toBeCloseTo(500, 0);

    const statePromise = onceWithTimeout<PlayerStateSnapshot>(
      restoredSocket,
      "playerState"
    );
    restoredSocket.emit("requestPlayerState");
    const state = await statePromise;

    expect(
      state.inventory.items.some((item) => item.itemId === "wolf-pelt")
    ).toBe(true);
    expect(state.character.hp).toBeGreaterThan(0);
    expect(state.equipment).toEqual({ items: [] });
  });

  it("rejects invalid socket tokens and revokes the old token after a new login", async () => {
    app = await startTestApp();
    await app.register("session-security");
    const first = await app.login("session-security");
    await app.createCharacter(first.token, "SecureHero");
    const playable = await app.login("session-security");
    const firstSocket = await app.connectSocket(playable.token);

    const replaced = onceWithTimeout<void>(
      firstSocket,
      "sessionReplaced"
    );
    const replacement = await app.login("session-security");
    await replaced;

    expect(
      (await sessionResponse(app.baseUrl, playable.token)).status
    ).toBe(401);
    expect(
      (await sessionResponse(app.baseUrl, replacement.token)).status
    ).toBe(200);

    await expectConnectError(app.baseUrl, "not-a-valid-token");
  });

  it("bounds request bodies and does not expose socket CORS to an untrusted origin", async () => {
    app = await startTestApp();

    const oversized = await fetch(app.baseUrl + "/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://client.test"
      },
      body: JSON.stringify({
        username: "oversized",
        password: "x".repeat(20_000),
        passwordConfirmation: "x".repeat(20_000)
      })
    });
    expect(oversized.status).toBe(413);

    const socketHandshake = await fetch(
      app.baseUrl + "/socket.io/?EIO=4&transport=polling&t=security",
      {
        headers: { origin: "https://evil.test" }
      }
    );

    expect(
      socketHandshake.headers.get("access-control-allow-origin")
    ).toBeNull();
  });

  it("rejects duplicate identities and unsupported creator data", async () => {
    app = await startTestApp();
    await app.register("duplicate-owner");

    const duplicateAccount = await fetch(
      app.baseUrl + "/api/auth/register",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://client.test"
        },
        body: JSON.stringify({
          username: "DUPLICATE-OWNER",
          password: "correct horse battery",
          passwordConfirmation: "correct horse battery"
        })
      }
    );
    expect(duplicateAccount.status).toBe(409);

    const firstLogin = await app.login("duplicate-owner");
    await app.createCharacter(firstLogin.token, "GlobalHero");

    await app.register("second-owner");
    const secondLogin = await app.login("second-owner");

    const duplicateNickname = await fetch(
      app.baseUrl + "/api/character",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secondLogin.token}`,
          origin: "https://client.test"
        },
        body: JSON.stringify({
          nickname: "globalhero",
          appearance: defaultAppearance
        })
      }
    );
    expect(duplicateNickname.status).toBe(409);

    const invalidAppearance = await fetch(
      app.baseUrl + "/api/character",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${secondLogin.token}`,
          origin: "https://client.test"
        },
        body: JSON.stringify({
          nickname: "OtherHero",
          appearance: {
            ...defaultAppearance,
            hair: "hacked-hair"
          }
        })
      }
    );
    expect(invalidAppearance.status).toBe(400);
  });

  it("rotates recovery codes, changes the password and revokes old sessions", async () => {
    app = await startTestApp();
    const registration = await app.register("recovery-e2e");
    const login = await app.login("recovery-e2e");

    const recovered = await fetch(app.baseUrl + "/api/auth/recover", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://client.test"
      },
      body: JSON.stringify({
        username: "recovery-e2e",
        recoveryCode: registration.recoveryCode,
        newPassword: "replacement horse battery",
        passwordConfirmation: "replacement horse battery"
      })
    });

    expect(recovered.status).toBe(200);
    const recoveredBody = (await recovered.json()) as {
      recoveryCode: string;
    };
    expect(recoveredBody.recoveryCode).not.toBe(
      registration.recoveryCode
    );

    expect(
      (await sessionResponse(app.baseUrl, login.token)).status
    ).toBe(401);

    const reusedOldCode = await fetch(
      app.baseUrl + "/api/auth/recover",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://client.test"
        },
        body: JSON.stringify({
          username: "recovery-e2e",
          recoveryCode: registration.recoveryCode,
          newPassword: "another replacement password",
          passwordConfirmation: "another replacement password"
        })
      }
    );
    expect(reusedOldCode.status).toBe(401);

    const oldPassword = await fetch(app.baseUrl + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://client.test"
      },
      body: JSON.stringify({
        username: "recovery-e2e",
        password: "correct horse battery"
      })
    });
    expect(oldPassword.status).toBe(401);

    await expect(
      app.login("recovery-e2e", "replacement horse battery")
    ).resolves.toBeTruthy();
  });

  it("ignores client-supplied account ids and binds character creation to the bearer account", async () => {
    app = await startTestApp();

    await app.register("victim-owner");
    await app.register("attacker-owner");
    const attackerLogin = await app.login("attacker-owner");

    const accounts = new AccountRepository(app.pool);
    const characters = new CharacterRepository(app.pool);
    const victim = await accounts.findByNormalizedUsername(
      "victim-owner"
    );
    const attacker = await accounts.findByNormalizedUsername(
      "attacker-owner"
    );
    if (!victim || !attacker) throw new Error("Expected test accounts.");

    const response = await fetch(app.baseUrl + "/api/character", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${attackerLogin.token}`,
        origin: "https://client.test"
      },
      body: JSON.stringify({
        accountId: victim.id,
        nickname: "BoundHero",
        appearance: defaultAppearance
      })
    });

    expect(response.status).toBe(201);
    expect(
      (await characters.findByAccountId(attacker.id))?.nickname
    ).toBe("BoundHero");
    expect(
      await characters.findByAccountId(victim.id)
    ).toBeNull();
  });

});
