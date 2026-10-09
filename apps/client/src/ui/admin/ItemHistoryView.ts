import type { ItemVersion, ItemVersionSummary } from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError, type AdminAuditEntry } from "../../net/AdminApi";

export interface ItemHistoryHandlers {
  onRestored?: (version: ItemVersion) => void;
  onBack?: () => void;
}

export class ItemHistoryView {
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AdminApi,
    private readonly itemId: string,
    private readonly handlers: ItemHistoryHandlers = {}
  ) {}

  async show(): Promise<void> {
    this.host.innerHTML = `<p class="admin-panel__loading">Ładowanie historii wersji...</p>`;
    try {
      const [versions, audit] = await Promise.all([
        this.api.listVersions(this.itemId),
        this.api.getAudit("item", this.itemId)
      ]);
      if (this.destroyed) return;
      this.render(versions, audit);
    } catch (error) {
      if (this.destroyed) return;
      this.host.textContent = this.errorMessage(error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.host.replaceChildren();
  }

  private render(versions: ItemVersionSummary[], audit: AdminAuditEntry[]): void {
    this.host.replaceChildren();
    const root = document.createElement("section");
    root.className = "item-history";

    const header = document.createElement("div");
    header.className = "item-history__header";
    const heading = document.createElement("h3");
    heading.textContent = `Historia: ${this.itemId}`;
    header.append(heading);
    if (this.handlers.onBack) {
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "← Katalog";
      back.addEventListener("click", () => this.handlers.onBack?.());
      header.append(back);
    }
    root.append(header);

    const status = document.createElement("div");
    status.className = "item-history__status";
    status.dataset.historyStatus = "";
    root.append(status);

    if (versions.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Brak zapisanych wersji.";
      root.append(empty);
      this.host.append(root);
      return;
    }

    const list = document.createElement("div");
    list.className = "item-history__list";
    for (const version of versions) {
      const card = document.createElement("article");
      card.className = "item-history__version";
      card.dataset.version = String(version.versionNo);

      const title = document.createElement("strong");
      title.textContent = `v${version.versionNo} • ${version.state}`;
      const meta = document.createElement("p");
      meta.textContent = `${version.createdBy} • ${formatDate(version.createdAt)} • rewizja ${version.revision}`;
      card.append(title, meta);

      const relatedChanges = audit.filter((entry) => entry.toVersion === version.versionNo);
      for (const entry of relatedChanges) {
        const change = document.createElement("div");
        change.className = "item-history__change";
        const from = entry.fromVersion ?? Math.max(1, version.versionNo - 1);
        const to = entry.toVersion ?? version.versionNo;
        const changedFields = readChangedFields(entry.summary);
        const transition = document.createElement("b");
        transition.textContent = `v${from} → v${to}`;
        const fields = document.createElement("span");
        fields.textContent = changedFields.length > 0
          ? ` Zmienione pola: ${changedFields.join(", ")}`
          : ` ${entry.action}`;
        change.append(transition, fields);
        card.append(change);
      }

      const restore = document.createElement("button");
      restore.type = "button";
      restore.dataset.restoreVersion = String(version.versionNo);
      restore.textContent = `Przywróć v${version.versionNo}`;
      restore.addEventListener("click", () => {
        void this.restoreVersion(version.versionNo, status);
      });
      card.append(restore);
      list.append(card);
    }

    root.append(list);
    this.host.append(root);
  }

  private async restoreVersion(versionNo: number, status: HTMLElement): Promise<void> {
    if (!window.confirm(`Przywrócić v${versionNo} jako nową aktywną wersję?`)) return;
    status.textContent = `Przywracanie v${versionNo}...`;
    try {
      const restored = await this.api.restoreVersion(this.itemId, versionNo);
      status.textContent = `Przywrócono v${versionNo} jako nową aktywną wersję v${restored.versionNo}.`;
      this.handlers.onRestored?.(restored);
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof AdminApiRequestError || error instanceof Error) return error.message;
    return "Nie udało się załadować historii wersji.";
  }
}

function readChangedFields(summary: Record<string, unknown>): string[] {
  const value = summary.changedFields;
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  const changes = summary.changes;
  if (changes && typeof changes === "object" && !Array.isArray(changes)) {
    return Object.keys(changes as Record<string, unknown>);
  }
  return [];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pl-PL");
}
