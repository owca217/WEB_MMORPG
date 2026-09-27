import {
  BAG_EQUIPMENT_SLOTS,
  type BagEquipmentSlot,
  type PlayerStateSnapshot
} from "@web-mmorpg/shared";
import type { ConnectionState } from "../net/GameSocket";
import {
  bindContainerPointerDrag,
  cancelContainerPointerDrag,
  CONTAINER_ITEM_DRAG_TYPE,
  CONTAINER_SLOT_DRAG_TYPE,
  consumeSuppressedContainerClick
} from "./containerDrag";
import { worldWindowMenuItem } from "./windowMenuItems";
import "./world-hud.css";

interface WorldHudHandlers {
  onInventory: () => void;
  onContainerSlotChange: (
    slot: BagEquipmentSlot,
    itemInstanceId: string | null
  ) => void;
  onCharacter: () => void;
  onStatistics: () => void;
  onProfessions: () => void;
  onParty?: () => void;
  onLogout: () => void;
}

let nextMenuId = 0;

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly hp: HTMLElement;
  private readonly experience: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuToggle: HTMLButtonElement;
  private readonly menuButtons: HTMLButtonElement[] = [];
  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) {
      this.setMenuOpen(false);
    }
  };
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !this.menu.hidden) {
      event.preventDefault();
      this.setMenuOpen(false, true);
    }
  };

  constructor(handlers: WorldHudHandlers) {
    const menuId = `world-window-menu-${++nextMenuId}`;
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Panel gracza");
    this.root.innerHTML = `
      <div class="world-hud__stats">
        <div class="world-hud__stat world-hud__stat--hp">
          <span>HP</span><b data-hp>—</b>
        </div>
        <div class="world-hud__stat world-hud__stat--experience" title="Doświadczenie">
          <span aria-label="Doświadczenie">EXP</span><b data-experience>—</b>
        </div>
      </div>
      <button class="world-hud__menu-toggle" type="button" data-menu-toggle
        aria-expanded="false" aria-controls="${menuId}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>Menu</span>
        <svg class="world-hud__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
      </button>
      <div class="world-hud__containers" data-container-slots aria-label="Pojemniki">
        ${BAG_EQUIPMENT_SLOTS.map((slot, index) => `
          <button class="world-hud__container-slot" type="button" data-container-slot="${slot}"
            data-occupied="false" draggable="false" aria-label="Pojemnik ${index + 1}: Puste miejsce">
            <span class="world-hud__container-icon" data-container-icon aria-hidden="true">＋</span>
            <span class="world-hud__container-name" data-container-name>Puste miejsce</span>
            <span class="world-hud__container-capacity" data-container-capacity>—</span>
          </button>
        `).join("")}
      </div>
      <nav class="world-hud__menu" id="${menuId}" data-window-menu aria-label="Okna gry" hidden></nav>
      <span class="world-hud__connection" data-connection role="status">Łączenie…</span>
    `;
    this.hp = this.require("[data-hp]");
    this.experience = this.require("[data-experience]");
    this.connection = this.require("[data-connection]");
    this.menu = this.require("[data-window-menu]");
    this.menuToggle = this.require<HTMLButtonElement>("[data-menu-toggle]");

    for (const slot of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("[data-container-slot]")
    )) {
      const slotId = slot.dataset.containerSlot as BagEquipmentSlot;
      slot.addEventListener("click", () => {
        if (consumeSuppressedContainerClick()) return;
        handlers.onInventory();
      });
      bindContainerPointerDrag(
        slot,
        () => {
          const itemInstanceId = slot.dataset.itemInstanceId;
          return itemInstanceId
            ? { itemInstanceId, sourceSlot: slotId }
            : null;
        },
        (target, payload) => {
          const destinationSlot = target?.closest<HTMLButtonElement>(
            "[data-container-slot]"
          );
          if (destinationSlot?.dataset.containerSlot) {
            handlers.onContainerSlotChange(
              destinationSlot.dataset.containerSlot as BagEquipmentSlot,
              payload.itemInstanceId
            );
            return;
          }

          if (payload.sourceSlot && target?.closest(".inventory-list")) {
            handlers.onContainerSlotChange(
              payload.sourceSlot as BagEquipmentSlot,
              null
            );
          }
        }
      );
      slot.addEventListener("dragstart", (event) => {
        const itemInstanceId = slot.dataset.itemInstanceId;
        if (!itemInstanceId || !event.dataTransfer) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(CONTAINER_ITEM_DRAG_TYPE, itemInstanceId);
        event.dataTransfer.setData(CONTAINER_SLOT_DRAG_TYPE, slotId);
      });
      slot.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes(CONTAINER_ITEM_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        slot.dataset.dropTarget = "true";
      });
      slot.addEventListener("dragleave", () => {
        delete slot.dataset.dropTarget;
      });
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        delete slot.dataset.dropTarget;
        const itemInstanceId = event.dataTransfer?.getData(CONTAINER_ITEM_DRAG_TYPE);
        if (itemInstanceId) handlers.onContainerSlotChange(slotId, itemInstanceId);
      });
    }

    this.addAction(
      "character",
      worldWindowMenuItem("character").label,
      handlers.onCharacter
    );
    this.addAction(
      "statistics",
      worldWindowMenuItem("statistics").label,
      handlers.onStatistics
    );
    this.addAction(
      "professions",
      worldWindowMenuItem("professions").label,
      handlers.onProfessions
    );
    if (handlers.onParty) {
      this.addAction("party", worldWindowMenuItem("party").label, handlers.onParty);
    }
    this.addAction("logout", worldWindowMenuItem("logout").label, handlers.onLogout);

    this.menuToggle.addEventListener("click", () => this.setMenuOpen(this.menu.hidden));
    this.root.addEventListener("keydown", (event) => this.navigateMenu(event));
    this.root.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Node) || !this.root.contains(event.relatedTarget)) {
        this.setMenuOpen(false);
      }
    });
    document.addEventListener("pointerdown", this.onOutsidePointer);
    document.addEventListener("keydown", this.onEscape);
    document.body.appendChild(this.root);
  }

  update(state: PlayerStateSnapshot): void {
    const { hp, maxHp, experience } = state.character;
    this.hp.textContent = `${hp}/${maxHp}`;
    const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 0;
    this.root.style.setProperty("--hud-hp", `${hpPercent}%`);
    this.experience.textContent = typeof experience === "number" && Number.isFinite(experience)
      ? Math.max(0, Math.trunc(experience)).toLocaleString("pl-PL")
      : "0";

    const inventoryByInstance = new Map(
      state.inventory.items.map((item) => [item.instanceId, item])
    );
    const equipmentBySlot = new Map(
      state.equipment.items.map((entry) => [entry.slot, entry.itemInstanceId])
    );
    for (const slot of Array.from(
      this.root.querySelectorAll<HTMLButtonElement>("[data-container-slot]")
    )) {
      const slotId = slot.dataset.containerSlot as BagEquipmentSlot;
      const itemInstanceId = equipmentBySlot.get(slotId) ?? null;
      const item = itemInstanceId ? inventoryByInstance.get(itemInstanceId) : undefined;
      const occupied = Boolean(itemInstanceId);
      const capacity = item?.containerCapacity;
      slot.dataset.occupied = String(occupied);
      if (itemInstanceId) slot.dataset.itemInstanceId = itemInstanceId;
      else delete slot.dataset.itemInstanceId;
      slot.draggable = Boolean(itemInstanceId && item?.category === "container");
      slot.setAttribute(
        "aria-label",
        `${slot.dataset.containerSlot}: ${item?.name ?? (occupied ? "Założony pojemnik" : "Puste miejsce")}`
      );
      slot.querySelector<HTMLElement>("[data-container-icon]")!.textContent =
        item?.category === "container" ? "🎒" : occupied ? "◆" : "＋";
      slot.querySelector<HTMLElement>("[data-container-name]")!.textContent =
        item?.name ?? (occupied ? "Założony pojemnik" : "Puste miejsce");
      slot.querySelector<HTMLElement>("[data-container-capacity]")!.textContent =
        capacity ? `${capacity} miejsc` : occupied ? "?" : "—";
    }
  }

  setConnectionState(state: ConnectionState): void {
    this.root.dataset.connection = state;
    this.connection.textContent = state === "connected"
      ? "Połączono"
      : state === "connecting" ? "Ponowne łączenie…" : "Brak połączenia z serwerem";
  }

  destroy(): void {
    cancelContainerPointerDrag();
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    document.removeEventListener("keydown", this.onEscape);
    this.root.remove();
  }

  private addAction(key: string, label: string, handler: () => void): void {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[key] = "";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.setMenuOpen(false, true);
      handler();
    });
    this.menu.appendChild(button);
    this.menuButtons.push(button);
  }

  private setMenuOpen(open: boolean, restoreFocus = false): void {
    this.menu.hidden = !open;
    this.menuToggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) this.menuToggle.focus();
  }

  private navigateMenu(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (this.menu.hidden && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const index = this.menuButtons.findIndex((button) => button === document.activeElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.menuButtons.length - 1;
    else if (index < 0) next = event.key === "ArrowDown" ? 0 : this.menuButtons.length - 1;
    else next = (index + (event.key === "ArrowDown" ? 1 : -1) + this.menuButtons.length) % this.menuButtons.length;
    this.setMenuOpen(true);
    this.menuButtons[next]?.focus();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
