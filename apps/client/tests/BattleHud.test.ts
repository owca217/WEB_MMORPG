/* @vitest-environment jsdom */

import type { CharacterSnapshot, CombatantSnapshot, InventoryItem, InventorySnapshot, InventoryUpdateResult } from "@web-mmorpg/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { BattleHud } from "../src/ui/BattleHud";

const hero: CombatantSnapshot = {
  id: "hero", ownerPlayerId: "player", name: "Owczy", level: 11,
  hp: 63, maxHp: 130, ap: 4, maxAp: 6, initiative: 15,
  combatStats: { meleeDamage: 40, rangedDamage: 25, armor: 20 },
  position: { q: 0, r: 0 }, injuries: ["brokenArm", "bleeding"], severelyInjured: false
};

const character: CharacterSnapshot = {
  playerId: "player", nickname: "Owczy", level: 11,
  hp: 130, maxHp: 130, maxAp: 6, initiative: 15, injuries: [], severelyInjured: false,
  statistics: { strength: 30, dexterity: 20, vitality: 40, maxHp: 130, maxAp: 6,
    initiative: 15, meleeDamage: 40, rangedDamage: 25, armor: 20 }
};

function medicine(instanceId = "medicine", changes: Partial<InventoryItem> = {}): InventoryItem {
  return {
    instanceId, itemId: instanceId, itemDefinitionId: instanceId, name: "Mikstura", quantity: 3,
    category: "medical", description: "Lecznicza mikstura", rarity: "COMMON", upgradeLevel: 0,
    consumableEffects: { healHp: 35 }, ...changes
  };
}

function button(selector: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Battle HUD button missing: ${selector}`);
  return element;
}

function useButton(instanceId = "medicine"): HTMLButtonElement {
  return button(`[data-use-item="${instanceId}"]`);
}

function text(selector: string): string | null | undefined {
  return document.querySelector(selector)?.textContent;
}

function handlers(onUseItem: (instanceId: string) => Promise<InventoryUpdateResult> = vi.fn()) {
  return { onEndTurn: vi.fn(), onUseItem, onInventoryChanged: vi.fn() };
}

beforeEach(() => document.body.replaceChildren());

it("shows automatic control and blocks manual actions until the player takes over",()=>{
  const callbacks={...handlers(),onToggleAuto:vi.fn()};
  const hud=new BattleHud(callbacks);hud.update(hero,true,{items:[medicine()]});
  hud.setAutoBattle(true);
  expect(text("[data-auto-status]")).toContain("Auto: włączone");
  expect(button("[data-action='end']").disabled).toBe(true);
  expect(useButton().disabled).toBe(true);
  button("[data-action='auto']").click();
  expect(callbacks.onToggleAuto).toHaveBeenCalledOnce();
  hud.setAutoBattle(true,true);
  button("[data-action='auto']").click();expect(callbacks.onToggleAuto).toHaveBeenCalledOnce();
  hud.setAutoBattle(false);
  expect(button("[data-action='end']").disabled).toBe(false);
  expect(useButton().disabled).toBe(false);hud.destroy();
});

it("keeps the player's battle resources visible during an enemy turn and separates feedback from localized injuries", () => {
  const hud = new BattleHud(handlers());
  hud.update(hero, false, { items: [] }, character);

  expect(text("[data-name]")).toBe("Owczy");
  expect(text("[data-level]")).toBe("11");
  expect(text("[data-hp]")).toBe("63/130");
  expect(text("[data-ap]")).toBe("4/6");
  expect(text("[data-initiative]")).toBe("15");
  expect(text("[data-melee-damage]")).toBe("40");
  expect(text("[data-ranged-damage]")).toBe("25");
  expect(text("[data-armor]")).toBe("20");
  expect(text("[data-stat='strength']")).toBe("30");
  expect(text("[data-stat='dexterity']")).toBe("20");
  expect(text("[data-stat='vitality']")).toBe("40");
  expect(text("[data-injuries]")).toContain("Złamana ręka");
  expect(text("[data-injuries]")).toContain("Krwawienie");
  expect(text("[data-turn-status]")).toContain("przeciwnika");
  expect(button("[data-action='end']").disabled).toBe(true);
  expect(document.querySelector("[data-action='melee'], [data-action='ranged']")).toBeNull();

  hud.setStatus("Cel jest poza zasięgiem.");
  expect(text("[data-battle-feedback]")).toContain("poza zasięgiem");
  expect(text("[data-injuries]")).toContain("Złamana ręka");
  hud.update({ ...hero, hp: 51 }, false, { items: [] }, character);
  expect(text("[data-hp]")).toBe("51/130");
  expect(text("[data-battle-feedback]")).toContain("poza zasięgiem");
  hud.destroy();
});

it("uses consumables from bags only after server acknowledgement and locks all turn actions while pending", async () => {
  let resolve!: (result: InventoryUpdateResult) => void;
  const callbacks = handlers(vi.fn(() => new Promise<InventoryUpdateResult>((done) => { resolve = done; })));
  const hud = new BattleHud(callbacks);
  const initial = { items: [medicine("medicine", { containerInstanceId: "bag" }), medicine("other")] };
  hud.update(hero, true, initial, character);

  expect(text('[data-item-instance-id="medicine"]')).toContain("×3");
  expect(text('[data-item-instance-id="medicine"]')).toContain("+35 HP");
  expect(text('[data-item-instance-id="medicine"]')).toContain("2 AP");
  useButton().click();

  expect(callbacks.onUseItem).toHaveBeenCalledWith("medicine");
  expect(hud.busy).toBe(true);
  expect(useButton().disabled).toBe(true);
  expect(useButton("other").disabled).toBe(true);
  expect(button("[data-action='end']").disabled).toBe(true);
  button("[data-action='end']").click();
  expect(callbacks.onEndTurn).not.toHaveBeenCalled();
  expect(text('[data-item-instance-id="medicine"]')).toContain("×3");
  expect(initial.items[0]?.quantity).toBe(3);
  expect(callbacks.onInventoryChanged).not.toHaveBeenCalled();

  const acknowledged = { items: [medicine("medicine", { quantity: 2, containerInstanceId: "bag" }), medicine("other")] };
  resolve({ ok: true, inventory: acknowledged });
  await vi.waitFor(() => expect(callbacks.onInventoryChanged).toHaveBeenCalledWith(acknowledged));
  expect(hud.busy).toBe(false);
  expect(text('[data-item-instance-id="medicine"]')).toContain("×2");
  expect(button("[data-action='end']").disabled).toBe(false);
  hud.destroy();
});

it.each([
  { name: "enemy turn", owned: false, combatant: hero, item: medicine(), disabled: true },
  { name: "not enough AP", owned: true, combatant: { ...hero, ap: 1 }, item: medicine(), disabled: true },
  { name: "defeated hero", owned: true, combatant: { ...hero, hp: 0 }, item: medicine(), disabled: true },
  { name: "full HP", owned: true, combatant: { ...hero, hp: 130 }, item: medicine(), disabled: true },
  { name: "empty stack", owned: true, combatant: hero, item: medicine("medicine", { quantity: 0 }), disabled: true },
  { name: "no combat effect", owned: true, combatant: hero, item: medicine("medicine", { consumableEffects: {} }), disabled: true },
  { name: "AP restore without net gain", owned: true, combatant: hero, item: medicine("medicine", { consumableEffects: { restoreAp: 2 } }), disabled: true },
  { name: "AP restore with net gain", owned: true, combatant: hero, item: medicine("medicine", { consumableEffects: { restoreAp: 4 } }), disabled: false },
  { name: "healing with enough AP", owned: true, combatant: hero, item: medicine(), disabled: false }
])("gates consumable use for $name", ({ owned, combatant, item, disabled }) => {
  const callbacks = handlers(vi.fn().mockResolvedValue({ ok: false, code: "REJECTED", message: "Odrzucono" }));
  const hud = new BattleHud(callbacks);
  hud.update(combatant, owned, { items: [item] });

  expect(useButton().disabled).toBe(disabled);
  if (disabled) {
    useButton().click();
    expect(callbacks.onUseItem).not.toHaveBeenCalled();
  }
  hud.destroy();
});

it("shows server and transport errors without consuming the item and allows retry", async () => {
  const callbacks = handlers(vi.fn()
    .mockResolvedValueOnce({ ok: false, code: "NOT_YOUR_TURN", message: "Tura już się skończyła." })
    .mockRejectedValueOnce(new Error("offline")));
  const hud = new BattleHud(callbacks);
  hud.update(hero, true, { items: [medicine()] });
  useButton().click();

  await vi.waitFor(() => expect(text('[data-battle-feedback][data-state="error"]')).toContain("Tura już się skończyła"));
  expect(hud.busy).toBe(false);
  expect(useButton().disabled).toBe(false);
  expect(text('[data-item-instance-id="medicine"]')).toContain("×3");
  expect(text("[data-injuries]")).toContain("Krwawienie");
  useButton().click();
  await vi.waitFor(() => expect(callbacks.onUseItem).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(hud.busy).toBe(false));
  expect(text('[data-battle-feedback][data-state="error"]')).toBeTruthy();
  expect(callbacks.onInventoryChanged).not.toHaveBeenCalled();
  expect(text('[data-item-instance-id="medicine"]')).toContain("×3");
  hud.destroy();
});

it("disables end turn when the own unit is missing or defeated and clears stale statistics", () => {
  const callbacks = handlers();
  const hud = new BattleHud(callbacks);
  hud.update(hero, true, { items: [] }, character);
  button("[data-action='end']").click();
  expect(callbacks.onEndTurn).toHaveBeenCalledOnce();

  hud.update({ ...hero, hp: 0 }, true, { items: [] }, character);
  expect(button("[data-action='end']").disabled).toBe(true);
  hud.update(undefined, false, { items: [] });
  expect(text("[data-hp]")).toBe("—");
  expect(text("[data-melee-damage]")).toBe("—");
  expect(button("[data-action='end']").disabled).toBe(true);
  expect(document.querySelector<HTMLElement>("[data-attributes]")?.hidden).toBe(true);
  hud.destroy();
});

it("ignores a late acknowledgement after destruction", async () => {
  let resolve!: (result: InventoryUpdateResult) => void;
  const callbacks = handlers(() => new Promise<InventoryUpdateResult>((done) => { resolve = done; }));
  const hud = new BattleHud(callbacks);
  hud.update(hero, true, { items: [medicine()] });
  useButton().click();
  hud.destroy();
  resolve({ ok: true, inventory: { items: [] } });
  await Promise.resolve();
  await Promise.resolve();

  expect(callbacks.onInventoryChanged).not.toHaveBeenCalled();
  expect(document.querySelector(".battle-hud")).toBeNull();
});
