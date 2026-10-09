/* @vitest-environment jsdom */

import type { SessionView } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_TOKEN_STORAGE_KEY,
  SessionStateStore
} from "../src/state/SessionStateStore";

const session: SessionView = {
  accountUsername: "Owczy",
  accountRole: "ADMIN",
  character: { state: "active", characterId: "character-1", nickname: "Owczy" }
};

describe("SessionStateStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists only the opaque token and restores it after a client reload", () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("opaque-session-token", session);

    expect(store.getToken()).toBe("opaque-session-token");
    expect(store.getSession()).toEqual(session);
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("opaque-session-token");

    const reloaded = new SessionStateStore(localStorage);
    expect(reloaded.getToken()).toBe("opaque-session-token");
    expect(reloaded.getSession()).toBeNull();
  });

  it("updates the non-secret in-memory session without replacing the token", () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("opaque-session-token", session);

    const updated: SessionView = {
      ...session,
      character: { state: "none" }
    };
    store.updateSession(updated);

    expect(store.getSession()).toEqual(updated);
    expect(store.getToken()).toBe("opaque-session-token");
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBe("opaque-session-token");
  });

  it("removes persisted authentication on reset", () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("opaque-session-token", session);

    store.reset();

    expect(store.getToken()).toBeNull();
    expect(store.getSession()).toBeNull();
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("never persists passwords or recovery codes", () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("opaque-session-token", session);

    const serializedStorage = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return `${key}:${localStorage.getItem(key)}`;
    }).join("|");

    expect(serializedStorage).toContain("opaque-session-token");
    expect(serializedStorage).not.toContain("super-secret-password");
    expect(serializedStorage).not.toContain("RECOVERY-CODE-123");
  });
});
