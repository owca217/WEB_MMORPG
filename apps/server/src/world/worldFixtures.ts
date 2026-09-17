import type { EncounterSnapshot, LocationId } from "@web-mmorpg/shared";

export interface WorldFixture {
  id: LocationId;
  width: number;
  height: number;
  spawn: { x: number; y: number };
  encounters: EncounterSnapshot[];
}

export const MEADOW_01: WorldFixture = {
  id: "meadow-01",
  width: 1600,
  height: 900,
  spawn: { x: 300, y: 450 },
  encounters: [
    {
      id: "wolf-pack-01",
      x: 1050,
      y: 450,
      label: "Wolf Pack"
    }
  ]
};

export const ENCOUNTER_ACTIVATION_RADIUS = 90;
export const MAX_WORLD_SPEED = 220;
