import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { EncounterRespawnService } from "../src/world/EncounterRespawnService";
import type { WorldService } from "../src/world/WorldService";

const ENCOUNTER = "forest-boars-01";
const LOCATION = "eastern-forest-01";

function setup(initialRows: { location_id: string; encounter_id: string; respawn_at: Date }[] = []) {
  let now = 1_000_000;
  const rows = new Map(initialRows.map(row => [row.encounter_id, { ...row }]));
  let holdWrite: Promise<void> | undefined;
  let failWrite = false;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT")) return { rows: [...rows.values()] };
    if (failWrite) throw new Error("database unavailable");
    await holdWrite;
    rows.set(values![1] as string, {
      location_id: values![0] as string,
      encounter_id: values![1] as string,
      respawn_at: values![2] as Date
    });
    return { rows: [], rowCount: 1 };
  });
  const setEncounterAvailability = vi.fn();
  const changed = vi.fn();
  const world = { setEncounterAvailability } as unknown as WorldService;
  const pool = { query } as unknown as Pool;
  const service = new EncounterRespawnService(pool, world, changed, () => now);
  return {
    service, pool, world, changed, setEncounterAvailability, query, rows,
    setNow: (value: number) => { now = value; },
    holdWrite: (promise: Promise<void>) => { holdWrite = promise; },
    failWrite: (value: boolean) => { failWrite = value; }
  };
}

describe("EncounterRespawnService", () => {
  it("hydrates before admitting encounters and reserves each new spawn exclusively", async () => {
    const test = setup();
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("WORLD_LOADING");
    await test.service.ready;
    expect(test.service.reserve("wolf-pack-01")).toBeUndefined();
    expect(() => test.service.reserve("unknown")).toThrow("ENCOUNTER_NOT_FOUND");
    const lease = test.service.reserve(ENCOUNTER)!;
    expect(lease).toBeTruthy();
    expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "engaged" });
    expect(test.changed).toHaveBeenLastCalledWith(LOCATION);
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_BUSY");
    test.service.release(lease);
    expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "alive" });
    expect(test.service.reserve(ENCOUNTER)).not.toBe(lease);
  });

  it("persists one victory deadline, rejects challengers and respawns exactly once after three minutes", async () => {
    const test = setup();
    await test.service.ready;
    const lease = test.service.reserve(ENCOUNTER)!;
    let complete!: () => void;
    test.holdWrite(new Promise(resolve => { complete = resolve; }));
    const finishing = test.service.finish(lease, true);
    expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "respawning", respawnAt: 1_180_000 });
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_RESPAWNING");
    test.service.release(lease);
    const duplicate = test.service.finish(lease, true);
    expect(test.query.mock.calls.filter(([sql]) => sql.includes("INSERT"))).toHaveLength(1);
    complete();
    await Promise.all([finishing, duplicate]);
    expect(test.rows.get(ENCOUNTER)?.respawn_at.getTime()).toBe(1_180_000);
    await test.service.finish(lease, true);
    expect(test.query.mock.calls.filter(([sql]) => sql.includes("INSERT"))).toHaveLength(1);
    test.setNow(1_179_999); test.service.refresh();
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_RESPAWNING");
    test.setNow(1_180_000); test.service.refresh();
    expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "alive" });
    const count = test.changed.mock.calls.length;
    test.service.refresh();
    expect(test.changed).toHaveBeenCalledTimes(count);
    const next = test.service.reserve(ENCOUNTER)!;
    test.service.release(lease);
    await test.service.finish(lease, false);
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_BUSY");
    test.service.release(next);
  });

  it("restores a deadline in a new service and releases defeats without starting a respawn", async () => {
    const test = setup([{ location_id: LOCATION, encounter_id: ENCOUNTER, respawn_at: new Date(1_120_000) }]);
    await test.service.ready;
    expect(test.setEncounterAvailability).toHaveBeenCalledWith(ENCOUNTER, { status: "respawning", respawnAt: 1_120_000 });
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_RESPAWNING");
    test.setNow(1_120_000); test.service.refresh();
    const lease = test.service.reserve(ENCOUNTER)!;
    await test.service.finish(lease, false);
    expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "alive" });
    expect(test.query.mock.calls.filter(([sql]) => sql.includes("INSERT"))).toHaveLength(0);
  });

  it("retries failed persistence on refresh with backoff and never enables the spawn before its original deadline is durable", async () => {
    const test = setup();
    await test.service.ready;
    const lease = test.service.reserve(ENCOUNTER)!;
    test.failWrite(true);
    await expect(test.service.finish(lease, true)).rejects.toThrow("database unavailable");
    const writes = () => test.query.mock.calls.filter(([sql]) => sql.includes("INSERT")).length;
    test.service.refresh();
    test.setNow(1_004_999); test.service.refresh();
    expect(writes()).toBe(1);
    test.setNow(1_005_000); test.service.refresh();
    await vi.waitFor(() => expect(writes()).toBe(2));
    // Let the background rejection finish before advancing the injected clock.
    await new Promise<void>(resolve => setImmediate(resolve));
    test.setNow(1_005_001); test.service.refresh();
    expect(writes()).toBe(2);
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_RESPAWNING");
    test.service.release(lease);
    test.failWrite(false);
    let complete!: () => void;
    test.holdWrite(new Promise(resolve => { complete = resolve; }));
    test.setNow(1_200_000); test.service.refresh();
    test.service.refresh();
    expect(writes()).toBe(3);
    expect(() => test.service.reserve(ENCOUNTER)).toThrow("ENCOUNTER_RESPAWNING");
    expect(writes()).toBe(3);
    complete();
    await vi.waitFor(() => expect(test.setEncounterAvailability).toHaveBeenLastCalledWith(ENCOUNTER, { status: "alive" }));
    expect(test.rows.get(ENCOUNTER)?.respawn_at.getTime()).toBe(1_180_000);
    const changes = test.changed.mock.calls.length;
    test.service.refresh();
    expect(test.changed).toHaveBeenCalledTimes(changes);
    expect(test.service.reserve(ENCOUNTER)).toBeTruthy();
  });
});
