import type {
  AppearanceSelection,
  CharacterProfile,
  LoginResponse,
  RecoverResponse,
  RegisterResponse,
  SessionView
} from "@web-mmorpg/shared";
import { authSessionStore } from "../state/AuthSessionStore";

const baseUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authSessionStore.getToken();
  const headers = new Headers(init.headers);

  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(baseUrl + path, { ...init, headers });
  const body = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    const candidate =
      typeof body === "object" && body !== null
        ? (body as { code?: unknown; message?: unknown })
        : {};
    const code =
      typeof candidate.code === "string" ? candidate.code : "REQUEST_FAILED";
    const message =
      typeof candidate.message === "string" ? candidate.message : "Request failed.";
    throw Object.assign(new Error(message), { code, status: response.status });
  }

  return body as T;
}

export class ApiClient {
  async register(
    username: string,
    password: string,
    passwordConfirmation: string
  ): Promise<RegisterResponse> {
    return requestJson<RegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, passwordConfirmation })
    });
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const result = await requestJson<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    authSessionStore.setToken(result.token);
    return result;
  }

  async logout(): Promise<void> {
    try {
      await requestJson<null>("/api/auth/logout", { method: "POST" });
    } finally {
      authSessionStore.clear();
    }
  }

  async recover(
    username: string,
    recoveryCode: string,
    newPassword: string,
    passwordConfirmation: string
  ): Promise<RecoverResponse> {
    return requestJson<RecoverResponse>("/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        username,
        recoveryCode,
        newPassword,
        passwordConfirmation
      })
    });
  }

  async getSession(): Promise<SessionView> {
    return requestJson<SessionView>("/api/auth/session");
  }

  async createCharacter(input: {
    nickname: string;
    appearance: AppearanceSelection;
  }): Promise<CharacterProfile> {
    return requestJson<CharacterProfile>("/api/character", {
      method: "POST",
      body: JSON.stringify(input)
    });
  }
}

export const apiClient = new ApiClient();
