import type {
  ItemDraftInput,
  ItemVersion,
  ItemVersionSummary
} from "@web-mmorpg/shared";
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
      const comparisonVersions = await this.loadComparisonVersions(audit);
      if (this.destroyed) return;
      this.render(versions, audit, comparisonVersions);
    } catch (error) {
      if (this.destroyed) return;
      this.host.textContent = this.errorMessage(error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.host.replaceChildren();
  }

  private async loadComparisonVersions(
    audit: AdminAuditEntry[]
  ): Promise<Map<number, ItemVersion>> {
    const versionNos = new Set<number>();

    for (const entry of audit) {
      if (readChangedFields(entry.summary).length > 0) continue;
      if (entry.fromVersion !== undefined && entry.toVersion !== undefined) {
        versionNos.add(entry.fromVersion);
        versionNos.add(entry.toVersion);
      }
    }

    const loaded = await Promise.all(
      [...versionNos].sort((a, b) => a - b).map(async (versionNo) => {
        const version = await this.api.getVersion(this.itemId, versionNo);
        return [versionNo, version] as const;
      })
    );

    return new Map(loaded);
  }

  private render(
    versions: ItemVersionSummary[],
    audit: AdminAuditEntry[],
    comparisonVersions: ReadonlyMap<number, ItemVersion>
  ): void {
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
        let changedFields = readChangedFields(entry.summary);

        if (changedFields.length === 0 && entry.fromVersion !== undefined && entry.toVersion !== undefined) {
          const before = comparisonVersions.get(entry.fromVersion);
          const after = comparisonVersions.get(entry.toVersion);
          if (before && after) changedFields = diffItemVersions(before, after);
        }

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

const COMPARABLE_FIELDS: ReadonlyArray<keyof ItemDraftInput> = [
  "name",
  "categoryId",
  "subcategoryId",
  "description",
  "iconKey",
  "iconUrl",
  "rarity",
  "itemLevel",
  "minimumLevel",
  "sellValue",
  "sellable",
  "tradable",
  "droppable",
  "stackable",
  "maxStack",
  "weight",
  "soulbound",
  "unique",
  "tags",
  "stats",
  "requirements",
  "effects",
  "specialData"
];

function diffItemVersions(before: ItemVersion, after: ItemVersion): string[] {
  return COMPARABLE_FIELDS.filter(
    (field) => canonicalJson(before[field]) !== canonicalJson(after[field])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((entry) => canonicalize(entry))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value ?? null;
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
