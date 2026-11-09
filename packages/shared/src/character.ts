import type { InjuryKind } from "./battle";
import type { PlayerId } from "./ids";
import type { InventorySnapshot } from "./inventory";
import type { CharacterStatistics } from "./characterProgression";
import type { WeaponTraining } from "./weapons";
import type { CharacterEquipment } from "./equipment";
import type { ArmorTraining } from "./armorSpecialization";

export interface CharacterSnapshot {
  playerId: PlayerId;
  nickname: string;
  appearance?: Record<string, unknown>;
  /** Historical save data only; does not gate or strengthen the character. */
  level: number;
  experience?: number;
  statistics?: CharacterStatistics;
  weaponTraining?: WeaponTraining;
  armorTraining?: ArmorTraining;
  equipment?: CharacterEquipment;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface PlayerStateSnapshot {
  character: CharacterSnapshot;
  inventory: InventorySnapshot;
  gold?: number;
}
