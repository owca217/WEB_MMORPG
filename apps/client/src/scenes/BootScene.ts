import Phaser from "phaser";
import { CHARACTER_ATLAS_URL } from "../appearance/characterSprites";
import { WALK_SHEETS } from "../appearance/walkSprites";
import { apiClient } from "../net/ApiClient";
import { gameSocket } from "../net/GameSocket";
import { authSessionStore } from "../state/AuthSessionStore";
import { sceneForCharacterLifecycle } from "../state/sessionRouting";

const persistentAccountsEnabled =
  import.meta.env.VITE_PERSISTENT_ACCOUNTS === "true";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    for (const sheet of WALK_SHEETS) {
      if (!this.textures.exists(sheet.key)) this.load.image(sheet.key, sheet.url);
    }
    if (!this.textures.exists("character-base-atlas")) {
      this.load.image("character-base-atlas", CHARACTER_ATLAS_URL);
    }
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
      const destination = sceneForCharacterLifecycle(
        session.character
      );

      if (destination === "WorldScene") {
        if (session.character.state !== "active") return;
        this.scene.start(destination, {
          playerId: session.character.characterId
        });
        return;
      }

      if (destination === "CharacterDeletionScene") {
        if (session.character.state !== "pendingDeletion") return;
        this.scene.start(destination, {
          character: session.character
        });
        return;
      }

      this.scene.start(destination);
    } catch {
      authSessionStore.clear();
      this.scene.start("AuthScene");
    }
  }
}
