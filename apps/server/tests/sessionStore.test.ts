import { afterEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/session/SessionStore";

const originalAdminAccessToken = process.env.ADMIN_ACCESS_TOKEN;

afterEach(() => {
  if (originalAdminAccessToken === undefined) {
    delete process.env.ADMIN_ACCESS_TOKEN;
  } else {
    process.env.ADMIN_ACCESS_TOKEN = originalAdminAccessToken;
  }
});

describe("SessionStore admin authentication", () => {
  it("creates an opaque PLAYER session and resolves it by token", () => {
    delete process.env.ADMIN_ACCESS_TOKEN;
    const store = new SessionStore();

    const result = store.login("Owczy");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful login");

    expect(result.role).toBe("PLAYER");
    expect(result.sessionToken).toMatch(/^[0-9a-f-]{30,}$/i);
    expect(store.getByToken(result.sessionToken)).toMatchObject({
      playerId: result.playerId,
      nickname: "Owczy",
      role: "PLAYER",
      sessionToken: result.sessionToken
    });
  });

  it("grants ADMIN only for an exact non-empty server secret", () => {
    process.env.ADMIN_ACCESS_TOKEN = "correct-secret";
    const store = new SessionStore();

    const admin = store.login("AdminOne", "correct-secret");
    const wrong = store.login("AdminTwo", "wrong-secret");

    expect(admin.ok && admin.role).toBe("ADMIN");
    expect(wrong.ok && wrong.role).toBe("PLAYER");
  });

  it("does not elevate when the configured secret is empty", () => {
    process.env.ADMIN_ACCESS_TOKEN = "";
    const store = new SessionStore();

    const result = store.login("AdminOne", "");
    expect(result.ok && result.role).toBe("PLAYER");
  });

  it("uses unique tokens and removes token lookup with the session", () => {
    const store = new SessionStore();
    const first = store.login("PlayerOne");
    const second = store.login("PlayerTwo");
    if (!first.ok || !second.ok) throw new Error("Expected successful logins");

    expect(first.sessionToken).not.toBe(second.sessionToken);
    store.remove(first.playerId);
    expect(store.getByToken(first.sessionToken)).toBeUndefined();
    expect(store.getByToken(second.sessionToken)?.playerId).toBe(second.playerId);
  });
});
