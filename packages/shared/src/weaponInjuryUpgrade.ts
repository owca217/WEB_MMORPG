import type { CharacterSnapshot } from "./character";
import type { InventoryItem, InventorySnapshot } from "./inventory";
import type { ItemQuality } from "./itemQuality";
import type { InjuryKind } from "./battle";
import { getInjuryDefinition, INJURY_DEFINITIONS, isInjuryKind, type InjuryDuration, type WeaponInjuryUpgrade } from "./injuries";

export const WEAPON_INJURY_STONE_ITEM_ID = "injury-stone";
export const WEAPON_INJURY_STONE_CATEGORY = "upgrade-item";
export const WEAPON_INJURY_STONE_PRICE = 50;

export interface WeaponInjuryUpgradeRequest {
  requestId: string;
  weaponInstanceId: string;
  stoneInstanceId: string;
}

export type WeaponInjuryUpgradeResult =
  | { ok: true; inventory: InventorySnapshot; character: CharacterSnapshot; upgrade: WeaponInjuryUpgrade }
  | { ok: false; code: string; message: string };

const QUALITY_BONUS: Partial<Record<ItemQuality, number>> = { EXCELLENT: 0, PERFECT: 1, MASTERWORK: 2 };

export function calculateWeaponInjuryDuration(quality: ItemQuality, kind: InjuryKind, chancePercent: number): InjuryDuration {
  const qualityBonus = QUALITY_BONUS[quality];
  if (qualityBonus === undefined) throw new Error("WEAPON_INJURY_QUALITY_REQUIRED");
  if (!Number.isInteger(chancePercent) || chancePercent < 5 || chancePercent > 15) throw new Error("INVALID_INJURY_CHANCE");
  const severity = getInjuryDefinition(kind).severity;
  if (quality === "MASTERWORK" && severity === 0 && chancePercent <= 6) return "battle";
  const points = 15 - chancePercent + qualityBonus - 2 * severity;
  return Math.min(5, Math.max(2, 2 + Math.floor(points / 3))) as 2 | 3 | 4 | 5;
}

export function rollWeaponInjuryUpgrade(quality: ItemQuality, random: () => number = Math.random): WeaponInjuryUpgrade {
  if (QUALITY_BONUS[quality] === undefined) throw new Error("WEAPON_INJURY_QUALITY_REQUIRED");
  const draw = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("INVALID_INJURY_RANDOM");
    return value;
  };
  const kind = INJURY_DEFINITIONS[Math.floor(draw() * INJURY_DEFINITIONS.length)]!.id;
  const chancePercent = 5 + Math.floor(draw() * 11);
  return { kind, chancePercent, duration: calculateWeaponInjuryDuration(quality, kind, chancePercent) };
}

export function isWeaponInjuryUpgrade(value: unknown): value is WeaponInjuryUpgrade {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const upgrade = value as Partial<WeaponInjuryUpgrade>;
  return isInjuryKind(upgrade.kind) && Number.isInteger(upgrade.chancePercent) &&
    upgrade.chancePercent! >= 5 && upgrade.chancePercent! <= 15 &&
    (upgrade.duration === "battle" || [2, 3, 4, 5].includes(upgrade.duration as number));
}

export function canApplyWeaponInjury(item: InventoryItem): boolean {
  return item.category === "weapon" && item.quantity === 1 && !item.permanentContainer &&
    QUALITY_BONUS[item.quality ?? "NORMAL"] !== undefined && item.equipment?.slot === "mainHand" &&
    !!item.equipment.weaponFamily && item.equipment.weaponFamily !== "shield" &&
    (item.durability === undefined || Number.isFinite(item.durability) && item.durability > 0);
}

export function isWeaponInjuryStone(item: Pick<InventoryItem, "itemId" | "category">): boolean {
  return item.itemId === WEAPON_INJURY_STONE_ITEM_ID && item.category === WEAPON_INJURY_STONE_CATEGORY;
}
