import type { AdminSession, LoginResult } from "@web-mmorpg/shared";

export class SessionStateStore {
  private snapshot: AdminSession | null = null;

  setFromLogin(result: LoginResult): void {
    if (!result.ok) {
      this.reset();
      return;
    }

    this.snapshot = {
      playerId: result.playerId,
      sessionToken: result.sessionToken,
      role: result.role
    };
  }

  getSnapshot(): AdminSession | null {
    return this.snapshot ? { ...this.snapshot } : null;
  }

  reset(): void {
    this.snapshot = null;
  }
}

export const sessionStateStore = new SessionStateStore();
