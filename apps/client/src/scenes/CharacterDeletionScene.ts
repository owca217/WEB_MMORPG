import type {
  CharacterLifecycleSummary
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { apiClient } from "../net/ApiClient";
import { getDeletionCountdown } from "../state/characterDeletionCountdown";

type PendingDeletion = Extract<
  CharacterLifecycleSummary,
  { state: "pendingDeletion" }
>;

interface CharacterDeletionSceneData {
  character: PendingDeletion;
}

export class CharacterDeletionScene extends Phaser.Scene {
  private character: PendingDeletion | null = null;
  private panel: HTMLDivElement | null = null;
  private countdown: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;

  constructor() {
    super("CharacterDeletionScene");
  }

  init(data: CharacterDeletionSceneData): void {
    this.character = data.character;
  }

  create(): void {
    if (!this.character) {
      this.scene.start("BootScene");
      return;
    }

    const panel = document.createElement("div");
    panel.className = "auth-panel character-deletion-panel";

    const title = document.createElement("h1");
    title.textContent = "Postać oczekuje na usunięcie";

    const name = document.createElement("strong");
    name.textContent = this.character.nickname;

    const explanation = document.createElement("p");
    explanation.className = "auth-panel__subtitle";
    explanation.textContent =
      "Usunięcie możesz anulować do końca poniższego odliczania.";

    const date = document.createElement("p");
    date.textContent = `Planowane usunięcie: ${new Date(
      this.character.deletionEffectiveAt
    ).toLocaleString("pl-PL")}`;

    const countdown = document.createElement("strong");
    countdown.className = "character-deletion-panel__countdown";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Anuluj usunięcie";

    const logout = document.createElement("button");
    logout.type = "button";
    logout.textContent = "Wyloguj";

    const error = document.createElement("p");
    error.className = "form-error";

    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      error.textContent = "Anulowanie...";
      void apiClient
        .cancelCharacterDeletion()
        .then((lifecycle) => {
          if (lifecycle.state === "active") {
            this.scene.start("WorldScene", {
              playerId: lifecycle.characterId
            });
            return;
          }

          if (lifecycle.state === "none") {
            this.scene.start("CharacterCreatorScene");
            return;
          }

          this.character = lifecycle;
          cancel.disabled = false;
          error.textContent = "";
          this.updateCountdown();
        })
        .catch((caught: unknown) => {
          cancel.disabled = false;
          error.textContent =
            caught instanceof Error
              ? caught.message
              : "Nie udało się anulować usunięcia.";
        });
    });

    logout.addEventListener("click", () => {
      void apiClient.logout().finally(() => {
        this.scene.start("AuthScene");
      });
    });

    panel.append(
      title,
      name,
      explanation,
      date,
      countdown,
      cancel,
      logout,
      error
    );
    document.body.appendChild(panel);

    this.panel = panel;
    this.countdown = countdown;
    this.updateCountdown();
    this.timer = setInterval(() => this.updateCountdown(), 1000);

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => this.cleanup()
    );
  }

  private updateCountdown(): void {
    if (!this.character || !this.countdown) return;

    const remaining = getDeletionCountdown(
      this.character.deletionEffectiveAt
    );
    this.countdown.textContent = remaining.expired
      ? "Termin usunięcia minął — finalizowanie…"
      : remaining.label;

    if (remaining.expired && !this.refreshing) {
      this.refreshing = true;
      void apiClient
        .getSession()
        .then((session) => {
          if (session.character.state === "none") {
            this.scene.start("CharacterCreatorScene");
            return;
          }
          if (session.character.state === "active") {
            this.scene.start("WorldScene", {
              playerId: session.character.characterId
            });
            return;
          }

          this.character = session.character;
          this.refreshing = false;
        })
        .catch(() => {
          this.refreshing = false;
        });
    }
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.panel?.remove();
    this.panel = null;
    this.countdown = null;
    this.refreshing = false;
  }
}
