import { randomUUID } from "node:crypto";
import type { SocialPlayer, TradeOfferEntry, TradeOfferItem, TradeSnapshot } from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { autoStoreOwnedItems, getStorageDestinations } from "../inventory/autoStorage";
import { ensurePermanentBackpack } from "../inventory/permanentBackpack";

interface Position { locationId: string; x: number; y: number; }
interface Trade {
  id: string;
  participants: [SocialPlayer, SocialPlayer];
  offers: [TradeOfferItem[], TradeOfferItem[]];
  confirmed: [boolean, boolean];
  revision: number;
  status: TradeSnapshot["status"];
  expiresAt: number;
  cancelReason?: string;
  abortReason?: string;
  pending?: Promise<unknown>;
}
interface OfferedInstance {
  id: string;
  permanent_container: boolean;
  character_id: string | null;
  item_id: string;
  quantity: number;
  bound_to_player_id: string | null;
  container_instance_id: string | null;
  container_slot: number | null;
  equipment_slot: string | null;
  name: string;
  quality: NonNullable<TradeOfferItem["quality"]>;
  tradable: boolean;
  soulbound: string;
  unique_item: boolean;
  stackable: boolean;
  max_stack: number;
  has_children: boolean;
}

const INVITE_DURATION_MS = 60_000;
const ACTIVE_DURATION_MS = 180_000;
const TRADE_DISTANCE = 160;
const MAX_OFFER_INSTANCES = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Consent is ephemeral; the receipt and both inventory movements commit together. */
export class TradeService {
  // At most one reference per player; disconnect removes that player's reference.
  private readonly byPlayer = new Map<string, Trade>();

  constructor(
    private readonly pool: Pool,
    private readonly getPlayer: (id: string) => SocialPlayer | undefined,
    private readonly getPosition: (id: string) => Position | undefined,
    private readonly now: () => number = Date.now
  ) {}

  async request(actorId: string, otherId: string): Promise<TradeSnapshot> {
    if (actorId === otherId) throw new Error("TRADE_SELF_REQUEST");
    for (const id of [actorId, otherId]) {
      const previous = this.byPlayer.get(id);
      if (previous) {
        this.expire(previous);
        if (previous.pending || this.isOpen(previous)) throw new Error("TRADE_ALREADY_ACTIVE");
      }
    }
    const participants: [SocialPlayer, SocialPlayer] = [this.requirePlayer(actorId), this.requirePlayer(otherId)];
    const trade: Trade = {
      id: randomUUID(), participants: participants.map(player => ({ ...player })) as [SocialPlayer, SocialPlayer],
      offers: [[], []], confirmed: [false, false], revision: 0, status: "invited",
      expiresAt: this.now() + INVITE_DURATION_MS
    };
    this.assertEligible(trade);
    this.byPlayer.set(actorId, trade);
    this.byPlayer.set(otherId, trade);
    return this.snapshot(trade);
  }

  async respond(actorId: string, tradeId: string, accept: boolean): Promise<TradeSnapshot> {
    const trade = this.requireTrade(actorId, tradeId);
    this.assertNotPending(trade);
    if (trade.status !== "invited") throw new Error("TRADE_NOT_ACTIVE");
    if (trade.participants[1].id !== actorId) throw new Error("TRADE_RECIPIENT_REQUIRED");
    if (!accept) this.cancelTrade(trade, "TRADE_REJECTED");
    else {
      this.assertEligibleOrCancel(trade);
      trade.status = "active";
      trade.expiresAt = this.now() + ACTIVE_DURATION_MS;
    }
    return this.snapshot(trade);
  }

  async setOffer(actorId: string, tradeId: string, revision: number, entries: TradeOfferEntry[]): Promise<TradeSnapshot> {
    const trade = this.requireActive(actorId, tradeId, revision);
    const entriesToValidate = this.normalizeOffer(entries);
    this.assertEligibleOrCancel(trade);
    const index = this.participantIndex(trade, actorId);
    return this.runPending(trade, async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.lockCharacters(client, trade);
        const offers: [TradeOfferEntry[], TradeOfferEntry[]] = [trade.offers[0], trade.offers[1]];
        offers[index] = entriesToValidate;
        const instances = await this.validateOffers(client, trade, offers);
        const nextOffer = entriesToValidate.map(entry => {
          const instance=instances.get(entry.instanceId)!;
          return { ...entry, name:instance.name, quality:instance.quality };
        });
        this.assertEligible(trade);
        this.assertNotExpired(trade);
        await client.query("COMMIT");
        if (!this.sameOffer(trade.offers[index], nextOffer)) {
          trade.offers[index] = nextOffer;
          trade.revision += 1;
          trade.confirmed = [false, false];
        }
        return this.snapshot(trade);
      } catch (error) {
        await client.query("ROLLBACK");
        this.cancelIfUnavailable(trade);
        throw error;
      } finally { client.release(); }
    });
  }

  async confirm(actorId: string, tradeId: string, revision: number): Promise<TradeSnapshot> {
    const trade = this.requireTrade(actorId, tradeId);
    this.assertNotPending(trade);
    // An acknowledged completion is safe to replay without touching persistence.
    if (trade.status === "completed") return this.snapshot(trade);
    this.assertActiveRevision(trade, revision);
    this.assertEligibleOrCancel(trade);
    if (!trade.offers[0].length && !trade.offers[1].length) throw new Error("TRADE_EMPTY");
    trade.confirmed[this.participantIndex(trade, actorId)] = true;
    if (!trade.confirmed.every(Boolean)) return this.snapshot(trade);
    return this.runPending(trade, async () => {
      try {
        await this.finalize(trade);
        trade.status = "completed";
        return this.snapshot(trade);
      } catch (error) {
        trade.confirmed = [false, false];
        this.cancelIfUnavailable(trade);
        throw error;
      }
    });
  }

  async cancel(actorId: string, tradeId: string): Promise<TradeSnapshot> {
    const trade = this.requireTrade(actorId, tradeId);
    this.assertNotPending(trade);
    if (this.isOpen(trade)) this.cancelTrade(trade, "TRADE_CANCELLED");
    return this.snapshot(trade);
  }

  getSnapshot(actorId: string): TradeSnapshot | null {
    const trade = this.byPlayer.get(actorId);
    if (!trade) return null;
    this.expire(trade);
    return this.snapshot(trade);
  }

  isBusy(actorId: string): boolean { return !!this.byPlayer.get(actorId)?.pending; }

  async waitForPending(actorId: string): Promise<void> {
    await this.byPlayer.get(actorId)?.pending?.catch(() => undefined);
  }

  async removeDisconnected(actorId: string): Promise<void> {
    const trade = this.byPlayer.get(actorId);
    if (!trade) return;
    if (this.isOpen(trade)) trade.abortReason = "PLAYER_OFFLINE";
    await trade.pending?.catch(() => undefined);
    if (this.isOpen(trade)) this.cancelTrade(trade, "PLAYER_OFFLINE");
    if (this.byPlayer.get(actorId) === trade) this.byPlayer.delete(actorId);
  }

  async checkDistance(actorId: string): Promise<void> {
    const trade = this.byPlayer.get(actorId);
    if (!trade || !this.isOpen(trade)) return;
    try { this.assertEligible(trade); }
    catch (error) {
      const reason = error instanceof Error ? error.message : "TRADE_CANCELLED";
      if (trade.pending) trade.abortReason = reason;
      else this.cancelTrade(trade, reason);
    }
    this.expire(trade);
  }

  private async finalize(trade: Trade): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockCharacters(client, trade);
      this.assertEligible(trade);
      this.assertNotExpired(trade);
      const receipt = await client.query<{ participant_a: string; participant_b: string }>(
        "SELECT participant_a, participant_b FROM trade_receipts WHERE trade_id=$1", [trade.id]
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].participant_a !== trade.participants[0].id || receipt.rows[0].participant_b !== trade.participants[1].id) {
          throw new Error("TRADE_RECEIPT_CONFLICT");
        }
        this.assertEligible(trade);
        await client.query("COMMIT");
        return;
      }
      for(const id of trade.participants.map(player=>player.id).sort())await ensurePermanentBackpack(client,id);
      const instances = await this.validateOffers(client, trade, trade.offers);
      const receiptInserted = await client.query(
        `INSERT INTO trade_receipts (trade_id,participant_a,participant_b,offers)
         VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (trade_id) DO NOTHING RETURNING trade_id`,
        [trade.id, trade.participants[0].id, trade.participants[1].id, JSON.stringify(trade.participants.map((player, index) => ({
          playerId: player.id, items: trade.offers[index]!.map(({ instanceId, quantity }) => ({ instanceId, quantity }))
        })))]
      );
      if (!receiptInserted.rowCount) throw new Error("TRADE_RECEIPT_CONFLICT");
      for (const index of [0, 1] as const) {
        const recipientId = trade.participants[index === 0 ? 1 : 0].id;
        for (const offer of trade.offers[index]) {
          const instance = instances.get(offer.instanceId)!;
          if (offer.quantity === instance.quantity) {
            await client.query(
              "UPDATE item_instances SET character_id=$2, player_id=NULL,container_instance_id=NULL,container_position=NULL, updated_at=NOW() WHERE id=$1",
              [instance.id, recipientId]
            );
          } else {
            await client.query("UPDATE item_instances SET quantity=quantity-$2, updated_at=NOW() WHERE id=$1", [instance.id, offer.quantity]);
            // Copy every persisted instance attribute, including creation time and custom rolls.
            await client.query(
              `INSERT INTO item_instances (id,player_id,item_id,quantity,durability,max_durability,upgrade_level,
                affixes,sockets,bound_to_player_id,created_at,updated_at,character_id,container_capacity,container_instance_id,container_slot,quality)
               SELECT $2,NULL,item_id,$3,durability,max_durability,upgrade_level,affixes,sockets,bound_to_player_id,
                created_at,NOW(),$4,container_capacity,NULL,NULL,quality
               FROM item_instances WHERE id=$1`,
              [instance.id, randomUUID(), offer.quantity, recipientId]
            );
          }
        }
      }
      for(const id of trade.participants.map(player=>player.id).sort())await autoStoreOwnedItems(client,id);
      // No asynchronous work may occur between this lifecycle check and issuing COMMIT.
      this.assertEligible(trade);
      this.assertNotExpired(trade);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async lockCharacters(client: PoolClient, trade: Trade): Promise<void> {
    const characters = await client.query(
      "SELECT id FROM characters WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [trade.participants.map(player => player.id).sort()]
    );
    if (characters.rowCount !== 2) throw new Error("CHARACTER_NOT_FOUND");
  }

  private async validateOffers(client: PoolClient, trade: Trade, offers: [TradeOfferEntry[], TradeOfferEntry[]]): Promise<Map<string, OfferedInstance>> {
    const ids = offers.flat().map(offer => offer.instanceId);
    if (!ids.length) return new Map();
    const result = await client.query<OfferedInstance>(
      `SELECT instance.id,instance.character_id,instance.item_id,instance.quantity,instance.bound_to_player_id,
        instance.container_instance_id,instance.container_slot,instance.equipment_slot,instance.quality,instance.permanent_container,version.name,version.tradable,version.soulbound,
        version.unique_item,version.stackable,version.max_stack,
        EXISTS(SELECT 1 FROM item_instances child WHERE child.container_instance_id=instance.id) AS has_children
       FROM item_instances instance JOIN items item ON item.id=instance.item_id
       JOIN item_versions version ON version.item_id=item.id AND version.version_no=item.active_version_no
         AND version.state='PUBLISHED'
       WHERE instance.id=ANY($1::uuid[]) AND item.status='PUBLISHED'
       ORDER BY instance.id FOR UPDATE OF instance FOR SHARE OF item,version`, [ids]
    );
    const instances = new Map(result.rows.map(row => [row.id, row]));
    const uniqueIncoming = new Set<string>();
    const uniqueChecks: { recipient: string; itemId: string }[] = [];
    for (const index of [0, 1] as const) {
      const ownerId = trade.participants[index].id;
      const recipient = trade.participants[index === 0 ? 1 : 0].id;
      for (const offer of offers[index]) {
        const row = instances.get(offer.instanceId);
        if (!row || row.character_id !== ownerId) throw new Error("TRADE_ITEM_NOT_OWNED");
        if(row.permanent_container)throw new Error("TRADE_PERMANENT_BACKPACK");
        if(row.equipment_slot!==null)throw new Error("TRADE_ITEM_EQUIPPED");
        if (!row.tradable || row.soulbound !== "NONE" || row.bound_to_player_id) throw new Error("TRADE_ITEM_NOT_TRADABLE");
        if(row.container_slot!==null)throw new Error("TRADE_ITEM_NOT_TOP_LEVEL");
        if(row.container_instance_id!==null && !(await getStorageDestinations(client,ownerId)).some(parent=>parent.id===row.container_instance_id))throw new Error("TRADE_ITEM_NOT_TOP_LEVEL");
        if (row.has_children) throw new Error("TRADE_CONTAINER_NOT_EMPTY");
        if (offer.quantity > row.quantity || row.quantity > row.max_stack || (!row.stackable && row.quantity !== 1)) {
          throw new Error("TRADE_INVALID_QUANTITY");
        }
        if (row.unique_item) {
          const key = `${recipient}:${row.item_id}`;
          if (row.quantity !== 1 || uniqueIncoming.has(key)) throw new Error("TRADE_UNIQUE_ITEM_EXISTS");
          uniqueIncoming.add(key);
          uniqueChecks.push({ recipient, itemId: row.item_id });
        }
      }
    }
    for (const { recipient, itemId } of uniqueChecks) {
      const duplicate = await client.query(
        "SELECT id FROM item_instances WHERE character_id=$1 AND item_id=$2 LIMIT 1 FOR UPDATE", [recipient, itemId]
      );
      if (duplicate.rowCount) throw new Error("TRADE_UNIQUE_ITEM_EXISTS");
    }
    return instances;
  }

  private normalizeOffer(entries: TradeOfferEntry[]): TradeOfferEntry[] {
    if (!Array.isArray(entries) || entries.length > MAX_OFFER_INSTANCES) throw new Error("TRADE_INVALID_OFFER");
    const ids = new Set<string>();
    return entries.map(entry => {
      if (!entry || typeof entry.instanceId !== "string" || !UUID.test(entry.instanceId) ||
          !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 2_147_483_647) {
        throw new Error("TRADE_INVALID_OFFER");
      }
      const instanceId = entry.instanceId.toLowerCase();
      if (ids.has(instanceId)) throw new Error("TRADE_INVALID_OFFER");
      ids.add(instanceId);
      return { instanceId, quantity: entry.quantity };
    }).sort((first, second) => first.instanceId.localeCompare(second.instanceId));
  }

  private sameOffer(first: TradeOfferEntry[], second: TradeOfferEntry[]): boolean {
    return first.length === second.length && first.every((entry, index) =>
      entry.instanceId === second[index]!.instanceId && entry.quantity === second[index]!.quantity);
  }

  private async runPending<T>(trade: Trade, operation: () => Promise<T>): Promise<T> {
    const pending = operation();
    trade.pending = pending;
    try { return await pending; }
    finally { if (trade.pending === pending) delete trade.pending; }
  }

  private requireTrade(actorId: string, tradeId: string): Trade {
    const trade = this.byPlayer.get(actorId);
    if (!trade || trade.id !== tradeId) throw new Error("TRADE_NOT_FOUND");
    this.expire(trade);
    return trade;
  }

  private requireActive(actorId: string, tradeId: string, revision: number): Trade {
    const trade = this.requireTrade(actorId, tradeId);
    this.assertNotPending(trade);
    this.assertActiveRevision(trade, revision);
    return trade;
  }

  private assertActiveRevision(trade: Trade, revision: number): void {
    if (trade.status !== "active") throw new Error("TRADE_NOT_ACTIVE");
    if (revision !== trade.revision) throw new Error("TRADE_STALE_REVISION");
  }

  private assertNotPending(trade: Trade): void { if (trade.pending) throw new Error("TRADE_BUSY"); }

  private requirePlayer(id: string): SocialPlayer {
    const player = this.getPlayer(id);
    if (!player?.online) throw new Error("PLAYER_OFFLINE");
    return player;
  }

  private assertEligible(trade: Trade): void {
    if (trade.abortReason) throw new Error(trade.abortReason);
    const first = this.requirePlayer(trade.participants[0].id);
    const second = this.requirePlayer(trade.participants[1].id);
    if (first.inBattle || second.inBattle) throw new Error("TRADE_IN_BATTLE");
    const origin = this.getPosition(first.id);
    const target = this.getPosition(second.id);
    if (!origin || !target || origin.locationId !== target.locationId ||
        ![origin.x, origin.y, target.x, target.y].every(Number.isFinite) ||
        Math.hypot(origin.x - target.x, origin.y - target.y) > TRADE_DISTANCE) throw new Error("TRADE_TOO_FAR");
  }

  private assertEligibleOrCancel(trade: Trade): void {
    try { this.assertEligible(trade); }
    catch (error) {
      this.cancelTrade(trade, error instanceof Error ? error.message : "TRADE_CANCELLED");
      throw error;
    }
  }

  private participantIndex(trade: Trade, actorId: string): 0 | 1 {
    return trade.participants[0].id === actorId ? 0 : 1;
  }

  private isOpen(trade: Trade): boolean { return trade.status === "invited" || trade.status === "active"; }

  private assertNotExpired(trade: Trade): void {
    if (trade.expiresAt <= this.now()) throw new Error("TRADE_EXPIRED");
  }

  private expire(trade: Trade): void {
    if (!trade.pending && this.isOpen(trade) && trade.expiresAt <= this.now()) this.cancelTrade(trade, "TRADE_EXPIRED");
  }

  private cancelIfUnavailable(trade: Trade): void {
    try { this.assertEligible(trade); this.assertNotExpired(trade); }
    catch (error) { this.cancelTrade(trade, error instanceof Error ? error.message : "TRADE_CANCELLED"); }
  }

  private cancelTrade(trade: Trade, reason: string): void {
    trade.status = "cancelled";
    trade.cancelReason = reason;
    trade.confirmed = [false, false];
  }

  private snapshot(trade: Trade): TradeSnapshot {
    return {
      id: trade.id, initiatorId: trade.participants[0].id, status: trade.status, revision: trade.revision,
      participants: [0, 1].map(index => ({
        player: { ...(this.getPlayer(trade.participants[index]!.id) ?? { ...trade.participants[index]!, online: false, inBattle: false }) },
        offer: trade.offers[index]!.map(entry => ({ ...entry })), confirmed: trade.confirmed[index]!
      })) as TradeSnapshot["participants"],
      expiresAt: trade.expiresAt, ...(trade.cancelReason ? { cancelReason: trade.cancelReason } : {})
    };
  }
}
