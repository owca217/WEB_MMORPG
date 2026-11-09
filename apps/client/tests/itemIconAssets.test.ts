import { afterEach, expect, it, vi } from "vitest";
import { resolveItemIconUrl } from "../src/ui/itemIconAssets";

afterEach(() => vi.unstubAllEnvs());

it.each(["field-bandage", "minor-healing-potion", "invigorating-tonic"])("resolves bundled %s art under the client base path", (itemId) => {
  vi.stubEnv("BASE_URL", "/WEB_MMORPG/");
  expect(resolveItemIconUrl({ itemId })).toBe(`/WEB_MMORPG/assets/items/${itemId}.png`);
});

it("preserves published illustrations and leaves every other item unmapped", () => {
  expect(resolveItemIconUrl({ itemId: "field-bandage", iconUrl: "https://example.test/custom-bandage.png" }))
    .toBe("https://example.test/custom-bandage.png");
  expect(resolveItemIconUrl({ itemId: "other-bandage" })).toBeUndefined();
  expect(resolveItemIconUrl({ itemId: "permanent-backpack" })).toBeUndefined();
  expect(resolveItemIconUrl({ itemId: "constructor" })).toBeUndefined();
});
