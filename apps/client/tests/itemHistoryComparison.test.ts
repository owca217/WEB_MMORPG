/* @vitest-environment jsdom */

import type { ItemVersion, ItemVersionSummary } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApi, AdminAuditEntry } from "../src/net/AdminApi";
import { ItemHistoryView } from "../src/ui/admin/ItemHistoryView";

function fullVersion(
  versionNo: number,
  overrides: Partial<ItemVersion> = {}
): ItemVersion {
  return {
    itemId: "review-sword",
    name: versionNo === 3 ? "Miecz v3" : "Miecz v4",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Opis",
    rarity: versionNo === 3 ? "COMMON" : "EPIC",
    itemLevel: 10,
    minimumLevel: 1,
    sellValue: 10,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2,
    soulbound: "NONE",
    unique: false,
    tags: [],
    stats: [
      {
        statCode: "PHYSICAL_DAMAGE",
        modifierType: "flat",
        value: versionNo === 3 ? 20 : 30
      }
    ],
    requirements: [],
    effects: [],
    specialData: {},
    versionNo,
    revision: 1,
    state: "PUBLISHED",
    createdBy: "admin",
    createdAt: `2026-10-09T0${versionNo}:00:00.000Z`,
    ...overrides
  };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("real item history comparison", () => {
  it("derives changed fields from full v3/v4 definitions when audit has no changedFields helper", async () => {
    const versions: ItemVersionSummary[] = [
      { versionNo: 4, revision: 1, state: "PUBLISHED", createdBy: "admin", createdAt: "2026-10-09T04:00:00.000Z" },
      { versionNo: 3, revision: 1, state: "PUBLISHED", createdBy: "admin", createdAt: "2026-10-09T03:00:00.000Z" }
    ];
    const audit: AdminAuditEntry[] = [
      {
        id: "publish-v4",
        actorPlayerId: "admin",
        action: "PUBLISH",
        objectType: "item",
        objectId: "review-sword",
        fromVersion: 3,
        toVersion: 4,
        summary: { revision: 1 },
        createdAt: "2026-10-09T04:00:00.000Z"
      }
    ];
    const api = {
      listVersions: vi.fn(async () => versions),
      getAudit: vi.fn(async () => audit),
      getVersion: vi.fn(async (_itemId: string, versionNo: number) => fullVersion(versionNo)),
      restoreVersion: vi.fn()
    } as unknown as AdminApi;
    const host = document.createElement("div");
    const view = new ItemHistoryView(host, api, "review-sword");

    await view.show();

    expect(api.getVersion).toHaveBeenCalledTimes(2);
    expect(api.getVersion).toHaveBeenCalledWith("review-sword", 3);
    expect(api.getVersion).toHaveBeenCalledWith("review-sword", 4);
    const text = host.textContent ?? "";
    expect(text).toContain("v3 → v4");
    expect(text).toContain("name");
    expect(text).toContain("rarity");
    expect(text).toContain("stats");
  });
});
