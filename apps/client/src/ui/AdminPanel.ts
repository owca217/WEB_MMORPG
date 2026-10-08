import type {
  AdminGrantRequest,
  AdminGrantResult,
  AdminItemCatalog,
  AdminItemDefinition,
  ItemCategory
} from "@web-mmorpg/shared";
import { InterfaceWindowControls } from "./InterfaceWindowControls";
import {
  adminItemCapacityLabel,
  createAdminOperationId,
  filterAdminItems,
  normalizeGrantQuantity,
  type AdminItemCategoryFilter
} from "./adminPanelViewModel";

interface AdminPanelHandlers {
  onRequestCatalog: () => void;
  onGrantItem: (payload: AdminGrantRequest) => void;
  onAccessRevoked?: () => void;
}

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  material: "Materiały",
  medical: "Medyczne",
  armor: "Pancerze",
  weapon: "Broń",
  accessory: "Dodatki",
  bag: "Torby"
};

const ITEM_ICONS: Record<string, string> = {
  "simple-bag": "🎒",
  "traditional-backpack": "🎒",
  "travel-backpack": "🎒",
  "expedition-backpack": "🎒",
  "wolf-pelt": "🐺",
  "field-bandage": "✚"
};

interface PendingGrant {
  payload: AdminGrantRequest;
  waiting: boolean;
}

export class AdminPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly category: HTMLSelectElement;
  private readonly quantity: HTMLInputElement;
  private readonly submit: HTMLButtonElement;
  private readonly selectedLabel: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly windowControls: InterfaceWindowControls;
  private readonly handlers: AdminPanelHandlers;
  private catalog: AdminItemCatalog = { items: [] };
  private selectedItemId: string | null = null;
  private pendingGrant: PendingGrant | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private accessRevoked = false;

  constructor(handlers: AdminPanelHandlers) {
    this.handlers = handlers;
    this.root = document.createElement("div");
    this.root.className = "game-panel admin-panel ui-window is-hidden";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Panel administratora");
    this.root.innerHTML = `
      <div class="game-panel__header admin-panel__header">
        <h2>Panel admin</h2>
      </div>
      <div class="admin-panel__body">
        <section class="admin-panel__tools" aria-label="Narzędzia administratora">
          <div class="admin-panel__tool-list" aria-label="Narzędzia">
            <button type="button" class="admin-panel__tool" data-admin-tool data-active aria-current="page">
              Przedmioty
            </button>
          </div>
          <div class="admin-panel__filters">
            <label class="admin-panel__field">
              <span>Szukaj</span>
              <input type="search" data-admin-search placeholder="Nazwa lub identyfikator" autocomplete="off">
            </label>
            <label class="admin-panel__field">
              <span>Kategoria</span>
              <select data-admin-category>
                <option value="all">Wszystkie</option>
              </select>
            </label>
          </div>
          <div class="admin-panel__catalog" data-admin-list role="listbox" aria-label="Przedmioty"></div>
        </section>
        <form class="admin-panel__grant" data-admin-form>
          <div class="admin-panel__selection">
            <span class="admin-panel__selection-label">Wybrany przedmiot</span>
            <strong data-admin-selected>Nie wybrano przedmiotu.</strong>
          </div>
          <label class="admin-panel__field admin-panel__quantity">
            <span>Ilość</span>
            <input data-admin-quantity type="number" min="1" max="1000" step="1" value="1" inputmode="numeric">
          </label>
          <button type="submit" data-admin-submit disabled>Dodaj do ekwipunku</button>
          <p class="admin-panel__status" data-admin-status role="status" aria-live="polite"></p>
        </form>
      </div>
    `;
    document.body.appendChild(this.root);

    this.list = this.require<HTMLDivElement>("[data-admin-list]");
    this.search = this.require<HTMLInputElement>("[data-admin-search]");
    this.category = this.require<HTMLSelectElement>("[data-admin-category]");
    this.quantity = this.require<HTMLInputElement>("[data-admin-quantity]");
    this.submit = this.require<HTMLButtonElement>("[data-admin-submit]");
    this.selectedLabel = this.require("[data-admin-selected]");
    this.status = this.require<HTMLParagraphElement>("[data-admin-status]");

    for (const [value, label] of Object.entries(CATEGORY_LABELS)) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      this.category.appendChild(option);
    }

    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".admin-panel__header"),
      onClose: () => this.hide()
    });

    this.search.addEventListener("input", () => this.renderList());
    this.category.addEventListener("change", () => this.renderList());
    this.quantity.addEventListener("input", () => this.updateSubmitState());
    this.root.addEventListener("keydown", (event) => event.stopPropagation());
    this.require<HTMLFormElement>("[data-admin-form]").addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        this.submitGrant();
      }
    );
  }

  show(): void {
    if (this.accessRevoked) return;
    this.root.classList.remove("is-hidden");
    this.handlers.onRequestCatalog();
    this.search.focus();
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  setCatalog(catalog: AdminItemCatalog): void {
    if (this.accessRevoked) return;
    this.catalog = {
      items: catalog.items.map((item) => ({ ...item }))
    };
    if (!this.catalog.items.some((item) => item.itemId === this.selectedItemId)) {
      this.selectedItemId = null;
    }
    this.renderList();
  }

  handleGrantResult(result: AdminGrantResult): void {
    if (!this.pendingGrant || result.operationId !== this.pendingGrant.payload.operationId) return;
    this.clearPendingTimer();

    if (result.ok) {
      this.pendingGrant = null;
      this.status.textContent = "Przedmiot został dodany do ekwipunku.";
      this.submit.textContent = "Dodaj do ekwipunku";
      this.renderList();
      this.updateSubmitState();
      return;
    }

    if (result.code === "ADMIN_REQUIRED") {
      this.revokeAccess();
      return;
    }

    if (result.code === "PERSISTENCE_FAILED") {
      this.pendingGrant.waiting = false;
      this.status.textContent = "Nie udało się potwierdzić zapisu. Możesz ponowić tę samą operację.";
      this.submit.textContent = "Ponów operację";
      this.renderList();
      this.updateSubmitState();
      return;
    }

    this.pendingGrant = null;
    this.status.textContent = result.message;
    this.submit.textContent = "Dodaj do ekwipunku";
    this.renderList();
    this.updateSubmitState();
  }

  revokeAccess(): void {
    if (this.accessRevoked) return;
    this.accessRevoked = true;
    this.clearPendingTimer();
    this.pendingGrant = null;
    this.hide();
    this.handlers.onAccessRevoked?.();
  }

  destroy(): void {
    this.clearPendingTimer();
    this.windowControls.destroy();
    this.root.remove();
  }

  private submitGrant(): void {
    if (this.pendingGrant?.waiting) return;
    if (this.pendingGrant) {
      this.pendingGrant.waiting = true;
      this.status.textContent = "Ponawianie operacji…";
      this.submit.textContent = "Dodawanie…";
      this.handlers.onGrantItem(this.pendingGrant.payload);
      this.startPendingTimer();
      this.updateSubmitState();
      return;
    }

    const selected = this.selectedItemId
      ? this.catalog.items.find((item) => item.itemId === this.selectedItemId)
      : undefined;
    if (!selected) {
      this.status.textContent = "Wybierz przedmiot z listy.";
      return;
    }

    const quantity = normalizeGrantQuantity(this.quantity.value);
    if (!quantity.ok) {
      this.status.textContent = quantity.message;
      return;
    }

    const payload: AdminGrantRequest = {
      operationId: createAdminOperationId(),
      itemId: selected.itemId,
      quantity: quantity.value
    };
    this.pendingGrant = { payload, waiting: true };
    this.status.textContent = "Dodawanie…";
    this.submit.textContent = "Dodawanie…";
    this.handlers.onGrantItem(payload);
    this.startPendingTimer();
    this.renderList();
    this.updateSubmitState();
  }

  private startPendingTimer(): void {
    this.clearPendingTimer();
    this.pendingTimer = setTimeout(() => {
      if (!this.pendingGrant?.waiting) return;
      this.pendingGrant.waiting = false;
      this.status.textContent = "Brak potwierdzenia. Możesz ponowić tę samą operację.";
      this.submit.textContent = "Ponów operację";
      this.updateSubmitState();
    }, 10_000);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer === undefined) return;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
  }

  private renderList(): void {
    const category = this.category.value as AdminItemCategoryFilter;
    const items = filterAdminItems(this.catalog, this.search.value, category);
    this.list.replaceChildren();

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "admin-panel__empty";
      empty.textContent = "Brak przedmiotów spełniających kryteria.";
      this.list.appendChild(empty);
      this.updateSubmitState();
      return;
    }

    for (const item of items) this.list.appendChild(this.createItemRow(item));
    this.updateSubmitState();
  }

  private createItemRow(item: AdminItemDefinition): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-panel__item";
    button.dataset.itemId = item.itemId;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(this.selectedItemId === item.itemId));
    button.disabled = this.pendingGrant !== null;
    if (this.selectedItemId === item.itemId) button.dataset.selected = "true";

    const icon = document.createElement("span");
    icon.className = "admin-panel__item-icon";
    icon.textContent = ITEM_ICONS[item.itemId] ?? "◆";
    icon.setAttribute("aria-hidden", "true");

    const details = document.createElement("span");
    details.className = "admin-panel__item-details";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const id = document.createElement("small");
    id.textContent = item.itemId;
    const description = document.createElement("span");
    description.textContent = item.description;
    details.append(name, id, description);

    const category = document.createElement("span");
    category.className = "admin-panel__item-category";
    category.textContent = CATEGORY_LABELS[item.category];

    const capacity = adminItemCapacityLabel(item);
    const capacityNode = document.createElement("span");
    capacityNode.className = "admin-panel__item-capacity";
    capacityNode.textContent = capacity;
    details.append(capacityNode);

    button.append(icon, details, category);
    button.addEventListener("click", () => {
      this.selectedItemId = item.itemId;
      this.status.textContent = "";
      this.selectedLabel.textContent = item.name;
      this.renderList();
    });
    return button;
  }

  private updateSubmitState(): void {
    const selected = this.selectedItemId
      ? this.catalog.items.some((item) => item.itemId === this.selectedItemId)
      : false;
    this.selectedLabel.textContent = selected
      ? this.catalog.items.find((item) => item.itemId === this.selectedItemId)?.name ?? ""
      : "Nie wybrano przedmiotu.";
    this.submit.disabled = !selected || this.pendingGrant?.waiting === true;
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Admin panel element missing: ${selector}`);
    return element;
  }
}

export type { AdminPanelHandlers };
