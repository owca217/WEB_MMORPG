import { describe, expect, it } from "vitest";
import * as shared from "./index";
import type { InventoryItem, ItemQuality } from "./index";

const weapon = (quality: ItemQuality = "EXCELLENT"): InventoryItem => ({
  instanceId: "weapon-1", itemId: "sword", itemDefinitionId: "definition-1", name: "Miecz", quantity: 1,
  category: "weapon", description: "", rarity: "COMMON", quality, upgradeLevel: 0,
  equipment: { slot: "mainHand", weaponFamily: "sword", twoHanded: false, minimumLevel: 1, modifiers: [] }
});

describe("weapon injury upgrades", () => {
  it.each([
    ["EXCELLENT", "brokenArm", 12, 2],
    ["PERFECT", "legTrauma", 8, 3],
    ["MASTERWORK", "bleeding", 7, 4],
    ["MASTERWORK", "eyeInjury", 7, 5],
    ["MASTERWORK", "concussion", 6, "battle"]
  ] as const)("uses the approved duration for %s %s at %s percent", (quality, kind, chance, expected) => {
    expect(shared.calculateWeaponInjuryDuration(quality, kind, chance)).toBe(expected);
  });

  it("bounds all 99 parameter combinations and reserves permanent battle duration for the approved cases", () => {
    for (const quality of ["EXCELLENT", "PERFECT", "MASTERWORK"] as const) {
      for (const kind of ["concussion", "bleeding", "brokenArm"] as const) {
        const durations: number[] = [];
        for (let chance = 5; chance <= 15; chance++) {
          const duration = shared.calculateWeaponInjuryDuration(quality, kind, chance);
          const entireBattle = quality === "MASTERWORK" && kind === "concussion" && chance <= 6;
          expect(duration === "battle").toBe(entireBattle);
          if (duration !== "battle") expect([2, 3, 4, 5]).toContain(duration);
          durations.push(duration === "battle" ? Infinity : duration);
        }
        expect(durations.every((duration, index) => index === 0 || duration <= durations[index - 1]!)).toBe(true);
      }
    }
  });

  it("rejects unsupported qualities, unknown injuries and invalid chance values", () => {
    for (const quality of ["BASIC", "NORMAL", "GOOD"] as const) {
      expect(() => shared.calculateWeaponInjuryDuration(quality, "bleeding", 8)).toThrow();
    }
    for (const chance of [4, 16, 7.5, NaN, Infinity]) {
      expect(() => shared.calculateWeaponInjuryDuration("EXCELLENT", "bleeding", chance)).toThrow();
    }
    expect(() => shared.calculateWeaponInjuryDuration("EXCELLENT", "unknown" as shared.InjuryKind, 8)).toThrow();
  });

  it("rolls only kind and inclusive chance then derives the duration", () => {
    const draws = [0, 0];
    expect(shared.rollWeaponInjuryUpgrade("EXCELLENT", () => draws.shift()!)).toEqual({
      kind: "brokenArm", chancePercent: 5, duration: 4
    });
    const last = shared.rollWeaponInjuryUpgrade("MASTERWORK", () => 1 - Number.EPSILON);
    expect(last.chancePercent).toBe(15);
    expect(last.duration).toBe(shared.calculateWeaponInjuryDuration("MASTERWORK", last.kind, 15));
    expect(() => shared.rollWeaponInjuryUpgrade("NORMAL")).toThrow();
    expect(() => shared.rollWeaponInjuryUpgrade("EXCELLENT", () => 1)).toThrow();
  });

  it("accepts only one valid rolled effect shape", () => {
    expect(shared.isWeaponInjuryUpgrade({ kind: "bleeding", chancePercent: 8, duration: 3 })).toBe(true);
    expect(shared.isWeaponInjuryUpgrade({ kind: "concussion", chancePercent: 5, duration: "battle" })).toBe(true);
    for (const value of [null, [], {}, { kind: "unknown", chancePercent: 8, duration: 3 },
      { kind: "bleeding", chancePercent: 100, duration: 3 }, { kind: "bleeding", chancePercent: 8, duration: 0 }]) {
      expect(shared.isWeaponInjuryUpgrade(value)).toBe(false);
    }
  });

  it("gates by owned-instance weapon properties and the three allowed qualities", () => {
    for (const quality of shared.ITEM_QUALITIES) {
      expect(shared.canApplyWeaponInjury(weapon(quality))).toBe(["EXCELLENT", "PERFECT", "MASTERWORK"].includes(quality));
    }
    expect(shared.canApplyWeaponInjury({ ...weapon(), category: "armor" })).toBe(false);
    expect(shared.canApplyWeaponInjury({ ...weapon(), quantity: 2 })).toBe(false);
    const withoutEquipment = weapon();
    delete withoutEquipment.equipment;
    expect(shared.canApplyWeaponInjury(withoutEquipment)).toBe(false);
    expect(shared.canApplyWeaponInjury({ ...weapon(), durability: 0 })).toBe(false);
    expect(shared.canApplyWeaponInjury({ ...weapon(), equippedSlot: "mainHand" })).toBe(true);
    const wand={...weapon(),equipment:{...weapon().equipment!,weaponFamily:"wand" as const}};
    expect(shared.canApplyWeaponInjury(wand)).toBe(true);
    expect(shared.canApplyWeaponInjury({...wand,quality:"GOOD"})).toBe(false);
    expect(shared.canApplyWeaponInjury({...weapon(),equipment:{...weapon().equipment!,slot:"offHand",weaponFamily:"shield"}})).toBe(false);
    expect(shared.isWeaponInjuryStone({ itemId: "injury-stone", category: "upgrade-item" })).toBe(true);
    expect(shared.isWeaponInjuryStone({ itemId: "injury-stone", category: "consumable" })).toBe(false);
  });

  it("combines active temporary and permanent injuries without duplicate penalties or expired effects", () => {
    const combatant = { injuries: ["brokenArm"] as shared.InjuryKind[], temporaryInjuries: [
      { kind: "brokenArm" as const, remainingTurns: 2 }, { kind: "bleeding" as const, remainingTurns: null },
      { kind: "poison" as const, remainingTurns: 0 }
    ] };
    expect(shared.getActiveInjuryKinds(combatant)).toEqual(["brokenArm", "bleeding"]);
    expect(shared.hasInjury(combatant, "bleeding")).toBe(true);
    expect(shared.hasInjury(combatant, "poison")).toBe(false);
    expect(new Set(shared.INJURY_DEFINITIONS.map(injury => injury.id)).size).toBe(15);
  });
});
