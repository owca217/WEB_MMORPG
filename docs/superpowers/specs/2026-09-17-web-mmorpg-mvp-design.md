# WEB_MMORPG MVP Design

**Date:** 2026-09-17

## 1. Goal

Build the first playable vertical slice of a browser MMORPG that works on desktop and mobile. The presentation is a classic 2D location-based RPG, while combat is a separate turn-based tactical layer on a hex grid.

The MVP must prove the complete loop:

`login -> create/select character -> shared map -> multiplayer movement -> enemy encounter -> tactical hex battle -> injuries/loot -> inventory/equipment -> return to shared map`

The project uses original assets, names, worldbuilding, mechanics and code rather than copying content from an existing game.

## 2. Product decisions

- The game is multiplayer/MMORPG from the beginning.
- The world is split into separate locations connected by exits/portals.
- Movement supports click/tap-to-move, WASD and mobile touch controls.
- Character progression has a general level, but weapon/skill proficiencies matter more than level.
- There are no fixed classes. Builds emerge from equipment, abilities and proficiency use.
- Combat is turn based.
- Combat uses Action Points (AP) plus initiative/speed.
- Combat takes place on a hex grid whose size depends on encounter type.
- Normal encounters use partly procedural arenas; bosses and special encounters can use authored layouts later.
- Obstacles can block movement and ranged line of sight and can provide cover.
- Players can eventually use companions and build-dependent summons/pets.
- Companions are recruitable in the world, have their own AP, equipment, skills and progression.
- The number of active companions can eventually depend on a leadership-style progression system.
- A persistent character reduced to 0 HP is not permanently deleted. It can receive a general severe-injury state plus specific injuries.
- Specific injuries can affect movement, initiative, AP, maximum HP, accuracy or other combat properties.
- The injury model can apply to players, companions and suitable humanoid enemies.

## 3. MVP scope

### Included

1. Connect/login.
2. Create/select a character.
3. Enter one multiplayer location.
4. See and move alongside other connected players.
5. Interact with one enemy encounter.
6. Create a separate tactical battle instance.
7. Play a hex-grid battle using AP, initiative, movement, obstacles, cover and basic attacks.
8. Resolve victory/defeat and injuries.
9. Award simple loot.
10. View inventory and equip at least a weapon and body item.
11. Return to the world location with authoritative state preserved.
12. Support desktop and mobile browser input for the complete loop.

### Explicitly deferred

- full companion recruitment UI/gameplay,
- multiple active companions,
- summon skill trees,
- multiple world maps,
- boss-specific handcrafted arenas,
- crafting,
- player trading/economy,
- guilds,
- auction house,
- advanced quest system,
- PvP matchmaking,
- reputation/factions,
- monetization,
- final production art.

The architecture must leave clean extension points for these systems without implementing them in MVP 1.

## 4. Architecture

Use a TypeScript monorepo with strict boundaries between browser presentation, authoritative server gameplay and shared protocol/domain primitives.

```text
WEB_MMORPG/
├── apps/
│   ├── client/          # Phaser browser game
│   └── server/          # authoritative Node multiplayer server
├── packages/
│   └── shared/          # network contracts and pure shared types
├── docs/
│   └── superpowers/
│       ├── specs/
│       └── plans/
├── package.json
└── README.md
```

### Client

A TypeScript browser application using Phaser 4.2.1 and Vite 8.2.2.

Responsibilities:

- render world and battle scenes,
- collect keyboard/mouse/touch input,
- interpolate remote-player movement visually,
- show authoritative state,
- provide login/character/inventory/equipment/combat UI,
- never decide final movement validity, damage, AP, loot or battle results.

The GitHub Pages production build must be safe under a project base path such as `/WEB_MMORPG/`.

### Server

A Node.js TypeScript service using Socket.IO 4.8.3.

The server is authoritative for:

- sessions and connected players,
- character state,
- map occupancy and movement validation,
- encounter creation,
- battle state,
- initiative and turn order,
- AP spending,
- path/range/line-of-sight validation,
- damage and injury outcomes,
- inventory and equipment validation,
- loot/result resolution,
- persistence.

### Shared package

A framework-independent TypeScript package contains only browser-safe shared definitions such as:

- IDs and data contracts,
- Socket.IO event payload types,
- world coordinate types,
- hex coordinate primitives,
- battle commands/events,
- serializable entity, item and injury types.

Authoritative state mutation remains server-owned even if the client has equivalent helpers for display or prediction.

## 5. World model

The first map is a bounded 2D location with a stable map ID. Future locations use the same model and explicit exits/portals.

### Input modes

The same movement system accepts:

- directional intent for WASD/on-screen joystick,
- destination intent for mouse click/mobile tap.

Input method does not change authoritative world rules.

### Movement flow

1. Client sends movement intent.
2. Server validates map bounds/collision/current player state.
3. Server updates authoritative character position.
4. Server broadcasts updates to clients on the same map.
5. Clients interpolate visual positions.

For MVP, all players on the one map may share one Socket.IO room. The room boundary must remain explicit so later locations can scale independently.

## 6. Encounter flow

1. Player approaches/interacts with the enemy.
2. Server validates encounter eligibility.
3. Server locks/removes normal overworld movement for participating entities.
4. Server creates the battle instance and deterministic arena.
5. Client switches from World scene to Battle scene.
6. Client submits battle commands; server validates and resolves them.
7. Server resolves outcome, injuries and loot.
8. Server persists resulting character state.
9. Client returns to the World scene at the authoritative world position.

A disconnect must not allow the client to choose its own outcome. A future timeout/forfeit policy may be added server-side.

## 7. Battle model

A battle is an isolated server-owned state machine.

Conceptual lifecycle:

`creating -> deploying -> active -> resolving -> finished`

Each battle owns:

- battle ID,
- arena definition and seed,
- combatants,
- team ownership,
- hex occupancy,
- obstacles,
- initiative/turn queue,
- current AP,
- statuses/injuries,
- combat log/events,
- result and rewards.

The battle model must not assume that a connected player can only control one combatant. That allows later companions and summons without redesigning turn ownership.

## 8. Hex arena

Use axial hex coordinates `(q, r)` internally.

Shared pure helpers include:

- neighbor lookup,
- hex distance,
- coordinate serialization,
- coordinate validity against an arena definition.

Server-owned battle helpers include:

- reachable-cell calculation,
- occupancy and obstacle validation,
- line-of-sight checks,
- cover evaluation.

Arena size is data-driven rather than globally fixed. Ordinary encounters receive a deterministic seed and encounter profile. Future bosses/events may supply authored arena layouts.

Procedural generation must guarantee valid deployment zones and at least one navigable path between opposing deployment regions unless an encounter explicitly allows otherwise.

## 9. AP and initiative

At activation start, a combatant receives AP according to its stats and statuses.

MVP actions:

- move,
- basic melee attack,
- basic ranged attack,
- end turn.

Each action has a server-defined AP cost. The server rejects actions that are illegal, unaffordable, out of range or out of turn.

Initiative/speed determines activation order. The data model must not permanently enforce exactly one activation per unit per round, leaving room for later high-speed/initiative mechanics.

## 10. Obstacles, line of sight and cover

Each obstacle definition can independently specify whether it:

- blocks movement,
- blocks line of sight,
- provides cover.

MVP cover states:

- none,
- partial,
- full/blocking.

Full obstruction prevents a ranged attack. Partial cover applies a server-owned defensive/accuracy modifier. Exact balance values remain configuration rather than protocol constants.

## 11. Companions and summons extension point

The future model distinguishes:

1. player character — full progression,
2. companion — independent AP/initiative, equipment and deep progression,
3. pet/summon — behavior/resource model defined by the build or skill that created it.

Companions are intended to be recruited in world locations such as settlements, taverns, factions or specialist locations.

MVP 1 does not implement recruitment or companion progression, but battle ownership/control types must support multiple player-controlled combatants later.

## 12. Health and injury model

Dropping to 0 HP places a combatant into a downed state.

Persistent player characters and companions are not permanently deleted by ordinary combat. After resolution they may receive:

- a general `severelyInjured` state,
- one or more specific injuries.

Healing ordinary HP does not clear injuries. Injuries have separate treatment requirements.

Representative future injuries include:

- broken arm — accuracy/weapon penalty,
- leg injury — movement penalty,
- bleeding — ongoing HP loss,
- concussion — initiative/AP penalty,
- chest trauma — maximum HP penalty,
- burn/poison — specialist treatment.

MVP implements only a small representative subset, but the status model must already support multiple independent injuries.

## 13. Inventory, equipment and loot

Inventory is server authoritative.

An item definition contains at minimum:

- item definition ID,
- display name,
- category,
- stackability,
- equipment slot when applicable,
- stat modifiers when applicable.

MVP equipment slots:

- weapon,
- body.

The slot model must be data-driven so more slots can be added later.

Loot is generated by the server after a valid battle outcome and applied to the authoritative character state. The client may display loot animation/UI but does not decide item creation.

## 14. Persistence

Persistence is hidden behind repository/service interfaces so game rules do not depend directly on a specific database vendor.

Minimum persistent data:

- account/session identity,
- character identity and basic progression,
- current world location/position,
- health and injury state,
- inventory,
- equipment.

Local development may use lightweight relational persistence. The implementation plan should prefer a path that can migrate cleanly to hosted PostgreSQL for public deployment.

## 15. Typed network contract

Events are grouped by feature:

```text
auth/*
character/*
world/*
battle/*
inventory/*
```

Client-to-server payloads express commands/intents, never trusted final outcomes.

Representative commands:

```text
world/move-direction
world/move-target
battle/move
battle/basic-attack
battle/end-turn
inventory/equip
```

Every mutable command validates relevant conditions such as:

- authenticated session,
- actor ownership,
- correct game state,
- referenced entity existence,
- range/path/position,
- AP/cost,
- active turn,
- stale/duplicate action where relevant.

Structured rejection codes include examples such as:

- `NOT_AUTHENTICATED`,
- `INVALID_STATE`,
- `INVALID_TARGET`,
- `OUT_OF_RANGE`,
- `INSUFFICIENT_AP`,
- `NOT_YOUR_TURN`,
- `HEX_BLOCKED`,
- `LINE_OF_SIGHT_BLOCKED`,
- `ITEM_NOT_OWNED`.

## 16. Client scenes and UI

Minimum scene flow:

`Boot -> Login -> Character Select/Create -> World -> Battle -> World`

### World UI

- local player,
- connected remote players,
- one enemy/NPC encounter,
- health/status display,
- inventory/equipment access,
- desktop and touch movement controls.

### Battle UI

- hex grid,
- combatants,
- obstacles,
- reachable-cell highlighting,
- AP display,
- initiative/turn display,
- action buttons,
- basic combat log,
- clear invalid-target/cover feedback.

Desktop and mobile use the same server rules; only input and layout adapt.

## 17. Mobile requirements

The complete MVP loop must work in a modern mobile browser without requiring hover.

Requirements:

- finger-sized touch targets,
- touch equivalents for required mouse actions,
- responsive HUD,
- landscape-friendly combat layout,
- tap-to-move and/or an on-screen directional control,
- prevention of accidental page scrolling during active game gestures where browser APIs permit it.

## 18. Security / anti-cheat boundary

The browser client is untrusted.

Never trust the client for:

- final position,
- HP,
- damage,
- AP,
- turn order,
- inventory contents,
- item creation,
- loot rolls,
- injury outcome,
- battle victory.

Rate limiting can begin lightweight, but authoritative validation boundaries must exist from the first implementation.

## 19. Testing strategy

Use Vitest 5.0.1 for pure/shared/server tests.

### Shared/domain tests

- hex neighbors,
- hex distance,
- coordinate serialization.

### Server unit tests

- world movement validation,
- deterministic arena generation,
- reachable cells and blocked hexes,
- AP spending/rejection,
- initiative ordering,
- turn ownership,
- melee/ranged range rules,
- line-of-sight obstruction,
- cover evaluation,
- 0 HP/downed transition,
- injury assignment,
- loot application,
- equipment validation.

### Integration tests

- two clients join the same map and receive presence updates,
- authoritative movement is broadcast,
- encounter creates a battle,
- invalid/out-of-turn battle commands are rejected,
- battle completion applies rewards/injuries and returns the character to world state.

### MVP acceptance smoke test

Using two browser sessions:

1. create/select characters,
2. join the same map,
3. see each other's movement,
4. engage the enemy,
5. enter a hex battle,
6. move using AP,
7. verify obstacle/LOS/cover behavior,
8. perform valid attacks,
9. finish the battle,
10. receive loot/injury result,
11. equip an obtained item,
12. return to the multiplayer map with state preserved.

## 20. Deployment

### Client

Static production build deployed to GitHub Pages, with an expected project URL pattern:

`https://<owner>.github.io/WEB_MMORPG/`

### Server

Separate Node-compatible hosting over HTTPS/WSS. The endpoint is supplied through environment/build configuration rather than hard-coded gameplay code.

### Database

Private to the authoritative server and not hosted by GitHub Pages.

## 21. Implementation order

1. monorepo/tooling and shared protocol,
2. authoritative server connection/session foundation,
3. character persistence and selection,
4. one multiplayer world map,
5. desktop/mobile movement,
6. battle state machine and hex primitives,
7. AP/initiative/movement,
8. obstacles/LOS/cover,
9. attacks/HP/downed/injury system,
10. loot/inventory/equipment,
11. complete world -> battle -> world loop,
12. responsive polish and GitHub Pages deployment.

## 22. Success criteria

MVP 1 is successful when a user can open the deployed browser client on both PC and phone, enter the same shared map as other users, move using the appropriate controls, start a server-authoritative tactical hex encounter, complete it using AP/initiative/cover rules, receive persistent loot or injuries, equip an item, and return to the multiplayer map without trusting the client for gameplay outcomes.
