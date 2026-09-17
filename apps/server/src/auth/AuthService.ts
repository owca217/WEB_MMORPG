import { randomUUID, timingSafeEqual } from "node:crypto";
import type {
  CharacterLifecycleSummary,
  RecoverResponse,
  RegisterResponse,
  SessionView
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import {
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword
} from "./credentials";
import {
  generateRecoveryCode,
  generateSessionToken,
  hashOpaqueSecret
} from "./secrets";
import { withTransaction } from "../db/transaction";
import {
  AccountRepository,
  type AccountRecord
} from "../persistence/AccountRepository";
import {
  SessionRepository,
  type SessionRecord
} from "../persistence/SessionRepository";

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface CharacterLifecycleReader {
  getLifecycle(
    accountId: string,
    now: Date
  ): Promise<CharacterLifecycleSummary>;
}

export interface LoginServiceResult {
  accountId: string;
  token: string;
  session: SessionView;
}

export interface RecoveryServiceResult {
  accountId: string;
  response: RecoverResponse;
}

export interface ValidatedAuthSession {
  account: AccountRecord;
  session: SessionRecord;
  view: SessionView;
}

function hasPgCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function secureHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly accounts: AccountRepository,
    private readonly characters: CharacterLifecycleReader | null = null,
    private readonly sessionTtlDays = 30
  ) {}

  async register(usernameInput: string, password: string): Promise<RegisterResponse> {
    const username = validateUsername(usernameInput);
    if (!username.ok) {
      throw new AuthError("INVALID_USERNAME", 400, "Invalid account username.");
    }
    if (!validatePassword(password)) {
      throw new AuthError(
        "INVALID_PASSWORD",
        400,
        "Password must contain between 10 and 256 characters."
      );
    }

    const recoveryCode = generateRecoveryCode();

    try {
      await this.accounts.create({
        id: randomUUID(),
        username: usernameInput.trim(),
        usernameNormalized: username.normalized,
        passwordHash: await hashPassword(password),
        recoveryCodeHash: hashOpaqueSecret(recoveryCode)
      });
    } catch (error) {
      if (hasPgCode(error, "23505")) {
        throw new AuthError("USERNAME_TAKEN", 409, "That account username is already taken.");
      }
      throw error;
    }

    return { recoveryCode };
  }

  async login(usernameInput: string, password: string): Promise<LoginServiceResult> {
    const username = validateUsername(usernameInput);
    if (!username.ok) {
      throw new AuthError("INVALID_CREDENTIALS", 401, "Invalid username or password.");
    }

    const account = await this.accounts.findByNormalizedUsername(username.normalized);
    if (!account || !(await verifyPassword(account.passwordHash, password))) {
      throw new AuthError("INVALID_CREDENTIALS", 401, "Invalid username or password.");
    }
    if (account.status !== "active") {
      throw new AuthError("ACCOUNT_DISABLED", 403, "This account is not active.");
    }

    const token = generateSessionToken();
    const tokenHash = hashOpaqueSecret(token);
    const expiresAt = new Date(
      Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1000
    );

    await withTransaction(this.pool, async (client) => {
      const sessions = new SessionRepository(client);
      await sessions.replaceActiveSession({
        id: randomUUID(),
        accountId: account.id,
        tokenHash,
        expiresAt
      });
    });

    return {
      accountId: account.id,
      token,
      session: await this.createSessionView(account, new Date())
    };
  }

  async validateToken(
    token: string,
    now = new Date()
  ): Promise<ValidatedAuthSession | null> {
    if (!token) return null;

    const sessions = new SessionRepository(this.pool);
    const session = await sessions.findValidByTokenHash(
      hashOpaqueSecret(token),
      now
    );
    if (!session) return null;

    const account = await this.accounts.findById(session.accountId);
    if (!account || account.status !== "active") return null;

    await sessions.touch(session.id, now);

    return {
      account,
      session,
      view: await this.createSessionView(account, now)
    };
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await new SessionRepository(this.pool).revokeByTokenHash(hashOpaqueSecret(token));
  }

  async recover(
    usernameInput: string,
    recoveryCode: string,
    newPassword: string
  ): Promise<RecoveryServiceResult> {
    const username = validateUsername(usernameInput);
    if (!username.ok) {
      throw new AuthError(
        "INVALID_RECOVERY_CODE",
        401,
        "Invalid account name or recovery code."
      );
    }
    if (!validatePassword(newPassword)) {
      throw new AuthError(
        "INVALID_PASSWORD",
        400,
        "Password must contain between 10 and 256 characters."
      );
    }

    const account = await this.accounts.findByNormalizedUsername(username.normalized);
    const suppliedRecoveryHash = hashOpaqueSecret(recoveryCode.trim().toUpperCase());

    if (
      !account ||
      !secureHashEquals(account.recoveryCodeHash, suppliedRecoveryHash)
    ) {
      throw new AuthError(
        "INVALID_RECOVERY_CODE",
        401,
        "Invalid account name or recovery code."
      );
    }

    const newRecoveryCode = generateRecoveryCode();
    const newPasswordHash = await hashPassword(newPassword);
    const newRecoveryHash = hashOpaqueSecret(newRecoveryCode);

    await withTransaction(this.pool, async (client) => {
      await client.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [
        account.id
      ]);
      await new AccountRepository(client).updateCredentials(
        account.id,
        newPasswordHash,
        newRecoveryHash
      );
      await new SessionRepository(client).revokeAllForAccount(account.id);
    });

    return {
      accountId: account.id,
      response: { recoveryCode: newRecoveryCode }
    };
  }

  private async createSessionView(
    account: AccountRecord,
    now: Date
  ): Promise<SessionView> {
    return {
      accountUsername: account.username,
      character: this.characters
        ? await this.characters.getLifecycle(account.id, now)
        : { state: "none" }
    };
  }
}
