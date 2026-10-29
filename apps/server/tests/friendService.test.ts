import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { FriendService } from "../src/social/FriendService";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl?.endsWith("/web_mmorpg_test") ? describe : describe.skip;

describeDatabase("persistent character friendships", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused/unused");
  const service = new FriendService(pool);
  async function character(nickname: string) {
    const accountId = randomUUID();
    const id = randomUUID();
    await pool.query(`INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash)
      VALUES ($1,$2,$2,'hash','hash')`, [accountId, `account_${id.slice(0, 8)}`]);
    await pool.query(`INSERT INTO characters (id,account_id,nickname,nickname_normalized)
      VALUES ($1,$2,$3,$4)`, [id, accountId, nickname, nickname.toLowerCase()]);
    return { id, accountId, nickname };
  }
  async function manyCharacters(count: number) {
    const result = await pool.query<{ id: string }>(`WITH inserted AS (
      INSERT INTO accounts (id,username,username_normalized,password_hash,recovery_code_hash)
      SELECT gen_random_uuid(), 'seed_' || n, 'seed_' || n, 'hash','hash' FROM generate_series(1,$1) AS n
      RETURNING id, username
    ) INSERT INTO characters (id,account_id,nickname,nickname_normalized)
      SELECT gen_random_uuid(),id,username,username FROM inserted RETURNING id`, [count]);
    return result.rows.map(row => row.id);
  }
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });

  it("finds an exact normalized character nickname, requires consent and persists through reconstruction", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    await service.request(alice.id, " bOb ");
    expect(await service.getSnapshot(alice.id)).toMatchObject({ friends: [], outgoingFriendRequests: [{ id: bob.id, nickname: "Bob", online: false, inBattle: false }] });
    expect((await service.getSnapshot(bob.id)).incomingFriendRequests).toHaveLength(1);
    await service.respond(bob.id, alice.id, true);
    const reloaded = new FriendService(pool);
    expect(await reloaded.getSnapshot(alice.id)).toEqual({ friends: [{ id: bob.id, nickname: "Bob", online: false, inBattle: false, level: 1 }], incomingFriendRequests: [], outgoingFriendRequests: [] });
    expect((await reloaded.getSnapshot(bob.id)).friends[0]?.id).toBe(alice.id);
    await reloaded.remove(bob.id, alice.id);
    expect((await service.getSnapshot(alice.id)).friends).toEqual([]);
  });

  it("cannot accept another recipient's request or accept an outgoing request, and rejection removes only that request", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    const eve = await character("Eve");
    await service.request(alice.id, "Bob");
    await expect(service.respond(eve.id, alice.id, true)).rejects.toThrow("FRIEND_REQUEST_NOT_FOUND");
    await expect(service.respond(alice.id, bob.id, true)).rejects.toThrow("FRIEND_REQUEST_NOT_FOUND");
    await service.respond(bob.id, alice.id, false);
    expect(await service.getSnapshot(alice.id)).toEqual({ friends: [], incomingFriendRequests: [], outgoingFriendRequests: [] });
  });

  it("serializes reciprocal requests into a single friendship after both players consent", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    await Promise.all([service.request(alice.id, "Bob"), service.request(bob.id, "Alice")]);
    expect((await pool.query("SELECT * FROM friendships")).rows).toHaveLength(1);
    expect((await pool.query("SELECT * FROM friend_requests")).rows).toHaveLength(0);
    expect((await service.getSnapshot(alice.id)).friends).toHaveLength(1);
  });

  it("rejects self, duplicate, partial nickname, deleted characters and inactive accounts without leaking account identities", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    const deleted = await character("Deleted");
    const banned = await character("Banned");
    await pool.query("UPDATE characters SET deletion_effective_at = NOW() WHERE id=$1", [deleted.id]);
    await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [banned.accountId]);
    await expect(service.request(alice.id, "Alice")).rejects.toThrow("FRIEND_SELF_REQUEST");
    for (const name of ["Ali", "Deleted", "Banned", `account_${bob.id.slice(0, 8)}`]) {
      await expect(service.request(alice.id, name)).rejects.toThrow("CHARACTER_NOT_FOUND");
    }
    await service.request(alice.id, "Bob");
    await expect(service.request(alice.id, "Bob")).rejects.toThrow("FRIEND_REQUEST_EXISTS");
    const pending = (await service.getSnapshot(alice.id)).outgoingFriendRequests[0]!;
    expect(Object.keys(pending).sort()).toEqual(["id", "inBattle", "level", "nickname", "online"]);
  });

  it("bounds incoming and outgoing pending requests at one hundred without partially inserting a request", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    const seeds = await manyCharacters(100);
    await pool.query("INSERT INTO friend_requests (sender_id,recipient_id) SELECT $1, unnest($2::uuid[])", [alice.id, seeds]);
    await expect(service.request(alice.id, "Bob")).rejects.toThrow("FRIEND_REQUEST_LIMIT_REACHED");
    await pool.query("DELETE FROM friend_requests");
    await pool.query("INSERT INTO friend_requests (sender_id,recipient_id) SELECT unnest($1::uuid[]), $2", [seeds, bob.id]);
    await expect(service.request(alice.id, "Bob")).rejects.toThrow("FRIEND_REQUEST_LIMIT_REACHED");
    expect((await service.getSnapshot(alice.id)).outgoingFriendRequests).toEqual([]);
  });

  it("serializes acceptances competing for the last friendship slot and leaves the rejected request pending", async () => {
    const alice = await character("Alice");
    const bob = await character("Bob");
    const eve = await character("Eve");
    const seeds = await manyCharacters(99);
    await pool.query(`INSERT INTO friendships (character_low,character_high)
      SELECT LEAST($1::uuid,id),GREATEST($1::uuid,id) FROM unnest($2::uuid[]) AS id`, [alice.id, seeds]);
    await service.request(bob.id, "Alice");
    await service.request(eve.id, "Alice");
    const results = await Promise.allSettled([service.respond(alice.id, bob.id, true), service.respond(alice.id, eve.id, true)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toBe("FRIEND_LIMIT_REACHED");
    const snapshot = await service.getSnapshot(alice.id);
    expect(snapshot.friends).toHaveLength(100);
    expect(snapshot.incomingFriendRequests).toHaveLength(1);
  });

  async function makeUnavailable(peer: { id: string; accountId: string }, reason: "banned" | "deletion") {
    if (reason === "banned") await pool.query("UPDATE accounts SET status='banned' WHERE id=$1", [peer.accountId]);
    else await pool.query("UPDATE characters SET deletion_requested_at=NOW(),deletion_effective_at=NOW()+INTERVAL '7 days' WHERE id=$1", [peer.id]);
  }

  it.each(["banned", "deletion"] as const)("keeps an existing %s friend visible as unavailable and removable", async reason => {
    const alice = await character("Alice"), bob = await character("Bob");
    await service.request(alice.id, "Bob");
    await service.respond(bob.id, alice.id, true);
    await makeUnavailable(bob, reason);
    const stalePresence = new FriendService(pool, id => ({ id, nickname: "Bob", online: true, inBattle: true }));
    expect((await stalePresence.getSnapshot(alice.id)).friends).toEqual([
      { id: bob.id, nickname: "Bob", level: 1, online: false, inBattle: false, unavailable: true }
    ]);
    await service.remove(alice.id, bob.id);
    expect((await service.getSnapshot(alice.id)).friends).toEqual([]);
    expect((await pool.query("SELECT * FROM friendships")).rows).toEqual([]);
  });

  it.each(["banned", "deletion"] as const)("keeps an incoming %s request visible and allows declining without accepting it", async reason => {
    const alice = await character("Alice"), bob = await character("Bob");
    await service.request(bob.id, "Alice");
    await makeUnavailable(bob, reason);
    expect((await service.getSnapshot(alice.id)).incomingFriendRequests).toEqual([
      { id: bob.id, nickname: "Bob", level: 1, online: false, inBattle: false, unavailable: true }
    ]);
    await expect(service.respond(alice.id, bob.id, true)).rejects.toThrow("CHARACTER_NOT_FOUND");
    await service.respond(alice.id, bob.id, false);
    expect((await service.getSnapshot(alice.id)).incomingFriendRequests).toEqual([]);
    expect((await pool.query("SELECT * FROM friendships")).rows).toEqual([]);
  });

  it.each(["banned", "deletion"] as const)("keeps an outgoing %s request visible and allows its sender to cancel it", async reason => {
    const alice = await character("Alice"), bob = await character("Bob");
    await service.request(alice.id, "Bob");
    await makeUnavailable(bob, reason);
    expect((await service.getSnapshot(alice.id)).outgoingFriendRequests).toEqual([
      { id: bob.id, nickname: "Bob", level: 1, online: false, inBattle: false, unavailable: true }
    ]);
    await service.remove(alice.id, bob.id);
    expect((await service.getSnapshot(alice.id)).outgoingFriendRequests).toEqual([]);
    expect((await pool.query("SELECT * FROM friend_requests")).rows).toEqual([]);
  });

  it("does not cancel an incoming request through remove and still requires an active actor for cleanup", async () => {
    const alice = await character("Alice"), bob = await character("Bob");
    await service.request(bob.id, "Alice");
    await expect(service.remove(alice.id, bob.id)).rejects.toThrow("FRIENDSHIP_NOT_FOUND");
    expect((await service.getSnapshot(alice.id)).incomingFriendRequests).toHaveLength(1);
    await makeUnavailable(alice, "banned");
    await expect(service.respond(alice.id, bob.id, false)).rejects.toThrow("CHARACTER_NOT_FOUND");
    await expect(service.remove(alice.id, bob.id)).rejects.toThrow("CHARACTER_NOT_FOUND");
    expect((await pool.query("SELECT * FROM friend_requests")).rows).toHaveLength(1);
  });
});
