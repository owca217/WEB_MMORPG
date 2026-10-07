# Bag Storage and Quartermaster Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four usable bag types with individually limited storage and a one-time quartermaster reward that auto-equips only when all four bag slots are empty.

**Architecture:** Shared inventory contracts define the bag category, catalog, capacity, and item-to-bag ownership. The server validates and persists storage transfers and the NPC reward; the client presents each bag as its own grid while keeping the existing general inventory. The existing server-authoritative world and RPG window style remain in use.

**Tech Stack:** TypeScript, Phaser client with DOM-based interface panels, Socket.IO, PostgreSQL migrations and repositories, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-07-bag-storage-and-npc-reward-design.md`

## Global Constraints

- Canonical item category is `bag`; its Polish UI label is `Torby`.
- Bag capacities are `Zwykły worek` 8, `Tradycyjny plecak` 20, `Plecak podróżny` 40, and `Plecak ekspedycyjny` 60.
- Each bag is a unique, non-stackable item; bags cannot be nested.
- Capacity counts item entries; a stack occupies one entry regardless of quantity.
- Contents remain attached to their bag when it is unequipped and remain accessible from the general inventory.
- Do not add a global size limit to the existing general inventory.
- The quartermaster reward is claimable once per character; equip it in `bag-1` only when all four bag equipment slots are empty, otherwise put it in the general inventory.
- Preserve Boran's text, Ada's healing action, the starter bag on new characters, touch drag-and-drop, and the existing classic RPG window controls.
- Server validation is authoritative; persistent reward, equipment, and inventory changes commit atomically.

## Review Focus

- A full bag rejects a move without changing the source item — Task 3 transfer tests.
- Unknown items, non-bag destinations, and attempts to nest bags are rejected — Task 3 transfer tests.
- Concurrent transfer/equip/reward commands cannot duplicate an item or exceed capacity — Tasks 3 and 5 serialization tests.
- A database failure during reward or transfer does not leave partially updated runtime state — Tasks 2, 3, and 5 persistence tests.
- Migrated `container` items retain their IDs, inventory ownership, and equipped slot — Task 2 database migration test.

---

### Task 1: Shared bag catalog and item contract

**Files:**
- Modify: `packages/shared/src/inventory.ts`
- Modify: `apps/server/src/inventory/containers.ts`
- Modify: `apps/server/src/inventory/containerEquipment.ts`
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Create: `packages/shared/tests/inventory.test.ts`
- Test: `apps/server/tests/containerEquipment.test.ts`

**Interfaces:**
- Produces `BAG_DEFINITIONS`, `BagDefinition`, `BagItemId`, `ItemCategory` value `"bag"`, and optional `InventoryItem.containerInstanceId`.
- Produces `createBagItem(itemId: BagItemId): InventoryItem`; keep `createStarterContainer()` as a compatibility wrapper for character creation.
- `setContainerSlot(...)` accepts only inventory items whose category is `"bag"`.

- [ ] **Step 1: Write failing catalog and category tests** — assert IDs/names/capacities 8, 20, 40, and 60; assert that bag items do not stack and that equipment rejects non-bags.
- [ ] **Step 2: Run tests and verify they fail** — `npm test -w @web-mmorpg/shared -- tests/inventory.test.ts` and `npm test -w @web-mmorpg/server -- tests/containerEquipment.test.ts`.
- [ ] **Step 3: Implement the shared catalog and bag item creation** — use stable IDs `simple-bag`, `traditional-backpack`, `travel-backpack`, and `expedition-backpack`; set category `bag`; retain one unique instance per bag.
- [ ] **Step 4: Run both targeted suites and verify they pass** — expected: all catalog and equipment assertions pass.
- [ ] **Step 5: Commit** — `feat: define bag catalog and inventory contract`.

### Task 2: Persist bag contents and reward claims

**Files:**
- Create: `apps/server/migrations/004_bag_storage_and_npc_rewards.sql`
- Modify: `apps/server/src/persistence/InventoryRepository.ts`
- Modify: `apps/server/src/persistence/PlayerPersistenceService.ts`
- Test: `apps/server/tests/db/migrations.test.ts`
- Test: `apps/server/tests/db/playerPersistence.test.ts`
- Test: `apps/server/tests/persistentSocketFlow.test.ts`

**Interfaces:**
- `InventoryRepository.load/replaceAll` round-trips `container_instance_id` for every stored item.
- Produces `PlayerPersistenceService.saveInventoryAndEquipment(characterId, inventory, equipment): Promise<void>`.
- Produces `PlayerPersistenceService.hasNpcRewardClaim(characterId, rewardKey): Promise<boolean>`.
- Produces `PlayerPersistenceService.claimNpcRewardOnce(characterId, rewardKey, inventory, equipment): Promise<boolean>`; `false` means the unique claim already exists and no snapshot was written.

- [ ] **Step 1: Write failing database tests** — apply migrations `001`–`003`, seed an existing `container` item and equipment reference, apply `004`, and assert the item ID, category conversion, inventory ownership, and equipped slot are preserved; verify bag contents round-trip, duplicate claims return `false`, and a transaction error leaves neither a claim nor a partial snapshot.
- [ ] **Step 2: Run database tests and verify they fail on the missing schema/behavior** — `npm test -w @web-mmorpg/server -- tests/db/migrations.test.ts tests/db/playerPersistence.test.ts` with `TEST_DATABASE_URL` set.
- [ ] **Step 3: Add migration `004`** — add nullable `container_instance_id` and an index, update existing category values, and add a per-character reward-claim table with a unique `(character_id, reward_key)` key.
- [ ] **Step 4: Implement inventory repository round-tripping** — load and save `container_instance_id` with every item; omit it for items in the general inventory.
- [ ] **Step 5: Implement transactional persistence methods** — replace inventory and equipment in one transaction; insert the reward claim and save both snapshots in the same transaction.
- [ ] **Step 6: Run database tests and verify they pass** — expected: migration, old-item preservation, storage round-trip, and duplicate-claim rejection pass.
- [ ] **Step 7: Commit** — `feat: persist bag contents and NPC reward claims`.

### Task 3: Server-authoritative bag storage transfers

**Files:**
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Create: `apps/server/src/inventory/bagStorage.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Create: `apps/server/tests/bagStorage.test.ts`
- Test: `apps/server/tests/socketFlow.test.ts`
- Test: `apps/server/tests/persistentSocketFlow.test.ts`

**Interfaces:**
- Produces `moveItemToContainer(snapshot: InventorySnapshot, itemInstanceId: string, containerInstanceId: string | null): InventorySnapshot` in `apps/server/src/inventory/bagStorage.ts`.
- `null` destination means the general inventory; a bag instance ID means storage in that bag.
- Produces Socket.IO event `moveInventoryItem({ itemInstanceId: string, containerInstanceId: string | null })`.
- Consumes `PlayerPersistenceService.saveInventoryAndEquipment(...)` from Task 2.

- [ ] **Step 1: Write failing transfer tests** — cover general-to-bag, bag-to-general, full capacity, unknown item, invalid destination, nested bag, already-at-destination, and stack quantity counting as one entry.
- [ ] **Step 2: Run the targeted test and verify it fails** — `npm test -w @web-mmorpg/server -- tests/bagStorage.test.ts`.
- [ ] **Step 3: Implement `moveItemToContainer`** — validate source and destination against one character snapshot, leave source unchanged on rejection, and no-op when already at the requested destination.
- [ ] **Step 4: Write failing socket tests** — verify accepted transfers emit updated player state, persistent transfers survive reconnect, and invalid transfers emit `commandRejected` without changing state.
- [ ] **Step 5: Run the tests and verify they fail for the missing event/persistence path** — `npm test -w @web-mmorpg/server -- tests/socketFlow.test.ts tests/persistentSocketFlow.test.ts`.
- [ ] **Step 6: Add the socket handler and per-player mutation queue** — serialize bag moves with bag-slot changes, persist through Task 2's method, and reload persisted state after write failure.
- [ ] **Step 7: Run all three targeted suites and verify they pass**.
- [ ] **Step 8: Commit** — `feat: add validated bag storage transfers`.

### Task 4: Bag storage UI

**Files:**
- Create: `apps/client/src/ui/inventoryViewModel.ts`
- Modify: `apps/client/src/ui/InventoryPanel.ts`
- Modify: `apps/client/src/ui/WorldHud.ts`
- Modify: `apps/client/src/ui/containerDrag.ts`
- Modify: `apps/client/src/ui/world-hud.css`
- Modify: `apps/client/src/style.css`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/tests/inventoryViewModel.test.ts`

**Interfaces:**
- Produces `getInventoryView(snapshot: InventorySnapshot, selectedContainerId: string | null): { generalItems: InventoryItem[]; selectedBag: InventoryItem | null; bagContents: InventoryItem[]; occupiedSlots: number; capacity: number; emptySlots: number }`, using `InventoryItem` from `@web-mmorpg/shared`.
- `InventoryPanel.openBagStorage(containerInstanceId: string)` selects a bag; `update(snapshot)` refreshes both views.
- `InventoryPanel` sends transfers through `onMoveItem(itemInstanceId, containerInstanceId)`.

- [ ] **Step 1: Write failing view-model tests** — assert root items exclude stored contents, bag items cannot appear as contents, and empty/filled counts match the selected bag's capacity.
- [ ] **Step 2: Run the test and verify it fails** — `npm test -w @web-mmorpg/client -- tests/inventoryViewModel.test.ts`.
- [ ] **Step 3: Implement `getInventoryView`** using the shared `InventorySnapshot` and selected bag ID.
- [ ] **Step 4: Run the view-model test and verify it passes**.
- [ ] **Step 5: Update inventory UI** — show the general list and selected bag's capacity grid together; make equipped and unequipped bag items open their own storage; drag items both directions, including touch; surface server rejections through the existing toast flow.
- [ ] **Step 6: Wire the move event through `GameSocket` and `WorldScene`; update the existing bag-slot click to open the selected bag while empty slots still open the general inventory**.
- [ ] **Step 7: Run client tests and build** — `npm test -w @web-mmorpg/client` and `npm run build -w @web-mmorpg/client`.
- [ ] **Step 8: Commit** — `feat: open and manage individual bag storage`.

### Task 5: Quartermaster and one-time bag reward

**Files:**
- Create: `apps/client/src/ui/dialogueViewModel.ts`
- Modify: `packages/shared/src/world.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/world/worldFixtures.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/client/src/ui/DialoguePanel.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Test: `apps/server/tests/worldService.test.ts`
- Test: `apps/server/tests/socketFlow.test.ts`
- Test: `apps/server/tests/persistentSocketFlow.test.ts`
- Create: `apps/client/tests/dialogueViewModel.test.ts`

**Interfaces:**
- Adds `NpcKind` value `"quartermaster"` and `NpcInteractionPayload.canClaimSimpleBag: boolean` plus `simpleBagRewardClaimed: boolean`.
- Produces Socket.IO event `claimSimpleBag({ npcId: string })`.
- DialoguePanel callback `onClaimBag(npcId: string): void` sends the claim request.
- Produces `getDialogueActions(payload: NpcInteractionPayload): { showHeal: boolean; showBagClaim: boolean }` to determine whether the heal and bag-claim actions are visible.

- [ ] **Step 1: Write failing world and dialogue tests** — verify the quartermaster exists, dialogue actions are visible only for eligible NPC/reward states, and existing healer action remains available for Ada.
- [ ] **Step 2: Run targeted world and client tests and verify they fail** — `npm test -w @web-mmorpg/server -- tests/worldService.test.ts` and `npm test -w @web-mmorpg/client -- tests/dialogueViewModel.test.ts`.
- [ ] **Step 3: Add the quartermaster fixture and dialogue state** — place the NPC near settlement spawn; preserve Boran and Ada payloads and actions.
- [ ] **Step 4: Implement reward handling** — revalidate NPC range, serialize the action with other inventory mutations, persist one claim through Task 2's transaction, track the claim in memory when persistence is disabled, and create one `simple-bag`.
- [ ] **Step 5: Implement placement rule** — if no entry uses `bag-1` through `bag-4`, equip the reward into `bag-1`; otherwise add it to the general inventory.
- [ ] **Step 6: Add the dialogue choice and response** — show `Odbierz Zwykły worek` until claimed, then show the already-claimed state; on success emit the updated player state and refreshed dialogue payload.
- [ ] **Step 7: Write failing reward socket tests** — verify out-of-range/incorrect-NPC requests grant nothing, an empty four-slot set auto-equips to `bag-1`, an occupied bag set falls back to general inventory, and duplicate claims grant nothing.
- [ ] **Step 8: Run server and client tests, including persistent reconnect** — `npm test -w @web-mmorpg/server -- tests/worldService.test.ts tests/socketFlow.test.ts tests/persistentSocketFlow.test.ts` and `npm test -w @web-mmorpg/client -- tests/dialogueViewModel.test.ts`; run database-backed tests with `TEST_DATABASE_URL` set.
- [ ] **Step 9: Commit** — `feat: add quartermaster bag reward`.

### Task 6: Full verification and GitHub publication

**Files:**
- No product files; verify the final branch and publish the reviewed implementation to `feature/mvp-vertical-slice` through the GitHub connector.

**Interfaces:**
- Consumes the completed tasks above and the approved specification.
- Produces a fast-forward GitHub commit on `owca217/WEB_MMORPG` branch `feature/mvp-vertical-slice` and verified workflow status.

- [ ] **Step 1: Run all shared, client, and server tests** — `npm test`; if `TEST_DATABASE_URL` is unavailable, run all non-database tests and report database tests as blocked by the missing environment variable.
- [ ] **Step 2: Run both builds** — `npm run build -w @web-mmorpg/client` and `npm run build -w @web-mmorpg/server`.
- [ ] **Step 3: Manually verify browser interactions** — open each bag from its equipment slot and general inventory; transfer items both ways with mouse and touch; confirm a full bag rejects a move without losing the source item; claim the quartermaster reward with empty and occupied bag slots; confirm Ada's healing and Boran's dialogue remain unchanged.
- [ ] **Step 4: Review the final diff and history** — confirm no unrelated files, no dropped local work, all task commits present, and a clean working tree.
- [ ] **Step 5: Publish with GitHub Git-data operations** — read the current remote ref, create blobs/tree/commit with that commit as parent, and fast-forward the requested branch using the expected old SHA; do not force-update if the remote moved.
- [ ] **Step 6: Verify GitHub CI and Pages deployment status** — inspect the workflows for the published commit and report their actual conclusions.
