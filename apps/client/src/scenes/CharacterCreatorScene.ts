import {
  BASE_CHARACTER_SKINS,
  getCharacterSkin,
  resolveCharacterSkin,
  type CharacterGender,
  type CharacterSkinId,
  type SessionView
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { CHARACTER_SKIN_ATLASES, getCharacterSkinFrame } from "../characters/characterSkinAssets";
import { resolveGameServerUrl } from "../hosting";
import { AuthApi, AuthApiRequestError } from "../net/AuthApi";
import { gameSocket } from "../net/GameSocket";
import { sessionStateStore, type SessionStateStore } from "../state/SessionStateStore";

type EnterWorld = (token: string, session: SessionView) => void;
type PreviewDirection = "south" | "west" | "east" | "north";

const PREVIEW_DIRECTIONS: ReadonlyArray<{ id: PreviewDirection; label: string }> = [
  { id: "south", label: "Przód" },
  { id: "west", label: "Lewo" },
  { id: "east", label: "Prawo" },
  { id: "north", label: "Tył" }
];

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiRequestError) return error.message;
  return "Nie udało się utworzyć postaci. Spróbuj ponownie.";
}

export class CharacterCreatorPanel {
  private skinId: CharacterSkinId = resolveCharacterSkin().id;
  private direction: PreviewDirection = "south";

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AuthApi,
    private readonly store: SessionStateStore,
    private readonly onEnterWorld: EnterWorld
  ) {}

  mount(): void {
    this.host.innerHTML = `
      <section class="character-creator login-panel" data-character-panel>
        <header class="auth-panel__header">
          <span class="auth-panel__eyebrow">Twoja przygoda zaczyna się tutaj</span>
          <h1>Stwórz postać</h1>
          <p class="auth-panel__intro">Nadaj jej imię i wybierz wygląd. Ta postać będzie na stałe przypisana do Twojego konta.</p>
        </header>
        <form class="auth-form character-creator__form" data-character-form novalidate>
          <section class="character-preview" aria-label="Podgląd postaci">
            <div class="character-preview__stage">
              <span class="character-preview__caption">Podgląd postaci</span>
              <div class="character-skin-sprite character-preview__sprite" data-skin-preview role="img"></div>
            </div>
            <div class="character-preview__details" aria-live="polite">
              <h2 data-preview-name></h2>
              <p data-preview-description></p>
            </div>
            <div class="character-preview__directions" role="group" aria-label="Kierunek podglądu">
              ${PREVIEW_DIRECTIONS.map(({ id, label }) => `
                <button type="button" data-direction="${id}" aria-pressed="${this.direction === id}">${label}</button>
              `).join("")}
            </div>
          </section>
          <div class="character-creator__options">
            <label>
              Nick postaci
              <input name="nickname" autocomplete="nickname" minlength="3" maxlength="20" required />
            </label>
            <fieldset class="character-creator__fieldset">
              <legend>Płeć</legend>
              <div class="character-creator__genders">
                <label class="character-option character-gender-option">
                  <input type="radio" name="gender" value="male" checked />
                  <span class="character-gender-option__surface">Mężczyzna</span>
                </label>
                <label class="character-option character-gender-option">
                  <input type="radio" name="gender" value="female" />
                  <span class="character-gender-option__surface">Kobieta</span>
                </label>
              </div>
            </fieldset>
            <fieldset class="character-creator__fieldset">
              <legend>Wygląd postaci</legend>
              <div class="character-creator__skins" data-skin-options></div>
            </fieldset>
            <p class="character-creator__hint">Wybierz strój na początek swojej przygody.</p>
            <button class="auth-submit" type="submit">Wejdź do świata <span aria-hidden="true">→</span></button>
            <p class="form-error" data-character-error role="alert"></p>
          </div>
        </form>
      </section>
    `;

    this.renderSkinOptions();
    this.updatePreview();
    this.host.querySelector<HTMLFormElement>("[data-character-form]")?.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.name === "gender") {
        const gender: CharacterGender = target.value === "female" ? "female" : "male";
        const variant = this.skinId.split("-")[1];
        this.skinId = getCharacterSkin(`${gender}-${variant}`)?.id ?? resolveCharacterSkin({ gender }).id;
        this.renderSkinOptions();
        this.updatePreview();
      } else if (target.name === "skinId") {
        const skin = getCharacterSkin(target.value);
        if (!skin) return;
        this.skinId = skin.id;
        this.updatePreview();
      }
    });
    this.host.querySelectorAll<HTMLButtonElement>("button[data-direction]").forEach((button) => {
      button.addEventListener("click", () => {
        const direction = PREVIEW_DIRECTIONS.find(({ id }) => id === button.dataset.direction);
        if (!direction) return;
        this.direction = direction.id;
        this.updatePreview();
      });
    });
    this.host
      .querySelector<HTMLFormElement>("[data-character-form]")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submit();
      });
  }

  unmount(): void {
    this.host.replaceChildren();
  }

  private renderSkinOptions(): void {
    const options = this.host.querySelector<HTMLElement>("[data-skin-options]");
    if (!options) return;
    const selected = resolveCharacterSkin({ skinId: this.skinId });
    options.innerHTML = BASE_CHARACTER_SKINS.filter(({ gender }) => gender === selected.gender).map((skin) => `
      <label class="character-option character-skin-option">
        <input type="radio" name="skinId" value="${skin.id}" ${skin.id === this.skinId ? "checked" : ""} />
        <span class="character-skin-option__surface">
          <span class="character-skin-sprite character-skin-option__sprite" data-card-skin="${skin.id}" aria-hidden="true"></span>
          <strong>${skin.name}</strong>
          <span class="character-skin-option__description">${skin.description}</span>
        </span>
      </label>
    `).join("");
    options.querySelectorAll<HTMLElement>("[data-card-skin]").forEach((sprite) => {
      const skin = getCharacterSkin(sprite.dataset.cardSkin);
      if (skin) this.applySkinFrame(sprite, skin.id, 0);
    });
  }

  private applySkinFrame(sprite: HTMLElement, skinId: CharacterSkinId, rowIndex: number): void {
    const frame = getCharacterSkinFrame(skinId, rowIndex);
    sprite.style.setProperty("--skin-image", `url("${CHARACTER_SKIN_ATLASES[skinId].url}")`);
    sprite.style.setProperty("--skin-source-y", String(frame.y));
    sprite.style.setProperty("--skin-source-height", String(frame.height));
    sprite.style.setProperty("--skin-offset-y", String(frame.offsetY));
  }

  private updatePreview(): void {
    const skin = resolveCharacterSkin({ skinId: this.skinId });
    const directionIndex = PREVIEW_DIRECTIONS.findIndex(({ id }) => id === this.direction);
    const preview = this.host.querySelector<HTMLElement>("[data-skin-preview]");
    if (preview) {
      preview.dataset.skinId = skin.id;
      preview.dataset.direction = this.direction;
      preview.setAttribute("aria-label", `${skin.name} — ${PREVIEW_DIRECTIONS[directionIndex]!.label}`);
      this.applySkinFrame(preview, skin.id, directionIndex);
    }
    const name = this.host.querySelector<HTMLElement>("[data-preview-name]");
    const description = this.host.querySelector<HTMLElement>("[data-preview-description]");
    if (name) name.textContent = skin.name;
    if (description) description.textContent = skin.description;
    this.host.querySelectorAll<HTMLButtonElement>("button[data-direction]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.direction === this.direction));
    });
  }

  private async submit(): Promise<void> {
    const form = this.host.querySelector<HTMLFormElement>("[data-character-form]");
    const error = this.host.querySelector<HTMLElement>("[data-character-error]");
    if (!form || !error) return;

    const data = new FormData(form);
    const nickname = String(data.get("nickname") ?? "").trim();
    const token = this.store.getToken();
    error.textContent = "";

    if (nickname.length < 3 || nickname.length > 20) {
      error.textContent = "Nick postaci musi mieć od 3 do 20 znaków.";
      return;
    }
    if (!token) {
      error.textContent = "Sesja wygasła. Zaloguj się ponownie.";
      return;
    }

    const selectedSkin = resolveCharacterSkin({ skinId: this.skinId });
    const appearance = { gender: selectedSkin.gender, skinId: selectedSkin.id };

    try {
      await this.api.createCharacter(token, { nickname, appearance });
      const refreshed = await this.api.getSession(token);
      this.store.updateSession(refreshed);
      this.onEnterWorld(token, refreshed);
    } catch (requestError) {
      error.textContent = errorMessage(requestError);
    }
  }
}

export class CharacterCreatorScene extends Phaser.Scene {
  private host: HTMLDivElement | undefined;
  private panel: CharacterCreatorPanel | undefined;

  constructor() {
    super("CharacterCreatorScene");
  }

  create(): void {
    const host = document.createElement("div");
    host.className = "auth-scene character-creator-scene";
    document.body.appendChild(host);
    this.host = host;

    const serverUrl = resolveGameServerUrl(
      import.meta.env.VITE_GAME_SERVER_URL,
      import.meta.env.DEV
    );
    this.panel = new CharacterCreatorPanel(
      host,
      new AuthApi(serverUrl),
      sessionStateStore,
      (token, session) => void this.enterWorld(token, session)
    );
    this.panel.mount();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private async enterWorld(token: string, session: SessionView): Promise<void> {
    if (session.character.state !== "active") {
      const error = this.host?.querySelector<HTMLElement>("[data-character-error]");
      if (error) error.textContent = "Serwer nie potwierdził utworzonej postaci.";
      return;
    }

    try {
      const socketResult = await gameSocket.authenticate(token);
      if (!socketResult.ok) throw new Error(socketResult.message);
      this.cleanup();
      this.scene.start("WorldScene", { playerId: socketResult.characterId });
    } catch (requestError) {
      const error = this.host?.querySelector<HTMLElement>("[data-character-error]");
      if (error) error.textContent = errorMessage(requestError);
    }
  }

  private cleanup(): void {
    this.panel?.unmount();
    this.panel = undefined;
    this.host?.remove();
    this.host = undefined;
  }
}
