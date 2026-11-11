/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApi, AuthApiRequestError } from "../src/net/AuthApi";
import type { GoogleSignInAdapter, GoogleSignInCallbacks } from "../src/net/GoogleSignIn";
import { SessionStateStore } from "../src/state/SessionStateStore";
import { AccountPanel } from "../src/ui/AccountPanel";

const status = { linked: false, canLink: true, googleEnabled: true };
const session = { accountUsername: "Owczy", accountRole: "PLAYER" as const, character: { state: "none" as const } };
let panels: AccountPanel[] = [];
beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); });
afterEach(() => { for (const panel of panels) panel.destroy(); panels = []; });

function setup(overrides: Partial<Record<keyof AuthApi, unknown>> = {}) {
  let callbacks!: GoogleSignInCallbacks;
  const mount = vi.fn<GoogleSignInAdapter["mount"]>(async (_host, _challenge, options) => { callbacks = options; });
  const api = {
    getGoogleAccount: vi.fn().mockResolvedValue(status),
    createGoogleChallenge: vi.fn().mockResolvedValue({ challengeId: "link-challenge", nonce: "link-nonce", clientId: "server-client" }),
    linkGoogleAccount: vi.fn().mockResolvedValue({ linked: true, canLink: false, googleEnabled: true }),
    ...overrides
  } as unknown as AuthApi;
  const store = new SessionStateStore(localStorage); store.setAuthenticated("original-game-token", session);
  const panel = new AccountPanel(api, store, { mount }); panels.push(panel);
  return { panel, api, store, mount, callbacks: () => callbacks };
}

function beginLink(password = "current-game-password") {
  document.querySelector<HTMLButtonElement>("[data-google-link-start]")!.click();
  document.querySelector<HTMLInputElement>("[name='currentPassword']")!.value = password;
  document.querySelector<HTMLFormElement>("[data-google-link-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("AccountPanel Google linking", () => {
  it("requires a password before Google selection and keeps the same session and open panel after linking", async () => {
    const test = setup(); await test.panel.show();
    expect(test.api.getGoogleAccount).toHaveBeenCalledExactlyOnceWith("original-game-token");
    beginLink("");
    expect(test.mount).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>("[name='currentPassword']")!.value = "current-game-password";
    document.querySelector<HTMLFormElement>("[data-google-link-form]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(test.mount).toHaveBeenCalledTimes(1));
    expect(test.api.createGoogleChallenge).toHaveBeenCalledExactlyOnceWith("link", "original-game-token");
    expect(document.querySelector<HTMLInputElement>("[name='currentPassword']")?.value).toBe("");
    test.callbacks().onCredential("opaque-id-token");
    await vi.waitFor(() => expect(document.querySelector("[data-google-account-status]")?.getAttribute("data-linked")).toBe("true"));
    expect(test.api.linkGoogleAccount).toHaveBeenCalledExactlyOnceWith("original-game-token", {
      challengeId: "link-challenge", idToken: "opaque-id-token", password: "current-game-password"
    });
    expect(document.querySelector<HTMLElement>("[data-account-panel]")?.hidden).toBe(false);
    expect(test.store.getToken()).toBe("original-game-token");
    expect(test.store.getSession()).toEqual(session);
    expect(JSON.stringify(localStorage)).not.toMatch(/opaque|password/);
  });

  it.each([
    { linked: false, canLink: true, googleEnabled: false },
    { linked: true, canLink: false, googleEnabled: true },
    { linked: false, canLink: false, googleEnabled: true }
  ])("does not offer an unavailable or inapplicable link: %j", async (result) => {
    const test = setup({ getGoogleAccount: vi.fn().mockResolvedValue(result) }); await test.panel.show();
    expect(document.querySelector<HTMLButtonElement>("[data-google-link-start]")?.hidden).toBe(true);
    expect(test.mount).not.toHaveBeenCalled();
    expect(test.store.getToken()).toBe("original-game-token");
  });

  it("keeps the account panel usable on cancellation or a linking conflict", async () => {
    const test = setup({ linkGoogleAccount: vi.fn().mockRejectedValue(new AuthApiRequestError(409, { code: "GOOGLE_ALREADY_LINKED", message: "Konto Google jest już połączone z innym kontem gry." })) });
    await test.panel.show(); beginLink();
    await vi.waitFor(() => expect(test.mount).toHaveBeenCalledTimes(1));
    test.callbacks().onError({ code: "GOOGLE_CANCELLED" });
    expect(document.querySelector("[data-account-error]")?.textContent).toBe("");
    test.callbacks().onCredential("conflicting-token");
    await vi.waitFor(() => expect(document.querySelector("[data-account-error]")?.textContent).toContain("innym kontem"));
    expect(document.querySelector<HTMLElement>("[data-account-panel]")?.hidden).toBe(false);
    expect(test.store.getToken()).toBe("original-game-token");
  });

  it.each(["close", "session replacement"])("does not submit a Google credential after %s", async (change) => {
    const test = setup(); await test.panel.show(); beginLink();
    await vi.waitFor(() => expect(test.mount).toHaveBeenCalledTimes(1));
    const callbacks = test.callbacks();
    if (change === "close") test.panel.hide();
    else test.store.setAuthenticated("replacement-session", session);
    callbacks.onCredential("late-google-token");
    await Promise.resolve();
    expect(test.api.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it("ignores an in-flight linking result after close and supports the normal back action", async () => {
    let resolveLink!: (value: unknown) => void;
    const test = setup({ linkGoogleAccount: vi.fn(() => new Promise(resolve => { resolveLink = resolve; })) });
    await test.panel.show(); beginLink();
    await vi.waitFor(() => expect(test.mount).toHaveBeenCalledTimes(1));
    test.callbacks().onCredential("google-token");
    const back = new Event("game-ui-back", { cancelable: true }); document.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);
    resolveLink({ linked: true, canLink: false, googleEnabled: true });
    await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector<HTMLElement>("[data-account-panel]")?.hidden).toBe(true);
    expect(document.querySelector("[data-google-account-status]")?.getAttribute("data-linked")).not.toBe("true");
  });
});
