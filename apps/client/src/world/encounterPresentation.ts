import type { EncounterSnapshot } from "@web-mmorpg/shared";

export function encounterAvailable(encounter: Pick<EncounterSnapshot,"status">): boolean {
  return encounter.status === undefined || encounter.status === "alive";
}

export function encounterStatusText(encounter: Pick<EncounterSnapshot,"status"|"respawnAt">,serverNow:number): string {
  if(encounter.status === "engaged")return "W trakcie walki";
  if(encounter.status !== "respawning")return "";
  const seconds=Math.max(0,Math.ceil(((encounter.respawnAt??serverNow)-serverNow)/1000));
  if(seconds===0)return "Odrodzenie…";
  return `Odrodzenie za ${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
}

export function encounterLabel(encounter: Pick<EncounterSnapshot,"id"|"label">): string {
  return encounter.id === "wolf-pack-01" ? "Wilki" : encounter.label;
}
