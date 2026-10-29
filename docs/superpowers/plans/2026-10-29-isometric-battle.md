# Isometric battle implementation plan

**Goal:** An isometric arena on the right, own character and usable items on the left, contextual attacks and reachable-cell highlights on desktop and Android.

**Architecture:** Preserve hex topology and existing deterministic combat rules. Share topology, AP costs, line of sight and damage mitigation between server and preview. Use affine projection consistently for rendered tile vertices and hit areas. Keep authoritative item use transactional on the server.

**Decisions:** Desktop hover previews an enemy and click attacks. Touch selects the enemy first, then a contextual attack button confirms. Adjacent enemy selects melee, farther selects ranged (maximum six cells and clear line of sight). Valid attacks currently hit 100%; do not invent random misses. Display armor-adjusted average damage. Item use costs 2 AP, affects own combatant, and preserves injuries. Current accounts/bag contents remain compatible.

## Tasks

- [x] Shared battle rules and preview/reachable helpers. Verify adjacency/range/LOS, armor, AP, injuries, blockers and own-turn gates; server imports the same rules.
- [x] Pure isometric layout and projected hit polygons. Verify arena corners remain right of left HUD and inside safe insets on desktop and phone landscape.
- [x] Replace BattleHud with own character stats, inventory consumables and end turn. Verify pending use, server acknowledgement, errors, effect eligibility and scene cleanup.
- [x] Authoritative consumable use. Lock character and inventory rows; stage battle state until DB commit. Reject foreign/nonconsumable/noeffect/otherturn and concurrent mutations. Emit authoritative inventory/battle state.
- [x] Integrate scene targeting, projected objects, range highlights and contextual attack card. Verify hover/touch selection, exact commands, state refresh, resize and teardown.
- [ ] Browser QA desktop and phone viewport, focused tests/build, one combined code review, signed Android 0.1.3 and deployment on existing feature branch. Verify release signatures, public APK digest and live assets.

## Review focus

The view must keep the own character selected on enemy turns; hidden/old attack previews cannot execute stale commands; selected targets and highlight cells must refresh after every state; item requests cannot race a turn ending or disconnect; AP and HP updates must be acknowledged before local inventory is changed.
