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

## Stack

- TypeScript
- Phaser 4.2.1
- Vite 8.2.2
- Node.js
- Express + Socket.IO 4.8.3
- PostgreSQL 16
- Vitest 5.0.1
- S3-compatible object storage for item icons

The static client is intended for GitHub Pages. The authoritative game server is a separate Node service and cannot run on GitHub Pages.

## Accounts and authentication

The game uses persistent username/password accounts backed by PostgreSQL. Passwords are stored as Argon2id hashes, session tokens are opaque and only their hashes are stored server-side, and one active session is maintained per account in this iteration.

Players can register, log in, recover a password with a rotating recovery code, resume a saved browser session and create one persistent character per account. Gameplay Socket.IO authentication uses the same account session as REST; the server derives the persistent character identity instead of trusting a nickname or role sent by the client.

Public registration always creates `PLAYER`. ADMIN authorization comes from `accounts.role` in PostgreSQL. There is no separate ADMIN token field in the login screen.

For a fresh production database, the first ADMIN can be bootstrapped once with:

- `INITIAL_ADMIN_USERNAME`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ADMIN_RECOVERY_CODE`

After the first ADMIN is created and normal login is verified, remove all three bootstrap variables from hosting. Do not use the retired `ADMIN_ACCESS_TOKEN` / `VITE_ENABLE_ADMIN_LOGIN` flow.

## ADMIN item creator

ADMIN accounts have an in-game catalog and a nine-step item creator with server-provided category/stat metadata, icon uploads, draft validation, optimistic concurrency, publication, version history/restore, archive actions and category/stat management.

The ADMIN panel also contains account management for role/status changes. The last active ADMIN cannot be demoted or banned, and all ADMIN authorization remains enforced by the server on every request.

Catalog definitions, version history, account-aware audit records and persistent character inventory instances are stored in PostgreSQL. Existing item instances resolve the currently active published base definition without losing instance identity or quantity when a new definition version is published.

Deployment configuration, first-ADMIN bootstrap, S3 variables, migrations and production rollout are documented in [`docs/item-creator-operations.md`](docs/item-creator-operations.md).

## Database migrations

With `DATABASE_URL` configured, migrations can be run explicitly from the repository root:

```bash
npm run db:migrate --workspace @web-mmorpg/server
```

The server also runs migrations and metadata/starter-item seeding before it begins listening for traffic. Account/auth migrations are additive: existing Item Creator data is preserved, while new inventory ownership uses persistent `character_id`. Legacy `player_id` inventory rows remain stored as unassigned legacy data rather than being guessed onto accounts by nickname.

## Verification

```bash
npm test
npm run build
```

Feature CI additionally starts PostgreSQL 16 and verifies the migration command before the complete test/build suite. Final acceptance also covers persistent account auth, character/session recovery, ADMIN account access, existing Item Creator flows and migration compatibility.
