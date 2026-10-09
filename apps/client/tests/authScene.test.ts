/* @vitest-environment jsdom */

import type { SessionView } from "@web-mmorpg/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiRequestError, type AuthApi } from "../src/net/AuthApi";
import { AuthPanel } from "../src/scenes/AuthScene";
import { SessionStateStore } from "../src/state/SessionStateStore";

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
    ...overrides
  } as unknown as AuthApi;
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("AuthPanel", () => {
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
    expect(host.querySelector("[data-auth-error]")?.textContent).toBe("Nazwa jest zajęta.");
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
