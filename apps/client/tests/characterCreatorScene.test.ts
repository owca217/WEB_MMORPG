/* @vitest-environment jsdom */

import type { SessionView } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Scene: class {}
  }
}));

import { AuthApiRequestError, type AuthApi } from "../src/net/AuthApi";
import { CharacterCreatorPanel } from "../src/scenes/CharacterCreatorScene";
import { SessionStateStore } from "../src/state/SessionStateStore";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function input(host: HTMLElement, name: string, value: string): void {
  const element = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[name='${name}']`);
  if (!element) throw new Error(`Missing input ${name}`);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function submit(host: HTMLElement): void {
  const form = host.querySelector<HTMLFormElement>("[data-character-form]");
  if (!form) throw new Error("Missing character form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

function api(overrides: Partial<Record<keyof AuthApi, unknown>> = {}): AuthApi {
  return {
    login: vi.fn(),
    register: vi.fn(),
    recover: vi.fn(),
    getSession: vi.fn(),
    logout: vi.fn(),
    getCharacter: vi.fn(),
    createCharacter: vi.fn(),
    ...overrides
  } as unknown as AuthApi;
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("CharacterCreatorPanel", () => {
  it("creates a character under Bearer auth, refreshes SessionView and only then enters the world", async () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("character-token", {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "none" }
    });
    const created = {
      id: "character-1",
      nickname: "OwczyHero",
      appearance: { bodyType: "balanced", hairStyle: "short", hairColor: "brown" }
    };
    const refreshed: SessionView = {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "active", characterId: "character-1", nickname: "OwczyHero" }
    };
    const createCharacter = vi.fn().mockResolvedValue(created);
    const getSession = vi.fn().mockResolvedValue(refreshed);
    const enterWorld = vi.fn();
    const host = document.createElement("div");

    new CharacterCreatorPanel(
      host,
      api({ createCharacter, getSession }),
      store,
      enterWorld
    ).mount();

    input(host, "nickname", "OwczyHero");
    input(host, "bodyType", "balanced");
    input(host, "hairStyle", "short");
    input(host, "hairColor", "brown");
    submit(host);
    await flush();

    expect(createCharacter).toHaveBeenCalledWith("character-token", {
      nickname: "OwczyHero",
      appearance: { bodyType: "balanced", hairStyle: "short", hairColor: "brown" }
    });
    expect(getSession).toHaveBeenCalledWith("character-token");
    expect(store.getSession()).toEqual(refreshed);
    expect(enterWorld).toHaveBeenCalledWith("character-token", refreshed);
    expect(createCharacter.mock.invocationCallOrder[0]!).toBeLessThan(getSession.mock.invocationCallOrder[0]!);
    expect(getSession.mock.invocationCallOrder[0]!).toBeLessThan(enterWorld.mock.invocationCallOrder[0]!);
  });

  it("preserves the form and does not enter the world when creation fails", async () => {
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("character-token", {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "none" }
    });
    const createCharacter = vi.fn().mockRejectedValue(
      new AuthApiRequestError(409, { code: "NICKNAME_TAKEN", message: "Ten nick jest już zajęty." })
    );
    const enterWorld = vi.fn();
    const host = document.createElement("div");
    new CharacterCreatorPanel(host, api({ createCharacter }), store, enterWorld).mount();

    input(host, "nickname", "OwczyHero");
    input(host, "hairColor", "black");
    submit(host);
    await flush();

    expect(host.querySelector<HTMLInputElement>("[name='nickname']")?.value).toBe("OwczyHero");
    expect(host.querySelector<HTMLSelectElement>("[name='hairColor']")?.value).toBe("black");
    expect(host.querySelector("[data-character-error]")?.textContent).toBe("Ten nick jest już zajęty.");
    expect(enterWorld).not.toHaveBeenCalled();
  });

  it("blocks invalid nickname locally", async () => {
    const createCharacter = vi.fn();
    const store = new SessionStateStore(localStorage);
    store.setAuthenticated("character-token", {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "none" }
    });
    const host = document.createElement("div");
    new CharacterCreatorPanel(host, api({ createCharacter }), store, vi.fn()).mount();

    input(host, "nickname", "x");
    submit(host);
    await flush();

    expect(createCharacter).not.toHaveBeenCalled();
    expect(host.querySelector("[data-character-error]")?.textContent).toContain("3");
  });
});
