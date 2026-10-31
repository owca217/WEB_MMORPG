# Desktop interaction and social windows implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Preserve the current managed checkout and all previous UI and inventory changes.

**Goal:** Desktop right-click interactions, player actions, and independent draggable party/trade windows.

**Architecture:** Keep the existing social protocol and authority. Persist a browser mouse preference, filter Phaser entity selection and movement separately, and reuse social rendering/actions in independently positioned windows. Touch keeps tap interactions. Default mouse preference is enabled. Main Menu provides Party/Trade shortcuts on every device.

**Tech Stack:** TypeScript, Phaser, DOM/CSS, Vitest/jsdom.

**Spec:** User request of 2026-10-31: desktop RMB interactions; LMB movement even on NPCs/monsters; remove Party/Trade social tabs; player context actions; draggable compact Party/Trade windows; Options toggle.

## Constraints and review focus

- No server protocol changes, production deployment, account resets, or loss of manual bag positions.
- Right click must never move the character. Left click must pass through entity hit areas when enabled; touch remains functional.
- Other-player actions target the selected ID, never the local player or stale departed player.
- Floating windows do not block map movement merely by remaining open; typing still blocks keyboard controls.
- Party/trade snapshots, pending guards, offer revisions, and focused drafts survive rendering. Windows remain reachable after resize.
- Native Back/Escape close the foreground window and clean up listeners on scene transitions.

## Tasks

- [x] Add persisted pointer preference and entity selection routing, with focused red/green tests. Owner: current_world_ui.
- [x] Split party/trade into compact draggable windows, retain authoritative social operations and test affected flows. Owner: current_items_ui.
- [x] Implement Options and player context menus with focused tests. Owner: current_integration_review.
- [x] Integrate WorldScene/WorldHud menus, movement filtering, canvas native-menu suppression and floating-window closing. Root owns integration and regression coverage.
- [x] Run relevant tests and client build, inspect desktop and compact preview, save evidence and verification notes. No APK required for this desktop-specific request.

Verification receipt: `docs/desktop-interactions-verification.md`. 81 focused tests and final client build passed; browser evidence saved. No production publishing.
