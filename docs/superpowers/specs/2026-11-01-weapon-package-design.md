# Balanced weapon package

User approved this design in chat and requested implementation on 2026-11-01.

## Intent and scope

Add 66 new usable weapons, six each in sword, axe, hammer, dagger, spear, bow, crossbow, staff, wand, offensive-shield and two-handed, at item/minimum levels 1,5,10,15,20,30. Publish to ADMIN catalog only. No shop, loot, unsolicited player grants, deployment or skill-tree implementation. Preserve existing definitions, authored versions, assets and inventory instances.

Wand is a one-handed magical ranged weapon with new wand proficiency and shield compatibility. Offensive shield occupies offHand, uses shield proficiency, trades defense for main-hand damage. Existing combat commands, AP, range, line of sight, armor/block mitigation and half-XP split remain authoritative.

## Exact item profiles

All numbers are flat item bonuses, in level order 1/5/10/15/20/30.

| Category | PHYSICAL_DAMAGE | Other |
|---|---|---|
| sword | 12/17/23/29/35/47 | ARMOR 2/3/4/5/6/8 |
| axe | 13/19/25/32/39/52 | none |
| hammer | 11/15/21/26/31/42 | ARMOR 4/6/8/10/12/16 |
| dagger | 11/15/21/26/31/42 | INITIATIVE 2/2/3/3/4/4 |
| spear | 12/17/23/29/35/47 | INITIATIVE 1/1/1/2/2/2 |
| bow | 23/35/49/63/78/106 | none |
| crossbow | 23/35/49/63/78/106 | none |
| staff | 6/9/12/15/18/24 | SPELL_POWER 12/17/23/29/35/47 |
| wand | none | MAGIC_DAMAGE 12/19/27/35/44/61 |
| two-handed | 25/35/47/60/72/97 | sword family |
| offensive-shield | 4/6/9/11/13/18 | MAGIC_DAMAGE 4/5/7/9/11/15, BLOCK_POWER 0, no ARMOR |

Wand offense is base ranged damage + main-hand MAGIC_DAMAGE + SPELL_POWER + matching offensive-shield MAGIC_DAMAGE, then wand mastery. No melee/healing. Both wand and existing ranged attacks cost 3 AP/range6/LOS; magic uses existing armor/block, no mana or separate resistance. Offensive-shield adds only one matching channel, before main-hand mastery, and does not improve healing, bare hands or two-handed weapons. An accepted attack using its bonus records shield use; existing block usage also counts. Keep one shared half-XP award budget.

Qualities by tier: BASIC,NORMAL,GOOD,EXCELLENT,PERFECT,MASTERWORK. Rarities COMMON,COMMON,UNCOMMON,UNCOMMON,RARE,RARE. No initial injuries; existing mainHand+EXCELLENT injury-stone eligibility remains, therefore wands qualify and offensive shields do not. Durability40, starter-equivalent weights, sellValue=5+2*level. ItemLevel=minimumLevel. Polish names/descriptions are authored during implementation without promising unsupported effects.

## Catalog/assets and compatibility

Create separate progressionWeaponItems.ts with stable progression-{subcategory}-{level} IDs and nonoverlapping UUID identities. Extend seed options rarity/quality/itemLevel preserving legacy defaults and insert-only behavior. Existing seeded metadata may already mark allowed stats initialized: ensure added allowed codes become available additively without replacing customized metadata.

66 distinct original transparent PNG icons, one built-in image_gen call per asset, match starter RPG illustration style, readable at56px. Store originals in server assets with prompt metadata and review gallery. No placeholder substitutions or silently reused icons. Missing art must not ship.

Add wand to WeaponFamily/WeaponTraining normalization: old records gain wand:0 without losing XP; JSONB needs no schema change. Offensive-shield projects to offHand runtime family shield without authored weaponFamily shield (not metadata-supported). Update relevant stat labels. ADMIN catalog gains Previous/Next and page count,20/page, filters retained and reset to1 on submission, existing stale-load guard preserved.

## Validation

Focused shared equipment/mastery/combat, server manual/Auto/XP/persistence/injury, catalog seed/icon idempotency/preservation and client pagination/labels cases. Integration DB only disposable local test DB, never development schema reset. Build affected workspaces. Compare actual damage/turndamage/EHP/TtK at tiers and mastery0/50/100 including AP boundaries11/21 and higher scaling enemies25/30. Target approx15% damage-per-turn*effectiveHP difference for melee+shield vs2H and wand+shield vsbow; staff assessed with healing separately. Seed local catalog after checks; test-account QA may grant items but no real-player gifts. No hosted deployment.

## Approaches considered

User chose a66-item level1–30 package over88/110 wider-level packages; catalog-only over shop/loot; usable categories over definitions-only. Use currently effective stats rather than expanding crit/reload/magic resistance mechanics. Existing mastery tree design remains future work.
