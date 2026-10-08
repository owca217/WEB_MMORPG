import { fileURLToPath } from "node:url";
import type { AccountRole } from "@web-mmorpg/shared";
import { validateUsername } from "../auth/credentials";
import { createPool } from "../db/pool";
import { runMigrations } from "../db/migrate";
import { AccountRepository } from "../persistence/AccountRepository";

function parseRole(input: string): AccountRole | null {
  const normalized = input.trim().toUpperCase();
  return normalized === "PLAYER" || normalized === "ADMIN" ? normalized : null;
}

export async function setAccountRole(
  databaseUrl: string,
  usernameInput: string,
  roleInput: string
): Promise<{ username: string; role: AccountRole }> {
  const username = validateUsername(usernameInput);
  if (!username.ok) {
    throw new Error("Invalid account username.");
  }

  const role = parseRole(roleInput);
  if (!role) {
    throw new Error("Role must be PLAYER or ADMIN.");
  }

  const pool = createPool(databaseUrl);
  try {
    await runMigrations(pool);
    const accounts = new AccountRepository(pool);
    const account = await accounts.findByUsernameForRoleChange(username.normalized);
    if (!account) {
      throw new Error(`Account '${usernameInput.trim()}' was not found.`);
    }

    const updated = await accounts.updateRole(account.id, role);
    if (!updated) {
      throw new Error(`Account '${usernameInput.trim()}' was not found.`);
    }

    return { username: updated.username, role: updated.role };
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const [username, role] = process.argv.slice(2);
  if (!username || !role) {
    throw new Error("Usage: npm run admin:set-role -- <account-username> <PLAYER|ADMIN>");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const result = await setAccountRole(databaseUrl, username, role);
  console.log(`Account ${result.username} role set to ${result.role}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
