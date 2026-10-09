import { randomUUID } from "node:crypto";
import type {
  ItemCatalogPage,
  ItemCatalogQuery,
  ItemDefinition,
  ItemDetails,
  ItemDraftInput,
  ItemEffect,
  ItemRequirement,
  ItemStatModifier,
  ItemStatus,
  ItemVersion,
  ItemVersionSummary
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { AdminAuditRepository } from "../audit/AdminAuditRepository";
import { ItemConflictError, ItemNotFoundError } from "./itemValidation";

interface ItemRow {
  id: string;
  item_id: string;
  status: ItemStatus;
  active_version_no: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface VersionRow {
  id: string;
  item_id: string;
  stable_item_id: string;
  version_no: number;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  name: string;
  category_id: string;
  subcategory_id: string | null;
  description: string;
  icon_key: string | null;
  icon_url: string | null;
  rarity: ItemDraftInput["rarity"];
  item_level: number;
  minimum_level: number;
  sell_value: string | number;
  sellable: boolean;
  tradable: boolean;
  droppable: boolean;
  stackable: boolean;
  max_stack: number;
  weight: string | number;
  soulbound: ItemDraftInput["soulbound"];
  unique_item: boolean;
  special_data: Record<string, unknown>;
  created_by: string;
  created_at: Date | string;
}

interface StatRow {
  stat_code: string;
  modifier_type: ItemStatModifier["modifierType"];
  value: string | number;
}

interface RequirementRow {
  requirement_type: ItemRequirement["type"];
  code: string | null;
  value_json: { value?: number | string | null } | null;
}

interface EffectRow {
  trigger_code: string;
  effect_code: string;
  value: string | number | null;
  chance: string | number | null;
  duration_ms: number | null;
  cooldown_ms: number | null;
  condition: Record<string, unknown> | null;
}

interface VersionSummaryRow {
  version_no: number;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  created_by: string;
  created_at: Date | string;
}

export class ItemCatalogRepository {
  private readonly audit: AdminAuditRepository;

  constructor(private readonly pool: Pool) {
    this.audit = new AdminAuditRepository(pool);
  }

  async itemIdExists(itemId: string): Promise<boolean> {
    const result = await this.pool.query("SELECT 1 FROM items WHERE item_id = $1", [
      itemId
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  async createDraft(input: ItemDraftInput, actor: string): Promise<ItemVersion> {
    const client = await this.pool.connect();
    const itemUuid = randomUUID();
    const versionUuid = randomUUID();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO items (id, item_id, status)
         VALUES ($1, $2, 'DRAFT')`,
        [itemUuid, input.itemId]
      );
      await this.insertVersion(client, versionUuid, itemUuid, 1, 1, "DRAFT", input, actor);
      await this.replaceChildren(client, versionUuid, input);
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "CREATE_DRAFT",
        objectType: "item",
        objectId: input.itemId,
        toVersion: 1,
        summary: { name: input.name, revision: 1 }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.requireDraft(input.itemId);
  }

  async updateDraft(
    stableItemId: string,
    input: ItemDraftInput,
    expectedRevision: number,
    actor: string
  ): Promise<ItemVersion> {
    const client = await this.pool.connect();
    let resultingVersionNo = 0;

    try {
      await client.query("BEGIN");
      const item = await this.requireItemWithClient(client, stableItemId, true);
      const draftResult = await client.query<{
        id: string;
        revision: number;
        version_no: number;
      }>(
        `SELECT id, revision, version_no
         FROM item_versions
         WHERE item_id = $1 AND state = 'DRAFT'
         FOR UPDATE`,
        [item.id]
      );
      const draft = draftResult.rows[0];

      if (draft) {
        if (draft.revision !== expectedRevision) {
          throw new ItemConflictError(`ITEM_CONFLICT:${stableItemId}`);
        }

        const nextRevision = draft.revision + 1;
        resultingVersionNo = draft.version_no;
        await this.updateVersionRow(client, draft.id, nextRevision, input, actor);
        await this.replaceChildren(client, draft.id, input);
        await this.audit.appendWithClient(client, {
          actorPlayerId: actor,
          action: "UPDATE_DRAFT",
          objectType: "item",
          objectId: stableItemId,
          fromVersion: draft.version_no,
          toVersion: draft.version_no,
          summary: {
            name: input.name,
            revisionFrom: draft.revision,
            revisionTo: nextRevision
          }
        });
      } else {
        if (item.active_version_no === null) {
          throw new ItemNotFoundError(`DRAFT_NOT_FOUND:${stableItemId}`);
        }
        const activeResult = await client.query<{ revision: number }>(
          `SELECT revision
           FROM item_versions
           WHERE item_id = $1 AND state = 'PUBLISHED' AND version_no = $2
           FOR UPDATE`,
          [item.id, item.active_version_no]
        );
        const active = activeResult.rows[0];
        if (!active) {
          throw new ItemNotFoundError(`ITEM_VERSION_NOT_FOUND:${stableItemId}`);
        }
        if (active.revision !== expectedRevision) {
          throw new ItemConflictError(`ITEM_CONFLICT:${stableItemId}`);
        }

        const nextVersion = await this.nextVersionNo(client, item.id);
        const versionUuid = randomUUID();
        resultingVersionNo = nextVersion;
        await this.insertVersion(
          client,
          versionUuid,
          item.id,
          nextVersion,
          1,
          "DRAFT",
          input,
          actor
        );
        await this.replaceChildren(client, versionUuid, input);
        await this.audit.appendWithClient(client, {
          actorPlayerId: actor,
          action: "CREATE_DRAFT",
          objectType: "item",
          objectId: stableItemId,
          fromVersion: item.active_version_no,
          toVersion: nextVersion,
          summary: { name: input.name, revision: 1, source: "published" }
        });
      }

      await client.query("UPDATE items SET updated_at = NOW() WHERE id = $1", [item.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const result = await this.requireDraft(stableItemId);
    if (result.versionNo !== resultingVersionNo) {
      throw new ItemConflictError(`ITEM_CONFLICT:${stableItemId}`);
    }
    return result;
  }

  async publish(
    stableItemId: string,
    expectedRevision: number,
    actor: string
  ): Promise<ItemVersion> {
    const client = await this.pool.connect();
    let publishedVersionNo = 0;

    try {
      await client.query("BEGIN");
      const item = await this.requireItemWithClient(client, stableItemId, true);
      const draftResult = await client.query<{
        id: string;
        version_no: number;
        revision: number;
        name: string;
      }>(
        `SELECT id, version_no, revision, name
         FROM item_versions
         WHERE item_id = $1 AND state = 'DRAFT'
         FOR UPDATE`,
        [item.id]
      );
      const draft = draftResult.rows[0];
      if (!draft) throw new ItemNotFoundError(`DRAFT_NOT_FOUND:${stableItemId}`);
      if (draft.revision !== expectedRevision) {
        throw new ItemConflictError(`ITEM_CONFLICT:${stableItemId}`);
      }

      publishedVersionNo = draft.version_no;
      await client.query(
        `UPDATE item_versions
         SET state = 'PUBLISHED', updated_at = NOW()
         WHERE id = $1`,
        [draft.id]
      );
      await client.query(
        `UPDATE items
         SET status = 'PUBLISHED', active_version_no = $2, updated_at = NOW()
         WHERE id = $1`,
        [item.id, draft.version_no]
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "PUBLISH",
        objectType: "item",
        objectId: stableItemId,
        ...(item.active_version_no === null ? {} : { fromVersion: item.active_version_no }),
        toVersion: draft.version_no,
        summary: { name: draft.name, revision: draft.revision }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getVersion(stableItemId, publishedVersionNo);
  }

  async restoreVersion(
    stableItemId: string,
    sourceVersionNo: number,
    actor: string
  ): Promise<ItemVersion> {
    const source = await this.getVersion(stableItemId, sourceVersionNo);
    const client = await this.pool.connect();
    let restoredVersionNo = 0;

    try {
      await client.query("BEGIN");
      const item = await this.requireItemWithClient(client, stableItemId, true);
      const draft = await client.query(
        "SELECT 1 FROM item_versions WHERE item_id = $1 AND state = 'DRAFT' FOR UPDATE",
        [item.id]
      );
      if ((draft.rowCount ?? 0) > 0) {
        throw new ItemConflictError(`DRAFT_EXISTS:${stableItemId}`);
      }

      restoredVersionNo = await this.nextVersionNo(client, item.id);
      const versionUuid = randomUUID();
      await this.insertVersion(
        client,
        versionUuid,
        item.id,
        restoredVersionNo,
        1,
        "PUBLISHED",
        source,
        actor
      );
      await this.replaceChildren(client, versionUuid, source);
      await client.query(
        `UPDATE items
         SET status = 'PUBLISHED', active_version_no = $2, updated_at = NOW()
         WHERE id = $1`,
        [item.id, restoredVersionNo]
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "RESTORE",
        objectType: "item",
        objectId: stableItemId,
        ...(item.active_version_no === null ? {} : { fromVersion: item.active_version_no }),
        toVersion: restoredVersionNo,
        summary: { restoredFromVersion: sourceVersionNo, name: source.name }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getVersion(stableItemId, restoredVersionNo);
  }

  async duplicate(
    source: ItemVersion,
    newItemId: string,
    actor: string
  ): Promise<ItemVersion> {
    const client = await this.pool.connect();
    const itemUuid = randomUUID();
    const versionUuid = randomUUID();
    const input = this.toDraftInput(source, newItemId);

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO items (id, item_id, status)
         VALUES ($1, $2, 'DRAFT')`,
        [itemUuid, newItemId]
      );
      await this.insertVersion(client, versionUuid, itemUuid, 1, 1, "DRAFT", input, actor);
      await this.replaceChildren(client, versionUuid, input);
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "DUPLICATE",
        objectType: "item",
        objectId: newItemId,
        toVersion: 1,
        summary: { sourceItemId: source.itemId, sourceVersion: source.versionNo }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.requireDraft(newItemId);
  }

  async archive(stableItemId: string, actor: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const item = await this.requireItemWithClient(client, stableItemId, true);
      await client.query(
        "UPDATE items SET status = 'ARCHIVED', updated_at = NOW() WHERE id = $1",
        [item.id]
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "ARCHIVE",
        objectType: "item",
        objectId: stableItemId,
        ...(item.active_version_no === null ? {} : { fromVersion: item.active_version_no }),
        ...(item.active_version_no === null ? {} : { toVersion: item.active_version_no }),
        summary: { previousStatus: item.status, newStatus: "ARCHIVED" }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getItem(stableItemId: string): Promise<ItemDetails> {
    const itemResult = await this.pool.query<ItemRow>(
      `SELECT id, item_id, status, active_version_no, created_at, updated_at
       FROM items WHERE item_id = $1`,
      [stableItemId]
    );
    const itemRow = itemResult.rows[0];
    if (!itemRow) throw new ItemNotFoundError(`ITEM_NOT_FOUND:${stableItemId}`);

    const versions = await this.listVersionsByUuid(itemRow.id);
    const draft = await this.loadVersion(itemRow.id, "DRAFT");
    const preferred = itemRow.active_version_no
      ? await this.loadPublishedVersion(itemRow.id, itemRow.active_version_no)
      : draft;
    if (!preferred) throw new ItemNotFoundError(`ITEM_VERSION_NOT_FOUND:${stableItemId}`);

    const item = this.toDefinition(preferred, itemRow);
    const details: ItemDetails = { item, versions };
    if (draft) details.draft = draft;
    return details;
  }

  async getVersion(stableItemId: string, versionNo: number): Promise<ItemVersion> {
    const result = await this.pool.query<VersionRow>(
      `SELECT v.*, i.item_id AS stable_item_id
       FROM item_versions v
       JOIN items i ON i.id = v.item_id
       WHERE i.item_id = $1 AND v.version_no = $2
       LIMIT 1`,
      [stableItemId, versionNo]
    );
    const row = result.rows[0];
    if (!row) {
      throw new ItemNotFoundError(`ITEM_VERSION_NOT_FOUND:${stableItemId}:${versionNo}`);
    }
    return this.hydrateVersion(row);
  }

  async listVersions(stableItemId: string): Promise<ItemVersionSummary[]> {
    const itemResult = await this.pool.query<{ id: string }>(
      "SELECT id FROM items WHERE item_id = $1",
      [stableItemId]
    );
    const item = itemResult.rows[0];
    if (!item) throw new ItemNotFoundError(`ITEM_NOT_FOUND:${stableItemId}`);
    return this.listVersionsByUuid(item.id);
  }

  async listItems(query: ItemCatalogQuery): Promise<ItemCatalogPage> {
    const rows = await this.pool.query<ItemRow>(
      `SELECT id, item_id, status, active_version_no, created_at, updated_at
       FROM items
       ORDER BY updated_at DESC, item_id ASC`
    );

    const definitions: ItemDefinition[] = [];
    for (const itemRow of rows.rows) {
      const version = itemRow.active_version_no
        ? await this.loadPublishedVersion(itemRow.id, itemRow.active_version_no)
        : await this.loadVersion(itemRow.id, "DRAFT");
      if (version) definitions.push(this.toDefinition(version, itemRow));
    }

    const normalizedSearch = query.search?.trim().toLocaleLowerCase("pl") ?? "";
    const filtered = definitions.filter((item) => {
      if (query.itemId && item.itemId !== query.itemId) return false;
      if (query.categoryId && item.categoryId !== query.categoryId) return false;
      if (query.subcategoryId && item.subcategoryId !== query.subcategoryId) return false;
      if (query.rarity && item.rarity !== query.rarity) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.minimumLevel !== undefined && item.itemLevel < query.minimumLevel) return false;
      if (query.maximumLevel !== undefined && item.itemLevel > query.maximumLevel) return false;
      if (
        normalizedSearch &&
        !item.name.toLocaleLowerCase("pl").includes(normalizedSearch) &&
        !item.itemId.toLocaleLowerCase("pl").includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize
    };
  }

  async requireDraft(stableItemId: string): Promise<ItemVersion> {
    const itemResult = await this.pool.query<{ id: string }>(
      "SELECT id FROM items WHERE item_id = $1",
      [stableItemId]
    );
    const item = itemResult.rows[0];
    if (!item) throw new ItemNotFoundError(`ITEM_NOT_FOUND:${stableItemId}`);
    const draft = await this.loadVersion(item.id, "DRAFT");
    if (!draft) throw new ItemNotFoundError(`DRAFT_NOT_FOUND:${stableItemId}`);
    return draft;
  }

  private async requireItemWithClient(
    client: PoolClient,
    stableItemId: string,
    forUpdate: boolean
  ): Promise<ItemRow> {
    const result = await client.query<ItemRow>(
      `SELECT id, item_id, status, active_version_no, created_at, updated_at
       FROM items
       WHERE item_id = $1
       ${forUpdate ? "FOR UPDATE" : ""}`,
      [stableItemId]
    );
    const row = result.rows[0];
    if (!row) throw new ItemNotFoundError(`ITEM_NOT_FOUND:${stableItemId}`);
    return row;
  }

  private async nextVersionNo(client: PoolClient, itemUuid: string): Promise<number> {
    const result = await client.query<{ next_version: number }>(
      `SELECT COALESCE(MAX(version_no), 0)::int + 1 AS next_version
       FROM item_versions WHERE item_id = $1`,
      [itemUuid]
    );
    return result.rows[0]?.next_version ?? 1;
  }

  private async updateVersionRow(
    client: PoolClient,
    versionUuid: string,
    revision: number,
    input: ItemDraftInput,
    actor: string
  ): Promise<void> {
    await client.query(
      `UPDATE item_versions SET
        revision = $2,
        name = $3,
        category_id = $4,
        subcategory_id = $5,
        description = $6,
        icon_key = $7,
        icon_url = $8,
        rarity = $9,
        item_level = $10,
        minimum_level = $11,
        sell_value = $12,
        sellable = $13,
        tradable = $14,
        droppable = $15,
        stackable = $16,
        max_stack = $17,
        weight = $18,
        soulbound = $19,
        unique_item = $20,
        special_data = $21::jsonb,
        created_by = $22,
        updated_at = NOW()
       WHERE id = $1`,
      [
        versionUuid,
        revision,
        input.name,
        input.categoryId,
        input.subcategoryId ?? null,
        input.description,
        input.iconKey ?? null,
        input.iconUrl ?? null,
        input.rarity,
        input.itemLevel,
        input.minimumLevel,
        input.sellValue,
        input.sellable,
        input.tradable,
        input.droppable,
        input.stackable,
        input.maxStack,
        input.weight,
        input.soulbound,
        input.unique,
        JSON.stringify(input.specialData),
        actor
      ]
    );
  }

  private async insertVersion(
    client: PoolClient,
    versionUuid: string,
    itemUuid: string,
    versionNo: number,
    revision: number,
    state: "DRAFT" | "PUBLISHED",
    input: ItemDraftInput,
    actor: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO item_versions (
        id, item_id, version_no, revision, state, name, category_id,
        subcategory_id, description, icon_key, icon_url, rarity, item_level,
        minimum_level, sell_value, sellable, tradable, droppable, stackable,
        max_stack, weight, soulbound, unique_item, special_data, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25
      )`,
      [
        versionUuid,
        itemUuid,
        versionNo,
        revision,
        state,
        input.name,
        input.categoryId,
        input.subcategoryId ?? null,
        input.description,
        input.iconKey ?? null,
        input.iconUrl ?? null,
        input.rarity,
        input.itemLevel,
        input.minimumLevel,
        input.sellValue,
        input.sellable,
        input.tradable,
        input.droppable,
        input.stackable,
        input.maxStack,
        input.weight,
        input.soulbound,
        input.unique,
        JSON.stringify(input.specialData),
        actor
      ]
    );
  }

  private async replaceChildren(
    client: PoolClient,
    versionUuid: string,
    input: ItemDraftInput
  ): Promise<void> {
    await client.query("DELETE FROM item_stat_modifiers WHERE version_id = $1", [
      versionUuid
    ]);
    await client.query("DELETE FROM item_requirements WHERE version_id = $1", [
      versionUuid
    ]);
    await client.query("DELETE FROM item_effects WHERE version_id = $1", [versionUuid]);
    await client.query("DELETE FROM item_tags WHERE version_id = $1", [versionUuid]);

    for (const stat of input.stats) {
      await client.query(
        `INSERT INTO item_stat_modifiers (id, version_id, stat_code, modifier_type, value)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), versionUuid, stat.statCode, stat.modifierType, stat.value]
      );
    }

    for (const requirement of input.requirements) {
      await client.query(
        `INSERT INTO item_requirements (
          id, version_id, requirement_type, code, value_json
        ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          randomUUID(),
          versionUuid,
          requirement.type,
          requirement.code ?? null,
          JSON.stringify({ value: requirement.value ?? null })
        ]
      );
    }

    for (const effect of input.effects) {
      await client.query(
        `INSERT INTO item_effects (
          id, version_id, trigger_code, effect_code, value, chance,
          duration_ms, cooldown_ms, condition
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          randomUUID(),
          versionUuid,
          effect.triggerCode,
          effect.effectCode,
          effect.value ?? null,
          effect.chance ?? null,
          effect.durationMs ?? null,
          effect.cooldownMs ?? null,
          JSON.stringify(effect.condition ?? {})
        ]
      );
    }

    for (const tag of [...new Set(input.tags)].sort()) {
      await client.query(
        "INSERT INTO item_tags (version_id, tag) VALUES ($1, $2)",
        [versionUuid, tag]
      );
    }
  }

  private async listVersionsByUuid(itemUuid: string): Promise<ItemVersionSummary[]> {
    const result = await this.pool.query<VersionSummaryRow>(
      `SELECT version_no, revision, state, created_by, created_at
       FROM item_versions
       WHERE item_id = $1
       ORDER BY version_no DESC`,
      [itemUuid]
    );
    return result.rows.map((row) => this.mapVersionSummary(row));
  }

  private async loadVersion(
    itemUuid: string,
    state: "DRAFT" | "PUBLISHED"
  ): Promise<ItemVersion | undefined> {
    const result = await this.pool.query<VersionRow>(
      `SELECT v.*, i.item_id AS stable_item_id
       FROM item_versions v
       JOIN items i ON i.id = v.item_id
       WHERE v.item_id = $1 AND v.state = $2
       ORDER BY v.version_no DESC
       LIMIT 1`,
      [itemUuid, state]
    );
    const row = result.rows[0];
    return row ? this.hydrateVersion(row) : undefined;
  }

  private async loadPublishedVersion(
    itemUuid: string,
    versionNo: number
  ): Promise<ItemVersion | undefined> {
    const result = await this.pool.query<VersionRow>(
      `SELECT v.*, i.item_id AS stable_item_id
       FROM item_versions v
       JOIN items i ON i.id = v.item_id
       WHERE v.item_id = $1 AND v.state = 'PUBLISHED' AND v.version_no = $2
       LIMIT 1`,
      [itemUuid, versionNo]
    );
    const row = result.rows[0];
    return row ? this.hydrateVersion(row) : undefined;
  }

  private async hydrateVersion(row: VersionRow): Promise<ItemVersion> {
    const [statsResult, requirementsResult, effectsResult, tagsResult] =
      await Promise.all([
        this.pool.query<StatRow>(
          `SELECT stat_code, modifier_type, value
           FROM item_stat_modifiers WHERE version_id = $1
           ORDER BY stat_code, modifier_type`,
          [row.id]
        ),
        this.pool.query<RequirementRow>(
          `SELECT requirement_type, code, value_json
           FROM item_requirements WHERE version_id = $1
           ORDER BY id`,
          [row.id]
        ),
        this.pool.query<EffectRow>(
          `SELECT trigger_code, effect_code, value, chance, duration_ms, cooldown_ms, condition
           FROM item_effects WHERE version_id = $1
           ORDER BY id`,
          [row.id]
        ),
        this.pool.query<{ tag: string }>(
          "SELECT tag FROM item_tags WHERE version_id = $1 ORDER BY tag",
          [row.id]
        )
      ]);

    const requirements: ItemRequirement[] = requirementsResult.rows.map((entry) => {
      const requirement: ItemRequirement = { type: entry.requirement_type };
      if (entry.code !== null) requirement.code = entry.code;
      const value = entry.value_json?.value;
      if (value !== undefined && value !== null) requirement.value = value;
      return requirement;
    });

    const effects: ItemEffect[] = effectsResult.rows.map((entry) => {
      const effect: ItemEffect = {
        triggerCode: entry.trigger_code,
        effectCode: entry.effect_code
      };
      if (entry.value !== null) effect.value = Number(entry.value);
      if (entry.chance !== null) effect.chance = Number(entry.chance);
      if (entry.duration_ms !== null) effect.durationMs = entry.duration_ms;
      if (entry.cooldown_ms !== null) effect.cooldownMs = entry.cooldown_ms;
      if (entry.condition && Object.keys(entry.condition).length > 0) {
        effect.condition = entry.condition;
      }
      return effect;
    });

    const version: ItemVersion = {
      itemId: row.stable_item_id,
      name: row.name,
      categoryId: row.category_id,
      description: row.description,
      rarity: row.rarity,
      itemLevel: row.item_level,
      minimumLevel: row.minimum_level,
      sellValue: Number(row.sell_value),
      sellable: row.sellable,
      tradable: row.tradable,
      droppable: row.droppable,
      stackable: row.stackable,
      maxStack: row.max_stack,
      weight: Number(row.weight),
      soulbound: row.soulbound,
      unique: row.unique_item,
      tags: tagsResult.rows.map((entry) => entry.tag),
      stats: statsResult.rows.map((entry) => ({
        statCode: entry.stat_code,
        modifierType: entry.modifier_type,
        value: Number(entry.value)
      })),
      requirements,
      effects,
      specialData: row.special_data ?? {},
      versionNo: row.version_no,
      revision: row.revision,
      state: row.state,
      createdBy: row.created_by,
      createdAt: this.iso(row.created_at)
    };
    if (row.subcategory_id !== null) version.subcategoryId = row.subcategory_id;
    if (row.icon_key !== null) version.iconKey = row.icon_key;
    if (row.icon_url !== null) version.iconUrl = row.icon_url;
    return version;
  }

  private toDefinition(version: ItemVersion, itemRow: ItemRow): ItemDefinition {
    const definition: ItemDefinition = {
      itemId: version.itemId,
      name: version.name,
      categoryId: version.categoryId,
      description: version.description,
      rarity: version.rarity,
      itemLevel: version.itemLevel,
      minimumLevel: version.minimumLevel,
      sellValue: version.sellValue,
      sellable: version.sellable,
      tradable: version.tradable,
      droppable: version.droppable,
      stackable: version.stackable,
      maxStack: version.maxStack,
      weight: version.weight,
      soulbound: version.soulbound,
      unique: version.unique,
      tags: [...version.tags],
      stats: version.stats.map((stat) => ({ ...stat })),
      requirements: version.requirements.map((requirement) => ({ ...requirement })),
      effects: version.effects.map((effect) => ({
        ...effect,
        ...(effect.condition ? { condition: { ...effect.condition } } : {})
      })),
      specialData: { ...version.specialData },
      status: itemRow.status,
      createdAt: this.iso(itemRow.created_at),
      updatedAt: this.iso(itemRow.updated_at)
    };
    if (version.subcategoryId !== undefined) definition.subcategoryId = version.subcategoryId;
    if (version.iconKey !== undefined) definition.iconKey = version.iconKey;
    if (version.iconUrl !== undefined) definition.iconUrl = version.iconUrl;
    if (itemRow.active_version_no !== null) {
      definition.activeVersionNo = itemRow.active_version_no;
    }
    return definition;
  }

  private toDraftInput(version: ItemVersion, itemId: string): ItemDraftInput {
    const input: ItemDraftInput = {
      itemId,
      name: version.name,
      categoryId: version.categoryId,
      description: version.description,
      rarity: version.rarity,
      itemLevel: version.itemLevel,
      minimumLevel: version.minimumLevel,
      sellValue: version.sellValue,
      sellable: version.sellable,
      tradable: version.tradable,
      droppable: version.droppable,
      stackable: version.stackable,
      maxStack: version.maxStack,
      weight: version.weight,
      soulbound: version.soulbound,
      unique: version.unique,
      tags: [...version.tags],
      stats: version.stats.map((stat) => ({ ...stat })),
      requirements: version.requirements.map((requirement) => ({ ...requirement })),
      effects: version.effects.map((effect) => ({
        ...effect,
        ...(effect.condition ? { condition: { ...effect.condition } } : {})
      })),
      specialData: { ...version.specialData }
    };
    if (version.subcategoryId !== undefined) input.subcategoryId = version.subcategoryId;
    if (version.iconKey !== undefined) input.iconKey = version.iconKey;
    if (version.iconUrl !== undefined) input.iconUrl = version.iconUrl;
    return input;
  }

  private mapVersionSummary(row: VersionSummaryRow): ItemVersionSummary {
    return {
      versionNo: row.version_no,
      revision: row.revision,
      state: row.state,
      createdBy: row.created_by,
      createdAt: this.iso(row.created_at)
    };
  }

  private iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }
}
