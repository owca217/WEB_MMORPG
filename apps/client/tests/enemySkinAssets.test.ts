import type Phaser from "phaser";
import { expect, it, vi } from "vitest";
import { ENEMY_SKIN_ASSETS, getEnemySkinDisplaySize, getEnemySkinTextureKey, preloadEnemySkins, registerEnemySkinFrames } from "../src/characters/enemySkinAssets";

it("loads enemy images once and registers idle silhouettes only for available textures", () => {
  const loaded = new Set([getEnemySkinTextureKey("feral-rat")]);
  const frames = new Map<string, boolean>();
  const add = vi.fn((key: string, ..._args: unknown[]) => frames.set(key, true));
  const image = vi.fn();
  const scene = {
    textures: {
      exists: (key: string) => loaded.has(key),
      get: (key: string) => ({ has: () => frames.has(key), add: (...args: unknown[]) => add(key, ...args) })
    },
    load: { image }
  } as unknown as Phaser.Scene;
  expect(preloadEnemySkins(scene)).toBe(4);
  expect(image.mock.calls.every(([, url]) => url.includes("assets/characters/enemies/") && url.endsWith(".png"))).toBe(true);
  registerEnemySkinFrames(scene);
  registerEnemySkinFrames(scene);
  expect(add).toHaveBeenCalledOnce();
  expect(add.mock.calls[0]?.slice(0, 3)).toEqual([getEnemySkinTextureKey("feral-rat"), "idle", 0]);
});

it("contains full enemy silhouettes inside requested world and battle dimensions", () => {
  for (const asset of ENEMY_SKIN_ASSETS) {
    const size = getEnemySkinDisplaySize(asset, 36, 30);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
    expect(size.width).toBeLessThanOrEqual(36);
    expect(size.height).toBeLessThanOrEqual(30);
    expect(size.width / size.height).toBeCloseTo(asset.frame.width / asset.frame.height);
  }
});
