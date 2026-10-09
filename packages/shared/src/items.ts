export const ITEM_RARITIES = [
  "COMMON",
  "UNCOMMON",
  "RARE",
  "EPIC",
  "LEGENDARY"
] as const;

export const ITEM_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export const MODIFIER_TYPES = ["flat", "percent", "multiplier"] as const;
export const SOULBOUND_TYPES = ["NONE", "ON_PICKUP", "ON_EQUIP"] as const;

export type ItemRarity = (typeof ITEM_RARITIES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type ModifierType = (typeof MODIFIER_TYPES)[number];
export type SoulboundType = (typeof SOULBOUND_TYPES)[number];
export type StatCode = string;
export type EffectCode = string;
export type TriggerCode = string;

export interface ItemStatModifier {
  statCode: StatCode;
  modifierType: ModifierType;
  value: number;
}

export interface ItemRequirement {
  type: "LEVEL" | "PROFESSION" | "STAT" | "QUEST" | "TIER";
  code?: string;
  value?: number | string;
}

export interface ItemEffect {
  triggerCode: TriggerCode;
  effectCode: EffectCode;
  value?: number;
  chance?: number;
  durationMs?: number;
  cooldownMs?: number;
  condition?: Record<string, unknown>;
}

export interface ItemCategoryDefinition {
  id: string;
  name: string;
  system: boolean;
  allowedStatCodes: StatCode[];
}

export interface ItemSubcategoryDefinition {
  id: string;
  categoryId: string;
  name: string;
  system: boolean;
  allowedStatCodes: StatCode[];
}

export interface ItemDraftInput {
  itemId: string;
  name: string;
  categoryId: string;
  subcategoryId?: string;
  description: string;
  iconKey?: string;
  iconUrl?: string;
  rarity: ItemRarity;
  itemLevel: number;
  minimumLevel: number;
  sellValue: number;
  sellable: boolean;
  tradable: boolean;
  droppable: boolean;
  stackable: boolean;
  maxStack: number;
  weight: number;
  soulbound: SoulboundType;
  unique: boolean;
  tags: string[];
  stats: ItemStatModifier[];
  requirements: ItemRequirement[];
  effects: ItemEffect[];
  specialData: Record<string, unknown>;
}

export interface ItemDefinition extends ItemDraftInput {
  status: ItemStatus;
  activeVersionNo?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemVersion extends ItemDraftInput {
  versionNo: number;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  createdBy: string;
  createdAt: string;
}

export interface ItemVersionSummary {
  versionNo: number;
  revision: number;
  state: "DRAFT" | "PUBLISHED";
  createdBy: string;
  createdAt: string;
}

export interface ItemCreatorMetadata {
  categories: ItemCategoryDefinition[];
  subcategories: ItemSubcategoryDefinition[];
  stats: Array<{
    code: StatCode;
    label: string;
    modifierTypes: ModifierType[];
    minimum?: number;
    maximum?: number;
  }>;
  triggers: Array<{ code: TriggerCode; label: string }>;
  effects: Array<{ code: EffectCode; label: string }>;
}

export interface ItemDetails {
  item: ItemDefinition;
  draft?: ItemVersion;
  versions: ItemVersionSummary[];
}
