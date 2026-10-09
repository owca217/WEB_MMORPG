import { AdminApi, AdminApiRequestError } from "../net/AdminApi";
import { CategoryManagerView } from "./admin/CategoryManagerView";
import { ItemCatalogView } from "./admin/ItemCatalogView";
import { ItemCreatorView } from "./admin/ItemCreatorView";
import { ItemHistoryView } from "./admin/ItemHistoryView";

export class AdminPanel {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private catalogView: ItemCatalogView | null = null;
  private creatorView: ItemCreatorView | null = null;
  private historyView: ItemHistoryView | null = null;
  private categoryManagerView: CategoryManagerView | null = null;

  constructor(private readonly api: AdminApi) {
    this.root = document.createElement("div");
    this.root.className = "game-panel admin-panel is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header admin-panel__header">
        <div>
          <h2>Panel ADMIN</h2>
          <nav class="admin-panel__nav" aria-label="Nawigacja administratora">
            <button type="button" data-catalog>Katalog</button>
            <button type="button" data-create>Nowy przedmiot</button>
            <button type="button" data-categories>Kategorie</button>
          </nav>
        </div>
        <button type="button" data-close aria-label="Zamknij">×</button>
      </div>
      <div class="admin-panel__content" data-content></div>
    `;
    document.body.appendChild(this.root);
    this.content = this.require<HTMLDivElement>("[data-content]");

    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
    this.require<HTMLButtonElement>("[data-catalog]").addEventListener("click", () => {
      void this.showCatalog();
    });
    this.require<HTMLButtonElement>("[data-create]").addEventListener("click", () => {
      this.showCreator();
    });
    this.require<HTMLButtonElement>("[data-categories]").addEventListener("click", () => {
      void this.showCategories();
    });
  }

  async showCatalog(): Promise<void> {
    this.root.classList.remove("is-hidden");
    this.destroyActiveView();
    this.content.replaceChildren();
    this.catalogView = new ItemCatalogView(this.content, this.api, {
      onPreview: (itemId) => void this.showPreview(itemId),
      onEdit: (itemId) => this.showCreator(itemId),
      onHistory: (itemId) => void this.showHistory(itemId)
    });
    await this.catalogView.show();
  }

  showCreator(itemId?: string): void {
    this.root.classList.remove("is-hidden");
    this.destroyActiveView();
    this.content.replaceChildren();
    this.creatorView = new ItemCreatorView(this.content, this.api, {
      onCancel: () => void this.showCatalog(),
      onPublished: () => void this.showCatalog()
    });
    void this.creatorView.loadMetadata(itemId).catch((error: unknown) => {
      const message = error instanceof AdminApiRequestError || error instanceof Error
        ? error.message
        : "Nie udało się otworzyć kreatora.";
      this.content.textContent = message;
    });
  }

  async showHistory(itemId: string): Promise<void> {
    this.root.classList.remove("is-hidden");
    this.destroyActiveView();
    this.content.replaceChildren();
    this.historyView = new ItemHistoryView(this.content, this.api, itemId, {
      onBack: () => void this.showCatalog(),
      onRestored: () => void this.showCatalog()
    });
    await this.historyView.show();
  }

  async showCategories(): Promise<void> {
    this.root.classList.remove("is-hidden");
    this.destroyActiveView();
    this.content.replaceChildren();
    this.categoryManagerView = new CategoryManagerView(this.content, this.api, {
      onBack: () => void this.showCatalog()
    });
    await this.categoryManagerView.show();
  }

  hide(): void {
    if (this.creatorView && !this.creatorView.cancel()) return;
    this.destroyActiveView();
    this.root.classList.add("is-hidden");
  }

  destroy(): void {
    this.destroyActiveView();
    this.root.remove();
  }

  private async showPreview(itemId: string): Promise<void> {
    this.destroyActiveView();
    this.content.innerHTML = `<p class="admin-panel__loading">Ładowanie podglądu...</p>`;
    try {
      const details = await this.api.getItem(itemId);
      const item = details.item;
      this.content.replaceChildren();
      const section = document.createElement("section");
      section.className = "admin-preview";
      const heading = document.createElement("h3");
      heading.textContent = item.name;
      const meta = document.createElement("p");
      meta.textContent = `${item.itemId} • ${item.categoryId} • ${item.rarity} • Lv.${item.itemLevel} • ${item.status}`;
      const description = document.createElement("p");
      description.textContent = item.description;
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "← Wróć do katalogu";
      back.addEventListener("click", () => void this.showCatalog());
      section.append(heading, meta, description, back);
      this.content.append(section);
    } catch (error) {
      const message = error instanceof AdminApiRequestError || error instanceof Error
        ? error.message
        : "Nie udało się załadować podglądu.";
      this.content.textContent = message;
    }
  }

  private destroyActiveView(): void {
    this.catalogView?.destroy();
    this.creatorView?.destroy();
    this.historyView?.destroy();
    this.categoryManagerView?.destroy();
    this.catalogView = null;
    this.creatorView = null;
    this.historyView = null;
    this.categoryManagerView = null;
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Admin panel element missing: ${selector}`);
    return element;
  }
}
