import type { SessionView } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { AuthApi, AuthApiRequestError } from "../net/AuthApi";
import { gameSocket } from "../net/GameSocket";
import { sessionStateStore, type SessionStateStore } from "../state/SessionStateStore";

export type BootDestination = "AuthScene" | "CharacterCreatorScene" | "WorldScene";

export interface SessionResumeApi {
  getSession(token: string): Promise<SessionView>;
}

export async function resolveBootDestination(
  api: SessionResumeApi,
  store: SessionStateStore
): Promise<BootDestination> {
  const token = store.getToken();
  if (!token) return "AuthScene";

  try {
    const session = await api.getSession(token);
    store.updateSession(session);
    if (session.character.state === "active") return "WorldScene";
    if (session.character.state === "none") return "CharacterCreatorScene";
    return "AuthScene";
  } catch (error) {
    if (error instanceof AuthApiRequestError && error.status === 401) {
      store.reset();
      return "AuthScene";
    }
    throw error;
  }
}

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    void this.resumeSession();
  }

  private async resumeSession(): Promise<void> {
    const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
    const authApi = new AuthApi(serverUrl);

    try {
      const destination = await resolveBootDestination(authApi, sessionStateStore);
      if (destination !== "WorldScene") {
        this.scene.start(destination);
        return;
      }

      const token = sessionStateStore.getToken();
      const current = sessionStateStore.getSession();
      if (!token || current?.character.state !== "active") {
        sessionStateStore.reset();
        this.scene.start("AuthScene");
        return;
      }

      const socketAuth = await gameSocket.authenticate(token);
      if (!socketAuth.ok) {
        sessionStateStore.reset();
        this.scene.start("AuthScene");
        return;
      }

      this.scene.start("WorldScene", { playerId: socketAuth.characterId });
    } catch (error) {
      console.error("Could not resume the saved session", error);
      this.scene.start("AuthScene");
    }
  }
}
