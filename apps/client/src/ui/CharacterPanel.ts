import type { PlayerStateSnapshot } from "@web-mmorpg/shared";
import { CharacterPreview } from "../appearance/CharacterPreview";
import { InterfaceWindowControls } from "./InterfaceWindowControls";
import { equipmentIcon } from "./equipmentIcons";
import { EQUIPMENT_SLOTS, equipmentSlotsFor, type EquipmentSlotId, type EquipmentSlotView } from "./equipmentSlots";
import "./equipment-panel.css";

export class CharacterPanel {
  private static nextId = 0;
  private readonly root = document.createElement("div");
  private readonly tooltip = document.createElement("div");
  private readonly preview = new CharacterPreview({ showOutfitToggle: false });
  private readonly windowControls: InterfaceWindowControls;
  private readonly buttons = new Map<EquipmentSlotId, HTMLButtonElement>();
  private slots = equipmentSlotsFor({ items: [] }, { items: [] });
  private pinnedSlot: EquipmentSlotId | null = null;
  private activeSlot: EquipmentSlotId | null = null;

  constructor() {
    const id = ++CharacterPanel.nextId;
    this.root.className = "game-panel game-panel--character is-hidden";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-labelledby", `equipment-heading-${id}`);
    this.root.innerHTML = `
      <div class="game-panel__header"><h2 id="equipment-heading-${id}">Postać</h2></div>
      <div class="equipment-sheet">
        <div class="equipment-identity"><strong data-character-name>—</strong><span data-character-level></span></div>
        <div class="equipment-layout">
          <section class="equipment-group equipment-group--armor" aria-label="Pancerz">
            <h3>Pancerz</h3><div class="equipment-slots" data-group="armor"></div>
          </section>
          <div class="equipment-portrait"><div data-preview></div><span>Wygląd postaci</span></div>
          <section class="equipment-group equipment-group--accessories" aria-label="Dodatki">
            <h3>Dodatki</h3><div class="equipment-slots" data-group="accessories"></div>
          </section>
          <section class="equipment-group equipment-group--weapons" aria-label="Broń">
            <h3>Broń</h3><div class="equipment-slots" data-group="weapons"></div>
          </section>
        </div>
        <div class="equipment-summary"><span data-equipped-count>Założone: 0 / 15</span><span>Wskaż lub dotknij miejsca, aby zobaczyć szczegóły.</span></div>
      </div>`;
    this.require("[data-preview]").append(this.preview.element);
    this.tooltip.id = `equipment-tooltip-${id}`;
    this.tooltip.className = "inventory-tooltip equipment-tooltip";
    this.tooltip.setAttribute("role", "tooltip");
    this.tooltip.hidden = true;
    document.body.append(this.root, this.tooltip);

    for (const slot of EQUIPMENT_SLOTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "equipment-slot";
      button.dataset.equipmentSlot = slot.id;
      button.innerHTML = '<span class="equipment-slot__icon"></span><span class="equipment-slot__label"></span><span class="equipment-slot__item"></span>';
      this.require(`[data-group="${slot.group}"]`).append(button);
      this.buttons.set(slot.id, button);
      button.addEventListener("pointerenter", event => {
        if (event.pointerType !== "touch" && !this.pinnedSlot) this.showTooltip(slot.id);
      });
      button.addEventListener("pointerleave", () => { if (!this.pinnedSlot) this.hideTooltip(); });
      button.addEventListener("focus", () => { if (!this.pinnedSlot) this.showTooltip(slot.id); });
      button.addEventListener("blur", () => { if (!this.pinnedSlot) this.hideTooltip(); });
      button.addEventListener("click", () => {
        if (this.pinnedSlot === slot.id) {
          this.pinnedSlot = null;
          this.hideTooltip();
        } else {
          this.pinnedSlot = slot.id;
          this.showTooltip(slot.id);
        }
      });
    }
    this.updateSlots();
    this.root.addEventListener("keydown", event => {
      if (event.key === "Escape") { this.pinnedSlot = null; this.hideTooltip(); }
    });
    this.require(".equipment-sheet").addEventListener("scroll", () => {
      this.pinnedSlot = null; this.hideTooltip();
    });
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
    this.windowControls = new InterfaceWindowControls({
      root: this.root, header: this.require(".game-panel__header"), onClose: () => this.hide()
    });
  }

  update(state: PlayerStateSnapshot): void {
    this.require("[data-character-name]").textContent = state.character.nickname;
    this.require("[data-character-level]").textContent = `Poziom ${state.character.level}`;
    this.preview.render(state.character.appearance);
    this.slots = equipmentSlotsFor(state.equipment, state.inventory);
    this.updateSlots();
    this.pinnedSlot = null;
    this.hideTooltip();
  }

  show(): void {
    document.body.appendChild(this.root);
    this.root.classList.remove("is-hidden");
  }
  hide(): void {
    this.root.classList.add("is-hidden");
    this.pinnedSlot = null;
    this.hideTooltip();
  }
  toggle(): void { if (this.root.classList.contains("is-hidden")) this.show(); else this.hide(); }

  destroy(): void {
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    this.windowControls.destroy();
    this.preview.destroy();
    this.tooltip.remove();
    this.root.remove();
  }

  private updateSlots(): void {
    for (const slot of this.slots) {
      const button = this.buttons.get(slot.id)!;
      const occupied = slot.itemInstanceId !== null;
      const name = slot.item?.name ?? (occupied ? "Założony przedmiot" : "Puste miejsce");
      button.dataset.occupied = String(occupied);
      button.setAttribute("aria-label", `${slot.label}: ${name}`);
      button.querySelector<HTMLElement>(".equipment-slot__icon")!.innerHTML = equipmentIcon(slot.id, slot.item);
      button.querySelector<HTMLElement>(".equipment-slot__label")!.textContent = slot.label;
      button.querySelector<HTMLElement>(".equipment-slot__item")!.textContent = name;
    }
    this.require("[data-equipped-count]").textContent = `Założone: ${this.slots.filter(slot => slot.itemInstanceId).length} / ${this.slots.length}`;
  }

  private showTooltip(id: EquipmentSlotId): void {
    if (this.root.classList.contains("is-hidden")) return;
    this.hideTooltip();
    const slot = this.slots.find(entry => entry.id === id)!;
    const button = this.buttons.get(id)!;
    this.activeSlot = id;
    this.tooltip.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "inventory-tooltip__header";
    const name = document.createElement("strong"), position = document.createElement("span");
    name.textContent = slot.item?.name ?? (slot.itemInstanceId ? "Założony przedmiot" : "Puste miejsce");
    position.textContent = slot.label;
    heading.append(name, position);
    const description = document.createElement("p");
    description.className = "inventory-tooltip__description";
    description.textContent = slot.item?.description ?? (slot.itemInstanceId ? "Szczegóły przedmiotu są niedostępne." : slot.description);
    this.tooltip.append(heading, description);
    this.appendItemStats(slot);
    button.setAttribute("aria-describedby", this.tooltip.id);
    this.tooltip.hidden = false;
    const anchor = button.getBoundingClientRect(), rect = this.tooltip.getBoundingClientRect();
    const left = anchor.right + 10 + rect.width < window.innerWidth - 12 ? anchor.right + 10 : anchor.left - rect.width - 10;
    this.tooltip.style.left = `${Math.max(12, Math.min(left, window.innerWidth - rect.width - 12))}px`;
    this.tooltip.style.top = `${Math.max(12, Math.min(anchor.top, window.innerHeight - rect.height - 12))}px`;
  }

  private appendItemStats(slot: EquipmentSlotView): void {
    const item = slot.item as (EquipmentSlotView["item"] & { stats?: Record<string, string | number> });
    if (!item?.stats) return;
    const list = document.createElement("dl");
    list.className = "inventory-tooltip__meta";
    for (const [label, value] of Object.entries(item.stats)) {
      const row = document.createElement("div"), term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label; detail.textContent = String(value);
      row.append(term, detail); list.append(row);
    }
    this.tooltip.append(list);
  }

  private hideTooltip(): void {
    if (this.activeSlot) this.buttons.get(this.activeSlot)?.removeAttribute("aria-describedby");
    this.activeSlot = null;
    this.tooltip.hidden = true;
  }

  private readonly onDocumentPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && this.root.contains(event.target) && event.target.closest(".equipment-slot")) return;
    this.pinnedSlot = null;
    this.hideTooltip();
  };

  private require(selector: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Character equipment element missing: ${selector}`);
    return element;
  }
}
