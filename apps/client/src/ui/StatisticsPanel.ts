import {
  experienceRequiredForLevelUp,
  type CharacterSnapshot,
  type InjuryKind
} from "@web-mmorpg/shared";
import { InterfaceWindowControls } from "./InterfaceWindowControls";

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};

export class StatisticsPanel {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly windowControls: InterfaceWindowControls;

  constructor(handlers: { onDeleteCharacter?: () => void } = {}) {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--statistics is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Statystyki</h2>
      </div>
      <div class="character-sheet" data-content></div>
    `;
    document.body.appendChild(this.root);
    this.content = this.require<HTMLDivElement>("[data-content]");
    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".game-panel__header"),
      onClose: () => this.hide()
    });

    if (handlers.onDeleteCharacter) {
      const actions = document.createElement("div");
      actions.className = "character-sheet__account-actions";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.dataset.deleteCharacter = "";
      deleteButton.textContent = "Usuń postać";
      deleteButton.addEventListener("click", handlers.onDeleteCharacter);
      actions.appendChild(deleteButton);
      this.root.appendChild(actions);
    }
  }

  update(character: CharacterSnapshot): void {
    const injuries = character.injuries.length
      ? character.injuries.map((injury) => INJURY_LABELS[injury]).join(", ")
      : "Brak";
    const currentExperience = normalizeExperience(character.experience);
    const requiredExperience = experienceRequiredForLevelUp(character.level);
    const remainingExperience = Math.max(
      requiredExperience - currentExperience,
      0
    );
    const progress = Math.min(
      100,
      Math.round((currentExperience / requiredExperience) * 100)
    );
    const nextLevel = character.level + 1;

    this.content.innerHTML = `
      <div class="character-sheet__showcase" aria-hidden="true">
        <div class="character-sheet__silhouette"></div>
      </div>
      <dl class="character-sheet__stats">
        <div><dt>Imię</dt><dd></dd></div>
        <div><dt>Poziom</dt><dd>${character.level}</dd></div>
        <div><dt>PŻ</dt><dd>${character.hp}/${character.maxHp}</dd></div>
        <div><dt>PM</dt><dd>${character.maxAp}</dd></div>
        <div><dt>Inicjatywa</dt><dd>${character.initiative}</dd></div>
        <div><dt>Stan</dt><dd>${character.severelyInjured ? "Ciężko ranny" : "Stabilny"}</dd></div>
        <div><dt>Doświadczenie</dt><dd>${formatExperience(currentExperience)} EXP</dd></div>
        <div><dt>Wymagane do awansu</dt><dd>${formatExperience(requiredExperience)} EXP</dd></div>
      </dl>
      <section class="character-sheet__experience" aria-label="Postęp doświadczenia">
        <div class="character-sheet__experience-heading">
          <strong>Postęp do poziomu ${nextLevel}</strong>
          <span>${remainingExperience > 0 ? `Brakuje ${formatExperience(remainingExperience)} EXP` : "Gotowe do awansu"}</span>
        </div>
        <div class="character-sheet__experience-bar" role="progressbar" aria-label="Doświadczenie do następnego poziomu" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
          <span style="width: ${progress}%"></span>
        </div>
        <small>${formatExperience(currentExperience)} / ${formatExperience(requiredExperience)} EXP</small>
      </section>
      <div class="character-sheet__details">
        <section class="character-sheet__section">
          <h3>Urazy</h3>
          <p data-injuries></p>
        </section>
        <section class="character-sheet__section">
          <h3>Specjalizacje</h3>
          <p>Rozwój biegłości pojawi się w kolejnym etapie.</p>
        </section>
      </div>
    `;

    const name = this.content.querySelector<HTMLElement>("dd");
    if (name) name.textContent = character.nickname;
    const injuryElement = this.content.querySelector<HTMLElement>("[data-injuries]");
    if (injuryElement) injuryElement.textContent = injuries;
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
    if (!element) throw new Error(`Statistics panel element missing: ${selector}`);
    return element;
  }
}

function normalizeExperience(experience: number | undefined): number {
  if (typeof experience !== "number" || !Number.isFinite(experience)) return 0;
  return Math.max(0, Math.trunc(experience));
}

function formatExperience(experience: number): string {
  return experience.toLocaleString("pl-PL");
}
