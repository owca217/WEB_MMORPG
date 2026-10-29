import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { EncounterRespawnService } from "../src/world/EncounterRespawnService";
import type { WorldService } from "../src/world/WorldService";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("encounter respawn persistence", () => {
  const pool = createPool(databaseUrl);
  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("restores the same shared deadline after recreation and admits the spawn only after expiry", async () => {
    let now = Date.now();
    const originalNow = now;
    const firstWorld = { setEncounterAvailability: vi.fn() } as unknown as WorldService;
    const first = new EncounterRespawnService(pool, firstWorld, () => undefined, () => now);
    await first.ready;
    const lease = first.reserve("forest-boars-01")!;
    await first.finish(lease, true);
    await first.finish(lease, true);
    const saved = await pool.query<{ location_id: string; respawn_at: Date }>(
      "SELECT location_id, respawn_at FROM encounter_respawns WHERE encounter_id=$1",
      ["forest-boars-01"]
    );
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0]!.location_id).toBe("eastern-forest-01");
    expect(saved.rows[0]!.respawn_at.getTime()).toBe(originalNow + 180_000);
    first.dispose();

    now += 60_000;
    const restoredWorld = { setEncounterAvailability: vi.fn() } as unknown as WorldService;
    const restored = new EncounterRespawnService(pool, restoredWorld, () => undefined, () => now);
    await restored.ready;
    expect(restoredWorld.setEncounterAvailability).toHaveBeenCalledWith("forest-boars-01", {
      status: "respawning", respawnAt: originalNow + 180_000
    });
    expect(() => restored.reserve("forest-boars-01")).toThrow("ENCOUNTER_RESPAWNING");
    now = originalNow + 180_000;
    restored.refresh();
    expect(restoredWorld.setEncounterAvailability).toHaveBeenLastCalledWith("forest-boars-01", { status: "alive" });
    expect(restored.reserve("forest-boars-01")).toBeTruthy();
    restored.dispose();
  });
});
