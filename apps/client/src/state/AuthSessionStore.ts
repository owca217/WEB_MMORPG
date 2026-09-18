export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const TOKEN_KEY = "web-mmorpg.session-token";

const fallbackStorage: StorageLike = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined
};

export class AuthSessionStore {
  constructor(private readonly storage: StorageLike = fallbackStorage) {}

  getToken(): string | null {
    return this.storage.getItem(TOKEN_KEY);
  }

  setToken(token: string): void {
    this.storage.setItem(TOKEN_KEY, token);
  }

  clear(): void {
    this.storage.removeItem(TOKEN_KEY);
  }
}

const browserStorage: StorageLike =
  typeof window !== "undefined" ? window.localStorage : fallbackStorage;

export const authSessionStore = new AuthSessionStore(browserStorage);
