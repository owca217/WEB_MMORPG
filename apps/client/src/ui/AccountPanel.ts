import type { AuthApi, GoogleAccountStatus } from "../net/AuthApi";
import { googleSignIn, isGoogleCancelled, type GoogleSignInAdapter } from "../net/GoogleSignIn";
import type { SessionStateStore } from "../state/SessionStateStore";
import { isForegroundGameWindow } from "./gameWindows";
import "./AccountPanel.css";

export class AccountPanel {
  private readonly root = document.createElement("section");
  private readonly status: HTMLElement;
  private readonly error: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly form: HTMLFormElement;
  private readonly password: HTMLInputElement;
  private readonly choice: HTMLElement;
  private readonly buttonHost: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private destroyed = false;
  private version = 0;
  private pending = false;
  private data: GoogleAccountStatus | undefined;
  private controller: AbortController | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private readonly onBack = (event: Event): void => {
    if (event.defaultPrevented || !event.cancelable || this.root.hidden || !isForegroundGameWindow(this.root)) return;
    event.preventDefault(); this.hide();
  };

  constructor(
    private readonly api: AuthApi,
    private readonly store: SessionStateStore,
    private readonly google: GoogleSignInAdapter = googleSignIn
  ) {
    this.root.className = "game-panel account-panel";
    this.root.dataset.accountPanel = ""; this.root.hidden = true;
    this.root.setAttribute("role", "dialog"); this.root.setAttribute("aria-modal", "false");
    this.root.setAttribute("aria-label", "Konto");
    this.root.innerHTML = `
      <header class="game-panel__header"><h2>Konto</h2><button type="button" data-close aria-label="Zamknij konto">×</button></header>
      <p data-google-account-status role="status" aria-live="polite"></p>
      <p class="account-panel__hint">Połączenie z Google zachowuje konto gry, postać i postęp. Dane profilu Google nie są wyświetlane w grze.</p>
      <button type="button" data-google-link-start hidden>Połącz z Google</button>
      <form class="account-panel__form" data-google-link-form hidden>
        <label>Obecne hasło gry<input name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required></label>
        <button type="submit">Potwierdź hasło i wybierz Google</button>
        <button type="button" data-google-confirm-back>Wstecz</button>
      </form>
      <section class="google-sign-in" data-google-link-choice hidden aria-label="Wybierz konto Google">
        <p>Wybierz konto Google, które chcesz połączyć z tym kontem gry.</p>
        <div class="google-sign-in__button" data-google-link-button></div>
        <button type="button" data-google-link-back>Wstecz</button>
      </section>
      <p data-account-feedback role="status" aria-live="polite"></p>
      <p class="form-error" data-account-error role="alert"></p>`;
    this.status = this.require("[data-google-account-status]");
    this.error = this.require("[data-account-error]"); this.feedback = this.require("[data-account-feedback]");
    this.startButton = this.require("[data-google-link-start]"); this.form = this.require("[data-google-link-form]");
    this.password = this.require("[name='currentPassword']"); this.choice = this.require("[data-google-link-choice]");
    this.buttonHost = this.require("[data-google-link-button]");
    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
    this.startButton.addEventListener("click", () => {
      if (!this.data?.googleEnabled || !this.data.canLink || this.pending) return;
      this.error.textContent = ""; this.feedback.textContent = "";
      this.startButton.hidden = true; this.form.hidden = false; this.password.focus();
    });
    for (const button of this.root.querySelectorAll("[data-google-confirm-back],[data-google-link-back]")) {
      button.addEventListener("click", () => { this.version++; this.resetChoice(); this.renderStatus(); });
    }
    this.form.addEventListener("submit", event => { event.preventDefault(); void this.prepareLink(); });
    this.root.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); this.hide();
    });
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"]) {
      this.root.addEventListener(type, event => event.stopPropagation());
    }
    document.addEventListener("game-ui-back", this.onBack); document.body.append(this.root);
  }

  async show(): Promise<void> {
    if (this.destroyed) return;
    const token = this.store.getToken();
    if (!token) { this.hide(); return; }
    if (this.root.hidden) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const version = ++this.version;
    this.resetChoice(); this.data = undefined; this.renderStatus(); this.root.hidden = false;
    this.status.textContent = "Wczytywanie stanu konta…";
    this.require<HTMLButtonElement>("[data-close]").focus({ preventScroll: true });
    try {
      const result = await this.api.getGoogleAccount(token);
      if (!this.current(version, token)) return;
      this.data = result; this.renderStatus();
    } catch (error) {
      if (!this.current(version, token)) return;
      this.status.textContent = "Nie udało się pobrać stanu połączenia Google.";
      this.error.textContent = this.message(error);
    }
  }

  hide(): void {
    if (this.destroyed) return;
    this.version++; this.resetChoice(); this.root.hidden = true;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide(); this.destroyed = true;
    document.removeEventListener("game-ui-back", this.onBack); this.root.remove();
  }

  private current(version: number, token: string): boolean {
    if (this.destroyed || this.root.hidden || version !== this.version) return false;
    if (this.store.getToken() !== token) { this.hide(); return false; }
    return true;
  }

  private resetChoice(): void {
    this.controller?.abort(); this.controller = undefined;
    if (this.expiry) clearTimeout(this.expiry); this.expiry = undefined;
    this.pending = false; this.password.value = "";
    this.form.hidden = true; this.choice.hidden = true; this.buttonHost.replaceChildren();
    this.feedback.textContent = ""; this.error.textContent = "";
  }

  private renderStatus(): void {
    this.startButton.hidden = !this.data?.googleEnabled || !this.data.canLink || this.data.linked;
    this.status.dataset.linked = String(this.data?.linked ?? false);
    this.status.textContent = this.data?.linked ? "Konto jest połączone z Google."
      : !this.data?.googleEnabled ? "Logowanie Google jest teraz niedostępne."
      : !this.data.canLink ? "To konto korzysta z logowania Google."
      : "Konto nie jest połączone z Google.";
  }

  private async prepareLink(): Promise<void> {
    const token = this.store.getToken();
    if (!token || this.destroyed || this.root.hidden || this.form.hidden || this.pending || !this.data?.canLink || !this.data.googleEnabled) return;
    if (!this.password.value) { this.error.textContent = "Wpisz obecne hasło gry."; return; }
    let password = this.password.value;
    this.password.value = "";
    const version = ++this.version;
    const controller = new AbortController(); this.controller = controller;
    controller.signal.addEventListener("abort", () => { password = ""; }, { once: true });
    this.pending = true; this.form.hidden = true; this.error.textContent = "";
    this.feedback.textContent = "Przygotowywanie wyboru konta Google…";
    try {
      const challenge = await this.api.createGoogleChallenge("link", token);
      if (!this.current(version, token) || controller.signal.aborted) return;
      this.choice.hidden = false;
      await this.google.mount(this.buttonHost, challenge, {
        signal: controller.signal,
        onCredential: idToken => {
          if (controller.signal.aborted || !this.current(version, token) || this.pending) return;
          this.pending = true; this.buttonHost.inert = true;
          this.feedback.textContent = "Łączenie konta…";
          void this.api.linkGoogleAccount(token, { challengeId: challenge.challengeId, idToken, password }).then(result => {
            if (!this.current(version, token)) return;
            this.version++; this.resetChoice(); this.data = result; this.renderStatus();
            this.feedback.textContent = "Połączono z Google. Możesz logować się obiema metodami.";
          }).catch(error => {
            if (!this.current(version, token)) return;
            this.version++; this.resetChoice(); this.renderStatus(); this.error.textContent = this.message(error);
          });
        },
        onError: error => {
          if (controller.signal.aborted || !this.current(version, token) || isGoogleCancelled(error)) return;
          this.version++; this.resetChoice(); this.renderStatus(); this.error.textContent = this.message(error);
        }
      });
      if (!this.current(version, token) || controller.signal.aborted) return;
      this.pending = false; this.buttonHost.inert = false;
      this.feedback.textContent = "";
      this.expiry = setTimeout(() => {
        if (!this.current(version, token) || this.pending) return;
        this.version++; this.resetChoice(); this.renderStatus();
        this.feedback.textContent = "Wybór konta wygasł. Potwierdź hasło ponownie.";
      }, 4 * 60_000);
    } catch (error) {
      if (!this.current(version, token)) return;
      this.version++; this.resetChoice(); this.renderStatus(); this.error.textContent = this.message(error);
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : "Nie udało się połączyć konta z Google. Spróbuj ponownie.";
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.root.querySelector<T>(selector)!;
  }
}
