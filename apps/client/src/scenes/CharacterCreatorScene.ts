import type { SessionView } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { AuthApi, AuthApiRequestError } from "../net/AuthApi";
import { gameSocket } from "../net/GameSocket";
import { sessionStateStore, type SessionStateStore } from "../state/SessionStateStore";

type EnterWorld = (token: string, session: SessionView) => void;

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiRequestError) return error.message;
  return "Nie udało się utworzyć postaci. Spróbuj ponownie.";
}

export class CharacterCreatorPanel {
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
        <form data-character-form novalidate>
          <label>
            Nick postaci
            <input name="nickname" autocomplete="nickname" minlength="3" maxlength="20" required />
          </label>
          <label>
            Sylwetka
            <select name="bodyType">
              <option value="balanced">Zrównoważona</option>
              <option value="slim">Szczupła</option>
              <option value="strong">Masywna</option>
            </select>
          </label>
          <label>
            Fryzura
            <select name="hairStyle">
              <option value="short">Krótka</option>
              <option value="long">Długa</option>
              <option value="shaved">Ogolona</option>
            </select>
          </label>
          <label>
            Kolor włosów
            <select name="hairColor">
              <option value="brown">Brązowe</option>
              <option value="black">Czarne</option>
              <option value="blonde">Jasne</option>
              <option value="red">Rude</option>
            </select>
          </label>
          <button type="submit">Wejdź do świata</button>
          <p class="form-error" data-character-error></p>
        </form>
      </section>
    `;

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

    const appearance = {
      bodyType: String(data.get("bodyType") ?? "balanced"),
      hairStyle: String(data.get("hairStyle") ?? "short"),
      hairColor: String(data.get("hairColor") ?? "brown")
    };

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
