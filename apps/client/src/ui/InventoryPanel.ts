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
  CONTAINER_SLOT_DRAG_TYPE,
  INVENTORY_ITEM_DRAG_TYPE,
  type ContainerPointerDragPayload
} from "./containerDrag";
import { resolveInventoryDropAction } from "./inventoryDropRouting";
import { fitInventoryTitleFontSize, inventoryPanelTitle } from "./inventoryTitle";
import { getInventoryView } from "./inventoryViewModel";

const CATEGORY_LABELS = {
  material: "Materiał",
  medical: "Medyczne",
  armor: "Pancerz",
  weapon: "Broń",
  accessory: "Dodatek",
  bag: "Torby"
} as const;

const ITEM_ICONS: Record<string, string> = {
  "wolf-pelt": "🐺",
  "field-bandage": "✚",
  "simple-bag": "🎒"
};

interface InventoryPanelOptions {
  onEquipContainer?: (slot: BagEquipmentSlot, itemInstanceId: string) => void;
  onUnequipContainer?: (slot: BagEquipmentSlot) => void;
  onMoveItem?: (itemInstanceId: string, containerInstanceId: string | null) => void;
}

type InventoryItemWithStats = InventoryItem & {
  stats?: Record<string, string | number>;
};

export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly bagList: HTMLDivElement;
  private readonly workspace: HTMLDivElement;
  private readonly panelTitle: HTMLHeadingElement;
  private readonly generalPane: HTMLElement;
  private readonly bagPane: HTMLElement;
  private readonly bagCapacity: HTMLElement;
  private readonly generalDropTarget: HTMLButtonElement;
  private readonly tooltip: HTMLDivElement;
  private readonly windowControls: InterfaceWindowControls;
  private readonly onEquipContainer:
    | ((slot: BagEquipmentSlot, itemInstanceId: string) => void)
    | undefined;
  private readonly onUnequipContainer:
    | ((slot: BagEquipmentSlot) => void)
    | undefined;
  private readonly onMoveItem:
    | ((itemInstanceId: string, containerInstanceId: string | null) => void)
    | undefined;
  private selectedBagId: string | null = null;
  private snapshot: InventorySnapshot = { items: [] };
  private pinnedItemId: string | null = null;
  private readonly onDocumentPointerDown: (event: PointerEvent) => void;
  private readonly onViewportResize = (): void => this.fitPanelTitle();

  constructor(options: InventoryPanelOptions = {}) {
    this.onEquipContainer = options.onEquipContainer;
    this.onUnequipContainer = options.onUnequipContainer;
    this.onMoveItem = options.onMoveItem;
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--inventory is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2 data-inventory-title>Ekwipunek</h2>
      </div>
      <div class="inventory-workspace" data-mode="general">
        <section class="inventory-pane inventory-pane--general" data-general-pane aria-label="Przedmioty">
          <div class="inventory-pane__header"><h3>Przedmioty</h3></div>
          <div class="inventory-list" data-list data-inventory-drop-target="general"></div>
        </section>
        <section class="inventory-pane inventory-pane--bag" data-bag-pane aria-label="Zawartość torby" hidden>
          <div class="inventory-pane__header">
            <span data-bag-capacity></span>
            <button class="inventory-pane__transfer" type="button"
              data-inventory-drop-target="general" title="Otwórz ekwipunek lub upuść tu przedmiot">
              Do ekwipunku
            </button>
          </div>
          <div class="inventory-list inventory-list--bag" data-bag-list data-inventory-drop-target="" hidden></div>
        </section>
      </div>
    `;
    document.body.appendChild(this.root);

    this.list = this.require<HTMLDivElement>("[data-list]");
    this.bagList = this.require<HTMLDivElement>("[data-bag-list]");
    this.workspace = this.require<HTMLDivElement>(".inventory-workspace");
    this.panelTitle = this.require<HTMLHeadingElement>("[data-inventory-title]");
    this.generalPane = this.require<HTMLElement>("[data-general-pane]");
    this.bagPane = this.require<HTMLElement>("[data-bag-pane]");
    this.bagCapacity = this.require<HTMLElement>("[data-bag-capacity]");
    this.generalDropTarget = this.require<HTMLButtonElement>(".inventory-pane__transfer");
    this.generalDropTarget.addEventListener("click", () => this.openGeneralInventory());
    this.bindDropHandlers(this.list);
    this.bindDropHandlers(this.bagList);
    this.bindDropHandlers(this.generalDropTarget);
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
    window.addEventListener("resize", this.onViewportResize);
  }

  update(snapshot: InventorySnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  openBagStorage(containerInstanceId: string): void {
    this.selectedBagId = containerInstanceId;
    this.show();
    this.render();
  }

  openGeneralInventory(): void {
    this.selectedBagId = null;
    this.show();
    this.render();
  }

  private render(): void {
    const view = getInventoryView(this.snapshot, this.selectedBagId);
    if (!view.selectedBag) this.selectedBagId = null;
    const showingBag = Boolean(view.selectedBag);
    this.workspace.dataset.mode = showingBag ? "bag" : "general";
    this.generalPane.hidden = showingBag;
    this.bagPane.hidden = !showingBag;
    this.panelTitle.textContent = inventoryPanelTitle(view.selectedBag?.name ?? null);
    this.fitPanelTitle();

    this.list.replaceChildren();
    this.pinnedItemId = null;
    this.hideTooltip();

    if (view.generalItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "game-panel__empty";
      empty.textContent = "Ekwipunek jest pusty.";
      this.list.appendChild(empty);
    } else {
      for (const item of view.generalItems) {
        this.list.appendChild(this.createItemSlot(item));
      }
    }

    this.bagCapacity.textContent = view.selectedBag
      ? `${view.occupiedSlots} / ${view.capacity} miejsc`
      : "";
    this.bagList.replaceChildren();
    this.bagList.hidden = !view.selectedBag;
    if (view.selectedBag) {
      this.bagList.dataset.inventoryDropTarget = view.selectedBag.instanceId;
      this.bagList.dataset.scrollable = String(view.isScrollable);
      this.bagList.style.setProperty(
        "--bag-visible-height",
        `${view.visibleRows * 36 + 10}px`
      );
      for (let index = 0; index < view.capacity; index += 1) {
        const item = view.bagContents[index];
        if (item) {
          this.bagList.appendChild(this.createItemSlot(item));
        } else {
          const emptySlot = document.createElement("div");
          emptySlot.className = "inventory-slot inventory-slot--empty";
          emptySlot.setAttribute("aria-label", `Wolne miejsce ${index + 1}`);
          emptySlot.setAttribute("aria-hidden", "true");
          this.bagList.appendChild(emptySlot);
        }
      }
    } else {
      delete this.bagList.dataset.inventoryDropTarget;
      delete this.bagList.dataset.scrollable;
      this.bagList.style.removeProperty("--bag-visible-height");
    }
  }

  private createItemSlot(item: InventoryItem): HTMLButtonElement {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = `inventory-slot inventory-slot--${item.category}`;
    slot.dataset.itemId = item.instanceId;
    slot.draggable = true;
    slot.setAttribute("aria-label", `${item.name}, ilość: ${item.quantity}`);

    const icon = document.createElement("span");
    icon.className = "inventory-slot__icon";
    icon.textContent = ITEM_ICONS[item.itemId] ??
      (item.category === "bag" ? "🎒" : item.category === "medical" ? "✚" : "◆");
    slot.appendChild(icon);

    if (item.quantity > 1) {
      const quantity = document.createElement("span");
      quantity.className = "inventory-slot__quantity";
      quantity.textContent = String(item.quantity);
      slot.appendChild(quantity);
    }

    bindContainerPointerDrag(
      slot,
      () => ({ itemInstanceId: item.instanceId, canEquip: item.category === "bag" }),
      (target, payload) => this.handlePointerDrop(item, target, payload)
    );
    slot.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "move";
      const dragType = item.category === "bag"
        ? CONTAINER_ITEM_DRAG_TYPE
        : INVENTORY_ITEM_DRAG_TYPE;
      event.dataTransfer.setData(dragType, item.instanceId);
    });
    slot.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "touch") return;
      this.showTooltip(item, event.clientX, event.clientY);
    });
    slot.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || this.pinnedItemId) return;
      this.positionTooltip(event.clientX, event.clientY);
    });
    slot.addEventListener("pointerleave", () => {
      if (this.pinnedItemId !== item.instanceId) this.hideTooltip();
    });
    slot.addEventListener("focus", () => {
      const rect = slot.getBoundingClientRect();
      this.showTooltip(item, rect.right + 8, rect.top + rect.height / 2);
    });
    slot.addEventListener("blur", () => {
      if (this.pinnedItemId !== item.instanceId) this.hideTooltip();
    });
    slot.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      if (this.pinnedItemId === item.instanceId) {
        this.pinnedItemId = null;
        this.hideTooltip();
        return;
      }

      this.pinnedItemId = item.instanceId;
      const rect = slot.getBoundingClientRect();
      this.showTooltip(item, rect.left + rect.width / 2, rect.bottom + 8);
    });

    return slot;
  }

  private bindDropHandlers(list: HTMLElement): void {
    list.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types;
      if (!types) return;
      const hasItem = types.includes(CONTAINER_ITEM_DRAG_TYPE)
        || types.includes(INVENTORY_ITEM_DRAG_TYPE);
      const hasEquippedBag = types.includes(CONTAINER_SLOT_DRAG_TYPE);
      if (!hasItem && !hasEquippedBag) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      list.dataset.dropTarget = "true";
    });
    list.addEventListener("dragleave", () => {
      delete list.dataset.dropTarget;
    });
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      delete list.dataset.dropTarget;
      const transfer = event.dataTransfer;
      if (!transfer) return;
      const destination = list.dataset.inventoryDropTarget;
      if (!destination) return;
      const itemInstanceId = transfer.getData(CONTAINER_ITEM_DRAG_TYPE)
        || transfer.getData(INVENTORY_ITEM_DRAG_TYPE);
      if (!itemInstanceId) return;
      const item = this.snapshot.items.find((entry) => entry.instanceId === itemInstanceId);
      if (!item) return;
      const sourceSlot = transfer.getData(CONTAINER_SLOT_DRAG_TYPE);
      const action = resolveInventoryDropAction(
        {
          itemInstanceId,
          isBag: item.category === "bag",
          ...(sourceSlot ? { sourceSlot: sourceSlot as BagEquipmentSlot } : {})
        },
        destination === "general"
          ? { type: "general" }
          : { type: "bag-content", containerInstanceId: destination }
      );
      this.applyDropAction(action);
    });
  }

  private handlePointerDrop(
    item: InventoryItem,
    target: Element | null,
    payload: ContainerPointerDragPayload
  ): void {
    this.pinnedItemId = null;
    this.hideTooltip();
    const equipmentSlot = target?.closest<HTMLButtonElement>("[data-container-slot]");
    if (equipmentSlot?.dataset.containerSlot) {
      this.applyDropAction(
        resolveInventoryDropAction(
          {
            itemInstanceId: payload.itemInstanceId,
            isBag: item.category === "bag",
            ...(payload.sourceSlot
              ? { sourceSlot: payload.sourceSlot as BagEquipmentSlot }
              : {})
          },
          {
            type: "bag-slot",
            slot: equipmentSlot.dataset.containerSlot as BagEquipmentSlot,
            containerInstanceId: equipmentSlot.dataset.itemInstanceId ?? null
          }
        )
      );
      return;
    }

    const dropTarget = target?.closest<HTMLElement>("[data-inventory-drop-target]");
    const destination = dropTarget?.dataset.inventoryDropTarget;
    if (!destination) return;
    this.applyDropAction(
      resolveInventoryDropAction(
        {
          itemInstanceId: payload.itemInstanceId,
          isBag: item.category === "bag",
          ...(payload.sourceSlot
            ? { sourceSlot: payload.sourceSlot as BagEquipmentSlot }
            : {})
        },
        destination === "general"
          ? { type: "general" }
          : { type: "bag-content", containerInstanceId: destination }
      )
    );
  }

  private applyDropAction(action: ReturnType<typeof resolveInventoryDropAction>): void {
    if (!action) return;
    if (action.type === "move-item") {
      this.onMoveItem?.(action.itemInstanceId, action.containerInstanceId);
    } else if (action.type === "equip-bag") {
      this.onEquipContainer?.(action.slot, action.itemInstanceId);
    } else {
      this.onUnequipContainer?.(action.slot);
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
    window.removeEventListener("resize", this.onViewportResize);
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

  private fitPanelTitle(): void {
    this.panelTitle.style.removeProperty("font-size");
    if (!this.selectedBagId || !this.panelTitle.textContent) return;

    const style = window.getComputedStyle(this.panelTitle);
    const baseFontSize = Number.parseFloat(style.fontSize);
    const availableTextWidth = this.panelTitle.clientWidth
      - Number.parseFloat(style.paddingLeft)
      - Number.parseFloat(style.paddingRight);
    if (availableTextWidth <= 0 || !Number.isFinite(baseFontSize)) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = `${style.fontStyle} ${style.fontWeight} ${baseFontSize}px ${style.fontFamily}`;
    const measuredTextWidth = context.measureText(this.panelTitle.textContent).width;
    const fittedFontSize = fitInventoryTitleFontSize(
      measuredTextWidth,
      availableTextWidth,
      baseFontSize
    );
    if (fittedFontSize < baseFontSize) {
      this.panelTitle.style.fontSize = `${fittedFontSize}px`;
    }
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Inventory panel element missing: ${selector}`);
    return element;
  }
}
