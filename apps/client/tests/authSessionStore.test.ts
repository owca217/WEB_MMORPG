import { describe, expect, it } from "vitest";
import { AuthSessionStore, type StorageLike } from "../src/state/AuthSessionStore";

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe("AuthSessionStore", () => {
  it("stores and clears the persistent bearer token", () => {
    const store = new AuthSessionStore(new MemoryStorage());
    store.setToken("abc");
    expect(store.getToken()).toBe("abc");
    store.clear();
    expect(store.getToken()).toBeNull();
  });
});
