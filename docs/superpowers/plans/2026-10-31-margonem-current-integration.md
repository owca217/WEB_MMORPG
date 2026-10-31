# Margonem UI on current game — integration plan

> **For agentic workers:** Use superpowers:subagent-driven-development for disjoint implementation tasks and a focused final integration review.

**Goal:** Replace the local UI preview with the approved Margonem-inspired interface on the actual current game, retaining all shipped features.

**Base:** `7f2b12bd67d650fae474344c98af696485d3452f`, verified against GitHub `feature/mvp-vertical-slice` on2026-10-31. Current Android baseline0.1.24.

**Architecture:** Keep the complete current server/shared code and current gameplay handlers. Adapt presentation around them; do not replace latest gameplay files with earlier UI copies. The existing browser URL5174 and preview database/account/session are retained when switching processes.

**Approved direction:** Original Margonem-inspired visual/layout design; user explicitly requested replacing the incomplete preview with the current game. Earlier assumptions that equipment/second location do not exist are superseded by this plan.

## Constraints

- Current implementation root: `C:/Users/kgkg1/.codex/worktrees/margonem-current/WEB_MMORPG`.
- Old UI/reference root: `C:/Users/kgkg1/Documents/ChatGPT/WEB_MMORPG`. Read-only reference; preserve it and all unpublished dirty gameplay/art work.
- No production deployment, pushes or release publication in this task.
- Preserve eastern forest/portals/respawns, collision/pathfinding, equipment/training, staff/shield healing, shared party battles, permanent16-slot backpack, automatic storage/pending view, item qualities, drag/drop/equipment/container targets, admin grants and latest category editor.
- Shared theme and responsive chrome: desktop≥1100×600, compact otherwise; native Back and44px action targets; retain intentional compact item slots/long-press drag behavior.
- Do not modify server/shared gameplay sources, migrations, latest socket protocols or world fixtures to fit old UI.
- Preserve `owca`/`yuna` and ADMIN on the existing local preview database. Apply current additive migrations only after stopping the old backend.
- Tests: use existing relevant cases; add behavior regressions for new integration contracts. CSS-only changes are checked visually/builds, without implementation-mirroring tests.

## Task 1 — Current world chrome

**Owner/files:** world implementer: WorldHud.ts, new WorldHud.css/worldLayout.ts, WorldScene.ts and directly relevant HUD/world/location/NPC tests.

**Reference:** Old UI files in reference root show approved chrome/geometry and native Back event. Start from current files in this checkout for latest behavior.

**Interfaces:** Preserve latest WorldHud callbacks including onHealing and setLocation(name). Add optional onChat/onSocial/onLayoutChange, status update methods, closePanel/isPanelOpen. Root provides ChatController.toggle/status and SocialController.toggle/status, ui/gameWindows.ts and native Back fallback. `onInventory` should open permanent backpack/pending contents via current API; do not expose only the obsolete flat inventory list.

- [x] Add current-compatible tests for viewport reservation/compact closure and all four bag slots with permanent index0, pending counts, dynamic location names and healing eligibility.
- [x] Build topbar/right rail/footer with portrait/HP/AP/XP/gold, permanent backpack icon and immutable slot0, other bag drop targets, item quality frames, pending badge/view and optional staff healing entry. Bag preview is read-only and opens the current container window for actual actions.
- [x] Adapt current WorldScene to viewport/layout/menu/input handling, keeping all routing, location-aware move intents, teleport selection, location switching/renderers/bounds, server respawn clock and equipment request/revision guards.
- [x] Keep current container/character/healing/AdminPanel constructors, mutation callbacks, item-grant refresh and drag/drop integration. Do not replace those calls with older versions.
- [x] Verify focused current HUD/world/NPC/location tests and report any adjusted UI expectation.

## Task 2 — Current battle interface

**Owner/files:** battle implementer: BattleHud.ts/css, BattleAttackCard.ts/css, battleLayout.ts, BattleScene.ts and related battle/layout/healing/party UI tests.

**Interfaces:** Retain current HUD update(own,ownedTurn,inventory,character,healingPreview,team), healing callbacks/isTyping/team membership. Add current-compatible measured regions, round/order and compact zoom contract from old UI reference without losing staff/shield/ally behavior.

- [x] Port approved top resources/turn order, right details and bottom target/action dock from old UI around all current healing/team/quality state.
- [x] Preserve healSelf/healAlly target selection, ally cells, pending command/item/autoplay locks and team feedback. Place healing selector/action in usable compact details/dock without hiding active action.
- [x] Retain fit/1.8×compact zoom with shared graphics/hit geometry and fit reset. Full canvas during battle; no world viewport survives shutdown.
- [x] Add relevant integration tests and run existing current battle, layout and healing/party/training UI cases. Do not weaken current assertions to match obsolete behavior.

## Task 3 — Current item/character windows

**Owner/files:** item implementer: CharacterPanel.ts, ContainerContentsPanel.ts/css, ContainerPicker.ts, optional InventoryPanel.ts, new ItemPanels.css and directly related item/equipment/drag/training tests. Do not edit InventoryDragController, PermanentBackpack, quality/helper semantics unless a demonstrated presentation integration defect requires it; coordinate scope expansion first.

- [x] Retain latest stats/proficiency/equipment tabs, equip/unequip request-version/revision/pending guards, slot drop targets and weapon training details. Add portrait/framing/typography with existing assets.
- [x] Restyle current contents/pending/menu/details while preserving automatic storage, current compact icon slots, long-press/mouse drag, bag assignment targets, equipment drops, details action and refresh callbacks. Do not resurrect obsolete one-click put/remove controls.
- [x] Preserve permanent-slot protection,16-place capacity and pending access, item-quality frames and actual equipped-item identity.
- [x] Verify current container/picker/drag/training/character tests plus meaningful new window focus/layout integration cases.

## Task 4 — Shared shell, latest features and acceptance

**Owner/files:** root: main.ts, nativeLifecycle.ts, gameWindows.ts, gameTheme.css, ChatWidget/Controller, SocialPanel/Controller, shared appearance selectors, integration docs. No current server/shared code changes.

- [x] Port common theme/chat callbacks and only presentation/status/focus changes into latest SocialPanel, preserving quality/equipped-trade rules. Keep latest ADMIN grants/category forms and healing panel functional/styled.
- [x] Use native Back foreground-context helper and event fallback. Preserve metadata, current admin API and socket auth.
- [x] Baseline/install current dependencies; focused component verification during tasks, then client suite/build and current Android APK. Use bounded workers on Windows.
- [x] Switch localhost5174/backend3002 to this checkout against the existing preview DB after old processes stop. Confirm additive migrations and retained owca/yuna ADMIN.
- [x] Exercise both portal directions, permanent backpack/pending/equipment/training, battle/healing and mobile layouts in the browser using only disposable local data. Check admin grants/category forms and party contracts through current tests and preservation review; manual admin/multiplayer flow remains an explicit verification limit.
- [x] Assess server/shared test need: no source or contract changes, so no resettable backend tests were needed or run. Never point resetting tests at account/preview databases.
- [x] Have a fresh reviewer check latest-feature preservation and cross-component behavior, fix material issues, then deliver corrected preview and current APK with explicit verification limits.

## Recovery and execution decisions

Original preview was based on an older branch; original baseline/test receipt does not certify current-feature compatibility. This new task has its own ignored ledger `.superpowers/sdd/margonem-current/progress.md`. Source/runtime/theme updates remain isolated from earlier dirty work and from the separate current-feature checkout owned by other work.
