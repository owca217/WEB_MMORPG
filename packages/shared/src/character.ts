import type { InjuryKind } from "./battle";
import type { PlayerId } from "./ids";
import type { InventorySnapshot } from "./inventory";
import type { CharacterStatistics } from "./characterProgression";
import type { WeaponTraining } from "./weapons";

export interface CharacterSnapshot {
  playerId: PlayerId;
  nickname: string;
  appearance?: Record<string, unknown>;
  level: number;
  experience?: number;
  statistics?: CharacterStatistics;
  weaponTraining?: WeaponTraining;
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
