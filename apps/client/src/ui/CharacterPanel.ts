import {
  getCharacterStatistics,
  MAX_CHARACTER_LEVEL,
  type CharacterSnapshot,
  type InjuryKind
} from "@web-mmorpg/shared";
import { experienceProgressMarkup } from "./ExperienceProgress";

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
    const statistics = character.statistics ?? getCharacterStatistics(character.level);
    const currentBase = getCharacterStatistics(character.level);
    const next = getCharacterStatistics(character.level + 1);
    const bonuses = [
      `+${next.strength - currentBase.strength} STR`,
      `+${next.dexterity - currentBase.dexterity} DEX`,
      `+${next.vitality - currentBase.vitality} VIT`,
      `+${next.maxHp - currentBase.maxHp} HP`,
      `+${next.meleeDamage - currentBase.meleeDamage} obrażeń wręcz`,
      `+${next.rangedDamage - currentBase.rangedDamage} obrażeń dystansowych`,
      `+${next.armor - currentBase.armor} pancerza`,
      ...(next.maxAp > currentBase.maxAp ? [`+${next.maxAp - currentBase.maxAp} AP`] : []),
      ...(next.initiative > currentBase.initiative ? [`+${next.initiative - currentBase.initiative} inicjatywy`] : [])
    ];
    const growth = character.level >= MAX_CHARACTER_LEVEL
      ? "Osiągnięto maksymalny poziom."
      : `Poziom ${character.level + 1}: ${bonuses.join(", ")}.`;

    this.content.innerHTML = `
      <dl class="character-sheet__stats">
        <div><dt>Imię</dt><dd data-name></dd></div>
        <div><dt>Poziom</dt><dd>${character.level}</dd></div>
        <div><dt>HP</dt><dd data-stat="hp">${character.hp}/${character.maxHp}</dd></div>
        <div><dt>AP na turę</dt><dd data-stat="maxAp">${character.maxAp}</dd></div>
        <div><dt>Inicjatywa</dt><dd data-stat="initiative">${character.initiative}</dd></div>
        <div><dt>Stan</dt><dd>${character.severelyInjured ? "Ciężko ranny" : "Stabilny"}</dd></div>
      </dl>
      ${experienceProgressMarkup(character)}
      <section class="character-sheet__section">
        <h3>Atrybuty i walka</h3>
        <dl class="character-sheet__stats">
          <div><dt>Siła (STR)</dt><dd data-stat="strength">${statistics.strength}</dd></div>
          <div><dt>Zręczność (DEX)</dt><dd data-stat="dexterity">${statistics.dexterity}</dd></div>
          <div><dt>Żywotność (VIT)</dt><dd data-stat="vitality">${statistics.vitality}</dd></div>
          <div><dt>Obrażenia wręcz</dt><dd data-stat="meleeDamage">${statistics.meleeDamage}</dd></div>
          <div><dt>Obrażenia dystansowe</dt><dd data-stat="rangedDamage">${statistics.rangedDamage}</dd></div>
          <div><dt>Pancerz</dt><dd data-stat="armor">${statistics.armor}</dd></div>
        </dl>
        <p>STR zwiększa obrażenia wręcz, DEX obrażenia dystansowe, a VIT maksymalne HP. Pancerz zmniejsza otrzymywane obrażenia.</p>
        <p>Obrażenia podano przed pancerzem celu i wpływem urazów.</p>
      </section>
      <section class="character-sheet__section">
        <h3>Automatyczny rozwój</h3>
        <p>Statystyki rosną automatycznie przy awansie. Inicjatywa rośnie co 2 poziomy, a AP co 10 poziomów, do 8 AP.</p>
        <p data-next-growth>${growth}</p>
      </section>
      <section class="character-sheet__section">
        <h3>Urazy</h3>
        <p data-injuries></p>
      </section>
    `;

    const name = this.content.querySelector<HTMLElement>("[data-name]");
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
