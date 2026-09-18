import Phaser from "phaser";
import type { SessionView } from "@web-mmorpg/shared";
import { apiClient } from "../net/ApiClient";
import { authSessionStore } from "../state/AuthSessionStore";

type AuthMode = "login" | "register" | "recover" | "recoveryCode";

export class AuthScene extends Phaser.Scene {
  private panel: HTMLDivElement | null = null;

  constructor() {
    super("AuthScene");
  }

  create(): void {
    this.showLogin();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyPanel());
  }

  private createPanel(title: string, subtitle?: string): HTMLDivElement {
    this.destroyPanel();

    const panel = document.createElement("div");
    panel.className = "auth-panel";

    const heading = document.createElement("h1");
    heading.textContent = title;
    panel.appendChild(heading);

    if (subtitle) {
      const text = document.createElement("p");
      text.className = "auth-panel__subtitle";
      text.textContent = subtitle;
      panel.appendChild(text);
    }

    document.body.appendChild(panel);
    this.panel = panel;
    return panel;
  }

  private createInput(name: string, placeholder: string, type = "text"): HTMLInputElement {
    const input = document.createElement("input");
    input.name = name;
    input.placeholder = placeholder;
    input.type = type;
    input.required = true;
    input.autocomplete = type === "password" ? "current-password" : "username";
    return input;
  }

  private button(label: string, type: "button" | "submit" = "button"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = type;
    button.textContent = label;
    return button;
  }

  private errorNode(): HTMLParagraphElement {
    const error = document.createElement("p");
    error.className = "form-error";
    return error;
  }

  private showLogin(): void {
    const panel = this.createPanel("WEB MMORPG", "Zaloguj się do swojego konta.");
    const form = document.createElement("form");
    const username = this.createInput("username", "Nazwa konta");
    const password = this.createInput("password", "Hasło", "password");
    password.autocomplete = "current-password";
    const submit = this.button("Zaloguj", "submit");
    const error = this.errorNode();

    const actions = document.createElement("div");
    actions.className = "auth-panel__actions";
    const register = this.button("Utwórz konto");
    const recover = this.button("Odzyskaj konto");
    actions.append(register, recover);

    form.append(username, password, submit, error);
    panel.append(form, actions);

    register.addEventListener("click", () => this.showRegister());
    recover.addEventListener("click", () => this.showRecover());

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "Logowanie...";
      void apiClient
        .login(username.value, password.value)
        .then((result) => this.routeSession(result.session))
        .catch((caught: unknown) => {
          error.textContent =
            caught instanceof Error ? caught.message : "Nie udało się zalogować.";
        });
    });
  }

  private showRegister(): void {
    const panel = this.createPanel("Utwórz konto", "Jedno konto może posiadać jedną postać.");
    const form = document.createElement("form");
    const username = this.createInput("username", "Nazwa konta");
    const password = this.createInput("password", "Hasło (min. 10 znaków)", "password");
    password.autocomplete = "new-password";
    const confirm = this.createInput("passwordConfirmation", "Powtórz hasło", "password");
    confirm.autocomplete = "new-password";
    const submit = this.button("Zarejestruj", "submit");
    const back = this.button("Wróć");
    const error = this.errorNode();

    form.append(username, password, confirm, submit, error);
    panel.append(form, back);

    back.addEventListener("click", () => this.showLogin());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "Tworzenie konta...";
      void apiClient
        .register(username.value, password.value, confirm.value)
        .then((result) =>
          this.showRecoveryCode(result.recoveryCode, "Twój kod odzyskiwania")
        )
        .catch((caught: unknown) => {
          error.textContent =
            caught instanceof Error ? caught.message : "Nie udało się utworzyć konta.";
        });
    });
  }

  private showRecover(): void {
    const panel = this.createPanel("Odzyskaj konto");
    const form = document.createElement("form");
    const username = this.createInput("username", "Nazwa konta");
    const recoveryCode = this.createInput("recoveryCode", "Kod odzyskiwania");
    recoveryCode.autocomplete = "off";
    const password = this.createInput("newPassword", "Nowe hasło", "password");
    password.autocomplete = "new-password";
    const confirm = this.createInput("passwordConfirmation", "Powtórz nowe hasło", "password");
    confirm.autocomplete = "new-password";
    const submit = this.button("Ustaw nowe hasło", "submit");
    const back = this.button("Wróć");
    const error = this.errorNode();

    form.append(username, recoveryCode, password, confirm, submit, error);
    panel.append(form, back);

    back.addEventListener("click", () => this.showLogin());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      error.textContent = "Odzyskiwanie konta...";
      void apiClient
        .recover(username.value, recoveryCode.value, password.value, confirm.value)
        .then((result) => {
          authSessionStore.clear();
          this.showRecoveryCode(result.recoveryCode, "Nowy kod odzyskiwania");
        })
        .catch((caught: unknown) => {
          error.textContent =
            caught instanceof Error ? caught.message : "Nie udało się odzyskać konta.";
        });
    });
  }

  private showRecoveryCode(code: string, title: string): void {
    const panel = this.createPanel(
      title,
      "Zapisz ten kod w bezpiecznym miejscu. Serwer nie pokaże go ponownie."
    );
    panel.dataset.mode = "recoveryCode" satisfies AuthMode;

    const codeNode = document.createElement("code");
    codeNode.className = "auth-panel__recovery-code";
    codeNode.textContent = code;

    const confirm = this.button("Zapisałem kod");
    confirm.addEventListener("click", () => this.showLogin());

    panel.append(codeNode, confirm);
  }

  private routeSession(session: SessionView): void {
    if (session.character.state === "active") {
      this.destroyPanel();
      this.scene.start("WorldScene", {
        playerId: session.character.characterId
      });
      return;
    }

    const panel = this.createPanel(
      "Konto gotowe",
      "Kreator postaci zostanie podłączony w następnym etapie wdrożenia."
    );
    const logout = this.button("Wyloguj");
    logout.addEventListener("click", () => {
      void apiClient.logout().finally(() => this.showLogin());
    });
    panel.append(logout);
  }

  private destroyPanel(): void {
    this.panel?.remove();
    this.panel = null;
  }
}
