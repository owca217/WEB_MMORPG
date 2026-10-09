# WEB MMORPG — MVP 2 Design Specification

**Date:** 2026-09-17  
**Repository:** `owca217/WEB_MMORPG`  
**Branch:** `feature/mvp-vertical-slice`  
**Status:** Approved design, pending implementation plan

## 1. Purpose

MVP 1 proved the technical chain: browser client, GitHub Pages, Render-hosted Node.js server, Socket.IO multiplayer, shared world state, encounter entry, tactical battle state, loot, and return to the world.

MVP 2 changes the focus from infrastructure to presentation and playable feel. The goal is to turn the current technical prototype into a small but coherent vertical slice that already feels like the beginning of a real browser MMORPG.

The core loop for MVP 2 is:

`Forest settlement -> leave settlement -> explore nearby forest -> encounter wolves -> tactical hex battle -> receive loot -> inspect inventory -> return to settlement`

MVP 2 is not intended to implement the entire long-term game design. It must instead make one small section polished enough that later systems can be added around a stable gameplay foundation.

## 2. Approved Creative Direction

### 2.1 First playable location

The first full location is a **forest settlement and its immediate surroundings**.

The location should include:
- a compact safe settlement,
- a tavern or common building,
- a healer NPC,
- a guard or guide NPC,
- paths leading outside the settlement,
- fences, trees, rocks, grass, and other environmental props,
- a clearing / forest edge used for the first wolf encounters,
- a clear visual distinction between the safe settlement and the dangerous outskirts.

The world remains location-based rather than seamless. This first location is one map in the larger future world.

### 2.2 Visual style

The approved art direction is a **hybrid 2D style**:
- backgrounds and environment are more detailed and illustrative than strict retro pixel art,
- player characters, NPCs, enemies, and interactive objects remain highly readable and slightly stylized,
- silhouettes and gameplay information must remain clear at browser scale,
- the result should feel like a modern browser RPG rather than a copy of an existing title.

For MVP 2, coherent placeholders are acceptable where final assets do not yet exist, but placeholders must follow the intended visual language. Technical circles and debug-grid presentation should no longer dominate the experience.

## 3. World Presentation

### 3.1 Map structure

The existing single-location world becomes an authored forest-settlement map.

The initial map should stay close enough to the MVP 1 technical dimensions that the existing movement/networking architecture can be reused. If art dimensions change during implementation, server-authoritative coordinates remain the source of truth and the client camera adapts to the authored map bounds.

The map contains three readable sub-areas:

1. **Settlement center** — safe, dense, contains NPCs and buildings.
2. **Settlement edge** — gates/fences, transition from safe to unsafe area.
3. **Forest outskirts** — paths, vegetation, rocks, and the wolf encounter area.

### 3.2 Camera

The camera follows the local player smoothly and is clamped to map bounds.

The camera should:
- avoid excessive lag behind the player,
- keep the player near screen center where possible,
- work on desktop and mobile aspect ratios,
- preserve enough visible area around the player to make exploration readable.

### 3.3 Character representation

The local player and remote players use a coherent character placeholder or sprite rather than plain circles.

Minimum requirements:
- visible facing direction or directional movement feedback,
- nickname label,
- clear local-player distinction,
- remote players rendered from authoritative server snapshots,
- no client-side authority over final world position.

Full character customization is out of scope for MVP 2.

## 4. Movement and Interaction

### 4.1 Desktop controls

Desktop supports both:
- WASD / arrow-key movement,
- click-to-move.

Movement should feel smoother than MVP 1 and the visual representation should interpolate server corrections instead of snapping whenever practical.

### 4.2 Mobile controls

Mobile supports **both**:
- tap-to-move / touch targeting,
- a compact virtual joystick for continuous movement.

The two input methods feed the same movement-intent layer and remain subordinate to server-authoritative position correction.

### 4.3 Interaction model

Interactive objects and NPCs provide visible feedback when in range or selected.

MVP 2 introduces a generic interaction flow:
- approach an interactable,
- show an interaction affordance,
- activate it by click/tap or interaction button,
- receive dialogue, service, or encounter action.

Pointer/touch interaction is mandatory. A keyboard interaction shortcut may additionally be provided, but it is not required to use the feature.

## 5. NPCs and Settlement Functionality

MVP 2 includes two NPC roles.

### 5.1 Guard / guide

Purpose:
- introduces the player to the settlement and forest danger,
- points the player toward the wolf encounter area,
- proves the dialogue/interact system.

Dialogue is simple and linear in MVP 2.

### 5.2 Healer

Purpose:
- gives the settlement a functional reason to exist,
- provides the first integration point for injury treatment and consumables.

For MVP 2, the healer exposes a minimal service panel. A full economy is not required.

Long-term systems such as reputation, branching dialogue, faction logic, dynamic shops, and quest chains remain out of scope.

## 6. World HUD

The world HUD should make the game immediately readable.

Minimum HUD elements:
- player nickname,
- HP bar and numeric value,
- AP indicator or reserved AP panel consistent with combat terminology,
- compact quick-access buttons for inventory and character panel,
- compact message / notification area,
- connection or error feedback when the server is unreachable.

The HUD must:
- remain readable on mobile,
- not cover the center of the play area,
- use the same visual language as the battle HUD,
- avoid debug-style presentation.

## 7. Inventory and Character Panel

### 7.1 Inventory

MVP 2 exposes the inventory to the player instead of keeping loot only in server state.

The panel must show:
- item icon or placeholder,
- item name,
- quantity,
- basic category or purpose where useful.

The first known loot remains compatible with MVP 1, including wolf-related loot and bandages.

Drag-and-drop, item comparison, weight systems, rarity tiers, crafting, trading, and full equipment logic are not required yet.

### 7.2 Character panel

MVP 2 adds a compact character panel that establishes the future data model.

Minimum visible fields:
- nickname,
- general level placeholder/value,
- HP,
- initiative,
- injuries if present,
- reserved area for proficiencies/specializations.

The game remains classless. MVP 2 must not introduce fixed character classes.

## 8. Encounter Presentation

The current clickable technical encounter marker is replaced by a world-space enemy/encounter representation.

For the wolf encounter:
- a visible wolf or wolf-pack representation exists in the forest area,
- approaching or interacting with it starts the encounter,
- the player receives clear feedback before the battle scene opens,
- the transition from world to battle should feel intentional rather than abrupt debug navigation.

The server remains authoritative over whether the encounter is valid and whether the player is close enough to start it.

## 9. Tactical Hex Battle — MVP 2 Presentation Overhaul

The battle system remains turn-based with AP and initiative on a hex grid.

MVP 2 focuses on making the existing system understandable and enjoyable to operate.

### 9.1 Arena presentation

The battle arena visually resembles the biome the encounter came from.

For the first encounter:
- forest floor / clearing theme,
- trees, rocks, logs, bushes, or similar obstacles,
- walkable hexes visually integrated into the environment,
- blocked cells clearly distinct,
- cover cells clearly distinguishable from hard blockers.

The battle grid remains authoritative server data. Visuals adapt to the generated arena rather than deciding gameplay rules locally.

MVP 2 does **not** invent a new numerical cover bonus or damage modifier. Cover is presented and respected only to the extent supported by the authoritative battle rules in this milestone; future balancing of partial/full cover remains a separate design decision.

### 9.2 Combatant presentation

The player and wolf use readable sprites/placeholders.

The active combatant must have a strong visual indicator.

Each combatant should expose enough information to understand the fight:
- HP,
- active state,
- ownership/faction distinction,
- severe injury state where relevant.

### 9.3 Movement preview

When the player selects their active combatant, the client should show:
- reachable cells within current AP,
- blocked cells,
- a preview path where practical.

The client may preview valid-looking options, but the server always validates the final command.

### 9.4 Attack interaction

MVP 2 supports the existing core actions:
- move,
- melee attack,
- ranged attack,
- end turn.

The UI must make action mode explicit. A player should not need to guess whether the next click means movement or attack.

For attacks, the UI should communicate:
- AP cost,
- valid/invalid range,
- line-of-sight failure,
- whether a world obstacle blocks the shot according to server rules.

Damage continues to be resolved server-side.

### 9.5 Initiative and turn order

MVP 2 adds a visible turn-order presentation.

At minimum:
- current active combatant,
- upcoming combatants,
- round indicator.

The exact visual layout can be horizontal or vertical depending on screen size.

### 9.6 Enemy turn

The wolf receives a server-controlled turn. The battle must not stall after the player ends their turn.

Minimal wolf AI:
- if adjacent to the player, attack,
- otherwise move toward the player using legal pathing and available AP,
- end its turn when it can no longer perform a useful action.

The AI remains intentionally simple for MVP 2.

## 10. Injuries

The previously approved injury model remains part of the design:
- reaching 0 HP can mark a unit as **severely injured**,
- units may receive one or more specific injuries,
- injuries may affect combat statistics or action costs,
- healing HP alone is not equivalent to fully treating severe injuries.

MVP 2 must visually expose injuries in the character/battle UI.

The system applies conceptually to:
- the main player character,
- companions in future versions,
- humanoid enemies and other eligible units in future content.

For the first wolf encounter, only currently supported injury behavior needs to be wired through the end-to-end loop. A full medical treatment system is not required yet.

## 11. Loot and Return to World

After victory:
- the server determines rewards,
- loot is added to inventory,
- the client displays a clear reward summary,
- battle UI closes,
- the player returns to the shared world,
- inventory remains updated.

The player should be able to immediately open the inventory and see the gained items.

Defeat also resolves cleanly rather than leaving the player in a dead battle state. For MVP 2, defeat returns the player to the settlement spawn while preserving relevant injury state. Long-term death/respawn penalties remain outside this milestone.

## 12. Multiplayer Behavior

MVP 2 retains the multiplayer foundation from MVP 1.

Required behavior:
- multiple players can log in with different nicknames,
- players in the same location see one another,
- movement remains server-authoritative,
- one player's personal battle does not corrupt another player's world state,
- players returning from battle rejoin the shared settlement/forest world correctly.

Large-scale MMO concerns such as shards, guilds, party synchronization, raids, and persistence databases remain out of scope for MVP 2.

## 13. Client/Server Boundaries

### Client responsibilities

The browser client is responsible for:
- rendering world and battle scenes,
- collecting input,
- local visual interpolation/prediction,
- presenting UI,
- previewing possible movement/attack choices,
- sending intents/commands to the server,
- rendering authoritative snapshots.

### Server responsibilities

The server is authoritative for:
- player world positions,
- encounter eligibility,
- battle state,
- AP spending,
- turn order,
- movement/path validation,
- line of sight,
- damage,
- injuries,
- NPC enemy turns,
- loot,
- inventory state.

No client-provided value may directly set damage, loot, AP, HP, or final battle outcome.

## 14. Error Handling and Feedback

MVP 2 must improve player-facing error handling.

The client should show clear messages for:
- lost server connection,
- reconnect attempt/failure,
- rejected world movement,
- encounter too far away,
- invalid battle action,
- insufficient AP,
- blocked path,
- out-of-range target,
- blocked line of sight.

Technical exception text should not be shown directly to players when a friendly message can be provided.

## 15. Responsive Behavior

Both world and battle scenes must remain usable in:
- desktop browsers,
- mobile browsers in portrait or landscape where practical.

Minimum requirements:
- touch targets at least approximately 44 CSS pixels,
- HUD can reflow on narrow screens,
- battle action controls remain reachable without covering the active combat area,
- important text remains legible without browser zoom.

## 16. Asset Strategy

MVP 2 does not require final production art.

The implementation should use one of these sources in order of preference:
1. original simple assets created specifically for the project,
2. clearly licensed free assets appropriate for commercial use,
3. coherent geometric/illustrative placeholders.

No copyrighted game assets should be copied from Margonem or other commercial games.

All art paths and rendering systems should make later asset replacement straightforward.

## 17. Persistence Scope

The current in-memory session model remains acceptable for MVP 2 testing.

This means:
- restarting the Render server may reset online sessions and temporary progress,
- permanent account authentication and database-backed characters remain future work.

However, inventory, injuries, and character values must persist correctly for the lifetime of an active server session and survive the transition between world and battle scenes.

## 18. Deployment

MVP 2 continues to use:
- **GitHub Pages** for the browser client,
- **Render Web Service** for the Node.js/Socket.IO server.

The client remains configured to connect to the deployed Render server through `VITE_GAME_SERVER_URL`.

Development changes continue on `feature/mvp-vertical-slice` until the milestone is reviewed and intentionally merged.

## 19. Testing Strategy

Implementation follows test-driven development for rules and state transitions.

Automated tests should cover at minimum:
- NPC interaction range rules,
- encounter eligibility,
- enemy turn progression,
- battle return-to-player control,
- loot persistence into inventory,
- injury persistence after battle,
- invalid client command rejection,
- world-to-battle-to-world socket flow,
- basic responsive/UI helper logic where testable outside Phaser.

GitHub Actions remains the authoritative automated verification environment when local execution is unavailable.

Manual acceptance testing must include:
- desktop browser,
- at least one mobile browser,
- two simultaneous clients for multiplayer visibility,
- a complete forest-settlement -> wolf fight -> loot -> return loop.

## 20. Explicitly Out of Scope for MVP 2

The following remain future milestones:
- permanent accounts / OAuth,
- database persistence,
- full classless proficiency progression,
- large skill trees,
- companions as full secondary characters,
- summoning builds,
- crafting,
- player trading,
- auction house,
- guilds,
- parties and group tactical battles,
- PvP,
- full quest system,
- faction/reputation systems,
- large world map and many locations,
- production-quality final art/audio,
- monetization.

These systems must not be allowed to expand MVP 2 scope.

## 21. MVP 2 Acceptance Criteria

MVP 2 is complete when all of the following are true:

1. The player enters a visually coherent forest settlement rather than a debug grid.
2. The camera follows the local player smoothly.
3. WASD, click-to-move, touch targeting, and a virtual joystick work with server-authoritative correction.
4. The guard/guide and healer are visible and interactable.
5. The HUD shows player HP and core status information.
6. Inventory can be opened and displays current items.
7. A visible wolf encounter exists in the forest outskirts.
8. The server validates encounter range before starting combat.
9. Entering the encounter transitions into a forest-themed hex battle.
10. Reachable movement cells are visually previewed.
11. Melee, ranged, movement, and end-turn actions are clear and usable.
12. AP and initiative/turn order are visible.
13. Obstacles and cover are visually distinguishable.
14. Line-of-sight and invalid-action errors are communicated clearly.
15. The wolf automatically performs a legal server-side turn.
16. The fight can progress without manual enemy commands.
17. Victory grants visible loot and updates inventory.
18. Defeat returns the player to the settlement spawn without leaving the session stuck.
19. Injury state is visible and survives battle resolution within the session.
20. The player returns to the shared world after battle.
21. Two simultaneous clients still see each other in the world.
22. Desktop and mobile layouts are usable.
23. Automated tests and TypeScript build pass in CI.
24. The deployed GitHub Pages client works against the deployed Render server.

## 22. Success Definition

MVP 2 succeeds if a new tester can open the public link and, without being told that it is only a technical prototype, understand that they are playing the beginning of a browser MMORPG: they can move through a recognizable settlement, interact with the world, enter a tactical fight, understand whose turn it is and what actions cost, receive loot, and return to exploration.
