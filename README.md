# WEB_MMORPG

Browser MMORPG prototype inspired by classic 2D map-based RPGs, with an original world and a deeper tactical combat system.

## Public test

Client: https://owca217.github.io/WEB_MMORPG/

Server: https://web-mmorpg-server.onrender.com

The Render free instance may sleep when idle, so the first connection can take a little longer. Character, injury and inventory progress is currently stored in memory and resets when the server restarts or redeploys.

## MVP 2 vertical slice

The current playable slice contains:

- one authored forest settlement and surrounding woodland
- shared multiplayer world movement
- desktop WASD/arrows + click-to-move
- mobile tap-to-move + virtual joystick
- guide Boran and healer Ada
- one wolf encounter
- tactical turn-based hex combat with AP and initiative
- movement range preview, melee/ranged action modes and line-of-sight validation
- obstacles and visible cover objects
- automatic server-controlled wolf turns
- character HP, injuries and severe-injury state
- inventory and wolf loot
- victory/defeat result screen and return to the shared world

## Architecture

- TypeScript
- Phaser 4.2.1
- Vite 8.2.2
- Node.js 22+
- Socket.IO 4.8.3
- Vitest 5.0.1
- npm workspaces

The browser client is deployed to GitHub Pages. The authoritative Node/Socket.IO game server is deployed separately to Render and owns movement validation, encounter range, battle rules, AP, turns, damage, injuries, NPC turns, loot and outcomes.

Persistent production accounts/database storage, the full classless proficiency system, companions, advanced healing and the wider game world are outside this MVP 2 slice and will be expanded in later milestones.
