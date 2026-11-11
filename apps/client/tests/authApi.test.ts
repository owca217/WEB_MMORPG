import type { SessionView } from "@web-mmorpg/shared";
import { describe, expect, it, vi } from "vitest";
import { AuthApi, AuthApiRequestError } from "../src/net/AuthApi";

const session: SessionView = {
  accountUsername: "Owczy",
  accountRole: "PLAYER",
  character: { state: "none" }
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("AuthApi", () => {
  it("uses nonce challenges and bearer-authenticated Google account linking without profile data", async () => {
    const providers = { google: { enabled: true, clientId: "web-client" } };
    const challenge = { challengeId: "challenge", nonce: "nonce", clientId: "web-client" };
    const status = { linked: false, canLink: true, googleEnabled: true };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(providers))
      .mockResolvedValueOnce(jsonResponse(challenge))
      .mockResolvedValueOnce(jsonResponse({ token: "google-session", session }))
      .mockResolvedValueOnce(jsonResponse(status))
      .mockResolvedValueOnce(jsonResponse(challenge))
      .mockResolvedValueOnce(jsonResponse({ ...status, linked: true, canLink: false }));
    const api = new AuthApi("https://game.example/", fetcher);

    await expect(api.getAuthProviders()).resolves.toEqual(providers);
    await expect(api.createGoogleChallenge("login")).resolves.toEqual(challenge);
    await expect(api.loginWithGoogle("challenge", "id-token")).resolves.toEqual({ token: "google-session", session });
    await expect(api.getGoogleAccount("game-token")).resolves.toEqual(status);
    await api.createGoogleChallenge("link", "game-token");
    await expect(api.linkGoogleAccount("game-token", { challengeId: "challenge", idToken: "id-token", password: "current-password" })).resolves.toMatchObject({ linked: true });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://game.example/api/auth/providers", "https://game.example/api/auth/google/challenge",
      "https://game.example/api/auth/google/login", "https://game.example/api/account/google",
      "https://game.example/api/auth/google/challenge", "https://game.example/api/account/google/link"
    ]);
    for (const index of [0, 1, 2]) expect(new Headers(fetcher.mock.calls[index]![1]?.headers).has("Authorization")).toBe(false);
    for (const index of [3, 4, 5]) expect(new Headers(fetcher.mock.calls[index]![1]?.headers).get("Authorization")).toBe("Bearer game-token");
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual({ intent: "login" });
    expect(JSON.parse(String(fetcher.mock.calls[4]![1]?.body))).toEqual({ intent: "link" });
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body))).toEqual({ challengeId: "challenge", idToken: "id-token" });
    expect(JSON.parse(String(fetcher.mock.calls[5]![1]?.body))).toEqual({ challengeId: "challenge", idToken: "id-token", password: "current-password" });
  });

  it("invokes fetch with the browser global as its receiver", async () => {
    let receiver: unknown;
    const fetcher = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(jsonResponse({ token: "session-token", session }));
    } as typeof fetch;
    const api = new AuthApi("https://game.example", fetcher);

    await api.login("Owczy", "secret-password");

    expect(receiver).toBe(globalThis);
  });

  it("uses the auth REST endpoints and Bearer token for authenticated requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ token: "session-token", session }))
      .mockResolvedValueOnce(jsonResponse(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new AuthApi("https://game.example/", fetcher);

    await expect(api.login("Owczy", "secret-password")).resolves.toEqual({
      token: "session-token",
      session
    });
    await expect(api.getSession("session-token")).resolves.toEqual(session);
    await expect(api.logout("session-token")).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "https://game.example/api/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "Owczy", password: "secret-password" })
      })
    );
    const sessionRequest = fetcher.mock.calls[1]![1] as RequestInit;
    expect(new Headers(sessionRequest.headers).get("Authorization")).toBe("Bearer session-token");
    const logoutRequest = fetcher.mock.calls[2]![1] as RequestInit;
    expect(new Headers(logoutRequest.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("supports register, recovery and authenticated character endpoints", async () => {
    const character = {
      id: "character-1",
      nickname: "Owczy",
      appearance: {},
      locationId: "forest-settlement-01",
      x: 360,
      y: 470,
      level: 1,
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ recoveryCode: "RECOVERY-ONE" }, 201))
      .mockResolvedValueOnce(jsonResponse({ recoveryCode: "RECOVERY-TWO" }))
      .mockResolvedValueOnce(jsonResponse(character))
      .mockResolvedValueOnce(jsonResponse(character, 201));
    const api = new AuthApi("https://game.example", fetcher);

    await api.register("Owczy", "password-123", "password-123");
    await api.recover("Owczy", "old-code", "new-password", "new-password");
    await expect(api.getCharacter("token-1")).resolves.toMatchObject({ id: "character-1" });
    await expect(
      api.createCharacter("token-1", { nickname: "Owczy", appearance: { hair: "short" } })
    ).resolves.toMatchObject({ nickname: "Owczy" });

    expect(JSON.parse(String((fetcher.mock.calls[0]![1] as RequestInit).body))).toEqual({
      username: "Owczy",
      password: "password-123",
      passwordConfirmation: "password-123"
    });
    expect(JSON.parse(String((fetcher.mock.calls[1]![1] as RequestInit).body))).toEqual({
      username: "Owczy",
      recoveryCode: "old-code",
      newPassword: "new-password",
      passwordConfirmation: "new-password"
    });
    expect(new Headers((fetcher.mock.calls[2]![1] as RequestInit).headers).get("Authorization")).toBe(
      "Bearer token-1"
    );
    expect(new Headers((fetcher.mock.calls[3]![1] as RequestInit).headers).get("Authorization")).toBe(
      "Bearer token-1"
    );
  });

  it("normalizes structured and non-JSON failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ code: "INVALID_CREDENTIALS", message: "Invalid username or password." }, 401)
      )
      .mockResolvedValueOnce(new Response("gateway exploded", { status: 502 }));
    const api = new AuthApi("https://game.example", fetcher);

    await expect(api.login("Owczy", "bad-password")).rejects.toMatchObject({
      name: "AuthApiRequestError",
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: "Invalid username or password."
    } satisfies Partial<AuthApiRequestError>);

    await expect(api.getSession("token")).rejects.toMatchObject({
      status: 502,
      code: "HTTP_502"
    } satisfies Partial<AuthApiRequestError>);
  });
});
