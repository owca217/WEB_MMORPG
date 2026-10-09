import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { AdminAuditRepository } from "./audit/AdminAuditRepository";
import { S3IconStorage } from "./admin/S3IconStorage";
import { createAdminRouter } from "./admin/createAdminRouter";
import { AuthService } from "./auth/AuthService";
import { bootstrapInitialAdmin } from "./auth/bootstrapInitialAdmin";
import { CharacterLifecycleService } from "./character/CharacterLifecycleService";
import { createPool } from "./db/createPool";
import { runMigrations } from "./db/migrate";
import { createAuthRouter } from "./http/createAuthRouter";
import { ItemCatalogService } from "./items/ItemCatalogService";
import { ItemMetadataRepository } from "./items/ItemMetadataRepository";
import { seedItemMetadata } from "./items/seedItemMetadata";
import { AccountRepository } from "./persistence/AccountRepository";
import { ActiveConnectionRegistry } from "./server/ActiveConnectionRegistry";
import { createGameServer } from "./server/createGameServer";
import { SessionStore } from "./session/SessionStore";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";

async function startServer(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);
  await bootstrapInitialAdmin(pool);
  await seedItemMetadata(pool);

  const characters = new CharacterLifecycleService(pool);
  const authService = new AuthService(pool, new AccountRepository(pool), characters);
  const connections = new ActiveConnectionRegistry();

  // Transitional ADMIN session store only. Task 8 removes it after Admin API
  // authorization is moved onto persistent accounts.
  const sessions = new SessionStore();
  const metadata = new ItemMetadataRepository(pool);
  const catalog = new ItemCatalogService(pool, metadata);
  const audit = new AdminAuditRepository(pool);
  const iconStorage = S3IconStorage.fromEnv();

  const app = express();
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    createAuthRouter({
      authService,
      characterService: characters,
      connections
    })
  );
  app.use(
    "/api/admin",
    createAdminRouter({ sessions, metadata, catalog, audit, iconStorage })
  );

  const httpServer = createServer(app);
  createGameServer(httpServer, {
    pool,
    authService,
    characterLifecycle: characters,
    connections
  });

  httpServer.listen(port, host, () => {
    console.log(`WEB MMORPG server listening on http://${host}:${port}`);
  });

  const shutdown = (): void => {
    httpServer.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void startServer().catch((error: unknown) => {
  console.error("WEB MMORPG server failed to start", error);
  process.exitCode = 1;
});
