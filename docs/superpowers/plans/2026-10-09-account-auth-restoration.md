# Account Auth Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the temporary nickname + `ADMIN_ACCESS_TOKEN` login with persistent username/password accounts, PostgreSQL-backed sessions, persistent character identity/state, role-based ADMIN access, recovery, and account administration while preserving the existing Item Creator and gameplay.

**Architecture:** Reuse and adapt the historical account/auth design instead of restoring it byte-for-byte. PostgreSQL becomes the source of truth for accounts, sessions, roles, characters, character runtime state, and inventory ownership; REST handles registration/login/recovery/session validation, while Socket.IO authenticates with the same opaque session token and derives gameplay identity from the persistent character. The existing Admin API remains REST-based but swaps its in-memory `SessionStore` guard for database-backed auth context.

**Tech Stack:** TypeScript 5.9, Node.js 22, npm 11, Express 5.1, Socket.IO 4.8.3, PostgreSQL 16 via `pg`, Argon2id via `argon2`, Phaser, Zod where already used, Vitest 5.0.1, Supertest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-09-account-auth-restoration-design.md`

## Global Constraints

- Public registration always creates `PLAYER`; request payloads cannot choose role or status.
- Passwords are 10–256 characters and stored only as Argon2id hashes.
- Usernames normalize case-insensitively and must match `[a-z0-9_-]{3,32}` after trim/lowercase.
- Raw session tokens and recovery codes are never stored in PostgreSQL; only hashes are stored.
- One active session per account in this iteration; a new login revokes/replaces the previous active session.
- One character per account in this iteration.
- `accounts.role` is the only source of `PLAYER`/`ADMIN` authorization.
- The browser may persist only the opaque session token and non-secret session view; never password or recovery code.
- Admin authorization is always enforced server-side. Hidden UI controls are not security.
- The last active ADMIN cannot be demoted or banned; violations return `409`.
- The Item Creator catalog/version model remains the source of item definitions and must not lose data during migration.
- New inventory writes/read ownership use persistent `character_id`; legacy `player_id` rows are preserved as unassigned legacy/orphans and are never guessed onto an account by nickname.
- Persistent character state includes identity, nickname/appearance, location, position, level/HP/AP and existing injury flags needed by current gameplay.
- Migrations are additive and run before HTTP/Socket.IO starts.
- Final production Pages artifact must contain the current `main` build even while the repository's GitHub Pages environment still requires the approved deploy branch workaround.

## File Structure

### Shared contracts
- Create `packages/shared/src/auth.ts` — account/session/recovery and character lifecycle contracts.
- Create `packages/shared/src/accountAdmin.ts` — account list/admin mutation contracts.
- Modify `packages/shared/src/protocol.ts` — replace nickname login with explicit `authenticate` session-token event.
- Modify `packages/shared/src/index.ts` — export auth/account contracts.

### Server auth/persistence
- Create `apps/server/src/db/migrations/002_account_auth.sql` — accounts, account_sessions, characters, persistent inventory owner, account-aware audit fields/indexes.
- Create `apps/server/src/auth/credentials.ts` — username validation and Argon2id helpers.
- Create `apps/server/src/auth/secrets.ts` — session/recovery secret generation and opaque hashing.
- Create `apps/server/src/auth/AuthService.ts` — register/login/session/logout/recovery.
- Create `apps/server/src/auth/AuthContext.ts` — Bearer token parsing/validation and request auth context.
- Create `apps/server/src/auth/bootstrapInitialAdmin.ts` — one-time first-admin bootstrap.
- Create `apps/server/src/persistence/AccountRepository.ts` — account data access.
- Create `apps/server/src/persistence/SessionRepository.ts` — durable session data access.
- Create `apps/server/src/persistence/CharacterRepository.ts` — durable character data access and runtime state updates.
- Create `apps/server/src/character/CharacterLifecycleService.ts` — create/read character lifecycle and hydrate/persist runtime state.
- Create `apps/server/src/http/createAuthRouter.ts` — `/api/auth/*` and `/api/character/*`.
- Create `apps/server/src/http/AuthRateLimiter.ts` — bounded auth-attempt limiter reused from historical behavior.
- Create `apps/server/src/server/ActiveConnectionRegistry.ts` — map account/session to active sockets so logout/recovery/new login/ban can terminate stale gameplay connections.
- Modify `apps/server/src/admin/AdminAuth.ts` — require DB-backed ADMIN auth context.
- Create `apps/server/src/admin/AccountAdminService.ts` — list accounts, role/status mutation, last-admin protection.
- Modify `apps/server/src/admin/createAdminRouter.ts` — account management routes.
- Modify `apps/server/src/audit/AdminAuditRepository.ts` — audit item/account mutations with account actor identity while preserving legacy audit rows.
- Modify `apps/server/src/inventory/InventoryService.ts` — owner is `characterId`, not ephemeral playerId.
- Modify `apps/server/src/server/createGameServer.ts` — authenticate socket with session token, load persistent character, save runtime character state.
- Modify `apps/server/src/index.ts` — startup ordering, routers, auth services, bootstrap.
- Modify `apps/server/package.json` and root lockfile — add `argon2`, retain verified npm/CI behavior.

### Client
- Create `apps/client/src/net/AuthApi.ts` — register/login/session/logout/recover/character REST client.
- Replace responsibilities in `apps/client/src/state/SessionStateStore.ts` — localStorage-backed opaque token + SessionView cache.
- Create/adapt `apps/client/src/scenes/AuthScene.ts` — login/register/recover modes.
- Create/adapt `apps/client/src/scenes/CharacterCreatorScene.ts` — persistent character creation.
- Modify `apps/client/src/scenes/BootScene.ts` — session resume and route.
- Retire `apps/client/src/scenes/LoginScene.ts` after AuthScene is wired.
- Modify `apps/client/src/net/GameSocket.ts` — socket `authenticate` uses opaque session token.
- Modify `apps/client/src/scenes/WorldScene.ts` — role-driven Admin panel and logout behavior.
- Modify `apps/client/src/ui/AdminPanel.ts` — add Accounts navigation.
- Create `apps/client/src/ui/admin/AccountManagerView.ts` — search/list/role/status management.
- Modify `apps/client/src/net/AdminApi.ts` — account administration calls.
- Modify `apps/client/src/game/config.ts` and `apps/client/src/style.css` — scene registration/auth/account UI.

### Verification/deployment
- Modify `.github/workflows/feature-ci.yml` — auth/migration integration tests on PostgreSQL 16.
- Modify `.github/workflows/pages.yml` and the Pages-approved bridge workflow copy — remove `VITE_ENABLE_ADMIN_LOGIN`, keep final artifact sourced from current `main`.
- Modify `README.md` / operational docs — new auth/bootstrap/deployment variables and removal sequence for temporary ADMIN token.

## Review Focus

1. **Forged identity/role in REST or Socket.IO:** a valid PLAYER token plus forged `role`, `accountId`, `characterId`, `playerId`, or nickname must still resolve to the server-side PLAYER account/character and ADMIN mutations must return `403`. Covered in Tasks 5, 7, and 8.
2. **Concurrent last-admin mutations:** two ADMIN demotion/ban requests racing must never both commit and leave zero active admins; one must fail with `409`. Covered in Task 8.
3. **Legacy inventory ownership:** existing `item_instances.player_id` rows must survive migration but must not appear in a newly created character inventory until explicitly migrated later. Covered in Tasks 2 and 6.
4. **Credential/session secret leakage:** password, recovery code, raw session token, bootstrap password/recovery code must not appear in DB plaintext, HTTP error bodies, admin audit summaries, or server logs. Covered in Tasks 3, 5, and 12.
5. **Stale role/session state:** after ban, role change, recovery, logout, or replacement login, a previously connected socket/request must not keep old privileges. Covered in Tasks 5, 7, 8, and 12.

---

### Task 1: Shared auth/account contracts and Argon2 dependency

**Files:**
- Create: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/accountAdmin.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/package.json`
- Modify: `package-lock.json`
- Test: `packages/shared/src/auth.test.ts`

**Interfaces:**
- Produces `CharacterLifecycleSummary = {state:"none"} | {state:"active"; characterId:string; nickname:string} | {state:"pendingDeletion"; characterId:string; nickname:string; deletionEffectiveAt:string}`.
- Produces `AccountRole` with the same values as existing `UserRole`: `"PLAYER" | "ADMIN"`.
- Produces `SessionView { accountUsername:string; accountRole:AccountRole; character:CharacterLifecycleSummary }`.
- Produces `RegisterResponse { recoveryCode:string }`, `LoginResponse { token:string; session:SessionView }`, `RecoverResponse { recoveryCode:string }`.
- Produces `SocketAuthResult = {ok:true; characterId:string; locationId:LocationId} | {ok:false; code:string; message:string}`.
- `ClientToServerEvents.authenticate(payload:{sessionToken:string}, ack:(result:SocketAuthResult)=>void)` replaces the current `login({nickname,adminToken})` event.
- Produces account-admin types: `AccountStatus`, `AdminAccountSummary`, `AdminAccountPage`, `AdminAccountQuery`, `UpdateAccountAccessInput`.

- [ ] **Step 1: Write failing shared-contract tests**

Add tests that instantiate all lifecycle variants, assert role values are `PLAYER|ADMIN`, verify LoginResponse contains token + SessionView, verify SocketAuthResult/authenticate payload carries no role/account/player/nickname authority, and verify account-admin mutation input can express only role/status values.

- [ ] **Step 2: Run shared tests to verify RED**

Run: `npm test -w @web-mmorpg/shared`
Expected: FAIL because `auth.ts` / `accountAdmin.ts` exports and new protocol contract do not exist.

- [ ] **Step 3: Add the shared contracts and `argon2` dependency**

Add `argon2@^0.44.0` to server dependencies and update the lockfile. Stage downstream call sites only enough to compile; do not implement auth behavior in this task.

- [ ] **Step 4: Run shared tests and full typecheck**

Run: `npm test -w @web-mmorpg/shared && npm run build`
Expected: PASS with staged type adapters; runtime still follows old behavior until later tasks.

- [ ] **Step 5: Commit**

`git commit -m "feat: add persistent account auth contracts"`

---

### Task 2: Additive PostgreSQL auth/character/inventory-owner/audit migration

**Files:**
- Create: `apps/server/src/db/migrations/002_account_auth.sql`
- Test: `apps/server/tests/authMigration.test.ts`
- Test: `apps/server/tests/migrate.test.ts`

**Interfaces:**
- Produces tables `accounts`, `account_sessions`, `characters`.
- `accounts.role` is constrained to `PLAYER|ADMIN`; `status` to `active|banned`.
- `account_sessions` stores only `token_hash`, supports expiry/revocation, and enforces one active session per account.
- `characters.account_id` is unique and stores nickname/appearance/location/x/y/level/hp/max_hp/max_ap/initiative/injury state plus timestamps.
- Adds nullable `item_instances.character_id UUID REFERENCES characters(id) ON DELETE CASCADE` and index.
- Existing `player_id` remains as a legacy owner column so old rows are preserved; new code stops using it after Task 6.
- Adds nullable `admin_audit_log.actor_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL`, drops the old `actor_player_id NOT NULL` requirement without deleting the column, and keeps all existing Item Creator audit rows valid.

- [ ] **Step 1: Write failing migration tests**

Tests start from (a) empty DB and (b) DB already migrated with `001_item_catalog.sql`, insert published item/version, legacy `item_instances.player_id`, and an existing admin audit row; run migrations; assert auth schema exists, item catalog/history/audit counts remain unchanged, legacy instance has `character_id IS NULL`, and legacy audit row remains readable with `actor_account_id IS NULL`.

- [ ] **Step 2: Run migration tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- authMigration.test.ts migrate.test.ts`
Expected: FAIL because migration `002_account_auth.sql` does not exist.

- [ ] **Step 3: Implement the additive migration**

Use the current `schema_migrations` runner. Do not copy historical migration numbering or create a second runner.

- [ ] **Step 4: Run migration tests twice against the same schema**

Run: `npm test -w @web-mmorpg/server -- authMigration.test.ts migrate.test.ts`
Expected: PASS, including repeat-migration safety and unchanged item catalog/history/audit rows.

- [ ] **Step 5: Commit**

`git commit -m "feat: add persistent account schema"`

---

### Task 3: Credentials, opaque secrets, repositories, and AuthService

**Files:**
- Create: `apps/server/src/auth/credentials.ts`
- Create: `apps/server/src/auth/secrets.ts`
- Create: `apps/server/src/auth/AuthService.ts`
- Create: `apps/server/src/persistence/AccountRepository.ts`
- Create: `apps/server/src/persistence/SessionRepository.ts`
- Test: `apps/server/tests/authService.test.ts`

**Interfaces:**
- `validateUsername(input) -> {ok:true; normalized:string} | {ok:false; code:"INVALID_USERNAME"}`.
- `validatePassword(password) -> boolean` with length 10–256.
- `hashPassword`, `verifyPassword` use Argon2id.
- `generateSessionToken() -> string`; `generateRecoveryCode() -> string`; `hashOpaqueSecret(secret) -> SHA-256 hex`.
- `AuthService.register(username,password) -> Promise<RegisterResponse>`; always creates PLAYER.
- `AuthService.login(username,password) -> Promise<{accountId:string; token:string; session:SessionView}>`.
- `AuthService.validateToken(token) -> Promise<ValidatedAuthSession|null>` reads current account role/status each time.
- `AuthService.logout(token) -> Promise<void>`.
- `AuthService.recover(username,recoveryCode,newPassword) -> Promise<{accountId:string; response:RecoverResponse}>` atomically rotates password/recovery and revokes all sessions.

- [ ] **Step 1: Write failing service/security tests**

Cover case-insensitive duplicate username, invalid username/password, plaintext not present in `password_hash`, Argon2 verify, bad credentials -> same `INVALID_CREDENTIALS`, banned account -> 403 service error, raw session token absent from DB, expiry/revocation, second login revokes first session, logout, recovery success/failure, recovery rotates code and revokes sessions.

Add Review Focus test: capture repository rows/error serialization and assert plaintext password, recovery code, and raw token do not appear.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- authService.test.ts`
Expected: FAIL on missing auth/repository modules.

- [ ] **Step 3: Implement minimal repositories and AuthService**

Reuse the historical service behavior, adapted to the current DB helpers and shared types. Transactions are required for login session replacement and recovery.

- [ ] **Step 4: Run service tests and typecheck**

Run: `npm test -w @web-mmorpg/server -- authService.test.ts && npm run build -w @web-mmorpg/server`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: restore durable authentication service"`

---

### Task 4: Persistent character lifecycle and runtime state

**Files:**
- Create: `apps/server/src/persistence/CharacterRepository.ts`
- Create: `apps/server/src/character/CharacterLifecycleService.ts`
- Modify/adapt: `apps/server/src/character/CharacterService.ts`
- Test: `apps/server/tests/characterLifecycle.test.ts`
- Test: `apps/server/tests/characterStatePersistence.test.ts`

**Interfaces:**
- `CharacterLifecycleService.getLifecycle(accountId, now) -> Promise<CharacterLifecycleSummary>`.
- `getCharacter(accountId) -> Promise<CharacterRecord|null>`.
- `createCharacter(accountId,{nickname,appearance}) -> Promise<CharacterRecord>`.
- `CharacterRepository.updateRuntimeState(characterId, statePatch) -> Promise<void>` persists at least locationId/x/y/level/hp/maxHp/maxAp/initiative/severelyInjured fields owned by current gameplay.
- `CharacterLifecycleService.hydrateRuntimeCharacter(accountId) -> Promise<CharacterRecord|null>` supplies the persistent character ID/state for Socket.IO.
- One character per account; nickname uniqueness is case-insensitive.
- Initial location remains `forest-settlement-01` with current spawn defaults.

- [ ] **Step 1: Write failing lifecycle/state tests**

Cover account with no character -> `none`, create -> `active`, duplicate account/nickname rejection, invalid nickname/appearance validation, reload service -> same character id/state, mutate HP/location/position -> persist -> reconstruct services -> restored values.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- characterLifecycle.test.ts characterStatePersistence.test.ts`
Expected: FAIL on missing repository/service and persistence methods.

- [ ] **Step 3: Implement persistent lifecycle and runtime state mapping**

Adapt historical CharacterRepository/Lifecycle behavior only where compatible with current character snapshot fields; do not restore old duplicate inventory tables. Keep mapping between DB snake_case and current shared/runtime fields isolated in the repository/service.

- [ ] **Step 4: Run tests and build**

Run: `npm test -w @web-mmorpg/server -- characterLifecycle.test.ts characterStatePersistence.test.ts && npm run build -w @web-mmorpg/server`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: persist account characters"`

---

### Task 5: Auth/character REST API, request auth context, rate limiting, and initial ADMIN bootstrap

**Files:**
- Create: `apps/server/src/auth/AuthContext.ts`
- Create: `apps/server/src/auth/bootstrapInitialAdmin.ts`
- Create: `apps/server/src/http/AuthRateLimiter.ts`
- Create: `apps/server/src/http/createAuthRouter.ts`
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/tests/authApi.test.ts`
- Test: `apps/server/tests/adminBootstrap.test.ts`

**Interfaces:**
- `POST /api/auth/register` -> 201 RegisterResponse; accepts username/password/passwordConfirmation but rejects/ignores any role/status elevation fields.
- `POST /api/auth/login` -> 200 LoginResponse.
- `GET /api/auth/session` -> SessionView using Bearer token.
- `POST /api/auth/logout` -> 204.
- `POST /api/auth/recover` -> RecoverResponse.
- `GET /api/character` and `POST /api/character` use the same Bearer session.
- `requireAuthContext(authService, authorizationHeader) -> {accountId, sessionId, role, characterId?}` or normalized 401/403 error.
- `bootstrapInitialAdmin(pool, env) -> Promise<"created"|"skipped">` requires all three `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_RECOVERY_CODE` only when no active ADMIN exists.

- [ ] **Step 1: Write failing API/bootstrap tests**

Cover endpoint status mapping, password confirmation, no auto-login after registration, generic bad-login/recovery errors, session resume, banned session -> 403, rate limit behavior, character auth, bootstrap create/skip/conflict, and no implicit role elevation of an existing username.

Add Review Focus tests asserting forged `role/accountId/characterId` fields are ignored and bootstrap secrets never appear in captured logs/error bodies.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- authApi.test.ts adminBootstrap.test.ts`
Expected: FAIL on missing router/context/bootstrap.

- [ ] **Step 3: Implement router/context/bootstrap and startup order**

Startup order becomes: create pool -> migrations -> bootstrap auth admin -> seed item metadata -> construct services/routers -> listen.

- [ ] **Step 4: Run API/bootstrap tests and full server build**

Run: `npm test -w @web-mmorpg/server -- authApi.test.ts adminBootstrap.test.ts && npm run build -w @web-mmorpg/server`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: expose persistent auth API"`

---

### Task 6: Move inventory ownership to persistent character IDs

**Files:**
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Modify: `packages/shared/src/inventory.ts` only if naming must distinguish character-bound ownership from legacy binding fields.
- Test: `apps/server/tests/inventoryPersistence.test.ts`
- Test: `apps/server/tests/authMigration.test.ts`

**Interfaces:**
- `InventoryService.addItems(characterId, rewards)` and `getSnapshot(characterId)` use `item_instances.character_id`.
- New inserted item instances set `character_id`; legacy `player_id` is not used for owner lookup.
- Existing item definition joins/version refresh behavior is unchanged.

- [ ] **Step 1: Write failing persistent-owner tests**

Create an account + character, award loot, reconstruct InventoryService, verify same instance IDs/quantities by `character_id`; publish a new item definition version and verify existing instance resolves the new base definition. Insert a legacy row with only `player_id` and assert it does not appear for the new character.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- inventoryPersistence.test.ts authMigration.test.ts`
Expected: FAIL because InventoryService still queries/writes `player_id`.

- [ ] **Step 3: Switch new inventory ownership to `character_id`**

Preserve legacy columns/data; do not backfill from nickname or temporary UUID.

- [ ] **Step 4: Run inventory/migration tests**

Run: `npm test -w @web-mmorpg/server -- inventoryPersistence.test.ts authMigration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: bind inventory to persistent characters"`

---

### Task 7: Authenticate Socket.IO with durable sessions and persist gameplay character state

**Files:**
- Create: `apps/server/src/server/ActiveConnectionRegistry.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `packages/shared/src/protocol.ts`
- Test: `apps/server/tests/socketAuthFlow.test.ts`
- Modify/Test: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `GameSocket.authenticate(sessionToken:string)` emits `authenticate({sessionToken})` and receives `SocketAuthResult`.
- Server resolves token -> current account -> active character; runtime world/battle player ID becomes persistent `character.id`.
- `ActiveConnectionRegistry.closeAccount(accountId, reason)` disconnects stale sockets after replacement login/logout/recovery/ban.
- Invalid/revoked/banned session cannot start gameplay.
- Server hydrates CharacterService/WorldService from persistent character state at authentication and writes changed location/position/HP/progression state through CharacterRepository at defined mutation/disconnect checkpoints.

- [ ] **Step 1: Write failing socket auth/persistence tests**

Cover valid token + active character -> world, missing character -> rejected/not world, invalid token -> rejected, forged player/account/role/nickname values cannot change resolved identity, replacement login invalidates old socket, reconnect preserves character + inventory, and HP/location/position survive service/server reconstruction.

- [ ] **Step 2: Run socket tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- socketAuthFlow.test.ts socketFlow.test.ts characterStatePersistence.test.ts`
Expected: FAIL because createGameServer still calls in-memory `SessionStore.login(nickname, adminToken)` and drops runtime character state on disconnect.

- [ ] **Step 3: Replace memory-session login with durable auth and persistence checkpoints**

Reuse AuthService/CharacterLifecycleService from Tasks 3–5. Disconnect removes only transient world/battle projections; it never deletes account/session/character/inventory. Persist state after movement checkpoints, healing/battle completion, and disconnect; avoid a database write for every render frame.

- [ ] **Step 4: Run socket tests and server/client typecheck**

Run: `npm test -w @web-mmorpg/server -- socketAuthFlow.test.ts socketFlow.test.ts characterStatePersistence.test.ts && npm run build`
Expected: PASS, including existing forest -> battle -> loot -> inventory flow.

- [ ] **Step 5: Commit**

`git commit -m "feat: authenticate gameplay with account sessions"`

---

### Task 8: Rewire Admin authorization and add account administration backend

**Files:**
- Modify: `apps/server/src/admin/AdminAuth.ts`
- Create: `apps/server/src/admin/AccountAdminService.ts`
- Modify: `apps/server/src/admin/createAdminRouter.ts`
- Modify: `apps/server/src/audit/AdminAuditRepository.ts`
- Test: `apps/server/tests/adminAccountAccess.test.ts`
- Modify/Test: `apps/server/tests/adminRouter.test.ts`

**Interfaces:**
- `requireAdminSession(authService, authorizationHeader)` validates DB session and current `accounts.role/status` on every request.
- `GET /api/admin/accounts?search=&page=&pageSize=` -> AdminAccountPage.
- `PUT /api/admin/accounts/:accountId/access` body `{role?,status?}` -> AdminAccountSummary.
- `AccountAdminService.updateAccess(actorAccountId,targetAccountId,input)` runs in a transaction and protects the last active ADMIN.
- New audit records set `actor_account_id`; existing Item Creator audit rows with only legacy actor field remain readable.
- Account access audit summary records target account ID and previous/new role/status only; never credentials or secrets.

- [ ] **Step 1: Write failing admin access tests**

Cover PLAYER `403` across item/admin-account mutation families, ADMIN success, forged role headers/body ignored, role change effective on next request, banned account loses access, last active ADMIN cannot be demoted/banned, and all account mutations audited.

Add Review Focus concurrency test: two simultaneous transactions targeting the final two active ADMINs cannot both commit leaving zero; one returns conflict (`409`).

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/server -- adminAccountAccess.test.ts adminRouter.test.ts`
Expected: FAIL because AdminAuth still trusts in-memory SessionStore and account endpoints do not exist.

- [ ] **Step 3: Implement DB-backed admin guard and account service/routes**

Use a transaction-level advisory lock (or equivalently strict serializing lock documented in the implementation) around the active-admin count check and target mutation so concurrent demote/ban requests cannot both pass.

- [ ] **Step 4: Run admin tests and full server suite**

Run: `npm test -w @web-mmorpg/server -- adminAccountAccess.test.ts adminRouter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: authorize admins through persistent accounts"`

---

### Task 9: Client AuthApi and persistent SessionStateStore with auto-resume

**Files:**
- Create: `apps/client/src/net/AuthApi.ts`
- Modify: `apps/client/src/state/SessionStateStore.ts`
- Modify: `apps/client/src/scenes/BootScene.ts`
- Test: `apps/client/tests/authApi.test.ts`
- Test: `apps/client/tests/sessionStateStore.test.ts`
- Test: `apps/client/tests/bootAuthFlow.test.ts`

**Interfaces:**
- `AuthApi.register/login/getSession/logout/recover/getCharacter/createCharacter` use the server base URL and normalized `code/message` errors.
- `SessionStateStore.setAuthenticated(token, session)`, `getToken()`, `getSession()`, `updateSession(session)`, `reset()`.
- Persist only token in a named localStorage key plus optional non-secret SessionView cache; never credentials/recovery code.
- Boot flow: no token -> AuthScene; valid token -> route by lifecycle; 401 -> reset -> AuthScene.

- [ ] **Step 1: Write failing AuthApi/store/Boot tests**

Assert Bearer header, normalized failures, reload restores token, invalid session clears storage, logout reset, and localStorage does not contain password/recovery test values.

- [ ] **Step 2: Run client tests to verify RED**

Run: `npm test -w @web-mmorpg/client -- authApi.test.ts sessionStateStore.test.ts bootAuthFlow.test.ts`
Expected: FAIL on missing AuthApi/new store behavior.

- [ ] **Step 3: Implement API/store/Boot routing**

Keep token storage behind SessionStateStore so scenes do not access localStorage directly.

- [ ] **Step 4: Run client tests and build**

Run: `npm test -w @web-mmorpg/client -- authApi.test.ts sessionStateStore.test.ts bootAuthFlow.test.ts && npm run build -w @web-mmorpg/client`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: restore persistent client sessions"`

---

### Task 10: Restore AuthScene and CharacterCreatorScene UX

**Files:**
- Create/adapt: `apps/client/src/scenes/AuthScene.ts`
- Create/adapt: `apps/client/src/scenes/CharacterCreatorScene.ts`
- Modify: `apps/client/src/game/config.ts`
- Modify: `apps/client/src/style.css`
- Retire: `apps/client/src/scenes/LoginScene.ts`
- Test: `apps/client/tests/authScene.test.ts`
- Test: `apps/client/tests/characterCreatorScene.test.ts`

**Interfaces:**
- AuthScene modes: login, register, recover.
- Registration sends username/password/passwordConfirmation, shows one-time recovery modal, returns to login with username prefilled and password blank; no auto-login.
- Recovery shows new recovery code, clears existing session token, then returns to login.
- CharacterCreatorScene posts nickname/appearance under Bearer auth and enters WorldScene only after successful creation/session refresh.

- [ ] **Step 1: Write failing DOM/scene tests**

Cover all three modes, client validation, server errors preserving fields, password confirmation mismatch, recovery modal, no secret storage, no auto-login registration, creator routing and create errors.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/client -- authScene.test.ts characterCreatorScene.test.ts`
Expected: FAIL because AuthScene/CharacterCreatorScene are absent from current config.

- [ ] **Step 3: Adapt historical scenes to current visual/UI patterns and AuthApi**

Do not reintroduce the old raw HTTP handler/client implementation; use Task 9 AuthApi.

- [ ] **Step 4: Run scene tests and client build**

Run: `npm test -w @web-mmorpg/client -- authScene.test.ts characterCreatorScene.test.ts && npm run build -w @web-mmorpg/client`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: restore account login and character creation UI"`

---

### Task 11: Integrate account role/logout and Accounts view into the live game/admin UI

**Files:**
- Modify: `apps/client/src/scenes/WorldScene.ts`
- Modify: `apps/client/src/ui/WorldHud.ts`
- Modify: `apps/client/src/ui/AdminPanel.ts`
- Modify: `apps/client/src/net/AdminApi.ts`
- Create: `apps/client/src/ui/admin/AccountManagerView.ts`
- Test: `apps/client/tests/accountManagerView.test.ts`
- Modify/Test: `apps/client/tests/adminPanel.test.ts`
- Modify/Test: `apps/client/tests/worldHud.test.ts`

**Interfaces:**
- World UI derives role from current SessionView, not Socket.IO authentication ack.
- Logout calls AuthApi logout, disconnects GameSocket, clears SessionStateStore, returns to AuthScene even if logout HTTP request fails.
- AdminApi adds `listAccounts(query)` and `updateAccountAccess(accountId,input)`.
- AdminPanel adds `Konta` navigation only for ADMIN session.
- AccountManagerView supports search/pagination and explicit promote/demote/ban/unban confirmation; `409` last-admin conflict is shown without losing list state.

- [ ] **Step 1: Write failing UI tests**

Cover PLAYER no Admin button, ADMIN sees existing Item Creator unchanged, Accounts view calls APIs, role/status updates refresh row, 409 displays conflict, logout clears local session on success and network failure.

- [ ] **Step 2: Run tests to verify RED**

Run: `npm test -w @web-mmorpg/client -- accountManagerView.test.ts adminPanel.test.ts worldHud.test.ts`
Expected: FAIL because accounts UI and new session source are not wired.

- [ ] **Step 3: Implement account UI + role source + logout**

Preserve Item Catalog/Creator/History/Category views as-is except navigation/session-token provider changes.

- [ ] **Step 4: Run client admin/HUD tests and full client suite**

Run: `npm test -w @web-mmorpg/client`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat: add account administration UI"`

---

### Task 12: Remove temporary ADMIN-token flow, full E2E/migration verification, and production deployment docs

**Files:**
- Delete/retire: `apps/server/src/session/SessionStore.ts` if no remaining legitimate use.
- Modify: `apps/server/src/index.ts`
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `.github/workflows/pages.yml`
- Modify equivalent Pages-approved branch bridge workflow source if still required by GitHub environment policy.
- Modify: `README.md`
- Create/Test: `apps/server/tests/accountAuthE2E.test.ts`
- Create/Test: `apps/server/tests/accountAuthMigrationCompatibility.test.ts`
- Modify/Test: deployment workflow regression test currently guarding Pages configuration.

**Interfaces:**
- Production no longer requires `ADMIN_ACCESS_TOKEN` or `VITE_ENABLE_ADMIN_LOGIN` for login/admin access.
- Required first-admin bootstrap variables are `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_PASSWORD`, `INITIAL_ADMIN_RECOVERY_CODE`; docs instruct removal after successful bootstrap.
- Final Pages artifact is built from current `main` with normal account login UI.

- [ ] **Step 1: Write final failing E2E/deployment regression tests**

E2E sequence: register PLAYER -> capture recovery code -> explicit login -> create character -> world -> reconnect/reload resume -> no Admin panel/403 admin API -> bootstrap ADMIN login -> Item Creator access -> create/publish item -> promote second account -> current role applies at next validation -> recover password -> old REST token and old socket invalid -> new login works.

Migration compatibility fixture starts with existing Item Creator/catalog/history/audit + legacy inventory row, applies auth migration, runs E2E, and verifies catalog/history/audit counts unchanged and legacy orphan remains unassigned.

Deployment test asserts final client workflow does not set `VITE_ENABLE_ADMIN_LOGIN`, does not rely on `ADMIN_ACCESS_TOKEN`, and the Pages-approved bridge checks out/builds current `main` until the environment rule can be changed.

- [ ] **Step 2: Run targeted final tests to verify RED before cleanup**

Run: `npm test -w @web-mmorpg/server -- accountAuthE2E.test.ts accountAuthMigrationCompatibility.test.ts` plus the deployment regression test.
Expected: FAIL until remaining legacy token/session code and workflow flags are removed.

- [ ] **Step 3: Remove legacy login/token bootstrap and finalize docs/workflows**

Search repository for `ADMIN_ACCESS_TOKEN`, `VITE_ENABLE_ADMIN_LOGIN`, `adminToken`, nickname-auth `login` event, and in-memory SessionStore usage. After this step, occurrences may remain only in migration/history documentation explicitly describing removed behavior, not runtime code/workflows.

README/ops docs must describe DB migration, bootstrap variables, recovery code handling, Render configuration, post-bootstrap variable removal, and current Pages bridge limitation.

- [ ] **Step 4: Run the complete verification gate**

Run in CI on PostgreSQL 16:

`npm run db:migrate -w @web-mmorpg/server`

`npm test`

`npm run build`

Expected: all SUCCESS. Also verify migration succeeds against both an empty DB and fixture DB with existing Item Creator data.

- [ ] **Step 5: Production smoke verification after merge/deploy**

Verify backend health/startup logs contain no secret values; create/validate PLAYER session; login bootstrap ADMIN and use one read + one harmless draft Item Creator operation; verify Pages AuthScene has login/register/recover and no ADMIN token field. Remove `INITIAL_ADMIN_*` from hosting after bootstrap is confirmed.

- [ ] **Step 6: Commit**

`git commit -m "feat: complete persistent account authentication"`

---

## Final Whole-Branch Review Checklist

- Confirm every requirement in the spec maps to one of Tasks 1–12.
- Inspect all auth/admin error paths for secret/SQL leakage.
- Confirm no runtime authorization path trusts client-supplied role/account/character/player identifiers.
- Confirm last-admin protection is transactionally race-safe.
- Confirm session replacement/recovery/logout/ban close or invalidate stale sockets.
- Confirm character identity plus HP/location/position persist across reconnect/restart.
- Confirm Item Creator version/history/catalog tests remain unchanged and GREEN.
- Confirm inventory reads/writes use `character_id`, while legacy rows remain preserved but unassigned.
- Confirm legacy Item Creator audit rows survive and new audit entries identify actor accounts.
- Confirm production workflows publish the latest final `main` artifact and do not expose a special ADMIN login field.
