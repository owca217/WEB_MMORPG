import { describe, expect, it } from "vitest";
import { PositionPersistenceCoordinator } from "../src/persistence/PositionPersistenceCoordinator";

describe("PositionPersistenceCoordinator", () => {
  it("writes only dirty player positions and clears them after flush", async () => {
    const writes: unknown[] = [];
    const coordinator = new PositionPersistenceCoordinator({
      intervalMs: 2000,
      readPosition: () => ({
        locationId: "forest-settlement-01",
        x: 500,
        y: 400
      }),
      writePosition: async (playerId, state) => {
        writes.push({ playerId, ...state });
      }
    });

    coordinator.markDirty("p1");
    await coordinator.flushDirty();
    await coordinator.flushDirty();

    expect(writes).toHaveLength(1);
  });

  it("keeps a player dirty when movement happens during an in-flight write", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let writes = 0;

    const coordinator = new PositionPersistenceCoordinator({
      intervalMs: 2000,
      readPosition: () => ({
        locationId: "forest-settlement-01",
        x: 500,
        y: 400
      }),
      writePosition: async () => {
        writes += 1;
        if (writes === 1) await blocked;
      }
    });

    coordinator.markDirty("p1");
    const firstFlush = coordinator.flushPlayer("p1");
    coordinator.markDirty("p1");
    release();
    await firstFlush;
    await coordinator.flushDirty();

    expect(writes).toBe(2);
  });
});
