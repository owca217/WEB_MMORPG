import type { EncounterSnapshot, LocationId, NpcSnapshot } from "@web-mmorpg/shared";

export interface WorldFixture {
  id: LocationId;
  width: number;
  height: number;
  spawn: { x: number; y: number };
  encounters: EncounterSnapshot[];
  npcs: NpcSnapshot[];
}

export const FOREST_SETTLEMENT_01: WorldFixture = {
  id: "forest-settlement-01",
  width: 1600,
  height: 900,
  spawn: { x: 360, y: 470 },
  npcs: [
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

export const ENCOUNTER_ACTIVATION_RADIUS = 90;
export const MAX_WORLD_SPEED = 220;
