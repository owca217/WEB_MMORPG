import type {
  ItemCatalogQuery,
  ItemCreatorMetadata,
  ItemDefinition
} from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError } from "../../net/AdminApi";

export interface ItemCatalogHandlers {
  onPreview(itemId: string): void;
  onEdit(itemId: string): void;
  onHistory(itemId: string): void;
}

export class ItemCatalogView {
  private metadata: ItemCreatorMetadata | null = null;
  private readonly clickHandler = (event: Event) => void this.handleClick(event);
  private readonly submitHandler = (event: Event) => void this.handleSubmit(event);

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AdminApi,
    private readonly handlers: ItemCatalogHandlers
  ) {
    this.host.addEventListener("click", this.clickHandler);
    this.host.addEventListener("submit", this.submitHandler);
  }

  async show(): Promise<void> {
    this.renderShell();
    this.setState("Ładowanie katalogu...");

    try {
      this.metadata = await this.api.getMetadata();
      this.renderFilters();
      await this.loadItems(this.readFilters());
    } catch (error) {
      this.renderError(error);
    }
  }

  destroy(): void {
    this.host.removeEventListener("click", this.clickHandler);
    this.host.removeEventListener("submit", this.submitHandler);
    this.host.replaceChildren();
  }

  private renderShell(): void {
    this.host.innerHTML = `
      <section class="admin-catalog">
        <form class="admin-catalog__filters" data-filters>
          <input data-filter="search" type="search" placeholder="Nazwa lub Item ID" aria-label="Szukaj" />
          <input data-filter="itemId" type="text" placeholder="Item ID" aria-label="Item ID" />
          <select data-filter="categoryId" aria-label="Kategoria"><option value="">Wszystkie kategorie</option></select>
          <select data-filter="subcategoryId" aria-label="Podkategoria"><option value="">Wszystkie podkategorie</option></select>
          <select data-filter="rarity" aria-label="Rzadkość">
            <option value="">Każda rzadkość</option>
            <option value="COMMON">Common</option>
            <option value="UNCOMMON">Uncommon</option>
            <option value="RARE">Rare</option>
            <option value="EPIC">Epic</option>
            <option value="LEGENDARY">Legendary</option>
          </select>
          <input data-filter="minimumLevel" type="number" min="0" placeholder="Poziom od" aria-label="Poziom od" />
          <input data-filter="maximumLevel" type="number" min="0" placeholder="Poziom do" aria-label="Poziom do" />
          <select data-filter="status" aria-label="Status">
            <option value="">Każdy status</option>
            <option value="DRAFT">Szkic</option>
            <option value="PUBLISHED">Opublikowany</option>
            <option value="ARCHIVED">Archiwalny</option>
          </select>
          <button type="submit">Filtruj</button>
        </form>
        <div class="admin-catalog__state" data-state></div>
        <div class="admin-catalog__list" data-list></div>
      </section>
    `;
  }

  private renderFilters(): void {
    if (!this.metadata) return;
    const category = this.require<HTMLSelectElement>("[data-filter='categoryId']");
    const subcategory = this.require<HTMLSelectElement>("[data-filter='subcategoryId']");

    for (const item of this.metadata.categories) {
      category.append(new Option(item.name, item.id));
    }
    for (const item of this.metadata.subcategories) {
      subcategory.append(new Option(item.name, item.id));
    }
  }

  private async loadItems(query: ItemCatalogQuery): Promise<void> {
    this.setState("Ładowanie przedmiotów...");
    this.require<HTMLElement>("[data-list]").replaceChildren();

    try {
      const page = await this.api.listItems(query);
      const list = this.require<HTMLElement>("[data-list]");
      list.replaceChildren();
      if (page.items.length === 0) {
        this.setState("Brak przedmiotów pasujących do filtrów.");
        return;
      }

      this.setState(`${page.total} przedmiotów`);
      for (const item of page.items) list.append(this.renderItem(item));
    } catch (error) {
      this.renderError(error);
    }
  }

  private renderItem(item: ItemDefinition): HTMLElement {
    const row = document.createElement("article");
    row.className = "admin-catalog-item";
    row.dataset.itemId = item.itemId;

    const title = document.createElement("div");
    title.className = "admin-catalog-item__title";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.textContent = `${item.itemId} • ${item.categoryId}${item.subcategoryId ? ` / ${item.subcategoryId}` : ""} • ${item.rarity} • Lv.${item.itemLevel} • ${item.status}`;
    title.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "admin-catalog-item__actions";
    for (const [action, label] of [
      ["preview", "Podgląd"],
      ["edit", "Edytuj"],
      ["duplicate", "Duplikuj"],
      ["archive", "Archiwizuj"],
      ["history", "Historia"]
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.dataset.itemId = item.itemId;
      button.textContent = label;
      actions.append(button);
    }

    row.append(title, actions);
    return row;
  }

  private async handleClick(event: Event): Promise<void> {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-action]");
    if (!button || !this.host.contains(button)) return;
    const itemId = button.dataset.itemId;
    const action = button.dataset.action;
    if (!itemId || !action) return;

    if (action === "preview") {
      this.handlers.onPreview(itemId);
      return;
    }
    if (action === "edit") {
      this.handlers.onEdit(itemId);
      return;
    }
    if (action === "history") {
      this.handlers.onHistory(itemId);
      return;
    }

    if (action === "duplicate") {
      if (!window.confirm(`Duplikować ${itemId}?`)) return;
      const proposed = window.prompt("Nowe Item ID:", `${itemId}-copy`)?.trim();
      if (!proposed) return;
      try {
        await this.api.duplicateItem(itemId, proposed);
        await this.loadItems(this.readFilters());
      } catch (error) {
        this.renderError(error);
      }
      return;
    }

    if (action === "archive") {
      if (!window.confirm(`Zarchiwizować ${itemId}?`)) return;
      try {
        await this.api.archiveItem(itemId);
        await this.loadItems(this.readFilters());
      } catch (error) {
        this.renderError(error);
      }
    }
  }

  private async handleSubmit(event: Event): Promise<void> {
    const form = event.target as HTMLFormElement | null;
    if (!form?.matches("[data-filters]")) return;
    event.preventDefault();
    await this.loadItems(this.readFilters());
  }

  private readFilters(): ItemCatalogQuery {
    const query: ItemCatalogQuery = { page: 1, pageSize: 20 };
    const setText = (key: "search" | "itemId" | "categoryId" | "subcategoryId") => {
      const value = this.require<HTMLInputElement | HTMLSelectElement>(`[data-filter='${key}']`).value.trim();
      if (value) query[key] = value;
    };
    setText("search");
    setText("itemId");
    setText("categoryId");
    setText("subcategoryId");

    const rarity = this.require<HTMLSelectElement>("[data-filter='rarity']").value;
    if (rarity) query.rarity = rarity as NonNullable<ItemCatalogQuery["rarity"]>;
    const status = this.require<HTMLSelectElement>("[data-filter='status']").value;
    if (status) query.status = status as NonNullable<ItemCatalogQuery["status"]>;

    const min = this.numberFilter("minimumLevel");
    const max = this.numberFilter("maximumLevel");
    if (min !== undefined) query.minimumLevel = min;
    if (max !== undefined) query.maximumLevel = max;
    return query;
  }

  private numberFilter(name: string): number | undefined {
    const raw = this.require<HTMLInputElement>(`[data-filter='${name}']`).value.trim();
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private renderError(error: unknown): void {
    const message = error instanceof AdminApiRequestError || error instanceof Error
      ? error.message
      : "Nie udało się załadować katalogu.";
    this.setState(message, true);
  }

  private setState(message: string, isError = false): void {
    const state = this.require<HTMLElement>("[data-state]");
    state.textContent = message;
    state.classList.toggle("is-error", isError);
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`ItemCatalogView element missing: ${selector}`);
    return element;
  }
}
