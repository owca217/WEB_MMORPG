# Base Character Skins Implementation Plan

> **For agentic workers:** Use the shared contracts, rendering and creator UI task boundaries below; keep changes to their assigned files.

**Goal:** Generate six base skins and make the selected skin usable in character creation and the world.

**Architecture:** A shared skin catalog validates the existing JSON appearance data. The client uses six transparent sprite atlases for both DOM previews and Phaser world sprites.

**Tech Stack:** TypeScript, Phaser, DOM/CSS, PostgreSQL, Vitest, built-in image_gen.

**Spec:** `docs/superpowers/specs/2026-10-28-base-character-skins-design.md`.

## Constraints

- Three male and three female skins; keep the supplied reference unchanged.
- Optional appearance fields preserve old snapshots and stored characters.
- No new database migration or outfit-dependent gameplay statistics.
- Keep character creation visible above the full-height game canvas.
- Do not stage user attachments or local database credentials.

## Tasks

1. Generate one transparent 4×4 atlas per skin. Save all six under `apps/client/public/assets/characters/skins/` and retain prompts in `docs/art/base-character-skin-prompts.json`. Inspect dimensions, alpha and cell alignment.
2. Add `packages/shared/src/characterSkins.ts`; validate new selections in `CharacterLifecycleService`; propagate appearance through character/world snapshots. Prove persistence and peer visibility with existing lifecycle/socket tests on the disposable test database.
3. Add client atlas/animation utilities and world sprites, preserving labels, movement and asset-failure fallback. Verify directional motion rules and visually inspect the generated assets in the running game.
4. Update `CharacterCreatorPanel` and scoped styles with gender/skin radios, an animated preview and direction controls. First write failing tests for selection, gender changes and failed submission retention; implement and run the relevant creator tests.
5. Run the integrated test/build checks, then browser-verify a new account, skin selection, creation, movement, refresh and persistence. Review the combined change before publishing the tested commit to the existing deployment branch, then verify CI, Render and served assets.

## Review focus

Legacy appearance defaults; invalid or mismatched selections; nickname/skin retention after errors; transparent atlas boundaries; first-load/re-entry visibility; mobile scrolling and keyboard focus; URLs under Render root and the Pages base path.
