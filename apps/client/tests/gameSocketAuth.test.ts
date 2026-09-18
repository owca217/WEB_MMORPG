import { describe, expect, it } from "vitest";
import { resolveSocketAuth } from "../src/net/GameSocket";

describe("resolveSocketAuth", () => {
  it("requires and forwards the bearer token in persistent account mode", () => {
    expect(resolveSocketAuth("secret-token", true)).toEqual({
      auth: { token: "secret-token" }
    });
    expect(() => resolveSocketAuth(null, true)).toThrow("AUTH_TOKEN_REQUIRED");
  });

  it("keeps legacy socket connections unauthenticated", () => {
    expect(resolveSocketAuth(null, false)).toEqual({});
  });
});
