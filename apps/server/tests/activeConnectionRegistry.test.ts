import { describe, expect, it } from "vitest";
import { ActiveConnectionRegistry } from "../src/server/ActiveConnectionRegistry";

describe("ActiveConnectionRegistry", () => {
  it("flushes and closes the previous live connection before replacement", async () => {
    const calls: string[] = [];
    const registry = new ActiveConnectionRegistry();

    registry.attach("account-1", {
      async close(reason) {
        calls.push(`old:flush:${reason}`);
      }
    });

    await registry.closeAccount("account-1", "sessionReplaced");

    expect(calls).toEqual(["old:flush:sessionReplaced"]);
    expect(registry.has("account-1")).toBe(false);
  });
});
