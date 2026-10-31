# Inventory Cell Order Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for disjoint server/shared and client-controller tasks. Root owns transport integration, runtime and acceptance.

**Goal:** Let players move or swap items between cells in one backpack and retain the exact arrangement after reconnecting.

**Architecture:** Persist a nullable zero-based container position on item instances; expose it in authoritative inventory snapshots. Extend the existing move protocol with an optional target position, preserving existing clients. Existing drag and inline contents controllers render positions and commit cell moves on release.

**Tech Stack:** TypeScript, PostgreSQL, Socket.IO, DOM UI, Vitest, Capacitor.

**Spec:** User's direct request for arranging items within the same backpack. Empty target moves the item; occupied target swaps; holes and arrangement persist. Standard36px slots and inline contents stay.

## Constraints

- Work in the current managed checkout; preserve all prior UI edits and shipped gameplay.
- Do not reset preview/dev databases. Backend tests use only `web_mmorpg_slot_order_tests` on local5433, serial file execution because existing cases reset public schema.
- Backup current preview and stop its old backend before applying additive migration014.
- Existing payload without targetPosition remains valid; empty-position layout for older snapshots has deterministic client fallback.
- Same-container no-position request stays a no-op. Repeating a positioned request after acknowledgement is a no-op if the source already occupies that position.
- No production deployment, pushes or account credential changes. Browser mutations only on disposable local test account under localhost origin.

## Review Focus

- Empty holes survive rewards, consumption, equipment and reload; auto storage uses first free position.
- Same-bag swap works at full capacity without duplicate positions or lost instances.
- Foreign/assigned/equipped/permanent sources and invalid target positions stay rejected atomically.
- Dragging across cells does not commit intermediate moves; release/Enter commits the chosen cell once.
- Existing stale-packet, busy, native Back, touch and bag-assignment behavior remains.

## Task1 — Server/shared persistence

Owner: server agent. Shared `InventoryItem.containerPosition?:number`; existing move payload `targetPosition?:number`. Add migration014 and unique occupied positions, backfill existing stored items, update inventory snapshots and move/swap transaction, audit all storage writes and automatic storage/equipment clearing. Add targeted database/socket regressions for bounds, ownership, swap, holes, idempotent replay and existing mutations.

- [x] Test new behavior red, implement additive persistence and current guards, run relevant DB cases serially on test database.

## Task2 — Client grid and drag

Owner: client agent. Existing InventoryDragController.onDrop and ContainerContentsPanel.onMoveItem gain optional third targetPosition. Render explicit positions with holes; support deterministic legacy fallback. Cell targets move/swap on release/Enter, retain bag-button transfers and equipment/assignment paths. Empty cells are keyboard targets; paging uses absolute positions.

- [x] Test new behavior red, implement around current controller, verify relevant contents/drag regressions.

## Task3 — Integration and acceptance

Owner: root. Wire optional argument in GameSocket/WorldScene and relevant tests. Review persistence/transport boundaries. Backup preview, apply migration and restart only its current server. Verify mouse move, occupied swap and reconnect persistence on own test account, preserve owca/yuna, build browser/APK and signature, record final receipt.

- [x] Finish transport and focused verification, migration/runtime switch, browser acceptance and artifacts.
