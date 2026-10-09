import type {
  ItemCatalogPage,
  ItemCatalogQuery,
  ItemDetails,
  ItemDraftInput,
  ItemVersion,
  ItemVersionSummary
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
    this.assertRevision(expectedRevision);

    const metadata = await this.metadataRepository.listMetadata();
    assertValidItemDraft(input, metadata);
    return this.repository.updateDraft(itemId, input, expectedRevision, actor);
  }

  async publish(
    itemId: string,
    expectedRevision: number,
    actor: string
  ): Promise<ItemVersion> {
    this.assertRevision(expectedRevision);
    return this.repository.publish(itemId, expectedRevision, actor);
  }

  getItem(itemId: string): Promise<ItemDetails> {
    return this.repository.getItem(itemId);
  }

  getVersion(itemId: string, versionNo: number): Promise<ItemVersion> {
    this.assertVersionNo(versionNo);
    return this.repository.getVersion(itemId, versionNo);
  }

  listVersions(itemId: string): Promise<ItemVersionSummary[]> {
    return this.repository.listVersions(itemId);
  }

  async restoreVersion(
    itemId: string,
    sourceVersionNo: number,
    actor: string
  ): Promise<ItemVersion> {
    this.assertVersionNo(sourceVersionNo);
    return this.repository.restoreVersion(itemId, sourceVersionNo, actor);
  }

  async duplicate(
    itemId: string,
    newItemId: string,
    actor: string
  ): Promise<ItemVersion> {
    this.assertItemId(newItemId);
    if (await this.repository.itemIdExists(newItemId)) {
      throw new ItemConflictError(`ITEM_ID_CONFLICT:${newItemId}`);
    }

    const details = await this.repository.getItem(itemId);
    const source = details.item.activeVersionNo
      ? await this.repository.getVersion(itemId, details.item.activeVersionNo)
      : details.draft;
    if (!source) {
      throw new ItemValidationError(`ITEM_VERSION_NOT_AVAILABLE:${itemId}`);
    }

    try {
      return await this.repository.duplicate(source, newItemId, actor);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ItemConflictError(`ITEM_ID_CONFLICT:${newItemId}`);
      }
      throw error;
    }
  }

  archive(itemId: string, actor: string): Promise<void> {
    return this.repository.archive(itemId, actor);
  }

  listItems(query: ItemCatalogQuery): Promise<ItemCatalogPage> {
    return this.repository.listItems(query);
  }

  private assertRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new ItemValidationError("INVALID_EXPECTED_REVISION");
    }
  }

  private assertVersionNo(versionNo: number): void {
    if (!Number.isInteger(versionNo) || versionNo < 1) {
      throw new ItemValidationError("INVALID_VERSION_NO");
    }
  }

  private assertItemId(itemId: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(itemId) || itemId.length > 100) {
      throw new ItemValidationError("INVALID_ITEM_ID");
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === "object" && error !== null && (error as DatabaseError).code === "23505";
  }
}
