import type { InventoryItem } from "@web-mmorpg/shared";
import type { EquipmentSlotId } from "./equipmentSlots";

// Small vector emblems share the bronze/ink palette of the existing window skin.
const SHAPES: Record<EquipmentSlotId | "bow" | "staff" | "axe" | "book", string> = {
  head: '<path d="M16 39V25C16 6 48 6 48 25v14l-10 9V29l-6-5-6 5v19Z"/><path d="M16 27h12m8 0h12M32 10v14"/>',
  shoulders: '<path d="m6 30 9-13 11-2 6 10 6-10 11 2 9 13-5 13-14-2-7-10-7 10-14 2Z"/><path d="m9 30 14 4m18 0 14-4M18 17l-4 9m32-9 4 9"/>',
  chest: '<path d="m21 10-9 8 6 15-1 21h30l-1-21 6-15-9-8-4 8H25Z"/><path d="m18 31 14 5 14-5M32 20v29M18 47h28"/>',
  hands: '<path d="M23 53 15 39l-5-8 4-5 9 8-2-19 5-2 4 18V11l5-1 1 20 3-16 5 2-3 18 6-13 5 3-8 25-7 7Z"/><path d="m23 44 17 3m-15 5 12 3"/>',
  legs: '<path d="M17 11h30l3 41-15 1-3-25-3 25-15-1Z"/><path d="M18 18h28M32 12v16M15 45h14m6 0h14"/>',
  feet: '<path d="M20 10h25l-3 27 12 10v7H12v-9l8-13Z"/><path d="M20 17h24M18 40h24M13 48h39m-30-22 16 2"/>',
  neck: '<path d="M14 12c-2 31 38 31 36 0" fill="none"/><path d="m32 32 11 10-11 13-11-13Z"/><path d="m32 35 4 8-4 7-4-7Z"/>',
  ring1: '<ellipse cx="32" cy="36" rx="17" ry="18"/><ellipse cx="32" cy="36" rx="11" ry="12" fill="none"/><path d="m23 13 9-5 9 5-3 12H26Z"/>',
  ring2: '<ellipse cx="32" cy="36" rx="17" ry="18"/><ellipse cx="32" cy="36" rx="11" ry="12" fill="none"/><path d="m23 13 9-5 9 5-3 12H26Z"/>',
  back: '<path d="M24 9h16l8 14 7 30-15-4-8 6-8-6-15 4 7-30Z"/><path d="m24 9 8 11 8-11M24 25l-5 21m21-21 5 21"/>',
  wrists: '<path d="m17 10 30 7-8 38-29-7Z"/><path d="m16 17 29 7m-32 7 29 7m-32 2 29 7M30 14l-8 37"/>',
  waist: '<path d="M7 24h50v18H7Z"/><path d="M22 20h20v26H22Z"/><path d="M27 25h10v16H27Z"/><path d="M32 33h15"/>',
  ears: '<path d="M20 12v13m24-13v13" fill="none"/><circle cx="20" cy="10" r="4"/><circle cx="44" cy="10" r="4"/><ellipse cx="20" cy="37" rx="10" ry="15" fill="none"/><ellipse cx="44" cy="37" rx="10" ry="15" fill="none"/>',
  mainHand: '<path d="m47 7 9 1-1 9-27 27-8-8Z"/><path d="m14 31 19 19-4 4-19-19Zm2 11 6 6-9 9-6-6Z"/><path d="m25 38 24-24" fill="none"/>',
  offHand: '<path d="m32 8 21 8-3 23c-4 8-11 14-18 18-7-4-14-10-18-18l-3-23Z"/><path d="m32 15 14 5-2 17c-3 6-7 10-12 13-5-3-9-7-12-13l-2-17Z"/><path d="M32 15v35"/>',
  bow: '<path d="M19 7c33 9 33 41 0 50l9-25Z" fill="none"/><path d="M11 32h44m-7-6 7 6-7 6" fill="none"/>',
  staff: '<path d="m20 54 17-35 6 3-17 35Z"/><path d="m35 6 13 3 5 11-10 9-13-7Z"/><path d="m36 14 7-2 4 8-7 3Z"/>',
  axe: '<path d="m17 55 23-43 5 3-22 43Z"/><path d="M22 9c3 13 17 19 29 12l-6 17c-17 0-24-8-23-29Z"/>',
  book: '<path d="m10 13 21 4 23-5v38l-22 5-22-4Z"/><path d="M31 17v38m-15-32 10 2m11-1 10-3M16 32l10 2m11-1 10-3"/>'
};

export function equipmentIcon(slot: EquipmentSlotId, item: InventoryItem | null): string {
  let icon: keyof typeof SHAPES = slot;
  const name = `${item?.itemId ?? ""} ${item?.name ?? ""}`.toLowerCase();
  if (slot === "mainHand" || slot === "offHand") {
    if (/\b(?:bow|longbow|shortbow)\b|łuk/.test(name)) icon = "bow";
    else if (/staff|wand|kostur|różdż|laska/.test(name)) icon = "staff";
    else if (/axe|topór|topor|siekier/.test(name)) icon = "axe";
    else if (/book|tome|księg|ksieg/.test(name)) icon = "book";
    else if (/sword|dagger|miecz|sztylet/.test(name)) icon = "mainHand";
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="currentColor" fill-opacity=".16" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${SHAPES[icon]}</svg>`;
}
