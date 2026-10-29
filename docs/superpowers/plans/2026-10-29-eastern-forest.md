# Eastern forest implementation plan

> **For agentic workers:** Use subagent-driven development for independent world, client and persistence tasks; root integrates the socket lifecycle.

**Goal:** Add a dense forest east of the settlement, connected by edge teleport zones, with new enemies and a shared three-minute respawn after victory.

**Architecture:** World fixtures define bounds, portals and encounter positions. The server authorizes movement and location transfers. New forest encounters have exclusive in-memory battle leases and persisted respawn deadlines; the client renders server state and countdowns.

**Tech Stack:** TypeScript, Phaser, Socket.IO, PostgreSQL, Vitest, Capacitor Android.

## Constraints and decisions

- User selected a respawn of 180 seconds. It applies to new forest spawns and survives reconnects and server restarts.
- Existing isolated worktree is reused; primary checkout's unrelated enemy work remains untouched.
- Settlement stays 1600 by 900. Las Wschodni is 2000 by 1200, east of the settlement.
- Settlement right portal: rectangle (1510,350,90,200), arrival in forest (150,600).
- Forest left portal: rectangle (0,500,90,200), arrival in settlement (1450,450). Arrivals are outside the opposite portal.
- New spawns: boars (480,410), spiders (900,780), wolves (1450,330), boars (1680,900). Existing terrain and vegetation textures are reused with dense trees and clear paths.
- A living encounter can be challenged by one battle at a time. Victory starts its deadline; defeat or the last disconnect releases it alive. Other party members in the same location retain existing shared battle behavior.
- Server validates actual location and optional movement locationId, preventing stale input after a teleport. Clients cannot enable a spawn by changing their clock.

## Tasks

- [x] Shared optional world metadata, teleport geometry and encounter status fields; optional movement locationId for compatibility.
- [x] Core world and enemy definitions: location-scoped bounds/NPCs/encounters, portal round trip, individual enemy stats/rewards and focused unit tests.
- [x] Respawn service, migration 010, persisted hydration, exclusive leases, idempotent completion, stale-token safety and focused persistence checks.
- [x] Client: dense forest, visible portal areas, location switching and camera reset, countdown markers, busy/dead encounter menu blocking, focused interaction tests.
- [x] Socket integration: await readiness, reserve after final revalidation in the same synchronous block as battle creation, associate lease with battle, finish once, release on last disconnect; transfer rooms and persist destination.
- [x] Focused Socket.IO tests for round-trip/reconnect, old-room isolation, concurrent challenge rejection, death countdown persistence and disconnect release.
- [ ] Native desktop and phone-size QA; Android 0.1.14/code15; targeted builds, final review, CI and exact deployed artifact verification.

## Review focus

Check simultaneous admission, final participant disconnect, a stale movement packet after transfer, presentation after a defeat in another location, and a persisted deadline loaded after server restart. Relevant tests belong to each owning task rather than a separate audit suite.

## Verification completed before release

- Core world/battle focused tests: 40 passed.
- Client location/render/menu/HUD tests: 36 passed; client TypeScript and production build passed.
- Respawn unit tests: 4 passed, including automatic retry after a transient write failure.
- Database/migration checks: 5 passed.
- Socket forest lifecycle: 4 passed after reproducing the missing transfer broadcast.
- Existing party/gameplay/social/merchant/chat socket checks: 30 passed.
- Chat bounds regression: reproduced at the eastern forest edge, then 10 chat unit tests passed.
- Native QA: both portals, forest desktop and 844 by 390 phone viewport, boar Auto victory, countdown and reconnect persistence.
