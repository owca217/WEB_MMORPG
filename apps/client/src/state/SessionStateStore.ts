import type { AccountRole, SessionView } from "@web-mmorpg/shared";

export const SESSION_TOKEN_STORAGE_KEY = "web-mmorpg.session-token";

interface SessionSnapshotCompat {
  sessionToken: string;
  role: AccountRole;
}

function defaultStorage(): Storage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function cloneSession(session: SessionView): SessionView {
  return {
    ...session,
    character: { ...session.character }
  };
}

export class SessionStateStore {
  private token: string | null;
  private session: SessionView | null = null;

  constructor(private readonly storage: Storage | null = defaultStorage()) {
    this.token = storage?.getItem(SESSION_TOKEN_STORAGE_KEY) ?? null;
  }

  setAuthenticated(token: string, session: SessionView): void {
    this.token = token;
    this.session = cloneSession(session);
    this.storage?.setItem(SESSION_TOKEN_STORAGE_KEY, token);
  }

  getToken(): string | null {
    return this.token;
  }

  getSession(): SessionView | null {
    return this.session ? cloneSession(this.session) : null;
  }

  updateSession(session: SessionView): void {
    this.session = cloneSession(session);
  }

  /**
   * Transitional adapter for the current WorldScene. Task 11 switches the
   * world/admin UI directly to getToken()/getSession() and removes this view.
   */
  getSnapshot(): SessionSnapshotCompat | null {
    if (!this.token || !this.session) return null;
    return {
      sessionToken: this.token,
      role: this.session.accountRole
    };
  }

  reset(): void {
    this.token = null;
    this.session = null;
    this.storage?.removeItem(SESSION_TOKEN_STORAGE_KEY);
  }
}

export const sessionStateStore = new SessionStateStore();
