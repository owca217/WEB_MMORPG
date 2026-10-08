# Panel administratora — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać bezpieczny panel administratora, który pozwala kontom z rangą `ADMIN` przeglądać katalog przedmiotów i dodawać wybraną ilość do ekwipunku własnej aktywnej postaci.

**Architecture:** Ranga konta będzie przechowywana w bazie obok istniejącego stanu `active`/`banned`, a serwer będzie ponownie sprawdzał ją przy każdym żądaniu katalogu i dodania przedmiotu. Wspólny katalog definicji przedmiotów zasili istniejące torby, łupy oraz nowe operacje administratora. Grant będzie wykonywany w istniejącej kolejce zmian ekwipunku i jednej transakcji z idempotencyjnym identyfikatorem operacji. Klient dostanie rangę przez `SessionView`, pokaże przycisk na końcu menu i otworzy osobne okno oparte na obecnych kontrolkach okien.

**Tech Stack:** TypeScript, Socket.IO, PostgreSQL migrations, Vitest, Phaser DOM overlays, istniejący styl classic RPG.

**Spec:** `docs/superpowers/specs/2026-10-08-admin-panel-design.md`

## Global Constraints

- Ranga przyjmuje wyłącznie `PLAYER` albo `ADMIN`; istniejący `status` nadal oznacza `active` albo `banned`.
- Jedna operacja dodania przyjmuje ilość całkowitą od 1 do 1000.
- Operacja dodania używa unikalnego `operationId`; ponowienie tego samego żądania nie może podwoić przedmiotów.
- Serwer bierze konto, postać i uprawnienia z autoryzowanego połączenia; klient nie może wybrać innego odbiorcy ani nadać sobie uprawnień.
- Przedmioty trafiają do ogólnego ekwipunku, a torby tworzą osobne instancje z ilością 1.
- Panel jest ukryty dla `PLAYER`, lecz każde żądanie nadal jest odrzucane po stronie serwera.
- Lista i formularz panelu nie mogą przekazywać wpisywanych znaków do sterowania postacią.
- Po zmianie rangi istniejąca sesja odczytuje aktualną rangę przy następnym żądaniu administracyjnym.

## Review Focus

- Ponowienie po timeoutcie lub rozłączeniu — ta sama operacja ma zwrócić istniejący wynik bez drugiego grantu; test w zadaniu 3.
- Ręczne wysłanie eventu przez `PLAYER` albo po odebraniu rangi — serwer ma zwrócić `ADMIN_REQUIRED` i nie zmienić ekwipunku; test w zadaniu 4.
- Dodanie torby przy już wyposażonych torbach i zawartości — sprzęt oraz `containerInstanceId` mają pozostać bez zmian; test w zadaniu 3.
- Ilość `0`, ujemna, ułamkowa, tekstowa, `NaN` i większa niż 1000 — operacja ma zostać odrzucona bez zapisu; testy w zadaniach 3 i 4.
- Wąski ekran, długie nazwy i wpisywanie w formularzu — lista ma być przewijalna, tekst bezpiecznie renderowany, a klawiatura nie ma poruszać postacią; testy modelu widoku i test CSS w zadaniu 6.

### Task 1: Wspólny model rangi, katalogu i protokołu

**Files:**
- Create: `packages/shared/src/itemCatalog.ts`
- Create: `packages/shared/src/itemCatalog.test.ts`
- Modify: `packages/shared/src/inventory.ts`
- Modify: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/auth.test.ts` (create if the auth model has no focused test yet)

**Interfaces:**
- Produces `AccountRole = "PLAYER" | "ADMIN"` and `SessionView.accountRole`.
- Produces `ITEM_DEFINITIONS`, `AdminItemDefinition`, `AdminItemCatalog` and `adminItemDefinition(itemId)` for the six current item types: `simple-bag`, `traditional-backpack`, `travel-backpack`, `expedition-backpack`, `wolf-pelt`, `field-bandage`.
- Produces client/server events `requestAdminCatalog`, `adminCatalog`, `grantAdminItem`, and `adminGrantResult` with typed success/error payloads and an `operationId`.

- [ ] **Step 1: Write failing shared-model tests**

  Assert that the catalog contains all six existing definitions, bag capacities match `BAG_DEFINITIONS`, unknown ids return `null` or the documented typed error, and `AccountRole`/admin event payloads expose the exact names used by later tasks.

- [ ] **Step 2: Run the focused shared tests to verify they fail**

  Run: `npm test -w @web-mmorpg/shared -- itemCatalog.test.ts auth.test.ts`

  Expected: FAIL because the catalog, role field, and event types do not exist yet.

- [ ] **Step 3: Implement the shared catalog and protocol**

  Keep the existing bag definitions as the source of bag capacity values, expose one catalog entry per current item, and update exports. Extend `SessionView` without changing the meaning of `status`.

- [ ] **Step 4: Run the focused shared tests and build**

  Run: `npm test -w @web-mmorpg/shared -- itemCatalog.test.ts auth.test.ts && npm run build -w @web-mmorpg/shared`

  Expected: PASS.

- [ ] **Step 5: Commit the shared contract**

  ```bash
  git add packages/shared/src
  git commit -m "feat: add admin role and item catalog contracts"
  ```

### Task 2: Trwała ranga konta i polecenie operatora

**Files:**
- Create: `apps/server/migrations/005_admin_roles_and_operations.sql`
- Create: `apps/server/src/admin/setAccountRole.ts`
- Modify: `apps/server/src/persistence/AccountRepository.ts`
- Modify: `apps/server/src/auth/AuthService.ts`
- Modify: `apps/server/src/index.ts` or `apps/server/package.json` to expose the operator command
- Test: `apps/server/tests/db/adminRoleMigration.test.ts`
- Test: `apps/server/tests/authService.test.ts`

**Interfaces:**
- `AccountRecord.role: AccountRole` and `AccountRepository.updateRole(accountId, role)` / `findByUsernameForRoleChange(username)`.
- `AuthService` includes `accountRole` in every `SessionView`; `validateToken` returns the current role from the database.
- Operator command shape: `npm run admin:set-role -- <account-username> <PLAYER|ADMIN>`; it exits nonzero for unknown account or invalid role and prints the resulting role.
- Migration creates `admin_item_grants` with unique `operation_id`, account/character/item/quantity columns and timestamps, while preserving existing rows.

- [ ] **Step 1: Add failing migration and repository tests**

  Assert the new role column defaults existing/new accounts to `PLAYER`, rejects another role, and that a repository role update is visible through `findById` and `AuthService.validateToken`.

- [ ] **Step 2: Run database/auth tests to verify failure**

  Run: `npm test -w @web-mmorpg/server -- adminRoleMigration.test.ts authService.test.ts`

  Expected: FAIL because the migration and role mapping are absent.

- [ ] **Step 3: Implement migration, mapping, session view, and operator command**

  Keep the role update separate from the active/banned status update. Use parameterized SQL and normalize the command’s role argument before calling the repository.

- [ ] **Step 4: Run focused tests and build**

  Run: `npm test -w @web-mmorpg/server -- adminRoleMigration.test.ts authService.test.ts && npm run build -w @web-mmorpg/server`

  Expected: PASS.

- [ ] **Step 5: Commit account authorization**

  ```bash
  git add apps/server/migrations/005_admin_roles_and_operations.sql apps/server/src apps/server/tests
  git commit -m "feat: persist account admin roles"
  ```

### Task 3: Idempotent grant service and atomic persistence

**Files:**
- Create: `apps/server/src/admin/AdminGrantService.ts`
- Create: `apps/server/tests/adminGrantService.test.ts`
- Modify: `apps/server/src/persistence/PlayerPersistenceService.ts`
- Modify: `apps/server/src/persistence/InventoryRepository.ts` only if a focused transactional helper is needed
- Test: `apps/server/tests/db/playerPersistence.test.ts`

**Interfaces:**
- `AdminGrantService.grant(input: { operationId: string; accountId: string; characterId: string; itemId: string; quantity: number; inventory: InventorySnapshot; equipment: EquipmentSnapshot }): Promise<{ status: "applied" | "alreadyApplied"; inventory: InventorySnapshot; equipment: EquipmentSnapshot }>`.
- `PlayerPersistenceService.applyAdminGrant(input)` inserts the operation and replaces inventory/equipment in the same transaction; an existing identical operation returns `alreadyApplied`, while a reused id with different item or quantity throws `ADMIN_OPERATION_CONFLICT`.
- `AdminGrantService` validates the catalog and quantity, merges stackable material/medical items into the general inventory, and creates one instance per bag quantity while preserving all existing equipment and bag contents.

- [ ] **Step 1: Write failing grant and persistence tests**

  Cover material stack merge, two separate bag instances, invalid ids/quantities, preserving equipped bags and nested contents, atomic save, identical retry, conflicting retry, and database reload after the grant.

- [ ] **Step 2: Run focused tests to verify failure**

  Run: `npm test -w @web-mmorpg/server -- adminGrantService.test.ts playerPersistence.test.ts`

  Expected: FAIL because the grant service and operation transaction do not exist.

- [ ] **Step 3: Implement the grant service and transaction**

  Insert the operation row first inside the transaction, compare existing payloads on conflict, then write the complete snapshot only for a new operation. Use the existing inventory mutation queue at the socket boundary so other moves and bag equipment changes serialize.

- [ ] **Step 4: Run focused tests and build**

  Run: `npm test -w @web-mmorpg/server -- adminGrantService.test.ts playerPersistence.test.ts && npm run build -w @web-mmorpg/server`

  Expected: PASS.

- [ ] **Step 5: Commit grant persistence**

  ```bash
  git add apps/server/src/admin apps/server/src/persistence apps/server/tests
  git commit -m "feat: add idempotent admin item grants"
  ```

### Task 4: Autoryzowane eventy serwera gry

**Files:**
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/server/tests/inventoryMutationSerialization.test.ts`
- Create: `apps/server/tests/adminSocketFlow.test.ts`
- Modify: `apps/server/src/loot/LootService.ts` and `apps/server/src/inventory/containers.ts` to read shared catalog definitions where needed
- Modify: `apps/client/src/net/GameSocket.ts` later consumes the events from Task 1

**Interfaces:**
- `requestAdminCatalog` returns `adminCatalog` only after current `authToken` validates to an account with role `ADMIN`.
- `grantAdminItem` revalidates the token/role, rejects battle state and invalid payloads with typed `adminGrantResult`, calls `AdminGrantService` inside `enqueueInventoryMutation`, then emits the updated `playerState`.
- `ADMIN_REQUIRED`, `ADMIN_INVALID_ITEM`, `ADMIN_INVALID_QUANTITY`, `ADMIN_IN_BATTLE`, `ADMIN_OPERATION_CONFLICT`, and `PERSISTENCE_FAILED` receive Polish client labels.

- [ ] **Step 1: Write failing socket tests**

  Use the existing synthetic socket/persistent app helpers to assert that `PLAYER` cannot request the catalog or grant, `ADMIN` receives all catalog entries, a successful grant updates player state, grants are rejected during battle, and the same operation id emits no duplicate item.

- [ ] **Step 2: Run focused socket tests to verify failure**

  Run: `npm test -w @web-mmorpg/server -- adminSocketFlow.test.ts inventoryMutationSerialization.test.ts`

  Expected: FAIL because the event handlers are absent.

- [ ] **Step 3: Implement event handlers and error mapping**

  Revalidate with `authService.validateToken(socket.data.authToken)` on each administrative command so a role removed after connection is effective immediately. Derive `characterId` from `playerId`, use the current in-memory snapshot, and reload/emit durable state on idempotent replay.

- [ ] **Step 4: Run focused tests and build**

  Run: `npm test -w @web-mmorpg/server -- adminSocketFlow.test.ts inventoryMutationSerialization.test.ts && npm run build -w @web-mmorpg/server`

  Expected: PASS.

- [ ] **Step 5: Commit server event flow**

  ```bash
  git add apps/server/src apps/server/tests
  git commit -m "feat: expose authorized admin inventory events"
  ```

### Task 5: Ranga w routingu klienta i przycisk menu

**Files:**
- Modify: `apps/client/src/scenes/BootScene.ts`
- Modify: `apps/client/src/scenes/AuthScene.ts`
- Modify: `apps/client/src/scenes/LoginScene.ts`
- Modify: `apps/client/src/scenes/CharacterCreatorScene.ts`
- Modify: `apps/client/src/scenes/CharacterDeletionScene.ts`
- Modify: `apps/client/src/scenes/BattleScene.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/ui/WorldHud.ts`
- Modify: `apps/client/src/ui/windowMenuItems.ts`
- Test: `apps/client/tests/windowMenuItems.test.ts`
- Test: `apps/client/tests/sessionRouting.test.ts`

**Interfaces:**
- All persistent route data that starts `WorldScene` carries `accountRole`; legacy nickname login defaults to `PLAYER`.
- `WorldHud` receives `{ isAdmin, onAdminPanel }` and appends `Panel admin` after `Wyloguj` only when `isAdmin` is true.
- `WorldScene` creates/destroys `AdminPanel` only for `ADMIN` and removes access when the server reports `ADMIN_REQUIRED`.

- [ ] **Step 1: Write failing route/menu tests**

  Assert menu order puts the admin entry after logout, role propagation keeps `ADMIN` through active/creator/deletion/battle routes, and `PLAYER` receives no admin entry.

- [ ] **Step 2: Run focused client tests to verify failure**

  Run: `npm test -w @web-mmorpg/client -- windowMenuItems.test.ts sessionRouting.test.ts`

  Expected: FAIL because route data and conditional menu support are absent.

- [ ] **Step 3: Implement role propagation and conditional menu action**

  Thread the role through scene data at existing route points instead of persisting a second copy in local storage. Keep the legacy login path explicitly non-admin.

- [ ] **Step 4: Run focused tests and client typecheck**

  Run: `npm test -w @web-mmorpg/client -- windowMenuItems.test.ts sessionRouting.test.ts && npm run build -w @web-mmorpg/client`

  Expected: PASS.

- [ ] **Step 5: Commit client access control**

  ```bash
  git add apps/client/src apps/client/tests
  git commit -m "feat: show admin panel entry for admin accounts"
  ```

### Task 6: Panel UI, Socket.IO client and responsive behavior

**Files:**
- Create: `apps/client/src/ui/AdminPanel.ts`
- Create: `apps/client/src/ui/adminPanelViewModel.ts`
- Create: `apps/client/tests/adminPanelViewModel.test.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/theme/classic-rpg.css`
- Modify: `apps/client/src/ui/WorldHud.ts` for focus and menu cleanup if needed
- Test: `apps/client/tests/bagInventoryStyles.test.ts` or a new admin CSS cascade test

**Interfaces:**
- `AdminPanel` exposes `show()`, `hide()`, `destroy()`, `setCatalog(catalog)`, `handleGrantResult(result)`, and `revokeAccess()`.
- `adminPanelViewModel` exposes pure `filterAdminItems(catalog, query, category)` and `normalizeGrantQuantity(value)`; quantities outside 1–1000 return a typed validation result.
- `GameSocket` exposes `requestAdminCatalog()`, `grantAdminItem(payload)`, `onAdminCatalog(handler)`, and `onAdminGrantResult(handler)`.

- [ ] **Step 1: Write failing view-model and socket/UI tests**

  Assert filtering by name/id/category, quantity normalization, operation id generation, bag capacity display, safe text-only rendering, success/error state, disabled submit while pending, and access revocation. Assert the mobile CSS keeps the admin list scrollable and does not override the bag gradient.

- [ ] **Step 2: Run focused client tests to verify failure**

  Run: `npm test -w @web-mmorpg/client -- adminPanelViewModel.test.ts bagInventoryStyles.test.ts`

  Expected: FAIL because the view model, panel, and Socket.IO wrappers do not exist.

- [ ] **Step 3: Implement the Socket.IO wrappers and panel**

  Build the window with `InterfaceWindowControls`, a tools list containing `Przedmioty`, search/category controls, a scrollable catalog, quantity input defaulting to 1, and a Polish status message. Use `textContent` for catalog values. Stop keyboard propagation from text inputs and handle timeout/retry with the same `operationId`.

- [ ] **Step 4: Run focused tests and build the client**

  Run: `npm test -w @web-mmorpg/client -- adminPanelViewModel.test.ts bagInventoryStyles.test.ts && npm run build -w @web-mmorpg/client`

  Expected: PASS.

- [ ] **Step 5: Commit the panel UI**

  ```bash
  git add apps/client/src apps/client/tests
  git commit -m "feat: add admin item panel UI"
  ```

### Task 7: Dokumentacja operatora i pełna weryfikacja

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-admin-panel-design.md` with final operator command notes if implementation details changed
- Create: `docs/superpowers/plans/2026-10-08-admin-panel-verification.md` only if the repository’s existing verification docs need a separate run record
- Test: all existing client/server/shared test suites

**Interfaces:**
- Operator documentation states the migration runs on server startup and the first administrator is created with `npm run admin:set-role -- <login> ADMIN`.

- [ ] **Step 1: Run the complete test suite**

  Run: `npm test`

  Expected: all client, server, and shared test files pass with the configured PostgreSQL test database.

- [ ] **Step 2: Run the complete build and diff checks**

  Run: `npm run build && git diff --check`

  Expected: all workspace builds pass and the diff has no whitespace errors.

- [ ] **Step 3: Review the final access paths**

  Verify a `PLAYER` account cannot see the menu item, an `ADMIN` account can open the panel, grant each of the six definitions, see the updated inventory, and cannot grant during battle. Verify removing `ADMIN` blocks the next catalog/grant request.

- [ ] **Step 4: Commit documentation and final verification**

  ```bash
  git add docs
  git commit -m "docs: record admin panel operation"
  ```

- [ ] **Step 5: Publish the branch through GitHub with a lease**

  Read the current remote ref, create blobs/tree/commit from the final local files, and update `feature/mvp-vertical-slice` with the expected remote SHA. Confirm the commit ref, Feature CI, and GitHub Pages workflow before reporting completion.
