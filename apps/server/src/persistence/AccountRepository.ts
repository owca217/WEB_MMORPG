import type { AccountRole, AccountStatus } from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";

export interface AccountRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  recoveryCodeHash: string;
  status: AccountStatus;
  role: AccountRole;
  createdAt: Date;
  updatedAt: Date;
}

interface AccountRow {
  id: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  recovery_code_hash: string;
  status: AccountStatus;
  role: AccountRole;
  created_at: Date;
  updated_at: Date;
}

const RETURNING =
  "id, username, username_normalized, password_hash, recovery_code_hash, status, role, created_at, updated_at";

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    recoveryCodeHash: row.recovery_code_hash,
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AccountRepository {
  constructor(private readonly db: Pool | PoolClient) {}

  async create(input: {
    id: string;
    username: string;
    usernameNormalized: string;
    passwordHash: string;
    recoveryCodeHash: string;
    role?: AccountRole;
    status?: AccountStatus;
  }): Promise<AccountRecord> {
    const result = await this.db.query<AccountRow>(
      `INSERT INTO accounts
       (id, username, username_normalized, password_hash, recovery_code_hash, role, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING ${RETURNING}`,
      [
        input.id,
        input.username,
        input.usernameNormalized,
        input.passwordHash,
        input.recoveryCodeHash,
        input.role ?? "PLAYER",
        input.status ?? "active"
      ]
    );
    return mapAccount(result.rows[0]!);
  }

  async findByNormalizedUsername(normalized: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${RETURNING} FROM accounts WHERE username_normalized = $1`,
      [normalized]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async findById(accountId: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${RETURNING} FROM accounts WHERE id = $1`,
      [accountId]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async updateCredentials(
    accountId: string,
    passwordHash: string,
    recoveryCodeHash: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE accounts
       SET password_hash = $2,
           recovery_code_hash = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [accountId, passwordHash, recoveryCodeHash]
    );
  }

  async updateRole(accountId: string, role: AccountRole): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `UPDATE accounts SET role = $2, updated_at = NOW()
       WHERE id = $1 RETURNING ${RETURNING}`,
      [accountId, role]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async updateStatus(accountId: string, status: AccountStatus): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `UPDATE accounts SET status = $2, updated_at = NOW()
       WHERE id = $1 RETURNING ${RETURNING}`,
      [accountId, status]
    );
    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }
}
