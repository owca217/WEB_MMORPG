import type {
  BagEquipmentSlot,
  InventoryItem,
  InventorySnapshot
} from "@web-mmorpg/shared";
import { InterfaceWindowControls } from "./InterfaceWindowControls";
import {
  bindContainerPointerDrag,
  cancelContainerPointerDrag,
  CONTAINER_ITEM_DRAG_TYPE,
  CONTAINER_SLOT_DRAG_TYPE
} from "./containerDrag";

const CATEGORY_LABELS = {
  material: "Materiał",
  medical: "Medyczne",
  armor: "Pancerz",
  weapon: "Broń",
  accessory: "Dodatek",
  container: "Pojemnik"
} as const;

const ITEM_ICONS: Record<string, string> = {
  "wolf-pelt": "🐺",
  "field-bandage": "✚",
  "simple-bag": "🎒"
};

interface InventoryPanelOptions {
  onEquipContainer?: (slot: BagEquipmentSlot, itemInstanceId: string) => void;
  onUnequipContainer?: (slot: BagEquipmentSlot) => void;
}

type InventoryItemWithStats = InventoryItem & {
  stats?: Record<string, string | number>;
};

export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private readonly windowControls: InterfaceWindowControls;
  private readonly onEquipContainer:
    | ((slot: BagEquipmentSlot, itemInstanceId: string) => void)
    | undefined;
  private pinnedItemId: string | null = null;
  private readonly onDocumentPointerDown: (event: PointerEvent) => void;

  constructor(options: InventoryPanelOptions = {}) {
    this.onEquipContainer = options.onEquipContainer;
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--inventory is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Ekwipunek</h2>
      </div>
      <div class="inventory-list" data-list></div>
    `;
    document.body.appendChild(this.root);

    this.list = this.require<HTMLDivElement>("[data-list]");
    this.list.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(CONTAINER_SLOT_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      this.list.dataset.dropTarget = "true";
    });
    this.list.addEventListener("dragleave", () => {
      delete this.list.dataset.dropTarget;
    });
    this.list.addEventListener("drop", (event) => {
      event.preventDefault();
      delete this.list.dataset.dropTarget;
      const sourceSlot = event.dataTransfer?.getData(CONTAINER_SLOT_DRAG_TYPE);
      if (sourceSlot && options.onUnequipContainer) {
        options.onUnequipContainer(sourceSlot as BagEquipmentSlot);
      }
    });
    this.tooltip = document.createElement("div");
    this.tooltip.className = "inventory-tooltip";
    this.tooltip.hidden = true;
    document.body.appendChild(this.tooltip);

    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".game-panel__header"),
      onClose: () => this.hide()
    });

    this.onDocumentPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".inventory-slot")) return;
      this.pinnedItemId = null;
      this.hideTooltip();
    };
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
  }

  update(snapshot: InventorySnapshot): void {
    this.list.replaceChildren();
    this.pinnedItemId = null;
    this.hideTooltip();

    if (snapshot.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "game-panel__empty";
      empty.textContent = "Ekwipunek jest pusty.";
      this.list.appendChild(empty);
      return;
    }

    for (const item of snapshot.items) {
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = `inventory-slot inventory-slot--${item.category}`;
      slot.dataset.itemId = item.instanceId;
      slot.draggable = item.category === "container";
      slot.setAttribute(
        "aria-label",
        `${item.name}, ilość: ${item.quantity}`
      );

      const icon = document.createElement("span");
      icon.className = "inventory-slot__icon";
      icon.textContent =
        ITEM_ICONS[item.itemId] ??
        (item.category === "container"
          ? "🎒"
          : item.category === "medical" ? "✚" : "◆");

      slot.appendChild(icon);

      if (item.category === "container") {
        bindContainerPointerDrag(
          slot,
          () => ({ itemInstanceId: item.instanceId }),
          (target, payload) => {
            this.pinnedItemId = null;
            this.hideTooltip();
            const destinationSlot = target?.closest<HTMLButtonElement>(
              "[data-container-slot]"
            );
            if (destinationSlot?.dataset.containerSlot) {
              this.onEquipContainer?.(
                destinationSlot.dataset.containerSlot as BagEquipmentSlot,
                payload.itemInstanceId
              );
            }
          }
        );
        slot.addEventListener("dragstart", (event) => {
          if (!event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(CONTAINER_ITEM_DRAG_TYPE, item.instanceId);
        });
      }

      if (item.quantity > 1) {
        const quantity = document.createElement("span");
        quantity.className = "inventory-slot__quantity";
        quantity.textContent = String(item.quantity);
        slot.appendChild(quantity);
      }

      slot.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") return;
        this.showTooltip(item, event.clientX, event.clientY);
      });
      slot.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch" || this.pinnedItemId) return;
        this.positionTooltip(event.clientX, event.clientY);
      });
      slot.addEventListener("pointerleave", () => {
        if (this.pinnedItemId !== item.instanceId) {
          this.hideTooltip();
        }
      });
      slot.addEventListener("focus", () => {
        const rect = slot.getBoundingClientRect();
        this.showTooltip(
          item,
          rect.right + 8,
          rect.top + rect.height / 2
        );
      });
      slot.addEventListener("blur", () => {
        if (this.pinnedItemId !== item.instanceId) {
          this.hideTooltip();
        }
      });
      slot.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse") return;
        event.preventDefault();

        if (this.pinnedItemId === item.instanceId) {
          this.pinnedItemId = null;
          this.hideTooltip();
          return;
        }

        this.pinnedItemId = item.instanceId;
        const rect = slot.getBoundingClientRect();
        this.showTooltip(
          item,
          rect.left + rect.width / 2,
          rect.bottom + 8
        );
      });

      this.list.appendChild(slot);
    }
  }

  show(): void {
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
    this.pinnedItemId = null;
    this.hideTooltip();
  }

  toggle(): void {
    const willHide = !this.root.classList.contains("is-hidden");
    this.root.classList.toggle("is-hidden");
    if (willHide) {
      this.pinnedItemId = null;
      this.hideTooltip();
    }
  }

  destroy(): void {
    cancelContainerPointerDrag();
    document.removeEventListener("pointerdown", this.onDocumentPointerDown);
    this.windowControls.destroy();
    this.tooltip.remove();
    this.root.remove();
  }

  private showTooltip(
    rawItem: InventoryItem,
    clientX: number,
    clientY: number
  ): void {
    const item = rawItem as InventoryItemWithStats;
    this.tooltip.replaceChildren();

    const header = document.createElement("div");
    header.className = "inventory-tooltip__header";

    const title = document.createElement("strong");
    title.textContent = item.name;

    const category = document.createElement("span");
    category.textContent = CATEGORY_LABELS[item.category];

    header.append(title, category);

    const description = document.createElement("p");
    description.className = "inventory-tooltip__description";
    description.textContent = item.description;

    const meta = document.createElement("dl");
    meta.className = "inventory-tooltip__meta";
    this.appendStat(meta, "Ilość", String(item.quantity));
    if (item.containerCapacity !== undefined) {
      this.appendStat(meta, "Miejsca", String(item.containerCapacity));
    }

    const stats = item.stats ? Object.entries(item.stats) : [];
    if (stats.length > 0) {
      const statsTitle = document.createElement("div");
      statsTitle.className = "inventory-tooltip__section-title";
      statsTitle.textContent = "Statystyki";

      this.tooltip.append(header, description, meta, statsTitle);

      const statsList = document.createElement("dl");
      statsList.className = "inventory-tooltip__meta";
      for (const [label, value] of stats) {
        this.appendStat(statsList, label, String(value));
      }
      this.tooltip.appendChild(statsList);
    } else {
      this.tooltip.append(header, description, meta);
    }

    this.tooltip.hidden = false;
    this.positionTooltip(clientX, clientY);
  }

  private appendStat(
    list: HTMLDListElement,
    label: string,
    value: string
  ): void {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    row.append(term, description);
    list.appendChild(row);
  }

  private positionTooltip(clientX: number, clientY: number): void {
    if (this.tooltip.hidden) return;

    const margin = 12;
    const gap = 14;
    const rect = this.tooltip.getBoundingClientRect();

    let left = clientX + gap;
    let top = clientY + gap;

    if (left + rect.width + margin > window.innerWidth) {
      left = clientX - rect.width - gap;
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = clientY - rect.height - gap;
    }

    this.tooltip.style.left = `${Math.max(margin, left)}px`;
    this.tooltip.style.top = `${Math.max(margin, top)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.hidden = true;
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Inventory panel element missing: ${selector}`);
    return element;
  }
}
