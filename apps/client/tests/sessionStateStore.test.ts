import { describe, expect, it } from "vitest";
import { SessionStateStore } from "../src/state/SessionStateStore";

describe("SessionStateStore", () => {
  it("stores authenticated login metadata only in memory", () => {
    const store = new SessionStateStore();

    store.setFromLogin({
      ok: true,
      playerId: "player-1",
      locationId: "forest-settlement-01",
      sessionToken: "opaque-session-token",
      role: "ADMIN"
    });

    expect(store.getSnapshot()).toEqual({
      playerId: "player-1",
      sessionToken: "opaque-session-token",
      role: "ADMIN"
    });
  });

  it("clears session metadata on reset", () => {
    const store = new SessionStateStore();
    store.setFromLogin({
      ok: true,
      playerId: "player-1",
      locationId: "forest-settlement-01",
      sessionToken: "opaque-session-token",
      role: "ADMIN"
    });

    store.reset();
    expect(store.getSnapshot()).toBeNull();
  });
});
