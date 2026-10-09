import type {
  ItemCatalogPage,
  ItemCatalogQuery,
  ItemDetails,
  ItemDraftInput,
  ItemVersion
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { ItemCatalogRepository } from "./ItemCatalogRepository";
import { ItemMetadataRepository } from "./ItemMetadataRepository";
import {
  assertValidItemDraft,
  ItemConflictError,
  ItemValidationError
} from "./itemValidation";

interface DatabaseError {
  code?: string;
}

export class ItemCatalogService {
  private readonly repository: ItemCatalogRepository;

  constructor(
    pool: Pool,
    private readonly metadataRepository: ItemMetadataRepository
  ) {
    this.repository = new ItemCatalogRepository(pool);
  }

  async createDraft(input: ItemDraftInput, actor: string): Promise<ItemVersion> {
    const metadata = await this.metadataRepository.listMetadata();
    assertValidItemDraft(input, metadata);

    if (await this.repository.itemIdExists(input.itemId)) {
      throw new ItemConflictError(`ITEM_ID_CONFLICT:${input.itemId}`);
    }

    try {
      return await this.repository.createDraft(input, actor);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ItemConflictError(`ITEM_ID_CONFLICT:${input.itemId}`);
      }
      throw error;
    }
  }

  async updateDraft(
    itemId: string,
    input: ItemDraftInput,
    expectedRevision: number,
    actor: string
  ): Promise<ItemVersion> {
    if (input.itemId !== itemId) {
      throw new ItemValidationError("ITEM_ID_IMMUTABLE");
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new ItemValidationError("INVALID_EXPECTED_REVISION");
    }

    const metadata = await this.metadataRepository.listMetadata();
    assertValidItemDraft(input, metadata);
    return this.repository.updateDraft(itemId, input, expectedRevision, actor);
  }

  getItem(itemId: string): Promise<ItemDetails> {
    return this.repository.getItem(itemId);
  }

  listItems(query: ItemCatalogQuery): Promise<ItemCatalogPage> {
    return this.repository.listItems(query);
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as DatabaseError).code === "23505";
  }
}
