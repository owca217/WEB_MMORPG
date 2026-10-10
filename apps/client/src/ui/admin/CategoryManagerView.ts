import type {
  ItemCategoryDefinition,
  ItemCreatorMetadata
} from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError } from "../../net/AdminApi";

export interface CategoryManagerHandlers {
  onBack?: () => void;
}

export class CategoryManagerView {
  private metadata: ItemCreatorMetadata | null = null;
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AdminApi,
    private readonly handlers: CategoryManagerHandlers = {}
  ) {}

  async show(): Promise<void> {
    this.host.innerHTML = `<p class="admin-panel__loading">Ładowanie kategorii...</p>`;
    try {
      this.metadata = await this.api.getMetadata();
      if (this.destroyed) return;
      this.render();
    } catch (error) {
      if (this.destroyed) return;
      this.host.textContent = this.errorMessage(error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.host.replaceChildren();
  }

  private render(): void {
    if (!this.metadata) return;
    this.host.replaceChildren();

    const root = document.createElement("section");
    root.className = "category-manager";
    const header = document.createElement("div");
    header.className = "category-manager__header";
    const heading = document.createElement("h3");
    heading.textContent = "Kategorie przedmiotów";
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
    status.className = "category-manager__status";
    status.dataset.categoryStatus = "";
    root.append(status);

    const list = document.createElement("div");
    list.className = "category-manager__list";
    for (const category of this.metadata.categories) {
      list.append(this.renderCategory(category, status));
    }
    root.append(list);
    root.append(this.renderCreateCategory(status));
    root.append(this.renderCreateSubcategory(status));
    this.host.append(root);
  }

  private renderCategory(category: ItemCategoryDefinition, status: HTMLElement): HTMLElement {
    const card = document.createElement("article");
    card.className = "category-manager__category";
    card.dataset.category = category.id;

    const title = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = category.name;
    const meta = document.createElement("span");
    meta.textContent = ` ${category.id} • ${category.system ? "systemowa" : "własna"}`;
    title.append(name, meta);
    card.append(title);

    const stats = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Dozwolone statystyki silnika";
    stats.append(legend);
    for (const stat of this.metadata!.stats) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = stat.code;
      checkbox.dataset.categoryStat = category.id;
      checkbox.checked = category.allowedStatCodes.includes(stat.code);
      label.append(checkbox, document.createTextNode(`${stat.label} (${stat.code})`));
      stats.append(label);
    }
    card.append(stats);

    const specialFields = document.createElement("fieldset");
    const specialLegend = document.createElement("legend");
    specialLegend.textContent = "Dozwolone pola specjalistyczne silnika";
    specialFields.append(specialLegend);
    for (const field of this.metadata!.specialFields) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = field.code;
      checkbox.dataset.categorySpecialField = category.id;
      checkbox.checked = category.allowedSpecialFieldCodes.includes(field.code);
      label.append(checkbox, document.createTextNode(`${field.label} (${field.code})`));
      specialFields.append(label);
    }
    card.append(specialFields);

    const saveSpecial = document.createElement("button");
    saveSpecial.type = "button";
    saveSpecial.dataset.saveCategorySpecialFields = category.id;
    saveSpecial.textContent = "Zapisz mapowanie pól specjalistycznych";
    saveSpecial.addEventListener("click", () => {
      void this.saveAllowedSpecialFields(category.id, status);
    });
    card.append(saveSpecial);

    const save = document.createElement("button");
    save.type = "button";
    save.dataset.saveCategoryStats = category.id;
    save.textContent = "Zapisz mapowanie statystyk";
    save.addEventListener("click", () => {
      void this.saveAllowedStats(category.id, status);
    });
    card.append(save);

    const subcategories = this.metadata!.subcategories.filter(
      (entry) => entry.categoryId === category.id
    );
    for (const subcategory of subcategories) {
      const subcategoryCard = document.createElement("section");
      subcategoryCard.className = "category-manager__subcategory";
      subcategoryCard.dataset.subcategory = subcategory.id;
      const subcategoryTitle = document.createElement("strong");
      subcategoryTitle.textContent = `${subcategory.name} (${subcategory.id})`;
      subcategoryCard.append(subcategoryTitle);

      const subcategoryFields = document.createElement("fieldset");
      const subcategoryLegend = document.createElement("legend");
      subcategoryLegend.textContent = "Dozwolone pola specjalistyczne";
      subcategoryFields.append(subcategoryLegend);
      for (const field of this.metadata!.specialFields) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = field.code;
        checkbox.dataset.subcategorySpecialField = `${category.id}:${subcategory.id}`;
        checkbox.checked = subcategory.allowedSpecialFieldCodes.includes(field.code);
        label.append(checkbox, document.createTextNode(`${field.label} (${field.code})`));
        subcategoryFields.append(label);
      }
      subcategoryCard.append(subcategoryFields);

      const saveSubcategoryFields = document.createElement("button");
      saveSubcategoryFields.type = "button";
      saveSubcategoryFields.dataset.saveSubcategorySpecialFields = subcategory.id;
      saveSubcategoryFields.dataset.categoryId = category.id;
      saveSubcategoryFields.textContent = "Zapisz pola podkategorii";
      saveSubcategoryFields.addEventListener("click", () => {
        void this.saveSubcategorySpecialFields(category.id, subcategory.id, status);
      });
      subcategoryCard.append(saveSubcategoryFields);
      card.append(subcategoryCard);
    }

    // Celowo brak przycisku hard-delete. Kategorie systemowe i własne są zachowywane
    // dla stabilności istniejących definicji przedmiotów.
    return card;
  }

  private renderCreateCategory(status: HTMLElement): HTMLElement {
    const section = document.createElement("section");
    section.className = "category-manager__create";
    const heading = document.createElement("h4");
    heading.textContent = "Nowa kategoria";
    section.append(heading);

    const id = document.createElement("input");
    id.placeholder = "id, np. alchemy";
    id.dataset.newCategoryId = "";
    const name = document.createElement("input");
    name.placeholder = "Nazwa";
    name.dataset.newCategoryName = "";
    section.append(this.wrap("ID", id), this.wrap("Nazwa", name));

    const stats = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Dozwolone statystyki";
    stats.append(legend);
    for (const stat of this.metadata!.stats) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = stat.code;
      checkbox.dataset.newCategoryStat = "";
      label.append(checkbox, document.createTextNode(`${stat.label} (${stat.code})`));
      stats.append(label);
    }
    section.append(stats);

    const specialFields = document.createElement("fieldset");
    const specialLegend = document.createElement("legend");
    specialLegend.textContent = "Dozwolone pola specjalistyczne";
    specialFields.append(specialLegend);
    for (const field of this.metadata!.specialFields) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = field.code;
      checkbox.dataset.newCategorySpecialField = "";
      label.append(checkbox, document.createTextNode(`${field.label} (${field.code})`));
      specialFields.append(label);
    }
    section.append(specialFields);

    const create = document.createElement("button");
    create.type = "button";
    create.dataset.createCategory = "";
    create.textContent = "Utwórz kategorię";
    create.addEventListener("click", () => {
      void this.createCategory(status);
    });
    section.append(create);
    return section;
  }

  private renderCreateSubcategory(status: HTMLElement): HTMLElement {
    const section = document.createElement("section");
    section.className = "category-manager__create";
    const heading = document.createElement("h4");
    heading.textContent = "Nowa podkategoria";
    section.append(heading);

    const id = document.createElement("input");
    id.placeholder = "id podkategorii";
    id.dataset.newSubcategoryId = "";
    const name = document.createElement("input");
    name.placeholder = "Nazwa";
    name.dataset.newSubcategoryName = "";
    const category = document.createElement("select");
    category.dataset.newSubcategoryCategory = "";
    for (const item of this.metadata!.categories) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      category.append(option);
    }
    section.append(this.wrap("ID", id), this.wrap("Nazwa", name), this.wrap("Kategoria", category));

    const stats = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Dozwolone statystyki";
    stats.append(legend);
    for (const stat of this.metadata!.stats) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = stat.code;
      checkbox.dataset.newSubcategoryStat = "";
      label.append(checkbox, document.createTextNode(`${stat.label} (${stat.code})`));
      stats.append(label);
    }
    section.append(stats);

    const specialFields = document.createElement("fieldset");
    const specialLegend = document.createElement("legend");
    specialLegend.textContent = "Dozwolone pola specjalistyczne";
    specialFields.append(specialLegend);
    for (const field of this.metadata!.specialFields) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = field.code;
      checkbox.dataset.newSubcategorySpecialField = "";
      label.append(checkbox, document.createTextNode(`${field.label} (${field.code})`));
      specialFields.append(label);
    }
    section.append(specialFields);

    const create = document.createElement("button");
    create.type = "button";
    create.dataset.createSubcategory = "";
    create.textContent = "Utwórz podkategorię";
    create.addEventListener("click", () => {
      void this.createSubcategory(status);
    });
    section.append(create);
    return section;
  }

  private async saveAllowedStats(categoryId: string, status: HTMLElement): Promise<void> {
    const selected = this.checkedValues(`[data-category-stat='${escapeSelector(categoryId)}']`);
    status.textContent = "Zapisywanie mapowania...";
    try {
      const updated = await this.api.updateCategoryAllowedStats(categoryId, selected);
      const category = this.metadata?.categories.find((entry) => entry.id === categoryId);
      if (category) category.allowedStatCodes = [...updated.allowedStatCodes];
      status.textContent = `Zapisano statystyki kategorii ${categoryId}.`;
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private async saveAllowedSpecialFields(
    categoryId: string,
    status: HTMLElement
  ): Promise<void> {
    const selector = `[data-category-special-field='${escapeSelector(categoryId)}']`;
    const allowedSpecialFieldCodes = this.checkedValues(selector);
    status.textContent = "Zapisywanie pól specjalistycznych...";
    try {
      const updated = await this.api.updateCategoryAllowedSpecialFields(
        categoryId,
        allowedSpecialFieldCodes
      );
      const category = this.metadata?.categories.find((entry) => entry.id === categoryId);
      if (category) category.allowedSpecialFieldCodes = [...updated.allowedSpecialFieldCodes];
      status.textContent = `Zapisano pola specjalistyczne kategorii ${categoryId}.`;
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private async saveSubcategorySpecialFields(
    categoryId: string,
    subcategoryId: string,
    status: HTMLElement
  ): Promise<void> {
    const mappingId = `${categoryId}:${subcategoryId}`;
    const selector = `[data-subcategory-special-field='${escapeSelector(mappingId)}']`;
    const allowedSpecialFieldCodes = this.checkedValues(selector);
    status.textContent = "Zapisywanie pól podkategorii...";
    try {
      const updated = await this.api.updateSubcategoryAllowedSpecialFields(
        categoryId,
        subcategoryId,
        allowedSpecialFieldCodes
      );
      const subcategory = this.metadata?.subcategories.find(
        (entry) => entry.categoryId === categoryId && entry.id === subcategoryId
      );
      if (subcategory) {
        subcategory.allowedSpecialFieldCodes = [...updated.allowedSpecialFieldCodes];
      }
      status.textContent = `Zapisano pola podkategorii ${subcategoryId}.`;
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private async createCategory(status: HTMLElement): Promise<void> {
    const id = this.require<HTMLInputElement>("[data-new-category-id]").value.trim();
    const name = this.require<HTMLInputElement>("[data-new-category-name]").value.trim();
    const allowedStatCodes = this.checkedValues("[data-new-category-stat]");
    const allowedSpecialFieldCodes = this.checkedValues("[data-new-category-special-field]");
    status.textContent = "Tworzenie kategorii...";
    try {
      const created = await this.api.createCategory({
        id,
        name,
        allowedStatCodes,
        allowedSpecialFieldCodes
      });
      this.metadata?.categories.push(created);
      status.textContent = `Utworzono kategorię ${created.name}.`;
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private async createSubcategory(status: HTMLElement): Promise<void> {
    const id = this.require<HTMLInputElement>("[data-new-subcategory-id]").value.trim();
    const name = this.require<HTMLInputElement>("[data-new-subcategory-name]").value.trim();
    const categoryId = this.require<HTMLSelectElement>("[data-new-subcategory-category]").value;
    const allowedStatCodes = this.checkedValues("[data-new-subcategory-stat]");
    const allowedSpecialFieldCodes = this.checkedValues("[data-new-subcategory-special-field]");
    status.textContent = "Tworzenie podkategorii...";
    try {
      const created = await this.api.createSubcategory({
        id,
        categoryId,
        name,
        allowedStatCodes,
        allowedSpecialFieldCodes
      });
      this.metadata?.subcategories.push(created);
      status.textContent = `Utworzono podkategorię ${created.name}.`;
    } catch (error) {
      status.textContent = this.errorMessage(error);
    }
  }

  private checkedValues(selector: string): string[] {
    return Array.from(this.host.querySelectorAll<HTMLInputElement>(selector))
      .filter((input) => input.checked)
      .map((input) => input.value);
  }

  private wrap(labelText: string, control: HTMLElement): HTMLElement {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(text, control);
    return label;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof AdminApiRequestError || error instanceof Error) return error.message;
    return "Nie udało się wykonać operacji na kategoriach.";
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.host.querySelector<T>(selector);
    if (!element) throw new Error(`Category manager element missing: ${selector}`);
    return element;
  }
}

function escapeSelector(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/['\\]/g, "\\$&");
}
