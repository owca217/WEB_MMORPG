import type { AppearanceSelection } from "./appearance";
import type { InjuryKind } from "./battle";
import type { PlayerId } from "./ids";
import type {
  EquipmentSnapshot,
  InventorySnapshot
} from "./inventory";

export interface CharacterSnapshot {
  playerId: PlayerId;
  nickname: string;
  appearance: AppearanceSelection;
  level: number;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
}

export interface CharacterProfile {
  id: PlayerId;
  nickname: string;
  appearance: AppearanceSelection;
}

export interface PlayerStateSnapshot {
  character: CharacterSnapshot;
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}
