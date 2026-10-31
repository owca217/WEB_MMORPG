import type { LocationId, PlayerId } from "./ids";
import type { EnemyId } from "./enemies";

export interface WorldPlayerSnapshot {
  id: PlayerId;
  nickname: string;
  appearance?: Record<string, unknown>;
  x: number;
  y: number;
}

export interface EncounterSnapshot {
  id: string;
  enemyId?: EnemyId;
  x: number;
  y: number;
  label: string;
  enemyKind?: "wolf" | "boar" | "forest-spider";
  status?: "alive" | "engaged" | "respawning";
  respawnAt?: number;
}

export interface TeleportZoneSnapshot {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  destinationLocationId: LocationId;
}

export interface LocationPresentation {
  name: string;
  width: number;
  height: number;
  theme: "settlement" | "dense-forest";
}

export type NpcKind = "guide" | "healer" | "merchant";

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
  location?: LocationPresentation;
  teleports?: TeleportZoneSnapshot[];
  serverTime?: number;
}
