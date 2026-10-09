/* @vitest-environment jsdom */

import type { SessionView } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Scene: class {}
  }
}));

import { AuthApiRequestError } from "../src/net/AuthApi";
import { resolveBootDestination } from "../src/scenes/BootScene";
import { SessionStateStore } from "../src/state/SessionStateStore";

function session(character: SessionView["character"]): SessionView {
  return {
    accountUsername: "Owczy",
    accountRole: "PLAYER",
    character
  };
}

describe("Boot authentication flow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("routes an unauthenticated client directly to AuthScene", async () => {
    const store = new SessionStateStore(localStorage);
    const getSession = vi.fn();

    await expect(resolveBootDestination({ getSession }, store)).resolves.toBe("AuthScene");
    expect(getSession).not.toHaveBeenCalled();
  });

  it("resumes a valid token and routes by character lifecycle", async () => {
    const cases = [
      [session({ state: "none" }), "CharacterCreatorScene"],
      [
        session({ state: "active", characterId: "character-1", nickname: "Owczy" }),
        "WorldScene"
      ],
      [
        session({
          state: "pendingDeletion",
          characterId: "character-1",
          nickname: "Owczy",
          deletionEffectiveAt: "2026-10-10T12:00:00.000Z"
        }),
        "AuthScene"
      ]
    ] as const;

    for (const [serverSession, expectedScene] of cases) {
      localStorage.clear();
      localStorage.setItem("web-mmorpg.session-token", "persisted-token");
      const store = new SessionStateStore(localStorage);
      const getSession = vi.fn().mockResolvedValue(serverSession);

      await expect(resolveBootDestination({ getSession }, store)).resolves.toBe(expectedScene);
      expect(getSession).toHaveBeenCalledWith("persisted-token");
      expect(store.getSession()).toEqual(serverSession);
    }
  });

  it("clears an invalid persisted token after a 401 and returns to AuthScene", async () => {
    localStorage.setItem("web-mmorpg.session-token", "expired-token");
    const store = new SessionStateStore(localStorage);
    const getSession = vi
      .fn()
      .mockRejectedValue(new AuthApiRequestError(401, { code: "UNAUTHORIZED", message: "Expired" }));

    await expect(resolveBootDestination({ getSession }, store)).resolves.toBe("AuthScene");
    expect(store.getToken()).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("does not hide non-authentication failures", async () => {
    localStorage.setItem("web-mmorpg.session-token", "persisted-token");
    const store = new SessionStateStore(localStorage);
    const failure = new AuthApiRequestError(503, {
      code: "HTTP_503",
      message: "Service unavailable"
    });
    const getSession = vi.fn().mockRejectedValue(failure);

    await expect(resolveBootDestination({ getSession }, store)).rejects.toBe(failure);
    expect(store.getToken()).toBe("persisted-token");
  });
});
