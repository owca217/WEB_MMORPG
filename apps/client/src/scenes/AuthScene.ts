import type { SessionView } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { AuthApi, AuthApiNetworkError, AuthApiRequestError } from "../net/AuthApi";
import { resolveGameServerUrl } from "../hosting";
import { gameSocket } from "../net/GameSocket";
import { sessionStateStore, type SessionStateStore } from "../state/SessionStateStore";

type AuthMode = "login" | "register" | "recover";

type AuthenticatedRoute = (token: string, session: SessionView) => void;

function errorMessage(error: unknown): string {
  if (error instanceof AuthApiNetworkError) return error.message;
  if (error instanceof AuthApiRequestError) {
    return `Serwer odpowiedział błędem (${error.status}): ${error.message}`;
  }
  return "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.";
}

function errorKind(error: unknown): string {
  if (error instanceof AuthApiNetworkError) return "network";
  if (error instanceof AuthApiRequestError) return "server";
  return "unknown";
}

export class AuthPanel {
  private mode: AuthMode = "login";
  private recoveryUsername = "";
  private isSubmitting = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly api: AuthApi,
    private readonly store: SessionStateStore,
    private readonly onAuthenticated: AuthenticatedRoute
  ) {}

  mount(): void {
    this.render();
  }

  unmount(): void {
    this.host.replaceChildren();
  }

  private render(prefillUsername = ""): void {
    this.host.innerHTML = `
      <section class="auth-panel login-panel" data-auth-panel data-mode="${this.mode}">
        <header class="auth-panel__header">
          <p class="auth-panel__eyebrow">Świat czeka</p>
          <h1>WEB MMORPG</h1>
          <p class="auth-panel__intro">Zaloguj się na swoje konto i wróć do gry.</p>
        </header>
        <nav class="auth-panel__modes" aria-label="Tryb konta">
          <button type="button" data-auth-mode="login">Logowanie</button>
          <button type="button" data-auth-mode="register">Rejestracja</button>
          <button type="button" data-auth-mode="recover">Odzyskiwanie</button>
        </nav>
        <form class="auth-form" data-auth-form>
          ${this.fields(prefillUsername)}
          <button class="auth-submit" type="submit">${this.submitLabel()}</button>
          <p class="auth-status" data-auth-status role="status" aria-live="polite"></p>
          <p class="form-error" data-auth-error role="alert" aria-live="assertive"></p>
        </form>
        <div class="auth-recovery-modal is-hidden" data-recovery-modal role="dialog" aria-modal="true">
          <div class="auth-recovery-modal__card">
            <h2>Zapisz kod odzyskiwania</h2>
            <p>Ten kod jest pokazywany tylko teraz. Przechowuj go poza grą.</p>
            <code data-recovery-code></code>
            <button type="button" data-recovery-continue>Zapisałem kod</button>
          </div>
        </div>
      </section>
    `;

    for (const button of this.host.querySelectorAll<HTMLButtonElement>("[data-auth-mode]")) {
      button.classList.toggle("is-active", button.dataset.authMode === this.mode);
      button.setAttribute("aria-pressed", String(button.dataset.authMode === this.mode));
      button.addEventListener("click", () => {
        const next = button.dataset.authMode as AuthMode | undefined;
        if (this.isSubmitting || !next || next === this.mode) return;
        this.mode = next;
        this.render(next === "login" ? prefillUsername : "");
      });
    }

    this.host
      .querySelector<HTMLFormElement>("[data-auth-form]")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void this.submit();
      });
  }

  private fields(prefillUsername: string): string {
    const escapedUsername = this.escapeAttribute(prefillUsername);
    if (this.mode === "register") {
      return `
        <label>Nazwa konta<input name="username" value="${escapedUsername}" autocomplete="username" minlength="3" maxlength="32" required /></label>
        <label>Hasło<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required /></label>
        <label>Powtórz hasło<input name="passwordConfirmation" type="password" autocomplete="new-password" minlength="10" maxlength="256" required /></label>
      `;
    }

    if (this.mode === "recover") {
      return `
        <label>Nazwa konta<input name="username" value="${escapedUsername}" autocomplete="username" minlength="3" maxlength="32" required /></label>
        <label>Kod odzyskiwania<input name="recoveryCode" autocomplete="off" required /></label>
        <label>Nowe hasło<input name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="256" required /></label>
        <label>Powtórz nowe hasło<input name="passwordConfirmation" type="password" autocomplete="new-password" minlength="10" maxlength="256" required /></label>
      `;
    }

    return `
      <label>Nazwa konta<input name="username" value="${escapedUsername}" autocomplete="username" minlength="3" maxlength="32" required /></label>
      <label>Hasło<input name="password" type="password" autocomplete="current-password" minlength="10" maxlength="256" required /></label>
    `;
  }

  private submitLabel(): string {
    if (this.mode === "register") return "Utwórz konto";
    if (this.mode === "recover") return "Odzyskaj konto";
    return "Zaloguj się";
  }

  private async submit(): Promise<void> {
    const form = this.host.querySelector<HTMLFormElement>("[data-auth-form]");
    const error = this.host.querySelector<HTMLElement>("[data-auth-error]");
    const status = this.host.querySelector<HTMLElement>("[data-auth-status]");
    const submitButton = form?.querySelector<HTMLButtonElement>("[type='submit']");
    if (!form || !error || !status || !submitButton || this.isSubmitting) return;

    const mode = this.mode;
    const data = new FormData(form);
    const username = String(data.get("username") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const passwordConfirmation = String(data.get("passwordConfirmation") ?? "");
    error.textContent = "";
    delete error.dataset.errorKind;
    status.textContent = "";
    delete status.dataset.state;

    if (!username) {
      error.textContent = "Wpisz nazwę konta.";
      error.dataset.errorKind = "validation";
      return;
    }
    if (mode === "login" && !password) {
      error.textContent = "Wpisz hasło.";
      error.dataset.errorKind = "validation";
      return;
    }
    if ((mode === "register" || mode === "recover") && password !== passwordConfirmation) {
      error.textContent = "Podane hasła różnią się od siebie.";
      error.dataset.errorKind = "validation";
      return;
    }

    this.isSubmitting = true;
    status.textContent = "Łączenie z serwerem…";
    status.dataset.state = "connecting";
    submitButton.disabled = true;
    submitButton.textContent = "Łączenie…";
    form.dataset.busy = "true";
    for (const input of form.querySelectorAll<HTMLInputElement>("input")) input.disabled = true;
    for (const button of this.host.querySelectorAll<HTMLButtonElement>("[data-auth-mode]")) {
      button.disabled = true;
    }

    try {
      if (mode === "register") {
        const result = await this.api.register(username, password, passwordConfirmation);
        this.recoveryUsername = username;
        this.showRecoveryCode(result.recoveryCode);
        return;
      }

      if (mode === "recover") {
        const recoveryCode = String(data.get("recoveryCode") ?? "").trim();
        const newPassword = String(data.get("newPassword") ?? "");
        const result = await this.api.recover(
          username,
          recoveryCode,
          newPassword,
          passwordConfirmation
        );
        this.store.reset();
        this.recoveryUsername = username;
        this.showRecoveryCode(result.recoveryCode);
        return;
      }

      const result = await this.api.login(username, password);
      this.store.setAuthenticated(result.token, result.session);
      this.onAuthenticated(result.token, result.session);
    } catch (requestError) {
      error.dataset.errorKind = errorKind(requestError);
      error.textContent = errorMessage(requestError);
    } finally {
      this.isSubmitting = false;
      status.textContent = "";
      delete status.dataset.state;
      delete form.dataset.busy;
      submitButton.disabled = false;
      submitButton.textContent = this.submitLabel();
      for (const input of form.querySelectorAll<HTMLInputElement>("input")) input.disabled = false;
      for (const button of this.host.querySelectorAll<HTMLButtonElement>("[data-auth-mode]")) {
        button.disabled = false;
      }
    }
  }

  private showRecoveryCode(code: string): void {
    const modal = this.host.querySelector<HTMLElement>("[data-recovery-modal]");
    const codeElement = this.host.querySelector<HTMLElement>("[data-recovery-code]");
    const continueButton = this.host.querySelector<HTMLButtonElement>("[data-recovery-continue]");
    if (!modal || !codeElement || !continueButton) return;

    codeElement.textContent = code;
    modal.classList.remove("is-hidden");
    continueButton.onclick = () => {
      codeElement.textContent = "";
      modal.classList.add("is-hidden");
      this.mode = "login";
      const username = this.recoveryUsername;
      this.recoveryUsername = "";
      this.render(username);
    };
  }

  private escapeAttribute(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
}

export class AuthScene extends Phaser.Scene {
  private host: HTMLDivElement | undefined;
  private panel: AuthPanel | undefined;

  constructor() {
    super("AuthScene");
  }

  create(): void {
    const host = document.createElement("div");
    host.className = "auth-scene";
    document.body.appendChild(host);
    this.host = host;

    const serverUrl = resolveGameServerUrl(
      import.meta.env.VITE_GAME_SERVER_URL,
      import.meta.env.DEV
    );
    this.panel = new AuthPanel(
      host,
      new AuthApi(serverUrl),
      sessionStateStore,
      (token, session) => void this.routeAuthenticated(token, session)
    );
    this.panel.mount();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  private async routeAuthenticated(token: string, session: SessionView): Promise<void> {
    if (session.character.state === "none") {
      this.cleanup();
      this.scene.start("CharacterCreatorScene");
      return;
    }

    if (session.character.state !== "active") {
      sessionStateStore.reset();
      this.cleanup();
      this.scene.start("AuthScene");
      return;
    }

    try {
      const socketResult = await gameSocket.authenticate(token);
      if (!socketResult.ok) throw new Error(socketResult.message);
      this.cleanup();
      this.scene.start("WorldScene", { playerId: socketResult.characterId });
    } catch (error) {
      const errorElement = this.host?.querySelector<HTMLElement>("[data-auth-error]");
      if (errorElement) {
        errorElement.dataset.errorKind = errorKind(error);
        errorElement.textContent = errorMessage(error);
      }
    }
  }

  private cleanup(): void {
    this.panel?.unmount();
    this.panel = undefined;
    this.host?.remove();
    this.host = undefined;
  }
}
