import type { InventorySnapshot } from "./inventory";
import type { ItemQuality } from "./itemQuality";

export interface MerchantOffer {
  itemId: string;
  name: string;
  description: string;
  categoryId: string;
  quality?: ItemQuality;
  unitPrice: number;
  healHp?: number;
  restoreAp?: number;
  capacity?: number;
  maxQuantity: number;
}

export interface MerchantSnapshot {
  npcId: string;
  npcName: string;
  gold: number;
  offers: MerchantOffer[];
}

export interface MerchantPurchase {
  npcId: string;
  requestId: string;
  itemId: string;
  quantity: number;
}

export type MerchantResult =
  | { ok: true; shop: MerchantSnapshot; inventory?: InventorySnapshot }
  | { ok: false; code: string; message: string };
