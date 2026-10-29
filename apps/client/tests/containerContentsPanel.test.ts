/* @vitest-environment jsdom */

import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { ContainerContentsPanel } from "../src/ui/ContainerContentsPanel";

function item(instanceId: string, changes: Partial<InventoryItem> = {}): InventoryItem {
  return {
    instanceId, itemId: instanceId, itemDefinitionId: instanceId, name: `Przedmiot ${instanceId}`,
    quantity: 1, category: "material", description: "Opis", rarity: "COMMON", upgradeLevel: 0,
    ...changes
  };
}

function bag(instanceId = "bag", capacity = 8): InventoryItem {
  return item(instanceId, { name: "Szmaciany worek", category: "container", containerCapacity: capacity });
}

function inventory(items: InventoryItem[]): InventorySnapshot {
  return { items, containerSlots: ["bag", null, null, null] };
}

function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Contents button missing: ${selector}`);
  return element;
}

function ids(selector: string, attribute: string): Array<string | null> {
  return [...document.querySelectorAll(selector)].map((element) => element.getAttribute(attribute));
}

beforeEach(() => document.body.replaceChildren());

it("renders eight places, counts a stack once and offers only eligible top-level items", () => {
  const panel = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn() });
  panel.update({
    items: [
      bag(),
      item("wood", { quantity: 37, containerInstanceId: "bag" }),
      item("medicine", { category: "medical", containerInstanceId: "bag" }),
      item("loose", { category: "weapon" }),
      bag("equipped"),
      bag("empty"),
      bag("filled"),
      item("elsewhere", { containerInstanceId: "filled" })
    ],
    containerSlots: ["bag", "equipped", null, null]
  });
  panel.show(0);

  expect(document.querySelector("[data-container-contents-title]")?.textContent).toBe("Szmaciany worek");
  expect(document.querySelector("[data-container-capacity]")?.textContent).toContain("2 / 8");
  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(8);
  expect(document.querySelectorAll("[data-container-empty-cell]")).toHaveLength(6);
  expect(ids("[data-container-remove]", "data-container-remove")).toEqual(["wood", "medicine"]);
  expect(button('[data-container-remove="wood"]').textContent).toContain("×37");
  expect(ids("[data-container-put]", "data-container-put")).toEqual(["loose", "empty"]);
  panel.destroy();
});

it("moves items only after an acknowledgement and uses its returned inventory for the contents", async () => {
  const initial = inventory([bag(), item("wood", { quantity: 37 })]);
  let resolve!: (value: { ok: true; inventory: InventorySnapshot }) => void;
  const onMoveItem = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const onInventoryChanged = vi.fn();
  const panel = new ContainerContentsPanel({ onMoveItem, onInventoryChanged, onChangeContainer: vi.fn() });
  panel.update(initial);
  panel.show(0);
  button('[data-container-put="wood"]').click();

  expect(onMoveItem).toHaveBeenCalledWith("wood", "bag");
  expect(button('[data-container-put="wood"]').disabled).toBe(true);
  expect(button("[data-change-container]").disabled).toBe(true);
  expect(document.querySelectorAll("[data-container-remove]")).toHaveLength(0);
  expect(document.querySelector("[data-container-capacity]")?.textContent).toContain("0 / 8");
  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(initial.items[1]?.containerInstanceId).toBeUndefined();

  const moved = inventory([bag(), item("wood", { quantity: 37, containerInstanceId: "bag" })]);
  resolve({ ok: true, inventory: moved });
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledWith(moved));
  expect(button('[data-container-remove="wood"]').disabled).toBe(false);
  expect(document.querySelector("[data-container-capacity]")?.textContent).toContain("1 / 8");
  expect(document.querySelector("[data-container-contents]")?.classList.contains("is-hidden")).toBe(false);

  onMoveItem.mockResolvedValueOnce({ ok: true, inventory: initial });
  button('[data-container-remove="wood"]').click();
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledTimes(2));
  expect(onMoveItem).toHaveBeenLastCalledWith("wood", null);
  expect(document.querySelectorAll("[data-container-remove]")).toHaveLength(0);
  expect(button('[data-container-put="wood"]').disabled).toBe(false);
  panel.destroy();
});

it("keeps contents on a server rejection or network failure and allows retrying", async () => {
  const onMoveItem = vi.fn()
    .mockResolvedValueOnce({ ok: false, code: "CONTAINER_FULL", message: "Brak wolnego miejsca." })
    .mockRejectedValueOnce(new Error("offline"));
  const onInventoryChanged = vi.fn();
  const panel = new ContainerContentsPanel({ onMoveItem, onInventoryChanged, onChangeContainer: vi.fn() });
  panel.update(inventory([bag(), item("wood", { containerInstanceId: "bag" }), item("loose")]));
  panel.show(0);
  button('[data-container-put="loose"]').click();

  await vi.waitFor(() => expect(document.querySelector("[data-container-contents-feedback]")?.textContent).toContain("Brak wolnego miejsca"));
  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(button('[data-container-put="loose"]').disabled).toBe(false);
  expect(button('[data-container-remove="wood"]').disabled).toBe(false);
  button('[data-container-remove="wood"]').click();
  await vi.waitFor(() => expect(onMoveItem).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(button('[data-container-remove="wood"]').disabled).toBe(false));
  expect(document.querySelector('[data-container-contents-feedback][data-state="error"]')?.textContent).toBeTruthy();
  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(document.querySelector("[data-container-capacity]")?.textContent).toContain("1 / 8");
  panel.destroy();
});

it("disables inserting when all eight places are occupied but allows removing a stack", () => {
  const contained = Array.from({ length: 8 }, (_, index) => item(`child-${index}`, { quantity: 50, containerInstanceId: "bag" }));
  const panel = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn() });
  panel.update(inventory([bag(), ...contained, item("loose")]));
  panel.show(0);

  expect(document.querySelector("[data-container-capacity]")?.textContent).toContain("8 / 8");
  expect(button('[data-container-put="loose"]').disabled).toBe(true);
  expect(button('[data-container-remove="child-0"]').disabled).toBe(false);
  panel.destroy();
});

it("handles missing or invalid assigned containers and opens the chooser for the same slot", () => {
  const onChangeContainer = vi.fn();
  const panel = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer });
  panel.update({ items: [bag()], containerSlots: [null, null, "missing", null] });
  panel.show(2);

  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(0);
  expect(document.querySelectorAll("[data-container-put]")).toHaveLength(0);
  expect(document.querySelector("[data-container-contents-empty]")?.textContent).toBeTruthy();
  button("[data-change-container]").click();
  expect(onChangeContainer).toHaveBeenCalledWith(2);
  expect(document.querySelector("[data-container-contents]")?.classList.contains("is-hidden")).toBe(true);

  panel.update(inventory([bag("bag", 0)]));
  panel.show(0);
  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(0);
  panel.destroy();
});

it("paginates a large container without creating thousands of empty places", () => {
  const children = Array.from({ length: 41 }, (_, index) => item(`child-${index}`, { containerInstanceId: "bag" }));
  const panel = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn() });
  panel.update(inventory([bag("bag", 10000), ...children]));
  panel.show(0);

  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(40);
  expect(document.querySelector('[data-container-remove="child-40"]')).toBeNull();
  expect(button("[data-container-page-prev]").disabled).toBe(true);
  button("[data-container-page-next]").click();
  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(40);
  expect(button('[data-container-remove="child-40"]')).toBeTruthy();
  expect(document.querySelector('[data-container-remove="child-0"]')).toBeNull();
  expect(button("[data-container-page-prev]").disabled).toBe(false);
  panel.update(inventory([bag()]));
  expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(8);
  expect(document.querySelector("[data-container-pagination]")?.hasAttribute("hidden")).toBe(true);
  panel.destroy();
});

it("renders item text safely, falls back on failed images and restores focus when closed", () => {
  const trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  const panel = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn() });
  panel.update(inventory([bag(), item("wood", { name: "<b>Materiał</b>", iconUrl: "/missing.png", containerInstanceId: "bag" })]));
  panel.show(0);

  const wood = button('[data-container-remove="wood"]');
  expect(wood.textContent).toContain("<b>Materiał</b>");
  expect(wood.querySelector("b")).toBeNull();
  wood.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(wood.querySelector("img")).toBeNull();
  expect(wood.querySelector("svg")).not.toBeNull();
  document.querySelector("[data-container-contents]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.activeElement).toBe(trigger);
  expect(document.querySelector("[data-container-contents]")?.classList.contains("is-hidden")).toBe(true);
  panel.destroy();
});

it("ignores a late acknowledgement after destruction", async () => {
  let resolve!: (value: { ok: true; inventory: InventorySnapshot }) => void;
  const onMoveItem = vi.fn(() => new Promise<{ ok: true; inventory: InventorySnapshot }>((done) => { resolve = done; }));
  const onInventoryChanged = vi.fn();
  const panel = new ContainerContentsPanel({ onMoveItem, onInventoryChanged, onChangeContainer: vi.fn() });
  panel.update(inventory([bag(), item("wood")]));
  panel.show(0);
  button('[data-container-put="wood"]').click();
  panel.destroy();
  resolve({ ok: true, inventory: inventory([bag(), item("wood", { containerInstanceId: "bag" })]) });
  await Promise.resolve();
  await Promise.resolve();

  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(document.querySelector("[data-container-contents]")).toBeNull();
});
