# WEB MMORPG — Bag Storage and NPC Reward Design

**Date:** 2026-10-07
**Repository:** `owca217/WEB_MMORPG`
**Target branch:** `feature/mvp-vertical-slice`
**Status:** Approved by the user; implementation has not started.

## 1. Purpose

Expand the existing four bag equipment slots into usable bags with individual storage, add several bag types with different capacities, and introduce a settlement NPC who grants one free `Zwykły worek` through a dialogue choice.

The game remains a server-authoritative browser MMORPG with a classic RPG interface. Existing inventory items, character equipment, and character progress must remain intact across the database migration.

## 2. Current state

- `BAG_EQUIPMENT_SLOTS` defines `bag-1` through `bag-4`.
- New characters already receive a `Zwykły worek` with capacity 8 equipped in `bag-1`.
- Bags currently use the item category `container`; capacity is stored and shown as metadata, but bags do not have contents.
- `InventorySnapshot` is a flat list and `InventoryRepository` persists the items in `character_items`.
- The dialogue window renders NPC text and has a fixed healing action. NPC interaction is server-validated by proximity.
- Existing NPCs are Boran and Ada in `FOREST_SETTLEMENT_01`.

## 3. Approved architecture

### 3.1 Bag catalog and category

Use a canonical shared item category `bag`, displayed in Polish as **Torby**. Persisted items using the old `container` category are migrated to `bag` without changing their item IDs or ownership.

The initial catalog contains:

| Item ID | Name | Capacity |
| --- | --- | ---: |
| `simple-bag` | Zwykły worek | 8 |
| `traditional-backpack` | Tradycyjny plecak | 20 |
| `travel-backpack` | Plecak podróżny | 40 |
| `expedition-backpack` | Plecak ekspedycyjny | 60 |

Each bag is a unique, non-stackable item instance. A bag cannot be stored inside another bag. Only the simple bag is granted by the new NPC in this iteration; acquisition sources for the larger bags are outside this change.

### 3.2 Individual bag storage

Each bag instance owns a separate list of item slots. The existing general inventory remains available and keeps its current behavior; no new global inventory-size limit is introduced here. Players can move items between the general inventory and a bag using drag-and-drop, including touch input.

Capacity is the maximum number of item entries stored in that bag. A stack with quantity greater than one occupies one entry. Bags cannot be nested. The server validates that the destination is a bag owned by the same character and rejects a transfer when the bag has no free slot. Rejected transfers leave the source item unchanged.

The contents remain associated with the same bag instance when it is unequipped. An unequipped bag can still be opened from the general inventory, so removing it from an equipment slot never destroys or hides its contents.

Clicking an equipped bag slot opens that bag's storage. Clicking a bag item in the general inventory also opens its storage. The inventory UI shows the selected bag name, occupied slots, and its fixed capacity; users can drag items in either direction. The current classic RPG visual style and window controls remain in place.

### 3.3 NPC reward and dialogue

Add a quartermaster NPC to `FOREST_SETTLEMENT_01`, within reach of the settlement spawn and distinct from Boran and Ada. The dialogue offers **Odbierz Zwykły worek** until the reward is claimed.

The reward is claimable once per character. The client sends the selected action; the server checks the NPC identity and interaction range, checks the persistent claim record, creates one simple bag, and applies the reward atomically.

Placement rules:

1. If all four bag equipment slots are empty, equip the reward in `bag-1`.
2. Otherwise, add the reward bag to the general inventory without changing existing equipment.

After a successful claim the updated player state is emitted and the dialogue reports success. Later interactions state that the reward has already been claimed. A claim failure must not leave a duplicate bag or a partially changed equipment state.

The new NPC dialogue action does not replace Ada's existing healing action or Boran's existing text.

## 4. Data model and persistence

Extend the shared inventory model so an item stored inside a bag records the owning bag instance ID. Items in the general inventory have no bag instance ID. Keep bag capacity on the bag item and use the existing four equipment slots.

Add a database migration that:

- adds nullable bag-instance ownership to stored items;
- indexes that ownership for per-bag loading;
- converts existing category value `container` to `bag`;
- records one-time NPC reward claims uniquely by character and reward key.

Inventory, bag contents, equipment changes, and the NPC reward claim must be committed together in database transactions where they form one action. On login, the persisted bag contents are hydrated into the player snapshot. Existing items with no bag owner remain in the general inventory, and existing equipped starter bags retain their equipment entries.

The non-persistent server mode follows its existing in-memory progress semantics. Persistent accounts retain the reward claim, bag contents, and equipment after reconnects and server restarts.

## 5. Client/server flow

- Shared protocol exposes a request to move an item into or out of a bag and a request to claim the NPC reward.
- The client opens the selected bag view and renders capacity slots; drag/drop sends only item IDs and the desired destination.
- The server is authoritative for item ownership, bag type, capacity, equipment slots, NPC proximity, and reward eligibility.
- Successful changes return the refreshed player state. Invalid actions emit `commandRejected` with a Polish-facing message through the existing toast flow.
- Per-character mutation ordering prevents concurrent reward claims or item moves from duplicating items or exceeding capacity.

## 6. Failure handling

- Unknown or out-of-range NPC: reject the request and grant nothing.
- Reward already claimed: return an already-claimed dialogue response and grant nothing.
- Missing item, invalid destination, nesting attempt, or full bag: reject the transfer and preserve the original state.
- Persistence failure: restore runtime inventory/equipment from the database and report failure; do not mark the reward claimed unless the bag and equipment update committed.
- Disconnect during an action: do not emit or apply stale state to a replaced or closed session.

## 7. Verification plan

Automated coverage should include:

- bag catalog IDs, category, capacities, non-stacking, and non-nesting;
- moving items into and out of each bag and enforcing its capacity;
- contents remaining with a bag after it is unequipped;
- migration of existing `container` items and preservation of previously equipped bags;
- NPC presence, server-side range validation, and one-time reward behavior;
- auto-equipping the reward only when all four bag slots are empty, and inventory fallback otherwise;
- transactional persistence and reconnect restoration of reward claims, bag contents, and equipment;
- client dialogue action visibility and bag storage drag/drop behavior.

Run the shared, client, and server test suites plus client and server builds. Database-backed tests require `TEST_DATABASE_URL`.

## 8. Non-goals

- Shop or loot sources for larger bags.
- Bag crafting, upgrades, or nested bags.
- A global capacity limit for the current general inventory.
- Replacing the existing UI theme, changing character creation, or changing the starter bag automatically equipped on new characters.
- Reworking unrelated NPC dialogue or healing behavior.
