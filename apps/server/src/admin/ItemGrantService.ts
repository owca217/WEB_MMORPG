import { PERMANENT_BACKPACK_ITEM_ID, type AdminItemGrantInput, type AdminItemGrantResult } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import type { AdminAuditRepository } from "../audit/AdminAuditRepository";
import type { InventoryService } from "../inventory/InventoryService";
import { AdminAuthError, type AdminSession } from "./AdminAuth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ItemGrantError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ItemGrantError";
  }
}

export class ItemGrantService {
  constructor(
    private readonly pool: Pool,
    private readonly inventory: InventoryService,
    private readonly audit: AdminAuditRepository
  ) {}

  async grant(session: AdminSession, itemId: string, input: AdminItemGrantInput): Promise<AdminItemGrantResult> {
    if (!input || typeof input.characterId !== "string" || !UUID.test(input.characterId)) {
      throw new ItemGrantError("INVALID_CHARACTER_ID", 400, "Nieprawidłowa postać.");
    }
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) {
      throw new ItemGrantError("INVALID_GRANT_QUANTITY", 400, "Ilość musi być liczbą całkowitą od 1 do 100.");
    }
    if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) {
      throw new ItemGrantError("INVALID_GRANT_REQUEST_ID", 400, "Nieprawidłowy identyfikator żądania.");
    }
    const characterId = input.characterId.toLowerCase();
    const { quantity } = input;
    const requestId = input.requestId.toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const character = await client.query<{ account_id: string; deletion_requested_at: Date | null; deletion_effective_at: Date | null }>(
        "SELECT account_id, deletion_requested_at, deletion_effective_at FROM characters WHERE id=$1 FOR UPDATE", [characterId]
      );
      if (character.rows[0]?.account_id !== session.accountId) {
        throw new ItemGrantError("CHARACTER_NOT_FOUND", 404, "Nie znaleziono Twojej postaci.");
      }
      if (character.rows[0].deletion_requested_at || character.rows[0].deletion_effective_at) {
        throw new ItemGrantError("CHARACTER_PENDING_DELETION", 409, "Postać oczekuje na usunięcie.");
      }
      // Keep role, ban and session revocation checks valid until this transaction commits.
      const account = await client.query<{ role: string; status: string }>(
        "SELECT role,status FROM accounts WHERE id=$1 FOR SHARE", [session.accountId]
      );
      if (account.rows[0]?.role !== "ADMIN" || account.rows[0].status !== "active") {
        throw new AdminAuthError(403, "ADMIN_FORBIDDEN");
      }
      const activeSession = await client.query(
        "SELECT id FROM account_sessions WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL AND expires_at>NOW() FOR SHARE",
        [session.sessionId, session.accountId]
      );
      if (!activeSession.rowCount) throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");

      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`admin-grant:${session.accountId}:${requestId}`]);
      const receipt = await client.query<{ object_id: string; summary: Record<string, unknown> }>(
        `SELECT object_id,summary FROM admin_audit_log
         WHERE actor_account_id=$1 AND action='ITEM_GRANTED' AND summary->>'requestId'=$2 LIMIT 1`,
        [session.accountId, requestId]
      );
      const previous = receipt.rows[0];
      if (previous) {
        if (previous.object_id !== itemId || previous.summary.characterId !== characterId || previous.summary.quantity !== quantity) {
          throw new ItemGrantError("GRANT_REQUEST_CONFLICT", 409, "To żądanie dotyczy innego przedmiotu lub ilości.");
        }
        const inventory = await this.inventory.getSnapshot(characterId, client);
        await client.query("COMMIT");
        return { characterId, inventory };
      }
      if (itemId === PERMANENT_BACKPACK_ITEM_ID) {
        throw new ItemGrantError("PERMANENT_BACKPACK_FIXED", 400, "Stały plecak jest przypisany do postaci automatycznie.");
      }
      const definition = await client.query<{ status: string; published: boolean }>(
        `SELECT item.status,EXISTS(SELECT 1 FROM item_versions version WHERE version.item_id=item.id
           AND version.version_no=item.active_version_no AND version.state='PUBLISHED') AS published
         FROM items item WHERE item.item_id=$1 FOR SHARE OF item`, [itemId]
      );
      if (!definition.rows[0]) throw new ItemGrantError("ITEM_NOT_FOUND", 404, "Nie znaleziono przedmiotu.");
      if (definition.rows[0].status !== "PUBLISHED" || !definition.rows[0].published) {
        throw new ItemGrantError("ITEM_NOT_PUBLISHED", 400, "Można dodać wyłącznie opublikowany przedmiot.");
      }
      const inventory = await this.inventory.addItemsWithClient(characterId, [{ itemId, quantity }], client);
      await this.audit.appendWithClient(client, {
        actorAccountId: session.accountId,
        action: "ITEM_GRANTED",
        objectType: "item",
        objectId: itemId,
        summary: { requestId, characterId, itemId, quantity }
      });
      await client.query("COMMIT");
      return { characterId, inventory };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
