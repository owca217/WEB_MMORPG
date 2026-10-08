import { describe, expect, it } from "vitest";
import type { AccountRole, SessionView } from "./auth";

describe("account session role", () => {
  it("accepts an admin role in the session view", () => {
    const role: AccountRole = "ADMIN";
    const session: SessionView = {
      accountUsername: "operator",
      accountRole: role,
      character: { state: "none" }
    };

    expect(session.accountRole).toBe("ADMIN");
  });
});
