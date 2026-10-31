import { randomUUID } from "node:crypto";
import type { SocialPlayer } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { TradeService } from "../src/social/TradeService";

function presence() {
  let now = 1_000;
  const players = new Map<string, SocialPlayer>();
  const positions = new Map<string, { locationId: string; x: number; y: number }>();
  for (const id of ["alice", "bob", "eve"]) {
    players.set(id, { id, nickname: id, online: true, inBattle: false });
    positions.set(id, { locationId: "forest", x: 0, y: 0 });
  }
  return { players, positions, now: () => now, advance: (ms: number) => { now += ms; } };
}

describe("trade consent and presence", () => {
  function setup() {
    const state = presence();
    const service = new TradeService({} as Pool, id => state.players.get(id), id => state.positions.get(id), state.now);
    return { ...state, service };
  }

  it("requires recipient consent and keeps each participant in only one invitation", async () => {
    const { service } = setup();
    const invite = await service.request("alice", "bob");
    expect(invite.status).toBe("invited");
    await expect(service.request("eve", "bob")).rejects.toThrow("TRADE_ALREADY_ACTIVE");
    await expect(service.respond("eve", invite.id, true)).rejects.toThrow("TRADE_NOT_FOUND");
    await expect(service.respond("alice", invite.id, true)).rejects.toThrow("TRADE_RECIPIENT_REQUIRED");
    await expect(service.setOffer("alice", invite.id, invite.revision, [])).rejects.toThrow("TRADE_NOT_ACTIVE");
    expect((await service.respond("bob", invite.id, true)).status).toBe("active");
    expect(service.getSnapshot("bob")?.participants.map(entry => entry.player.id)).toEqual(["alice", "bob"]);
  });

  it("expires invitations and active trades, allows rejection, and prevents empty confirmation", async () => {
    const { service, advance } = setup();
    const first = await service.request("alice", "bob");
    advance(60_000);
    expect(service.getSnapshot("alice")).toMatchObject({ status: "cancelled", cancelReason: "TRADE_EXPIRED" });
    await expect(service.respond("bob", first.id, true)).rejects.toThrow("TRADE_NOT_ACTIVE");
    const second = await service.request("alice", "bob");
    expect((await service.respond("bob", second.id, false)).status).toBe("cancelled");
    const third = await service.request("alice", "bob");
    await service.respond("bob", third.id, true);
    await expect(service.confirm("alice", third.id, third.revision)).rejects.toThrow("TRADE_EMPTY");
    advance(180_000);
    expect(service.getSnapshot("bob")?.status).toBe("cancelled");
  });

  it("rejects self, offline, battle, other maps and nonfinite or distant positions", async () => {
    const { service, players, positions } = setup();
    await expect(service.request("alice", "alice")).rejects.toThrow("TRADE_SELF_REQUEST");
    players.get("bob")!.online = false;
    await expect(service.request("alice", "bob")).rejects.toThrow("PLAYER_OFFLINE");
    players.get("bob")!.online = true;
    players.get("bob")!.inBattle = true;
    await expect(service.request("alice", "bob")).rejects.toThrow("TRADE_IN_BATTLE");
    players.get("bob")!.inBattle = false;
    for (const position of [
      { locationId: "cave", x: 0, y: 0 },
      { locationId: "forest", x: 160.01, y: 0 },
      { locationId: "forest", x: Number.NaN, y: 0 }
    ]) {
      positions.set("bob", position);
      await expect(service.request("alice", "bob")).rejects.toThrow("TRADE_TOO_FAR");
    }
    positions.set("bob", { locationId: "forest", x: 160, y: 0 });
    const invite = await service.request("alice", "bob");
    await service.respond("bob", invite.id, true);
    positions.get("bob")!.x = 161;
    await service.checkDistance("bob");
    expect(service.getSnapshot("alice")).toMatchObject({ status: "cancelled", cancelReason: "TRADE_TOO_FAR" });
  });

  it("rejects malformed offers before database work and returns defensive snapshots", async () => {
    const { service } = setup();
    const invite = await service.request("alice", "bob");
    await service.respond("bob", invite.id, true);
    const id = randomUUID();
    for (const offer of [
      [{ instanceId: "bad", quantity: 1 }],
      [{ instanceId: id, quantity: 0 }],
      [{ instanceId: id, quantity: 1.5 }],
      [{ instanceId: id, quantity: 1 }, { instanceId: id.toUpperCase(), quantity: 1 }],
      Array.from({ length: 9 }, () => ({ instanceId: randomUUID(), quantity: 1 }))
    ]) await expect(service.setOffer("alice", invite.id, 0, offer)).rejects.toThrow("TRADE_INVALID_OFFER");
    const snapshot = service.getSnapshot("alice")!;
    snapshot.participants[0].player.nickname = "forged";
    snapshot.participants[0].confirmed = true;
    expect(service.getSnapshot("alice")?.participants[0]).toMatchObject({ player: { nickname: "alice" }, confirmed: false });
  });
});

const databaseUrl = process.env.DATABASE_URL;
const testDatabase = databaseUrl && ["/web_mmorpg_test", "/web_mmorpg_slot_order_tests"].includes(new URL(databaseUrl).pathname);
const describeDatabase = testDatabase ? describe : describe.skip;

describeDatabase("atomic item barter", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused/unused");
  let service: TradeService;
  let players: Map<string, SocialPlayer>;
  let positions: Map<string, { locationId: string; x: number; y: number }>;
  let alice: string;
  let bob: string;
  let eve: string;
  let stackDefinition: string;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await pool.query("INSERT INTO item_categories (id,name) VALUES ('trade-test','Trade test')");
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE accounts, item_instances, items, trade_receipts CASCADE");
    players = new Map();
    positions = new Map();
    const ids = await Promise.all(["Alice", "Bob", "Eve"].map(async nickname => {
      const id = randomUUID();
      const account = randomUUID();
      await pool.query(`INSERT INTO accounts (id,username,username_normalized,password_hash,recovery_code_hash)
        VALUES ($1,$2,$2,'hash','hash')`, [account, nickname.toLowerCase()]);
      await pool.query(`INSERT INTO characters (id,account_id,nickname,nickname_normalized)
        VALUES ($1,$2,$3,$4)`, [id, account, nickname, nickname.toLowerCase()]);
      players.set(id, { id, nickname, online: true, inBattle: false });
      positions.set(id, { locationId: "forest", x: 0, y: 0 });
      return id;
    }));
    [alice, bob, eve] = [ids[0]!, ids[1]!, ids[2]!];
    service = new TradeService(pool, id => players.get(id), id => positions.get(id));
    stackDefinition = await definition();
  });
  afterAll(async () => { await pool.end(); });

  async function definition(overrides: { stackable?: boolean; unique?: boolean; tradable?: boolean; soulbound?: string } = {}) {
    const id = randomUUID();
    await pool.query("INSERT INTO items (id,item_id,status,active_version_no) VALUES ($1,$2,'PUBLISHED',1)", [id, `trade-${id}`]);
    await pool.query(`INSERT INTO item_versions
      (id,item_id,version_no,state,name,category_id,rarity,stackable,max_stack,unique_item,tradable,soulbound,created_by)
      VALUES ($1,$2,1,'PUBLISHED','Trade item','trade-test','COMMON',$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), id, overrides.stackable ?? true, overrides.stackable === false ? 1 : 99,
      overrides.unique ?? false, overrides.tradable ?? true, overrides.soulbound ?? "NONE", alice]);
    return id;
  }
  async function item(owner: string, quantity = 1, itemDefinition = stackDefinition) {
    const id = randomUUID();
    await pool.query(`INSERT INTO item_instances
      (id,character_id,item_id,quantity,durability,max_durability,upgrade_level,affixes,sockets,container_capacity,created_at)
      VALUES ($1,$2,$3,$4,7,11,3,'[{"code":"STR","value":4}]','[{"gem":"ruby"}]',8,'2025-01-02T03:04:05Z')`,
    [id, owner, itemDefinition, quantity]);
    return id;
  }
  async function active() {
    const trade = await service.request(alice, bob);
    return service.respond(bob, trade.id, true);
  }
  async function offerPair(first: string, second?: string, quantity = 1) {
    let trade = await active();
    trade = await service.setOffer(alice, trade.id, trade.revision, [{ instanceId: first, quantity }]);
    if (second) trade = await service.setOffer(bob, trade.id, trade.revision, [{ instanceId: second, quantity: 1 }]);
    return trade;
  }
  async function inventoryRows() {
    return (await pool.query("SELECT * FROM item_instances ORDER BY id")).rows;
  }

  it("transfers both directions atomically, preserves whole IDs and every customization on split stacks, and ignores replay", async () => {
    const stack = await item(alice, 10);
    const whole = await item(bob, 1, await definition({ stackable: false }));
    const before = (await pool.query("SELECT * FROM item_instances WHERE id=$1", [stack])).rows[0];
    const trade = await offerPair(stack, whole, 4);
    await service.confirm(alice, trade.id, trade.revision);
    const completed = await service.confirm(bob, trade.id, trade.revision);
    expect(completed.status).toBe("completed");
    const rows = await inventoryRows();
    expect(rows.find(row => row.id === whole)).toMatchObject({ character_id: alice, quantity: 1 });
    expect(rows.find(row => row.id === stack)).toMatchObject({ character_id: alice, quantity: 6 });
    const recipientBackpack=rows.find(row=>row.character_id===bob&&row.permanent_container)!;
    const clone = rows.find(row => row.character_id === bob && !row.permanent_container && row.item_id===before.item_id)!;
    expect(recipientBackpack).toMatchObject({container_slot:0,container_capacity:16});
    expect(clone).toMatchObject({ ...before, id: expect.any(String), player_id: null, character_id: bob, quantity: 4,container_instance_id:recipientBackpack.id,container_position:0, updated_at: expect.any(Date) });
    expect(clone.id).not.toBe(stack);
    await Promise.all([service.confirm(alice, trade.id, trade.revision), service.confirm(bob, trade.id, trade.revision)]);
    expect(await inventoryRows()).toEqual(rows);
    expect((await pool.query("SELECT * FROM trade_receipts WHERE trade_id=$1", [trade.id])).rows).toHaveLength(1);
  });

  it("resets both confirmations when either offer changes and rejects stale revisions", async () => {
    const stack = await item(alice, 10);
    let trade = await offerPair(stack);
    await service.confirm(alice, trade.id, trade.revision);
    const previousRevision = trade.revision;
    trade = await service.setOffer(alice, trade.id, trade.revision, [{ instanceId: stack, quantity: 2 }]);
    expect(trade.revision).toBe(previousRevision + 1);
    expect(trade.participants.map(participant => participant.confirmed)).toEqual([false, false]);
    await expect(service.confirm(bob, trade.id, previousRevision)).rejects.toThrow("TRADE_STALE_REVISION");
    await expect(service.setOffer(alice, trade.id, previousRevision, [])).rejects.toThrow("TRADE_STALE_REVISION");
    await service.confirm(bob, trade.id, trade.revision);
    expect(service.getSnapshot(alice)?.status).toBe("active");
  });

  it.each(["foreign", "bound", "soulbound", "equipped", "stored", "nonempty", "untradable", "unpublished", "unique", "quantity", "nonstackable"])(
    "rejects %s items without changing either inventory or the offer", async kind => {
      const source = await item(alice, 5);
      if (kind === "foreign") await pool.query("UPDATE item_instances SET character_id=$1 WHERE id=$2", [eve, source]);
      if (kind === "bound") await pool.query("UPDATE item_instances SET bound_to_player_id=$1 WHERE id=$2", [alice, source]);
      if (kind === "soulbound") await pool.query("UPDATE item_versions SET soulbound='ON_EQUIP' WHERE item_id=$1", [stackDefinition]);
      if (kind === "equipped") await pool.query("UPDATE item_instances SET container_slot=1 WHERE id=$1", [source]);
      if (kind === "stored") await pool.query("UPDATE item_instances SET container_instance_id=$1 WHERE id=$2", [await item(alice), source]);
      if (kind === "nonempty") await pool.query("UPDATE item_instances SET container_instance_id=$1 WHERE id=$2", [source, await item(alice)]);
      if (kind === "untradable") await pool.query("UPDATE item_versions SET tradable=false WHERE item_id=$1", [stackDefinition]);
      if (kind === "unpublished") await pool.query("UPDATE items SET status='ARCHIVED' WHERE id=$1", [stackDefinition]);
      if (kind === "unique") {
        await pool.query("UPDATE item_versions SET unique_item=true WHERE item_id=$1", [stackDefinition]);
        await item(bob);
      }
      if (kind === "nonstackable") await pool.query("UPDATE item_versions SET stackable=false,max_stack=1 WHERE item_id=$1", [stackDefinition]);
      const before = await inventoryRows();
      const trade = await active();
      await expect(service.setOffer(alice, trade.id, trade.revision, [{ instanceId: source, quantity: kind === "quantity" ? 6 : 1 }])).rejects.toThrow();
      expect(await inventoryRows()).toEqual(before);
      expect(service.getSnapshot(alice)?.participants[0].offer).toEqual([]);
    }
  );

  it("revalidates the active published definition on final confirmation and resets consent on failure", async () => {
    const first = await item(alice, 5);
    const second = await item(bob, 2);
    const trade = await offerPair(first, second, 2);
    const before = await inventoryRows();
    await service.confirm(alice, trade.id, trade.revision);
    await pool.query(`INSERT INTO item_versions
      (id,item_id,version_no,state,name,category_id,rarity,stackable,max_stack,tradable,created_by)
      VALUES ($1,$2,2,'PUBLISHED','New untradable version','trade-test','COMMON',true,99,false,$3)`,
    [randomUUID(), stackDefinition, alice]);
    await pool.query("UPDATE items SET active_version_no=2 WHERE id=$1", [stackDefinition]);
    await expect(service.confirm(bob, trade.id, trade.revision)).rejects.toThrow("TRADE_ITEM_NOT_TRADABLE");
    expect(await inventoryRows()).toEqual(before);
    expect(service.getSnapshot(alice)?.participants.map(participant => participant.confirmed)).toEqual([false, false]);
    expect((await pool.query("SELECT * FROM trade_receipts")).rows).toEqual([]);
  });

  it("cancels and clears existing consent when the final confirmer is already out of range", async () => {
    const source = await item(alice, 3);
    const trade = await offerPair(source);
    await service.confirm(alice, trade.id, trade.revision);
    positions.get(bob)!.x = 161;
    await expect(service.confirm(bob, trade.id, trade.revision)).rejects.toThrow("TRADE_TOO_FAR");
    expect(service.getSnapshot(alice)).toMatchObject({ status: "cancelled", cancelReason: "TRADE_TOO_FAR" });
    expect(service.getSnapshot(alice)?.participants.map(participant => participant.confirmed)).toEqual([false, false]);
    expect((await pool.query("SELECT character_id,quantity FROM item_instances WHERE id=$1", [source])).rows)
      .toEqual([{ character_id: alice, quantity: 3 }]);
  });

  it("rolls back an earlier transfer when the opposite direction fails", async () => {
    const first = await item(alice, 5);
    const second = await item(bob, 1, await definition({ stackable: false }));
    const trade = await offerPair(first, second, 2);
    const before = await inventoryRows();
    await pool.query(`CREATE FUNCTION reject_trade_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.id='${second}'::uuid AND NEW.character_id='${alice}'::uuid THEN
        RAISE EXCEPTION 'injected transfer failure'; END IF; RETURN NEW; END $$`);
    await pool.query("CREATE TRIGGER reject_trade_transfer BEFORE UPDATE ON item_instances FOR EACH ROW EXECUTE FUNCTION reject_trade_transfer()");
    try {
      await service.confirm(alice, trade.id, trade.revision);
      await expect(service.confirm(bob, trade.id, trade.revision)).rejects.toThrow("injected transfer failure");
      expect(await inventoryRows()).toEqual(before);
      expect((await pool.query("SELECT * FROM trade_receipts")).rows).toEqual([]);
    } finally {
      await pool.query("DROP TRIGGER reject_trade_transfer ON item_instances; DROP FUNCTION reject_trade_transfer()");
    }
  });

  it("serializes concurrent confirmations, blocks edits and cancellation during finalization, and commits only once", async () => {
    const source = await item(alice, 10);
    const trade = await offerPair(source, undefined, 2);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM characters WHERE id=$1 FOR UPDATE", [alice]);
    try {
      const first = service.confirm(alice, trade.id, trade.revision);
      const final = service.confirm(bob, trade.id, trade.revision);
      expect(service.isBusy(alice)).toBe(true);
      await expect(service.cancel(alice, trade.id)).rejects.toThrow("TRADE_BUSY");
      await expect(service.setOffer(alice, trade.id, trade.revision, [])).rejects.toThrow("TRADE_BUSY");
      await expect(service.confirm(alice, trade.id, trade.revision)).rejects.toThrow("TRADE_BUSY");
      await blocker.query("COMMIT");
      await Promise.all([first, final, service.waitForPending(alice)]);
      expect(service.getSnapshot(alice)?.status).toBe("completed");
      expect((await pool.query("SELECT quantity FROM item_instances WHERE character_id=$1 AND NOT permanent_container", [bob])).rows).toEqual([{ quantity: 2 }]);
      expect((await pool.query("SELECT COUNT(*)::int AS count FROM item_instances WHERE character_id=$1 AND permanent_container",[bob])).rows[0].count).toBe(1);
      expect((await pool.query("SELECT * FROM trade_receipts")).rows).toHaveLength(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });

  it.each(["disconnect", "distance", "battle"])("aborts before commit after %s during a pending finalization", async kind => {
    const source = await item(alice, 10);
    const trade = await offerPair(source, undefined, 2);
    const before = await inventoryRows();
    await service.confirm(alice, trade.id, trade.revision);
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM characters WHERE id=$1 FOR UPDATE", [alice]);
    try {
      const final = service.confirm(bob, trade.id, trade.revision);
      const failure = expect(final).rejects.toThrow();
      let disconnected: Promise<void> | undefined;
      if (kind === "disconnect") disconnected = service.removeDisconnected(alice);
      if (kind === "distance") positions.get(alice)!.x = 161;
      if (kind === "battle") players.get(alice)!.inBattle = true;
      await blocker.query("COMMIT");
      await failure;
      await disconnected;
      expect(await inventoryRows()).toEqual(before);
      expect((await pool.query("SELECT * FROM trade_receipts")).rows).toEqual([]);
      expect(service.getSnapshot(bob)?.status).toBe("cancelled");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
});
