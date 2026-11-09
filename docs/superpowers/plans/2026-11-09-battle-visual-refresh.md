# Battle Visual Refresh Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans, with explicit parallel file ownership. The user's requested visual result and existing world art define the design; no gameplay redesign.

**Goal:** Make battles use the same characters/enemies/environment as the world, replace missing obstacle art, and improve readable desktop/mobile presentation.
**Architecture:** Add optional sanitized skinId to authoritative battle participants; reuse character/enemy atlases and world terrain. Render projected textured ground and generated transparent rock/log props, preserving existing interaction and mechanics.
**Tech Stack:** TypeScript, Phaser, DOM/CSS, existing PNG atlases, built-in image_gen.
**Spec:** User requests a better battle window, identical in-game character textures, and generated art where textures are missing.

## Constraints and ownership

- Base2d242417 is the restore point, branch codex/battle-visual-refresh in the existing linked worktree. No player-data/schema migration or changes to battle rules/stats/rewards.
- Metadata agent owns shared battle type/engine propagation and server battle admission tests. CombatantSnapshot.skinId?:CharacterSkinId is authoritative and contains no arbitrary appearance payload.
- Renderer agent owns BattleScene and new rendering helpers/tests. Reuse all six character skins and five enemies. Legacy wolf encounters reuse forest-wolf. Labels and target feedback stay legible over sprites.
- HUD agent owns BattleHud/AttackCard CSS+TS and any necessary battleLayout footprint adjustment/tests; reuse exact own-character atlas in portrait.
- Root owns generated assets, prompt/source records, integration, QA and release.
- Assets: assets/battle/mossy-rocks.png for impassable terrain; assets/battle/fallen-log.png for low cover. Transparent, restrained woodland pixel art matching world vegetation; no baked hex bases or interface.
- Props/units sort by ground Y, not label order. Preserve projected cell hit polygons, movement range overlays, attacks/heals/skills/items/Auto, party identities and safe-area/mobile details/zoom.

## Steps

- [x] Generate and inspect two transparent missing prop textures; save final PNGs and prompts under project assets/docs/art. Give actual alpha bounds to renderer.
- [x] Add focused admission/snapshot regression for both party skins, invalid/missing appearance fallback and stable identity through turn changes; implement optional skinId plumbing.
- [x] Implement ground texture baking, matching actor/enemy sprites, prop visuals, ground-Y sorting, selection/shadows/HP labels with focused renderer regressions.
- [x] Add matching HUD portrait and coherent spacing, retaining mobile controls; focused HUD/layout tests. Landscape refinement complete after actual QA.
- [x] Run affected client/shared/server tests and TypeScript/build. No full local suite for visual-only code; mandatory release CI remains enabled.
- [x] Actual browser QA on isolated database: manual battle, correct skin, monster art/legacywolf, obstacles/cover, click/movement/attack feedback and phone portrait/landscape.
- [x] Android0.1.31/code32 signed with existing key; verify new assets and original atlases in package.
- Release gate after commit: push established production target; wait RenderLIVE and CI, compare public assets and verify released APK checksum. Record live outcome in final handoff.

## Review focus

- Missing/late local player state must not replace a selected party member's skin with the own player's appearance.
- Tall sprites/props must not hide targets, labels, highlight borders or tap zones; dead sprites remain distinguishable.
- Re-render/resize must not leak canvases, masks, textures or event handlers on mobile.
- Generated props must have real alpha and adequate crop/scale; existing assets stay unchanged.
- Record any browser/device limitations and preserve previous artifacts.

## Execution ledger

- Generated two final transparent PNGs with built-in image_gen. Both1254×1254, alpha range0–255; frame bounds measured read-only and saved beside exact prompts. Existing raster files unchanged.
- Metadata: server/shared type builds pass;21 focused admission/party cases pass after12 expected RED assertions. All six skin IDs and independent party owners covered.
- Renderer: cached single projected ground texture, same world atlases, actor/prop depth and old-owner fallback.28 focused scene +3 environment tests pass; client TypeScript/Vite build passes.
- Read-only review found transparent sprite margins capturing adjacent hex input. Fixed with pixel-perfect live sprite input (alpha tolerance16) and no dead sprite/body input. Real WebGL movement subsequently verified on adjacent rear tile: AP5→4→3, no capture by visible sprite margins.
- BrowserQA uses only local isolated weapon_skills_qa_20261101; appearance backup saved before temporarily selecting female-scout. Correct world sprite, battle sprite and HUD portrait observed. Legacy wolf textured; renderer corrected fallback asset not to invent forest-wolf difficulty/name.
- Desktop1280×720 and portrait390×844 presentation passed initial visual checks; all skill controls>=44px and no horizontal overflow. Landscape844×390 exposed tiny board due to stacked header/dock, so HUD/layout agent is moving those into a280px left column only for low landscape screens.
- Existing Auto completed the manual test battle and returned to world with victory/loot/XP, preserving control flow. Browser work continues after landscape rebuild; no final device/live acceptance yet.
- Landscape refinement verified at844×390: header280×134 at12,12, action column280×220 at12,158, readable full-height board to right. Details overlay300×306 at532,72; expanded action contents487px scroll within218px with no horizontal overflow. Portrait390×844 and desktop1280×720 remain valid.
- Real manual input confirmed adjacent movement and a melee hit: preview100%/15damage, enemy120→105HP, AP5→3. New desktop/portrait/landscape screenshots saved in authorized visualization directory.
- Generated additional transparent bandage, healing potion and vigor tonic icons after finding visible placeholder symbols. Shared client exact-ID fallback is used in both battle and inventory/drag/details, preserving catalog icon URLs and image-error behavior.47 focused helper/icon/HUD/drag checks pass. Exact prompts and all five asset paths are in docs/art/battle-visual-prompts.json.
- Signed Android0.1.31/code32 built with original certificate. All five new PNGs and six existing character atlases are present in APK with repo-identical hashes. APK SHA2560476024a70e1e5445ddd2872d34b51bbe3baddcb0ccd5f720a51897721cfdb9e. No physical device test.
- Browser acceptance complete: two test fights, manual adjacent movement and attack, Auto victory/return to world. After final build reload the bundled field-bandage PNG loaded in inventory with natural dimensions1254×1254. Catalog icon precedence and same BattleHud fallback covered by targeted47 tests. Phone details and expanded technique scroll verified; no horizontal overflow in either orientation.
- Viewport override reset. Temporary background QA tab is left for automatic close at end of turn; local QA server/private PostgreSQL stopped, original QA appearance restored from backup. No player database or live account used for testing.
