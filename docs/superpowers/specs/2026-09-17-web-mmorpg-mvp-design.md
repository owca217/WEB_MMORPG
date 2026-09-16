# WEB MMORPG MVP Design

**Date:** 2026-09-17

## Goal

Build the first playable vertical slice of a browser MMORPG that works on desktop and mobile. The presentation is a classic 2D location-based RPG, while combat is a separate turn-based tactical layer on a hex grid.

## Product decisions

- The game is multiplayer/MMORPG from the beginning.
- The world is split into separate locations connected by exits/portals.
- Movement supports click/tap-to-move, WASD and mobile touch controls.
- Character progression has a general level, but weapon/skill proficiencies matter more than level.
- There are no fixed classes. Builds emerge from equipment, abilities and proficiency use.
- Combat is turn based.
- Combat uses AP plus initiative/speed.
- Combat takes place on a hex grid whose size depends on encounter type.
- Normal encounters use partly procedural arenas; bosses and special encounters can use authored layouts.
- Obstacles can block movement and ranged line of sight and can provide cover.
- Players can use companions and build-dependent summons/pets.
- Companions are recruitable in the world, have their own AP, equipment, skills and progression.
- A character reduced to 0 HP is not permanently deleted. It can receive a general severe-injury state plus specific injuries.
- Specific injuries can affect movement, initiative, AP, maximum HP, accuracy or other combat properties.
- The injury model can apply to players, companions and suitable enemies.

## MVP flow

1. Connect/login.
2. Create/select a character.
3. Enter one multiplayer location.
4. See and move alongside other connected players.
5. Interact with one enemy encounter.
6. Create a separate tactical battle instance.
7. Play a hex-grid battle using AP, initiative, movement, obstacles and basic attacks.
8. Resolve victory/defeat and injuries.
9. Award simple loot.
10. Return to the world location.

## Architecture

### Client

A TypeScript browser application using Phaser 4.2.1 and Vite. Phaser renders the world and battle scenes. HTML/CSS overlays are used where appropriate for forms and dense UI.

The client is presentation-focused. It sends player intent to the server and renders authoritative snapshots/events. It never decides final movement validity, damage, loot or battle results.

### Server

A Node.js TypeScript service using Socket.IO 4.8.3. The server is authoritative for:

- sessions and connected players
- map occupancy and movement validation
- encounter creation
- battle state
- initiative and turn order
- AP spending
- path/range/line-of-sight validation
- damage and injury outcomes
- loot/result resolution

The first vertical slice may use in-memory repositories behind explicit interfaces so world and battle logic can be proven quickly. Persistent account/character storage is introduced before public testing without changing protocol contracts.

### Shared package

A framework-independent TypeScript package contains:

- IDs and data contracts
- Socket.IO event payload types
- world coordinates
- hex coordinates
- battle commands/events
- entity and injury types

Both client and server import the same contracts.

## Repository layout

```text
apps/
  client/
  server/
packages/
  shared/
docs/
  superpowers/
    specs/
    plans/
```

## World model

The first map is a bounded 2D location. Movement is continuous at presentation level but validated by the server against location bounds and collision geometry. World locations have stable IDs and explicit exits so later regions can be hosted/sharded independently if required.

## Battle model

A battle is an isolated server-owned state machine.

Core entities:

- battle
- combatant
- hex coordinate
- obstacle
- turn entry
- action/command
- status/injury

Initial actions:

- move
- basic melee attack
- basic ranged attack
- end turn

AP is refreshed according to the combatant rules at turn start. Initiative determines turn order. Later skills can modify AP, initiative and action costs without replacing the core turn engine.

## Hex arena

Use axial hex coordinates `q,r` internally.

Arena generation receives an encounter profile and deterministic seed. It produces:

- valid cells
- starting zones
- blocking obstacles
- cover obstacles

Deterministic generation makes server tests and multiplayer reconciliation repeatable.

## Companions and summons

The model distinguishes:

- player character: full progression
- companion: full combat turn, independent AP, equipment and deep progression
- summon/pet: behavior and resource model defined by the skill/build that created it

The maximum number of active companions can later be tied to a leadership-style progression system.

## Injury model

Dropping to 0 HP can add `severelyInjured` and one or more specific injuries. Healing HP alone does not clear those injuries. Injuries are separate statuses with explicit treatment requirements.

The first implementation only needs a small representative set so the architecture is proven.

## Networking

Use typed Socket.IO events. Client commands contain intent and references; server responses contain accepted state/events or a typed rejection.

Important server rules:

- never trust client position or damage values
- reject commands from a player who does not own the acting combatant
- reject actions outside the active turn
- reject actions that exceed AP/range/path/line-of-sight rules

## Testing

Pure world and battle rules are framework-independent and tested with Vitest. Network handlers are thin adapters around those rules.

Minimum high-value tests:

- hex neighbor/distance/path helpers
- deterministic arena generation
- movement AP costs
- blocked cells
- initiative ordering
- turn ownership
- AP rejection
- melee/ranged range rules
- line-of-sight obstruction
- severe injury on 0 HP

## Deployment

The client can be built as static files and deployed to GitHub Pages. The Node/Socket.IO server requires a separate host. The client reads its server URL from environment configuration so hosting can change without rebuilding game logic.

## Non-goals for the first vertical slice

- large world
- guilds
- auction house
- crafting
- full quest system
- production economy
- advanced PvP matchmaking
- final art
- monetization
