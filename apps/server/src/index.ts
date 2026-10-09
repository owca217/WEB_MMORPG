import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { AccountAdminService } from "./admin/AccountAdminService";
import { createAdminRouter } from "./admin/createAdminRouter";
import { createIconStorage } from "./admin/createIconStorage";
import { AdminAuditRepository } from "./audit/AdminAuditRepository";
import { AuthService } from "./auth/AuthService";
import { bootstrapInitialAdmin } from "./auth/bootstrapInitialAdmin";
import { CharacterLifecycleService } from "./character/CharacterLifecycleService";
import { createPool } from "./db/createPool";
import { runMigrations } from "./db/migrate";
import { createAuthRouter } from "./http/createAuthRouter";
import { createItemIconRouter } from "./http/createItemIconRouter";
import { ItemCatalogService } from "./items/ItemCatalogService";
import { ItemMetadataRepository } from "./items/ItemMetadataRepository";
import { seedItemMetadata } from "./items/seedItemMetadata";
import { AccountRepository } from "./persistence/AccountRepository";
import { ActiveConnectionRegistry } from "./server/ActiveConnectionRegistry";
import { createGameServer } from "./server/createGameServer";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";

function resolvePublicServerBaseUrl(): string {
  const configured = process.env.SERVER_PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const renderHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
  if (renderHostname) return `https://${renderHostname.replace(/\/+$/, "")}`;

  return `http://localhost:${port}`;
}

async function startServer(): Promise<void> {
  const pool = createPool();
  await runMigrations(pool);
  await bootstrapInitialAdmin(pool);
  await seedItemMetadata(pool);

  const characters = new CharacterLifecycleService(pool);
  const authService = new AuthService(pool, new AccountRepository(pool), characters);
  const connections = new ActiveConnectionRegistry();
  const metadata = new ItemMetadataRepository(pool);
  const catalog = new ItemCatalogService(pool, metadata);
  const audit = new AdminAuditRepository(pool);
  const accountAdmin = new AccountAdminService(pool, audit, connections);
  const iconStorage = createIconStorage(pool, resolvePublicServerBaseUrl());

  const app = express();
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/item-icons", createItemIconRouter(pool));
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
    createAdminRouter({
      authService,
      accountAdmin,
      metadata,
      catalog,
      audit,
      iconStorage
    })
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
