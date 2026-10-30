import type {
  ItemCategoryDefinition,
  ItemCreatorMetadata
} from "@web-mmorpg/shared";
import { AdminApi, AdminApiRequestError } from "../../net/AdminApi";
import "./CategoryManagerView.css";

export interface CategoryManagerHandlers {
  onBack?: () => void;
}

export class CategoryManagerView {
  private metadata: ItemCreatorMetadata | null = null;
  private destroyed = false;
  private query = "";

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
    const intro = document.createElement("div");
    const description = document.createElement("p");
    description.textContent = "Wybierz kategorię, aby ustawić dozwolone statystyki i pola jej przedmiotów.";
    intro.append(heading, description);
    header.append(intro);
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
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(status);

    const toolbar = document.createElement("div");
    toolbar.className = "category-manager__toolbar";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Szukaj kategorii lub podkategorii…";
    search.setAttribute("aria-label", "Szukaj kategorii lub podkategorii");
    search.dataset.categorySearch = "";
    search.value = this.query;
    const count = document.createElement("span");
    count.dataset.categoryCount = "";
    count.setAttribute("role", "status");
    toolbar.append(search, count);
    root.append(toolbar);

    const creation = document.createElement("div");
    creation.className = "category-manager__creation";
    creation.append(
      this.creationPanel("Nowa kategoria", this.renderCreateCategory(status)),
      this.creationPanel("Nowa podkategoria", this.renderCreateSubcategory(status))
    );
    root.append(creation);

    const list = document.createElement("div");
    list.className = "category-manager__list";
    for (const category of this.metadata.categories) {
      list.append(this.renderCategory(category, status));
    }
    root.append(list);
    const empty = document.createElement("p");
    empty.className = "category-manager__empty";
    empty.dataset.categoryEmpty = "";
    empty.textContent = "Brak pasujących kategorii. Spróbuj innej nazwy lub ID.";
    root.append(empty);
    this.styleChoices(root);
    this.host.append(root);
    search.addEventListener("input", () => { this.query = search.value; this.filterCategories(); });
    this.filterCategories();
  }

  private renderCategory(category: ItemCategoryDefinition, status: HTMLElement): HTMLElement {
    const card = document.createElement("details");
    card.className = "category-manager__category";
    card.dataset.category = category.id;

    const subcategories = this.metadata!.subcategories.filter(entry => entry.categoryId === category.id);
    card.dataset.categoryFilter = [category.name, category.id, ...subcategories.flatMap(entry => [entry.name, entry.id])].join(" ");
    const title = document.createElement("summary");
    const identity = document.createElement("span");
    identity.className = "category-manager__identity";
    const name = document.createElement("strong");
    name.textContent = category.name;
    const meta = document.createElement("small");
    meta.textContent = category.id;
    identity.append(name, meta);
    const badge = document.createElement("span");
    badge.className = "category-manager__badge";
    badge.textContent = category.system ? "Systemowa" : "Własna";
    const totals = document.createElement("span");
    totals.className = "category-manager__totals";
    const updateTotals = () => {
      const stats = card.querySelectorAll<HTMLInputElement>("[data-category-stat]:checked").length;
      const fields = card.querySelectorAll<HTMLInputElement>("[data-category-special-field]:checked").length;
      totals.textContent = `Statystyki: ${stats} · Pola: ${fields} · Podkategorie: ${subcategories.length}`;
    };
    title.append(identity, badge, totals);
    card.append(title);
    const body = document.createElement("div");
    body.className = "category-manager__body";
    card.append(body);

    const stats = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = "Dozwolone statystyki";
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

    const specialFields = document.createElement("fieldset");
    const specialLegend = document.createElement("legend");
    specialLegend.textContent = "Dozwolone pola dodatkowe";
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

    const saveSpecial = document.createElement("button");
    saveSpecial.type = "button";
    saveSpecial.dataset.saveCategorySpecialFields = category.id;
    saveSpecial.textContent = "Zapisz pola kategorii";
    saveSpecial.addEventListener("click", () => {
      void this.saveAllowedSpecialFields(category.id, status);
    });

    const save = document.createElement("button");
    save.type = "button";
    save.dataset.saveCategoryStats = category.id;
    save.textContent = "Zapisz statystyki";
    save.addEventListener("click", () => {
      void this.saveAllowedStats(category.id, status);
    });
    body.append(this.optionGroup("Statystyki", stats, save), this.optionGroup("Pola dodatkowe", specialFields, saveSpecial));

    const subheading = document.createElement("h4");
    subheading.textContent = `Podkategorie (${subcategories.length})`;
    body.append(subheading);
    if (!subcategories.length) {
      const note = document.createElement("p");
      note.className = "category-manager__note";
      note.textContent = "Ta kategoria nie ma jeszcze podkategorii.";
      body.append(note);
    }
    for (const subcategory of subcategories) {
      const subcategoryCard = document.createElement("details");
      subcategoryCard.className = "category-manager__subcategory";
      subcategoryCard.dataset.subcategory = subcategory.id;
      const subcategoryTitle = document.createElement("summary");
      const subname = document.createElement("strong"), subid = document.createElement("small");
      subname.textContent = subcategory.name;
      subid.textContent = subcategory.id;
      subcategoryTitle.append(subname, subid);
      const subbody = document.createElement("div");
      subbody.className = "category-manager__subbody";
      subcategoryCard.append(subcategoryTitle, subbody);

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
      subbody.append(subcategoryFields);

      const saveSubcategoryFields = document.createElement("button");
      saveSubcategoryFields.type = "button";
      saveSubcategoryFields.dataset.saveSubcategorySpecialFields = subcategory.id;
      saveSubcategoryFields.dataset.categoryId = category.id;
      saveSubcategoryFields.textContent = "Zapisz pola podkategorii";
      saveSubcategoryFields.addEventListener("click", () => {
        void this.saveSubcategorySpecialFields(category.id, subcategory.id, status);
      });
      subbody.append(saveSubcategoryFields);
      body.append(subcategoryCard);
    }
    card.addEventListener("change", updateTotals);
    updateTotals();
    return card;
  }

  private optionGroup(title: string, fields: HTMLFieldSetElement, save: HTMLButtonElement): HTMLDetailsElement {
    const group = document.createElement("details");
    group.className = "category-manager__group";
    const summary = document.createElement("summary"), name = document.createElement("strong"), count = document.createElement("span");
    name.textContent = title;
    count.className = "category-manager__count";
    const update = () => { count.textContent = `${fields.querySelectorAll("input:checked").length} z ${fields.querySelectorAll("input").length}`; };
    fields.addEventListener("change", update);
    update();
    summary.append(name, count);
    const body = document.createElement("div");
    body.className = "category-manager__group-body";
    body.append(fields, save);
    group.append(summary, body);
    return group;
  }

  private creationPanel(title: string, section: HTMLElement): HTMLDetailsElement {
    const panel = document.createElement("details"), summary = document.createElement("summary");
    panel.className = "category-manager__create-panel";
    summary.textContent = `＋ ${title}`;
    section.querySelector("h4")?.remove();
    panel.append(summary, section);
    return panel;
  }

  private filterCategories(): void {
    const normalize = (text: string) => text.toLocaleLowerCase("pl").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
    const query = normalize(this.query.trim());
    const cards = [...this.host.querySelectorAll<HTMLDetailsElement>("[data-category]")];
    let visible = 0;
    for (const card of cards) {
      card.hidden = !normalize(card.dataset.categoryFilter ?? "").includes(query);
      if (!card.hidden) visible++;
    }
    this.require<HTMLElement>("[data-category-count]").textContent = `Kategorie: ${visible} / ${cards.length}`;
    this.require<HTMLElement>("[data-category-empty]").hidden = visible > 0;
  }

  private styleChoices(root: HTMLElement): void {
    for (const fields of root.querySelectorAll("fieldset")) {
      fields.classList.add("category-manager__options");
      for (const label of fields.querySelectorAll("label")) {
        const input = label.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!input) continue;
        const text = label.textContent ?? "", suffix = ` (${input.value})`;
        const copy = document.createElement("span"), name = document.createElement("span"), code = document.createElement("small");
        name.textContent = text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
        code.textContent = input.value;
        copy.append(name, code);
        label.replaceChildren(input, copy);
      }
    }
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
