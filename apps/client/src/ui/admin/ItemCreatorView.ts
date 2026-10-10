import type {
  ItemCreatorMetadata,
  ItemDraftInput,
  ItemEffect,
  ItemRequirement,
  ItemStatModifier,
  ItemVersion
} from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError } from "../../net/AdminApi";
import { ItemTooltipPreview } from "./ItemTooltipPreview";

type StepId =
  | "category"
  | "basics"
  | "behavior"
  | "stats"
  | "requirements"
  | "effects"
  | "specialist"
  | "integrations"
  | "summary";

const STEPS: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: "category", label: "1. Kategoria" },
  { id: "basics", label: "2. Podstawy" },
  { id: "behavior", label: "3. Zachowanie" },
  { id: "stats", label: "4. Statystyki" },
  { id: "requirements", label: "5. Wymagania" },
  { id: "effects", label: "6. Efekty" },
  { id: "specialist", label: "7. Dane specjalistyczne" },
  { id: "integrations", label: "8. Tagi i integracje" },
  { id: "summary", label: "9. Podsumowanie" }
];

export interface ItemCreatorHandlers {
  onCancel?: () => void;
  onPublished?: (version: ItemVersion) => void;
}

export class ItemCreatorView {
  private metadata: ItemCreatorMetadata | null = null;
  private draft: ItemDraftInput = emptyDraft();
  private currentStep: StepId = "category";
  private persistedItemId: string | null = null;
  private revision: number | null = null;
  private dirty = false;
  private readonly stepHost: HTMLDivElement;
  private readonly statusHost: HTMLDivElement;
  private readonly preview: ItemTooltipPreview;
  private readonly clickHandler = (event: Event) => void this.handleClick(event);
  private readonly inputHandler = (event: Event) => this.handleInput(event);
  private readonly changeHandler = (event: Event) => this.handleInput(event);

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AdminApi,
    private readonly handlers: ItemCreatorHandlers = {}
  ) {
    this.host.innerHTML = `
      <section class="item-creator">
        <nav class="item-creator__steps" data-steps></nav>
        <div class="item-creator__workspace">
          <div class="item-creator__form">
            <div class="item-creator__status" data-creator-status></div>
            <div data-step-current></div>
            <div class="item-creator__footer">
              <button type="button" data-save-draft>Zapisz szkic</button>
              <button type="button" data-publish>Opublikuj</button>
              <button type="button" data-cancel>Anuluj</button>
            </div>
          </div>
          <aside class="item-creator__preview" data-preview></aside>
        </div>
      </section>
    `;
    this.stepHost = this.require<HTMLDivElement>("[data-step-current]");
    this.statusHost = this.require<HTMLDivElement>("[data-creator-status]");
    this.preview = new ItemTooltipPreview(this.require<HTMLElement>("[data-preview]"));
    this.host.addEventListener("click", this.clickHandler);
    this.host.addEventListener("input", this.inputHandler);
    this.host.addEventListener("change", this.changeHandler);
    this.renderNavigation();
    this.setStatus("Ładowanie metadanych...");
  }

  async loadMetadata(itemId?: string): Promise<void> {
    this.setStatus("Ładowanie metadanych...");
    const metadata = await this.api.getMetadata();
    this.metadata = metadata;
    this.preview.setMetadata(metadata);

    if (itemId) {
      const details = await this.api.getItem(itemId);
      const source = details.draft ?? definitionToDraft(details.item);
      this.draft = cloneDraft(source);
      this.persistedItemId = itemId;
      this.revision = details.draft?.revision ?? details.versions[0]?.revision ?? 1;
    } else {
      this.draft = emptyDraft(metadata);
      this.persistedItemId = null;
      this.revision = null;
    }

    this.currentStep = "category";
    this.dirty = false;
    this.renderNavigation();
    this.renderStep();
    this.renderPreview();
    this.setStatus(itemId ? `Edycja ${itemId}` : "Nowy szkic");
  }

  getDraftSnapshot(): ItemDraftInput {
    return cloneDraft(this.draft);
  }

  async saveDraft(): Promise<ItemVersion> {
    this.clearFieldErrors();
    this.setStatus("Zapisywanie szkicu...");
    try {
      let saved: ItemVersion;
      if (this.persistedItemId && this.revision !== null) {
        saved = await this.api.saveDraft(
          this.persistedItemId,
          cloneDraft(this.draft),
          this.revision
        );
      } else {
        saved = await this.api.createItem(cloneDraft(this.draft));
        this.persistedItemId = saved.itemId;
      }
      this.revision = saved.revision;
      this.draft = cloneDraft(saved);
      this.dirty = false;
      this.setStatus(`Szkic zapisany • rewizja ${saved.revision}`);
      this.renderStep();
      this.renderPreview();
      return saved;
    } catch (error) {
      this.handleSaveError(error);
      throw error;
    }
  }

  async publish(): Promise<ItemVersion> {
    if (this.dirty || !this.persistedItemId || this.revision === null) {
      await this.saveDraft();
    }
    if (!this.persistedItemId || this.revision === null) {
      throw new Error("CREATOR_DRAFT_NOT_SAVED");
    }

    this.setStatus("Publikowanie...");
    try {
      const published = await this.api.publishItem(this.persistedItemId, this.revision);
      this.revision = published.revision;
      this.dirty = false;
      this.setStatus(`Opublikowano wersję v${published.versionNo}`);
      this.handlers.onPublished?.(published);
      return published;
    } catch (error) {
      this.handleSaveError(error);
      throw error;
    }
  }

  cancel(): boolean {
    if (this.dirty && !window.confirm("Masz niezapisane zmiany. Zamknąć kreator?")) {
      return false;
    }
    this.handlers.onCancel?.();
    return true;
  }

  async uploadIcon(file: File): Promise<void> {
    this.setStatus("Wysyłanie ikony...");
    try {
      const stored = await this.api.uploadIcon(file);
      this.draft.iconKey = stored.key;
      this.draft.iconUrl = stored.url;
      this.dirty = true;
      this.renderPreview();
      this.setStatus("Ikona przesłana.");
    } catch (error) {
      this.handleSaveError(error);
      throw error;
    }
  }

  destroy(): void {
    this.host.removeEventListener("click", this.clickHandler);
    this.host.removeEventListener("input", this.inputHandler);
    this.host.removeEventListener("change", this.changeHandler);
    this.host.replaceChildren();
  }

  private renderNavigation(): void {
    const nav = this.require<HTMLElement>("[data-steps]");
    nav.replaceChildren();
    for (const step of STEPS) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.stepTarget = step.id;
      button.textContent = step.label;
      button.classList.toggle("is-active", step.id === this.currentStep);
      nav.append(button);
    }
  }

  private renderStep(): void {
    if (!this.metadata) return;
    this.stepHost.dataset.stepCurrent = this.currentStep;
    switch (this.currentStep) {
      case "category":
        this.renderCategoryStep();
        break;
      case "basics":
        this.renderBasicsStep();
        break;
      case "behavior":
        this.renderBehaviorStep();
        break;
      case "stats":
        this.renderStatsStep();
        break;
      case "requirements":
        this.renderRequirementsStep();
        break;
      case "effects":
        this.renderEffectsStep();
        break;
      case "specialist":
        this.renderSpecialistStep();
        break;
      case "integrations":
        this.renderIntegrationsStep();
        break;
      case "summary":
        this.renderSummaryStep();
        break;
    }
  }

  private renderCategoryStep(): void {
    const categories = this.metadata!.categories;
    const subcategories = this.metadata!.subcategories.filter(
      (entry) => entry.categoryId === this.draft.categoryId
    );
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Kategoria i podkategoria</h3>
        <label>Kategoria
          <select data-field="categoryId">
            ${categories.map((entry) => option(entry.id, entry.name, entry.id === this.draft.categoryId)).join("")}
          </select>
        </label>
        <label>Podkategoria
          <select data-field="subcategoryId">
            <option value="">Bez podkategorii</option>
            ${subcategories.map((entry) => option(entry.id, entry.name, entry.id === this.draft.subcategoryId)).join("")}
          </select>
        </label>
      </section>
    `;
  }

  private renderBasicsStep(): void {
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Podstawowe dane</h3>
        ${field("Item ID", "itemId", this.draft.itemId, "text", Boolean(this.persistedItemId))}
        ${field("Nazwa", "name", this.draft.name)}
        <label>Opis<textarea data-field="description">${escapeHtml(this.draft.description)}</textarea></label>
        <label>Rzadkość
          <select data-field="rarity">
            ${["COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY"].map((value) => option(value, value, value === this.draft.rarity)).join("")}
          </select>
        </label>
        ${field("Poziom przedmiotu", "itemLevel", String(this.draft.itemLevel), "number")}
        ${field("Minimalny poziom", "minimumLevel", String(this.draft.minimumLevel), "number")}
        <label>Ikona PNG/WebP <input data-icon-file type="file" accept="image/png,image/webp" /></label>
      </section>
    `;
  }

  private renderBehaviorStep(): void {
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Zachowanie przedmiotu</h3>
        ${field("Wartość sprzedaży", "sellValue", String(this.draft.sellValue), "number")}
        ${field("Waga", "weight", String(this.draft.weight), "number")}
        ${checkbox("sellable", "Można sprzedać", this.draft.sellable)}
        ${checkbox("tradable", "Można handlować", this.draft.tradable)}
        ${checkbox("droppable", "Może wypaść", this.draft.droppable)}
        ${checkbox("stackable", "Łączy się w stosy", this.draft.stackable)}
        ${field("Maksymalny stos", "maxStack", String(this.draft.maxStack), "number")}
        <label>Przypisanie
          <select data-field="soulbound">
            ${["NONE", "ON_PICKUP", "ON_EQUIP"].map((value) => option(value, value, value === this.draft.soulbound)).join("")}
          </select>
        </label>
        ${checkbox("unique", "Unikalny przedmiot", this.draft.unique)}
      </section>
    `;
  }

  private renderStatsStep(): void {
    const allowedStats = this.allowedStats();
    const rows = this.draft.stats.map((stat, index) => {
      const definition = this.metadata!.stats.find((entry) => entry.code === stat.statCode);
      const modifierTypes = definition?.modifierTypes ?? ["flat"];
      return `
        <div class="creator-row" data-stat-row="${index}">
          <select data-stat-code data-index="${index}">
            ${allowedStats.map((entry) => option(entry.code, entry.label, entry.code === stat.statCode)).join("")}
          </select>
          <select data-stat-modifier data-index="${index}">
            ${modifierTypes.map((value) => option(value, value, value === stat.modifierType)).join("")}
          </select>
          <input data-stat-value data-index="${index}" type="number" step="any" value="${stat.value}" />
          <button type="button" data-remove-stat="${index}">Usuń</button>
        </div>
      `;
    }).join("");

    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Statystyki</h3>
        <p>Dostępne pola wynikają z kategorii i podkategorii zapisanych na serwerze.</p>
        <div class="creator-rows">${rows}</div>
        <button type="button" data-add-stat ${allowedStats.length === 0 ? "disabled" : ""}>Dodaj statystykę</button>
      </section>
    `;
  }

  private renderRequirementsStep(): void {
    const rows = this.draft.requirements.map((requirement, index) => `
      <div class="creator-row" data-requirement-row="${index}">
        <select data-requirement-type data-index="${index}">
          ${["LEVEL", "PROFESSION", "STAT", "QUEST", "TIER"].map((value) => option(value, value, value === requirement.type)).join("")}
        </select>
        <input data-requirement-code data-index="${index}" value="${escapeAttribute(requirement.code ?? "")}" placeholder="Kod" />
        <input data-requirement-value data-index="${index}" value="${escapeAttribute(String(requirement.value ?? ""))}" placeholder="Wartość" />
        <button type="button" data-remove-requirement="${index}">Usuń</button>
      </div>
    `).join("");
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Wymagania</h3>
        <div class="creator-rows">${rows}</div>
        <button type="button" data-add-requirement>Dodaj wymaganie</button>
      </section>
    `;
  }

  private renderEffectsStep(): void {
    const rows = this.draft.effects.map((effect, index) => `
      <div class="creator-row creator-row--effect" data-effect-row="${index}">
        <select data-effect-trigger data-index="${index}">
          ${this.metadata!.triggers.map((entry) => option(entry.code, entry.label, entry.code === effect.triggerCode)).join("")}
        </select>
        <select data-effect-code data-index="${index}">
          ${this.metadata!.effects.map((entry) => option(entry.code, entry.label, entry.code === effect.effectCode)).join("")}
        </select>
        <input data-effect-value data-index="${index}" type="number" step="any" value="${effect.value ?? ""}" placeholder="Wartość" />
        <input data-effect-chance data-index="${index}" type="number" step="0.01" min="0" max="1" value="${effect.chance ?? ""}" placeholder="Szansa 0-1" />
        <input data-effect-duration data-index="${index}" type="number" min="0" value="${effect.durationMs ?? ""}" placeholder="Czas ms" />
        <input data-effect-cooldown data-index="${index}" type="number" min="0" value="${effect.cooldownMs ?? ""}" placeholder="Cooldown ms" />
        <button type="button" data-remove-effect="${index}">Usuń</button>
      </div>
    `).join("");
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Efekty i procki</h3>
        <div class="creator-rows">${rows}</div>
        <button type="button" data-add-effect ${this.metadata!.triggers.length === 0 || this.metadata!.effects.length === 0 ? "disabled" : ""}>Dodaj efekt</button>
      </section>
    `;
  }

  private renderSpecialistStep(): void {
    const fields = this.allowedSpecialFields();
    const controls = fields
      .map((field) => specialFieldControl(field, this.draft.specialData[field.code]))
      .join("");
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Dane specjalistyczne</h3>
        <p>Pola i dozwolone wartości pochodzą z konfiguracji kategorii. Serwer sprawdza ich typ, zakres i zgodność przed zapisem.</p>
        ${fields.length === 0
          ? "<p>Ta kategoria nie ma przypisanych pól specjalistycznych.</p>"
          : `<div class="creator-special-fields">${controls}</div>`}
      </section>
    `;
  }

  private renderIntegrationsStep(): void {
    this.stepHost.innerHTML = `
      <section class="creator-step">
        <h3>Tagi i integracje</h3>
        <label>Tagi (oddzielone przecinkami)
          <input data-field="tags" value="${escapeAttribute(this.draft.tags.join(", "))}" />
        </label>
        <p>Tagi mogą być używane przez loot tables, questy, sklepy i przyszłe systemy craftingu.</p>
      </section>
    `;
  }

  private renderSummaryStep(): void {
    this.stepHost.innerHTML = `
      <section class="creator-step creator-summary">
        <h3>Podsumowanie i publikacja</h3>
        <dl>
          <div><dt>Item ID</dt><dd>${escapeHtml(this.draft.itemId || "—")}</dd></div>
          <div><dt>Nazwa</dt><dd>${escapeHtml(this.draft.name || "—")}</dd></div>
          <div><dt>Kategoria</dt><dd>${escapeHtml(this.draft.categoryId || "—")}</dd></div>
          <div><dt>Statystyki</dt><dd>${this.draft.stats.length}</dd></div>
          <div><dt>Wymagania</dt><dd>${this.draft.requirements.length}</dd></div>
          <div><dt>Efekty</dt><dd>${this.draft.effects.length}</dd></div>
          <div><dt>Stan</dt><dd>${this.dirty ? "Niezapisane zmiany" : "Zapisano"}</dd></div>
        </dl>
      </section>
    `;
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target as Element | null;
    if (!target) return;

    const stepButton = target.closest<HTMLButtonElement>("[data-step-target]");
    if (stepButton?.dataset.stepTarget) {
      this.currentStep = stepButton.dataset.stepTarget as StepId;
      this.renderNavigation();
      this.renderStep();
      return;
    }

    if (target.closest("[data-add-stat]")) {
      const stat = this.allowedStats()[0];
      if (!stat) return;
      this.draft.stats.push({
        statCode: stat.code,
        modifierType: stat.modifierTypes[0] ?? "flat",
        value: 0
      });
      this.markDirtyAndRender();
      return;
    }
    const removeStat = target.closest<HTMLElement>("[data-remove-stat]");
    if (removeStat?.dataset.removeStat) {
      this.draft.stats.splice(Number(removeStat.dataset.removeStat), 1);
      this.markDirtyAndRender();
      return;
    }

    if (target.closest("[data-add-requirement]")) {
      this.draft.requirements.push({ type: "LEVEL", value: 1 });
      this.markDirtyAndRender();
      return;
    }
    const removeRequirement = target.closest<HTMLElement>("[data-remove-requirement]");
    if (removeRequirement?.dataset.removeRequirement) {
      this.draft.requirements.splice(Number(removeRequirement.dataset.removeRequirement), 1);
      this.markDirtyAndRender();
      return;
    }

    if (target.closest("[data-add-effect]")) {
      const trigger = this.metadata?.triggers[0];
      const effect = this.metadata?.effects[0];
      if (!trigger || !effect) return;
      this.draft.effects.push({ triggerCode: trigger.code, effectCode: effect.code });
      this.markDirtyAndRender();
      return;
    }
    const removeEffect = target.closest<HTMLElement>("[data-remove-effect]");
    if (removeEffect?.dataset.removeEffect) {
      this.draft.effects.splice(Number(removeEffect.dataset.removeEffect), 1);
      this.markDirtyAndRender();
      return;
    }

    if (target.closest("[data-save-draft]")) {
      await this.saveDraft().catch(() => undefined);
      return;
    }
    if (target.closest("[data-publish]")) {
      await this.publish().catch(() => undefined);
      return;
    }
    if (target.closest("[data-cancel]")) {
      this.cancel();
      return;
    }
    if (target.closest("[data-conflict-reload]")) {
      await this.loadMetadata(this.persistedItemId ?? undefined);
    }
  }

  private handleInput(event: Event): void {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
    if (!element || !this.host.contains(element)) return;

    if (element.matches("[data-icon-file]")) {
      const file = (element as HTMLInputElement).files?.[0];
      if (file) void this.uploadIcon(file).catch(() => undefined);
      return;
    }

    if (element.dataset.specialField) {
      this.updateSpecialField(element);
      return;
    }

    const fieldName = element.dataset.field;
    if (fieldName) {
      this.updateSimpleField(fieldName, element);
      return;
    }

    const index = Number(element.dataset.index);
    if (!Number.isInteger(index)) return;
    if (element.matches("[data-stat-code], [data-stat-modifier], [data-stat-value]")) {
      this.updateStat(index, element);
      return;
    }
    if (element.matches("[data-requirement-type], [data-requirement-code], [data-requirement-value]")) {
      this.updateRequirement(index, element);
      return;
    }
    if (element.matches("[data-effect-trigger], [data-effect-code], [data-effect-value], [data-effect-chance], [data-effect-duration], [data-effect-cooldown]")) {
      this.updateEffect(index, element);
    }
  }

  private updateSimpleField(
    fieldName: string,
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): void {
    this.removeFieldError(fieldName);
    switch (fieldName) {
      case "categoryId": {
        const previousCategoryId = this.draft.categoryId;
        const previousSubcategoryId = this.draft.subcategoryId;
        this.draft.categoryId = element.value;
        const validSubcategories = this.metadata!.subcategories.filter(
          (entry) => entry.categoryId === element.value
        );
        const selectedSubcategory = validSubcategories.some(
          (entry) => entry.id === previousSubcategoryId
        )
          ? previousSubcategoryId
          : validSubcategories[0]?.id;
        if (selectedSubcategory) this.draft.subcategoryId = selectedSubcategory;
        else delete this.draft.subcategoryId;

        const allowedStats = new Set(this.allowedStats().map((entry) => entry.code));
        const allowedFields = new Set(this.allowedSpecialFields().map((entry) => entry.code));
        const removedStats = this.draft.stats.filter((stat) => !allowedStats.has(stat.statCode));
        const removedFields = Object.keys(this.draft.specialData).filter(
          (code) => !allowedFields.has(code)
        );
        if (
          (removedStats.length > 0 || removedFields.length > 0) &&
          !window.confirm(
            `Zmiana kategorii usunie nieobsługiwane dane: ${[
              ...removedStats.map((stat) => stat.statCode),
              ...removedFields
            ].join(", ")}. Kontynuować?`
          )
        ) {
          this.draft.categoryId = previousCategoryId;
          if (previousSubcategoryId) this.draft.subcategoryId = previousSubcategoryId;
          else delete this.draft.subcategoryId;
          (element as HTMLSelectElement).value = previousCategoryId;
          return;
        }
        this.draft.stats = this.draft.stats.filter((stat) => allowedStats.has(stat.statCode));
        for (const code of removedFields) delete this.draft.specialData[code];
        this.dirty = true;
        this.renderStep();
        this.renderPreview();
        return;
      }
      case "subcategoryId": {
        const previousSubcategoryId = this.draft.subcategoryId;
        if (element.value) this.draft.subcategoryId = element.value;
        else delete this.draft.subcategoryId;
        const allowedStats = new Set(this.allowedStats().map((entry) => entry.code));
        const allowedFields = new Set(this.allowedSpecialFields().map((entry) => entry.code));
        const removedStats = this.draft.stats.filter((stat) => !allowedStats.has(stat.statCode));
        const removedFields = Object.keys(this.draft.specialData).filter(
          (code) => !allowedFields.has(code)
        );
        if (
          (removedStats.length > 0 || removedFields.length > 0) &&
          !window.confirm(
            `Zmiana podkategorii usunie nieobsługiwane dane: ${[
              ...removedStats.map((stat) => stat.statCode),
              ...removedFields
            ].join(", ")}. Kontynuować?`
          )
        ) {
          if (previousSubcategoryId) this.draft.subcategoryId = previousSubcategoryId;
          else delete this.draft.subcategoryId;
          (element as HTMLSelectElement).value = previousSubcategoryId ?? "";
          return;
        }
        this.draft.stats = this.draft.stats.filter((stat) => allowedStats.has(stat.statCode));
        for (const code of removedFields) delete this.draft.specialData[code];
        break;
      }
      case "itemId":
        this.draft.itemId = element.value.trim();
        break;
      case "name":
        this.draft.name = element.value;
        break;
      case "description":
        this.draft.description = element.value;
        break;
      case "rarity":
        this.draft.rarity = element.value as ItemDraftInput["rarity"];
        break;
      case "itemLevel":
        this.draft.itemLevel = numberValue(element.value, 0);
        break;
      case "minimumLevel":
        this.draft.minimumLevel = numberValue(element.value, 0);
        break;
      case "sellValue":
        this.draft.sellValue = numberValue(element.value, 0);
        break;
      case "weight":
        this.draft.weight = numberValue(element.value, 0);
        break;
      case "sellable":
      case "tradable":
      case "droppable":
      case "stackable":
      case "unique":
        this.draft[fieldName] = (element as HTMLInputElement).checked;
        if (fieldName === "stackable" && !this.draft.stackable) this.draft.maxStack = 1;
        break;
      case "maxStack":
        this.draft.maxStack = Math.max(1, Math.trunc(numberValue(element.value, 1)));
        break;
      case "soulbound":
        this.draft.soulbound = element.value as ItemDraftInput["soulbound"];
        break;
      case "tags":
        this.draft.tags = [...new Set(element.value.split(",").map((value) => value.trim()).filter(Boolean))];
        break;
    }
    this.dirty = true;
    this.renderPreview();
  }

  private updateStat(
    index: number,
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): void {
    const stat = this.draft.stats[index];
    if (!stat) return;
    if (element.matches("[data-stat-code]")) {
      stat.statCode = element.value;
      const definition = this.metadata!.stats.find((entry) => entry.code === stat.statCode);
      stat.modifierType = definition?.modifierTypes[0] ?? "flat";
      this.dirty = true;
      this.renderStep();
      this.renderPreview();
      return;
    }
    if (element.matches("[data-stat-modifier]")) {
      stat.modifierType = element.value as ItemStatModifier["modifierType"];
    } else {
      stat.value = numberValue(element.value, 0);
    }
    this.dirty = true;
    this.renderPreview();
  }

  private updateRequirement(
    index: number,
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): void {
    const requirement = this.draft.requirements[index];
    if (!requirement) return;
    if (element.matches("[data-requirement-type]")) {
      requirement.type = element.value as ItemRequirement["type"];
    } else if (element.matches("[data-requirement-code]")) {
      if (element.value.trim()) requirement.code = element.value.trim();
      else delete requirement.code;
    } else {
      const raw = element.value.trim();
      if (!raw) delete requirement.value;
      else {
        const numeric = Number(raw);
        requirement.value = Number.isFinite(numeric) ? numeric : raw;
      }
    }
    this.dirty = true;
    this.renderPreview();
  }

  private updateEffect(
    index: number,
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): void {
    const effect = this.draft.effects[index];
    if (!effect) return;
    if (element.matches("[data-effect-trigger]")) {
      effect.triggerCode = element.value;
    } else if (element.matches("[data-effect-code]")) {
      effect.effectCode = element.value;
    } else if (element.matches("[data-effect-value]")) {
      assignOptionalNumber(effect, "value", element.value);
    } else if (element.matches("[data-effect-chance]")) {
      assignOptionalNumber(effect, "chance", element.value);
    } else if (element.matches("[data-effect-duration]")) {
      assignOptionalNumber(effect, "durationMs", element.value);
    } else if (element.matches("[data-effect-cooldown]")) {
      assignOptionalNumber(effect, "cooldownMs", element.value);
    }
    this.dirty = true;
    this.renderPreview();
  }

  private updateSpecialField(
    element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): void {
    const code = element.dataset.specialField;
    const definition = this.metadata?.specialFields.find((entry) => entry.code === code);
    if (!code || !definition) return;
    this.removeFieldError(`specialData.${code}`);

    switch (definition.type) {
      case "boolean":
        this.draft.specialData[code] = (element as HTMLInputElement).checked;
        break;
      case "number":
        if (!element.value.trim()) delete this.draft.specialData[code];
        else {
          const value = Number(element.value);
          if (Number.isFinite(value)) this.draft.specialData[code] = value;
        }
        break;
      case "select":
        if (element.value) this.draft.specialData[code] = element.value;
        else delete this.draft.specialData[code];
        break;
      case "text":
        if (element.value.trim()) this.draft.specialData[code] = element.value.trim();
        else delete this.draft.specialData[code];
        break;
      case "text-list":
        this.draft.specialData[code] = element.value
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        if ((this.draft.specialData[code] as string[]).length === 0) {
          delete this.draft.specialData[code];
        }
        break;
    }
    this.dirty = true;
    this.renderPreview();
  }

  private allowedSpecialFields() {
    if (!this.metadata) return [];
    const category = this.metadata.categories.find(
      (entry) => entry.id === this.draft.categoryId
    );
    const subcategory = this.metadata.subcategories.find(
      (entry) =>
        entry.categoryId === this.draft.categoryId &&
        entry.id === this.draft.subcategoryId
    );
    const allowedCodes = new Set(
      subcategory
        ? subcategory.allowedSpecialFieldCodes
        : category?.allowedSpecialFieldCodes ?? []
    );
    return this.metadata.specialFields.filter((entry) => allowedCodes.has(entry.code));
  }

  private allowedStats() {
    if (!this.metadata) return [];
    const category = this.metadata.categories.find((entry) => entry.id === this.draft.categoryId);
    const subcategory = this.metadata.subcategories.find(
      (entry) => entry.categoryId === this.draft.categoryId && entry.id === this.draft.subcategoryId
    );
    const allowedCodes = new Set(
      subcategory ? subcategory.allowedStatCodes : category?.allowedStatCodes ?? []
    );
    return this.metadata.stats.filter((entry) => allowedCodes.has(entry.code));
  }

  private markDirtyAndRender(): void {
    this.dirty = true;
    this.renderStep();
    this.renderPreview();
  }

  private renderPreview(): void {
    this.preview.render(this.draft);
  }

  private handleSaveError(error: unknown): void {
    if (error instanceof AdminApiRequestError) {
      if (error.fieldErrors) this.applyFieldErrors(error.fieldErrors);
      if (error.status === 409) {
        this.statusHost.replaceChildren();
        const text = document.createElement("span");
        text.textContent = `Konflikt zapisu: ${error.message}`;
        const reload = document.createElement("button");
        reload.type = "button";
        reload.dataset.conflictReload = "";
        reload.textContent = "Wczytaj wersję z serwera";
        this.statusHost.append(text, reload);
        this.statusHost.classList.add("is-error");
        return;
      }
      this.setStatus(error.message, true);
      return;
    }
    this.setStatus(error instanceof Error ? error.message : "Nie udało się zapisać.", true);
  }

  private applyFieldErrors(errors: Record<string, string>): void {
    for (const [name, message] of Object.entries(errors)) {
      this.showLocalFieldError(name, message);
    }
  }

  private showLocalFieldError(name: string, message: string): void {
    const specialCode = name.startsWith("specialData.") ? name.slice("specialData.".length) : null;
    const element = specialCode
      ? this.host.querySelector<HTMLElement>(`[data-special-field='${cssEscape(specialCode)}']`)
      : this.host.querySelector<HTMLElement>(`[data-field='${cssEscape(name)}']`);
    if (!element) return;
    element.classList.add("has-error");
    const errorKey = specialCode ?? name;
    const existing = this.host.querySelector<HTMLElement>(`[data-error-for='${cssEscape(errorKey)}']`);
    if (existing) existing.textContent = message;
    else {
      const error = document.createElement("small");
      error.className = "creator-field-error";
      error.dataset.errorFor = errorKey;
      error.textContent = message;
      element.insertAdjacentElement("afterend", error);
    }
  }

  private removeFieldError(name: string): void {
    const specialCode = name.startsWith("specialData.") ? name.slice("specialData.".length) : null;
    const selector = specialCode
      ? `[data-special-field='${cssEscape(specialCode)}']`
      : `[data-field='${cssEscape(name)}']`;
    this.host.querySelector<HTMLElement>(selector)?.classList.remove("has-error");
    const errorKey = specialCode ?? name;
    this.host.querySelector<HTMLElement>(`[data-error-for='${cssEscape(errorKey)}']`)?.remove();
  }

  private clearFieldErrors(): void {
    this.host.querySelectorAll(".has-error").forEach((element) => element.classList.remove("has-error"));
    this.host.querySelectorAll("[data-error-for]").forEach((element) => element.remove());
  }

  private setStatus(message: string, isError = false): void {
    this.statusHost.textContent = message;
    this.statusHost.classList.toggle("is-error", isError);
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`ItemCreatorView element missing: ${selector}`);
    return element;
  }
}

function emptyDraft(metadata?: ItemCreatorMetadata): ItemDraftInput {
  const category = metadata?.categories[0];
  const subcategory = metadata?.subcategories.find((entry) => entry.categoryId === category?.id);
  return {
    itemId: "",
    name: "",
    categoryId: category?.id ?? "",
    ...(subcategory ? { subcategoryId: subcategory.id } : {}),
    description: "",
    rarity: "COMMON",
    itemLevel: 1,
    minimumLevel: 0,
    sellValue: 0,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 0,
    soulbound: "NONE",
    unique: false,
    tags: [],
    stats: [],
    requirements: [],
    effects: [],
    specialData: {}
  };
}

function definitionToDraft(item: ItemDetails["item"]): ItemDraftInput {
  const {
    status: _status,
    activeVersionNo: _activeVersionNo,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...draft
  } = item;
  return cloneDraft(draft);
}

function cloneDraft(input: ItemDraftInput): ItemDraftInput {
  return JSON.parse(JSON.stringify(input)) as ItemDraftInput;
}

function specialFieldControl(
  field: ItemCreatorMetadata["specialFields"][number],
  value: unknown
): string {
  const code = escapeAttribute(field.code);
  const label = escapeHtml(field.label);
  const fieldError = `<small data-error-for="${code}" class="creator-field-error"></small>`;

  if (field.type === "boolean") {
    return `<label class="creator-checkbox"><input data-special-field="${code}" type="checkbox" ${value === true ? "checked" : ""} /> ${label}</label>`;
  }
  if (field.type === "select") {
    const selected = typeof value === "string" ? value : "";
    const options = [
      option("", "— wybierz —", selected === ""),
      ...(field.options ?? []).map((entry) =>
        option(entry.value, entry.label, entry.value === selected)
      )
    ].join("");
    return `<label>${label}<select data-special-field="${code}">${options}</select>${fieldError}</label>`;
  }
  if (field.type === "number") {
    const numericValue = typeof value === "number" ? String(value) : "";
    const minimum = field.minimum === undefined ? "" : `min="${field.minimum}"`;
    const maximum = field.maximum === undefined ? "" : `max="${field.maximum}"`;
    return `<label>${label}<input data-special-field="${code}" type="number" step="${field.integer ? "1" : "any"}" ${minimum} ${maximum} value="${escapeAttribute(numericValue)}" />${fieldError}</label>`;
  }
  const textValue =
    field.type === "text-list"
      ? Array.isArray(value) ? value.filter((entry) => typeof entry === "string").join(", ") : ""
      : typeof value === "string" ? value : "";
  const placeholder = field.type === "text-list" ? "Oddziel przecinkami" : "";
  return `<label>${label}<input data-special-field="${code}" type="text" value="${escapeAttribute(textValue)}" placeholder="${placeholder}" />${fieldError}</label>`;
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeAttribute(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function field(
  label: string,
  name: string,
  value: string,
  type = "text",
  disabled = false
): string {
  return `<label>${escapeHtml(label)}<input data-field="${escapeAttribute(name)}" type="${type}" value="${escapeAttribute(value)}" ${disabled ? "disabled" : ""} /></label>`;
}

function checkbox(name: string, label: string, checked: boolean): string {
  return `<label class="creator-checkbox"><input data-field="${escapeAttribute(name)}" type="checkbox" ${checked ? "checked" : ""} /> ${escapeHtml(label)}</label>`;
}

function numberValue(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assignOptionalNumber<K extends "value" | "chance" | "durationMs" | "cooldownMs">(
  effect: ItemEffect,
  key: K,
  raw: string
): void {
  if (!raw.trim()) {
    delete effect[key];
    return;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) effect[key] = parsed;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function cssEscape(value: string): string {
  return value.replaceAll("'", "\\'");
}
