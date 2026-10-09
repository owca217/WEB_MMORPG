import type { ItemCreatorMetadata, ItemDraftInput } from "@web-mmorpg/shared";

export class ItemTooltipPreview {
  private metadata: ItemCreatorMetadata | null = null;

  constructor(private readonly host: HTMLElement) {
    this.host.dataset.tooltipPreview = "";
    this.host.classList.add("item-tooltip-preview");
  }

  setMetadata(metadata: ItemCreatorMetadata): void {
    this.metadata = metadata;
  }

  render(draft: ItemDraftInput): void {
    this.host.replaceChildren();

    const header = document.createElement("div");
    header.className = "item-tooltip-preview__header";
    if (draft.iconUrl) {
      const image = document.createElement("img");
      image.src = draft.iconUrl;
      image.alt = "";
      image.width = 56;
      image.height = 56;
      header.append(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "item-tooltip-preview__icon";
      placeholder.textContent = "?";
      header.append(placeholder);
    }

    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.className = `item-tooltip-preview__name rarity-${draft.rarity.toLocaleLowerCase()}`;
    name.textContent = draft.name.trim() || "Bez nazwy";
    const meta = document.createElement("span");
    meta.textContent = `${draft.rarity} • Poziom przedmiotu ${draft.itemLevel} • Wymagany poziom ${draft.minimumLevel}`;
    identity.append(name, meta);
    header.append(identity);
    this.host.append(header);

    if (draft.stats.length > 0) {
      this.host.append(this.section("Statystyki", draft.stats.map((stat) => {
        const label = this.metadata?.stats.find((entry) => entry.code === stat.statCode)?.label ?? stat.statCode;
        const suffix = stat.modifierType === "percent" ? "%" : stat.modifierType === "multiplier" ? "×" : "";
        const prefix = stat.value > 0 && stat.modifierType !== "multiplier" ? "+" : "";
        return `${label}: ${prefix}${stat.value}${suffix}`;
      })));
    }

    if (draft.requirements.length > 0) {
      this.host.append(this.section("Wymagania", draft.requirements.map((requirement) => {
        const code = requirement.code ? ` ${requirement.code}` : "";
        const value = requirement.value === undefined ? "" : ` ${String(requirement.value)}`;
        return `${requirement.type}${code}${value}`.trim();
      })));
    }

    if (draft.description.trim()) {
      const description = document.createElement("p");
      description.className = "item-tooltip-preview__description";
      description.textContent = draft.description;
      this.host.append(description);
    }

    if (draft.effects.length > 0) {
      this.host.append(this.section("Efekty", draft.effects.map((effect) => {
        const trigger = this.metadata?.triggers.find((entry) => entry.code === effect.triggerCode)?.label ?? effect.triggerCode;
        const action = this.metadata?.effects.find((entry) => entry.code === effect.effectCode)?.label ?? effect.effectCode;
        const details = [
          effect.value === undefined ? null : `wartość ${effect.value}`,
          effect.chance === undefined ? null : `szansa ${Math.round(effect.chance * 100)}%`,
          effect.durationMs === undefined ? null : `czas ${effect.durationMs} ms`,
          effect.cooldownMs === undefined ? null : `CD ${effect.cooldownMs} ms`
        ].filter((value): value is string => Boolean(value));
        return `${trigger}: ${action}${details.length ? ` (${details.join(", ")})` : ""}`;
      })));
    }
  }

  private section(title: string, lines: string[]): HTMLElement {
    const section = document.createElement("section");
    section.className = "item-tooltip-preview__section";
    const heading = document.createElement("b");
    heading.textContent = title;
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    section.append(heading, list);
    return section;
  }
}
