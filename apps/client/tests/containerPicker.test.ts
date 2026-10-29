/* @vitest-environment jsdom */

import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { ContainerPicker } from "../src/ui/ContainerPicker";

function item(instanceId: string, category = "container"): InventoryItem {
  return {
    instanceId, itemId: instanceId, itemDefinitionId: instanceId, name: `Przedmiot ${instanceId}`,
    quantity: 1, category, description: "Opis", rarity: "COMMON", upgradeLevel: 0
  };
}

function choice(instanceId: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-container-instance="${instanceId}"]`);
  if (!button) throw new Error(`Container choice ${instanceId} missing`);
  return button;
}

beforeEach(() => document.body.replaceChildren());

it("lists every owned container even beyond four and leaves other inventory categories out", () => {
  const picker = new ContainerPicker({ onSetContainerSlot: vi.fn(), onInventoryChanged: vi.fn() });
  picker.update({ items: [item("a"), item("b"), item("c"), item("d"), item("e"), item("medicine", "medical"), item("wood", "material")] });
  picker.show(3);

  expect(document.querySelectorAll("[data-container-instance]")).toHaveLength(5);
  expect(document.querySelector("[data-container-picker]")?.textContent).not.toContain("Przedmiot medicine");
  expect(document.querySelector("[data-container-picker]")?.textContent).not.toContain("Przedmiot wood");
  expect(document.querySelector("[data-container-picker-title]")?.textContent).toContain("4");
  picker.destroy();
});

it("excludes containers stored inside another container from slot choices", () => {
  const nested = { ...item("nested"), containerInstanceId: "outer" };
  const picker = new ContainerPicker({ onSetContainerSlot: vi.fn(), onInventoryChanged: vi.fn() });
  picker.update({ items: [item("outer"), nested] });
  picker.show(0);

  expect(document.querySelector('[data-container-instance="outer"]')).not.toBeNull();
  expect(document.querySelector('[data-container-instance="nested"]')).toBeNull();
  picker.destroy();
});

it("waits for the server before replacing a slot, supports moving equipped containers and clears a slot", async () => {
  const inventory: InventorySnapshot = { items: [item("a"), item("b")], containerSlots: ["a", "b", null, null] };
  let resolve!: (value: { ok: true; inventory: InventorySnapshot }) => void;
  const onSetContainerSlot = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const onInventoryChanged = vi.fn();
  const picker = new ContainerPicker({ onSetContainerSlot, onInventoryChanged });
  picker.update(inventory);
  picker.show(0);

  expect(choice("b").textContent).toContain("Przenieś");
  choice("b").click();
  expect(onSetContainerSlot).toHaveBeenCalledWith(0, "b");
  expect(choice("b").disabled).toBe(true);
  expect(onInventoryChanged).not.toHaveBeenCalled();
  const moved: InventorySnapshot = { ...inventory, containerSlots: ["b", null, null, null] };
  resolve({ ok: true, inventory: moved });
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledWith(moved));
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(true);

  onSetContainerSlot.mockResolvedValueOnce({ ok: true, inventory: { ...moved, containerSlots: [null, null, null, null] } });
  picker.show(0);
  document.querySelector<HTMLButtonElement>("[data-container-clear]")!.click();
  await vi.waitFor(() => expect(onSetContainerSlot).toHaveBeenLastCalledWith(0, null));
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledTimes(2));
  picker.destroy();
});

it("keeps the equipped state on rejection and lets the player retry", async () => {
  const onSetContainerSlot = vi.fn().mockResolvedValue({ ok: false, code: "ITEM_NOT_FOUND", message: "Pojemnik jest niedostępny." });
  const onInventoryChanged = vi.fn();
  const picker = new ContainerPicker({ onSetContainerSlot, onInventoryChanged });
  picker.update({ items: [item("a"), item("b")], containerSlots: ["a", null, null, null] });
  picker.show(0);
  choice("b").click();

  await vi.waitFor(() => expect(document.querySelector("[data-container-feedback]")?.textContent).toContain("niedostępny"));
  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(choice("b").disabled).toBe(false);
  expect(choice("a").textContent).toContain("Założony");
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  picker.destroy();
});
