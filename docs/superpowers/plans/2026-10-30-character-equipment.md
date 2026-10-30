# Character equipment and proficiency experience

**Goal:** Replace free combat style selection with real owned weapons and armor. Split the character window into Statystyki, Władanie and Uzbrojenie.

## Behavior and decisions

- Slots: mainHand, offHand (shield), helmet, chest, gloves, pants, boots and cloak.
- Bows, crossbows and healing staves are two-handed. Equipping one safely removes a shield to inventory. A shield cannot be equipped while a two-handed weapon is held.
- Gear changes require owning the actual item, its compatible slot, sufficient level/requirements and usable durability. Changes are allowed outside combat only. Equipped items cannot be traded or put into a bag.
- Bare hands permit basic melee, without proficiency gain. Equipped weapon family enables the relevant attack; staff enables melee and healing. Empty gear never enables a ranged attack or staff healing through old saved styles.
- Miro sells published basic weapons, shields and six armor pieces. Existing inventories receive no unsolicited items. Existing numeric proficiency experience is retained.
- At victory, proficiency XP comes from the player's actual awarded combat XP including party bonus: floor(XP / 2) is a total budget split among used families, in stable family order with remainder allocation. The user explicitly confirmed splitting this shared half-XP budget among used families.
- An accepted attack consumes AP and counts as use, including a miss. Actual healing counts for staff; actual shield damage reduction counts for shield. Movement, item use, passive carrying and world healing grant no proficiency XP. Defeat/disconnect gives no combat XP and therefore no proficiency XP.
- Shared battle settlement applies this award once, before the participant's durable gameplay save. Existing server claims and item locks remain in force.
- Old clients calling setWeaponLoadout receive WEAPON_STYLES_REMOVED without mutation. Legacy JSON stays readable to preserve XP, but its saved loadout never enables live combat.

## Interfaces and responsibilities

- Shared equipment.ts defines EquipmentSlot, EquipmentItemProperties, CharacterEquipment, request/result and inventory projection helpers.
- Inventory items expose equipment metadata and equippedSlot. EquipmentService.setSlot locks the character and item rows, validates current published metadata, updates slots and ON_EQUIP binding atomically, and returns InventorySnapshot.
- Shared equipmentCombat.ts derives stats and attack availability; CharacterService uses actual gear. Equipment changes clamp current HP and never heal by re-equipping.
- Root registers a pending equipment operation before its first await. Admission, trade, healing and disconnect respect the operation; acknowledgement is released after durable mutation/save and before presentation reads.
- Client uses authoritative character/inventory results, preserves selected tab, rejects stale acknowledgements and provides sibling equip actions in container contents.

## Tasks and verification

- [x] Shared projection and combat helpers, explicit attack mode checks and usage tracking.
- [x] Migration011, inventory/trade safety, published gear seeds and merchant offers.
- [x] Character tabs, equipment controls, inventory quick actions and session-safe synchronization.
- [x] Socket integration and focused equipment/reward/ownership/reconnect/concurrency tests.
- [x] Native desktop/phone QA and signed Android0.1.16/code17. Release gate: verify exact deployment, CI and public APK.

Review focus: double-awarded XP, phantom attacks from removed styles, gear/stat authority after reconnect, a commit finishing during disconnect, two-handed swaps without item loss, stale UI replies and equipped-item trading/container moves.

## Verification evidence

- Owned equipment, merchant purchase, stat changes (melee30 to42; armor10 to13), safe two-handed swap and all three tabs verified in the local browser, including844x390 phone layout.
- Focused storage, shared combat, client and socket suites passed. New regression tests cover seed UUID collisions, stale inventory acknowledgements and stale completed-trade presentation.
- Signed Android0.1.16/code17 built with the existing certificate; exact CI/deployment/public artifact verification follows release.
