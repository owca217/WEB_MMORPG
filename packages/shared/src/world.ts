import type { LocationId, PlayerId } from "./ids";

export interface WorldPlayerSnapshot {
  id: PlayerId;
  nickname: string;
  x: number;
  y: number;
}

export interface EncounterSnapshot {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface WorldStateSnapshot {
  locationId: LocationId;
  players: WorldPlayerSnapshot[];
  encounters: EncounterSnapshot[];
}
