import type { CharacterSnapshot, InjuryKind } from "@web-mmorpg/shared";

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};

export class CharacterPanel {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--character is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Postać</h2>
        <button type="button" data-close aria-label="Zamknij">×</button>
      </div>
      <div class="character-sheet" data-content></div>
    `;
    document.body.appendChild(this.root);
    this.content = this.require<HTMLDivElement>("[data-content]");
    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
  }

  update(character: CharacterSnapshot): void {
    const injuries = character.injuries.length
      ? character.injuries.map((injury) => INJURY_LABELS[injury]).join(", ")
      : "Brak";

    this.content.innerHTML = `
      <dl class="character-sheet__stats">
        <div><dt>Imię</dt><dd></dd></div>
        <div><dt>Poziom</dt><dd>${character.level}</dd></div>
        <div><dt>HP</dt><dd>${character.hp}/${character.maxHp}</dd></div>
        <div><dt>Inicjatywa</dt><dd>${character.initiative}</dd></div>
        <div><dt>Stan</dt><dd>${character.severelyInjured ? "Ciężko ranny" : "Stabilny"}</dd></div>
      </dl>
      <section class="character-sheet__section">
        <h3>Urazy</h3>
        <p data-injuries></p>
      </section>
      <section class="character-sheet__section">
        <h3>Specjalizacje</h3>
        <p>Rozwój biegłości pojawi się w kolejnym etapie.</p>
      </section>
    `;

    const name = this.content.querySelector<HTMLElement>("dd");
    if (name) name.textContent = character.nickname;
    const injuryElement = this.content.querySelector<HTMLElement>("[data-injuries]");
    if (injuryElement) injuryElement.textContent = injuries;
  }

  show(): void {
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  toggle(): void {
    this.root.classList.toggle("is-hidden");
  }

  destroy(): void {
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Character panel element missing: ${selector}`);
    return element;
  }
}
