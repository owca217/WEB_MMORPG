import type { ModifierType, StatCode } from "@web-mmorpg/shared";

export type StatFormattingKind =
  | "number"
  | "integer"
  | "percent"
  | "seconds"
  | "distance";

export interface EngineStatDefinition {
  code: StatCode;
  label: string;
  modifierTypes: readonly ModifierType[];
  minimum?: number;
  maximum?: number;
  formattingKind: StatFormattingKind;
}

const ALL_MODIFIERS = ["flat", "percent", "multiplier"] as const;
const FLAT_PERCENT = ["flat", "percent"] as const;

function numericStat(
  code: string,
  label: string,
  options: Partial<Omit<EngineStatDefinition, "code" | "label" | "modifierTypes">> = {}
): EngineStatDefinition {
  return {
    code,
    label,
    modifierTypes: ALL_MODIFIERS,
    minimum: -100000,
    maximum: 100000,
    formattingKind: "number",
    ...options
  };
}

function percentStat(code: string, label: string): EngineStatDefinition {
  return {
    code,
    label,
    modifierTypes: FLAT_PERCENT,
    minimum: -100,
    maximum: 1000,
    formattingKind: "percent"
  };
}

export const ENGINE_STATS: Readonly<Record<string, EngineStatDefinition>> = {
  STRENGTH: numericStat("STRENGTH", "Siła", { formattingKind: "integer" }),
  DEXTERITY: numericStat("DEXTERITY", "Zręczność", { formattingKind: "integer" }),
  INTELLIGENCE: numericStat("INTELLIGENCE", "Inteligencja", { formattingKind: "integer" }),
  VITALITY: numericStat("VITALITY", "Witalność", { formattingKind: "integer" }),
  LUCK: numericStat("LUCK", "Szczęście", { formattingKind: "integer" }),

  MAX_HP: numericStat("MAX_HP", "Maksymalne HP"),
  MAX_MANA: numericStat("MAX_MANA", "Maksymalna mana"),
  HP_REGEN: numericStat("HP_REGEN", "Regeneracja HP"),
  MANA_REGEN: numericStat("MANA_REGEN", "Regeneracja many"),

  MIN_DAMAGE: numericStat("MIN_DAMAGE", "Obrażenia minimalne"),
  MAX_DAMAGE: numericStat("MAX_DAMAGE", "Obrażenia maksymalne"),
  PHYSICAL_DAMAGE: numericStat("PHYSICAL_DAMAGE", "Obrażenia fizyczne"),
  MAGIC_DAMAGE: numericStat("MAGIC_DAMAGE", "Obrażenia magiczne"),
  FIRE_DAMAGE: numericStat("FIRE_DAMAGE", "Obrażenia ognia"),
  FROST_DAMAGE: numericStat("FROST_DAMAGE", "Obrażenia lodu"),
  POISON_DAMAGE: numericStat("POISON_DAMAGE", "Obrażenia trucizny"),
  LIGHTNING_DAMAGE: numericStat("LIGHTNING_DAMAGE", "Obrażenia elektryczne"),
  ATTACK_SPEED: numericStat("ATTACK_SPEED", "Szybkość ataku"),
  ATTACK_RANGE: numericStat("ATTACK_RANGE", "Zasięg ataku", {
    formattingKind: "distance"
  }),
  ACCURACY: percentStat("ACCURACY", "Celność"),
  CRIT_CHANCE: percentStat("CRIT_CHANCE", "Szansa na trafienie krytyczne"),
  CRIT_DAMAGE: percentStat("CRIT_DAMAGE", "Obrażenia krytyczne"),
  ARMOR_PENETRATION: percentStat("ARMOR_PENETRATION", "Penetracja pancerza"),
  LIFE_STEAL: percentStat("LIFE_STEAL", "Kradzież życia"),
  MANA_STEAL: percentStat("MANA_STEAL", "Kradzież many"),
  BLEED_CHANCE: percentStat("BLEED_CHANCE", "Szansa krwawienia"),
  BLEED_POWER: numericStat("BLEED_POWER", "Siła krwawienia"),
  BURN_CHANCE: percentStat("BURN_CHANCE", "Szansa podpalenia"),
  FREEZE_CHANCE: percentStat("FREEZE_CHANCE", "Szansa zamrożenia"),
  STUN_CHANCE: percentStat("STUN_CHANCE", "Szansa ogłuszenia"),
  KNOCKBACK: numericStat("KNOCKBACK", "Odrzut"),
  BACKSTAB_DAMAGE: percentStat("BACKSTAB_DAMAGE", "Obrażenia od tyłu"),
  RELOAD_TIME: numericStat("RELOAD_TIME", "Czas przeładowania", {
    formattingKind: "seconds"
  }),
  SPELL_POWER: numericStat("SPELL_POWER", "Moc zaklęć"),
  CAST_SPEED: numericStat("CAST_SPEED", "Szybkość rzucania zaklęć"),

  ARMOR: numericStat("ARMOR", "Pancerz fizyczny"),
  MAGIC_RESIST: percentStat("MAGIC_RESIST", "Odporność magiczna"),
  FIRE_RESIST: percentStat("FIRE_RESIST", "Odporność na ogień"),
  FROST_RESIST: percentStat("FROST_RESIST", "Odporność na lód"),
  POISON_RESIST: percentStat("POISON_RESIST", "Odporność na truciznę"),
  LIGHTNING_RESIST: percentStat("LIGHTNING_RESIST", "Odporność na pioruny"),
  DODGE_CHANCE: percentStat("DODGE_CHANCE", "Unik"),
  BLOCK_CHANCE: percentStat("BLOCK_CHANCE", "Szansa bloku"),
  BLOCK_POWER: numericStat("BLOCK_POWER", "Siła bloku"),
  MOVE_SPEED: numericStat("MOVE_SPEED", "Prędkość ruchu"),
  DAMAGE_REDUCTION: percentStat("DAMAGE_REDUCTION", "Redukcja obrażeń"),
  STUN_RESIST: percentStat("STUN_RESIST", "Odporność na ogłuszenie"),
  SLOW_RESIST: percentStat("SLOW_RESIST", "Odporność na spowolnienie"),
  BLEED_RESIST: percentStat("BLEED_RESIST", "Odporność na krwawienie"),

  XP_BONUS: percentStat("XP_BONUS", "Bonus do doświadczenia"),
  GOLD_BONUS: percentStat("GOLD_BONUS", "Bonus do złota"),

  HEAL_AMOUNT: numericStat("HEAL_AMOUNT", "Wartość leczenia"),
  MANA_RESTORE: numericStat("MANA_RESTORE", "Przywracana mana"),
  EFFECT_DURATION: numericStat("EFFECT_DURATION", "Czas działania", {
    formattingKind: "seconds"
  }),
  USE_COOLDOWN: numericStat("USE_COOLDOWN", "Cooldown użycia", {
    formattingKind: "seconds"
  }),
  USE_TIME: numericStat("USE_TIME", "Czas użycia", { formattingKind: "seconds" }),
  USE_COUNT: numericStat("USE_COUNT", "Liczba użyć", { formattingKind: "integer" }),
  EFFECT_POWER: numericStat("EFFECT_POWER", "Siła efektu"),
  EFFECT_CHANCE: percentStat("EFFECT_CHANCE", "Szansa efektu"),

  TOOL_POWER: numericStat("TOOL_POWER", "Siła narzędzia"),
  GATHER_SPEED: numericStat("GATHER_SPEED", "Szybkość zbierania"),
  DURABILITY: numericStat("DURABILITY", "Trwałość"),
  MAX_DURABILITY: numericStat("MAX_DURABILITY", "Maksymalna trwałość"),
  GATHER_BONUS: percentStat("GATHER_BONUS", "Bonus do zbierania"),
  EXTRA_RESOURCE_CHANCE: percentStat(
    "EXTRA_RESOURCE_CHANCE",
    "Szansa dodatkowego surowca"
  ),

  EXTRA_SLOTS: numericStat("EXTRA_SLOTS", "Dodatkowe sloty", {
    formattingKind: "integer"
  }),
  MAX_CARRY_WEIGHT: numericStat("MAX_CARRY_WEIGHT", "Maksymalna waga"),
  WEIGHT_REDUCTION: percentStat("WEIGHT_REDUCTION", "Redukcja ciężaru"),

  UPGRADE_BONUS: numericStat("UPGRADE_BONUS", "Wartość ulepszenia"),
  UPGRADE_SUCCESS_CHANCE: percentStat(
    "UPGRADE_SUCCESS_CHANCE",
    "Szansa powodzenia ulepszenia"
  ),
  UPGRADE_DESTROY_CHANCE: percentStat(
    "UPGRADE_DESTROY_CHANCE",
    "Szansa zniszczenia przy ulepszaniu"
  )
};

export const ENGINE_TRIGGERS = {
  ON_HIT: { code: "ON_HIT", label: "Po trafieniu" },
  ON_DAMAGE_TAKEN: { code: "ON_DAMAGE_TAKEN", label: "Po otrzymaniu obrażeń" },
  ON_CRIT: { code: "ON_CRIT", label: "Przy trafieniu krytycznym" },
  ON_KILL: { code: "ON_KILL", label: "Po zabiciu przeciwnika" },
  HEALTH_BELOW: { code: "HEALTH_BELOW", label: "Gdy HP spadnie poniżej progu" },
  ON_SKILL_USE: { code: "ON_SKILL_USE", label: "Po użyciu umiejętności" },
  PERIODIC: { code: "PERIODIC", label: "Okresowo" }
} as const;

export const ENGINE_EFFECTS = {
  DEAL_DAMAGE: { code: "DEAL_DAMAGE", label: "Zadaj obrażenia" },
  HEAL: { code: "HEAL", label: "Ulecz" },
  RESTORE_MANA: { code: "RESTORE_MANA", label: "Odnów manę" },
  APPLY_BUFF: { code: "APPLY_BUFF", label: "Nałóż buff" },
  APPLY_DEBUFF: { code: "APPLY_DEBUFF", label: "Nałóż debuff" },
  BURN: { code: "BURN", label: "Podpal" },
  POISON: { code: "POISON", label: "Zatruj" },
  STUN: { code: "STUN", label: "Ogłusz" },
  SLOW: { code: "SLOW", label: "Spowolnij" },
  SUMMON: { code: "SUMMON", label: "Przywołaj jednostkę" }
} as const;

export interface SystemCategorySeed {
  id: string;
  name: string;
  allowedStatCodes: readonly string[];
}

export interface SystemSubcategorySeed {
  id: string;
  categoryId: string;
  name: string;
  allowedStatCodes: readonly string[];
}

const WEAPON_STATS = [
  "MIN_DAMAGE",
  "MAX_DAMAGE",
  "PHYSICAL_DAMAGE",
  "MAGIC_DAMAGE",
  "FIRE_DAMAGE",
  "FROST_DAMAGE",
  "POISON_DAMAGE",
  "LIGHTNING_DAMAGE",
  "ATTACK_SPEED",
  "ATTACK_RANGE",
  "ACCURACY",
  "CRIT_CHANCE",
  "CRIT_DAMAGE",
  "ARMOR_PENETRATION",
  "LIFE_STEAL",
  "MANA_STEAL",
  "BLEED_CHANCE",
  "BLEED_POWER",
  "BURN_CHANCE",
  "FREEZE_CHANCE",
  "STUN_CHANCE",
  "KNOCKBACK",
  "BACKSTAB_DAMAGE",
  "RELOAD_TIME",
  "SPELL_POWER",
  "CAST_SPEED",
  "MAX_MANA",
  "MANA_REGEN"
] as const;

const ARMOR_STATS = [
  "ARMOR",
  "MAGIC_RESIST",
  "FIRE_RESIST",
  "FROST_RESIST",
  "POISON_RESIST",
  "LIGHTNING_RESIST",
  "MAX_HP",
  "MAX_MANA",
  "HP_REGEN",
  "MANA_REGEN",
  "DODGE_CHANCE",
  "BLOCK_CHANCE",
  "BLOCK_POWER",
  "MOVE_SPEED",
  "DAMAGE_REDUCTION",
  "STUN_RESIST",
  "SLOW_RESIST",
  "BLEED_RESIST"
] as const;

const JEWELRY_STATS = [
  "STRENGTH",
  "DEXTERITY",
  "INTELLIGENCE",
  "VITALITY",
  "LUCK",
  "MAX_HP",
  "MAX_MANA",
  "HP_REGEN",
  "MANA_REGEN",
  "CRIT_CHANCE",
  "CRIT_DAMAGE",
  "DODGE_CHANCE",
  "ACCURACY",
  "ARMOR_PENETRATION",
  "MAGIC_RESIST",
  "FIRE_RESIST",
  "FROST_RESIST",
  "POISON_RESIST",
  "LIGHTNING_RESIST",
  "XP_BONUS",
  "GOLD_BONUS"
] as const;

const CONSUMABLE_STATS = [
  "HEAL_AMOUNT",
  "MANA_RESTORE",
  "EFFECT_DURATION",
  "USE_COOLDOWN",
  "USE_TIME",
  "USE_COUNT",
  "EFFECT_POWER",
  "EFFECT_CHANCE"
] as const;

const TOOL_STATS = [
  "TOOL_POWER",
  "GATHER_SPEED",
  "DURABILITY",
  "MAX_DURABILITY",
  "GATHER_BONUS",
  "EXTRA_RESOURCE_CHANCE"
] as const;

const BACKPACK_STATS = [
  "EXTRA_SLOTS",
  "MAX_CARRY_WEIGHT",
  "WEIGHT_REDUCTION",
  "GATHER_BONUS"
] as const;

const AMMO_STATS = [
  "PHYSICAL_DAMAGE",
  "MAGIC_DAMAGE",
  "FIRE_DAMAGE",
  "FROST_DAMAGE",
  "POISON_DAMAGE",
  "LIGHTNING_DAMAGE",
  "ARMOR_PENETRATION"
] as const;

export const SYSTEM_CATEGORIES: readonly SystemCategorySeed[] = [
  { id: "weapon", name: "Broń", allowedStatCodes: WEAPON_STATS },
  { id: "armor", name: "Pancerz", allowedStatCodes: ARMOR_STATS },
  { id: "jewelry", name: "Biżuteria", allowedStatCodes: JEWELRY_STATS },
  { id: "consumable", name: "Konsumpcyjne", allowedStatCodes: CONSUMABLE_STATS },
  { id: "material", name: "Materiały", allowedStatCodes: [] },
  { id: "tool", name: "Narzędzia", allowedStatCodes: TOOL_STATS },
  { id: "crafting-item", name: "Przedmioty craftingowe", allowedStatCodes: [] },
  { id: "quest", name: "Questowe", allowedStatCodes: [] },
  { id: "key", name: "Klucze", allowedStatCodes: [] },
  { id: "container", name: "Kontenery", allowedStatCodes: [] },
  { id: "backpack", name: "Plecaki", allowedStatCodes: BACKPACK_STATS },
  { id: "ammunition", name: "Amunicja", allowedStatCodes: AMMO_STATS },
  {
    id: "upgrade-item",
    name: "Przedmioty do ulepszania",
    allowedStatCodes: ["UPGRADE_BONUS", "UPGRADE_SUCCESS_CHANCE", "UPGRADE_DESTROY_CHANCE"]
  },
  {
    id: "rune-gem",
    name: "Runy i klejnoty",
    allowedStatCodes: Object.keys(ENGINE_STATS)
  },
  {
    id: "special",
    name: "Przedmioty specjalne",
    allowedStatCodes: Object.keys(ENGINE_STATS)
  }
];

export const SYSTEM_SUBCATEGORIES: readonly SystemSubcategorySeed[] = [
  {
    id: "sword",
    categoryId: "weapon",
    name: "Miecze",
    allowedStatCodes: [
      "MIN_DAMAGE",
      "MAX_DAMAGE",
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "CRIT_CHANCE",
      "CRIT_DAMAGE",
      "ARMOR_PENETRATION",
      "ATTACK_RANGE",
      "LIFE_STEAL",
      "BLEED_CHANCE"
    ]
  },
  {
    id: "axe",
    categoryId: "weapon",
    name: "Topory",
    allowedStatCodes: [
      "MIN_DAMAGE",
      "MAX_DAMAGE",
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "ARMOR_PENETRATION",
      "BLEED_CHANCE",
      "BLEED_POWER"
    ]
  },
  {
    id: "hammer",
    categoryId: "weapon",
    name: "Młoty",
    allowedStatCodes: [
      "MIN_DAMAGE",
      "MAX_DAMAGE",
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "ARMOR_PENETRATION",
      "STUN_CHANCE",
      "KNOCKBACK"
    ]
  },
  {
    id: "dagger",
    categoryId: "weapon",
    name: "Sztylety",
    allowedStatCodes: [
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "CRIT_CHANCE",
      "CRIT_DAMAGE",
      "BACKSTAB_DAMAGE",
      "LIFE_STEAL"
    ]
  },
  {
    id: "spear",
    categoryId: "weapon",
    name: "Włócznie",
    allowedStatCodes: [
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "ATTACK_RANGE",
      "ARMOR_PENETRATION"
    ]
  },
  {
    id: "bow",
    categoryId: "weapon",
    name: "Łuki",
    allowedStatCodes: [
      "PHYSICAL_DAMAGE",
      "ATTACK_SPEED",
      "ATTACK_RANGE",
      "ACCURACY",
      "CRIT_CHANCE",
      "CRIT_DAMAGE"
    ]
  },
  {
    id: "crossbow",
    categoryId: "weapon",
    name: "Kusze",
    allowedStatCodes: [
      "PHYSICAL_DAMAGE",
      "ATTACK_RANGE",
      "ACCURACY",
      "ARMOR_PENETRATION",
      "RELOAD_TIME",
      "CRIT_CHANCE"
    ]
  },
  {
    id: "staff",
    categoryId: "weapon",
    name: "Kostury",
    allowedStatCodes: [
      "MAGIC_DAMAGE",
      "SPELL_POWER",
      "CAST_SPEED",
      "MAX_MANA",
      "MANA_REGEN",
      "CRIT_CHANCE",
      "FIRE_DAMAGE",
      "FROST_DAMAGE",
      "LIGHTNING_DAMAGE",
      "POISON_DAMAGE"
    ]
  },
  {
    id: "wand",
    categoryId: "weapon",
    name: "Różdżki",
    allowedStatCodes: ["MAGIC_DAMAGE", "SPELL_POWER", "CAST_SPEED", "CRIT_CHANCE"]
  },
  {
    id: "offensive-shield",
    categoryId: "weapon",
    name: "Tarcze ofensywne",
    allowedStatCodes: ["PHYSICAL_DAMAGE", "ARMOR", "BLOCK_CHANCE", "BLOCK_POWER", "STUN_CHANCE"]
  },
  {
    id: "two-handed",
    categoryId: "weapon",
    name: "Broń dwuręczna",
    allowedStatCodes: [
      "MIN_DAMAGE",
      "MAX_DAMAGE",
      "PHYSICAL_DAMAGE",
      "MAGIC_DAMAGE",
      "ATTACK_SPEED",
      "ARMOR_PENETRATION",
      "CRIT_DAMAGE",
      "ATTACK_RANGE"
    ]
  },

  { id: "helmet", categoryId: "armor", name: "Hełm", allowedStatCodes: ARMOR_STATS },
  { id: "chest", categoryId: "armor", name: "Napierśnik", allowedStatCodes: ARMOR_STATS },
  { id: "gloves", categoryId: "armor", name: "Rękawice", allowedStatCodes: [...ARMOR_STATS, "ATTACK_SPEED", "CRIT_CHANCE"] },
  { id: "boots", categoryId: "armor", name: "Buty", allowedStatCodes: [...ARMOR_STATS, "MOVE_SPEED", "DODGE_CHANCE"] },
  { id: "pants", categoryId: "armor", name: "Spodnie", allowedStatCodes: ARMOR_STATS },
  { id: "cloak", categoryId: "armor", name: "Płaszcz", allowedStatCodes: ARMOR_STATS },
  { id: "shield", categoryId: "armor", name: "Tarcza", allowedStatCodes: ["ARMOR", "BLOCK_CHANCE", "BLOCK_POWER", "MAGIC_RESIST", "FIRE_RESIST", "FROST_RESIST", "POISON_RESIST", "LIGHTNING_RESIST"] },

  { id: "ring", categoryId: "jewelry", name: "Pierścień", allowedStatCodes: JEWELRY_STATS },
  { id: "amulet", categoryId: "jewelry", name: "Amulet", allowedStatCodes: JEWELRY_STATS },
  { id: "talisman", categoryId: "jewelry", name: "Talizman", allowedStatCodes: JEWELRY_STATS },
  { id: "bracelet", categoryId: "jewelry", name: "Bransoleta", allowedStatCodes: JEWELRY_STATS },

  { id: "health-potion", categoryId: "consumable", name: "Mikstura HP", allowedStatCodes: ["HEAL_AMOUNT", "USE_COOLDOWN", "USE_TIME", "USE_COUNT"] },
  { id: "mana-potion", categoryId: "consumable", name: "Mikstura many", allowedStatCodes: ["MANA_RESTORE", "USE_COOLDOWN", "USE_TIME", "USE_COUNT"] },
  { id: "elixir", categoryId: "consumable", name: "Eliksir", allowedStatCodes: CONSUMABLE_STATS },
  { id: "food", categoryId: "consumable", name: "Jedzenie", allowedStatCodes: CONSUMABLE_STATS },
  { id: "drink", categoryId: "consumable", name: "Napój", allowedStatCodes: CONSUMABLE_STATS },
  { id: "antidote", categoryId: "consumable", name: "Antidotum", allowedStatCodes: ["USE_COOLDOWN", "USE_TIME", "USE_COUNT", "EFFECT_POWER"] },
  { id: "bandage", categoryId: "consumable", name: "Bandaż", allowedStatCodes: ["HEAL_AMOUNT", "EFFECT_DURATION", "USE_TIME", "USE_COUNT"] },
  { id: "scroll", categoryId: "consumable", name: "Zwój", allowedStatCodes: CONSUMABLE_STATS },

  { id: "ore", categoryId: "material", name: "Rudy", allowedStatCodes: [] },
  { id: "wood", categoryId: "material", name: "Drewno", allowedStatCodes: [] },
  { id: "hide", categoryId: "material", name: "Skóry", allowedStatCodes: [] },
  { id: "cloth", categoryId: "material", name: "Tkaniny", allowedStatCodes: [] },
  { id: "stone", categoryId: "material", name: "Kamienie", allowedStatCodes: [] },
  { id: "herb", categoryId: "material", name: "Zioła", allowedStatCodes: [] },
  { id: "crystal", categoryId: "material", name: "Kryształy", allowedStatCodes: [] },
  { id: "monster-part", categoryId: "material", name: "Części potworów", allowedStatCodes: [] },
  { id: "magic-material", categoryId: "material", name: "Materiały magiczne", allowedStatCodes: [] }
];
