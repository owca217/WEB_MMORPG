import { AdminApi, AdminApiRequestError } from "../net/AdminApi";
import { ItemCatalogView } from "./admin/ItemCatalogView";

export class AdminPanel {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private catalogView: ItemCatalogView | null = null;

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
  }

  async showCatalog(): Promise<void> {
    this.root.classList.remove("is-hidden");
    this.catalogView?.destroy();
    this.content.replaceChildren();
    this.catalogView = new ItemCatalogView(this.content, this.api, {
      onPreview: (itemId) => void this.showPreview(itemId),
      onEdit: (itemId) => this.showCreator(itemId),
      onHistory: (itemId) => this.showHistoryPlaceholder(itemId)
    });
    await this.catalogView.show();
  }

  showCreator(itemId?: string): void {
    this.root.classList.remove("is-hidden");
    this.catalogView?.destroy();
    this.catalogView = null;
    this.content.innerHTML = `
      <section class="admin-placeholder" data-creator-placeholder>
        <h3>Kreator przedmiotu</h3>
        <p>${itemId ? `Edycja: ${escapeHtml(itemId)}` : "Nowy przedmiot"}</p>
        <p>Widok kreatora zostanie osadzony w tym miejscu.</p>
      </section>
    `;
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  destroy(): void {
    this.catalogView?.destroy();
    this.catalogView = null;
    this.root.remove();
  }

  private async showPreview(itemId: string): Promise<void> {
    this.catalogView?.destroy();
    this.catalogView = null;
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

  private showHistoryPlaceholder(itemId: string): void {
    this.catalogView?.destroy();
    this.catalogView = null;
    this.content.innerHTML = `
      <section class="admin-placeholder" data-history-placeholder>
        <h3>Historia wersji</h3>
        <p>${escapeHtml(itemId)}</p>
        <p>Widok historii zostanie osadzony w tym miejscu.</p>
      </section>
    `;
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Admin panel element missing: ${selector}`);
    return element;
  }
}

function escapeHtml(value: string): string {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
