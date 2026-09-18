import {
  APPEARANCE_CATALOG,
  DEFAULT_APPEARANCE,
  type AppearanceSelection
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { CharacterPreview } from "../appearance/CharacterPreview";
import { apiClient } from "../net/ApiClient";

type AppearanceKey = keyof typeof APPEARANCE_CATALOG;

const LABELS: Record<AppearanceKey, string> = {
  bodyType: "Sylwetka",
  skinTone: "Kolor skóry",
  face: "Twarz",
  eyes: "Oczy",
  hair: "Fryzura",
  hairColor: "Kolor włosów",
  facialHair: "Zarost",
  marking: "Blizna / tatuaż",
  startingOutfit: "Ubiór startowy"
};

export class CharacterCreatorScene extends Phaser.Scene {
  private panel: HTMLDivElement | null = null;
  private preview: CharacterPreview | null = null;
  private readonly valueNodes = new Map<AppearanceKey, HTMLElement>();
  private selection: AppearanceSelection = { ...DEFAULT_APPEARANCE };

  constructor() {
    super("CharacterCreatorScene");
  }

  create(): void {
    this.selection = { ...DEFAULT_APPEARANCE };
    this.buildCreator();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyForm());
  }

  private buildCreator(): void {
    this.destroyForm();

    const panel = document.createElement("div");
    panel.className = "character-creator";

    const title = document.createElement("h1");
    title.textContent = "Utwórz postać";

    const subtitle = document.createElement("p");
    subtitle.textContent =
      "Ta postać będzie na stałe przypisana do Twojego konta.";

    const content = document.createElement("div");
    content.className = "character-creator__content";

    this.preview = new CharacterPreview();
    this.preview.render(this.selection);

    const form = document.createElement("form");
    form.className = "character-creator__form";

    const nicknameLabel = document.createElement("label");
    nicknameLabel.textContent = "Nick postaci";
    const nicknameInput = document.createElement("input");
    nicknameInput.name = "nickname";
    nicknameInput.minLength = 3;
    nicknameInput.maxLength = 20;
    nicknameInput.required = true;
    nicknameInput.autocomplete = "off";
    nicknameInput.placeholder = "Np. Owczy";
    nicknameLabel.appendChild(nicknameInput);
    form.appendChild(nicknameLabel);

    for (const key of Object.keys(APPEARANCE_CATALOG) as AppearanceKey[]) {
      form.appendChild(this.createSelector(key));
    }

    const error = document.createElement("p");
    error.className = "form-error";

    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Utwórz postać";

    form.append(error, submit);
    content.append(this.preview.element, form);
    panel.append(title, subtitle, content);
    document.body.appendChild(panel);
    this.panel = panel;

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "Tworzenie postaci…";
      submit.disabled = true;

      void apiClient
        .createCharacter({
          nickname: nicknameInput.value,
          appearance: { ...this.selection }
        })
        .then((character) => {
          this.destroyForm();
          this.scene.start("WorldScene", { playerId: character.id });
        })
        .catch((caught: unknown) => {
          error.textContent =
            caught instanceof Error
              ? caught.message
              : "Nie udało się utworzyć postaci.";
          submit.disabled = false;
        });
    });
  }

  private createSelector(key: AppearanceKey): HTMLElement {
    const row = document.createElement("div");
    row.className = "character-creator__selector";

    const label = document.createElement("strong");
    label.textContent = LABELS[key];

    const controls = document.createElement("div");
    const previous = document.createElement("button");
    previous.type = "button";
    previous.textContent = "‹";
    previous.setAttribute("aria-label", `Poprzedni wariant: ${LABELS[key]}`);

    const valueNode = document.createElement("span");
    valueNode.dataset.appearanceValue = key;
    this.valueNodes.set(key, valueNode);

    const next = document.createElement("button");
    next.type = "button";
    next.textContent = "›";
    next.setAttribute("aria-label", `Następny wariant: ${LABELS[key]}`);

    controls.append(previous, valueNode, next);
    row.append(label, controls);

    const cycle = (direction: -1 | 1): void => {
      const options = APPEARANCE_CATALOG[key] as readonly string[];
      const current = this.selection[key];
      const currentIndex = Math.max(0, options.indexOf(current));
      const nextIndex =
        (currentIndex + direction + options.length) % options.length;
      this.selection[key] = options[nextIndex]!;
      this.refreshSelection();
    };

    previous.addEventListener("click", () => cycle(-1));
    next.addEventListener("click", () => cycle(1));
    this.updateValueNode(key);

    return row;
  }

  private refreshSelection(): void {
    this.preview?.render(this.selection);
    for (const key of this.valueNodes.keys()) this.updateValueNode(key);
  }

  private updateValueNode(key: AppearanceKey): void {
    const node = this.valueNodes.get(key);
    if (!node) return;
    const options = APPEARANCE_CATALOG[key] as readonly string[];
    const index = Math.max(0, options.indexOf(this.selection[key]));
    node.textContent = `${index + 1} / ${options.length}`;
  }

  private destroyForm(): void {
    this.preview?.destroy();
    this.preview = null;
    this.panel?.remove();
    this.panel = null;
    this.valueNodes.clear();
  }
}
