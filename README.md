# WEB_MMORPG

Browser MMORPG prototype inspired by classic 2D map-based RPGs, with an original world and a deeper tactical combat system.

## Public test

Client: https://owca217.github.io/WEB_MMORPG/

Server: https://web-mmorpg-server.onrender.com

The Render instance may need a short warm-up after a period of inactivity, depending on the active service plan.

## Persistent accounts and characters

The feature branch now contains a persistent account system backed by PostgreSQL:

- username + password registration
- Argon2id password hashing
- one-time recovery code stored only as a hash
- 30-day opaque bearer sessions
- one active session per account
- one persistent character per account
- globally unique character nicknames
- first-login character creator with persistent appearance
- authenticated Socket.IO gameplay
- saved location and coordinates
- durable HP, injuries, inventory and equipment state
- 24-hour delayed character deletion with cancellation
- 7-day nickname reservation after final deletion

The authoritative game server keeps online state in memory. World position is checkpointed approximately every two seconds and on important transitions. Critical gameplay changes such as HP, injuries and inventory are committed to PostgreSQL before the server confirms final success to the client.

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
- PostgreSQL
- Vitest 5.0.1
- npm workspaces

The browser client is deployed to GitHub Pages. The authoritative Node/Socket.IO game server is deployed separately to Render and owns movement validation, encounter range, battle rules, AP, turns, damage, injuries, NPC turns, loot and outcomes. PostgreSQL stores durable account and character state.

## Server environment

Required for persistent production mode:

- `DATABASE_URL`
- `CLIENT_ORIGIN`

Optional:

- `SESSION_TTL_DAYS=30`
- `POSITION_CHECKPOINT_MS=2000`

Run migrations and the server:

```bash
npm run start -w @web-mmorpg/server
```

The start script runs versioned PostgreSQL migrations before starting the Node game server. Database credentials must be configured in the hosting environment and must never be committed to Git.

### Render deployment

Configure the server service with:

```text
DATABASE_URL=<PostgreSQL connection string>
CLIENT_ORIGIN=https://owca217.github.io
SESSION_TTL_DAYS=30
POSITION_CHECKPOINT_MS=2000
```

Use this start command:

```text
npm run start -w @web-mmorpg/server
```

### Enabling persistent accounts on the public client

The GitHub Pages build reads the repository Actions variable:

```text
VITE_PERSISTENT_ACCOUNTS
```

Leave it unset or set to `false` while the public backend has no PostgreSQL configuration. After the Render database and environment variables are ready and the persistent backend is verified, set:

```text
VITE_PERSISTENT_ACCOUNTS=true
```

Then re-run the Pages workflow (or push a client/shared change). The public flow becomes:

```text
Register -> save recovery code -> login -> create character -> enter world
```

## Persistence and security notes

- The client sends gameplay intents; it does not authoritatively set HP, XP, items, damage or coordinates.
- Passwords are hashed with Argon2id.
- Session and recovery tokens are random; only their hashes are stored server-side.
- A new login revokes the previous active session and removes the previous live character connection.
- REST and persistent Socket.IO CORS are restricted to the configured client origin.
- Normal disconnect, logout and graceful server shutdown flush pending world-position state.
- A hard process/host failure can restore position from the most recent checkpoint, while critical gameplay/economy changes use immediate durable writes.

## Development status

All account/persistence work remains on `feature/mvp-vertical-slice`. Do not merge it into `main` until automated verification, public deployment acceptance and explicit approval are complete.
