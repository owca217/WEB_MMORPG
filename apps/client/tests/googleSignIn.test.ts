/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ enabled: false, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => native.enabled },
  registerPlugin: () => native
}));

import { GoogleSignIn } from "../src/net/GoogleSignIn";

const challenge = { challengeId: "challenge", clientId: "server-client", nonce: "server-nonce" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => { document.body.replaceChildren(); native.enabled = false; vi.resetAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("Google sign-in adapter", () => {
  it("renders the official GIS button with the server nonce and ignores callbacks from an older button", async () => {
    let callback!: (response: { credential: string; state: string }) => void;
    const initialize = vi.fn((config) => { callback = config.callback; });
    const renderButton = vi.fn();
    const prompt = vi.fn();
    vi.stubGlobal("google", { accounts: { id: { initialize, renderButton, prompt } } });
    const host = document.createElement("div"), controller = new AbortController();
    const onCredential = vi.fn(), onError = vi.fn();

    await new GoogleSignIn().mount(host, challenge, { signal: controller.signal, onCredential, onError });

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: "server-client", nonce: "server-nonce", auto_select: false, ux_mode: "popup" }));
    expect(renderButton).toHaveBeenCalledWith(host, expect.objectContaining({ type: "standard", state: "server-nonce" }));
    expect(prompt).not.toHaveBeenCalled();
    callback({ credential: "stale-token", state: "old-nonce" });
    expect(onCredential).not.toHaveBeenCalled();
    callback({ credential: "id-token", state: "server-nonce" });
    expect(onCredential).toHaveBeenCalledExactlyOnceWith("id-token");
    controller.abort();
    callback({ credential: "late-token", state: "server-nonce" });
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("opens native credentials only after a click and suppresses overlapping choices", async () => {
    native.enabled = true;
    const response = deferred<{ idToken: string }>();
    native.signIn.mockReturnValue(response.promise);
    const host = document.createElement("div"), onCredential = vi.fn(), onError = vi.fn();
    await new GoogleSignIn().mount(host, challenge, { signal: new AbortController().signal, onCredential, onError });
    expect(native.signIn).not.toHaveBeenCalled();
    const button = host.querySelector("button")!;
    button.click(); button.click();
    expect(native.signIn).toHaveBeenCalledExactlyOnceWith({ clientId: "server-client", nonce: "server-nonce" });
    response.resolve({ idToken: "native-token" });
    await vi.waitFor(() => expect(onCredential).toHaveBeenCalledExactlyOnceWith("native-token"));
  });

  it("reports native cancellation quietly to the caller and allows another explicit choice", async () => {
    native.enabled = true;
    native.signIn.mockRejectedValueOnce({ code: "GOOGLE_CANCELLED" }).mockResolvedValueOnce({ idToken: "retry-token" });
    const host = document.createElement("div"), onCredential = vi.fn(), onError = vi.fn();
    await new GoogleSignIn().mount(host, challenge, { signal: new AbortController().signal, onCredential, onError });
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: "GOOGLE_CANCELLED" })));
    host.querySelector("button")!.click();
    await vi.waitFor(() => expect(onCredential).toHaveBeenCalledWith("retry-token"));
  });

  it("discards a native result when its panel closes", async () => {
    native.enabled = true;
    const response = deferred<{ idToken: string }>();
    native.signIn.mockReturnValue(response.promise);
    const host = document.createElement("div"), controller = new AbortController(), onCredential = vi.fn();
    await new GoogleSignIn().mount(host, challenge, { signal: controller.signal, onCredential, onError: vi.fn() });
    host.querySelector("button")!.click();
    controller.abort(); response.resolve({ idToken: "late-token" });
    await response.promise; await Promise.resolve();
    expect(onCredential).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it("treats provider cleanup as best effort on native and disables browser auto selection", async () => {
    const disableAutoSelect = vi.fn();
    vi.stubGlobal("google", { accounts: { id: { disableAutoSelect } } });
    const adapter = new GoogleSignIn();
    await adapter.signOut();
    expect(disableAutoSelect).toHaveBeenCalledTimes(1);
    native.enabled = true;
    native.signOut.mockRejectedValue(new Error("unavailable"));
    await expect(adapter.signOut()).resolves.toBeUndefined();
  });
});
