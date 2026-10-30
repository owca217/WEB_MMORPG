/* @vitest-environment jsdom */
import type { CharacterSnapshot, InventoryItem, InventorySnapshot, InventoryUpdateResult } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContainerContentsPanel } from "../src/ui/ContainerContentsPanel";
function item(instanceId: string, changes: Partial<InventoryItem> = {}): InventoryItem { return { instanceId, itemId: instanceId, itemDefinitionId: instanceId, name: `Przedmiot ${instanceId}`, quantity: 1, category: "material", description: "Opis", rarity: "COMMON", upgradeLevel: 0, ...changes }; }
function bag(instanceId = "pack", capacity = 16): InventoryItem { return item(instanceId, { name: instanceId === "pack" ? "Plecak podróżnika" : "Torba", category: "container", containerCapacity: capacity, ...(instanceId === "pack" ? { permanentContainer: true } : {}) }); }
function inventory(items: InventoryItem[]): InventorySnapshot { return { items, containerSlots: ["pack", "bag", null, null] }; }
function button(selector: string): HTMLButtonElement { const value = document.querySelector<HTMLButtonElement>(selector); if (!value)
    throw new Error(`Missing ${selector}`); return value; }
function inspect(id: string): void { button(`[data-container-item="${id}"]`).click(); }
function move(): void { button("[data-container-move]").click(); }
const panels: ContainerContentsPanel[] = [];
function panel(handlers: Partial<ConstructorParameters<typeof ContainerContentsPanel>[0]> = {}): ContainerContentsPanel { const value = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn(), ...handlers }); panels.push(value); return value; }
beforeEach(() => document.body.replaceChildren());
afterEach(() => { panels.splice(0).forEach(value => value.destroy()); vi.restoreAllMocks(); });
it("renders only sixteen backpack cells and opens item actions without removing it", () => {
    const onMoveItem = vi.fn(), value = panel({ onMoveItem });
    value.update(inventory([bag(), item("medicine", { category: "medical", containerInstanceId: "pack", consumableEffects: { healHp: 30 } })]));
    value.show(0);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(16);
    expect(document.querySelector("[data-container-candidates-section]")).toBeNull();
    expect(document.body.textContent).not.toContain("Włóż do pojemnika");
    expect(button("[data-change-container]").hidden).toBe(true);
    inspect("medicine");
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>("[data-container-item-actions]")?.hidden).toBe(false);
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("Do użycia w walce");
    expect(button("[data-container-move]").disabled).toBe(true);
});
it("shows pending items in the header grid and returns when an acknowledged move empties it", async () => {
    const initial = inventory([bag(), bag("bag", 8), item("wood"), item("equipped", { equippedSlot: "mainHand" }), item("contained", { containerInstanceId: "pack" })]);
    let finish!: (result: InventoryUpdateResult) => void;
    const onMoveItem = vi.fn(() => new Promise<InventoryUpdateResult>(resolve => { finish = resolve; })), onInventoryChanged = vi.fn();
    const value = panel({ onMoveItem, onInventoryChanged });
    value.update(initial);
    value.show(0);
    expect(button("[data-container-pending]").textContent).toContain("Oczekujące (1)");
    button("[data-container-pending]").click();
    expect(document.querySelectorAll("[data-container-item]")).toHaveLength(1);
    inspect("wood");
    move();
    expect(onMoveItem).toHaveBeenCalledExactlyOnceWith("wood", "pack");
    expect(button("[data-container-move]").disabled).toBe(true);
    const updated = inventory(initial.items.map(entry => entry.instanceId === "wood" ? { ...entry, containerInstanceId: "pack" } : entry));
    finish({ ok: true, inventory: updated });
    await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledWith(updated));
    expect(button("[data-container-pending]").hidden).toBe(true);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(16);
    expect(button('[data-container-item="wood"]')).toBeTruthy();
});
it("moves stored items only to an explicit equipped bag and retains them on failure", async () => {
    const side = { ...bag("bag", 8), quantity: 5 }, initial = inventory([bag(), side, item("wood", { containerInstanceId: "pack" })]);
    const onMoveItem = vi.fn().mockResolvedValueOnce({ ok: false, code: "CONTAINER_FULL", message: "Brak wolnego miejsca." }).mockResolvedValueOnce({ ok: true, inventory: inventory([bag(), side, item("wood", { containerInstanceId: "bag" })]) });
    const value = panel({ onMoveItem });
    value.update(initial);
    value.show(0);
    inspect("wood");
    expect([...document.querySelector<HTMLSelectElement>("[data-container-move-target]")!.options].map(option => option.value)).toEqual(["bag"]);
    move();
    await vi.waitFor(() => expect(document.querySelector("[data-container-contents-feedback]")?.textContent).toContain("Brak wolnego miejsca"));
    expect(button('[data-container-item="wood"]')).toBeTruthy();
    move();
    await vi.waitFor(() => expect(document.querySelector('[data-container-item="wood"]')).toBeNull());
    expect(onMoveItem.mock.calls).toEqual([["wood", "bag"], ["wood", "bag"]]);
});
it("keeps overflow visible when all bags are full and forbids nonempty bag nesting", () => {
    const full = Array.from({ length: 16 }, (_, index) => item(`child-${index}`, { containerInstanceId: "pack" }));
    const value = panel();
    value.update(inventory([bag(), ...full, item("overflow"), bag("nested", 8), item("inside", { containerInstanceId: "nested" })]));
    value.show(0);
    button("[data-container-pending]").click();
    inspect("overflow");
    expect(button("[data-container-move]").disabled).toBe(true);
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("Brak wolnego miejsca");
    inspect("nested");
    expect(button("[data-container-move]").disabled).toBe(true);
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("zawiera przedmioty");
});
it("equips stored gear with a sibling action without moving it to hidden storage", async () => {
    const sword = item("sword", { category: "weapon", containerInstanceId: "pack", equipment: { slot: "mainHand", weaponFamily: "sword", twoHanded: false, minimumLevel: 1, modifiers: [] } }), equipped = { ...sword, equippedSlot: "mainHand" as const };
    delete equipped.containerInstanceId;
    const onMoveItem = vi.fn(), onEquipItem = vi.fn().mockResolvedValue({ ok: true, inventory: inventory([bag(), equipped]) });
    const value = panel({ onMoveItem, onEquipItem });
    value.update(inventory([bag(), sword]));
    value.show(0);
    const equip = button('[data-container-equip="sword"]');
    expect(equip.closest('[data-container-item]')).toBeNull();
    equip.click();
    await vi.waitFor(() => expect(onEquipItem).toHaveBeenCalledWith(sword));
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector('[data-container-item="sword"]')).toBeNull();
});
it("dismisses stale selection and refreshes rather than applying an ACK after newer state", async () => {
    let finish!: (result: InventoryUpdateResult) => void;
    const onMoveItem = vi.fn(() => new Promise<InventoryUpdateResult>(resolve => { finish = resolve; })), onInventoryChanged = vi.fn(), onRefresh = vi.fn();
    const value = panel({ onMoveItem, onInventoryChanged, onRefresh });
    const initial = inventory([bag(), bag("bag", 8), item("wood", { containerInstanceId: "pack" })]);
    value.update(initial);
    value.show(0);
    inspect("wood");
    move();
    const newer = inventory([bag(), bag("bag", 8), item("fresh", { containerInstanceId: "pack" })]);
    value.update(newer);
    expect(document.querySelector<HTMLElement>("[data-container-item-actions]")?.hidden).toBe(true);
    finish({ ok: true, inventory: initial });
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(onInventoryChanged).not.toHaveBeenCalled();
    expect(button('[data-container-item="fresh"]')).toBeTruthy();
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();
    expect(document.querySelector('[data-container-contents-feedback][data-state="pending"]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-container-item-actions]')?.hidden).toBe(true);
});
it("contains phone pointers, renders safe text, closes the popover by Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const value = panel();
    value.update(inventory([bag(), item("wood", { name: "<b>Drewno</b>", iconUrl: "/missing.png", containerInstanceId: "pack" })]));
    value.show(0);
    inspect("wood");
    const popover = document.querySelector<HTMLElement>("[data-container-item-actions]")!;
    expect(popover.closest(".game-panel")).toBeNull();
    expect(popover.querySelector("b")).toBeNull();
    expect(popover.textContent).toContain("<b>Drewno</b>");
    const listener = vi.fn();
    document.body.addEventListener("pointerup", listener);
    document.body.addEventListener("touchend", listener);
    popover.dispatchEvent(new Event("pointerup", { bubbles: true }));
    popover.dispatchEvent(new Event("touchend", { bubbles: true }));
    expect(listener).not.toHaveBeenCalled();
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(document.activeElement).toBe(button('[data-container-item="wood"]'));
    document.querySelector('[data-container-contents]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    document.body.removeEventListener("pointerup", listener);
    document.body.removeEventListener("touchend", listener);
});
it("paginates large ordinary containers and keeps their change action", () => {
    const onChangeContainer = vi.fn(), value = panel({ onChangeContainer });
    value.update(inventory([bag(), bag("bag", 10000), ...Array.from({ length: 41 }, (_, index) => item(`child-${index}`, { containerInstanceId: "bag" }))]));
    value.show(1);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(40);
    button("[data-container-page-next]").click();
    expect(button('[data-container-item="child-40"]')).toBeTruthy();
    expect(document.querySelector('[data-container-item="child-0"]')).toBeNull();
    button("[data-change-container]").click();
    expect(onChangeContainer).toHaveBeenCalledWith(1);
});
it("ignores pending responses after changing character or destruction", async () => {
    let finish!: (result: InventoryUpdateResult) => void;
    const changed = vi.fn(), value = panel({ onMoveItem: () => new Promise(resolve => { finish = resolve; }), onInventoryChanged: changed });
    const character = (playerId: string): CharacterSnapshot => ({ playerId, nickname: playerId, level: 1, hp: 100, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: [] });
    const initial = inventory([bag(), bag("bag", 8), item("wood", { containerInstanceId: "pack" })]);
    value.update(initial, character("one"));
    value.show(0);
    inspect("wood");
    move();
    value.update(inventory([bag()]), character("two"));
    finish({ ok: true, inventory: initial });
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();
    value.destroy();
});
