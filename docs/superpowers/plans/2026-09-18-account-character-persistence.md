# Accounts, Character Creation, and Persistent Player State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace temporary nickname-only sessions with durable username/password accounts, one persistent character per account, PostgreSQL-backed player state, authenticated Socket.IO gameplay, a first-login character creator, recovery codes, and delayed character deletion.

**Architecture:** Keep the existing TypeScript monorepo, Phaser client, and authoritative Node/Socket.IO game server. Add a thin PostgreSQL repository layer with explicit SQL migrations, low-frequency account/character REST endpoints on the same Node HTTP server, opaque 30-day bearer sessions, and runtime persistence coordination that keeps the live game authoritative while PostgreSQL provides durable state.

**Tech Stack:** TypeScript 5.9, Node.js 22+, Phaser 4.2.1, Socket.IO 4.8.3, Vite 8.2.2, Vitest 5.0.1, PostgreSQL, `pg`, `argon2`, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-18-account-character-persistence-design.md`

## Global Constraints

- Work only on `feature/mvp-vertical-slice`; merging to `main` requires separate explicit approval.
- One account owns zero or one character; `characters.account_id` must be unique.
- Account username and public character nickname are separate identities.
- Usernames are 3–32 characters, ASCII letters/digits/underscore/hyphen, normalized to lowercase, and unique case-insensitively.
- Character nicknames are 3–20 characters, normalized to lowercase, and unique case-insensitively.
- Passwords are minimum 10 characters and hashed with Argon2id; plaintext passwords are never persisted or logged.
- Recovery codes and session tokens are cryptographically random; only hashes are persisted.
- Login sessions last 30 days and only one active session per account is allowed.
- The production client uses an explicit opaque bearer token because GitHub Pages and the backend are on different origins.
- The server remains authoritative for movement, HP, combat, loot, inventory, injuries, progression, and all character mutations.
- Position checkpoints are written approximately every 2 seconds and on disconnect/logout/map transition/battle entry/battle exit/reset.
- Critical gameplay/economy state is persisted before success is emitted to the client.
- Character deletion waits 24 hours and can be cancelled; after final deletion the nickname remains reserved until `deletion_effective_at + 7 days`.
- PostgreSQL schema changes are versioned migrations committed to the repository.
- Production CORS is restricted to `CLIENT_ORIGIN`; request bodies are bounded.
- Existing multiplayer/world/battle/NPC tests must keep passing after the refactor.

## Target File Boundaries

- `apps/server/src/db/*` — PostgreSQL pool, transactions, migration runner.
- `apps/server/migrations/*` — versioned SQL schema.
- `apps/server/src/auth/*` — username/password/recovery/session rules and auth service.
- `apps/server/src/persistence/*` — SQL repositories and persistent-player coordination.
- `apps/server/src/http/*` — JSON parsing, CORS, rate limiting, REST routing.
- `apps/server/src/server/ActiveConnectionRegistry.ts` — one live game connection per account.
- `apps/server/src/server/createGameServer.ts` — authenticated Socket.IO wiring and runtime game orchestration.
- `packages/shared/src/auth.ts` — client/server account-session contracts.
- `packages/shared/src/appearance.ts` — allowed creator options and appearance types.
- `packages/shared/src/character.ts`, `world.ts`, `protocol.ts` — persistent appearance/gameplay contracts.
- `apps/client/src/net/ApiClient.ts` — REST calls and bearer auth.
- `apps/client/src/state/AuthSessionStore.ts` — local token/session state.
- `apps/client/src/scenes/AuthScene.ts` — login/register/recovery/recovery-code UX.
- `apps/client/src/scenes/CharacterCreatorScene.ts` — first-character creator.
- `apps/client/src/scenes/CharacterDeletionScene.ts` — pending-deletion countdown/cancel UX.
- `apps/client/src/appearance/*` — shared visual mapping for creator preview and world avatars.
- Existing runtime services remain focused on online state; repositories own durable storage.

---

### Task 1: PostgreSQL Foundation, Migrations, and CI Database

**Files:**
- Modify: `apps/server/package.json`
- Modify: `package-lock.json`
- Create: `apps/server/src/db/pool.ts`
- Create: `apps/server/src/db/transaction.ts`
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/migrations/001_accounts_characters.sql`
- Create: `apps/server/tests/db/migrations.test.ts`
- Modify: `.github/workflows/feature-ci.yml`

**Interfaces:**
- Produces `createPool(databaseUrl: string): Pool`.
- Produces `withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T>`.
- Produces `runMigrations(pool: Pool, migrationsDir?: string): Promise<void>`.
- Produces the durable tables required by the approved spec.

- [ ] **Step 1: Write the RED migration integration test**

Create `apps/server/tests/db/migrations.test.ts`:

```ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for database tests.");

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("database migrations", () => {
  it("creates account, session, character, inventory and nickname reservation tables", async () => {
    const result = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );

    expect(result.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "accounts",
        "account_sessions",
        "characters",
        "character_items",
        "character_equipment",
        "character_injuries",
        "reserved_nicknames"
      ])
    );
  });

  it("enforces one character per account", async () => {
    const accountId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash) VALUES ($1,$2,$3,$4,$5)",
      [accountId, "Owner", "owner", "hash", "recovery"]
    );

    const appearance = {
      bodyType: "body-01",
      skinTone: "skin-01",
      face: "face-01",
      eyes: "eyes-01",
      hair: "hair-01",
      hairColor: "hair-color-01",
      facialHair: "facial-hair-none",
      marking: "marking-none",
      startingOutfit: "outfit-01"
    };

    await pool.query(
      "INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [crypto.randomUUID(), accountId, "Owczy", "owczy", appearance, "forest-settlement-01", 360, 470]
    );

    await expect(
      pool.query(
        "INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [crypto.randomUUID(), accountId, "OwczyTwo", "owczytwo", appearance, "forest-settlement-01", 360, 470]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
npm run test -w @web-mmorpg/server -- migrations.test.ts
```

Expected: compilation/module failure because `pg`, `runMigrations`, and the schema do not exist yet.

- [ ] **Step 3: Add PostgreSQL dependencies and scripts**

Run:

```bash
npm install -w @web-mmorpg/server pg argon2
npm install -D -w @web-mmorpg/server @types/pg
```

Add to `apps/server/package.json` scripts:

```json
{
  "db:migrate": "tsx src/db/migrate.ts",
  "start": "npm run db:migrate && tsx src/index.ts",
  "test": "vitest run --fileParallelism=false"
}
```

Keep the existing `dev` and `build` scripts. Server test files intentionally run serially because database integration tests reset the shared `TEST_DATABASE_URL` schema between files.

- [ ] **Step 4: Add the pool and transaction helpers**

Create `apps/server/src/db/pool.ts`:

```ts
import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000
  });
}
```

Create `apps/server/src/db/transaction.ts`:

```ts
import type { Pool, PoolClient } from "pg";

export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: Add the initial schema migration**

Create `apps/server/migrations/001_accounts_characters.sql` with these exact constraints:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  username varchar(32) NOT NULL,
  username_normalized varchar(32) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  recovery_code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_account
  ON account_sessions(account_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  nickname varchar(20) NOT NULL,
  nickname_normalized varchar(20) NOT NULL UNIQUE,
  appearance jsonb NOT NULL,
  location_id text NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  hp integer NOT NULL DEFAULT 100,
  max_hp integer NOT NULL DEFAULT 100 CHECK (max_hp > 0),
  max_ap integer NOT NULL DEFAULT 5 CHECK (max_ap > 0),
  initiative integer NOT NULL DEFAULT 10,
  severely_injured boolean NOT NULL DEFAULT false,
  deletion_requested_at timestamptz,
  deletion_effective_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (hp >= 0 AND hp <= max_hp)
);

CREATE TABLE IF NOT EXISTS character_items (
  instance_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  category text NOT NULL,
  description text NOT NULL
);

CREATE INDEX IF NOT EXISTS character_items_character_idx
  ON character_items(character_id);

CREATE TABLE IF NOT EXISTS character_equipment (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  slot text NOT NULL,
  item_instance_id uuid NOT NULL REFERENCES character_items(instance_id) ON DELETE CASCADE,
  PRIMARY KEY (character_id, slot),
  UNIQUE (item_instance_id)
);

CREATE TABLE IF NOT EXISTS character_injuries (
  character_id uuid NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  injury_kind text NOT NULL,
  PRIMARY KEY (character_id, injury_kind)
);

CREATE TABLE IF NOT EXISTS reserved_nicknames (
  nickname_normalized varchar(20) PRIMARY KEY,
  display_nickname varchar(20) NOT NULL,
  former_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reserved_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 6: Add the migration runner**

Create `apps/server/src/db/migrate.ts`:

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { createPool } from "./pool";

export async function runMigrations(pool: Pool, migrationsDir?: string): Promise<void> {
  const baseDir = migrationsDir ?? join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
  );

  const names = (await readdir(baseDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const name of names) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;

    const sql = await readFile(join(baseDir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(process.env.DATABASE_URL ?? "");
  runMigrations(pool)
    .then(() => pool.end())
    .catch(async (error) => {
      console.error("Database migration failed:", error instanceof Error ? error.message : error);
      await pool.end();
      process.exitCode = 1;
    });
}
```

- [ ] **Step 7: Give CI a real PostgreSQL service and verify GREEN**

Update `.github/workflows/feature-ci.yml` job:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: web_mmorpg_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U postgres"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5

env:
  TEST_DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/web_mmorpg_test
```

Run locally when PostgreSQL is available, then rely on feature CI for authoritative integration verification:

```bash
npm run test -w @web-mmorpg/server -- migrations.test.ts
npm run build -w @web-mmorpg/server
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/package.json package-lock.json apps/server/src/db apps/server/migrations apps/server/tests/db .github/workflows/feature-ci.yml
git commit -m "feat: add postgres persistence foundation"
```

---

### Task 2: Credential Rules, Secret Generation, and Authentication Rate Limiting

**Files:**
- Create: `apps/server/src/auth/credentials.ts`
- Create: `apps/server/src/auth/secrets.ts`
- Create: `apps/server/src/http/AuthRateLimiter.ts`
- Create: `apps/server/tests/credentials.test.ts`
- Create: `apps/server/tests/authRateLimiter.test.ts`

**Interfaces:**
- Produces `normalizeUsername(input: string): string`.
- Produces `validateUsername(input: string): { ok: true; normalized: string } | { ok: false; code: string }`.
- Produces `validatePassword(password: string): boolean`.
- Produces `hashPassword(password: string): Promise<string>` and `verifyPassword(hash: string, password: string): Promise<boolean>`.
- Produces `generateSessionToken(): string`, `generateRecoveryCode(): string`, and `hashOpaqueSecret(secret: string): string`.
- Produces `AuthRateLimiter.consume(key: string, now?: number): boolean`.

- [ ] **Step 1: Add RED credential tests**

Create `apps/server/tests/credentials.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword
} from "../src/auth/credentials";
import {
  generateRecoveryCode,
  generateSessionToken,
  hashOpaqueSecret
} from "../src/auth/secrets";

describe("account credentials", () => {
  it("normalizes usernames and rejects invalid characters", () => {
    expect(normalizeUsername("  Owczy_217 ")).toBe("owczy_217");
    expect(validateUsername("Owczy-217")).toEqual({ ok: true, normalized: "owczy-217" });
    expect(validateUsername("ow czy")).toMatchObject({ ok: false });
  });

  it("requires passwords between 10 and 256 characters", () => {
    expect(validatePassword("short")).toBe(false);
    expect(validatePassword("long enough password")).toBe(true);
    expect(validatePassword("x".repeat(257))).toBe(false);
  });

  it("hashes passwords with Argon2id", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("creates high-entropy opaque secrets and deterministic hashes", () => {
    const token = generateSessionToken();
    const code = generateRecoveryCode();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(code).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){6}$/);
    expect(hashOpaqueSecret(token)).toHaveLength(64);
    expect(hashOpaqueSecret(token)).toBe(hashOpaqueSecret(token));
  });
});
```

- [ ] **Step 2: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- credentials.test.ts
```

Expected: FAIL because the auth helpers do not exist.

- [ ] **Step 3: Implement username/password rules**

Create `apps/server/src/auth/credentials.ts`:

```ts
import argon2 from "argon2";

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function validateUsername(
  input: string
): { ok: true; normalized: string } | { ok: false; code: string } {
  const normalized = normalizeUsername(input);
  if (!/^[a-z0-9_-]{3,32}$/.test(normalized)) {
    return { ok: false, code: "INVALID_USERNAME" };
  }
  return { ok: true, normalized };
}

export function validatePassword(password: string): boolean {
  return password.length >= 10 && password.length <= 256;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password, { type: argon2.argon2id });
}
```

- [ ] **Step 4: Implement opaque session/recovery secrets**

Create `apps/server/src/auth/secrets.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateRecoveryCode(): string {
  return randomBytes(14)
    .toString("hex")
    .toUpperCase()
    .match(/.{4}/g)!
    .join("-");
}

export function hashOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
```

- [ ] **Step 5: Add RED limiter tests**

Create `apps/server/tests/authRateLimiter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AuthRateLimiter } from "../src/http/AuthRateLimiter";

describe("AuthRateLimiter", () => {
  it("allows five attempts per minute and rejects the sixth", () => {
    const limiter = new AuthRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i += 1) expect(limiter.consume("127.0.0.1", 0)).toBe(true);
    expect(limiter.consume("127.0.0.1", 0)).toBe(false);
    expect(limiter.consume("127.0.0.1", 60_001)).toBe(true);
  });
});
```

- [ ] **Step 6: Implement the in-memory limiter**

Create `apps/server/src/http/AuthRateLimiter.ts`:

```ts
interface RateEntry {
  startedAt: number;
  count: number;
}

export class AuthRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(private readonly config = { limit: 5, windowMs: 60_000 }) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.entries.get(key);
    if (!current || now - current.startedAt >= this.config.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }

    if (current.count >= this.config.limit) return false;
    current.count += 1;
    return true;
  }
}
```

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- credentials.test.ts authRateLimiter.test.ts
npm run build -w @web-mmorpg/server
git add apps/server/src/auth apps/server/src/http/AuthRateLimiter.ts apps/server/tests/credentials.test.ts apps/server/tests/authRateLimiter.test.ts
git commit -m "feat: add secure account credential primitives"
```

---

### Task 3: Account and Session Repositories

**Files:**
- Create: `apps/server/src/persistence/dbTypes.ts`
- Create: `apps/server/src/persistence/AccountRepository.ts`
- Create: `apps/server/src/persistence/SessionRepository.ts`
- Create: `apps/server/tests/db/accountSessionRepository.test.ts`

**Interfaces:**
- Produces `AccountRecord`.
- Produces `SessionRecord`.
- Produces `AccountRepository.create`, `findByNormalizedUsername`, `findById`, `updateCredentials`.
- Produces `SessionRepository.replaceActiveSession`, `findValidByTokenHash`, `revokeByTokenHash`, `revokeAllForAccount`.

- [ ] **Step 1: Define the common database executor**

Create `apps/server/src/persistence/dbTypes.ts`:

```ts
import type { QueryResult, QueryResultRow } from "pg";

export interface DbExecutor {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}
```

- [ ] **Step 2: Add RED repository integration tests**

Create `apps/server/tests/db/accountSessionRepository.test.ts` with a clean schema setup using `runMigrations(pool)`, then assert:

```ts
const accounts = new AccountRepository(pool);
const sessions = new SessionRepository(pool);

const account = await accounts.create({
  id: crypto.randomUUID(),
  username: "Owczy217",
  usernameNormalized: "owczy217",
  passwordHash: "password-hash",
  recoveryCodeHash: "recovery-hash"
});

expect((await accounts.findByNormalizedUsername("owczy217"))?.id).toBe(account.id);

const first = await sessions.replaceActiveSession({
  id: crypto.randomUUID(),
  accountId: account.id,
  tokenHash: "a".repeat(64),
  expiresAt: new Date(Date.now() + 60_000)
});
const second = await sessions.replaceActiveSession({
  id: crypto.randomUUID(),
  accountId: account.id,
  tokenHash: "b".repeat(64),
  expiresAt: new Date(Date.now() + 60_000)
});

expect(await sessions.findValidByTokenHash(first.tokenHash, new Date())).toBeNull();
expect((await sessions.findValidByTokenHash(second.tokenHash, new Date()))?.accountId).toBe(account.id);
```

Also insert `Owczy217` and assert creating `owczy217` fails with PostgreSQL code `23505`.

- [ ] **Step 3: Confirm RED**

```bash
npm run test -w @web-mmorpg/server -- accountSessionRepository.test.ts
```

Expected: FAIL because the repositories do not exist.

- [ ] **Step 4: Implement `AccountRepository`**

Use this public shape:

```ts
export interface AccountRecord {
  id: string;
  username: string;
  usernameNormalized: string;
  passwordHash: string;
  recoveryCodeHash: string;
  status: "active" | "banned";
}

export class AccountRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(input: {
    id: string;
    username: string;
    usernameNormalized: string;
    passwordHash: string;
    recoveryCodeHash: string;
  }): Promise<AccountRecord> {
    const result = await this.db.query<{
      id: string;
      username: string;
      username_normalized: string;
      password_hash: string;
      recovery_code_hash: string;
      status: "active" | "banned";
    }>(
      `INSERT INTO accounts
       (id, username, username_normalized, password_hash, recovery_code_hash)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, username, username_normalized, password_hash, recovery_code_hash, status`,
      [input.id, input.username, input.usernameNormalized, input.passwordHash, input.recoveryCodeHash]
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      username: row.username,
      usernameNormalized: row.username_normalized,
      passwordHash: row.password_hash,
      recoveryCodeHash: row.recovery_code_hash,
      status: row.status
    };
  }
}
```

Add `findByNormalizedUsername`, `findById`, and `updateCredentials(accountId, passwordHash, recoveryCodeHash)` using parameterized SQL and the same row mapping.

- [ ] **Step 5: Implement `SessionRepository` transactionally**

Use this public shape:

```ts
export interface SessionRecord {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class SessionRepository {
  constructor(private readonly db: DbExecutor) {}

  async replaceActiveSession(input: {
    id: string;
    accountId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    await this.db.query("SELECT id FROM accounts WHERE id = $1 FOR UPDATE", [input.accountId]);
    await this.db.query(
      "UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL",
      [input.accountId]
    );
    const result = await this.db.query<{
      id: string;
      account_id: string;
      token_hash: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `INSERT INTO account_sessions (id, account_id, token_hash, expires_at)
       VALUES ($1,$2,$3,$4)
       RETURNING id, account_id, token_hash, expires_at, revoked_at`,
      [input.id, input.accountId, input.tokenHash, input.expiresAt]
    );
    const row = result.rows[0]!;
    return {
      id: row.id,
      accountId: row.account_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at
    };
  }
}
```

Implement `findValidByTokenHash(tokenHash, now)` with:

```sql
SELECT id, account_id, token_hash, expires_at, revoked_at
FROM account_sessions
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > $2
```

Add:

```ts
async touch(sessionId: string, now: Date): Promise<void> {
  await this.db.query(
    "UPDATE account_sessions SET last_seen_at = $2 WHERE id = $1",
    [sessionId, now]
  );
}
```

Implement `revokeByTokenHash` and `revokeAllForAccount` as updates setting `revoked_at = now()`. The `SELECT ... FOR UPDATE` in `replaceActiveSession` serializes simultaneous logins for the same account so the partial unique index never leaves two current sessions.

- [ ] **Step 6: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- accountSessionRepository.test.ts
npm run build -w @web-mmorpg/server
git add apps/server/src/persistence apps/server/tests/db/accountSessionRepository.test.ts
git commit -m "feat: add account and session repositories"
```

---

### Task 4: Auth Service and REST API

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/server/src/auth/AuthService.ts`
- Create: `apps/server/src/http/httpJson.ts`
- Create: `apps/server/src/http/createApiHandler.ts`
- Create: `apps/server/tests/authService.test.ts`
- Create: `apps/server/tests/httpAuthFlow.test.ts`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Adds REST endpoints exactly: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/recover`, `GET /api/auth/session`.
- Produces shared `SessionView`, `LoginResponse`, `RegisterResponse`, `RecoverResponse`.
- Produces `AuthService.register`, `login`, `validateToken`, `logout`, `recover`.

- [ ] **Step 1: Add exact shared auth contracts**

Create `packages/shared/src/auth.ts`:

```ts
export type CharacterLifecycleSummary =
  | { state: "none" }
  | { state: "active"; characterId: string; nickname: string }
  | {
      state: "pendingDeletion";
      characterId: string;
      nickname: string;
      deletionEffectiveAt: string;
    };

export interface SessionView {
  accountUsername: string;
  character: CharacterLifecycleSummary;
}

export interface RegisterResponse {
  recoveryCode: string;
}

export interface LoginResponse {
  token: string;
  session: SessionView;
}

export interface RecoverResponse {
  recoveryCode: string;
}
```

Export it from `packages/shared/src/index.ts`.

For this task, `AuthService` returns `character: { state: "none" }`; Task 6 replaces that stub with the character lifecycle lookup.

- [ ] **Step 2: Add RED AuthService tests against the test PostgreSQL database**

Create `apps/server/tests/authService.test.ts`, reset the public schema, run migrations, and instantiate `AuthService` with a real `Pool` + `AccountRepository`. Assert:

```ts
const registration = await service.register("Owczy217", "correct horse battery");
expect(registration.recoveryCode).toMatch(/^[A-F0-9-]+$/);
expect(fakeAccounts.rows[0]?.usernameNormalized).toBe("owczy217");
expect(fakeAccounts.rows[0]?.passwordHash.startsWith("$argon2id$")).toBe(true);

const login = await service.login("OWCZY217", "correct horse battery");
expect(login.token.length).toBeGreaterThanOrEqual(40);

await service.logout(login.token);
await expect(service.validateToken(login.token)).resolves.toBeNull();
```

Add recovery assertions: old password fails after recovery, new password succeeds, and the old recovery code no longer works.

Add a simultaneous-login assertion:

```ts
const [a, b] = await Promise.all([
  service.login("Owczy217", "correct horse battery"),
  service.login("Owczy217", "correct horse battery")
]);

const valid = await Promise.all([
  service.validateToken(a.token),
  service.validateToken(b.token)
]);

expect(valid.filter(Boolean)).toHaveLength(1);
```

This verifies the account-row lock + partial unique index leave exactly one current session after a race.

- [ ] **Step 3: Implement `AuthService`**

Use a constructor that accepts `Pool`, `AccountRepository`, `CharacterLifecycleService | null`, and a session TTL. A null character lifecycle is allowed only in this intermediate task; Task 6 makes it required.

```ts
export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly accounts: AccountRepository,
    private readonly characters: CharacterLifecycleService | null = null,
    private readonly sessionTtlDays = 30
  ) {}

  async register(usernameInput: string, password: string): Promise<RegisterResponse> {
    const username = validateUsername(usernameInput);
    if (!username.ok) throw new AuthError("INVALID_USERNAME", 400);
    if (!validatePassword(password)) throw new AuthError("INVALID_PASSWORD", 400);

    const recoveryCode = generateRecoveryCode();
    await this.accounts.create({
      id: randomUUID(),
      username: usernameInput.trim(),
      usernameNormalized: username.normalized,
      passwordHash: await hashPassword(password),
      recoveryCodeHash: hashOpaqueSecret(recoveryCode)
    });

    return { recoveryCode };
  }
}
```

Implement `login` in `withTransaction`. Reject `account.status !== "active"` with `ACCOUNT_DISABLED`. Create `new SessionRepository(client)`, compute `expiresAt = new Date(Date.now() + this.sessionTtlDays * 24 * 60 * 60 * 1000)`, revoke/replace any active session, and return:

```ts
{
  accountId: account.id,
  token,
  session: {
    accountUsername: account.username,
    character: { state: "none" }
  }
}
```

Keep `accountId` internal to the service result so the HTTP layer can later notify the live connection registry; expose only `token` and `session` to the client.

Implement `validateToken` by hashing the bearer token and resolving a non-revoked, non-expired session plus account. Reject disabled accounts, and call `SessionRepository.touch(session.id, now)` after validation. Implement `logout` by token hash.

Implement `recover` transactionally and return an internal result:

```ts
{
  accountId: account.id,
  response: { recoveryCode: newRecoveryCode }
}
```

The HTTP layer sends only `result.response`; Task 8 uses the internal `accountId` to close any live socket after credential recovery. Recovery verifies account + recovery hash, replaces password/recovery hash, and revokes all sessions.

Translate duplicate-username PostgreSQL code `23505` during registration to HTTP-level `USERNAME_TAKEN` / 409 rather than leaking SQL details.

- [ ] **Step 4: Add bounded JSON helpers**

Create `apps/server/src/http/httpJson.ts`:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_BYTES = 16 * 1024;

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function bearerToken(request: IncomingMessage): string | null {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length);
}
```

- [ ] **Step 5: Add RED HTTP auth-flow test**

Create `apps/server/tests/httpAuthFlow.test.ts` that starts `createServer(createApiHandler(...))` on an ephemeral port and uses Node 22 `fetch`.

Core assertions:

```ts
const register = await fetch(baseUrl + "/api/auth/register", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://client.test" },
  body: JSON.stringify({ username: "Owczy217", password: "correct horse battery", passwordConfirmation: "correct horse battery" })
});
expect(register.status).toBe(201);
const registered = await register.json() as RegisterResponse;
expect(registered.recoveryCode).toBeTruthy();

const login = await fetch(baseUrl + "/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://client.test" },
  body: JSON.stringify({ username: "Owczy217", password: "correct horse battery" })
});
expect(login.status).toBe(200);
const loggedIn = await login.json() as LoginResponse;

const session = await fetch(baseUrl + "/api/auth/session", {
  headers: { authorization: `Bearer ${loggedIn.token}`, origin: "https://client.test" }
});
expect(session.status).toBe(200);
```

Also assert an unapproved origin receives no `access-control-allow-origin` header and the sixth rapid failed login receives HTTP 429.

- [ ] **Step 6: Implement the REST router**

Create `apps/server/src/http/createApiHandler.ts` with exact route matching. Set CORS only when:

```ts
if (request.headers.origin === clientOrigin) {
  response.setHeader("access-control-allow-origin", clientOrigin);
  response.setHeader("vary", "Origin");
}
```

Handle `OPTIONS` with status 204.

Use rate-limit key:

```ts
const ip = request.socket.remoteAddress ?? "unknown";
const rateKey = `${ip}:${request.url}`;
```

Before calling AuthService, the router compares confirmation fields exactly:

```ts
if (body.password !== body.passwordConfirmation) {
  sendJson(response, 400, { code: "PASSWORD_MISMATCH", message: "Passwords do not match." });
  return;
}
```

Use the same check for `newPassword` / `passwordConfirmation` in recovery.

On `/api/auth/register`, `/api/auth/login`, and `/api/auth/recover`, reject when `!limiter.consume(rateKey)`:

```ts
sendJson(response, 429, { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." });
```

Map `REQUEST_TOO_LARGE` to HTTP 413, malformed JSON to HTTP 400, and AuthError codes to JSON `{ code, message }` without exposing hashes, tokens, SQL, or stack traces.

- [ ] **Step 7: Wire HTTP + Socket.IO onto the same Node server**

Change `apps/server/src/index.ts` to:

```ts
import { createServer } from "node:http";
import { createPool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { AccountRepository } from "./persistence/AccountRepository";
import { AuthService } from "./auth/AuthService";
import { createApiHandler } from "./http/createApiHandler";
import { createGameServer } from "./server/createGameServer";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL ?? "";
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

const pool = createPool(databaseUrl);
await runMigrations(pool);

const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 30);
const authService = new AuthService(pool, new AccountRepository(pool), null, sessionTtlDays);
const httpServer = createServer(createApiHandler({ authService, clientOrigin }));
createGameServer(httpServer);

httpServer.listen(port, host, () => {
  console.log(`WEB MMORPG server listening on http://${host}:${port}`);
});
```

This is an intermediate composition; Tasks 6–8 pass character lifecycle and the live connection registry into both API and game server.

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- authService.test.ts httpAuthFlow.test.ts
npm run test -w @web-mmorpg/shared
npm run build
git add packages/shared/src apps/server/src/auth apps/server/src/http apps/server/src/index.ts apps/server/tests/authService.test.ts apps/server/tests/httpAuthFlow.test.ts
git commit -m "feat: add account registration login and recovery api"
```

---

### Task 5: Client Account Session Flow

**Files:**
- Create: `apps/client/src/net/ApiClient.ts`
- Create: `apps/client/src/state/AuthSessionStore.ts`
- Create: `apps/client/src/scenes/AuthScene.ts`
- Modify: `apps/client/src/scenes/BootScene.ts`
- Modify: `apps/client/src/game/config.ts`
- Delete: `apps/client/src/scenes/LoginScene.ts`
- Modify: `apps/client/src/style.css`
- Create: `apps/client/tests/authSessionStore.test.ts`

**Interfaces:**
- Produces `apiClient.register/login/logout/recover/getSession`.
- Produces `AuthSessionStore.getToken/setAuthenticated/clear`.
- Boot routes unauthenticated users to `AuthScene`.
- Registration/recovery shows the one-time recovery code before returning to login.

- [ ] **Step 1: Add RED token-store tests**

Create `apps/client/tests/authSessionStore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AuthSessionStore, type StorageLike } from "../src/state/AuthSessionStore";

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

it("stores and clears the 30-day bearer token", () => {
  const store = new AuthSessionStore(new MemoryStorage());
  store.setToken("abc");
  expect(store.getToken()).toBe("abc");
  store.clear();
  expect(store.getToken()).toBeNull();
});
```

- [ ] **Step 2: Implement `AuthSessionStore`**

Create `apps/client/src/state/AuthSessionStore.ts`:

```ts
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const TOKEN_KEY = "web-mmorpg.session-token";

export class AuthSessionStore {
  constructor(private readonly storage: StorageLike = window.localStorage) {}

  getToken(): string | null {
    return this.storage.getItem(TOKEN_KEY);
  }

  setToken(token: string): void {
    this.storage.setItem(TOKEN_KEY, token);
  }

  clear(): void {
    this.storage.removeItem(TOKEN_KEY);
  }
}

export const authSessionStore = new AuthSessionStore();
```

- [ ] **Step 3: Implement the typed REST client**

Create `apps/client/src/net/ApiClient.ts`. Use `VITE_GAME_SERVER_URL` as the API base:

```ts
import type {
  LoginResponse,
  RecoverResponse,
  RegisterResponse,
  SessionView
} from "@web-mmorpg/shared";
import { authSessionStore } from "../state/AuthSessionStore";

const baseUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = authSessionStore.getToken();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(baseUrl + path, { ...init, headers });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const code = typeof body?.code === "string" ? body.code : "REQUEST_FAILED";
    const message = typeof body?.message === "string" ? body.message : "Request failed.";
    throw Object.assign(new Error(message), { code, status: response.status });
  }
  return body as T;
}
```

Expose `register`, `login`, `logout`, `recover`, `getSession`. `login` stores `response.token`; `logout` clears the token in a `finally` block.

- [ ] **Step 4: Replace nickname login with account UI**

Create `AuthScene` with four modes: `login | register | recover | recoveryCode`.

The login submit handler must call:

```ts
const result = await apiClient.login(username, password);
this.routeSession(result.session);
```

Registration must call:

```ts
const result = await apiClient.register(username, password, passwordConfirmation);
this.showRecoveryCode(result.recoveryCode, "Your recovery code");
```

Recovery must call:

```ts
const result = await apiClient.recover(username, recoveryCode, newPassword, passwordConfirmation);
authSessionStore.clear();
this.showRecoveryCode(result.recoveryCode, "New recovery code");
```

The one-time-code screen must render the code as text content, never via dynamic `innerHTML`, and require an explicit `I saved this code` button before returning to login.

For this task, `routeSession` sends `none` to a temporary message in AuthScene and `active` to `WorldScene`; Task 6 replaces `none` with CharacterCreatorScene.

- [ ] **Step 5: Make Boot restore or reject the saved session**

Update `BootScene.create`:

```ts
create(): void {
  void this.route();
}

private async route(): Promise<void> {
  const token = authSessionStore.getToken();
  if (!token) {
    this.scene.start("AuthScene");
    return;
  }

  try {
    const session = await apiClient.getSession();
    if (session.character.state === "active") {
      this.scene.start("WorldScene", { playerId: session.character.characterId });
      return;
    }
    this.scene.start("AuthScene");
  } catch {
    authSessionStore.clear();
    this.scene.start("AuthScene");
  }
}
```

- [ ] **Step 6: Register scenes and remove `LoginScene`**

Update `apps/client/src/game/config.ts` to use:

```ts
scene: [BootScene, AuthScene, WorldScene, BattleScene]
```

Delete `LoginScene.ts`.

Add auth form styles to `style.css` using the existing panel visual language and minimum 44px button/input hit targets.

- [ ] **Step 7: Verify and commit**

```bash
npm run test -w @web-mmorpg/client -- authSessionStore.test.ts
npm run build -w @web-mmorpg/client
git add apps/client/src apps/client/tests/authSessionStore.test.ts
git commit -m "feat: add persistent client account session flow"
```

---

### Task 6: Character Appearance Contracts, Character Repository, and Lifecycle API

**Files:**
- Create: `packages/shared/src/appearance.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/character.ts`
- Modify: `packages/shared/src/world.ts`
- Create: `apps/server/src/character/nickname.ts`
- Create: `apps/server/src/persistence/CharacterRepository.ts`
- Create: `apps/server/src/character/CharacterLifecycleService.ts`
- Modify: `apps/server/src/auth/AuthService.ts`
- Modify: `apps/server/src/http/createApiHandler.ts`
- Create: `apps/server/tests/characterLifecycleService.test.ts`
- Create: `apps/server/tests/db/characterRepository.test.ts`

**Interfaces:**
- Adds `AppearanceSelection`, `APPEARANCE_CATALOG`, `isAppearanceSelection`.
- Adds `CharacterProfile`.
- Adds REST `POST /api/character` and `GET /api/character`.
- `GET /api/auth/session` now reports the real lifecycle state.
- Produces stable character IDs that become gameplay `PlayerId` values.

- [ ] **Step 1: Add the shared appearance catalog**

Create `packages/shared/src/appearance.ts`:

```ts
export const APPEARANCE_CATALOG = {
  bodyType: ["body-01", "body-02"],
  skinTone: ["skin-01", "skin-02", "skin-03", "skin-04"],
  face: ["face-01", "face-02", "face-03", "face-04"],
  eyes: ["eyes-01", "eyes-02", "eyes-03"],
  hair: ["hair-01", "hair-02", "hair-03", "hair-04", "hair-05"],
  hairColor: ["hair-color-01", "hair-color-02", "hair-color-03", "hair-color-04"],
  facialHair: ["facial-hair-none", "facial-hair-01", "facial-hair-02"],
  marking: ["marking-none", "scar-01", "scar-02", "tattoo-01"],
  startingOutfit: ["outfit-01", "outfit-02", "outfit-03"]
} as const;

export interface AppearanceSelection {
  bodyType: string;
  skinTone: string;
  face: string;
  eyes: string;
  hair: string;
  hairColor: string;
  facialHair: string;
  marking: string;
  startingOutfit: string;
}

export function isAppearanceSelection(value: unknown): value is AppearanceSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (Object.keys(APPEARANCE_CATALOG) as Array<keyof typeof APPEARANCE_CATALOG>)
    .every((key) =>
      typeof candidate[key] === "string" &&
      (APPEARANCE_CATALOG[key] as readonly string[]).includes(candidate[key] as string)
    );
}
```

Export it from `index.ts`.

Extend `CharacterSnapshot` with `appearance: AppearanceSelection`. Extend `WorldPlayerSnapshot` with `appearance: AppearanceSelection`.

- [ ] **Step 2: Add nickname validation**

Create `apps/server/src/character/nickname.ts`:

```ts
export function normalizeNickname(input: string): string {
  return input.trim().toLowerCase();
}

export function validateNickname(
  input: string
): { ok: true; normalized: string; display: string } | { ok: false; code: string } {
  const display = input.trim();
  const normalized = normalizeNickname(display);
  if (display.length < 3 || display.length > 20 || !/^[\p{L}\p{N}_-]+$/u.test(display)) {
    return { ok: false, code: "INVALID_NICKNAME" };
  }
  return { ok: true, normalized, display };
}
```

- [ ] **Step 3: Add RED repository tests**

In `characterRepository.test.ts`, create an account and assert:

```ts
const character = await repository.create({
  id: crypto.randomUUID(),
  accountId,
  nickname: "Owczy",
  nicknameNormalized: "owczy",
  appearance,
  locationId: "forest-settlement-01",
  x: 360,
  y: 470
});

expect(character.nickname).toBe("Owczy");
expect((await repository.findByAccountId(accountId))?.id).toBe(character.id);
expect((await repository.findById(character.id))?.appearance).toEqual(appearance);
```

Then assert another account cannot create nickname `owczy` due to unique normalized nickname.

- [ ] **Step 4: Implement `CharacterRepository`**

Use a `PersistedCharacterRecord` containing:

```ts
export interface PersistedCharacterRecord {
  id: string;
  accountId: string;
  nickname: string;
  nicknameNormalized: string;
  appearance: AppearanceSelection;
  locationId: string;
  x: number;
  y: number;
  level: number;
  hp: number;
  maxHp: number;
  maxAp: number;
  initiative: number;
  severelyInjured: boolean;
  deletionRequestedAt: Date | null;
  deletionEffectiveAt: Date | null;
}
```

Implement `create`, `findByAccountId`, `findById`, and `findByNormalizedNickname` with parameterized SQL.

- [ ] **Step 5: Add RED lifecycle service tests**

Create `characterLifecycleService.test.ts` and assert:

```ts
expect(await service.getLifecycle(accountId, now)).toEqual({ state: "none" });

const created = await service.createCharacter(accountId, {
  nickname: "Owczy",
  appearance
});

expect(created.nickname).toBe("Owczy");
expect(await service.getLifecycle(accountId, now)).toMatchObject({
  state: "active",
  characterId: created.id,
  nickname: "Owczy"
});

await expect(
  service.createCharacter(accountId, { nickname: "Second", appearance })
).rejects.toMatchObject({ code: "CHARACTER_ALREADY_EXISTS" });
```

Also assert invalid appearance IDs are rejected.

- [ ] **Step 6: Implement `CharacterLifecycleService.createCharacter` transactionally**

Use the canonical spawn constants from `worldFixtures.ts`, not duplicated numbers in service logic:

```ts
const nickname = validateNickname(input.nickname);
if (!nickname.ok) throw new CharacterLifecycleError(nickname.code, 400);
if (!isAppearanceSelection(input.appearance)) {
  throw new CharacterLifecycleError("INVALID_APPEARANCE", 400);
}

return withTransaction(this.pool, async (client) => {
  const characters = new CharacterRepository(client);
  if (await characters.findByAccountId(accountId)) {
    throw new CharacterLifecycleError("CHARACTER_ALREADY_EXISTS", 409);
  }

  return characters.create({
    id: randomUUID(),
    accountId,
    nickname: nickname.display,
    nicknameNormalized: nickname.normalized,
    appearance: input.appearance,
    locationId: FOREST_SETTLEMENT_01.id,
    x: FOREST_SETTLEMENT_01.spawn.x,
    y: FOREST_SETTLEMENT_01.spawn.y
  });
});
```

Translate PostgreSQL `23505` on `nickname_normalized` into `NICKNAME_TAKEN`.

- [ ] **Step 7: Return real character lifecycle from auth/session endpoints**

Inject `CharacterLifecycleService` into `AuthService`.

Replace the Task 4 `{ state: "none" }` stub with:

```ts
character: await this.characters.getLifecycle(account.id, new Date())
```

Add authenticated routes to `createApiHandler`:

```text
GET  /api/character
POST /api/character
```

`POST /api/character` reads `{ nickname, appearance }`, resolves the account via bearer token, creates the character, and returns HTTP 201.

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- characterRepository.test.ts characterLifecycleService.test.ts httpAuthFlow.test.ts
npm run test -w @web-mmorpg/shared
npm run build
git add packages/shared/src apps/server/src/character apps/server/src/persistence/CharacterRepository.ts apps/server/src/auth/AuthService.ts apps/server/src/http/createApiHandler.ts apps/server/tests
git commit -m "feat: add persistent single-character lifecycle"
```

---

### Task 7: Character Creator UI and Shared Appearance Rendering

**Files:**
- Create: `apps/client/src/appearance/appearanceVisuals.ts`
- Create: `apps/client/src/appearance/CharacterPreview.ts`
- Create: `apps/client/src/scenes/CharacterCreatorScene.ts`
- Modify: `apps/client/src/net/ApiClient.ts`
- Modify: `apps/client/src/scenes/BootScene.ts`
- Modify: `apps/client/src/scenes/AuthScene.ts`
- Modify: `apps/client/src/game/config.ts`
- Modify: `apps/client/src/world/WorldEntitiesRenderer.ts`
- Modify: `apps/client/src/style.css`
- Create: `apps/client/tests/appearanceVisuals.test.ts`

**Interfaces:**
- Produces `appearanceVisuals(selection)` used by both creator preview and world avatars.
- Adds `apiClient.createCharacter`.
- Routes `character.state === "none"` to `CharacterCreatorScene`.

- [ ] **Step 1: Add RED appearance-visual mapping tests**

Create `appearanceVisuals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appearanceVisuals } from "../src/appearance/appearanceVisuals";

it("maps saved appearance IDs to stable creator/world visuals", () => {
  expect(appearanceVisuals({
    bodyType: "body-01",
    skinTone: "skin-02",
    face: "face-01",
    eyes: "eyes-01",
    hair: "hair-04",
    hairColor: "hair-color-03",
    facialHair: "facial-hair-none",
    marking: "scar-01",
    startingOutfit: "outfit-02"
  })).toEqual({
    bodyScale: 1,
    faceScaleX: 1,
    eyeSpacing: 8,
    eyeRadius: 2,
    skin: "#c98f65",
    hairColor: "#8b5a2b",
    hairStyle: "hair-04",
    facialHairStyle: "facial-hair-none",
    outfit: "#405a74",
    marking: "scar-01"
  });
});
```

- [ ] **Step 2: Implement one visual mapping shared by both renderers**

Create `appearanceVisuals.ts` with fixed maps:

```ts
const skin = {
  "skin-01": "#f0c7a5",
  "skin-02": "#c98f65",
  "skin-03": "#9b6548",
  "skin-04": "#684331"
} as const;

const hair = {
  "hair-color-01": "#2a211d",
  "hair-color-02": "#6a4329",
  "hair-color-03": "#8b5a2b",
  "hair-color-04": "#d1b06f"
} as const;

const outfit = {
  "outfit-01": "#56634f",
  "outfit-02": "#405a74",
  "outfit-03": "#694957"
} as const;

const faceScaleX = {
  "face-01": 1,
  "face-02": 0.9,
  "face-03": 1.08,
  "face-04": 0.96
} as const;

const eyes = {
  "eyes-01": { spacing: 8, radius: 2 },
  "eyes-02": { spacing: 10, radius: 2 },
  "eyes-03": { spacing: 8, radius: 3 }
} as const;

export function appearanceVisuals(selection: AppearanceSelection) {
  const eye = eyes[selection.eyes as keyof typeof eyes] ?? eyes["eyes-01"];
  return {
    bodyScale: selection.bodyType === "body-02" ? 1.08 : 1,
    faceScaleX: faceScaleX[selection.face as keyof typeof faceScaleX] ?? 1,
    eyeSpacing: eye.spacing,
    eyeRadius: eye.radius,
    skin: skin[selection.skinTone as keyof typeof skin] ?? skin["skin-01"],
    hairColor: hair[selection.hairColor as keyof typeof hair] ?? hair["hair-color-01"],
    hairStyle: selection.hair,
    facialHairStyle: selection.facialHair,
    outfit: outfit[selection.startingOutfit as keyof typeof outfit] ?? outfit["outfit-01"],
    marking: selection.marking
  };
}
```

- [ ] **Step 3: Add the creator REST call**

Add to `ApiClient`:

```ts
async createCharacter(input: {
  nickname: string;
  appearance: AppearanceSelection;
}): Promise<CharacterProfile> {
  return requestJson<CharacterProfile>("/api/character", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
```

Add `CharacterProfile` to shared contracts if not already included in Task 6:

```ts
export interface CharacterProfile {
  id: string;
  nickname: string;
  appearance: AppearanceSelection;
}
```

- [ ] **Step 4: Build `CharacterPreview` with safe DOM nodes**

Create `CharacterPreview.ts` that uses `appearanceVisuals` and sets CSS custom properties:

```ts
export class CharacterPreview {
  readonly element = document.createElement("div");

  constructor() {
    this.element.className = "character-preview";
    const body = document.createElement("div");
    body.className = "character-preview__body";
    const hair = document.createElement("div");
    hair.className = "character-preview__hair";
    this.element.append(body, hair);
  }

  render(selection: AppearanceSelection): void {
    const visuals = appearanceVisuals(selection);
    this.element.style.setProperty("--avatar-skin", visuals.skin);
    this.element.style.setProperty("--avatar-hair", visuals.hairColor);
    this.element.style.setProperty("--avatar-outfit", visuals.outfit);
    this.element.style.setProperty("--avatar-scale", String(visuals.bodyScale));
    this.element.style.setProperty("--avatar-face-scale-x", String(visuals.faceScaleX));
    this.element.style.setProperty("--avatar-eye-spacing", `${visuals.eyeSpacing}px`);
    this.element.style.setProperty("--avatar-eye-radius", `${visuals.eyeRadius}px`);
    this.element.dataset.hairStyle = visuals.hairStyle;
    this.element.dataset.facialHairStyle = visuals.facialHairStyle;
    this.element.dataset.marking = visuals.marking;
  }
}
```

- [ ] **Step 5: Build `CharacterCreatorScene`**

Initialize the default selection from the first value of every `APPEARANCE_CATALOG` list.

For each catalog field, render Previous/Next controls that cycle only through allowed IDs. The submit handler is:

```ts
try {
  const character = await apiClient.createCharacter({
    nickname: nicknameInput.value,
    appearance: { ...this.selection }
  });
  this.destroyForm();
  this.scene.start("WorldScene", { playerId: character.id });
} catch (error) {
  errorElement.textContent = error instanceof Error ? error.message : "Could not create character.";
}
```

Use `textContent` for all dynamic text.

- [ ] **Step 6: Route authenticated users correctly**

In both Boot and AuthScene:

```ts
if (session.character.state === "none") {
  this.scene.start("CharacterCreatorScene");
  return;
}
if (session.character.state === "active") {
  this.scene.start("WorldScene", { playerId: session.character.characterId });
  return;
}
this.scene.start("CharacterDeletionScene", { session });
```

Task 11 creates the deletion scene; until then route pending deletion back to AuthScene with a clear non-playable message.

Register `CharacterCreatorScene` in game config.

- [ ] **Step 7: Make in-world avatars reflect persisted appearance**

Update `WorldEntitiesRenderer.createPlayer` to call `appearanceVisuals(player.appearance)`.

Body type, skin tone, face shape, eye style, hairstyle, hair color, facial hair, marking, and outfit must each create a visible difference. Preserve the existing local-vs-remote outline distinction. Add small focused helpers `createHairGraphic`, `createFacialHairGraphic`, and `createMarkingGraphic` in `appearanceVisuals.ts` or a sibling renderer helper; each helper switches only over the finite catalog IDs and returns Phaser display objects. Use:

```ts
const visuals = appearanceVisuals(player.appearance);
const face = this.scene.add.ellipse(
  0,
  -6,
  34 * visuals.bodyScale * visuals.faceScaleX,
  36 * visuals.bodyScale,
  visuals.skin
);
const outfit = this.scene.add.rectangle(0, 18, 30 * visuals.bodyScale, 22, visuals.outfit);
const leftEye = this.scene.add.circle(-visuals.eyeSpacing, -8, visuals.eyeRadius, 0x1b1b1b);
const rightEye = this.scene.add.circle(visuals.eyeSpacing, -8, visuals.eyeRadius, 0x1b1b1b);
const hair = createHairGraphic(this.scene, visuals.hairStyle, visuals.hairColor, visuals.bodyScale);
const facialHair = createFacialHairGraphic(
  this.scene,
  visuals.facialHairStyle,
  visuals.hairColor,
  visuals.bodyScale
);
const marking = createMarkingGraphic(this.scene, visuals.marking, visuals.bodyScale);
```

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/client -- appearanceVisuals.test.ts
npm run build -w @web-mmorpg/client
git add apps/client/src apps/client/tests/appearanceVisuals.test.ts packages/shared/src
git commit -m "feat: add first-login character creator"
```

---

### Task 8: Authenticated Socket.IO and Single Live Character Session

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Create: `apps/server/src/server/ActiveConnectionRegistry.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/client/src/net/GameSocket.ts`
- Modify: `apps/client/src/scenes/BootScene.ts`
- Modify: `apps/client/src/ui/WorldHud.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`
- Create: `apps/server/tests/helpers/testApp.ts`
- Create: `apps/server/tests/helpers/battleTestHelpers.ts`
- Create: `apps/server/tests/activeConnectionRegistry.test.ts`

**Interfaces:**
- Removes the nickname-based Socket.IO `login` event.
- Socket handshake consumes `auth: { token: string }`.
- Adds `sessionReplaced: () => void`.
- `ActiveConnectionRegistry.closeAccount(accountId, reason)` flushes/removes the previous live character for replacement, logout, recovery, or deletion before state changes complete.

- [ ] **Step 1: Change the shared socket protocol**

Remove:

```ts
login: (payload: { nickname: string }, ack: (result: LoginResult) => void) => void;
```

Remove `LoginResult`.

Add to `ServerToClientEvents`:

```ts
sessionReplaced: () => void;
```

All gameplay event payloads remain unchanged.

- [ ] **Step 2: Add RED connection-registry tests**

Create `activeConnectionRegistry.test.ts`:

```ts
it("flushes and closes the previous live connection before replacement", async () => {
  const calls: string[] = [];
  const registry = new ActiveConnectionRegistry();

  registry.attach("account-1", {
    async close(reason) {
      calls.push(`old:flush:${reason}`);
    }
  });

  await registry.closeAccount("account-1", "sessionReplaced");
  expect(calls).toEqual(["old:flush:sessionReplaced"]);
  expect(registry.has("account-1")).toBe(false);
});
```

- [ ] **Step 3: Implement `ActiveConnectionRegistry`**

```ts
export type CloseReason = "sessionReplaced" | "logout" | "credentialsChanged" | "characterDeletion";

export interface ActiveConnection {
  close(reason: CloseReason): Promise<void>;
}

export class ActiveConnectionRegistry {
  private readonly connections = new Map<string, ActiveConnection>();

  attach(accountId: string, connection: ActiveConnection): void {
    this.connections.set(accountId, connection);
  }

  detach(accountId: string, connection: ActiveConnection): void {
    if (this.connections.get(accountId) === connection) this.connections.delete(accountId);
  }

  async closeAccount(accountId: string, reason: CloseReason): Promise<void> {
    const existing = this.connections.get(accountId);
    if (!existing) return;
    await existing.close(reason);
    if (this.connections.get(accountId) === existing) this.connections.delete(accountId);
  }

  has(accountId: string): boolean {
    return this.connections.has(accountId);
  }
}
```

- [ ] **Step 4: Authenticate before gameplay handlers are installed**

Change `createGameServer` signature:

```ts
export function createGameServer(
  httpServer: HttpServer,
  deps: {
    authService: AuthService;
    characters: CharacterLifecycleService;
    activeConnections: ActiveConnectionRegistry;
  }
)
```

Add Socket.IO middleware:

```ts
io.use(async (socket, next) => {
  try {
    const token = typeof socket.handshake.auth.token === "string"
      ? socket.handshake.auth.token
      : "";
    const auth = await deps.authService.validateToken(token);
    if (!auth) {
      next(new Error("UNAUTHORIZED"));
      return;
    }

    socket.data.accountId = auth.account.id;
    socket.data.token = token;
    next();
  } catch {
    next(new Error("UNAUTHORIZED"));
  }
});
```

On connection, resolve the account's active character. If lifecycle is not `active`, disconnect the socket because creator/deletion states do not enter the game world.

Before hydrating the new socket:

```ts
await deps.activeConnections.closeAccount(accountId, "sessionReplaced");
```

Attach the socket to the registry with a concrete close implementation:

```ts
const activeConnection: ActiveConnection = {
  async close(reason) {
    if (reason === "sessionReplaced") socket.emit("sessionReplaced");
    battles.removeBattleForPlayer(playerId);
    world.removePlayer(playerId);
    inventory.removePlayer(playerId);
    characters.removePlayer(playerId);
    socket.disconnect(true);
  }
};
deps.activeConnections.attach(accountId, activeConnection);
```

On normal disconnect call `deps.activeConnections.detach(accountId, activeConnection)`.

Task 9 inserts the durable position flush before runtime removal in this same `close` method. For this task, use existing runtime creation but stable character ID and persisted nickname/appearance from CharacterRepository.

- [ ] **Step 5: Make login REST actively replace the previous live session**

Pass `ActiveConnectionRegistry` into `createApiHandler`.

After `authService.login` successfully commits the replacement session and before sending HTTP 200:

```ts
await activeConnections.closeAccount(result.accountId, "sessionReplaced");
sendJson(response, 200, { token: result.token, session: result.session });
```

This satisfies "new login logs out previous device" even before the new device opens a socket.

For `POST /api/auth/logout`, validate the token first, call `closeAccount(account.id, "logout")` so the socket flushes/removes the player, then revoke the token and return 204.

For successful `POST /api/auth/recover`, call `closeAccount(result.accountId, "credentialsChanged")` after the recovery transaction commits, then send only `result.response`, so any old live socket is removed immediately. Do not emit `sessionReplaced` for intentional logout; only the `sessionReplaced` reason emits that client event.

- [ ] **Step 6: Change the client socket to bearer authentication**

Replace `GameSocket.login` entirely.

Change `connect`:

```ts
connect(token = authSessionStore.getToken()): GameClientSocket {
  if (!token) throw new Error("AUTH_TOKEN_REQUIRED");
  if (this.socket) return this.socket;

  const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
  const socket = io(serverUrl, {
    transports: ["websocket"],
    auth: { token }
  });
  this.socket = socket;

  socket.on("sessionReplaced", () => {
    authSessionStore.clear();
    socket.disconnect();
    this.socket = null;
    window.location.reload();
  });

  return socket;
}
```

Add `disconnect()` that disconnects and clears `this.socket`.

Add a `Wyloguj` action to `WorldHud`. Its handler calls `apiClient.logout()`; the server-side logout route flushes/closes the live socket before revoking the session, and the client then clears local auth state and reloads to Boot/AuthScene.

- [ ] **Step 7: Rewrite Socket.IO E2E setup around real accounts/characters**

Create `apps/server/tests/helpers/testApp.ts` exporting this concrete harness interface:

```ts
export interface TestApp {
  baseUrl: string;
  pool: Pool;
  game: ReturnType<typeof createGameServer>;
  register(username: string, password?: string): Promise<RegisterResponse>;
  login(username: string, password?: string): Promise<LoginResponse>;
  createCharacter(token: string, nickname: string, appearance?: AppearanceSelection): Promise<CharacterProfile>;
  connectSocket(token: string): Promise<Socket>;
  close(): Promise<void>;
}

export async function startTestApp(): Promise<TestApp>;
```

`startTestApp` resets the test schema, runs migrations, composes the same AuthService/CharacterLifecycleService/ActiveConnectionRegistry/API/GameServer dependencies as production, listens on an ephemeral port, and tracks sockets for cleanup.

Its `connectSocket` implementation is:

```ts
const socket = createClient(baseUrl, {
  transports: ["websocket"],
  forceNew: true,
  auth: { token }
});
await new Promise<void>((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});
return socket;
```

In `apps/server/tests/helpers/testApp.ts`, also export:

```ts
export const defaultAppearance: AppearanceSelection = {
  bodyType: "body-01",
  skinTone: "skin-01",
  face: "face-01",
  eyes: "eyes-01",
  hair: "hair-01",
  hairColor: "hair-color-01",
  facialHair: "facial-hair-none",
  marking: "marking-none",
  startingOutfit: "outfit-01"
};
```

Create `apps/server/tests/helpers/battleTestHelpers.ts` and move/export the existing concrete `onceWithTimeout`, `choosePlayerCommand`, and `winBattle` helpers from `socketFlow.test.ts` without changing their battle logic:

```ts
export function onceWithTimeout<T>(
  socket: Socket,
  event: string,
  timeoutMs = 1000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
```

`choosePlayerCommand` keeps the exact current hex-distance/LOS/path logic, and `winBattle` keeps the current 40-step guard and waits for `battleEnded`.

Update `socketFlow.test.ts` to import these helpers and use `startTestApp()` rather than nickname login.

Preserve the existing multiplayer assertion that two different accounts see both characters.

Add a new test:

```ts
it("disconnects the old live character when the same account logs in again", async () => {
  const firstToken = await loginAccount("same-account");
  const first = await connectClient(firstToken);
  const replaced = onceWithTimeout<void>(first, "sessionReplaced");

  await loginAccount("same-account");

  await replaced;
  expect(first.connected).toBe(false);
});
```

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- activeConnectionRegistry.test.ts socketFlow.test.ts
npm run test -w @web-mmorpg/shared
npm run build
git add packages/shared/src/protocol.ts apps/server/src/server apps/server/src/http/createApiHandler.ts apps/server/src/index.ts apps/server/tests apps/client/src/net/GameSocket.ts
git commit -m "feat: authenticate game sockets with account sessions"
```

---

### Task 9: Runtime Hydration and Durable Position Checkpoints

**Files:**
- Modify: `apps/server/src/world/WorldService.ts`
- Modify: `apps/server/src/character/CharacterService.ts`
- Modify: `apps/server/src/inventory/InventoryService.ts`
- Add: `apps/server/src/persistence/PositionPersistenceCoordinator.ts`
- Modify: `apps/server/src/persistence/CharacterRepository.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/tests/worldService.test.ts`
- Create: `apps/server/tests/positionPersistenceCoordinator.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- `WorldService.addPlayer` accepts saved location/x/y/appearance rather than forcing spawn.
- `CharacterService.hydratePlayer(snapshot)`.
- `InventoryService.hydratePlayer(playerId, snapshot)`.
- `CharacterRepository.updatePosition(characterId, locationId, x, y)`.
- `PositionPersistenceCoordinator.markDirty/flushPlayer/start/stop`.

- [ ] **Step 1: Add RED world hydration test**

Update `worldService.test.ts`:

```ts
it("hydrates a player at persisted coordinates instead of the canonical spawn", () => {
  const world = new WorldService();
  world.addPlayer({
    id: "p1",
    nickname: "Owczy",
    appearance: defaultAppearance,
    locationId: "forest-settlement-01",
    x: 845,
    y: 612
  }, 0);

  expect(world.getPlayer("p1")).toMatchObject({ x: 845, y: 612 });
});
```

- [ ] **Step 2: Change `WorldService.addPlayer`**

Use:

```ts
addPlayer(input: {
  id: PlayerId;
  nickname: string;
  appearance: AppearanceSelection;
  locationId: LocationId;
  x: number;
  y: number;
}, now = Date.now()): WorldPlayerSnapshot {
  const player: WorldPlayerState = {
    ...input,
    lastMoveAt: now
  };
  this.players.set(input.id, player);
  return this.toSnapshot(player);
}
```

Add:

```ts
getPersistenceState(playerId: PlayerId): {
  locationId: LocationId;
  x: number;
  y: number;
} | undefined {
  const player = this.players.get(playerId);
  return player
    ? { locationId: player.locationId, x: player.x, y: player.y }
    : undefined;
}
```

Include `appearance` in world snapshots.

- [ ] **Step 3: Add runtime hydration methods**

In `CharacterService`:

```ts
hydratePlayer(snapshot: CharacterSnapshot): CharacterSnapshot {
  this.characters.set(snapshot.playerId, this.clone(snapshot));
  return this.clone(snapshot);
}
```

In `InventoryService`:

```ts
hydratePlayer(playerId: PlayerId, snapshot: InventorySnapshot): InventorySnapshot {
  this.inventories.set(playerId, snapshot.items.map((item) => ({ ...item })));
  return this.getSnapshot(playerId);
}
```

Stop using `createPlayer` for authenticated persistent characters.

- [ ] **Step 4: Add repository position update**

```ts
async updatePosition(
  characterId: string,
  locationId: string,
  x: number,
  y: number
): Promise<void> {
  await this.db.query(
    `UPDATE characters
     SET location_id = $2, x = $3, y = $4, updated_at = now()
     WHERE id = $1`,
    [characterId, locationId, x, y]
  );
}
```

- [ ] **Step 5: Add RED checkpoint coordinator tests**

Use a fake world + fake repository:

```ts
it("writes only dirty player positions and clears them after flush", async () => {
  const writes: unknown[] = [];
  const coordinator = new PositionPersistenceCoordinator({
    intervalMs: 2000,
    readPosition: () => ({ locationId: "forest-settlement-01", x: 500, y: 400 }),
    writePosition: async (playerId, state) => writes.push({ playerId, ...state })
  });

  coordinator.markDirty("p1");
  await coordinator.flushDirty();
  await coordinator.flushDirty();

  expect(writes).toHaveLength(1);
});
```

- [ ] **Step 6: Implement `PositionPersistenceCoordinator`**

```ts
export class PositionPersistenceCoordinator {
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: {
    intervalMs: number;
    readPosition(playerId: string): { locationId: string; x: number; y: number } | undefined;
    writePosition(playerId: string, state: { locationId: string; x: number; y: number }): Promise<void>;
  }) {}

  markDirty(playerId: string): void {
    this.dirty.add(playerId);
  }

  async flushPlayer(playerId: string): Promise<void> {
    const state = this.deps.readPosition(playerId);
    if (!state) {
      this.dirty.delete(playerId);
      return;
    }
    await this.deps.writePosition(playerId, state);
    this.dirty.delete(playerId);
  }

  async flushDirty(): Promise<void> {
    for (const playerId of [...this.dirty]) await this.flushPlayer(playerId);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flushDirty(), this.deps.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushDirty();
  }
}
```

- [ ] **Step 7: Wire dirty marking and forced flushes**

After every accepted `world.movePlayer`:

```ts
positions.markDirty(playerId);
```

Before removing a player on socket disconnect:

```ts
await positions.flushPlayer(playerId);
```

Also flush on battle entry, battle exit, and defeat reset.

Start the coordinator from the server composition with:

```ts
const checkpointMs = Number(process.env.POSITION_CHECKPOINT_MS ?? 2000);
positions.start();
```

Use `CharacterRepository.updatePosition` as the write function. Include `positions` in `createGameServer`'s returned `services` object so integration tests and graceful shutdown can flush deterministically:

```ts
return {
  io,
  services: { world, inventory, loot, battles, characters, positions }
};
```

- [ ] **Step 8: Add reconnect persistence E2E**

In `socketFlow.test.ts`:

1. Create/login a character.
2. Connect.
3. Move server-authoritatively to a non-spawn coordinate.
4. Flush that player's position.
5. Disconnect.
6. Create a fresh `WorldService`/game-server instance against the same test database.
7. Login/connect again.
8. Assert the first world snapshot contains the saved x/y.

Use numeric assertions with `toBeCloseTo`.

- [ ] **Step 9: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- worldService.test.ts positionPersistenceCoordinator.test.ts socketFlow.test.ts
npm run build
git add apps/server/src apps/server/tests packages/shared/src/world.ts
git commit -m "feat: restore and checkpoint persistent world position"
```

---

### Task 10: Durable HP, Injuries, Inventory, Equipment, and Battle Outcomes

**Files:**
- Modify: `packages/shared/src/inventory.ts`
- Modify: `packages/shared/src/character.ts`
- Create: `apps/server/src/persistence/InventoryRepository.ts`
- Create: `apps/server/src/persistence/InjuryRepository.ts`
- Create: `apps/server/src/persistence/EquipmentRepository.ts`
- Create: `apps/server/src/persistence/PlayerPersistenceService.ts`
- Modify: `apps/server/src/persistence/CharacterRepository.ts`
- Modify: `apps/server/src/server/createGameServer.ts`
- Create: `apps/server/tests/db/playerPersistence.test.ts`
- Modify: `apps/server/tests/socketFlow.test.ts`

**Interfaces:**
- Adds shared `EquipmentEntry` and `EquipmentSnapshot`; `PlayerStateSnapshot` includes `equipment`.
- `PlayerPersistenceService.loadPlayer(characterId): Promise<PlayerStateSnapshot>`.
- `saveCharacterState(character: CharacterSnapshot): Promise<void>`.
- `saveBattleOutcome(character, inventory): Promise<void>` transactionally persists HP/injuries/items.
- `saveInventory(characterId, inventory)` persists item stacks/instances.
- Equipment table is loaded/saved even though the current MVP has no equip UI yet.

- [ ] **Step 1: Extend shared player state with equipment**

In `packages/shared/src/inventory.ts` add:

```ts
export interface EquipmentEntry {
  slot: string;
  itemInstanceId: string;
}

export interface EquipmentSnapshot {
  items: EquipmentEntry[];
}
```

Change `PlayerStateSnapshot` in `packages/shared/src/character.ts`:

```ts
export interface PlayerStateSnapshot {
  character: CharacterSnapshot;
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}
```

Update existing client/server fixtures to include `equipment: { items: [] }`.

- [ ] **Step 2: Add RED durable-player integration test**

Create `playerPersistence.test.ts`:

```ts
const loaded = await persistence.loadPlayer(characterId);
expect(loaded.character.hp).toBe(100);
expect(loaded.inventory.items).toEqual([]);

loaded.character.hp = 37;
loaded.character.severelyInjured = true;
loaded.character.injuries = ["legTrauma"];
loaded.inventory.items.push({
  instanceId: crypto.randomUUID(),
  itemId: "wolf-pelt",
  name: "Wolf Pelt",
  quantity: 2,
  category: "material",
  description: "A rough wolf pelt."
});

await persistence.saveBattleOutcome(loaded.character, loaded.inventory);

const restored = await persistence.loadPlayer(characterId);
expect(restored.character).toMatchObject({
  hp: 37,
  severelyInjured: true,
  injuries: ["legTrauma"]
});
expect(restored.inventory.items[0]).toMatchObject({
  itemId: "wolf-pelt",
  quantity: 2
});
expect(restored.equipment).toEqual({ items: [] });
```

- [ ] **Step 3: Implement inventory replacement transaction primitive**

`InventoryRepository.replaceAll(characterId, snapshot)` must:

```ts
await this.db.query("DELETE FROM character_equipment WHERE character_id = $1", [characterId]);
await this.db.query("DELETE FROM character_items WHERE character_id = $1", [characterId]);

for (const item of snapshot.items) {
  await this.db.query(
    `INSERT INTO character_items
     (instance_id, character_id, item_id, name, quantity, category, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      item.instanceId,
      characterId,
      item.itemId,
      item.name,
      item.quantity,
      item.category,
      item.description
    ]
  );
}
```

`load(characterId)` maps rows back to `InventorySnapshot`.

- [ ] **Step 4: Implement injury replacement/load**

`InjuryRepository.replaceAll`:

```ts
await this.db.query("DELETE FROM character_injuries WHERE character_id = $1", [characterId]);
for (const injury of injuries) {
  await this.db.query(
    "INSERT INTO character_injuries (character_id, injury_kind) VALUES ($1,$2)",
    [characterId, injury]
  );
}
```

`load` returns `InjuryKind[]`.

- [ ] **Step 5: Implement equipment repository**

Use:

```ts
export interface EquipmentEntry {
  slot: string;
  itemInstanceId: string;
}

async load(characterId: string): Promise<EquipmentEntry[]> {
  const result = await this.db.query<{ slot: string; item_instance_id: string }>(
    "SELECT slot, item_instance_id FROM character_equipment WHERE character_id = $1 ORDER BY slot",
    [characterId]
  );
  return result.rows.map((row) => ({ slot: row.slot, itemInstanceId: row.item_instance_id }));
}
```

Add `replaceAll(characterId, entries)` that deletes current rows then inserts each slot/item pair. No client equip command is added in this milestone.

- [ ] **Step 6: Add character vitals persistence**

Add to `CharacterRepository`:

```ts
async updateVitals(character: CharacterSnapshot): Promise<void> {
  await this.db.query(
    `UPDATE characters
     SET level = $2, hp = $3, max_hp = $4, max_ap = $5,
         initiative = $6, severely_injured = $7, updated_at = now()
     WHERE id = $1`,
    [
      character.playerId,
      character.level,
      character.hp,
      character.maxHp,
      character.maxAp,
      character.initiative,
      character.severelyInjured
    ]
  );
}
```

- [ ] **Step 7: Implement `PlayerPersistenceService`**

`loadPlayer` combines CharacterRepository + InjuryRepository + InventoryRepository + EquipmentRepository:

```ts
return {
  character: {
    playerId: row.id,
    nickname: row.nickname,
    appearance: row.appearance,
    level: row.level,
    hp: row.hp,
    maxHp: row.maxHp,
    maxAp: row.maxAp,
    initiative: row.initiative,
    severelyInjured: row.severelyInjured,
    injuries: await new InjuryRepository(this.pool).load(row.id)
  },
  inventory: await new InventoryRepository(this.pool).load(row.id),
  equipment: { items: await new EquipmentRepository(this.pool).load(row.id) }
};
```

`saveBattleOutcome` uses one `withTransaction`:

```ts
await withTransaction(this.pool, async (client) => {
  await new CharacterRepository(client).updateVitals(character);
  await new InjuryRepository(client).replaceAll(character.playerId, character.injuries);
  await new InventoryRepository(client).replaceAll(character.playerId, inventory);
});
```

Add `saveEquipment(characterId, equipment)` using a transaction-scoped `EquipmentRepository.replaceAll`. There is no equip command in this milestone, so current characters load `{ items: [] }`; the persistence contract is established now so future equipment mutations do not require a schema redesign.

- [ ] **Step 8: Hydrate durable state on socket connection**

When an authenticated active character connects:

```ts
const persisted = await playerPersistence.loadPlayer(characterId);
characters.hydratePlayer(persisted.character);
inventory.hydratePlayer(characterId, persisted.inventory);
world.addPlayer({
  id: characterId,
  nickname: persisted.character.nickname,
  appearance: persisted.character.appearance,
  locationId: durable.locationId,
  x: durable.x,
  y: durable.y
});
```

Do not create default HP/inventory for returning characters.

- [ ] **Step 9: Persist critical actions before emitting success**

For healer:

```ts
const healed = characters.healHp(playerId);
await playerPersistence.saveCharacterState(healed);
emitPlayerState(playerId);
```

For battle completion, after applying outcome and loot but before `battleEnded`:

```ts
const character = characters.getSnapshot(playerId)!;
const inventorySnapshot = inventory.getSnapshot(playerId);
await playerPersistence.saveBattleOutcome(character, inventorySnapshot);
await positions.flushPlayer(playerId);

socket.emit("battleEnded", {
  outcome: applied.victory ? "victory" : "defeat",
  inventory: inventorySnapshot,
  character
});
```

If persistence throws after runtime state was tentatively mutated, reload the last durable state with `playerPersistence.loadPlayer(playerId)`, call `characters.hydratePlayer(restored.character)` and `inventory.hydratePlayer(playerId, restored.inventory)`, then emit `commandRejected` with generic code `PERSISTENCE_FAILED`. Never leave uncommitted loot/HP changes active in RAM.

- [ ] **Step 10: Add reconnect-after-battle E2E**

Extend `socketFlow.test.ts`:

- win the wolf battle;
- disconnect;
- start a fresh server runtime against the same database;
- reconnect;
- request player state;
- assert wolf pelt/bandages and post-battle HP/injuries match the previous committed result.

- [ ] **Step 11: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- playerPersistence.test.ts socketFlow.test.ts characterService.test.ts
npm run build
git add packages/shared/src apps/server/src/persistence apps/server/src/server/createGameServer.ts apps/server/tests
git commit -m "feat: persist character combat and inventory state"
```

---

### Task 11: Delayed Character Deletion and Seven-Day Nickname Reservation

**Files:**
- Modify: `apps/server/src/character/CharacterLifecycleService.ts`
- Modify: `apps/server/src/persistence/CharacterRepository.ts`
- Create: `apps/server/src/persistence/NicknameReservationRepository.ts`
- Modify: `apps/server/src/http/createApiHandler.ts`
- Modify: `apps/client/src/net/ApiClient.ts`
- Create: `apps/client/src/scenes/CharacterDeletionScene.ts`
- Modify: `apps/client/src/game/config.ts`
- Modify: `apps/client/src/scenes/BootScene.ts`
- Modify: `apps/client/src/scenes/AuthScene.ts`
- Create: `apps/server/tests/characterDeletion.test.ts`

**Interfaces:**
- Adds REST `POST /api/character/delete-request` and `POST /api/character/delete-cancel`.
- Deletion request requires the current password.
- Finalization is lazy and transaction-safe; no scheduler is required for correctness.
- Reserved nickname expiry equals `deletion_effective_at + 7 days`.

- [ ] **Step 1: Add RED deletion lifecycle tests**

Create `characterDeletion.test.ts` with a fixed clock:

```ts
const requestedAt = new Date("2026-09-18T10:00:00.000Z");
const effectiveAt = new Date("2026-09-19T10:00:00.000Z");

await service.requestDeletion(accountId, "correct horse battery", requestedAt);
expect(await service.getLifecycle(accountId, requestedAt)).toMatchObject({
  state: "pendingDeletion",
  deletionEffectiveAt: effectiveAt.toISOString()
});

await service.cancelDeletion(accountId);
expect(await service.getLifecycle(accountId, requestedAt)).toMatchObject({
  state: "active"
});
```

Second test: request again, query lifecycle at `2026-09-19T10:00:01Z`, assert lifecycle becomes `none`, and reservation has:

```ts
expect(reservation.reservedUntil.toISOString()).toBe("2026-09-26T10:00:00.000Z");
```

Third test: another account cannot claim the nickname before `reservedUntil`, but can claim it after expiry.

- [ ] **Step 2: Implement nickname reservation repository**

Public API:

```ts
export class NicknameReservationRepository {
  constructor(private readonly db: DbExecutor) {}

  async findActive(normalized: string, now: Date): Promise<NicknameReservation | null>;
  async reserve(input: {
    normalized: string;
    display: string;
    formerAccountId: string;
    reservedUntil: Date;
  }): Promise<void>;
  async deleteExpired(normalized: string, now: Date): Promise<void>;
}
```

`findActive` SQL:

```sql
SELECT nickname_normalized, display_nickname, former_account_id, reserved_until
FROM reserved_nicknames
WHERE nickname_normalized = $1 AND reserved_until > $2
```

- [ ] **Step 3: Add deletion fields repository methods**

In `CharacterRepository` add:

```ts
async markDeletionRequested(characterId: string, requestedAt: Date, effectiveAt: Date): Promise<void>;
async cancelDeletion(characterId: string): Promise<void>;
async deleteById(characterId: string): Promise<void>;
async findOverdueByNickname(normalized: string, now: Date): Promise<PersistedCharacterRecord | null>;
```

`markDeletionRequested` sets both timestamps. `cancelDeletion` sets both to NULL.

- [ ] **Step 4: Implement finalization in one transaction**

Add private method in `CharacterLifecycleService`:

```ts
private async finalizeCharacter(
  character: PersistedCharacterRecord,
  now: Date
): Promise<void> {
  if (!character.deletionEffectiveAt || character.deletionEffectiveAt > now) return;

  await withTransaction(this.pool, async (client) => {
    const characters = new CharacterRepository(client);
    const reservations = new NicknameReservationRepository(client);

    await reservations.reserve({
      normalized: character.nicknameNormalized,
      display: character.nickname,
      formerAccountId: character.accountId,
      reservedUntil: new Date(character.deletionEffectiveAt!.getTime() + 7 * 24 * 60 * 60 * 1000)
    });
    await characters.deleteById(character.id);
  });
}
```

`getLifecycle(accountId, now)` finalizes overdue deletion before returning state.

Before character creation checks a nickname, call `finalizeOverdueNickname(normalized, now)`, delete an expired reservation for that normalized name, then reject if an active reservation remains.

- [ ] **Step 5: Require password for deletion request**

`requestDeletion(accountId, password, now)` loads the account and:

```ts
if (!(await verifyPassword(account.passwordHash, password))) {
  throw new CharacterLifecycleError("INVALID_PASSWORD", 401);
}
```

Then mark:
- `requestedAt = now`
- `effectiveAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)`

If the character is currently online, the HTTP handler calls `activeConnections.closeAccount(accountId, "characterDeletion")` after the request commits so it is flushed and removed from the world.

- [ ] **Step 6: Add the two deletion endpoints**

`POST /api/character/delete-request` body:

```json
{ "password": "current account password" }
```

Return the updated `CharacterLifecycleSummary`.

`POST /api/character/delete-cancel` takes no body and returns the active lifecycle state.

Both require a valid bearer session.

- [ ] **Step 7: Build the pending-deletion client scene**

`CharacterDeletionScene` receives the pending lifecycle summary and renders:
- character nickname;
- exact deletion date;
- live countdown updated once per second;
- `Cancel deletion`;
- `Log out`.

Cancel handler:

```ts
const session = await apiClient.cancelCharacterDeletion();
if (session.character.state === "active") {
  this.scene.start("WorldScene", { playerId: session.character.characterId });
}
```

Add an account-control button in World HUD for `Delete character`. It opens a confirmation panel requiring password, then calls `apiClient.requestCharacterDeletion(password)`; on success disconnect the game socket and route to `CharacterDeletionScene`.

- [ ] **Step 8: Verify and commit**

```bash
npm run test -w @web-mmorpg/server -- characterDeletion.test.ts characterLifecycleService.test.ts
npm run build
git add apps/server/src apps/server/tests/characterDeletion.test.ts apps/client/src
git commit -m "feat: add delayed character deletion and nickname reservation"
```

---

### Task 12: End-to-End Security, Deployment Configuration, Documentation, and Final Verification

**Files:**
- Create or modify: `apps/server/tests/accountPersistence.e2e.test.ts`
- Modify: `.github/workflows/feature-ci.yml`
- Modify: `.github/workflows/pages.yml`
- Modify: `README.md`
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/index.ts`

**Interfaces:**
- Final acceptance flow covers register -> login -> create -> play -> persist -> disconnect -> reconnect.
- Render configuration requirements are documented exactly.
- CI executes database-backed tests and full builds.

- [ ] **Step 1: Add the full RED account/persistence E2E**

Create `accountPersistence.e2e.test.ts` importing `startTestApp` and `defaultAppearance` from `tests/helpers/testApp.ts`, plus `onceWithTimeout` and `winBattle` from `tests/helpers/battleTestHelpers.ts`. It performs this exact sequence against a real PostgreSQL test database:

```ts
const app = await startTestApp();
const registration = await app.register("owczy217", "correct horse battery");
expect(registration.recoveryCode).toBeTruthy();

const firstLogin = await app.login("owczy217", "correct horse battery");
expect(firstLogin.session.character).toEqual({ state: "none" });

const character = await app.createCharacter(
  firstLogin.token,
  "Owczy",
  defaultAppearance
);

const socket = await app.connectSocket(firstLogin.token);
const firstWorld = await onceWithTimeout<WorldStateSnapshot>(socket, "worldState");
expect(firstWorld.players.some((player) => player.id === character.id)).toBe(true);

app.game.services.world.movePlayer(
  character.id,
  { x: 900, y: 500 },
  Date.now() + 10_000
);
app.game.services.positions.markDirty(character.id);
await app.game.services.positions.flushPlayer(character.id);

const startedPromise = onceWithTimeout<BattleSnapshot>(socket, "battleStarted");
socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
const started = await startedPromise;
await winBattle(socket, started, character.id);
socket.disconnect();

const secondLogin = await app.login("owczy217", "correct horse battery");
expect(secondLogin.session.character).toMatchObject({
  state: "active",
  characterId: character.id,
  nickname: "Owczy"
});

const restored = await app.connectSocket(secondLogin.token);
restored.emit("requestWorldState");
const world = await onceWithTimeout<WorldStateSnapshot>(restored, "worldState");
const me = world.players.find((player) => player.id === character.id)!;
expect(me.x).toBeCloseTo(900, 0);
expect(me.y).toBeCloseTo(500, 0);

restored.emit("requestPlayerState");
const state = await onceWithTimeout<PlayerStateSnapshot>(restored, "playerState");
expect(state.inventory.items.some((item) => item.itemId === "wolf-pelt")).toBe(true);
expect(state.equipment).toEqual({ items: [] });

await app.close();
```

- [ ] **Step 2: Add security E2E assertions**

In the same file assert:
- invalid token socket gets `connect_error`;
- duplicate username case-insensitively returns 409;
- duplicate nickname case-insensitively returns 409;
- invalid appearance ID returns 400;
- second login emits `sessionReplaced` to first socket;
- old token fails after second login;
- recovery rotates the recovery code and revokes old session;
- old recovery code fails after use;
- request body over 16 KiB returns 413;
- sixth rapid login attempt returns 429;
- client-supplied character/account IDs are absent from mutation APIs, so attempting to include them has no effect.

- [ ] **Step 3: Add graceful shutdown flush**

In `index.ts`, keep references to `positions`, `io`, `httpServer`, and `pool`. Add:

```ts
let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await positions.stop();
  await new Promise<void>((resolve) => game.io.close(() => resolve()));
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await pool.end();
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
```

Correctness still relies on periodic/critical durable writes, not on the signal handler.

- [ ] **Step 4: Make the production start command migration-safe**

Ensure `apps/server/package.json` contains:

```json
{
  "scripts": {
    "dev": "npm run db:migrate && tsx watch src/index.ts",
    "db:migrate": "tsx src/db/migrate.ts",
    "start": "npm run db:migrate && tsx src/index.ts",
    "test": "vitest run --fileParallelism=false",
    "build": "tsc --noEmit"
  }
}
```

Remove the direct `await runMigrations(pool)` call from `index.ts` at this point so migrations run exactly once as the explicit dev/start pre-step.

The Render service start command becomes:

```text
npm run start -w @web-mmorpg/server
```

Required Render environment variables:

```text
DATABASE_URL=<Render PostgreSQL internal connection string>
CLIENT_ORIGIN=https://owca217.github.io
SESSION_TTL_DAYS=30
POSITION_CHECKPOINT_MS=2000
```

Do not commit the actual `DATABASE_URL`.

- [ ] **Step 5: Keep Pages pointed at the same backend**

Keep `.github/workflows/pages.yml`:

```yaml
env:
  VITE_GAME_SERVER_URL: https://web-mmorpg-server.onrender.com
```

No database secret belongs in the client workflow.

- [ ] **Step 6: Update README to match the new persistence model**

Replace the statement that progress resets on Render restart with:

```md
Accounts and character state are persisted in PostgreSQL. The authoritative game server keeps online state in memory, checkpoints world position approximately every two seconds, and writes critical gameplay changes such as HP, injuries and inventory durably before confirming them to the client.
```

Add a local-development section:

```md
### Server environment

Required:

- `DATABASE_URL`
- `CLIENT_ORIGIN`

Optional:

- `SESSION_TTL_DAYS=30`
- `POSITION_CHECKPOINT_MS=2000`

Run migrations and server:

```bash
npm run start -w @web-mmorpg/server
```
```

- [ ] **Step 7: Run the full verification suite**

Run:

```bash
npm test
npm run build
```

Then verify the feature-branch GitHub Actions run is green with PostgreSQL service enabled.

Expected:
- shared tests PASS;
- server unit/integration/E2E tests PASS;
- client tests PASS;
- all TypeScript builds PASS;
- Pages build/deploy PASS when client/shared files changed.

- [ ] **Step 8: Manual acceptance on the public deployment**

After Render has `DATABASE_URL` and the new start command:

1. Register account A and save recovery code.
2. Log in and create character `Owczy`.
3. Move away from spawn.
4. Win one wolf battle and confirm loot.
5. Log out and log back in; verify map/position/HP/inventory persist.
6. Open a second browser/device and log into account A; verify the first client is kicked.
7. Register account B and create a different nickname; verify both characters see each other in the world.
8. Request deletion of account A's character; verify gameplay is blocked and countdown appears.
9. Cancel deletion; verify the character returns.
10. Request deletion again and verify automated tests cover the 24h/7d time-based finalization rather than waiting in real time.

Record manual acceptance before any merge decision.

- [ ] **Step 9: Commit final hardening/docs**

```bash
git add apps/server .github/workflows README.md
git commit -m "test: verify persistent account lifecycle end to end"
```

---

## Plan Self-Review Checklist

Before execution, confirm the plan still matches the approved spec:

- Account registration, login, logout, 30-day opaque sessions: Tasks 2–5.
- One active session and old-device kick: Tasks 3, 4, 8.
- Recovery code shown once, hashed, rotated after use: Tasks 2, 4, 5, 12.
- One character per account and globally unique nickname: Tasks 1 and 6.
- Full approved creator option set and server-side validation: Tasks 6 and 7.
- Appearance persisted and visibly rendered in world: Tasks 6 and 7.
- Authenticated server-authoritative Socket.IO identity: Task 8.
- Persisted location and two-second checkpointing: Task 9.
- HP/injuries/inventory/equipment persistence and transactional battle save: Task 10.
- 24-hour deletion, cancellation, 7-day nickname reservation: Task 11.
- PostgreSQL migrations, CORS, body bound, auth rate limiting, CI database: Tasks 1, 2, 4, 12.
- Backend restart restoration and full E2E: Tasks 9, 10, 12.
- No merge to `main` without explicit approval: Global Constraints.

## Execution Notes

- Each task is independently reviewable and should end in its own commit.
- Keep RED/GREEN discipline: do not skip the failing-test step.
- Do not replace the thin repository layer with an ORM during execution.
- Do not add email/OAuth, multi-character accounts, guilds, trade, auction house, or permanent appearance editing in this milestone.
- If Render PostgreSQL or environment setup blocks public acceptance, keep the code on `feature/mvp-vertical-slice`, report the exact missing deployment setting, and do not merge around the failure.
