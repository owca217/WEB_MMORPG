# Permanent Starter Backpack Implementation Plan

**Goal:** Replace the leftmost container slot with a permanent16-place backpack, available from character creation, with a generated game icon.

**Architecture:** Keep one real owned container instance flagged `permanentContainer` in reserved slot0. Server/database rules fix its owner, binding, quantity, capacity16 and assignment. The other three slots remain ordinary containers. Existing slot0 bags are unassigned safely; their items and contents are preserved.

## Contract

Shared inventory constants: `PERMANENT_BACKPACK_SLOT_INDEX=0`, `PERMANENT_BACKPACK_CAPACITY=16`, `PERMANENT_BACKPACK_ITEM_ID="permanent-backpack"`, `PERMANENT_BACKPACK_NAME="Plecak podróżnika"`, `PERMANENT_BACKPACK_ICON_PATH="assets/items/permanent-backpack.png"`. `InventoryItem.permanentContainer?:boolean` identifies the server-owned invariant; older missing flags never synthesize an item client-side.

The server helper `ensurePermanentBackpack(client,characterId)` runs inside a caller transaction, locks the character and provisions at most one fixed instance. It runs at startup for existing characters, atomically during character creation, and defensively before authentication's inventory snapshot. Reads remain free of provisioning side effects. Legacy pre-account inventory remains compatible.

## Tasks

- [x] Generate transparent pixel-art backpack PNG and save prompt/provenance in `docs/assets/permanent-backpack.md`.
- [x] Add the shared constants and optional instance flag.
- [x] Server migration013, permanent item seed, idempotent provisioning, atomic character creation and fixed snapshot projection. Enforce ownership/slot/capacity and reject unassignment, replacement, storage, trade, equipping and consumption of the permanent instance. Preserve quality and all ordinary items.
- [x] Root authentication provisioning and Polish error messages.
- [x] Client direct-open slot0, generated icon using the client's asset base, permanent labels, no picker/clear/change actions, no bag/trade candidates. Preserve three ordinary slots and quality frames.
- [x] Focused persistence/UI tests; adapt directly affected existing container fixtures to slots1–3. Prove new/existing characters, repeated/concurrent provisioning, existing full bag preservation,16/17 capacity, metadata edits and forbidden actions.
- [x] Desktop/phone QA and signed Android0.1.18/code19. Release gate: required CI, exact deployment and public artifact checks.

## Review focus

- Migration and provisioning cannot delete an old first-slot bag or its contents.
- Concurrent authentication/provisioning cannot create duplicate packs.
- Changing authored item metadata cannot consume the permanent pack or change its16-place capacity.
- Missing/legacy packets cannot open a slot0 replacement picker or fabricate a client item.
- PNG must load from Render, GitHub Pages base and the locally bundled Android assets; failed-image fallback remains available.

## Ownership

Root: shared contracts, controller integration, plan and release checks. Server worker: database/provisioning/lifecycle/inventory/trade/equipment and server tests. Client worker: UI and related tests. Image worker: PNG and provenance. Android worker: versioning and external build/release helpers. Disposable test database runs are serialized; development data is preserved.

Verification: generated transparent PNG inspected and integrated; desktop and844x390 phone show16 slots and the generated icon. Existing development character preserved all15 owned instances and6 stored links; an ordinary former first bag can occupy slot3. A stored bandage survived reconnect. Focused server tests prove16/17 capacity and account creation rollback, with8/8 permanent cases after a deterministic startup/auth lock-order regression fix. Client55 targeted tests, client/shared builds and server TypeScript passed. The full local release suite passed268 client and51 shared tests, with428 server cases passing before two legacy starter-inventory assertions were updated. Both affected files then passed13/13 tests, and the final server build passed. Exact-commit CI remains the release gate.
