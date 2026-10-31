import {
  emptyCharacterEquipment, EQUIPMENT_SLOTS, EQUIPMENT_SLOT_LABELS, getCharacterEquipment,
  type CharacterEquipment, type CharacterSnapshot, type EquipmentSlot, type InventoryItem, type InventorySnapshot
} from "@web-mmorpg/shared";
import { equipmentIcon } from "./EquipmentIcon";
import { itemQualityText } from "./ItemQualityFrame";
import "./HudEquipmentSlots.css";

interface HudEquipmentSlotsOptions {
  onSelect?: (slot: EquipmentSlot, item: InventoryItem | null) => void;
}

const EMPTY_PATHS: Record<EquipmentSlot, string> = {
  mainHand: '<path d="m5 4 12 12m-3 1 4-4m-1 5 3 3M4 4l1 5 4-4-5-1Zm1 16 6-6m-8 4 3 3m-3 0 1-1"/>',
  offHand: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 1v15M5 9h14"/>',
  helmet: '<path d="M5 13V9a7 7 0 0 1 14 0v4l2 5-5 3v-7H8v7l-5-3 2-5Zm3-4h8m-4-6v7"/>',
  chest: '<path d="M8 3 3 7l3 5 2-1v10h8V11l2 1 3-5-5-4c-1 4-7 4-8 0Zm0 12h8m-4-8v13"/>',
  gloves: '<path d="M3 20v-7l2-3V5h2v6h1V3h2v8h1V5h2v8l-2 7H3Zm12-1v-6l2-3V6h2v6h1v-2h2v6l-2 5h-5"/>',
  pants: '<path d="M5 3h14l1 18h-6l-2-10-2 10H4L5 3Zm0 4h14m-7-4v5"/>',
  boots: '<path d="M4 3h6v10l2 4v4H2v-4l2-3V3Zm10 0h6v11l2 3v4H12v-4l2-4V3ZM3 17h8m2 0h8"/>',
  cloak: '<path d="M8 6a4 4 0 0 1 8 0l5 15-9-2-9 2L8 6Zm0 0 4 4 4-4m-4 4v9M9 7h6"/>'
};

/** Eight stable, non-destructive equipment controls for the world HUD. */
export class HudEquipmentSlots {
  readonly element: HTMLDivElement;
  private readonly buttons = new Map<EquipmentSlot, HTMLButtonElement>();
  private equipment: CharacterEquipment = emptyCharacterEquipment();
  private destroyed = false;

  constructor(private readonly options: HudEquipmentSlotsOptions = {}) {
    this.element = document.createElement("div");
    this.element.className = "hud-equipment-slots";
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Założone wyposażenie");
    for (const slot of EQUIPMENT_SLOTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.hudEquipmentSlot = slot;
      button.dataset.equipmentDropTarget = slot;
      button.addEventListener("click", () => {
        if (!this.destroyed) this.options.onSelect?.(slot, this.equipment[slot]);
      });
      this.buttons.set(slot, button);
      this.element.append(button);
    }
    this.render();
  }

  update(character: CharacterSnapshot, inventory: InventorySnapshot): void {
    if (this.destroyed) return;
    this.equipment = character.equipment ?? getCharacterEquipment(inventory, character.level);
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.element.remove();
  }

  private render(): void {
    for (const slot of EQUIPMENT_SLOTS) {
      const button = this.buttons.get(slot)!;
      const item = this.equipment[slot];
      const blocked = slot === "offHand" && !item && !!this.equipment.mainHand?.equipment?.twoHanded;
      const detail = item ? `${item.name} · ${itemQualityText(item)}` : blocked ? "Zajęte przez broń dwuręczną" : "Puste miejsce";
      const label = `${EQUIPMENT_SLOT_LABELS[slot]}: ${detail}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      button.classList.toggle("is-empty", !item);
      button.classList.toggle("is-blocked", blocked);
      if (item) {
        button.dataset.hudEquipmentItem = item.instanceId;
        button.replaceChildren(equipmentIcon(item));
      } else {
        delete button.dataset.hudEquipmentItem;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("hud-equipment-slots__empty-icon");
        svg.dataset.equipmentPlaceholder = slot;
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.4");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svg.innerHTML = EMPTY_PATHS[slot];
        button.replaceChildren(svg);
      }
    }
  }
}
