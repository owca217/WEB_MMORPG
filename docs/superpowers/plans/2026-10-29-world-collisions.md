# World obstacle collisions

**Goal:** Prevent walking through trunks, rocks, buildings and fences in both locations, with matching client prediction and server enforcement.

**Architecture:** Share the visual layout data and static collision geometry. Sweep the player footprint over the complete movement segment, with sliding along obstacles. Click destinations and NPC approach use shared navigation paths; keyboard movement uses collision resolution directly.

## Decisions

- Trunks block movement; crowns, shrubs and ground plants remain decorative.
- Player footprint radius is 10 with its rendered foot offset accounted for in obstacle coordinates.
- Settlement buildings, rocks and fence segments block movement. The eastern gate has a real and visible opening.
- All roads, encounter clearings, spawn positions and teleport arrivals must remain reachable.
- Old saved positions inside a new obstacle move to nearby walkable ground during hydration.
- NPC approach selects a reachable point within interaction range, including Ada beside the healer building. The server still confirms arrival before interaction.
- Pointer, keyboard, typing, session changes and location transfers retain cancellation behavior.

## Tasks

- [x] Move layout data into shared modules with client compatibility exports.
- [x] Implement tested swept movement, walkability, spawn normalization and navigation helpers.
- [x] Apply collision resolution on the server after the speed limit and before teleport handling.
- [x] Integrate collision-aware prediction, click paths and NPC paths; open the rendered gate.
- [x] Verify authenticated movement rejects crossing obstacles, saves safe positions and keeps portals/NPCs usable.
- [ ] Native desktop and phone-size QA; signed Android0.1.15/code16; publish and verify exact CI/deployment/artifacts.

## Focused verification

Cover full-segment tunneling, sliding, diagonal corners, paths around buildings/trees, blocked goals, an old saved position inside a wall, NPC approach once after confirmed arrival, and portal round trips. Reuse existing movement, NPC, world and socket tests; run broad CI as required by the release workflow.

## Verification before release

- Shared geometry/navigation: 7 tests passed, including swept collision, sliding and tangent regressions.
- Core world/collision/location tests: 18 passed.
- Client NPC/prediction/location/renderer tests: 34 passed; client TypeScript and production build passed.
- Authenticated collision and existing forest/gameplay/chat/merchant/healing checks: 40 passed across 7 files.
- Independent review found no confirmed actionable issue.
- Native QA: character routed around the healer building, talked to Ada and healed; the open settlement gate remained traversable.
