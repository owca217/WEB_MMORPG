/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";
import type { SessionView } from "@web-mmorpg/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { SHUTDOWN: "shutdown" } }
  }
}));

import { AuthApiRequestError, type AuthApi } from "../src/net/AuthApi";
import { CharacterCreatorPanel, CharacterCreatorScene } from "../src/scenes/CharacterCreatorScene";
import { sessionStateStore, SessionStateStore } from "../src/state/SessionStateStore";

const gameStyles = readFileSync(new NodeURL("../src/style.css", import.meta.url), "utf8");

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

function choose(host: HTMLElement, name: string, value: string): void {
  if (!host.isConnected) document.body.appendChild(host);
  const radio = host.querySelector<HTMLInputElement>(`input[name='${name}'][value='${value}']`);
  expect(radio, `Missing ${name} option ${value}`).not.toBeNull();
  radio!.click();
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  sessionStateStore.reset();
});

describe("CharacterCreatorPanel", () => {
  it("keeps character creation above the full-height game in the visible viewport", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = gameStyles;
    document.head.appendChild(stylesheet);
    const game = document.createElement("div");
    game.id = "game";
    document.body.appendChild(game);
    const scene = new CharacterCreatorScene();
    const cleanups: Array<() => void> = [];
    Object.assign(scene, { events: { once: (_event: string, cleanup: () => void) => cleanups.push(cleanup) } });

    try {
      scene.create();
      const host = document.querySelector<HTMLElement>(".character-creator-scene");
      expect(host?.querySelector("[data-character-form]")).not.toBeNull();
      expect(game.nextElementSibling).toBe(host);
      expect(getComputedStyle(document.body).overflow).toBe("hidden");
      expect(getComputedStyle(game).height).toBe("100%");

      const hostStyle = getComputedStyle(host!);
      expect(hostStyle.position).toBe("fixed");
      expect(hostStyle.inset).toBe("0");
      expect(hostStyle.display).toBe("grid");
      expect(Number(hostStyle.zIndex)).toBeGreaterThan(0);
    } finally {
      cleanups.forEach((cleanup) => cleanup());
      stylesheet.remove();
    }
  });

  it("submits a new character to the current origin in an unconfigured production build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_GAME_SERVER_URL", undefined);
    sessionStateStore.setAuthenticated("creator-token", {
      accountUsername: "Owczy", accountRole: "PLAYER", character: { state: "none" }
    });
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requests.push(url);
      return new Response(JSON.stringify({ code: "NAME_TAKEN", message: "Nick jest zajęty." }), {
        status: 409
      });
    });
    const scene = new CharacterCreatorScene();
    const cleanups: Array<() => void> = [];
    Object.assign(scene, { events: { once: (_event: string, cleanup: () => void) => cleanups.push(cleanup) } });

    scene.create();
    input(document.body, "nickname", "HeroForTest");
    submit(document.body);

    await vi.waitFor(() => expect(document.querySelector("[data-character-error]")?.textContent).toBe("Nick jest zajęty."));
    expect(requests).toEqual(["/api/character"]);
    cleanups.forEach((cleanup) => cleanup());
  });

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
      appearance: { gender: "female", skinId: "female-guard" }
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
    choose(host, "gender", "female");
    choose(host, "skinId", "female-guard");
    submit(host);
    await flush();

    expect(createCharacter).toHaveBeenCalledWith("character-token", {
      nickname: "OwczyHero",
      appearance: { gender: "female", skinId: "female-guard" }
    });
    expect(getSession).toHaveBeenCalledWith("character-token");
    expect(store.getSession()).toEqual(refreshed);
    expect(enterWorld).toHaveBeenCalledWith("character-token", refreshed);
    expect(createCharacter.mock.invocationCallOrder[0]!).toBeLessThan(getSession.mock.invocationCallOrder[0]!);
    expect(getSession.mock.invocationCallOrder[0]!).toBeLessThan(enterWorld.mock.invocationCallOrder[0]!);
  });

  it("offers three skins for each gender and keeps the variant and nickname when gender changes", () => {
    const host = document.createElement("div");
    new CharacterCreatorPanel(host, api(), new SessionStateStore(localStorage), vi.fn()).mount();

    const skinOptions = () => Array.from(host.querySelectorAll<HTMLInputElement>("input[name='skinId']"));
    expect(skinOptions().map(({ value }) => value)).toEqual(["male-traveler", "male-scout", "male-guard"]);
    expect(skinOptions().find(({ checked }) => checked)?.value).toBe("male-traveler");
    input(host, "nickname", "OwczyHero");
    choose(host, "skinId", "male-scout");
    choose(host, "gender", "female");

    expect(skinOptions().map(({ value }) => value)).toEqual(["female-traveler", "female-scout", "female-guard"]);
    expect(skinOptions().find(({ checked }) => checked)?.value).toBe("female-scout");
    expect(host.querySelector<HTMLInputElement>("[name='nickname']")?.value).toBe("OwczyHero");
    const preview = host.querySelector<HTMLElement>("[data-skin-preview]");
    expect(preview?.dataset.skinId).toBe("female-scout");
    expect(preview?.getAttribute("aria-label")).toContain("Zwiadowczyni");
    expect(preview?.style.getPropertyValue("--skin-image")).toContain("female-scout.png");

    const back = host.querySelector<HTMLButtonElement>("button[data-direction='north']");
    expect(back).not.toBeNull();
    back!.click();
    expect(back!.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("button[data-direction='south']")?.getAttribute("aria-pressed")).toBe("false");
    expect(preview?.dataset.direction).toBe("north");
    choose(host, "gender", "male");
    expect(skinOptions().find(({ checked }) => checked)?.value).toBe("male-scout");
    expect(preview?.dataset.skinId).toBe("male-scout");
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
    choose(host, "gender", "female");
    choose(host, "skinId", "female-scout");
    submit(host);
    await flush();

    expect(host.querySelector<HTMLInputElement>("[name='nickname']")?.value).toBe("OwczyHero");
    expect(host.querySelector<HTMLInputElement>("[name='gender']:checked")?.value).toBe("female");
    expect(host.querySelector<HTMLInputElement>("[name='skinId']:checked")?.value).toBe("female-scout");
    expect(host.querySelector<HTMLElement>("[data-skin-preview]")?.dataset.skinId).toBe("female-scout");
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
