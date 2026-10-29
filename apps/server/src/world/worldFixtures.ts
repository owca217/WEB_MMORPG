import type { EncounterSnapshot, LocationId, LocationPresentation, NpcSnapshot, TeleportZoneSnapshot } from "@web-mmorpg/shared";

export interface WorldTeleport extends TeleportZoneSnapshot {
  destination: { x: number; y: number };
}

export interface WorldFixture {
  id: LocationId;
  name: string;
  theme: LocationPresentation["theme"];
  width: number;
  height: number;
  spawn: { x: number; y: number };
  encounters: EncounterSnapshot[];
  npcs: NpcSnapshot[];
  teleports: WorldTeleport[];
}

export const FOREST_SETTLEMENT_01: WorldFixture = {
  id: "forest-settlement-01",
  name: "Osada Leśna",
  theme: "settlement",
  width: 1600,
  height: 900,
  spawn: { x: 360, y: 470 },
  teleports: [{
    id: "settlement-east", label: "Las Wschodni", x: 1510, y: 350, width: 90, height: 200,
    destinationLocationId: "eastern-forest-01", destination: { x: 150, y: 600 }
  }],
  npcs: [
    {
      id: "merchant-miro",
      kind: "merchant",
      name: "Miro",
      x: 480,
      y: 420,
      interactionRadius: 95
    },
    {
      id: "guide-boran",
      kind: "guide",
      name: "Boran",
      x: 610,
      y: 420,
      interactionRadius: 95
    },
    {
      id: "healer-ada",
      kind: "healer",
      name: "Ada",
      x: 720,
      y: 535,
      interactionRadius: 95
    }
  ],
  encounters: [
    {
      id: "wolf-pack-01",
      x: 1320,
      y: 455,
      label: "Wolf Pack"
    }
  ]
};

export const EASTERN_FOREST_01: WorldFixture = {
  id: "eastern-forest-01", name: "Las Wschodni", theme: "dense-forest",
  width: 2000, height: 1200, spawn: { x: 150, y: 600 }, npcs: [],
  teleports: [{
    id: "forest-west", label: "Osada Leśna", x: 0, y: 500, width: 90, height: 200,
    destinationLocationId: "forest-settlement-01", destination: { x: 1450, y: 450 }
  }],
  encounters: [
    { id: "forest-boars-01", x: 480, y: 410, label: "Dziki", enemyKind: "boar" },
    { id: "forest-spiders-01", x: 900, y: 780, label: "Pająki leśne", enemyKind: "forest-spider" },
    { id: "forest-wolves-01", x: 1450, y: 330, label: "Leśne wilki", enemyKind: "wolf" },
    { id: "forest-boars-02", x: 1680, y: 900, label: "Dziki", enemyKind: "boar" }
  ]
};

export const WORLD_FIXTURES: readonly WorldFixture[] = [FOREST_SETTLEMENT_01, EASTERN_FOREST_01];

export function getWorldFixture(id: LocationId): WorldFixture | undefined {
  return WORLD_FIXTURES.find(location => location.id === id);
}

export const ENCOUNTER_ACTIVATION_RADIUS = 90;
export const MAX_WORLD_SPEED = 220;
