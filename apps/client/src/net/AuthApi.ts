import type {
  InjuryKind,
  LoginResponse,
  RecoverResponse,
  RegisterResponse,
  SessionView
} from "@web-mmorpg/shared";

export interface AuthApiErrorPayload {
  code: string;
  message: string;
}

export interface CharacterRecordView {
  id: string;
  accountId: string;
  nickname: string;
  nicknameNormalized: string;
  appearance: Record<string, unknown>;
  locationId: string;
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  injuries: InjuryKind[];
  deletionRequestedAt: string | null;
  deletionEffectiveAt: string | null;
}

export class AuthApiNetworkError extends Error {
  constructor() {
    super("Nie udało się nawiązać połączenia z serwerem. Sprawdź połączenie z internetem i spróbuj ponownie.");
    this.name = "AuthApiNetworkError";
  }
}

export class AuthApiRequestError extends Error {
  constructor(
    public readonly status: number,
    payload: AuthApiErrorPayload
  ) {
    super(payload.message);
    this.name = "AuthApiRequestError";
    this.code = payload.code;
  }

  readonly code: string;
}

export class AuthApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(baseUrl: string, fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetcher = fetcher.bind(globalThis);
  }

  register(
    username: string,
    password: string,
    passwordConfirmation: string
  ): Promise<RegisterResponse> {
    return this.request<RegisterResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, passwordConfirmation })
    });
  }

  login(username: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  }

  getSession(token: string): Promise<SessionView> {
    return this.request<SessionView>("/api/auth/session", {}, token);
  }

  async logout(token: string): Promise<void> {
    await this.request<void>("/api/auth/logout", { method: "POST" }, token);
  }

  recover(
    username: string,
    recoveryCode: string,
    newPassword: string,
    passwordConfirmation: string
  ): Promise<RecoverResponse> {
    return this.request<RecoverResponse>("/api/auth/recover", {
      method: "POST",
      body: JSON.stringify({
        username,
        recoveryCode,
        newPassword,
        passwordConfirmation
      })
    });
  }

  getCharacter(token: string): Promise<CharacterRecordView> {
    return this.request<CharacterRecordView>("/api/character", {}, token);
  }

  createCharacter(
    token: string,
    input: { nickname: string; appearance: Record<string, unknown> }
  ): Promise<CharacterRecordView> {
    return this.request<CharacterRecordView>(
      "/api/character",
      {
        method: "POST",
        body: JSON.stringify(input)
      },
      token
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    token?: string
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        method: init.method ?? "GET",
        headers
      });
    } catch {
      throw new AuthApiNetworkError();
    }

    if (!response.ok) throw await this.toRequestError(response);
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private async toRequestError(response: Response): Promise<AuthApiRequestError> {
    let payload: AuthApiErrorPayload = {
      code: `HTTP_${response.status}`,
      message: `Authentication request failed (${response.status}).`
    };

    try {
      const parsed = (await response.json()) as Partial<AuthApiErrorPayload>;
      if (typeof parsed.code === "string" && typeof parsed.message === "string") {
        payload = { code: parsed.code, message: parsed.message };
      }
    } catch {
      // Keep a normalized fallback when the response is not JSON.
    }

    return new AuthApiRequestError(response.status, payload);
  }
}
