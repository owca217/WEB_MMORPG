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

it("reserves slot zero and never offers a permanent backpack for replacement or removal",()=>{
  const onSetContainerSlot=vi.fn(),picker=new ContainerPicker({onSetContainerSlot,onInventoryChanged:vi.fn()});
  const backpack={...item("permanent"),permanentContainer:true,containerCapacity:16};
  picker.update({items:[backpack,item("a")],containerSlots:["permanent",null,null,null]});
  picker.show(0);
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(true);
  document.querySelector<HTMLButtonElement>("[data-container-clear]")!.click();
  expect(onSetContainerSlot).not.toHaveBeenCalled();
  picker.show(1);
  expect(document.querySelector('[data-container-instance="permanent"]')).toBeNull();
  expect(choice("a")).not.toBeNull();
  picker.destroy();
});

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
  picker.show(1);

  expect(document.querySelector('[data-container-instance="outer"]')).not.toBeNull();
  expect(document.querySelector('[data-container-instance="nested"]')).toBeNull();
  picker.destroy();
});

it("assigns an ordinary bag directly from the backpack and contains touch events",async()=>{
  const pack={...item("pack"),permanentContainer:true,containerCapacity:16},stored={...item("stored"),containerCapacity:8,containerInstanceId:"pack"};
  const onSetContainerSlot=vi.fn().mockResolvedValue({ok:true,inventory:{items:[pack,item("stored")],containerSlots:["pack","stored",null,null]}});
  const picker=new ContainerPicker({onSetContainerSlot,onInventoryChanged:vi.fn()});
  picker.update({items:[pack,stored,item("unassigned"),{...item("nested"),containerInstanceId:"unassigned"}],containerSlots:["pack",null,null,null]});picker.show(1);
  expect(choice("stored").textContent).toContain("W pojemniku");expect(document.querySelector('[data-container-instance="nested"]')).toBeNull();
  const behind=vi.fn();document.body.addEventListener("pointerup",behind);document.body.addEventListener("touchend",behind);
  choice("stored").dispatchEvent(new Event("pointerup",{bubbles:true}));choice("stored").dispatchEvent(new Event("touchend",{bubbles:true}));expect(behind).not.toHaveBeenCalled();
  choice("stored").click();await vi.waitFor(()=>expect(onSetContainerSlot).toHaveBeenCalledExactlyOnceWith(1,"stored"));
  document.body.removeEventListener("pointerup",behind);document.body.removeEventListener("touchend",behind);picker.destroy();
});

it("closes a successful assignment after its newer server push without restoring the old ACK inventory",async()=>{
  let finish!:(value:{ok:true;inventory:InventorySnapshot})=>void;
  const changed=vi.fn(),onRefresh=vi.fn(),picker=new ContainerPicker({onSetContainerSlot:()=>new Promise(resolve=>{finish=resolve;}),onInventoryChanged:changed,onRefresh});
  const initial:InventorySnapshot={items:[item("a"),item("b")],containerSlots:[null,"a",null,null]};picker.update(initial);picker.show(1);choice("b").click();
  picker.update({items:[item("a"),item("b"),item("new")],containerSlots:[null,"b",null,null]});finish({ok:true,inventory:{...initial,containerSlots:[null,"b",null,null]}});
  await vi.waitFor(()=>expect(document.querySelector('[data-container-picker]')?.classList.contains("is-hidden")).toBe(true));
  expect(changed).not.toHaveBeenCalled();expect(onRefresh).toHaveBeenCalledOnce();picker.show(1);expect(choice("b").textContent).toContain("Założony");expect(choice("new")).toBeTruthy();expect(document.querySelector('[data-container-feedback][data-state="pending"]')).toBeNull();picker.destroy();
});

it("waits for the server before replacing a slot, supports moving equipped containers and clears a slot", async () => {
  const inventory: InventorySnapshot = { items: [item("a"), item("b")], containerSlots: [null, "a", "b", null] };
  let resolve!: (value: { ok: true; inventory: InventorySnapshot }) => void;
  const onSetContainerSlot = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const onInventoryChanged = vi.fn();
  const picker = new ContainerPicker({ onSetContainerSlot, onInventoryChanged });
  picker.update(inventory);
  picker.show(1);

  expect(choice("b").textContent).toContain("Przenieś");
  choice("b").click();
  expect(onSetContainerSlot).toHaveBeenCalledWith(1, "b");
  expect(choice("b").disabled).toBe(true);
  expect(onInventoryChanged).not.toHaveBeenCalled();
  const moved: InventorySnapshot = { ...inventory, containerSlots: [null, "b", null, null] };
  resolve({ ok: true, inventory: moved });
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledWith(moved));
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(true);

  onSetContainerSlot.mockResolvedValueOnce({ ok: true, inventory: { ...moved, containerSlots: [null, null, null, null] } });
  picker.show(1);
  document.querySelector<HTMLButtonElement>("[data-container-clear]")!.click();
  await vi.waitFor(() => expect(onSetContainerSlot).toHaveBeenLastCalledWith(1, null));
  await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledTimes(2));
  picker.destroy();
});

it("keeps the equipped state on rejection and lets the player retry", async () => {
  const onSetContainerSlot = vi.fn().mockResolvedValue({ ok: false, code: "ITEM_NOT_FOUND", message: "Pojemnik jest niedostępny." });
  const onInventoryChanged = vi.fn();
  const picker = new ContainerPicker({ onSetContainerSlot, onInventoryChanged });
  picker.update({ items: [item("a"), item("b")], containerSlots: [null, "a", null, null] });
  picker.show(1);
  choice("b").click();

  await vi.waitFor(() => expect(document.querySelector("[data-container-feedback]")?.textContent).toContain("niedostępny"));
  expect(onInventoryChanged).not.toHaveBeenCalled();
  expect(choice("b").disabled).toBe(false);
  expect(choice("a").textContent).toContain("Założony");
  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  picker.destroy();
});
