# WEB_MMORPG

Browser MMORPG prototype inspired by classic 2D map-based RPGs, with a deeper tactical combat system.

## MVP direction

- 2D world split into separate locations
- PC + mobile controls: click/tap, WASD, touch controls
- authoritative multiplayer server
- turn-based hex combat with AP and initiative
- procedural obstacles, line of sight and cover
- companions, summons and injury states
- responsive browser client

## Planned stack

- TypeScript
- Phaser 4.2.1
- Vite 8.2.2
- Node.js
- Socket.IO 4.8.3
- Vitest 5.0.1

The static client is intended for GitHub Pages. The authoritative game server is a separate Node service and cannot run on GitHub Pages.
