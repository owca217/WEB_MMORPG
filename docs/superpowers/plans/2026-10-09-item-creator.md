# Item Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent, ADMIN-only item catalog and nine-step item creator that stores versioned item definitions in PostgreSQL, uploads icons to durable object storage, previews player tooltips live, and migrates existing inventory/loot flows to central item definitions.

**Architecture:** Keep engine-understood stats/effects as typed shared contracts and server registries, while storing categories, subcategories, allowed stat mappings, item definitions, versions and instances in PostgreSQL. Expose ADMIN operations through a same-server REST API protected by a server-issued session token and ADMIN role; keep gameplay realtime traffic on Socket.IO. Use a storage abstraction with an S3-compatible production adapter for icons and inject repositories/storage into services so domain tests stay deterministic.

**Tech Stack:** TypeScript 5.9, npm workspaces, Node.js, Socket.IO 4.8.3, Vitest 5.0.1, PostgreSQL via `pg`, Express, Zod, Multer, S3-compatible storage via `@aws-sdk/client-s3`, browser `fetch`, existing DOM-based game UI.

**Spec:** `docs/superpowers/specs/2026-10-09-item-creator-design.md`

## Global Constraints

- Base implementation on `tmp-do-not-use-8` plus this spec/plan branch.
- Keep `itemId` stable and unique; published definitions are immutable revisions.
- Engine stat/effect codes remain controlled by code; admins may only compose supported codes.
- PostgreSQL is the source of truth for catalog metadata, versions and item instances.
- Icons are not stored as PostgreSQL binary data; production storage must survive deploys.
- Every ADMIN mutation is authorized server-side and emits an audit-log record.
- Published-item edits create drafts; normal edits do not change live gameplay until publication.
- Restoring a historical version creates a new revision instead of deleting history.
- Existing loot and inventory behavior must continue working while switching to central definitions.
- Hard-delete is not exposed for published items; use archive status.
- Custom categories/subcategories can be added, but cannot invent new engine stat/effect codes.
- Account/authentication is outside this feature; until full account auth exists, ADMIN elevation is bootstrapped by server configuration and a secret login token, never by nickname alone.

## Review Focus

- A forged request using a valid player session but no ADMIN role must return 403 and must not mutate data; pin in Task 8 API tests.
- Two admins editing the same draft revision must detect stale `expectedRevision` and return 409 without silently overwriting; pin in Task 5 service/API tests.
- A valid stat code that is not allowed for the selected category/subcategory must be rejected server-side even if sent manually; pin in Task 5 validation tests.
- Icon uploads with wrong MIME type, oversized payloads or path-like filenames must be rejected before durable storage write; pin in Task 7 tests.
- Existing inventory instances must preserve quantity/instance state while resolving newly published base definition fields after a catalog publish and server restart; pin in Tasks 9 and 13.

---

## Planned file structure

### Shared contracts

- Create `packages/shared/src/items.ts` — catalog, version, stat/effect, category, rarity, requirement and tooltip contracts.
- Create `packages/shared/src/admin.ts` — `UserRole`, admin API DTOs, pagination/filter/result/error contracts.
- Modify `packages/shared/src/inventory.ts` — item instances point to `itemDefinitionId`/`itemId` and resolved display data rather than duplicating the full definition as source of truth.
- Modify `packages/shared/src/protocol.ts` — login accepts optional admin bootstrap token and returns `sessionToken` plus role.
- Modify `packages/shared/src/index.ts` — export new contracts.

### Server persistence/domain

- Create `apps/server/src/db/createPool.ts` — PostgreSQL pool creation from `DATABASE_URL`.
- Create `apps/server/src/db/migrate.ts` — ordered SQL migration runner.
- Create `apps/server/src/db/migrations/001_item_catalog.sql` — item catalog/category/version/audit schema.
- Create `apps/server/src/items/statRegistry.ts` — engine-owned stat/effect/trigger definitions.
- Create `apps/server/src/items/itemValidation.ts` — schema + category-aware validation.
- Create `apps/server/src/items/ItemMetadataRepository.ts` — categories/subcategories/allowed stats.
- Create `apps/server/src/items/ItemCatalogRepository.ts` — item/version/stat/effect/tag persistence.
- Create `apps/server/src/items/ItemCatalogService.ts` — drafts, publication, versioning, restore, archive, duplicate and catalog reads.
- Create `apps/server/src/items/seedItemMetadata.ts` — idempotent seed for system categories/stat mappings and starter items.
- Create `apps/server/src/audit/AdminAuditRepository.ts` — append/read audit entries.
- Create `apps/server/src/admin/AdminAuth.ts` — bearer-session ADMIN guard.
- Create `apps/server/src/admin/IconStorage.ts` — storage interface.
- Create `apps/server/src/admin/S3IconStorage.ts` — S3-compatible implementation.
- Create `apps/server/src/admin/createAdminRouter.ts` — REST routes for metadata, catalog, creator, versions, categories and icons.
- Modify `apps/server/src/session/SessionStore.ts` — session token + role and ADMIN bootstrap verification.
- Modify `apps/server/src/server/createGameServer.ts` — inject pool/services, attach admin API, keep Socket.IO flow.
- Modify `apps/server/src/index.ts` — create Express-backed HTTP server, migrate/seed before listen.
- Modify `apps/server/src/inventory/InventoryService.ts` — persistent instances referencing central definitions.
- Modify `apps/server/src/loot/LootService.ts` — return item IDs/quantities only and validate catalog existence.
- Modify `apps/server/package.json` — add persistence/API/storage dependencies and migration scripts.

### Client

- Create `apps/client/src/net/AdminApi.ts` — typed REST client with bearer session token.
- Create `apps/client/src/state/SessionStateStore.ts` — player ID, role and session token from login.
- Create `apps/client/src/ui/AdminPanel.ts` — ADMIN shell and navigation.
- Create `apps/client/src/ui/admin/ItemCatalogView.ts` — filters, list, actions, history entry point.
- Create `apps/client/src/ui/admin/ItemCreatorView.ts` — nine-step state machine and save/publish actions.
- Create `apps/client/src/ui/admin/ItemTooltipPreview.ts` — live player-style tooltip renderer.
- Create `apps/client/src/ui/admin/CategoryManagerView.ts` — optional custom category/subcategory/allowed-stat editor.
- Modify `apps/client/src/net/GameSocket.ts` — retain returned session auth metadata.
- Modify `apps/client/src/scenes/LoginScene.ts` — optional admin bootstrap credential only when explicitly requested/configured.
- Modify `apps/client/src/scenes/WorldScene.ts` — create/destroy AdminPanel and pass session state.
- Modify `apps/client/src/ui/WorldHud.ts` — show `Panel admin` only for `ADMIN`.
- Modify `apps/client/src/style.css` — admin/catalog/creator/tooltip layout.

### Tests/CI

- Create focused server tests under `apps/server/tests/item*.test.ts`, `adminApi.test.ts`, `database.test.ts`.
- Create client tests under `apps/client/tests/admin*.test.ts`.
- Modify `apps/server/tests/socketFlow.test.ts` — preserve login/loot flow after async persistent inventory changes.
- Modify `.github/workflows/feature-ci.yml` — PostgreSQL service + `DATABASE_URL` for server integration tests.

---

### Task 1: Shared item and admin contracts

**Files:**
- Create: `packages/shared/src/items.ts`
- Create: `packages/shared/src/admin.ts`
- Modify: `packages/shared/src/inventory.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/items.test.ts`

**Interfaces:**
- Produces: `ItemDefinition`, `ItemVersion`, `ItemDraftInput`, `ItemStatModifier`, `ItemEffect`, `ItemRequirement`, `ItemCategoryDefinition`, `ItemSubcategoryDefinition`, `ItemRarity`, `ModifierType`, `UserRole`, `AdminSession`, `ItemCatalogQuery`, `ItemCatalogPage`, `AdminApiError`.
- Produces login success shape: `{ ok: true; playerId; locationId; sessionToken: string; role: "PLAYER" | "ADMIN" }`.

- [ ] **Step 1: Write failing shared-contract tests** asserting rarity/status/modifier unions, a representative `ItemDraftInput`, and login success including `sessionToken` and `role` compile through typed fixtures.
- [ ] **Step 2: Run** `npm test -w @web-mmorpg/shared` and verify the new imports/types fail before implementation.
- [ ] **Step 3: Implement the contracts** in focused files; use stable string codes (`PHYSICAL_DAMAGE`, `CRIT_CHANCE`, etc.) for engine mechanics and keep category IDs as strings/slugs.
- [ ] **Step 4: Change `InventoryItem`** so a resolved snapshot exposes `instanceId`, `itemId`, `quantity`, resolved name/category/description/icon/rarity plus optional instance state (`durability`, `upgradeLevel`, `boundToPlayerId`) while the server remains source of truth.
- [ ] **Step 5: Run** `npm run build -w @web-mmorpg/shared && npm test -w @web-mmorpg/shared` and expect PASS.
- [ ] **Step 6: Commit** `feat: add shared item catalog contracts`.

### Task 2: Session tokens and ADMIN bootstrap authorization

**Files:**
- Modify: `apps/server/src/session/SessionStore.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Create: `apps/client/src/state/SessionStateStore.ts`
- Modify: `apps/client/src/scenes/LoginScene.ts`
- Test: `apps/server/tests/sessionStore.test.ts`
- Test: `apps/client/tests/sessionStateStore.test.ts`

**Interfaces:**
- `SessionStore.login(nicknameInput: string, adminToken?: string): LoginResult`.
- `SessionStore.getByToken(sessionToken: string): SessionRecord | undefined`.
- `SessionRecord` adds `sessionToken: string` and `role: UserRole`.
- ADMIN only when `adminToken` exactly matches non-empty `process.env.ADMIN_ACCESS_TOKEN`; nickname alone never grants ADMIN.
- `sessionStateStore.setFromLogin(result)` stores `playerId`, `sessionToken`, `role` for REST/UI.

- [ ] **Step 1: Write failing server tests** for normal PLAYER login, correct secret ADMIN login, wrong/empty secret remaining PLAYER, unique opaque session token, and `getByToken`.
- [ ] **Step 2: Run** `npm test -w @web-mmorpg/server -- sessionStore.test.ts`; expect FAIL.
- [ ] **Step 3: Implement session role/token behavior** and extend Socket.IO login payload to `{ nickname, adminToken? }`.
- [ ] **Step 4: Write client store tests** proving ADMIN role/token persist only in memory and clear on reset.
- [ ] **Step 5: Implement GameSocket/LoginScene plumbing** without storing the admin bootstrap secret after login.
- [ ] **Step 6: Run shared/server/client build + focused tests**; expect PASS.
- [ ] **Step 7: Commit** `feat: add authenticated admin sessions`.

### Task 3: PostgreSQL schema, migration runner and CI database

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/db/createPool.ts`
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/src/db/migrations/001_item_catalog.sql`
- Test: `apps/server/tests/database.test.ts`
- Modify: `.github/workflows/feature-ci.yml`

**Interfaces:**
- `createPool(databaseUrl = process.env.DATABASE_URL): Pool` throws a clear startup error when missing.
- `runMigrations(pool: Pool): Promise<void>` is idempotent and tracks applied migrations in `schema_migrations`.
- SQL tables: `item_categories`, `item_subcategories`, `stat_definitions`, `category_allowed_stats`, `items`, `item_versions`, `item_stat_modifiers`, `item_requirements`, `item_effects`, `item_tags`, `item_instances`, `admin_audit_log`.
- `items.item_id` UNIQUE; `(item_id, version_no)` UNIQUE; only one current draft per item; FKs prevent orphan version children.

- [ ] **Step 1: Add failing integration test** that runs migrations twice against `DATABASE_URL`, checks every required table and uniqueness/FK constraints.
- [ ] **Step 2: Add CI PostgreSQL service** (`postgres:16`) and test env `DATABASE_URL=postgres://postgres:postgres@localhost:5432/web_mmorpg_test`.
- [ ] **Step 3: Add dependencies** `pg` plus its types; implement pool and migration runner.
- [ ] **Step 4: Write `001_item_catalog.sql`** with explicit enums/check constraints for item status/version state/modifier type and JSONB only for flexible `special_data`, effect condition payload, affixes/sockets and audit summaries.
- [ ] **Step 5: Run** server database test and full server build; expect PASS.
- [ ] **Step 6: Commit** `feat: add item catalog postgres schema`.

### Task 4: Engine registry, system metadata and custom category persistence

**Files:**
- Create: `apps/server/src/items/statRegistry.ts`
- Create: `apps/server/src/items/ItemMetadataRepository.ts`
- Create: `apps/server/src/items/seedItemMetadata.ts`
- Test: `apps/server/tests/itemMetadata.test.ts`

**Interfaces:**
- `ENGINE_STATS: Readonly<Record<StatCode, EngineStatDefinition>>` defines label, allowed modifier types, absolute min/max and formatting kind.
- `ENGINE_TRIGGERS` and `ENGINE_EFFECTS` enumerate supported special-effect mechanics.
- `ItemMetadataRepository.listMetadata(): Promise<ItemCreatorMetadata>`.
- `createCategory(input, actor): Promise<ItemCategoryDefinition>` and `createSubcategory(...)` accept only known stat/effect codes.
- `seedItemMetadata(pool): Promise<void>` upserts system categories/subcategories/stat definitions and their allowed mappings without overwriting admin-created rows.

- [ ] **Step 1: Write failing tests** for all 15 approved top-level categories, representative weapon/pancerz/material restrictions, and idempotent seeding.
- [ ] **Step 2: Run** focused tests; expect FAIL.
- [ ] **Step 3: Implement engine registry** with the approved stat pools and modifier constraints.
- [ ] **Step 4: Implement repository and seeder** using transactions and stable slugs.
- [ ] **Step 5: Add tests** that custom category creation can reuse known stats but rejects unknown `superLaserDamage`.
- [ ] **Step 6: Run focused tests + server build**; expect PASS.
- [ ] **Step 7: Commit** `feat: add item creator metadata registry`.

### Task 5: Draft creation/update, category-aware validation and optimistic locking

**Files:**
- Create: `apps/server/src/items/itemValidation.ts`
- Create: `apps/server/src/items/ItemCatalogRepository.ts`
- Create: `apps/server/src/items/ItemCatalogService.ts`
- Test: `apps/server/tests/itemDrafts.test.ts`

**Interfaces:**
- `validateItemDraft(input: ItemDraftInput, metadata: ItemCreatorMetadata): ValidationResult`.
- `ItemCatalogService.createDraft(input, actor): Promise<ItemVersion>`.
- `ItemCatalogService.updateDraft(itemId, input, expectedRevision, actor): Promise<ItemVersion>`.
- `ItemCatalogService.getItem(itemId): Promise<ItemDetails>`.
- `ItemCatalogService.listItems(query: ItemCatalogQuery): Promise<ItemCatalogPage>`.
- Draft revision integer increments on each save; stale `expectedRevision` throws `ItemConflictError`.

- [ ] **Step 1: Write failing service tests** for create draft, unique `itemId`, filtered catalog listing, allowed stat, disallowed-but-valid stat, min/max inconsistency, modifier range, required fields and negative values where permitted.
- [ ] **Step 2: Add stale-write test**: update revision 1 successfully, then a second update with `expectedRevision=1` throws conflict and leaves the first update intact.
- [ ] **Step 3: Run** focused tests; expect FAIL.
- [ ] **Step 4: Implement validation** with Zod for structural validation plus metadata-driven semantic validation.
- [ ] **Step 5: Implement repository/service transactions**; save children by version/draft identity and never trust client category/stat combinations.
- [ ] **Step 6: Run focused tests + build**; expect PASS.
- [ ] **Step 7: Commit** `feat: add item draft workflow`.

### Task 6: Publish, history, rollback, duplicate, archive and audit log

**Files:**
- Create: `apps/server/src/audit/AdminAuditRepository.ts`
- Modify: `apps/server/src/items/ItemCatalogRepository.ts`
- Modify: `apps/server/src/items/ItemCatalogService.ts`
- Test: `apps/server/tests/itemVersions.test.ts`

**Interfaces:**
- `publish(itemId, expectedRevision, actor): Promise<ItemVersion>` creates immutable next `versionNo`, sets `items.active_version_no`, clears draft state and writes audit entry in one transaction.
- `listVersions(itemId): Promise<ItemVersionSummary[]>`.
- `restoreVersion(itemId, sourceVersionNo, actor): Promise<ItemVersion>` copies the historical definition into a **new published revision** after confirmation at the API/UI layer.
- `duplicate(itemId, newItemId, actor): Promise<ItemVersion>` creates a new draft and never reuses source `itemId`.
- `archive(itemId, actor): Promise<void>` marks archived without deleting references.
- `AdminAuditRepository.listForObject(objectType, objectId)` returns chronological mutation records.

- [ ] **Step 1: Write failing tests** for v1 publish, draft v2 not affecting active v1, v2 publish switching active definition, immutable historical v1 and version diff data.
- [ ] **Step 2: Add restore test** proving restoring v1 after v2 creates v3 with v1 values and does not delete v2.
- [ ] **Step 3: Add duplicate/archive tests** proving new stable ID and preserved original references.
- [ ] **Step 4: Add audit tests** requiring actor/action/object/from/to/summary for create, update, publish, restore, duplicate, archive and category changes.
- [ ] **Step 5: Implement all operations transactionally** with explicit conflict/not-found/validation error classes.
- [ ] **Step 6: Run focused tests + server build**; expect PASS.
- [ ] **Step 7: Commit** `feat: add item publication and version history`.

### Task 7: Durable icon storage and upload validation

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/admin/IconStorage.ts`
- Create: `apps/server/src/admin/S3IconStorage.ts`
- Test: `apps/server/tests/iconStorage.test.ts`

**Interfaces:**
- `IconStorage.putIcon(input: { bytes: Buffer; mimeType: "image/png" | "image/webp"; originalName: string }): Promise<{ key: string; url: string }>`.
- `S3IconStorage.fromEnv()` reads `ITEM_ASSET_S3_BUCKET`, `ITEM_ASSET_S3_REGION`, optional `ITEM_ASSET_S3_ENDPOINT`, credentials, and `ITEM_ASSET_PUBLIC_BASE_URL`.
- Upload limit: 2 MiB; allowed MIME types: `image/png`, `image/webp`; generated object key uses UUID and server-controlled extension, never client path.

- [ ] **Step 1: Write fake-storage tests** for accepted PNG/WebP and rejection of JPEG, executable MIME, >2 MiB and `../../name.png` without calling storage on rejected input.
- [ ] **Step 2: Add `@aws-sdk/client-s3` and implement storage abstraction/adapter**.
- [ ] **Step 3: Test key generation** contains no client path separators and returns configured public URL.
- [ ] **Step 4: Run focused tests + build**; expect PASS.
- [ ] **Step 5: Commit** `feat: add durable item icon storage`.

### Task 8: ADMIN REST API and server wiring

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/src/admin/AdminAuth.ts`
- Create: `apps/server/src/admin/createAdminRouter.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/tests/adminApi.test.ts`

**Interfaces:**
- `requireAdminSession(sessions, authorizationHeader): SessionRecord` expects `Authorization: Bearer <sessionToken>` and `role === "ADMIN"`.
- Routes:
  - `GET /api/admin/item-metadata`
  - `GET /api/admin/items`
  - `POST /api/admin/items`
  - `GET /api/admin/items/:itemId`
  - `PUT /api/admin/items/:itemId/draft`
  - `POST /api/admin/items/:itemId/publish`
  - `POST /api/admin/items/:itemId/duplicate`
  - `POST /api/admin/items/:itemId/archive`
  - `GET /api/admin/items/:itemId/versions`
  - `POST /api/admin/items/:itemId/versions/:versionNo/restore`
  - `POST /api/admin/categories`
  - `POST /api/admin/subcategories`
  - `PUT /api/admin/categories/:categoryId/allowed-stats`
  - `POST /api/admin/icons`
  - `GET /api/admin/audit?objectType=&objectId=`
- Error mapping: 400 validation, 401 missing/invalid bearer session, 403 non-ADMIN, 404 missing entity, 409 revision/ID conflict, 500 sanitized infrastructure error.

- [ ] **Step 1: Add Express/CORS/Multer/Supertest dependencies** and write API harness with injected fake storage and test database.
- [ ] **Step 2: Write auth tests**: no bearer -> 401; PLAYER bearer -> 403; forged/expired token -> 401; ADMIN -> allowed.
- [ ] **Step 3: Write route tests** for create/save/publish/history/restore/duplicate/archive/metadata/category and expected HTTP status/error codes.
- [ ] **Step 4: Write stale `expectedRevision` API test** expecting 409 and unchanged persisted draft.
- [ ] **Step 5: Implement router and error mapper**; keep all domain checks in services rather than controllers.
- [ ] **Step 6: Refactor startup** so migrations + metadata seed complete before listening, then Express and Socket.IO share the same HTTP server.
- [ ] **Step 7: Run admin API tests, socket flow tests and server build**; expect PASS.
- [ ] **Step 8: Commit** `feat: expose secured item admin api`.

### Task 9: Migrate loot and inventory to central definitions/item instances

**Files:**
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Modify: `apps/server/src/loot/LootService.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `packages/shared/src/inventory.ts`
- Test: `apps/server/tests/inventoryService.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `LootService.rollEncounterLoot(encounterId, seed): Array<{ itemId: string; quantity: number }>`.
- `InventoryService.addItems(playerId, rewards): Promise<InventorySnapshot>` resolves published definitions and persists/merges `item_instances`.
- `InventoryService.getSnapshot(playerId): Promise<InventorySnapshot>` joins instances to each item's active version at read time.
- Stack merge is allowed only when the definition is stackable and instance-specific state is compatible.

- [ ] **Step 1: Seed/migrate starter definitions** for existing `wolf-pelt` and `field-bandage` so current battle loot has central catalog entries.
- [ ] **Step 2: Write failing inventory tests** proving instances store item references/quantity, snapshots resolve active definition, and a definition v2 publication changes displayed base data without changing `instanceId`/quantity.
- [ ] **Step 3: Write restart persistence test**: construct service with pool, add item, construct new service/pool, snapshot contains same instance.
- [ ] **Step 4: Implement async persistent InventoryService and simplify LootService** to IDs/quantities only.
- [ ] **Step 5: Update `createGameServer` async call sites** for player state and battle-end reward emission without changing player-visible event order.
- [ ] **Step 6: Update socket-flow assertions** for resolved catalog fields and make existing forest -> battle -> loot flow pass.
- [ ] **Step 7: Run full server test suite + build**; expect PASS.
- [ ] **Step 8: Commit** `feat: migrate inventory to item definitions`.

### Task 10: Client ADMIN API, HUD entry point and catalog view

**Files:**
- Create: `apps/client/src/net/AdminApi.ts`
- Create: `apps/client/src/ui/AdminPanel.ts`
- Create: `apps/client/src/ui/admin/ItemCatalogView.ts`
- Modify: `apps/client/src/ui/WorldHud.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/style.css`
- Test: `apps/client/tests/adminCatalog.test.ts`

**Interfaces:**
- `AdminApi` accepts `baseUrl` and `getSessionToken: () => string | null`; all calls send bearer token.
- `WorldHud.updateSession(role: UserRole)` shows admin button iff `ADMIN`.
- `AdminPanel.showCatalog()` / `showCreator(itemId?)` / `hide()`.
- Catalog supports search + filters for name/itemId/category/subcategory/rarity/level/status and actions preview/edit/duplicate/archive/history.

- [ ] **Step 1: Write DOM tests** proving admin button hidden for PLAYER and visible/clickable for ADMIN.
- [ ] **Step 2: Write AdminApi tests** for bearer header and normalized handling of 400/401/403/404/409/500.
- [ ] **Step 3: Implement panel shell and catalog** with loading/empty/error states; do not couple DOM directly to `fetch`.
- [ ] **Step 4: Add catalog action tests** for filters, duplicate confirmation, archive confirmation and history opening.
- [ ] **Step 5: Wire WorldScene lifecycle** so panel is created only for ADMIN session and destroyed on scene shutdown.
- [ ] **Step 6: Run client tests + build**; expect PASS.
- [ ] **Step 7: Commit** `feat: add admin item catalog ui`.

### Task 11: Nine-step creator and live tooltip preview

**Files:**
- Create: `apps/client/src/ui/admin/ItemCreatorView.ts`
- Create: `apps/client/src/ui/admin/ItemTooltipPreview.ts`
- Modify: `apps/client/src/net/AdminApi.ts`
- Modify: `apps/client/src/style.css`
- Test: `apps/client/tests/itemCreator.test.ts`

**Interfaces:**
- Creator steps exactly: category/subcategory; basics; behavior; stats; requirements; effects; specialist data; tags/integrations; summary/publication.
- `ItemCreatorView.loadMetadata()` drives available fields from server metadata.
- `ItemTooltipPreview.render(draft)` renders icon, rarity-colored name, level, stats, requirements, description and effects.
- Actions: `saveDraft()`, `publish()`, `cancel()`, `uploadIcon(file)`.

- [ ] **Step 1: Write creator navigation tests** proving category choice filters available stat fields and Material cannot select `CRIT_DAMAGE`.
- [ ] **Step 2: Write modifier/effect tests** for flat/percent/multiplier, negative modifiers, trigger/action fields, proc chance/duration/cooldown and specialist fields.
- [ ] **Step 3: Write live-preview tests** that edits immediately update name/rarity/stat/effect text before server save.
- [ ] **Step 4: Write resilience tests**: validation error highlights field and preserves draft; infrastructure failure preserves form; unsaved close requests confirmation; 409 displays conflict/reload choice.
- [ ] **Step 5: Implement nine-step state machine and renderer**; server remains validation authority while client mirrors metadata constraints for UX.
- [ ] **Step 6: Implement icon upload UI** and immediately use returned URL/key in preview/draft.
- [ ] **Step 7: Run client tests + build**; expect PASS.
- [ ] **Step 8: Commit** `feat: add nine step item creator`.

### Task 12: Version history, comparison and category manager UI

**Files:**
- Create: `apps/client/src/ui/admin/ItemHistoryView.ts`
- Create: `apps/client/src/ui/admin/CategoryManagerView.ts`
- Modify: `apps/client/src/ui/AdminPanel.ts`
- Modify: `apps/client/src/net/AdminApi.ts`
- Modify: `apps/client/src/style.css`
- Test: `apps/client/tests/itemAdminTools.test.ts`

**Interfaces:**
- History view displays version, author, timestamp and changed fields and exposes `restoreVersion(versionNo)` behind confirmation.
- Category manager lists system/custom categories, creates custom category/subcategory, and edits allowed stat mappings only from metadata-provided engine stat codes.
- System categories cannot be hard-deleted from UI.

- [ ] **Step 1: Write history tests** for `v3 -> v4` change display and restore confirmation creating/receiving the new active version.
- [ ] **Step 2: Write category manager tests** proving custom category can select existing stats and UI offers no arbitrary stat-code text input.
- [ ] **Step 3: Implement views and panel navigation**.
- [ ] **Step 4: Run client tests + build**; expect PASS.
- [ ] **Step 5: Commit** `feat: add item history and category manager`.

### Task 13: End-to-end acceptance, persistence and operational documentation

**Files:**
- Create: `apps/server/tests/itemCreatorE2E.test.ts`
- Modify: `apps/server/tests/adminApi.test.ts`
- Modify: `apps/client/tests/itemCreator.test.ts`
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `README.md`
- Create: `docs/item-creator-operations.md`

**Interfaces:**
- No new product interface; this task proves the spec's acceptance criteria and documents required environment variables/migration workflow.

- [ ] **Step 1: Add server E2E test**: ADMIN session -> metadata -> create sword draft -> upload fake icon -> save stat/effect -> publish -> catalog/history -> edit draft -> publish v2 -> restore v1 as v3 -> archive; assert audit records throughout.
- [ ] **Step 2: Add unauthorized E2E test** using a PLAYER bearer token against every mutation family; expect 403 and unchanged row counts.
- [ ] **Step 3: Add persistence E2E test** that re-creates service instances after DB reconnect and confirms catalog/version/item-instance data remains.
- [ ] **Step 4: Add definition-refresh integration test** proving an existing inventory instance resolves v2 base stats after publication while preserving quantity/instance fields.
- [ ] **Step 5: Run** `npm test && npm run build`; expected all workspace tests/builds PASS.
- [ ] **Step 6: Document environment variables**: `DATABASE_URL`, `ADMIN_ACCESS_TOKEN`, `ITEM_ASSET_S3_BUCKET`, `ITEM_ASSET_S3_REGION`, `ITEM_ASSET_S3_ENDPOINT` (optional), S3 credentials, `ITEM_ASSET_PUBLIC_BASE_URL`; include migration/startup procedure and bootstrap ADMIN login behavior.
- [ ] **Step 7: Verify CI** on branch includes PostgreSQL-backed tests and passes.
- [ ] **Step 8: Commit** `test: verify item creator end to end`.

---

## Completion criteria

Before declaring implementation complete, verify all of the following in one fresh run:

1. `npm test` passes for every workspace.
2. `npm run build` passes for every workspace.
3. CI PostgreSQL migration test passes from an empty database.
4. PLAYER requests cannot perform any catalog mutation.
5. ADMIN can create, save, publish, duplicate, version, restore and archive an item.
6. Category choice constrains stat choices in both client and server validation.
7. Custom categories can reuse known stats but cannot add unknown engine stat codes.
8. Icon validation rejects invalid/oversized files before storage write.
9. Published changes update resolved base definition for existing item instances without resetting instance state.
10. Restart/reconnect leaves catalog and item-instance data intact.
11. Audit history identifies actor/action/version changes.
12. Existing world -> battle -> loot -> inventory flow still passes.
