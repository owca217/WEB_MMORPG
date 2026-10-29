import type { InjuryKind } from "./battle";
import type { PlayerId } from "./ids";
import type { InventorySnapshot } from "./inventory";
import type { CharacterStatistics } from "./characterProgression";

export interface CharacterSnapshot {
  playerId: PlayerId;
  nickname: string;
  appearance?: Record<string, unknown>;
  level: number;
  experience?: number;
  statistics?: CharacterStatistics;
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
