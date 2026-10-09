import type {
  ItemCategoryDefinition,
  ItemCreatorMetadata,
  ItemSubcategoryDefinition
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { AdminAuditRepository } from "../audit/AdminAuditRepository";
import { ENGINE_EFFECTS, ENGINE_STATS, ENGINE_TRIGGERS } from "./statRegistry";

export interface CreateCategoryInput {
  id: string;
  name: string;
  allowedStatCodes: string[];
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
    const [categoriesResult, subcategoriesResult, allowedResult, statsResult] =
      await Promise.all([
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
        this.pool.query<StatRow>(
          `SELECT code, label, allowed_modifier_types, minimum_value, maximum_value
           FROM stat_definitions
           ORDER BY code`
        )
      ]);

    const categoryStats = new Map<string, string[]>();
    const subcategoryStats = new Map<string, string[]>();

    for (const row of allowedResult.rows) {
      if (row.subcategory_id === null) {
        const list = categoryStats.get(row.category_id) ?? [];
        list.push(row.stat_code);
        categoryStats.set(row.category_id, list);
      } else {
        const key = `${row.category_id}:${row.subcategory_id}`;
        const list = subcategoryStats.get(key) ?? [];
        list.push(row.stat_code);
        subcategoryStats.set(key, list);
      }
    }

    return {
      categories: categoriesResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        system: row.system,
        allowedStatCodes: categoryStats.get(row.id) ?? []
      })),
      subcategories: subcategoriesResult.rows.map((row) => ({
        id: row.id,
        categoryId: row.category_id,
        name: row.name,
        system: row.system,
        allowedStatCodes:
          subcategoryStats.get(`${row.category_id}:${row.id}`) ?? []
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

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO item_categories (id, name, system)
         VALUES ($1, $2, FALSE)`,
        [input.id, input.name.trim()]
      );
      await this.replaceAllowedStats(client, input.id, null, input.allowedStatCodes);
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "CREATE_CATEGORY",
        objectType: "item_category",
        objectId: input.id,
        summary: {
          name: input.name.trim(),
          allowedStatCodes: [...new Set(input.allowedStatCodes)].sort()
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
      allowedStatCodes: [...new Set(input.allowedStatCodes)].sort()
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
      await this.audit.appendWithClient(client, {
        actorPlayerId: actor,
        action: "CREATE_SUBCATEGORY",
        objectType: "item_subcategory",
        objectId: `${input.categoryId}:${input.id}`,
        summary: {
          categoryId: input.categoryId,
          name: input.name.trim(),
          allowedStatCodes: [...new Set(input.allowedStatCodes)].sort()
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
      allowedStatCodes: [...new Set(input.allowedStatCodes)].sort()
    };
  }

  private validateStatCodes(statCodes: readonly string[]): void {
    for (const code of statCodes) {
      if (!ENGINE_STATS[code]) throw new Error(`UNKNOWN_STAT_CODE:${code}`);
    }
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
}
