# Margonem-inspired Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the approved fantasy game interface for desktop, mobile browser and Android.

**Architecture:** Keep the existing shared Phaser/TypeScript client and authoritative game rules. Use a common theme with desktop chrome and responsive compact controls. World camera and battle geometry reserve actual screen space for their HUDs.

**Tech Stack:** TypeScript, DOM/CSS, Phaser, Vitest/jsdom, Vite, Capacitor Android.

**Spec:** `docs/superpowers/specs/2026-10-30-margonem-interface-design.md` (approved 2026-10-31).

## Global Constraints

- Preserve existing uncommitted changes, accounts, server rules and assets.
- Desktop starts at width 1100 px and height 600 px. Smaller windows use compact controls.
- Touch controls have minimum 44×44 px targets and respect safe-area.
- No fake equipment slots, skills, quests or other unsupported game functions.
- Share components between browser and Android; preserve native Back and text-entry behavior.
- Use existing tests and add only meaningful coverage for changed behavior. CSS is verified visually.

## Review Focus

- HUD/arena geometry at 1280×720, 844×390, 390×844 and safe-area insets (tasks 1/2).
- Compact panels close on Back/Escape and release input without lingering state (tasks 1/3/5).
- Late responses and inventory updates retain server authority and selection (tasks 1/2/3).
- Chat/social inputs retain focus/drafts and do not send movement commands (tasks 1/4/5).
- Scene transitions and resize remove listeners and restore canvas/camera geometry (tasks 1/2/5).

### Task 1: World chrome and map viewport

**Files:** `ui/WorldHud.ts`, new `ui/WorldHud.css`, new `ui/worldLayout.ts`, `scenes/WorldScene.ts`, `native/nativeLifecycle.ts`, `tests/worldHud.test.ts`, new `tests/worldLayout.test.ts`, relevant world/native tests. Paths relative to `apps/client`.

**Interfaces:** Existing HUD callbacks remain. Add optional `onChat`, `onSocial`, `onLayoutChange`, `onInventory` handlers; expose `WorldHud.closePanel(): boolean`, `WorldHud.mapViewport(width: number, height: number, insets?: SafeInsets): LayoutRect` or an equivalent exported pure world layout helper. Calls `ChatController.toggle(): void` and `SocialController.toggle(): void` from task 4. Existing panel constructors remain compatible.

- [x] Add behavior tests for desktop map reservation, compact geometry and live compact resources; run these tests red before implementing behavior.
- [x] Implement framed topbar, 280 px right rail, bottom menu, portrait/HP/AP/XP/gold and four bag slots. Keep selected equipped bag preview in the rail; its entries open the existing authoritative container window.
- [x] Wire inventory access, chat/social menu actions, compact panel closure and resize to a measured/pure camera viewport. Preserve existing NPC auto approach and scene lifecycle.
- [x] Update native Back to close the compact HUD/menu before minimizing. Prevent map input and keyboard movement under blocking open panels and while typing.
- [x] Run affected HUD/world/native tests; visually check camera anchors and scene return during task 5.

### Task 2: Battle interface and geometry

**Files:** `ui/BattleHud.ts`, `ui/BattleHud.css`, `ui/BattleAttackCard.ts`, `ui/BattleAttackCard.css`, `scenes/battleLayout.ts`, `scenes/BattleScene.ts`, related battle/layout tests. Exclusively owned by battle implementer.

**Interfaces:** Preserve public battle HUD operations and command callbacks; extend layout measurement if needed with header/action rectangles. Full canvas is available during battle; no world-camera offset persists. Theme tokens from task 4 are optional CSS variables with fallback values.

- [x] Write/run failing geometry tests for right sidebar, upper player/round strip and reserved bottom controls at target sizes; retain finite positive geometry and safe insets.
- [x] Implement compact upper resource frame, real turn-order strip, collapsible attributes/items on the right, bottom action dock and stable selected-target card. Preserve two-step touch attack, item/command locks and auto/takeover behavior.
- [x] Fit the arena around actual visible HUD regions and resize; preserve current enemy sprites and terrain projection.
- [x] Run `battleLayout.test.ts`, `BattleHud.test.ts`, `battleScene.test.ts`; report any changed expectation with its product rationale.

### Task 3: Item and character windows

**Files:** `ui/CharacterPanel.ts`, `ui/InventoryPanel.ts`, `ui/ContainerContentsPanel.ts`, `ui/ContainerPicker.ts`, new `ui/ItemPanels.css`, related character/inventory/container tests. Exclusively owned by item implementer.

**Interfaces:** Preserve existing constructors, `update`, `show`, `hide`, `toggle`, `destroy` and inventory move callbacks. An optional docking helper may be added, but root task 1 uses its own bag preview and opens existing contents window to manage items.

- [x] Add meaningful tests for selecting an item to view its safe description with fallback icons and retained selection after updates; run red before behavior changes.
- [x] Build compact icon-grid inventory with quantity badges, selected-item details on click/tap, framed character portrait and grouped statistics/injuries. Reuse existing skin data, without inventing equipment mechanics.
- [x] Restyle bag contents/picker as square slots and concise item details, retaining existing server-acknowledged add/remove, paging and container-change behavior. Preserve keyboard operation and close/focus handling.
- [x] Run inventory/character/container tests covering changed behavior, not CSS snapshots.

### Task 4: Shared theme, account screens and social windows

**Files:** new `ui/gameTheme.css`, `main.ts`, `ui/ChatController.ts`, `ui/ChatWidget.ts`, `ui/SocialController.ts`, `ui/SocialPanel.ts`; optionally account scenes if markup needs semantic improvements. Do not edit `style.css`, world/battle/item files. Exclusively owned by theme implementer.

**Interfaces:** Export public `toggle(): void` on both chat and social controllers, forwarding to a public widget/panel toggle. World chrome owns chat/social launcher buttons when `body.has-world-hud`; battle retains independent launchers.

- [x] Add controller/widget behavior coverage only if existing tests miss public toggling; run the new case red.
- [x] Define shared stone/wood/brass theme tokens, readable typography, focus, disabled/error/busy states. Style account/login/recovery/creator, modal windows, shop/dialogue/NPC/encounter, chat/social/trade and all ADMIN forms via `gameTheme.css`, imported last in `main.ts`.
- [x] Dock world chat at bottom left above the world menu and keep keyboard/safe-area handling. Keep battle chat/social launchers away from its action dock. Hide independent world launchers when chrome provides them; preserve unread notifications.
- [x] Keep compact UI at width <1100 px or height <600 px; prevent cross-window overflow. Preserve form semantics and keyboard/draft handling.
- [x] Run affected chat/social/account tests for any behavioral changes; leave full compile and cross-component rendering to task 5.

### Task 5: Integration, real previews and Android artifact

**Files:** integrate only needed fixes, update this plan/spec status and documentation; optional verification artifacts under `artifacts` or ignored scratch.

- [x] Review the task changes for spec compliance and source quality against baseline snapshots; resolve material integration defects.
- [x] Run the affected client suite. The entire client test suite is justified if scene/lifecycle/theme changes affect most client modules; do not run unrelated server/database tests for styling.
- [x] Run `npm run build -w @web-mmorpg/client` and `npm run android:sync -w @web-mmorpg/client` to verify browser and packaged client. If SDK/JDK available, build an APK without publishing.
- [x] Start a local preview and inspect actual login, world, items/shop, battle and chat at desktop, landscape phone and portrait sizes. Use local data or a disposable local account, with no external messages.
- [x] Fix observed defects, rerun only relevant checks, then have a fresh reviewer inspect the integrated change. Record limits if physical Android/emulator is unavailable.
- [x] Deliver implementation location, test/build results and available preview/APK. No deployment, push or publication is required by this design approval.

## Execution decisions

The user approved implementation; continue in this session without another method/plan approval. Independent owners may work concurrently in disjoint files. Use the current feature checkout because it contains active uncommitted gameplay work the UI must preserve; do not create a clean checkout that loses it. Save baseline copies for review and do not commit unrelated pre-existing edits.

