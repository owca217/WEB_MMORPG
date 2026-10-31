import type { ItemStatModifier } from "@web-mmorpg/shared";
import type { StarterItemSeed } from "./seedStarterItems";

interface StarterWeaponContent {
  itemId: string;
  subcategoryId: string;
  name: string;
  description: string;
  weight: number;
  sellValue: number;
  weaponFamily?: string;
  stats: readonly ItemStatModifier[];
}

function seedUuid(number: number): string {
  return `20000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function weapon(seedNumber: number, content: StarterWeaponContent): StarterItemSeed {
  return {
    itemUuid: seedUuid(seedNumber),
    versionUuid: seedUuid(100 + seedNumber),
    itemId: content.itemId,
    categoryId: "weapon",
    subcategoryId: content.subcategoryId,
    name: content.name,
    description: content.description,
    stackable: false,
    maxStack: 1,
    weight: content.weight,
    minimumLevel: 1,
    sellValue: content.sellValue,
    tags: ["starter", "weapon"],
    icon: {
      key: `db-icons-${seedUuid(200 + seedNumber)}.png`,
      assetUrl: new URL(`../../assets/items/${content.itemId}.png`, import.meta.url)
    },
    specialData: {
      ...(content.weaponFamily ? { weaponFamily: content.weaponFamily } : {}),
      durability: 40,
      maxDurability: 40,
      socketCount: 0
    },
    stats: content.stats.map((stat, index) => ({
      ...stat,
      id: seedUuid(1000 + seedNumber * 10 + index)
    }))
  };
}

// Seed numbers are permanent identities: keep existing numbers when adding content.
export const STARTER_WEAPON_ITEMS: readonly StarterItemSeed[] = [
  weapon(1, {
    itemId: "starter-sword", subcategoryId: "sword", weaponFamily: "sword",
    name: "Miecz rekruta",
    description: "Prosty żelazny miecz z owiniętą skórą rękojeścią. W sam raz na pierwszą wyprawę.",
    weight: 1.8, sellValue: 5,
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 4 }]
  }),
  weapon(2, {
    itemId: "starter-axe", subcategoryId: "axe", weaponFamily: "axe",
    name: "Topór drwala",
    description: "Niewielki żelazny topór na drewnianym trzonku, przydatny także do obrony poza osadą.",
    weight: 2.4, sellValue: 5,
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 5 }]
  }),
  weapon(3, {
    itemId: "starter-hammer", subcategoryId: "hammer", weaponFamily: "hammer",
    name: "Młot czeladnika",
    description: "Ciężki żelazny młot osadzony na krótkim, solidnym trzonku.",
    weight: 3, sellValue: 6,
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 6 }]
  }),
  weapon(4, {
    itemId: "starter-dagger", subcategoryId: "dagger", weaponFamily: "dagger",
    name: "Sztylet wędrowca",
    description: "Lekki sztylet o wąskim żelaznym ostrzu i skórzanej rękojeści.",
    weight: 0.6, sellValue: 3,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 3 },
      { statCode: "CRIT_CHANCE", modifierType: "flat", value: 2 }
    ]
  }),
  weapon(5, {
    itemId: "starter-spear", subcategoryId: "spear", weaponFamily: "spear",
    name: "Włócznia strażnika",
    description: "Długi jesionowy drzewiec z prostym żelaznym grotem i ciasnym skórzanym wiązaniem.",
    weight: 2.2, sellValue: 5,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 4 },
      { statCode: "ATTACK_RANGE", modifierType: "flat", value: 2 }
    ]
  }),
  weapon(6, {
    itemId: "starter-bow", subcategoryId: "bow", weaponFamily: "bow",
    name: "Łuk myśliwski",
    description: "Prosty drewniany łuk z mocną cięciwą i skórzanym uchwytem.",
    weight: 1, sellValue: 5,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 4 },
      { statCode: "ATTACK_RANGE", modifierType: "flat", value: 5 }
    ]
  }),
  weapon(7, {
    itemId: "starter-crossbow", subcategoryId: "crossbow", weaponFamily: "crossbow",
    name: "Kusza wartownika",
    description: "Niewielka kusza z drewnianym łożem, żelaznym łuczyskiem i prostym mechanizmem spustowym.",
    weight: 2.8, sellValue: 7,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 6 },
      { statCode: "ATTACK_RANGE", modifierType: "flat", value: 5 },
      { statCode: "RELOAD_TIME", modifierType: "flat", value: 2 }
    ]
  }),
  weapon(8, {
    itemId: "starter-staff", subcategoryId: "staff", weaponFamily: "staff",
    name: "Kostur ucznia",
    description: "Drewniany kostur z niewielkim kryształem, używany do pierwszych ćwiczeń magicznych.",
    weight: 1.6, sellValue: 6,
    stats: [
      { statCode: "MAGIC_DAMAGE", modifierType: "flat", value: 4 },
      { statCode: "SPELL_POWER", modifierType: "flat", value: 1 }
    ]
  }),
  weapon(9, {
    itemId: "starter-wand", subcategoryId: "wand", weaponFamily: "wand",
    name: "Różdżka nowicjusza",
    description: "Krótka drewniana różdżka ze skromnym kryształem i owiniętym skórą uchwytem.",
    weight: 0.2, sellValue: 4,
    stats: [
      { statCode: "MAGIC_DAMAGE", modifierType: "flat", value: 3 },
      { statCode: "SPELL_POWER", modifierType: "flat", value: 1 }
    ]
  }),
  weapon(10, {
    itemId: "starter-offensive-shield", subcategoryId: "offensive-shield",
    name: "Puklerz milicjanta",
    description: "Mała drewniana tarcza z żelaznym guzem, którym można odepchnąć napastnika.",
    weight: 2.5, sellValue: 5,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 2 },
      { statCode: "ARMOR", modifierType: "flat", value: 2 },
      { statCode: "BLOCK_CHANCE", modifierType: "flat", value: 3 }
    ]
  }),
  weapon(11, {
    itemId: "starter-two-handed", subcategoryId: "two-handed", weaponFamily: "sword",
    name: "Dwuręczny miecz milicji",
    description: "Długi żelazny miecz z oburęczną rękojeścią. Mocny, choć mniej poręczny od krótszej broni.",
    weight: 3.5, sellValue: 8,
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 7 },
      { statCode: "ATTACK_SPEED", modifierType: "percent", value: -10 }
    ]
  })
];
