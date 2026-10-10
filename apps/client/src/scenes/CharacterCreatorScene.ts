import type { AppearanceSelection, SessionView } from "@web-mmorpg/shared";
import { APPEARANCE_CATALOG, DEFAULT_APPEARANCE } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { CharacterPreview } from "../appearance/CharacterPreview";
import { AuthApi, AuthApiRequestError } from "../net/AuthApi";
import { gameSocket } from "../net/GameSocket";
import { sessionStateStore, type SessionStateStore } from "../state/SessionStateStore";

type EnterWorld = (token: string, session: SessionView) => void;

const APPEARANCE_FIELDS: ReadonlyArray<{ key: keyof AppearanceSelection; label: string }> = [
  { key: "bodyType", label: "Sylwetka" },
  { key: "skinTone", label: "Odcień skóry" },
  { key: "face", label: "Twarz" },
  { key: "eyes", label: "Oczy" },
  { key: "hair", label: "Fryzura" },
  { key: "hairColor", label: "Kolor włosów" },
  { key: "facialHair", label: "Zarost" },
  { key: "marking", label: "Blizny i tatuaże" },
  { key: "startingOutfit", label: "Strój" }
];

const OPTION_LABELS: Record<string, string> = {
  "body-01": "Sylwetka I", "body-02": "Sylwetka II",
  "skin-01": "Jasna", "skin-02": "Piaskowa", "skin-03": "Oliwkowa", "skin-04": "Ciemna",
  "face-01": "Twarz I", "face-02": "Twarz II", "face-03": "Twarz III", "face-04": "Twarz IV",
  "eyes-01": "Spokojne", "eyes-02": "Skupione", "eyes-03": "Szeroko otwarte",
  "eyes-sad": "Smutne", "eyes-angry": "Gniewne", "eyes-closed": "Zamknięte",
  "hair-01": "Krótka I", "hair-02": "Krótka II", "hair-03": "Długa I",
  "hair-04": "Długa II", "hair-05": "Ogolona",
  "hair-color-01": "Brązowe", "hair-color-02": "Czarne", "hair-color-03": "Jasne",
  "hair-color-04": "Rude", "hair-color-05": "Siwe", "hair-color-06": "Białe",
  "facial-hair-none": "Brak", "facial-hair-01": "Krótki zarost", "facial-hair-02": "Pełna broda",
  "marking-none": "Brak", "scar-01": "Blizna I", "scar-02": "Blizna II", "tattoo-01": "Tatuaż",
  "outfit-01": "Podróżny", "outfit-02": "Skórzany", "outfit-03": "Strażnik", "outfit-base": "Podstawowy"
};

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiRequestError) return error.message;
  return "Nie udało się utworzyć postaci. Spróbuj ponownie.";
}

export class CharacterCreatorPanel {
  private preview: CharacterPreview | undefined;

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
          <h1>Stwórz postać</h1>
          <p>Ta postać będzie na stałe przypisana do Twojego konta.</p>
        </header>
        <div class="character-creator__content">
          <form class="character-creator__form" data-character-form novalidate>
            <label>
              Nick postaci
              <input name="nickname" autocomplete="nickname" minlength="3" maxlength="20" required />
            </label>
            <fieldset class="character-creator__selector" data-appearance-fields>
              <legend>Wygląd</legend>
            </fieldset>
            <button type="submit">Wejdź do świata</button>
            <p class="form-error" data-character-error></p>
          </form>
          <div data-character-preview></div>
        </div>
      </section>
    `;

    const form = this.host.querySelector<HTMLFormElement>("[data-character-form]");
    const fields = this.host.querySelector<HTMLElement>("[data-appearance-fields]");
    if (!form || !fields) return;

    this.preview = new CharacterPreview({ showOutfitToggle: false });
    this.host.querySelector("[data-character-preview]")?.append(this.preview.element);

    for (const field of APPEARANCE_FIELDS) {
      const label = document.createElement("label");
      label.textContent = field.label;
      const select = document.createElement("select");
      select.name = field.key;
      select.dataset.appearanceField = field.key;
      const options = APPEARANCE_CATALOG[field.key] as readonly string[];
      for (const value of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = OPTION_LABELS[value] ?? value;
        option.selected = value === DEFAULT_APPEARANCE[field.key];
        select.append(option);
      }
      label.append(select);
      fields.append(label);
    }

    form.addEventListener("change", () => this.updatePreview());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.updatePreview();
  }

  unmount(): void {
    this.preview?.destroy();
    this.preview = undefined;
    this.host.replaceChildren();
  }

  private currentAppearance(): AppearanceSelection {
    const form = this.host.querySelector<HTMLFormElement>("[data-character-form]");
    const appearance = { ...DEFAULT_APPEARANCE };
    if (!form) return appearance;
    const data = new FormData(form);
    for (const field of APPEARANCE_FIELDS) {
      const value = data.get(field.key);
      if (typeof value === "string") appearance[field.key] = value;
    }
    return appearance;
  }

  private updatePreview(): void {
    this.preview?.render(this.currentAppearance());
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

    try {
      await this.api.createCharacter(token, { nickname, appearance: this.currentAppearance() });
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
    host.className = "character-creator-scene";
    document.body.appendChild(host);
    this.host = host;

    const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
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
