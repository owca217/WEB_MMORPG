import type { InjuryKind } from "@web-mmorpg/shared";
import type { BattleEndedPayload } from "../net/GameSocket";

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};

export class LootSummary {
  private readonly root = document.createElement("div");

  constructor(private readonly onReturn: () => void) {
    this.root.className = "game-panel loot-summary";
    document.body.appendChild(this.root);
  }

  show(payload: BattleEndedPayload): void {
    this.root.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = payload.outcome === "victory"
      ? "Zwycięstwo"
      : "Porażka — wracasz do osady";

    const lead = document.createElement("p");
    lead.className = "loot-summary__lead";
    lead.textContent = payload.outcome === "victory"
      ? "Walka dobiegła końca. Zdobyte przedmioty są już w twoim ekwipunku."
      : "Udało ci się wrócić do osady, ale skutki walki pozostały.";

    const hp = document.createElement("p");
    hp.className = "loot-summary__hp";
    hp.textContent = `Stan postaci: ${payload.character.hp}/${payload.character.maxHp} HP`;

    this.root.append(title, lead, hp);

    if (payload.outcome === "victory") {
      const lootTitle = document.createElement("h3");
      lootTitle.textContent = "Łup";
      this.root.appendChild(lootTitle);

      const lootList = document.createElement("div");
      lootList.className = "loot-summary__items";
      const relevantItems = payload.inventory.items.filter(
        (item) => item.itemId === "wolf-pelt" || item.itemId === "field-bandage"
      );

      if (relevantItems.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "Brak nowych przedmiotów.";
        lootList.appendChild(empty);
      } else {
        for (const item of relevantItems) {
          const row = document.createElement("div");
          row.className = "loot-summary__item";
          const name = document.createElement("strong");
          name.textContent = item.name;
          const quantity = document.createElement("span");
          quantity.textContent = `x${item.quantity}`;
          row.append(name, quantity);
          lootList.appendChild(row);
        }
      }

      this.root.appendChild(lootList);
    } else {
      const injuryTitle = document.createElement("h3");
      injuryTitle.textContent = "Skutki walki";
      this.root.appendChild(injuryTitle);

      const severe = document.createElement("p");
      severe.textContent = payload.character.severelyInjured
        ? "Stan: ciężko ranny"
        : "Stan: stabilny";
      this.root.appendChild(severe);

      if (payload.character.injuries.length > 0) {
        const injuries = document.createElement("p");
        injuries.textContent = `Urazy: ${payload.character.injuries
          .map((injury) => INJURY_LABELS[injury])
          .join(", ")}`;
        this.root.appendChild(injuries);
      }
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "loot-summary__return";
    button.textContent = "Wróć do świata";
    button.onclick = this.onReturn;
    this.root.appendChild(button);
  }

  destroy(): void {
    this.root.remove();
  }
}
