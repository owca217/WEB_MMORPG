# Automatic Backpack Storage

**Goal:** Remove the loose-item list beneath container cells and automatically store received items in equipped bags.

**Behavior:** Store items in the permanent backpack first, then valid equipped containers in slots1–3. Existing loose items are organized on login/startup. Preserve instance identity, quality and existing stack restrictions. Nonempty bags remain intact, equipped gear and assigned containers never become storage contents.

If no container has room, new items remain durable owned top-level rows, visible through an `Oczekujące(n)` header view of the same grid. Loot, purchases and trades use this uniform overflow rule; no item is discarded because storage is full. Retry placement when space is freed. No new table or network event is needed.

Grid clicks open compact item actions instead of removing items to an invisible root. Equipment remains equipable from the grid; storage transfers require an explicit destination. Consumables retain their existing use during combat. The old `Włóż do pojemnika` section is removed entirely. A bought empty bag can be assigned directly from inside the backpack; stored ordinary items remain eligible for player trade under normal ownership/binding rules.

## Interfaces and ownership

- Root/shared: `getPendingInventoryItems(snapshot:InventorySnapshot):InventoryItem[]`, returns unassigned root items excluding gear and the permanent bag. Controller integration, plan, release checks and targeted fixture updates.
- Server worker: new `autoStoreOwnedItems(client:PoolClient,characterId:string):Promise<void>` (caller holds character lock), inventory/merchant/trade/equipment/container/consumption and startup/auth organization integration, source ownership safety, focused DB tests. No mutation in snapshot reads; legacy-player methods unchanged.
- Client worker: container grid/popover/inbox header, picker accepts stored ordinary bags, trade selectors accept eligible stored items, pending HUD badge, related UI tests/styles. Preserve session safety and pointer input isolation.
- Android worker:0.1.19/code20, external signed build and release helpers.

## Tasks

- [x] Shared pending projection, with exclusion tests.
- [x] Transactional automatic storage on grants, transfers, gear/bag changes and consumption; safe old inventory organization and no full-capacity reward failures.
- [x] Grid-only UI and explicit item actions, header overflow access, stored bag selection and trade.
- [x] Focused tests for16/17 capacity, quality/stack rules, no lost rewards/replay, source parent clearing, freed-cell reuse, persisted overflow and old full bags.
- [x] Desktop/phone QA, Android0.1.19/code20 and review. Release gate: required CI and exact deployment/artifact verification.

## Review focus

Lock characters before item/catalog rows; preserve deterministic lock order in shared trade transactions. Clear sender parent references on both whole and split transfers. Preserve remaining split-stack parent and all custom instance attributes. Full nonempty bags must not be flattened or nested. No click may move an item to an invisible root. Pending remains visible and retryable across reconnect; filling a freed cell must not move a user-selected stored item to another bag.

Verification: final functional client suite269/44files passed, shared53/13files passed and builds passed. Full server release suite passed435 cases before two old trade-inventory assertions were corrected; the affected24-test trade file then passed and final server TypeScript passed. Native desktop/844x390 verification confirmed removed footer, visible menu, explicit bag transfer, assignment from stored bag with closed picker, four full bags with2 durable pending items after reconnect, and automatic refill pending2→1 after equipping stored helmet. Final phone header/layering CSS and copy were corrected and visually verified; the unpublished Android build is replaced to match.
