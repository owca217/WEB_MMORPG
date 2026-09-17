# WEB MMORPG — Accounts, Character Creation, and Persistent Player State Design

**Date:** 2026-09-18  
**Status:** Approved design, pending implementation plan  
**Target branch:** `feature/mvp-vertical-slice`

## 1. Purpose

The current MVP identifies a player by a temporary nickname and stores player/session/world data only in server memory. This design replaces that temporary identity model with durable accounts, one persistent character per account, 30-day sessions, a full first-login character creator, PostgreSQL persistence, and server-authoritative player state.

The main goals are:

- one account has exactly one character;
- account login and public character nickname are separate;
- the server remains authoritative for gameplay state;
- player state survives disconnects, browser restarts, and backend restarts;
- the last known map and coordinates are restored on login;
- inventory, HP, injuries, progression, and other important state are persisted safely;
- only one active session exists for an account at a time;
- account recovery works without requiring an email address;
- character deletion is delayed and reversible for 24 hours;
- deleted character nicknames remain reserved for 7 additional days.

## 2. Non-goals

This iteration does not introduce:

- multiple characters per account;
- email login;
- Google/OAuth login;
- guilds, trading, auction house, or banking;
- distributed/multi-node world servers;
- client-authoritative movement or combat;
- permanent character appearance editing after creation;
- automatic account recovery without the recovery code.

The design must not block adding these systems later.

## 3. High-level architecture

Use one Node.js backend process for both account/authentication functions and the authoritative game server.

```text
Browser / Phaser client
        |
        | HTTPS REST: account and character lifecycle
        | Socket.IO: authenticated live gameplay
        v
Node.js backend
  - AuthService
  - AccountService
  - SessionService
  - CharacterService
  - WorldService
  - BattleService
  - InventoryService
  - Persistence repositories
        |
        v
PostgreSQL
```

PostgreSQL is the durable source of player/account data. The Node process owns the live authoritative state for online players.

The database does not run the game simulation. The live server state does.

## 4. Identity model

### Account

An account is private identity used to authenticate.

Fields include:

- `id`
- `username`
- `username_normalized`
- `password_hash`
- `recovery_code_hash`
- `status`
- `created_at`
- `updated_at`

The account username is not the public player name.

Account username rules:

- normalized form is lowercase using a single shared normalization function;
- 3–32 characters;
- ASCII letters, digits, underscore, and hyphen;
- compared case-insensitively for uniqueness;
- original casing may be retained for display in account UI;
- never exposed as the character's public name.

Account status starts as `active`. The schema should allow later states such as `banned` without requiring a redesign.

### Character

An account can own zero or one character.

The database enforces the 1:1 relation with a unique constraint on `characters.account_id`.

A character contains:

- stable `id`;
- `account_id`;
- globally unique `nickname`;
- `nickname_normalized` used for uniqueness checks;
- appearance;
- current map/location;
- current coordinates;
- HP/max HP;
- progression fields;
- creation/update timestamps;
- deletion lifecycle fields.

Public character nickname rules preserve the current gameplay constraint:

- normalized form is lowercase using a single shared normalization function;
- 3–20 characters;
- uniqueness is case-insensitive;
- nickname ownership is checked by the server;
- reserved deleted nicknames count as unavailable.

## 5. Registration flow

The registration screen contains:

- account username;
- password;
- password confirmation.

The server validates the request, hashes the password with Argon2id, creates the account, and generates a cryptographically random recovery code.

The recovery code is displayed to the player exactly once after successful registration.

Example presentation:

```text
AB7K-9P2M-X4Q8-R6TN
```

The exact encoded value is random; the server never stores the plaintext code.

The account row stores only a secure hash of the recovery code.

The player must explicitly acknowledge that the code has been saved before continuing.

## 6. Password handling

Passwords are never stored or logged in plaintext.

Requirements:

- minimum 10 characters;
- maximum input length enforced to prevent abuse;
- hash using Argon2id;
- password verification happens only on the backend;
- no password value is returned to the client;
- authentication endpoints are rate-limited;
- repeated failed logins cause temporary throttling.

Password complexity rules beyond minimum length are intentionally avoided. Long passwords/passphrases are accepted.

## 7. Session model

Successful login creates a random opaque session token.

Do not use JWT for the primary login session because the design requires immediate server-side revocation.

The database stores:

- `id`
- `account_id`
- `token_hash`
- `created_at`
- `expires_at`
- `last_seen_at`
- `revoked_at`

Session lifetime is 30 days.

Only the plaintext session token is returned to the authenticated browser. The database stores only its hash.

The token is:

- stored persistently by the browser;
- never placed in a URL;
- sent over HTTPS only;
- used as a bearer credential for account REST calls;
- supplied in the Socket.IO authentication handshake for game connections.

Because the production client and backend are currently on different origins, the initial implementation should use an explicit opaque bearer token rather than depend on cross-site cookies.

## 8. One active session per account

Only one session for an account may be active. The database enforces this with a uniqueness strategy for the active session state (for example a partial unique index where `revoked_at IS NULL`), in addition to application-level checks.

When a valid new login succeeds:

1. authenticate username/password;
2. revoke the previous active session;
3. notify the previous live socket with `sessionReplaced` if it exists;
4. persist the previous online character state;
5. remove the old player instance from the authoritative world;
6. create the new 30-day session;
7. allow the new client to attach to the character.

At no point should two authoritative world instances of the same character remain active.

A race between simultaneous logins must be resolved transactionally so exactly one resulting session is considered current.

## 9. Automatic login and logout

On application startup the browser checks for a stored session token.

If present:

1. call the session validation endpoint;
2. if valid, retrieve account/character lifecycle state;
3. connect to Socket.IO using the same token;
4. enter the character creator if no character exists;
5. enter the world if an active character exists;
6. show pending-deletion account UI if the character is awaiting deletion.

If the token is missing, invalid, expired, or revoked, return to the login screen.

Manual logout:

1. requests a final authoritative save;
2. removes the player from the world;
3. revokes the current session;
4. clears the browser token;
5. returns to the login screen.

Disconnecting a socket alone does not revoke the 30-day account session.

## 10. Account recovery

The recovery flow requires:

- account username;
- recovery code;
- new password;
- new password confirmation.

If the username and recovery code match:

1. replace the password hash;
2. revoke all existing sessions;
3. generate a new recovery code;
4. replace the old recovery-code hash;
5. display the new recovery code once.

The old recovery code becomes invalid immediately after successful recovery.

Without the recovery code there is no automatic self-service recovery in this iteration.

## 11. Character creation flow

After account authentication:

- account with no character -> Character Creator;
- account with an active character -> World;
- account with a character pending deletion -> deletion countdown/account panel.

The creator includes:

- public nickname;
- body type / sex presentation;
- skin tone;
- face;
- eyes;
- hairstyle;
- hair color;
- facial hair;
- scar or tattoo;
- starting outfit.

The creator uses a finite set of server-approved options, not free-form geometry sliders.

The client presents a live visual preview, but the server validates every submitted appearance option against the shared appearance catalog.

The client must not be able to submit arbitrary asset IDs.

### Appearance representation

Store appearance as PostgreSQL `JSONB` associated with the character.

Initial shape:

```json
{
  "bodyType": "body-01",
  "skinTone": "skin-02",
  "face": "face-03",
  "eyes": "eyes-01",
  "hair": "hair-04",
  "hairColor": "hair-color-02",
  "facialHair": "facial-hair-none",
  "marking": "scar-01",
  "startingOutfit": "outfit-02"
}
```

The same shared appearance catalog must drive both the creator and in-world renderer so saved appearance is visibly reflected in gameplay.

### Character creation transaction

The server validates:

- authenticated account;
- account has no existing character;
- nickname format;
- nickname global availability;
- nickname is not in reserved nicknames;
- all appearance values are allowed.

Character creation happens in a database transaction.

The new character starts with:

- location: `forest-settlement-01`;
- canonical start spawn coordinates;
- full start HP;
- empty starter inventory for this iteration;
- selected appearance;
- default progression state.

Only after the transaction commits may the character enter the world.

## 12. Persistent data model

The initial persistent model consists of at least:

### `accounts`

Private account credentials and account status.

### `account_sessions`

Opaque persistent sessions and revocation state.

### `characters`

Core durable character state:

- identity;
- account relationship;
- nickname;
- appearance JSONB;
- location ID;
- x/y coordinates;
- HP/max HP;
- progression fields;
- deletion-request timestamp;
- deletion-effective timestamp;
- timestamps.

### `character_items`

Durable owned item instances or stacks.

This must be relational rather than a single inventory JSON document so later trading, crafting, banks, and auctions can evolve safely.

### `character_equipment`

Equipped item references / slots.

### `character_injuries`

Persistent injuries and their state.

### `reserved_nicknames`

Stores nicknames temporarily blocked after final character deletion.

Minimum fields:

- normalized nickname;
- original/display nickname;
- `former_account_id` referencing the account that owned the deleted character;
- `reserved_until`;
- timestamps.

## 13. Database access boundary

Gameplay services should not execute raw SQL directly.

Introduce repository/service boundaries such as:

- `AccountRepository`
- `SessionRepository`
- `CharacterRepository`
- `InventoryRepository`
- `InjuryRepository`

The server can use the PostgreSQL `pg` driver with explicit SQL migrations and a thin repository layer. A large ORM is not required for this iteration.

Database connection configuration comes from `DATABASE_URL`.

Schema changes are versioned in the repository through migrations. Production tables are not created manually through the hosting dashboard.

## 14. Live authoritative player state

For online players, the Node server owns the active state.

The client sends intentions, not final results.

Examples:

Allowed client intent:

```text
move toward this point
attack this target
use this item
interact with this NPC
equip this item
```

Not accepted as authoritative input:

```text
set x = 900
set HP = 999
give me item X
add XP
set battle result = victory
```

The server determines movement limits, coordinates, damage, HP, loot, inventory mutations, injuries, and progression.

Existing `WorldService`, `BattleService`, `CharacterService`, and `InventoryService` remain authoritative runtime services, but their lifecycle is connected to persistent repositories.

## 15. Loading a character into the world

The existing temporary flow that always creates a player at the shared spawn is replaced.

Authenticated world entry becomes:

1. validate session token;
2. resolve account;
3. resolve active character;
4. load durable character state from PostgreSQL;
5. hydrate runtime character/inventory/injury services;
6. add the player to `WorldService` at saved `location_id`, `x`, and `y`;
7. join the Socket.IO room for that location;
8. emit authoritative state.

The world service must gain an API that accepts persisted spawn state instead of always forcing the canonical start spawn.

The canonical spawn remains only for first creation and explicit gameplay resets such as defeat rules.

## 16. Persistence strategy

The server keeps the freshest online state in RAM and persists durable checkpoints to PostgreSQL.

### Immediate durable mutations

Gameplay/economy mutations are persisted as part of the authoritative action before the client receives final success.

Examples:

- item gained/lost;
- equipment changes;
- HP changes from meaningful gameplay actions;
- injuries;
- progression/XP;
- rewards;
- permanent stat changes;
- battle outcome effects;
- purchases when those systems are added.

Where one action changes several durable records, use a database transaction.

### Position checkpointing

The server continuously owns exact live coordinates.

Coordinates are checkpointed to PostgreSQL approximately every 2 seconds for dirty online players, and also immediately on:

- manual logout;
- disconnect;
- map/location transition;
- battle entry;
- battle exit;
- server-driven respawn/reset.

This avoids a database write for every movement packet.

A hard process/host failure may therefore restore a character to a coordinate checkpoint up to roughly 2 seconds old. Inventory, rewards, progression, and other important mutations are not allowed the same deferred-write window.

### Dirty-state handling

Runtime services should expose or feed a persistence coordinator that knows which character sections changed.

The persistence coordinator batches safe position-only writes, while critical gameplay mutations use immediate repository transactions.

## 17. Disconnects and backend restart

On normal socket disconnect:

1. snapshot authoritative character state;
2. persist current position/state;
3. remove the player from runtime world services;
4. keep the account session valid for future automatic login.

On abrupt process termination, graceful handlers should attempt a final flush, but correctness must not depend on that handler firing.

After a backend restart the RAM world is empty. On reconnect/login, each player is reconstructed from PostgreSQL.

## 18. Character deletion

A player may request deletion of the single character.

Deletion request requires re-entering the account password.

On a valid deletion request:

- record deletion request time;
- set deletion effective time to 24 hours later;
- remove the character from the active world if necessary;
- prevent normal world entry while deletion is pending;
- show a countdown and an option to cancel.

During the 24-hour window the player may cancel deletion. Cancellation restores normal character access.

After 24 hours the deletion becomes eligible for finalization. Finalization is triggered whenever the owning account state is loaded and whenever nickname availability is checked; an optional periodic cleanup may also run, but correctness must not depend on a scheduler.

Finalization removes character-owned persistent data according to foreign-key/cascade policy and creates a nickname reservation. The reservation expires at `deletion_effective_at + 7 days`, so delayed cleanup never extends the agreed reservation period.

The account remains and returns to the `no character` state.

The next login then opens the character creator.

## 19. Nickname reservation after deletion

After final deletion, the character nickname remains unavailable for 7 additional days.

A reservation stores a normalized nickname and `reserved_until`. Availability checks must first finalize any overdue pending deletion for the same normalized nickname, then evaluate the reservation.

Character creation checks both:

- active character nicknames;
- unexpired nickname reservations.

Expired reservations may be deleted lazily during lookup/creation and/or by a periodic cleanup job.

After expiry the nickname can be claimed by any account.

## 20. HTTP and Socket.IO responsibilities

Use HTTPS REST endpoints for low-frequency account lifecycle operations.

Expected endpoint groups:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/recover
GET  /api/auth/session

POST /api/character
POST /api/character/delete-request
POST /api/character/delete-cancel
GET  /api/character
```

The endpoint paths above are the contract for this iteration; implementation may factor handlers internally, but clients use these paths.

Socket.IO is used for authenticated live game traffic.

The current nickname-based `login` socket event is removed/replaced. Socket authentication resolves the player from the session token; a client cannot select a player ID or nickname as its identity.

Add the server event:

```text
sessionReplaced
```

to force a superseded connection back to the login scene.

## 21. Client scene flow

The client flow becomes:

```text
Boot
  |
  +-- valid stored session?
       |
       +-- no --> Login/Register
       |
       +-- yes --> Account state
                    |
                    +-- no character --> CharacterCreatorScene
                    |
                    +-- pending deletion --> CharacterDeletionScene / account panel
                    |
                    +-- active character --> WorldScene
```

Login UI includes:

- account username;
- password;
- Log in;
- Create account;
- Recover account.

Registration UI includes username/password/password confirmation.

Recovery UI includes username/recovery code/new password/password confirmation.

Account UI exposes manual logout and character deletion controls.

## 22. Security requirements

The implementation must include:

- HTTPS-only production traffic;
- Argon2id password hashing;
- cryptographically random session and recovery tokens;
- only token hashes in the database;
- case-insensitive uniqueness for usernames and nicknames;
- parameterized SQL only;
- backend validation for every account/character field;
- authentication rate limiting;
- no sensitive values in application logs;
- session revocation on password recovery;
- one active session enforced server-side;
- Socket.IO authentication before gameplay commands are accepted;
- server-side authorization checks on all character mutations;
- no trust in client-supplied player/account IDs;
- bounded request sizes;
- CORS restricted to configured production/development client origins rather than unrestricted production CORS.

Client-side validation is for UX only and never replaces backend validation.

## 23. Database transactions and consistency

Use transactions when an action spans multiple durable changes.

Examples:

- registration: account + recovery state;
- login replacement: revoke old session + create new session;
- character creation: uniqueness checks + character + starter state;
- battle reward: character outcome + inventory reward;
- password recovery: password + session revocation + recovery-code rotation;
- final character deletion: character data deletion + nickname reservation.

Database unique constraints are the final protection against race conditions even when application-level checks run first.

## 24. Migration from the current MVP

There is no production account data to migrate from the temporary nickname-session model.

The rollout can therefore replace temporary login directly.

Existing live-game services are adapted rather than rewritten wholesale.

Key changes:

- replace `SessionStore.login(nickname)` identity creation with authenticated account sessions;
- stop generating a fresh player UUID on every nickname login;
- use stable character IDs as player IDs;
- allow `WorldService.addPlayer` to hydrate saved location/coordinates;
- persist Character/Inventory/Injury data;
- remove runtime state on disconnect without deleting durable state;
- replace the current login scene with account/session flow.

## 25. Deployment and configuration

The backend requires PostgreSQL and the following environment-level configuration at minimum:

```text
DATABASE_URL
CLIENT_ORIGIN
SESSION_TTL_DAYS=30
POSITION_CHECKPOINT_MS=2000
```

Secrets such as database credentials are configured in the hosting environment and never committed to Git.

Database migrations must run as an explicit deployment/startup step with failure stopping the deployment rather than silently running against an unknown schema.

The design remains provider-neutral: PostgreSQL may be hosted by Render or another PostgreSQL provider as long as the backend receives a valid `DATABASE_URL`.

## 26. Testing strategy

### Unit tests

Cover:

- username validation/normalization;
- nickname validation/normalization;
- password hashing and verification;
- recovery-code hashing/rotation;
- session expiration/revocation;
- appearance catalog validation;
- nickname reservation expiry;
- persisted world-position hydration.

### Repository/integration tests

Against PostgreSQL:

- account uniqueness;
- one-character-per-account constraint;
- nickname uniqueness;
- session replacement transaction;
- character creation transaction;
- recovery transaction;
- item/equipment/injury persistence;
- deletion and nickname reservation.

### Socket/HTTP end-to-end tests

Required core flow:

1. register account;
2. receive recovery code;
3. login;
4. create character;
5. connect authenticated socket;
6. enter world;
7. move;
8. persist/checkpoint;
9. disconnect/logout;
10. login again;
11. verify the same character, map, and coordinates are restored.

Additional E2E cases:

- second login kicks first connection;
- duplicate account username rejected;
- duplicate nickname rejected;
- spoofed player ID has no effect;
- invalid appearance ID rejected;
- old recovery code invalid after use;
- old session invalid after recovery;
- deletion can be cancelled within 24 hours;
- finalized deletion returns account to creator flow;
- deleted nickname remains unavailable for 7 days;
- an expired nickname reservation becomes available.

### Existing gameplay regression tests

Existing world, battle, NPC, inventory, and multiplayer tests must continue to pass after the identity/persistence refactor.

## 27. Acceptance criteria

The feature is complete when all of the following are true:

- a new user can register with username/password;
- a recovery code is generated and shown once;
- the user can remain logged in across browser restarts for up to 30 days;
- manual logout invalidates the current session;
- logging in elsewhere replaces the old session and disconnects the old player;
- one account cannot create more than one character;
- character nickname is globally unique;
- the selected appearance is stored and rendered;
- server restart does not erase account or character data;
- reconnect restores map, coordinates, HP, inventory, equipment, injuries, and progression;
- gameplay state cannot be set directly by the client;
- recovery code can reset the password and rotates after use;
- deletion requires password confirmation;
- character deletion waits 24 hours and can be cancelled;
- finalized deletion keeps the nickname reserved for 7 days;
- PostgreSQL migrations and CI tests are green;
- existing gameplay remains functional.

## 28. Implementation order

The implementation plan should preserve this dependency order:

1. PostgreSQL connection and migrations;
2. account repositories and password hashing;
3. registration/login/session lifecycle;
4. session replacement and logout;
5. recovery-code flow;
6. character schema and creator backend;
7. character creator UI and appearance catalog;
8. durable CharacterService/world hydration;
9. position persistence coordinator;
10. inventory/equipment/injury persistence;
11. deletion lifecycle and nickname reservation;
12. security hardening, E2E tests, deployment configuration, and manual acceptance.

No implementation work should be merged to `main` until the feature branch passes verification and receives explicit approval.
