/* @vitest-environment jsdom */

import type { SessionView } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { SHUTDOWN: "shutdown" } }
  }
}));

import { AuthApi, AuthApiRequestError } from "../src/net/AuthApi";
import { AuthPanel, AuthScene } from "../src/scenes/AuthScene";
import { SessionStateStore, sessionStateStore } from "../src/state/SessionStateStore";
import { gameSocket } from "../src/net/GameSocket";
import { SESSION_TOKEN_STORAGE_KEY } from "../src/state/SessionStateStore";
import type { GoogleSignInAdapter, GoogleSignInCallbacks } from "../src/net/GoogleSignIn";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function input(host: HTMLElement, name: string, value: string): void {
  const element = host.querySelector<HTMLInputElement>(`[name='${name}']`);
  if (!element) throw new Error(`Missing input ${name}`);
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(host: HTMLElement, selector: string): void {
  const element = host.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.click();
}

function submit(host: HTMLElement): void {
  const form = host.querySelector<HTMLFormElement>("[data-auth-form]");
  if (!form) throw new Error("Missing auth form");
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
    getAuthProviders: vi.fn().mockResolvedValue({ google: { enabled: false, clientId: null } }),
    ...overrides
  } as unknown as AuthApi;
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

it.each(["rejection", "not-ok response"])("restores a usable Google choice after HTTP success and socket %s, then signs in on retry", async failure => {
  let credentialCallback!: (response: { credential: string; state: string }) => void;
  vi.stubGlobal("google", { accounts: { id: {
    initialize: (config: { callback: typeof credentialCallback }) => { credentialCallback = config.callback; },
    renderButton: (host: HTMLElement, config: { state: string }) => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.testGoogleChoice = "";
      const callback = credentialCallback;
      button.addEventListener("click", () => callback({ credential: `id-token-${config.state}`, state: config.state }));
      host.append(button);
    }
  } } });
  vi.spyOn(AuthApi.prototype, "getAuthProviders").mockResolvedValue({ google: { enabled: true, clientId: "server-client" } });
  const challenge = vi.spyOn(AuthApi.prototype, "createGoogleChallenge")
    .mockResolvedValueOnce({ challengeId: "first-challenge", nonce: "first-nonce", clientId: "server-client" })
    .mockResolvedValueOnce({ challengeId: "retry-challenge", nonce: "retry-nonce", clientId: "server-client" });
  const session: SessionView = { accountUsername: "google_account", accountRole: "PLAYER", character: { state: "active", characterId: "hero", nickname: "Owczy" } };
  const login = vi.spyOn(AuthApi.prototype, "loginWithGoogle")
    .mockResolvedValueOnce({ token: "failed-socket-session", session })
    .mockResolvedValueOnce({ token: "retry-session", session });
  const authenticate = vi.spyOn(gameSocket, "authenticate");
  if (failure === "rejection") authenticate.mockRejectedValueOnce(new Error("Socket unavailable"));
  else authenticate.mockResolvedValueOnce({ ok: false, code: "AUTHENTICATION_FAILED", message: "Socket unavailable" });
  authenticate.mockResolvedValueOnce({ ok: true, characterId: "hero", locationId: "forest-settlement-01" });
  const disconnect = vi.spyOn(gameSocket, "disconnect").mockImplementation(() => {});
  const scene = new AuthScene(), start = vi.fn(); let shutdown!: () => void;
  Object.assign(scene, { events: { once: (_name: string, callback: () => void) => { shutdown = callback; } }, scene: { start } });
  sessionStateStore.reset(); scene.create();
  try {
    const host = document.querySelector<HTMLElement>(".auth-scene")!;
    await vi.waitFor(() => expect(host.querySelector("[data-test-google-choice]")).not.toBeNull());
    click(host, "[data-test-google-choice]");
    await vi.waitFor(() => expect(host.querySelector("[data-auth-error]")?.textContent).not.toBe(""));
    expect(sessionStateStore.getToken()).toBeNull();
    expect(sessionStateStore.getSession()).toBeNull();
    expect(localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)).toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(host.querySelector("[data-test-google-choice]")).not.toBeNull());
    expect(challenge).toHaveBeenCalledTimes(2);
    click(host, "[data-test-google-choice]");
    await vi.waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", { playerId: "hero" }));
    expect(login).toHaveBeenNthCalledWith(1, "first-challenge", "id-token-first-nonce");
    expect(login).toHaveBeenNthCalledWith(2, "retry-challenge", "id-token-retry-nonce");
    expect(sessionStateStore.getToken()).toBe("retry-session");
  } finally { shutdown(); sessionStateStore.reset(); vi.unstubAllGlobals(); }
});

it.each([
  ["shutdown", true], ["session replacement", true], ["mode switch", true],
  ["shutdown", false], ["session replacement", false], ["mode switch", false]
] as const)("does not enter the world or revive login when socket authentication completes after %s (ok=%s)", async (change, ok) => {
  vi.spyOn(AuthApi.prototype, "getAuthProviders").mockResolvedValue({ google: { enabled: false, clientId: null } });
  const session: SessionView = { accountUsername: "Owczy", accountRole: "PLAYER", character: { state: "active", characterId: "hero", nickname: "Owczy" } };
  vi.spyOn(AuthApi.prototype, "login").mockResolvedValue({ token: "first-token", session });
  let resolveSocket!: (response: Awaited<ReturnType<typeof gameSocket.authenticate>>) => void;
  const authenticate = vi.spyOn(gameSocket, "authenticate").mockImplementation(() => new Promise(resolve => { resolveSocket = resolve; }));
  const scene = new AuthScene(), start = vi.fn();
  let shutdown!: () => void;
  Object.assign(scene, { events: { once: (_name: string, callback: () => void) => { shutdown = callback; } }, scene: { start } });
  sessionStateStore.reset(); scene.create();
  const host = document.querySelector<HTMLElement>(".auth-scene")!;
  input(host, "username", "Owczy"); input(host, "password", "current-password"); submit(host);
  await vi.waitFor(() => expect(authenticate).toHaveBeenCalledWith("first-token"));
  if (change === "shutdown") { shutdown(); sessionStateStore.reset(); }
  else if (change === "mode switch") click(host, "[data-auth-mode='register']");
  else sessionStateStore.setAuthenticated("other-session", session);
  const currentToken = sessionStateStore.getToken();
  resolveSocket(ok ? { ok: true, characterId: "hero", locationId: "forest-settlement-01" } : { ok: false, code: "AUTHENTICATION_FAILED", message: "Late failure" });
  await flush();
  expect(start).not.toHaveBeenCalled();
  expect(sessionStateStore.getToken()).toBe(currentToken);
  if (change === "mode switch") expect(host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("register");
  shutdown(); sessionStateStore.reset();
});

describe("AuthPanel", () => {
  function googleSetup(overrides: Partial<Record<keyof AuthApi, unknown>> = {}) {
    let callbacks!: GoogleSignInCallbacks;
    const mount = vi.fn<GoogleSignInAdapter["mount"]>(async (_host, _challenge, options) => { callbacks = options; });
    const challenge = { challengeId: "login-challenge", nonce: "login-nonce", clientId: "server-client" };
    const authApi = api({
      getAuthProviders: vi.fn().mockResolvedValue({ google: { enabled: true, clientId: "server-client" } }),
      createGoogleChallenge: vi.fn().mockResolvedValue(challenge),
      ...overrides
    });
    const store = new SessionStateStore(localStorage), host = document.createElement("div"), route = vi.fn();
    const panel = new AuthPanel(host, authApi, store, route, { mount });
    panel.mount();
    return { authApi, panel, host, store, route, mount, challenge, callbacks: () => callbacks };
  }

  it("prefetches a server challenge before offering Google and stores only the resulting game session", async () => {
    const session: SessionView = { accountUsername: "google_generated", accountRole: "PLAYER", character: { state: "none" } };
    const loginWithGoogle = vi.fn().mockResolvedValue({ token: "google-game-token", session });
    const setup = googleSetup({ loginWithGoogle });
    await vi.waitFor(() => expect(setup.mount).toHaveBeenCalledTimes(1));
    expect(setup.authApi.createGoogleChallenge).toHaveBeenCalledWith("login");
    expect(setup.mount.mock.calls[0]?.[1]).toEqual(setup.challenge);
    expect(setup.host.querySelector<HTMLElement>("[data-google-login]")?.hidden).toBe(false);
    setup.callbacks().onCredential("opaque-google-id-token");
    await vi.waitFor(() => expect(setup.store.getToken()).toBe("google-game-token"));
    expect(loginWithGoogle).toHaveBeenCalledExactlyOnceWith("login-challenge", "opaque-google-id-token");
    expect(setup.route).toHaveBeenCalledWith("google-game-token", session);
    expect(JSON.stringify(localStorage)).not.toContain("opaque-google-id-token");
    setup.panel.unmount();
  });

  it("keeps local fields and mode navigation usable after Google cancellation or provider failure", async () => {
    const setup = googleSetup();
    await vi.waitFor(() => expect(setup.mount).toHaveBeenCalledTimes(1));
    input(setup.host, "username", "Owczy"); input(setup.host, "password", "local-password");
    setup.callbacks().onError({ code: "GOOGLE_CANCELLED" });
    expect(setup.host.querySelector("[data-auth-error]")?.textContent).toBe("");
    setup.callbacks().onError(new Error("Google unavailable"));
    expect(setup.host.querySelector<HTMLInputElement>("[name='password']")?.value).toBe("local-password");
    expect(setup.store.getToken()).toBeNull();
    click(setup.host, "[data-auth-mode='register']");
    expect(setup.host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("register");
    expect(setup.callbacks().signal.aborted).toBe(true);
    setup.panel.unmount();
  });

  it("ignores an earlier Google callback after switching mode", async () => {
    const loginWithGoogle = vi.fn();
    const setup = googleSetup({ loginWithGoogle });
    await vi.waitFor(() => expect(setup.mount).toHaveBeenCalledTimes(1));
    const callbacks = setup.callbacks();
    click(setup.host, "[data-auth-mode='recover']");
    callbacks.onCredential("late-token");
    await flush();
    expect(loginWithGoogle).not.toHaveBeenCalled();
    expect(setup.route).not.toHaveBeenCalled();
    expect(setup.store.getToken()).toBeNull();
    setup.panel.unmount();
  });

  it.each(["unmount", "session replacement"])("discards a pending Google login after %s", async (change) => {
    let resolveLogin!: (result: unknown) => void;
    const loginWithGoogle = vi.fn(() => new Promise(resolve => { resolveLogin = resolve; }));
    const setup = googleSetup({ loginWithGoogle });
    await vi.waitFor(() => expect(setup.mount).toHaveBeenCalledTimes(1));
    setup.callbacks().onCredential("google-token");
    const session: SessionView = { accountUsername: "NewAccount", accountRole: "PLAYER", character: { state: "none" } };
    if (change === "unmount") setup.panel.unmount();
    else setup.store.setAuthenticated("other-token", session);
    resolveLogin({ token: "late-game-token", session });
    await flush();
    expect(setup.route).not.toHaveBeenCalled();
    expect(setup.store.getToken()).toBe(change === "unmount" ? null : "other-token");
    setup.panel.unmount();
  });

  it("keeps password login available when provider discovery is unavailable", async () => {
    const setup = googleSetup({ getAuthProviders: vi.fn().mockRejectedValue(new Error("unavailable")) });
    await flush();
    expect(setup.mount).not.toHaveBeenCalled();
    expect(setup.host.querySelector<HTMLElement>("[data-google-login]")?.hidden).toBe(true);
    expect(setup.host.querySelector<HTMLButtonElement>("[type='submit']")?.disabled).toBe(false);
    setup.panel.unmount();
  });

  it("switches between login, register and recovery modes", () => {
    const host = document.createElement("div");
    const panel = new AuthPanel(host, api(), new SessionStateStore(localStorage), vi.fn());
    panel.mount();

    expect(host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("login");
    click(host, "[data-auth-mode='register']");
    expect(host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("register");
    click(host, "[data-auth-mode='recover']");
    expect(host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("recover");
  });

  it("registers without auto-login, shows the recovery code once, then returns to login", async () => {
    const register = vi.fn().mockResolvedValue({ recoveryCode: "SAVE-ME-123" });
    const login = vi.fn();
    const store = new SessionStateStore(localStorage);
    const host = document.createElement("div");
    new AuthPanel(host, api({ register, login }), store, vi.fn()).mount();

    click(host, "[data-auth-mode='register']");
    input(host, "username", "Owczy");
    input(host, "password", "very-secret-password");
    input(host, "passwordConfirmation", "very-secret-password");
    submit(host);
    await flush();

    expect(register).toHaveBeenCalledWith("Owczy", "very-secret-password", "very-secret-password");
    expect(login).not.toHaveBeenCalled();
    expect(store.getToken()).toBeNull();
    expect(host.querySelector("[data-recovery-code]")?.textContent).toContain("SAVE-ME-123");
    expect(host.querySelector("[data-recovery-modal]")?.classList.contains("is-hidden")).toBe(false);
    expect(localStorage.length).toBe(0);

    click(host, "[data-recovery-continue]");
    expect(host.querySelector("[data-auth-panel]")?.getAttribute("data-mode")).toBe("login");
    expect(host.querySelector<HTMLInputElement>("[name='username']")?.value).toBe("Owczy");
    expect(host.querySelector<HTMLInputElement>("[name='password']")?.value).toBe("");
  });

  it("validates password confirmation client-side without calling the server", async () => {
    const register = vi.fn();
    const host = document.createElement("div");
    new AuthPanel(host, api({ register }), new SessionStateStore(localStorage), vi.fn()).mount();

    click(host, "[data-auth-mode='register']");
    input(host, "username", "Owczy");
    input(host, "password", "very-secret-password");
    input(host, "passwordConfirmation", "different-password");
    submit(host);
    await flush();

    expect(register).not.toHaveBeenCalled();
    expect(host.querySelector("[data-auth-error]")?.textContent).toContain("różnią");
  });

  it("preserves entered fields when the server rejects registration", async () => {
    const register = vi.fn().mockRejectedValue(
      new AuthApiRequestError(409, { code: "USERNAME_TAKEN", message: "Nazwa jest zajęta." })
    );
    const host = document.createElement("div");
    new AuthPanel(host, api({ register }), new SessionStateStore(localStorage), vi.fn()).mount();

    click(host, "[data-auth-mode='register']");
    input(host, "username", "Owczy");
    input(host, "password", "very-secret-password");
    input(host, "passwordConfirmation", "very-secret-password");
    submit(host);
    await flush();

    expect(host.querySelector<HTMLInputElement>("[name='username']")?.value).toBe("Owczy");
    expect(host.querySelector<HTMLInputElement>("[name='password']")?.value).toBe("very-secret-password");
    expect(host.querySelector("[data-auth-error]")?.textContent).toBe("Serwer odpowiedział błędem (409): Nazwa jest zajęta.");
  });

  it("recovers credentials, clears an existing token and shows the rotated recovery code", async () => {
    const recover = vi.fn().mockResolvedValue({ recoveryCode: "NEW-RECOVERY-456" });
    const store = new SessionStateStore(localStorage);
    const existing: SessionView = {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "none" }
    };
    store.setAuthenticated("old-token", existing);
    const host = document.createElement("div");
    new AuthPanel(host, api({ recover }), store, vi.fn()).mount();

    click(host, "[data-auth-mode='recover']");
    input(host, "username", "Owczy");
    input(host, "recoveryCode", "OLD-CODE");
    input(host, "newPassword", "new-secret-password");
    input(host, "passwordConfirmation", "new-secret-password");
    submit(host);
    await flush();

    expect(recover).toHaveBeenCalledWith("Owczy", "OLD-CODE", "new-secret-password", "new-secret-password");
    expect(store.getToken()).toBeNull();
    expect(host.querySelector("[data-recovery-code]")?.textContent).toContain("NEW-RECOVERY-456");
    expect(JSON.stringify(localStorage)).not.toContain("OLD-CODE");
    expect(JSON.stringify(localStorage)).not.toContain("new-secret-password");
  });

  it("sends login through AuthApi and shows progress while waiting for the server", async () => {
    let resolveResponse!: (response: Response) => void;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        String(_input).endsWith("/api/auth/providers")
          ? Promise.resolve(new Response(JSON.stringify({ google: { enabled: false, clientId: null } })))
          : new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    const authApi = new AuthApi(
      "https://game.example.test",
      fetcher as unknown as typeof fetch
    );
    const host = document.createElement("div");
    const session: SessionView = {
      accountUsername: "Owczy",
      accountRole: "PLAYER",
      character: { state: "none" }
    };
    const store = new SessionStateStore(localStorage);
    new AuthPanel(host, authApi, store, vi.fn()).mount();

    input(host, "username", "Owczy");
    input(host, "password", "very-secret-password");
    submit(host);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, request] = fetcher.mock.calls[1] ?? [];
    expect(url).toBe("https://game.example.test/api/auth/login");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      username: "Owczy",
      password: "very-secret-password"
    });
    expect(new Headers(request?.headers).get("content-type")).toBe("application/json");
    expect(host.querySelector("[data-auth-status]")?.textContent).toBe("Łączenie z serwerem…");
    expect(host.querySelector<HTMLButtonElement>("[type='submit']")?.disabled).toBe(true);

    resolveResponse({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ token: "new-token", session })
    } as Response);
    await flush();

    expect(store.getToken()).toBe("new-token");
  });

  it("distinguishes network failures from server responses", async () => {
    const networkFetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        Promise.reject(new TypeError("Failed to fetch"))
    );
    const networkHost = document.createElement("div");
    new AuthPanel(
      networkHost,
      new AuthApi("https://game.example.test", networkFetcher as unknown as typeof fetch),
      new SessionStateStore(localStorage),
      vi.fn()
    ).mount();
    input(networkHost, "username", "Owczy");
    input(networkHost, "password", "very-secret-password");
    submit(networkHost);
    await flush();

    const networkError = networkHost.querySelector<HTMLElement>("[data-auth-error]");
    expect(networkError?.dataset.errorKind).toBe("network");
    expect(networkError?.textContent).toContain("połączenie z internetem");

    const serverFetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        ({
          ok: false,
          status: 401,
          json: async () => ({
            code: "INVALID_CREDENTIALS",
            message: "Nieprawidłowe dane logowania."
          })
        }) as Response
    );
    const serverHost = document.createElement("div");
    new AuthPanel(
      serverHost,
      new AuthApi("https://game.example.test", serverFetcher as unknown as typeof fetch),
      new SessionStateStore(localStorage),
      vi.fn()
    ).mount();
    input(serverHost, "username", "Owczy");
    input(serverHost, "password", "very-secret-password");
    submit(serverHost);
    await flush();

    const serverError = serverHost.querySelector<HTMLElement>("[data-auth-error]");
    expect(serverError?.dataset.errorKind).toBe("server");
    expect(serverError?.textContent).toBe(
      "Serwer odpowiedział błędem (401): Nieprawidłowe dane logowania."
    );
  });

  it("stores a successful login and delegates lifecycle routing", async () => {
    const session: SessionView = {
      accountUsername: "Owczy",
      accountRole: "ADMIN",
      character: { state: "none" }
    };
    const login = vi.fn().mockResolvedValue({ token: "new-token", session });
    const route = vi.fn();
    const store = new SessionStateStore(localStorage);
    const host = document.createElement("div");
    new AuthPanel(host, api({ login }), store, route).mount();

    input(host, "username", "Owczy");
    input(host, "password", "very-secret-password");
    submit(host);
    await flush();

    expect(store.getToken()).toBe("new-token");
    expect(store.getSession()).toEqual(session);
    expect(route).toHaveBeenCalledWith("new-token", session);
  });
});
