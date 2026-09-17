import type { DbExecutor } from "./dbTypes";

export interface SessionRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  };
}

export class SessionRepository {
  constructor(private readonly db: DbExecutor) {}

  async replaceActiveSession(input: {
    id: string;
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    await this.db.query(
      "SELECT id FROM accounts WHERE id = $1 FOR UPDATE",
      [input.accountId]
    );

    await this.db.query(
      `UPDATE account_sessions
       SET revoked_at = now()
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [input.accountId]
    );

    const result = await this.db.query<SessionRow>(
      `INSERT INTO account_sessions (id, account_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, account_id, token_hash, expires_at, revoked_at`,
      [input.id, input.accountId, input.tokenHash, input.expiresAt]
    );

    return mapSession(result.rows[0]!);
  }

  async findValidByTokenHash(
    tokenHash: string,
    now: Date
  ): Promise<SessionRecord | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT id, account_id, token_hash, expires_at, revoked_at
       FROM account_sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > $2`,
      [tokenHash, now]
    );

    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async touch(sessionId: string, now: Date): Promise<void> {
    await this.db.query(
      "UPDATE account_sessions SET last_seen_at = $2 WHERE id = $1",
      [sessionId, now]
    );
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await this.db.query(
      `UPDATE account_sessions
       SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );
  }

  async revokeAllForAccount(accountId: string): Promise<void> {
    await this.db.query(
      `UPDATE account_sessions
       SET revoked_at = now()
       WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId]
    );
  }
}
