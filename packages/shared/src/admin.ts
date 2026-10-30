import type { ItemDefinition, ItemStatus } from "./items";
import type { InventorySnapshot } from "./inventory";

export interface AdminItemGrantInput {
  characterId: string;
  quantity: number;
  requestId: string;
}

export interface AdminItemGrantResult {
  characterId: string;
  inventory: InventorySnapshot;
}

export const USER_ROLES = ["PLAYER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AdminSession {
  playerId: string;
  sessionToken: string;
  role: UserRole;
}

export interface ItemCatalogQuery {
  search?: string;
  itemId?: string;
  categoryId?: string;
  subcategoryId?: string;
  rarity?: ItemDefinition["rarity"];
  minimumLevel?: number;
  maximumLevel?: number;
  status?: ItemStatus;
  page?: number;
  pageSize?: number;
}

export interface ItemCatalogPage {
  items: ItemDefinition[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}
