import type { DbExecutor } from "./dbTypes";

export interface AccountRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  recoveryCodeHash: string;
  status: "active" | "banned";
}

interface AccountRow {
  id: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  recovery_code_hash: string;
  status: "active" | "banned";
}

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    username: row.username,
    usernameNormalized: row.username_normalized,
    passwordHash: row.password_hash,
    recoveryCodeHash: row.recovery_code_hash,
    status: row.status
  };
}

const RETURNING =
  "id, username, username_normalized, password_hash, recovery_code_hash, status";

export class AccountRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(input: {
    id: string;
    username: string;
    usernameNormalized: string;
    passwordHash: string;
    recoveryCodeHash: string;
  }): Promise<AccountRecord> {
    const result = await this.db.query<AccountRow>(
      `INSERT INTO accounts
       (id, username, username_normalized, password_hash, recovery_code_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${RETURNING}`,
      [
        input.id,
        input.username,
        input.usernameNormalized,
        input.passwordHash,
        input.recoveryCodeHash
      ]
    );

    return mapAccount(result.rows[0]!);
  }

  async findByNormalizedUsername(normalized: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${RETURNING}
       FROM accounts
       WHERE username_normalized = $1`,
      [normalized]
    );

    return result.rows[0] ? mapAccount(result.rows[0]) : null;
  }

  async findById(accountId: string): Promise<AccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${RETURNING}
       FROM accounts
       WHERE id = $1`,
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
           updated_at = now()
       WHERE id = $1`,
      [accountId, passwordHash, recoveryCodeHash]
    );
  }
}
