/* @vitest-environment jsdom */

import type { CharacterSnapshot, CombatantSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BattleHud } from "../src/ui/BattleHud";
import { CharacterPanel } from "../src/ui/CharacterPanel";
import { WorldHud } from "../src/ui/WorldHud";

const character: CharacterSnapshot = {
  playerId: "hero", nickname: "Owczy", level: 2, experience: 150,
  statistics: {
    strength: 12, dexterity: 11, vitality: 13, maxHp: 130, maxAp: 5,
    initiative: 10, meleeDamage: 22, rangedDamage: 16, armor: 2
  },
  hp: 101, maxHp: 130, maxAp: 5, initiative: 10,
  severelyInjured: false, injuries: []
};

beforeEach(() => document.body.replaceChildren());
afterEach(() => document.body.replaceChildren());

function worldHud(): WorldHud {
  return new WorldHud({ onInventory: vi.fn(), onCharacter: vi.fn(), onAdmin: vi.fn() });
}

describe("character progression presentation", () => {
  it("shows level-relative XP in the world HUD and updates it after an award", () => {
    const hud = worldHud();
    hud.update({ character, inventory: { items: [] } });

    expect(document.querySelector("[data-level]")?.textContent).toBe("2");
    expect(document.querySelector("[data-experience]")?.textContent).toContain("50 / 200");
    const bar = document.querySelector<HTMLElement>("[role='progressbar']");
    expect(bar?.getAttribute("aria-valuenow")).toBe("25");
    expect(bar?.querySelector<HTMLElement>("span")?.style.width).toBe("25%");

    hud.update({ character: { ...character, level: 3, experience: 300 }, inventory: { items: [] } });
    expect(document.querySelector("[data-level]")?.textContent).toBe("3");
    expect(document.querySelector("[data-experience]")?.textContent).toContain("0 / 300");
    expect(document.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("0");
    hud.destroy();
  });

  it("shows server statistics, combat effects and the next automatic growth", () => {
    const panel = new CharacterPanel();
    panel.update({ ...character, statistics: { ...character.statistics!, meleeDamage: 27, armor: 7 } });
    panel.show();

    expect(document.querySelector("[data-stat='strength']")?.textContent).toBe("12");
    expect(document.querySelector("[data-stat='dexterity']")?.textContent).toBe("11");
    expect(document.querySelector("[data-stat='vitality']")?.textContent).toBe("13");
    expect(document.querySelector("[data-stat='meleeDamage']")?.textContent).toBe("27");
    expect(document.querySelector("[data-stat='rangedDamage']")?.textContent).toBe("16");
    expect(document.querySelector("[data-stat='armor']")?.textContent).toBe("7");
    expect(document.querySelector("[data-stat='hp']")?.textContent).toBe("101/130");
    expect(document.querySelector("[data-stat='maxAp']")?.textContent).toBe("5");
    expect(document.querySelector("[data-stat='initiative']")?.textContent).toBe("10");
    expect(document.querySelector("[data-next-growth]")?.textContent).toContain("+30 HP");
    expect(document.querySelector("[data-next-growth]")?.textContent).toContain("+1 inicjatywy");
    expect(document.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("25");
    panel.destroy();
  });

  it("handles legacy snapshots and the maximum level without promising another level", () => {
    const panel = new CharacterPanel();
    const { statistics: _statistics, ...legacyCharacter } = character;
    panel.update({ ...legacyCharacter, level: 100, experience: 495000 });

    expect(document.querySelector("[data-stat='strength']")?.textContent).toBe("208");
    expect(document.querySelector("[role='progressbar']")?.getAttribute("aria-valuenow")).toBe("100");
    expect(document.querySelector("[data-experience]")?.textContent).toContain("Maksymalny poziom");
    expect(document.querySelector("[data-next-growth]")?.textContent).toContain("maksymalny poziom");
    expect(document.querySelector("[data-next-growth]")?.textContent).not.toContain("101");
    panel.destroy();
  });

  it("shows the active combatant's scaled resources and authoritative combat statistics", () => {
    const hud = new BattleHud({ onUseItem: vi.fn(), onInventoryChanged: vi.fn(), onEndTurn: vi.fn() });
    const combatant: CombatantSnapshot = {
      id: "hero", ownerPlayerId: "hero", name: "Owczy", level: 11,
      hp: 288, maxHp: 400, ap: 4, maxAp: 6, initiative: 15,
      combatStats: { meleeDamage: 40, rangedDamage: 25, armor: 20 },
      position: { q: 0, r: 0 }, injuries: [], severelyInjured: false
    };
    hud.update(combatant, true, { items: [] }, character);

    expect(document.querySelector("[data-level]")?.textContent).toBe("11");
    expect(document.querySelector("[data-hp]")?.textContent).toBe("288/400");
    expect(document.querySelector("[data-ap]")?.textContent).toBe("4/6");
    expect(document.querySelector("[data-melee-damage]")?.textContent).toBe("40");
    expect(document.querySelector("[data-ranged-damage]")?.textContent).toBe("25");
    expect(document.querySelector("[data-armor]")?.textContent).toBe("20");

    hud.update(undefined, false, { items: [] });
    expect(document.querySelector("[data-melee-damage]")?.textContent).toBe("—");
    expect(document.querySelector("[data-action='melee']")).toBeNull();
    expect(document.querySelector<HTMLButtonElement>("[data-action='end']")?.disabled).toBe(true);
    hud.destroy();
  });

  it("keeps victory XP and a level-up visible after returning to the world", () => {
    const hud = worldHud();
    hud.showBattleResult({ outcome: "victory", experienceGained: 80, levelsGained: 1, level: 3 });
    hud.update({ character: { ...character, level: 3 }, inventory: { items: [] } });

    const result = document.querySelector<HTMLElement>("[data-battle-result]");
    expect(result?.hidden).toBe(false);
    expect(result?.getAttribute("role")).toBe("status");
    expect(result?.textContent).toContain("+80 XP");
    expect(result?.textContent).toContain("poziom 3");
    hud.destroy();
  });
});
