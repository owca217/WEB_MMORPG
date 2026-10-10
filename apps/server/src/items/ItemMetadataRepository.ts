import type {
  ItemCategoryDefinition,
  ItemCreatorMetadata,
  ItemSubcategoryDefinition
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { AdminAuditRepository } from "../audit/AdminAuditRepository";
import {
  ENGINE_EFFECTS,
  ENGINE_SPECIAL_FIELDS,
  ENGINE_STATS,
  ENGINE_TRIGGERS
} from "./statRegistry";

export interface CreateCategoryInput {
  id: string;
  name: string;
  allowedStatCodes: string[];
  allowedSpecialFieldCodes?: string[];
}

export interface CreateSubcategoryInput extends CreateCategoryInput {
  categoryId: string;
}

interface CategoryRow {
  id: string;
  name: string;
  system: boolean;
}

interface SubcategoryRow extends CategoryRow {
  category_id: string;
}

interface AllowedStatRow {
  category_id: string;
  subcategory_id: string | null;
  stat_code: string;
}

interface AllowedSpecialFieldRow {
  category_id: string;
  subcategory_id: string | null;
  field_code: string;
}

interface StatRow {
  code: string;
  label: string;
  allowed_modifier_types: string[];
  minimum_value: string | null;
  maximum_value: string | null;
}

export class ItemMetadataRepository {
  private readonly audit: AdminAuditRepository;

  constructor(private readonly pool: Pool) {
    this.audit = new AdminAuditRepository(pool);
  }

  async listMetadata(): Promise<ItemCreatorMetadata> {
    const [
      categoriesResult,
      subcategoriesResult,
      allowedResult,
      allowedSpecialResult,
      statsResult
    ] = await Promise.all([
      this.pool.query<CategoryRow>(
        "SELECT id, name, system FROM item_categories ORDER BY id"
      ),
      this.pool.query<SubcategoryRow>(
        `SELECT id, category_id, name, system
         FROM item_subcategories
         ORDER BY category_id, id`
      ),
      this.pool.query<AllowedStatRow>(
        `SELECT category_id, subcategory_id, stat_code
         FROM category_allowed_stats
         ORDER BY category_id, subcategory_id NULLS FIRST, stat_code`
      ),
      this.pool.query<AllowedSpecialFieldRow>(
        `SELECT category_id, subcategory_id, field_code
         FROM category_allowed_special_fields
         ORDER BY category_id, subcategory_id NULLS FIRST, field_code`
      ),
      this.pool.query<StatRow>(
        `SELECT code, label, allowed_modifier_types, minimum_value, maximum_value
         FROM stat_definitions
         ORDER BY code`
      )
    ]);

    const categoryStats = new Map<string, string[]>();
    const subcategoryStats = new Map<string, string[]>();
    const categorySpecialFields = new Map<string, string[]>();
    const subcategorySpecialFields = new Map<string, string[]>();

    for (const row of allowedResult.rows) {
      const target = row.subcategory_id === null ? categoryStats : subcategoryStats;
      const key =
        row.subcategory_id === null
          ? row.category_id
          : `${row.category_id}:${row.subcategory_id}`;
      const values = target.get(key) ?? [];
      values.push(row.stat_code);
      target.set(key, values);
    }

    for (const row of allowedSpecialResult.rows) {
      const target =
        row.subcategory_id === null
          ? categorySpecialFields
          : subcategorySpecialFields;
      const key =
        row.subcategory_id === null
          ? row.category_id
          : `${row.category_id}:${row.subcategory_id}`;
      const values = target.get(key) ?? [];
      values.push(row.field_code);
      target.set(key, values);
    }

    return {
      categories: categoriesResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        system: row.system,
        allowedStatCodes: categoryStats.get(row.id) ?? [],
        allowedSpecialFieldCodes: categorySpecialFields.get(row.id) ?? []
      })),
      subcategories: subcategoriesResult.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        name: row.name,
        system: row.system,
        allowedStatCodes:
          subcategoryStats.get(`${row.category_id}:${row.id}`) ?? [],
        allowedSpecialFieldCodes:
          subcategorySpecialFields.get(`${row.category_id}:${row.id}`) ?? []
      })),
      stats: statsResult.rows.map((row) => ({
        code: row.code,
        label: row.label,
        modifierTypes: row.allowed_modifier_types as Array<
          "flat" | "percent" | "multiplier"
        >,
        ...(row.minimum_value === null
          ? {}
          : { minimum: Number(row.minimum_value) }),
        ...(row.maximum_value === null
          ? {}
          : { maximum: Number(row.maximum_value) })
      })),
      triggers: Object.values(ENGINE_TRIGGERS).map(({ code, label }) => ({
        code,
        label
      })),
      effects: Object.values(ENGINE_EFFECTS).map(({ code, label }) => ({
        code,
        label
      })),
      specialFields: Object.values(ENGINE_SPECIAL_FIELDS).map((field) => ({
        ...field,
        ...(field.options
          ? { options: field.options.map((option) => ({ ...option })) }
          : {})
      }))
    };
  }

  async createCategory(
    input: CreateCategoryInput,
    actor: string
  ): Promise<ItemCategoryDefinition> {
    this.validateId(input.id);
    this.validateName(input.name);
    this.validateStatCodes(input.allowedStatCodes);
    const allowedSpecialFieldCodes = this.normalizedSpecialFieldCodes(
      input.allowedSpecialFieldCodes ?? []
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO item_categories (id, name, system)
         VALUES ($1, $2, FALSE)`,
        [input.id, input.name.trim()]
      );
      await this.replaceAllowedStats(client, input.id, null, input.allowedStatCodes);
      await this.replaceAllowedSpecialFields(
        client,
        input.id,
        null,
        allowedSpecialFieldCodes
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "CREATE_CATEGORY",
        objectType: "item_category",
        objectId: input.id,
        summary: {
          name: input.name.trim(),
          allowedStatCodes: [...new Set(input.allowedStatCodes)].sort(),
          allowedSpecialFieldCodes
        }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      id: input.id,
      name: input.name.trim(),
      system: false,
      allowedStatCodes: [...new Set(input.allowedStatCodes)].sort(),
      allowedSpecialFieldCodes
    };
  }

  async createSubcategory(
    input: CreateSubcategoryInput,
    actor: string
  ): Promise<ItemSubcategoryDefinition> {
    this.validateId(input.id);
    this.validateId(input.categoryId);
    this.validateName(input.name);
    this.validateStatCodes(input.allowedStatCodes);
    const allowedSpecialFieldCodes = this.normalizedSpecialFieldCodes(
      input.allowedSpecialFieldCodes ?? []
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const parent = await client.query<{ id: string }>(
        "SELECT id FROM item_categories WHERE id = $1",
        [input.categoryId]
      );
      if (parent.rowCount === 0) {
        throw new Error(`CATEGORY_NOT_FOUND:${input.categoryId}`);
      }

      await client.query(
        `INSERT INTO item_subcategories (id, category_id, name, system)
         VALUES ($1, $2, $3, FALSE)`,
        [input.id, input.categoryId, input.name.trim()]
      );
      await this.replaceAllowedStats(
        client,
        input.categoryId,
        input.id,
        input.allowedStatCodes
      );
      await this.replaceAllowedSpecialFields(
        client,
        input.categoryId,
        input.id,
        allowedSpecialFieldCodes
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "CREATE_SUBCATEGORY",
        objectType: "item_subcategory",
        objectId: `${input.categoryId}:${input.id}`,
        summary: {
          categoryId: input.categoryId,
          name: input.name.trim(),
          allowedStatCodes: [...new Set(input.allowedStatCodes)].sort(),
          allowedSpecialFieldCodes
        }
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      id: input.id,
      categoryId: input.categoryId,
      name: input.name.trim(),
      system: false,
      allowedStatCodes: [...new Set(input.allowedStatCodes)].sort(),
      allowedSpecialFieldCodes
    };
  }

  async updateCategoryAllowedStats(
    categoryId: string,
    allowedStatCodes: string[],
    actor: string
  ): Promise<ItemCategoryDefinition> {
    this.validateId(categoryId);
    this.validateStatCodes(allowedStatCodes);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const category = await this.getCategoryForUpdate(client, categoryId);
      const beforeResult = await client.query<{ stat_code: string }>(
        `SELECT stat_code FROM category_allowed_stats
         WHERE category_id = $1 AND subcategory_id IS NULL
         ORDER BY stat_code`,
        [categoryId]
      );
      const next = [...new Set(allowedStatCodes)].sort();
      await this.replaceAllowedStats(client, categoryId, null, next);
      const specialFields = await this.readAllowedSpecialFields(client, categoryId, null);
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "UPDATE_CATEGORY_ALLOWED_STATS",
        objectType: "item_category",
        objectId: categoryId,
        summary: {
          before: beforeResult.rows.map((row) => row.stat_code),
          after: next
        }
      });
      await client.query("COMMIT");

      return {
        id: category.id,
        name: category.name,
        system: category.system,
        allowedStatCodes: next,
        allowedSpecialFieldCodes: specialFields
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateCategoryAllowedSpecialFields(
    categoryId: string,
    fieldCodes: string[],
    actor: string
  ): Promise<ItemCategoryDefinition> {
    this.validateId(categoryId);
    const next = this.normalizedSpecialFieldCodes(fieldCodes);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const category = await this.getCategoryForUpdate(client, categoryId);
      const before = await this.readAllowedSpecialFields(client, categoryId, null);
      await this.replaceAllowedSpecialFields(client, categoryId, null, next);
      const stats = await client.query<{ stat_code: string }>(
        `SELECT stat_code FROM category_allowed_stats
         WHERE category_id = $1 AND subcategory_id IS NULL
         ORDER BY stat_code`,
        [categoryId]
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "UPDATE_CATEGORY_ALLOWED_SPECIAL_FIELDS",
        objectType: "item_category",
        objectId: categoryId,
        summary: { before, after: next }
      });
      await client.query("COMMIT");
      return {
        id: category.id,
        name: category.name,
        system: category.system,
        allowedStatCodes: stats.rows.map((row) => row.stat_code),
        allowedSpecialFieldCodes: next
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateSubcategoryAllowedSpecialFields(
    categoryId: string,
    subcategoryId: string,
    fieldCodes: string[],
    actor: string
  ): Promise<ItemSubcategoryDefinition> {
    this.validateId(categoryId);
    this.validateId(subcategoryId);
    const next = this.normalizedSpecialFieldCodes(fieldCodes);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SubcategoryRow>(
        `SELECT id, category_id, name, system
         FROM item_subcategories
         WHERE category_id = $1 AND id = $2
         FOR UPDATE`,
        [categoryId, subcategoryId]
      );
      const subcategory = result.rows[0];
      if (!subcategory) {
        throw new Error(`SUBCATEGORY_NOT_FOUND:${categoryId}:${subcategoryId}`);
      }
      const before = await this.readAllowedSpecialFields(
        client,
        categoryId,
        subcategoryId
      );
      await this.replaceAllowedSpecialFields(
        client,
        categoryId,
        subcategoryId,
        next
      );
      const stats = await client.query<{ stat_code: string }>(
        `SELECT stat_code FROM category_allowed_stats
         WHERE category_id = $1 AND subcategory_id = $2
         ORDER BY stat_code`,
        [categoryId, subcategoryId]
      );
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "UPDATE_SUBCATEGORY_ALLOWED_SPECIAL_FIELDS",
        objectType: "item_subcategory",
        objectId: `${categoryId}:${subcategoryId}`,
        summary: { before, after: next }
      });
      await client.query("COMMIT");
      return {
        id: subcategory.id,
        categoryId: subcategory.category_id,
        name: subcategory.name,
        system: subcategory.system,
        allowedStatCodes: stats.rows.map((row) => row.stat_code),
        allowedSpecialFieldCodes: next
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getCategoryForUpdate(
    client: PoolClient,
    categoryId: string
  ): Promise<CategoryRow> {
    const result = await client.query<CategoryRow>(
      `SELECT id, name, system FROM item_categories
       WHERE id = $1 FOR UPDATE`,
      [categoryId]
    );
    const category = result.rows[0];
    if (!category) throw new Error(`CATEGORY_NOT_FOUND:${categoryId}`);
    return category;
  }

  private async readAllowedSpecialFields(
    client: PoolClient,
    categoryId: string,
    subcategoryId: string | null
  ): Promise<string[]> {
    const result =
      subcategoryId === null
        ? await client.query<{ field_code: string }>(
            `SELECT field_code FROM category_allowed_special_fields
             WHERE category_id = $1 AND subcategory_id IS NULL
             ORDER BY field_code`,
            [categoryId]
          )
        : await client.query<{ field_code: string }>(
            `SELECT field_code FROM category_allowed_special_fields
             WHERE category_id = $1 AND subcategory_id = $2
             ORDER BY field_code`,
            [categoryId, subcategoryId]
          );
    return result.rows.map((row) => row.field_code);
  }

  private validateStatCodes(statCodes: readonly string[]): void {
    for (const code of statCodes) {
      if (!ENGINE_STATS[code]) throw new Error(`UNKNOWN_STAT_CODE:${code}`);
    }
  }

  private normalizedSpecialFieldCodes(fieldCodes: readonly string[]): string[] {
    for (const code of fieldCodes) {
      if (!ENGINE_SPECIAL_FIELDS[code]) {
        throw new Error(`UNKNOWN_SPECIAL_FIELD_CODE:${code}`);
      }
    }
    return [...new Set(fieldCodes)].sort();
  }

  private validateId(id: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`INVALID_METADATA_ID:${id}`);
    }
  }

  private validateName(name: string): void {
    if (name.trim().length === 0 || name.trim().length > 80) {
      throw new Error("INVALID_METADATA_NAME");
    }
  }

  private async replaceAllowedStats(
    client: PoolClient,
    categoryId: string,
    subcategoryId: string | null,
    statCodes: readonly string[]
  ): Promise<void> {
    if (subcategoryId === null) {
      await client.query(
        `DELETE FROM category_allowed_stats
         WHERE category_id = $1 AND subcategory_id IS NULL`,
        [categoryId]
      );
    } else {
      await client.query(
        `DELETE FROM category_allowed_stats
         WHERE category_id = $1 AND subcategory_id = $2`,
        [categoryId, subcategoryId]
      );
    }

    for (const code of [...new Set(statCodes)].sort()) {
      await client.query(
        `INSERT INTO category_allowed_stats (category_id, subcategory_id, stat_code)
         VALUES ($1, $2, $3)`,
        [categoryId, subcategoryId, code]
      );
    }
  }

  private async replaceAllowedSpecialFields(
    client: PoolClient,
    categoryId: string,
    subcategoryId: string | null,
    fieldCodes: readonly string[]
  ): Promise<void> {
    if (subcategoryId === null) {
      await client.query(
        `DELETE FROM category_allowed_special_fields
         WHERE category_id = $1 AND subcategory_id IS NULL`,
        [categoryId]
      );
    } else {
      await client.query(
        `DELETE FROM category_allowed_special_fields
         WHERE category_id = $1 AND subcategory_id = $2`,
        [categoryId, subcategoryId]
      );
    }

    for (const code of [...new Set(fieldCodes)].sort()) {
      await client.query(
        `INSERT INTO category_allowed_special_fields (category_id, subcategory_id, field_code)
         VALUES ($1, $2, $3)`,
        [categoryId, subcategoryId, code]
      );
    }
  }
}
