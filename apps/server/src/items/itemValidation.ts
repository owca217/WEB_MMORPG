import {
  ITEM_RARITIES,
  MODIFIER_TYPES,
  SOULBOUND_TYPES,
  type ItemCreatorMetadata,
  type ItemDraftInput
} from "@web-mmorpg/shared";
import { z } from "zod";

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const finiteNumber = z.number().finite();

const statSchema = z.object({
  statCode: z.string().min(1).max(80),
  modifierType: z.enum(MODIFIER_TYPES),
  value: finiteNumber
});

const requirementSchema = z.object({
  type: z.enum(["LEVEL", "PROFESSION", "STAT", "QUEST", "TIER"]),
  code: z.string().min(1).max(120).optional(),
  value: z.union([finiteNumber, z.string().max(240)]).optional()
});

const effectSchema = z.object({
  triggerCode: z.string().min(1).max(80),
  effectCode: z.string().min(1).max(80),
  value: finiteNumber.optional(),
  chance: finiteNumber.min(0).max(1).optional(),
  durationMs: z.number().int().min(0).optional(),
  cooldownMs: z.number().int().min(0).optional(),
  condition: z.record(z.string(), z.unknown()).optional()
});

const itemDraftSchema = z
  .object({
    itemId: slug.max(100),
    name: z.string().trim().min(1).max(120),
    categoryId: slug.max(100),
    subcategoryId: slug.max(100).optional(),
    description: z.string().max(4000),
    iconKey: z.string().min(1).max(500).optional(),
    iconUrl: z.string().url().max(2000).optional(),
    rarity: z.enum(ITEM_RARITIES),
    itemLevel: z.number().int().min(0).max(1_000_000),
    minimumLevel: z.number().int().min(0).max(1_000_000),
    sellValue: finiteNumber.min(0).max(1_000_000_000_000),
    sellable: z.boolean(),
    tradable: z.boolean(),
    droppable: z.boolean(),
    stackable: z.boolean(),
    maxStack: z.number().int().min(1).max(1_000_000),
    weight: finiteNumber.min(0).max(1_000_000_000),
    soulbound: z.enum(SOULBOUND_TYPES),
    unique: z.boolean(),
    tags: z.array(slug.max(100)).max(100),
    stats: z.array(statSchema).max(200),
    requirements: z.array(requirementSchema).max(100),
    effects: z.array(effectSchema).max(100),
    specialData: z.record(z.string(), z.unknown())
  })
  .superRefine((draft, context) => {
    if (!draft.stackable && draft.maxStack !== 1) {
      context.addIssue({
        code: "custom",
        path: ["maxStack"],
        message: "Non-stackable items must have maxStack=1"
      });
    }
  });

export interface ValidationFailure {
  ok: false;
  code: string;
  fieldErrors?: Record<string, string>;
}

export type ValidationResult = { ok: true } | ValidationFailure;

export class ItemValidationError extends Error {
  readonly code = "ITEM_VALIDATION";
  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string>
  ) {
    super(message);
    this.name = "ItemValidationError";
  }
}

export class ItemConflictError extends Error {
  readonly code = "ITEM_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "ItemConflictError";
  }
}

export class ItemNotFoundError extends Error {
  readonly code = "ITEM_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "ItemNotFoundError";
  }
}

export function validateItemDraft(
  input: ItemDraftInput,
  metadata: ItemCreatorMetadata
): ValidationResult {
  const structural = itemDraftSchema.safeParse(input);
  if (!structural.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of structural.error.issues) {
      const path = issue.path.join(".") || "form";
      if (!(path in fieldErrors)) fieldErrors[path] = issue.message;
    }
    return { ok: false, code: "INVALID_ITEM_DRAFT", fieldErrors };
  }

  const category = metadata.categories.find((entry) => entry.id === input.categoryId);
  if (!category) return { ok: false, code: `CATEGORY_NOT_FOUND:${input.categoryId}` };

  let allowedStats = new Set(category.allowedStatCodes);
  if (input.subcategoryId) {
    const subcategory = metadata.subcategories.find(
      (entry) =>
        entry.id === input.subcategoryId && entry.categoryId === input.categoryId
    );
    if (!subcategory) {
      return {
        ok: false,
        code: `SUBCATEGORY_NOT_FOUND:${input.categoryId}:${input.subcategoryId}`
      };
    }
    allowedStats = new Set(subcategory.allowedStatCodes);
  }

  const statDefinitions = new Map(metadata.stats.map((stat) => [stat.code, stat]));
  const seenStats = new Set<string>();
  for (const modifier of input.stats) {
    const stat = statDefinitions.get(modifier.statCode);
    if (!stat) return { ok: false, code: `UNKNOWN_STAT_CODE:${modifier.statCode}` };
    if (!allowedStats.has(modifier.statCode)) {
      return { ok: false, code: `STAT_NOT_ALLOWED:${modifier.statCode}` };
    }
    if (!stat.modifierTypes.includes(modifier.modifierType)) {
      return {
        ok: false,
        code: `MODIFIER_TYPE_NOT_ALLOWED:${modifier.statCode}:${modifier.modifierType}`
      };
    }
    if (
      (stat.minimum !== undefined && modifier.value < stat.minimum) ||
      (stat.maximum !== undefined && modifier.value > stat.maximum)
    ) {
      return {
        ok: false,
        code: `STAT_VALUE_OUT_OF_RANGE:${modifier.statCode}`
      };
    }

    const key = `${modifier.statCode}:${modifier.modifierType}`;
    if (seenStats.has(key)) return { ok: false, code: `DUPLICATE_STAT:${key}` };
    seenStats.add(key);
  }

  const minimumDamage = input.stats.find(
    (stat) => stat.statCode === "MIN_DAMAGE" && stat.modifierType === "flat"
  );
  const maximumDamage = input.stats.find(
    (stat) => stat.statCode === "MAX_DAMAGE" && stat.modifierType === "flat"
  );
  if (
    minimumDamage &&
    maximumDamage &&
    minimumDamage.value > maximumDamage.value
  ) {
    return { ok: false, code: "MIN_DAMAGE_EXCEEDS_MAX_DAMAGE" };
  }

  const triggerCodes = new Set(metadata.triggers.map((trigger) => trigger.code));
  const effectCodes = new Set(metadata.effects.map((effect) => effect.code));
  for (const effect of input.effects) {
    if (!triggerCodes.has(effect.triggerCode)) {
      return { ok: false, code: `UNKNOWN_TRIGGER_CODE:${effect.triggerCode}` };
    }
    if (!effectCodes.has(effect.effectCode)) {
      return { ok: false, code: `UNKNOWN_EFFECT_CODE:${effect.effectCode}` };
    }
  }

  return { ok: true };
}

export function assertValidItemDraft(
  input: ItemDraftInput,
  metadata: ItemCreatorMetadata
): void {
  const result = validateItemDraft(input, metadata);
  if (!result.ok) throw new ItemValidationError(result.code, result.fieldErrors);
}
