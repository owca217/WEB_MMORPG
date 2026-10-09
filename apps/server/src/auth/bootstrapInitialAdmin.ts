import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { hashPassword, validatePassword, validateUsername } from "./credentials";
import { hashOpaqueSecret } from "./secrets";
import { AccountRepository } from "../persistence/AccountRepository";

export class InitialAdminBootstrapError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "InitialAdminBootstrapError";
  }
}

function recoveryCodeValid(value: string): boolean {
  return /^(?:[A-Z0-9]{4}-){3,}[A-Z0-9]{4}$/.test(value.trim().toUpperCase());
}

export async function bootstrapInitialAdmin(
  pool: Pool,
  env: NodeJS.ProcessEnv = process.env
): Promise<"created" | "skipped"> {
  const activeAdmin = await pool.query(
    "SELECT 1 FROM accounts WHERE role = 'ADMIN' AND status = 'active' LIMIT 1"
  );
  if (activeAdmin.rowCount) return "skipped";

  const usernameInput = env.INITIAL_ADMIN_USERNAME;
  const password = env.INITIAL_ADMIN_PASSWORD;
  const recoveryCode = env.INITIAL_ADMIN_RECOVERY_CODE;
  const supplied = [usernameInput, password, recoveryCode].filter(
    (value) => typeof value === "string" && value.length > 0
  ).length;

  if (supplied === 0) return "skipped";
  if (supplied !== 3) {
    throw new InitialAdminBootstrapError(
      "INITIAL_ADMIN_CONFIG_INCOMPLETE",
      "Initial ADMIN bootstrap requires username, password and recovery code."
    );
  }

  const username = validateUsername(usernameInput!);
  if (!username.ok) {
    throw new InitialAdminBootstrapError(
      "INITIAL_ADMIN_USERNAME_INVALID",
      "Initial ADMIN username is invalid."
    );
  }
  if (!validatePassword(password!)) {
    throw new InitialAdminBootstrapError(
      "INITIAL_ADMIN_PASSWORD_INVALID",
      "Initial ADMIN password is invalid."
    );
  }
  const normalizedRecovery = recoveryCode!.trim().toUpperCase();
  if (!recoveryCodeValid(normalizedRecovery)) {
    throw new InitialAdminBootstrapError(
      "INITIAL_ADMIN_RECOVERY_CODE_INVALID",
      "Initial ADMIN recovery code is invalid."
    );
  }

  const accounts = new AccountRepository(pool);
  const existing = await accounts.findByNormalizedUsername(username.normalized);
  if (existing) {
    throw new InitialAdminBootstrapError(
      "INITIAL_ADMIN_USERNAME_CONFLICT",
      "Initial ADMIN username is already owned by another account."
    );
  }

  await accounts.create({
    id: randomUUID(),
    username: usernameInput!.trim(),
    usernameNormalized: username.normalized,
    passwordHash: await hashPassword(password!),
    recoveryCodeHash: hashOpaqueSecret(normalizedRecovery),
    role: "ADMIN",
    status: "active"
  });

  console.log("Initial ADMIN account created.");
  return "created";
}
