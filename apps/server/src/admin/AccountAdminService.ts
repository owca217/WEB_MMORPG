import type {
  AccountRole,
  AccountStatus,
  AdminAccountPage,
  AdminAccountQuery,
  AdminAccountSummary,
  UpdateAccountAccessInput
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import type { AdminAuditRepository } from "../audit/AdminAuditRepository";
import type { ActiveConnectionRegistry } from "../server/ActiveConnectionRegistry";

interface AccountSummaryRow {
  id: string;
  username: string;
  role: AccountRole;
  status: AccountStatus;
  created_at: Date | string;
  updated_at: Date | string;
}

export class AccountAdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "AccountAdminError";
  }
}

function mapSummary(row: AccountSummaryRow): AdminAccountSummary {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString()
  };
}

function validateAccessInput(input: UpdateAccountAccessInput): void {
  if (input.role !== undefined && input.role !== "PLAYER" && input.role !== "ADMIN") {
    throw new AccountAdminError("INVALID_ACCOUNT_ROLE", 400, "Invalid account role.");
  }
  if (
    input.status !== undefined &&
    input.status !== "active" &&
    input.status !== "banned"
  ) {
    throw new AccountAdminError("INVALID_ACCOUNT_STATUS", 400, "Invalid account status.");
  }
  if (input.role === undefined && input.status === undefined) {
    throw new AccountAdminError(
      "ACCOUNT_ACCESS_CHANGE_REQUIRED",
      400,
      "At least one account access field is required."
    );
  }
}

export class AccountAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AdminAuditRepository,
    private readonly connections?: ActiveConnectionRegistry
  ) {}

  async listAccounts(query: AdminAccountQuery = {}): Promise<AdminAccountPage> {
    const search = query.search?.trim() ?? "";
    const page = this.positiveInteger(query.page, 1, "INVALID_PAGE");
    const pageSize = Math.min(
      this.positiveInteger(query.pageSize, 25, "INVALID_PAGE_SIZE"),
      100
    );
    const pattern = `%${search}%`;
    const offset = (page - 1) * pageSize;

    const [countResult, rowsResult] = await Promise.all([
      this.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM accounts
         WHERE $1 = '' OR username ILIKE $2`,
        [search, pattern]
      ),
      this.pool.query<AccountSummaryRow>(
        `SELECT id, username, role, status, created_at, updated_at
         FROM accounts
         WHERE $1 = '' OR username ILIKE $2
         ORDER BY username_normalized ASC, id ASC
         LIMIT $3 OFFSET $4`,
        [search, pattern, pageSize, offset]
      )
    ]);

    return {
      accounts: rowsResult.rows.map(mapSummary),
      total: Number(countResult.rows[0]?.count ?? 0),
      page,
      pageSize
    };
  }

  async updateAccess(
    actorAccountId: string,
    targetAccountId: string,
    input: UpdateAccountAccessInput
  ): Promise<AdminAccountSummary> {
    validateAccessInput(input);
    const client = await this.pool.connect();
    let updated: AdminAccountSummary | null = null;
    let shouldDisconnect = false;

    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('web_mmorpg_admin_access')::bigint)"
      );

      const current = await this.requireAccountForUpdate(client, targetAccountId);
      const nextRole = input.role ?? current.role;
      const nextStatus = input.status ?? current.status;
      const removesActiveAdmin =
        current.role === "ADMIN" &&
        current.status === "active" &&
        (nextRole !== "ADMIN" || nextStatus !== "active");

      if (removesActiveAdmin) {
        const count = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM accounts
           WHERE role = 'ADMIN' AND status = 'active'`
        );
        if (Number(count.rows[0]?.count ?? 0) <= 1) {
          throw new AccountAdminError(
            "LAST_ACTIVE_ADMIN",
            409,
            "The last active ADMIN cannot be demoted or banned."
          );
        }
      }

      const result = await client.query<AccountSummaryRow>(
        `UPDATE accounts
         SET role = $2, status = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, role, status, created_at, updated_at`,
        [targetAccountId, nextRole, nextStatus]
      );
      updated = mapSummary(result.rows[0]!);

      await this.audit.appendWithClient(client, {
        actorAccountId,
        action: "UPDATE_ACCOUNT_ACCESS",
        objectType: "account_access",
        objectId: targetAccountId,
        summary: {
          previousRole: current.role,
          newRole: nextRole,
          previousStatus: current.status,
          newStatus: nextStatus
        }
      });

      shouldDisconnect = current.status !== "banned" && nextStatus === "banned";
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (!updated) throw new Error("ACCOUNT_ACCESS_UPDATE_FAILED");
    if (shouldDisconnect) {
      this.connections?.closeAccount(targetAccountId, "ACCOUNT_DISABLED");
    }
    return updated;
  }

  private async requireAccountForUpdate(
    client: PoolClient,
    accountId: string
  ): Promise<AccountSummaryRow> {
    const result = await client.query<AccountSummaryRow>(
      `SELECT id, username, role, status, created_at, updated_at
       FROM accounts
       WHERE id = $1
       FOR UPDATE`,
      [accountId]
    );
    const account = result.rows[0];
    if (!account) {
      throw new AccountAdminError("ACCOUNT_NOT_FOUND", 404, "Account not found.");
    }
    return account;
  }

  private positiveInteger(
    value: number | undefined,
    fallback: number,
    code: string
  ): number {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < 1) {
      throw new AccountAdminError(code, 400, code);
    }
    return resolved;
  }
}
