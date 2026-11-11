import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AccountRepository } from "../persistence/AccountRepository";
import { AuthError, AuthService, type LoginServiceResult } from "./AuthService";
import type { AuthContext } from "./AuthContext";
import { verifyPassword } from "./credentials";
import { hashOpaqueSecret } from "./secrets";
import { GoogleIdentityVerifier, type GoogleIdentity, type GoogleTokenVerifier } from "./GoogleIdentityVerifier";

type Intent = "login" | "link";
export interface GoogleAccountStatus { linked: boolean; canLink: boolean; googleEnabled: boolean }
interface ChallengeRow {
  nonce_hash: string; intent: Intent; account_id: string | null; session_id: string | null;
  expires_at: Date; used_at: Date | null;
}

function invalidChallenge(): AuthError {
  return new AuthError("GOOGLE_CHALLENGE_INVALID", 401, "Ta próba logowania Google wygasła. Spróbuj ponownie.");
}
function linkedConflict(): AuthError {
  return new AuthError("GOOGLE_ALREADY_LINKED", 409, "Konto Google lub konto gry jest już połączone. Wybierz właściwe konto.");
}

export class GoogleAuthService {
  private readonly clientId: string | null;
  constructor(
    private readonly pool: Pool,
    private readonly auth: AuthService,
    clientId: string | null | undefined,
    private readonly verifier: GoogleTokenVerifier = new GoogleIdentityVerifier(),
    private readonly clock: () => Date = () => new Date()
  ) { this.clientId = clientId?.trim() || null; }

  providers(): { google: { enabled: boolean; clientId: string | null } } {
    return { google: { enabled: this.clientId !== null, clientId: this.clientId } };
  }

  private requireClientId(): string {
    if (!this.clientId) throw new AuthError("GOOGLE_UNAVAILABLE", 503, "Logowanie Google jest obecnie niedostępne. Możesz użyć loginu i hasła.");
    return this.clientId;
  }

  async createChallenge(intent: Intent, context?: AuthContext): Promise<{ challengeId: string; nonce: string; clientId: string }> {
    const clientId = this.requireClientId();
    if (intent !== "login" && intent !== "link") throw invalidChallenge();
    if (intent === "link") {
      if (!context) throw new AuthError("UNAUTHORIZED", 401, "Zaloguj się na konto gry.");
      await this.requireLiveSession(this.pool, context);
    }
    const now = this.clock();
    await this.pool.query("DELETE FROM google_auth_challenges WHERE id IN (SELECT id FROM google_auth_challenges WHERE expires_at <= $1 LIMIT 1000)", [now]);
    const challengeId = randomUUID();
    const nonce = randomBytes(32).toString("base64url");
    await this.pool.query(
      "INSERT INTO google_auth_challenges (id, nonce_hash, intent, account_id, session_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [challengeId, hashOpaqueSecret(nonce), intent, intent === "link" ? context!.accountId : null, intent === "link" ? context!.sessionId : null, new Date(now.getTime() + 300_000)]
    );
    return { challengeId, nonce, clientId };
  }

  async getStatus(accountId: string): Promise<GoogleAccountStatus> {
    const account = await new AccountRepository(this.pool).findById(accountId);
    if (!account) throw new AuthError("UNAUTHORIZED", 401, "Zaloguj się na konto gry.");
    const found = await this.pool.query("SELECT 1 FROM account_google_identities WHERE account_id=$1", [accountId]);
    const linked = Boolean(found.rowCount);
    return { linked, canLink: !linked && Boolean(account.passwordHash), googleEnabled: Boolean(this.clientId) };
  }

  async login(challengeId: string, idToken: string): Promise<LoginServiceResult> {
    const identity = await this.verifyToken(idToken);
    const grant = await this.transaction(async client => {
      await this.consumeChallenge(client, challengeId, identity, "login");
      await this.lockIdentity(client, identity.subject);
      const existing = await client.query<{ account_id: string }>("SELECT account_id FROM account_google_identities WHERE google_subject=$1", [identity.subject]);
      let accountId = existing.rows[0]?.account_id;
      if (!accountId) {
        accountId = randomUUID();
        const username = `gracz_${randomBytes(12).toString("hex")}`;
        await new AccountRepository(client).create({ id: accountId, username, usernameNormalized: username, passwordHash: null, recoveryCodeHash: null, role: "PLAYER", status: "active" });
        await client.query("INSERT INTO account_google_identities (account_id, google_subject) VALUES ($1,$2)", [accountId, identity.subject]);
      }
      return this.auth.issueSession(accountId, client);
    });
    return this.auth.completeLogin(grant);
  }

  async link(context: AuthContext, challengeId: string, idToken: string, password: string): Promise<GoogleAccountStatus> {
    const identity = await this.verifyToken(idToken);
    await this.transaction(async client => {
      await this.consumeChallenge(client, challengeId, identity, "link", context);
      await this.lockIdentity(client, identity.subject);
      await client.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [context.accountId]);
      await this.requireLiveSession(client, context, true);
      const account = await new AccountRepository(client).findById(context.accountId);
      if (!account || account.status !== "active") throw new AuthError("ACCOUNT_DISABLED", 403, "To konto jest zablokowane.");
      if (!account.passwordHash || !password || password.length > 256 || !(await verifyPassword(account.passwordHash, password))) {
        throw new AuthError("INVALID_CREDENTIALS", 401, "Nieprawidłowe hasło konta gry.");
      }
      const links = await client.query<{ account_id: string; google_subject: string }>(
        "SELECT account_id, google_subject FROM account_google_identities WHERE account_id=$1 OR google_subject=$2", [context.accountId, identity.subject]
      );
      if (links.rows.some(row => row.account_id !== context.accountId || row.google_subject !== identity.subject)) throw linkedConflict();
      if (!links.rowCount) await client.query("INSERT INTO account_google_identities (account_id,google_subject) VALUES ($1,$2)", [context.accountId, identity.subject]);
    });
    return this.getStatus(context.accountId);
  }

  private async verifyToken(idToken: string): Promise<GoogleIdentity> {
    const clientId = this.requireClientId();
    if (!idToken || idToken.length > 16_384) throw new AuthError("GOOGLE_INVALID_TOKEN", 401, "Nieprawidłowa odpowiedź Google.");
    const identity = await this.verifier.verify(idToken, clientId);
    if (!identity.subject || identity.subject.length > 255 || !identity.nonce || identity.nonce.length > 512) throw invalidChallenge();
    return identity;
  }

  private async consumeChallenge(client: PoolClient, id: string, identity: GoogleIdentity, intent: Intent, context?: AuthContext): Promise<void> {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw invalidChallenge();
    const found = await client.query<ChallengeRow>("SELECT * FROM google_auth_challenges WHERE id=$1 FOR UPDATE", [id]);
    const row = found.rows[0];
    if (!row || row.used_at || row.expires_at <= this.clock() || row.intent !== intent ||
      (intent === "link" && (row.account_id !== context?.accountId || row.session_id !== context?.sessionId))) throw invalidChallenge();
    const expected = Buffer.from(row.nonce_hash, "hex");
    const actual = Buffer.from(hashOpaqueSecret(identity.nonce), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw invalidChallenge();
    await client.query("UPDATE google_auth_challenges SET used_at=$2 WHERE id=$1", [id, this.clock()]);
  }

  private async requireLiveSession(db: Pool | PoolClient, context: AuthContext, lock = false): Promise<void> {
    const result = await db.query(`SELECT 1 FROM account_sessions WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>$3${lock ? " FOR UPDATE" : ""}`, [context.sessionId, context.accountId, this.clock()]);
    if (!result.rowCount) throw new AuthError("UNAUTHORIZED", 401, "Sesja wygasła. Zaloguj się ponownie.");
  }

  private async lockIdentity(client: PoolClient, subject: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`game-google-identity:${subject}`]);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}
