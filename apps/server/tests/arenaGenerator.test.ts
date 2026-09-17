import { describe, expect, it } from "vitest";
import { generateArena } from "../src/battle/arenaGenerator";

const profile = { radius: 4, obstacleCount: 6, coverCount: 4 };

describe("arena generation", () => {
  it("returns identical arenas for the same seed", () => {
    expect(generateArena(profile, 12345)).toEqual(generateArena(profile, 12345));
  });

  it("never places blockers or cover inside start zones", () => {
    const arena = generateArena(profile, 99);
    const occupied = new Set(
      [...arena.blockedCells, ...arena.coverCells].map((cell) => `${cell.q},${cell.r}`)
    );

    expect(
      arena.playerStartCells.some((cell) => occupied.has(`${cell.q},${cell.r}`))
    ).toBe(false);
    expect(
      arena.enemyStartCells.some((cell) => occupied.has(`${cell.q},${cell.r}`))
    ).toBe(false);
  });

  it("does not overlap blocking and cover cells", () => {
    const arena = generateArena(profile, 777);
    const blocked = new Set(arena.blockedCells.map((cell) => `${cell.q},${cell.r}`));

    expect(
      arena.coverCells.some((cell) => blocked.has(`${cell.q},${cell.r}`))
    ).toBe(false);
  });
});
