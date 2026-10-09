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

## ADMIN item creator

ADMIN accounts have an in-game catalog and a nine-step item creator with server-provided category/stat metadata, icon uploads, draft validation, optimistic concurrency, publication, version history/restore, archive actions and category/stat management.

The server remains the authorization and validation boundary. A normal `PLAYER` bearer session cannot mutate the ADMIN catalog even if a client attempts to call the REST endpoints directly.

Catalog definitions, version history, audit records and inventory item instances are stored in PostgreSQL. Existing item instances resolve the currently active published base definition without losing instance identity or quantity when a new definition version is published.

Deployment configuration, S3 variables, migrations and the ADMIN bootstrap login flow are documented in [`docs/item-creator-operations.md`](docs/item-creator-operations.md).

## Database migrations

With `DATABASE_URL` configured, migrations can be run explicitly from the repository root:

```bash
npm run db:migrate --workspace @web-mmorpg/server
```

The server also runs migrations and metadata/starter-item seeding before it begins listening for traffic.

## Verification

```bash
npm test
npm run build
```

Feature CI additionally starts PostgreSQL 16 and verifies the migration command before the complete test/build suite.
