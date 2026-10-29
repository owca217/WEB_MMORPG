import type { SocialPlayer } from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";

export interface FriendSnapshot {
  friends: SocialPlayer[];
  incomingFriendRequests: SocialPlayer[];
  outgoingFriendRequests: SocialPlayer[];
}

const MAX_FRIENDS = 100;
const MAX_PENDING_REQUESTS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_CHARACTER = "c.deletion_requested_at IS NULL AND c.deletion_effective_at IS NULL AND a.status = 'active'";

export class FriendService {
  constructor(
    private readonly pool: Pool,
    private readonly getPlayer?: (id: string) => SocialPlayer | undefined
  ) {}

  async request(actorId: string, nickname: string): Promise<void> {
    this.validateId(actorId);
    if (typeof nickname !== "string" || nickname.trim().length < 3 || nickname.trim().length > 20) {
      throw new Error("INVALID_NICKNAME");
    }
    const target = await this.pool.query<{ id: string }>(
      `SELECT c.id FROM characters c JOIN accounts a ON a.id=c.account_id
       WHERE c.nickname_normalized=$1 AND ${ACTIVE_CHARACTER}`,
      [nickname.trim().toLowerCase()]
    );
    const otherId = target.rows[0]?.id;
    if (!otherId) throw new Error("CHARACTER_NOT_FOUND");
    if (actorId === otherId) throw new Error("FRIEND_SELF_REQUEST");
    await this.withPair(actorId, otherId, async client => {
      const [low, high] = [actorId, otherId].sort();
      const friendship = await client.query(
        "SELECT 1 FROM friendships WHERE character_low=$1 AND character_high=$2", [low, high]
      );
      if (friendship.rowCount) throw new Error("ALREADY_FRIENDS");
      const pending = await client.query<{ sender_id: string }>(
        `SELECT sender_id FROM friend_requests
         WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)`,
        [actorId, otherId]
      );
      if (pending.rows.some(row => row.sender_id === actorId)) throw new Error("FRIEND_REQUEST_EXISTS");
      if (pending.rows.some(row => row.sender_id === otherId)) {
        await this.accept(client, actorId, otherId);
        return;
      }
      const counts = await client.query<{ pending_count: string }>(
        `SELECT (SELECT COUNT(*) FROM friend_requests r WHERE r.sender_id=c.id OR r.recipient_id=c.id) AS pending_count
         FROM characters c WHERE c.id=ANY($1::uuid[])`, [[actorId, otherId]]
      );
      if (counts.rows.some(row => Number(row.pending_count) >= MAX_PENDING_REQUESTS)) {
        throw new Error("FRIEND_REQUEST_LIMIT_REACHED");
      }
      await client.query("INSERT INTO friend_requests (sender_id,recipient_id) VALUES ($1,$2)", [actorId, otherId]);
    });
  }

  async respond(actorId: string, otherId: string, accept: boolean): Promise<void> {
    await this.withPair(actorId, otherId, async client => {
      const request = await client.query(
        "SELECT 1 FROM friend_requests WHERE sender_id=$1 AND recipient_id=$2", [otherId, actorId]
      );
      if (!request.rowCount) throw new Error("FRIEND_REQUEST_NOT_FOUND");
      if (accept) await this.accept(client, actorId, otherId);
      else await client.query("DELETE FROM friend_requests WHERE sender_id=$1 AND recipient_id=$2", [otherId, actorId]);
    }, !accept);
  }

  async remove(actorId: string, otherId: string): Promise<void> {
    await this.withPair(actorId, otherId, async client => {
      const [low, high] = [actorId, otherId].sort();
      const deleted = await client.query(
        "DELETE FROM friendships WHERE character_low=$1 AND character_high=$2", [low, high]
      );
      const cancelled = await client.query(
        "DELETE FROM friend_requests WHERE sender_id=$1 AND recipient_id=$2", [actorId, otherId]
      );
      if (!deleted.rowCount && !cancelled.rowCount) throw new Error("FRIENDSHIP_NOT_FOUND");
    }, true);
  }

  async getSnapshot(actorId: string): Promise<FriendSnapshot> {
    this.validateId(actorId);
    const result = await this.pool.query<{ kind: keyof FriendSnapshot; id: string; nickname: string; level: number; active: boolean }>(
      `WITH links AS (
         SELECT CASE WHEN character_low=$1 THEN character_high ELSE character_low END AS id, 'friends' AS kind
         FROM friendships WHERE character_low=$1 OR character_high=$1
         UNION ALL SELECT sender_id,'incomingFriendRequests' FROM friend_requests WHERE recipient_id=$1
         UNION ALL SELECT recipient_id,'outgoingFriendRequests' FROM friend_requests WHERE sender_id=$1
       ) SELECT links.kind,c.id,c.nickname,c.level,(${ACTIVE_CHARACTER}) AS active FROM links
       JOIN characters c ON c.id=links.id JOIN accounts a ON a.id=c.account_id
       ORDER BY c.nickname_normalized,c.id`, [actorId]
    );
    const snapshot: FriendSnapshot = { friends: [], incomingFriendRequests: [], outgoingFriendRequests: [] };
    for (const row of result.rows) {
      const presence = row.active ? this.getPlayer?.(row.id) : undefined;
      snapshot[row.kind].push({
        id: row.id, nickname: row.nickname, level: presence?.level ?? row.level,
        online: presence?.online ?? false, inBattle: presence?.inBattle ?? false,
        ...(!row.active ? { unavailable: true } : {})
      });
    }
    return snapshot;
  }

  private async accept(client: PoolClient, actorId: string, otherId: string): Promise<void> {
    const counts = await client.query<{ friend_count: string }>(
      `SELECT (SELECT COUNT(*) FROM friendships f WHERE f.character_low=c.id OR f.character_high=c.id) AS friend_count
       FROM characters c WHERE c.id=ANY($1::uuid[])`, [[actorId, otherId]]
    );
    if (counts.rows.some(row => Number(row.friend_count) >= MAX_FRIENDS)) throw new Error("FRIEND_LIMIT_REACHED");
    const [low, high] = [actorId, otherId].sort();
    await client.query("INSERT INTO friendships (character_low,character_high) VALUES ($1,$2)", [low, high]);
    await client.query(
      `DELETE FROM friend_requests WHERE (sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)`,
      [actorId, otherId]
    );
  }

  private async withPair(
    actorId: string,
    otherId: string,
    operation: (client: PoolClient) => Promise<void>,
    allowInactivePeer = false
  ): Promise<void> {
    this.validateId(actorId);
    this.validateId(otherId);
    if (actorId === otherId) throw new Error("FRIEND_SELF_REQUEST");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Every relationship mutation locks both characters in UUID order, including count checks.
      const characters = await client.query<{ id: string; active: boolean }>(
        `SELECT c.id,(${ACTIVE_CHARACTER}) AS active FROM characters c JOIN accounts a ON a.id=c.account_id
         WHERE c.id=ANY($1::uuid[]) ORDER BY c.id FOR UPDATE OF c`,
        [[actorId, otherId]]
      );
      if (characters.rows.length !== 2 || characters.rows.some(row => !row.active && (row.id === actorId || !allowInactivePeer))) {
        throw new Error("CHARACTER_NOT_FOUND");
      }
      await operation(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private validateId(id: string): void {
    if (typeof id !== "string" || !UUID.test(id)) throw new Error("CHARACTER_NOT_FOUND");
  }
}
