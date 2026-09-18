import type { AppearanceSelection } from "./appearance";
import type { LocationId, PlayerId } from "./ids";

export interface WorldPlayerSnapshot {
  id: PlayerId;
  nickname: string;
  appearance: AppearanceSelection;
  x: number;
  y: number;
}

export interface EncounterSnapshot {
  id: string;
  x: number;
  y: number;
  label: string;
}

export type NpcKind = "guide" | "healer";

export interface NpcSnapshot {
  id: string;
  kind: NpcKind;
  name: string;
  x: number;
  y: number;
  interactionRadius: number;
}

export interface NpcInteractionPayload {
  npcId: string;
  npcName: string;
  kind: NpcKind;
  title: string;
  lines: string[];
  canHeal: boolean;
}

export interface WorldStateSnapshot {
  locationId: LocationId;
  players: WorldPlayerSnapshot[];
  encounters: EncounterSnapshot[];
  npcs: NpcSnapshot[];
}
