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
  it("keeps the world identity and resources without general character level or XP", () => {
    const hud = worldHud();
    hud.update({ character, inventory: { items: [] } });
    expect(document.querySelector("[data-level]")).toBeNull();
    expect(document.querySelector("[data-experience]")).toBeNull();
    expect(document.querySelector("[data-compact-name]")?.textContent).toBe("Owczy");
    hud.update({ character: { ...character, level: 90, experience: 999999 }, inventory: { items: [] } });
    expect(document.querySelector("[data-compact-name]")?.textContent).toBe("Owczy");
    expect(document.querySelector("[data-hp]")?.textContent).toBe("101/130");hud.destroy();
  });

  it("shows authoritative equipment statistics without automatic growth promises", () => {
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
    expect(document.querySelector("[data-next-growth]")).toBeNull();
    expect(document.querySelector("[data-experience]")).toBeNull();
    panel.destroy();
  });

  it("uses the fixed baseline for legacy snapshots regardless of historical character level", () => {
    const panel = new CharacterPanel();
    const { statistics: _statistics, ...legacyCharacter } = character;
    panel.update({ ...legacyCharacter, level: 100, experience: 495000 });
    expect(document.querySelector("[data-stat='strength']")?.textContent).toBe("0");
    expect(document.querySelector("[data-stat='meleeDamage']")?.textContent).toBe("5");
    expect(document.querySelector("[data-experience]")).toBeNull();
    expect(document.querySelector("[data-next-growth]")).toBeNull();panel.destroy();
  });

  it("shows the active combatant's resources and authoritative combat statistics", () => {
    const hud = new BattleHud({ onUseItem: vi.fn(), onInventoryChanged: vi.fn(), onEndTurn: vi.fn() });
    const combatant: CombatantSnapshot = {
      id: "hero", ownerPlayerId: "hero", name: "Owczy", level: 11,
      hp: 288, maxHp: 400, ap: 4, maxAp: 6, initiative: 15,
      combatStats: { meleeDamage: 40, rangedDamage: 25, armor: 20 },
      position: { q: 0, r: 0 }, injuries: [], severelyInjured: false
    };
    hud.update(combatant, true, { items: [] }, character);

    expect(document.querySelector("[data-level]")).toBeNull();
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

  it("reports specialization XP after victory without a general level-up", () => {
    const hud = worldHud();
    hud.showBattleResult({ outcome: "victory", experienceGained: 80, levelsGained: 1, level: 3 });
    hud.update({ character: { ...character, level: 3 }, inventory: { items: [] } });

    const result = document.querySelector<HTMLElement>("[data-battle-result]");
    expect(result?.hidden).toBe(false);
    expect(result?.getAttribute("role")).toBe("status");
    expect(result?.textContent).toContain("+80 XP");
    expect(result?.textContent).toContain("XP specjalizacji");
    expect(result?.textContent).not.toContain("poziom");
    hud.destroy();
  });
});
