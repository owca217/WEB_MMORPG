import { InterfaceWindowControls } from "./InterfaceWindowControls";

export interface ProfessionDefinition {
  id: string;
  name: string;
  description: string;
  level: number;
  progress: number;
  effect: string;
}

export interface ProfessionCategory {
  id: string;
  title: string;
  summary: string;
  professions: readonly ProfessionDefinition[];
}

export const PROFESSION_CATEGORIES: readonly ProfessionCategory[] = [
  {
    id: "weapons",
    title: "Specjalizacje broni",
    summary: "Biegłość w poszczególnych typach uzbrojenia",
    professions: [
      {
        id: "swords",
        name: "Miecze",
        description: "Jednoręczne ostrza i szybkie, precyzyjne cięcia.",
        level: 1,
        progress: 35,
        effect: "+2% obrażeń mieczem"
      },
      {
        id: "axes",
        name: "Topory",
        description: "Ciężkie uderzenia przełamujące obronę przeciwnika.",
        level: 1,
        progress: 20,
        effect: "+2% szansy na przełamanie"
      },
      {
        id: "spears",
        name: "Włócznie",
        description: "Długi zasięg i kontrola dystansu podczas walki.",
        level: 1,
        progress: 15,
        effect: "+1 zasięgu ataku"
      },
      {
        id: "bows",
        name: "Łuki i kusze",
        description: "Celne ataki dystansowe wymagające opanowania oddechu.",
        level: 1,
        progress: 10,
        effect: "+2% celności"
      },
      {
        id: "magic-weapons",
        name: "Broń magiczna",
        description: "Różdżki, laski i artefakty wzmacniające zaklęcia.",
        level: 1,
        progress: 25,
        effect: "+2% mocy zaklęć"
      }
    ]
  },
  {
    id: "offensive",
    title: "Umiejętności ofensywne",
    summary: "Techniki zwiększające siłę ataku",
    professions: [
      {
        id: "physical-damage",
        name: "Siła ciosu",
        description: "Rozwój techniki pozwalającej zadawać większe obrażenia.",
        level: 1,
        progress: 40,
        effect: "+1% obrażeń fizycznych"
      },
      {
        id: "magical-damage",
        name: "Moc żywiołów",
        description: "Lepsze skupienie energii ognia, lodu i błyskawic.",
        level: 1,
        progress: 30,
        effect: "+1% obrażeń magicznych"
      },
      {
        id: "critical-hits",
        name: "Trafienia krytyczne",
        description: "Wyczucie chwili, w której atak może zadać wyjątkowe obrażenia.",
        level: 1,
        progress: 18,
        effect: "+0,5% szansy krytycznej"
      },
      {
        id: "attack-speed",
        name: "Szybkość ataku",
        description: "Płynniejsze przejścia między kolejnymi atakami.",
        level: 1,
        progress: 12,
        effect: "+1% szybkości ataku"
      }
    ]
  },
  {
    id: "defensive",
    title: "Umiejętności defensywne",
    summary: "Szkolenie zwiększające przeżywalność bohatera",
    professions: [
      {
        id: "armor",
        name: "Pancerz",
        description: "Właściwe ustawienie ciała i wykorzystanie ochrony.",
        level: 1,
        progress: 32,
        effect: "+1% redukcji obrażeń"
      },
      {
        id: "block",
        name: "Blok",
        description: "Techniki odbijania ciosów tarczą lub bronią.",
        level: 1,
        progress: 22,
        effect: "+1% szansy na blok"
      },
      {
        id: "resistances",
        name: "Odporności",
        description: "Hartowanie ciała przeciw truciznom i magii przeciwnika.",
        level: 1,
        progress: 16,
        effect: "+1 odporności"
      },
      {
        id: "vitality",
        name: "Wytrzymałość",
        description: "Lepsza kondycja i większa odporność na długą walkę.",
        level: 1,
        progress: 28,
        effect: "+2 maks. PŻ"
      }
    ]
  }
];

export function renderProfessionsMarkup(
  categories: readonly ProfessionCategory[] = PROFESSION_CATEGORIES
): string {
  return categories.map((category) => `
    <details class="professions__category" data-profession-category="${category.id}"${category.id === "weapons" ? " open" : ""}>
      <summary>
        <span class="professions__category-title">${category.title}</span>
        <span class="professions__category-summary">${category.summary}</span>
        <span class="professions__category-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="professions__grid">
        ${category.professions.map((profession) => renderProfessionCard(profession)).join("")}
      </div>
    </details>
  `).join("");
}

export class ProfessionsPanel {
  private readonly root: HTMLDivElement;
  private readonly windowControls: InterfaceWindowControls;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--professions is-hidden";
    this.root.setAttribute("aria-label", "Profesje");
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Profesje</h2>
      </div>
      <div class="professions" data-content></div>
    `;
    document.body.appendChild(this.root);

    const content = this.root.querySelector<HTMLElement>("[data-content]");
    if (!content) throw new Error("Professions panel content element missing");
    content.innerHTML = renderProfessionsMarkup();

    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".game-panel__header"),
      onClose: () => this.hide()
    });
  }

  show(): void {
    document.body.appendChild(this.root);
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  toggle(): void {
    if (this.root.classList.contains("is-hidden")) this.show();
    else this.hide();
  }

  destroy(): void {
    this.windowControls.destroy();
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Professions panel element missing: ${selector}`);
    return element;
  }
}

function renderProfessionCard(profession: ProfessionDefinition): string {
  const progress = Math.max(0, Math.min(100, Math.round(profession.progress)));
  return `
    <article class="profession-card" data-profession-id="${profession.id}">
      <header class="profession-card__header">
        <div>
          <h3>${profession.name}</h3>
          <span>Poziom ${profession.level}</span>
        </div>
        <span class="profession-card__badge">${progress}%</span>
      </header>
      <p>${profession.description}</p>
      <div class="profession-card__progress" role="progressbar"
        aria-label="Postęp specjalizacji: ${profession.name}"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <span style="width: ${progress}%"></span>
      </div>
      <footer>${profession.effect}<small>do następnego poziomu</small></footer>
    </article>
  `;
}
