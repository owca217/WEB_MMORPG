import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";

describe("character appearance validation", () => {
  it.each([
    { gender: "unknown" },
    { gender: null },
    { skinId: "unknown-skin" },
    { skinId: null },
    { gender: "female", skinId: "male-scout" },
    { gender: "male", skinId: "female-guard" }
  ])("rejects invalid or mismatched selected appearance %j before persistence", async (appearance) => {
    const pool = { query: async () => { throw new Error("UNEXPECTED_DATABASE_ACCESS"); } } as unknown as Pool;
    const service = new CharacterLifecycleService(pool);
    await expect(service.createCharacter("account", { nickname: "ValidHero", appearance }))
      .rejects.toMatchObject({ code: "INVALID_APPEARANCE", status: 400 });
  });
});
