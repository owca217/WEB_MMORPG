import Phaser from "phaser";
import { apiClient } from "../net/ApiClient";
import { gameSocket } from "../net/GameSocket";
import { authSessionStore } from "../state/AuthSessionStore";

const persistentAccountsEnabled =
  import.meta.env.VITE_PERSISTENT_ACCOUNTS === "true";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    if (!persistentAccountsEnabled) {
      gameSocket.connect();
      this.scene.start("LoginScene");
      return;
    }

    void this.routePersistentSession();
  }

  private async routePersistentSession(): Promise<void> {
    const token = authSessionStore.getToken();
    if (!token) {
      this.scene.start("AuthScene");
      return;
    }

    try {
      const session = await apiClient.getSession();
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

      this.scene.start("AuthScene");
    } catch {
      authSessionStore.clear();
      this.scene.start("AuthScene");
    }
  }
}
