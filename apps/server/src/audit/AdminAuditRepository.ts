import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export interface AdminAuditWrite {
  actorPlayerId: string;
  action: string;
  objectType: string;
  objectId: string;
  fromVersion?: number;
  toVersion?: number;
  summary?: Record<string, unknown>;
}

export interface AdminAuditEntry extends Required<Pick<AdminAuditWrite,
  "actorPlayerId" | "action" | "objectType" | "objectId"
>> {
  id: string;
  fromVersion?: number;
  toVersion?: number;
  summary: Record<string, unknown>;
  createdAt: string;
}

interface AuditRow {
  id: string;
  actor_player_id: string;
  action: string;
  object_type: string;
  object_id: string;
  from_version: number | null;
  to_version: number | null;
  summary: Record<string, unknown> | null;
  created_at: Date | string;
}

export class AdminAuditRepository {
  constructor(private readonly pool: Pool) {}

  async append(input: AdminAuditWrite): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.appendWithClient(client, input);
    } finally {
      client.release();
    }
  }

  async appendWithClient(client: PoolClient, input: AdminAuditWrite): Promise<void> {
    await client.query(
      `INSERT INTO admin_audit_log (
        id, actor_player_id, action, object_type, object_id,
        from_version, to_version, summary
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        input.actorPlayerId,
        input.action,
        input.objectType,
        input.objectId,
        input.fromVersion ?? null,
        input.toVersion ?? null,
        JSON.stringify(input.summary ?? {})
      ]
    );
  }

  async listForObject(objectType: string, objectId: string): Promise<AdminAuditEntry[]> {
    const result = await this.pool.query<AuditRow>(
      `SELECT id, actor_player_id, action, object_type, object_id,
              from_version, to_version, summary, created_at
       FROM admin_audit_log
       WHERE object_type = $1 AND object_id = $2
       ORDER BY created_at ASC, id ASC`,
      [objectType, objectId]
    );

    return result.rows.map((row) => {
      const entry: AdminAuditEntry = {
        id: row.id,
        actorPlayerId: row.actor_player_id,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id,
        summary: row.summary ?? {},
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString()
      };
      if (row.from_version !== null) entry.fromVersion = row.from_version;
      if (row.to_version !== null) entry.toVersion = row.to_version;
      return entry;
    });
  }
}
