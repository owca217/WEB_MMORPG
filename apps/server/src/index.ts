import { createServer } from "node:http";
import { AuthService } from "./auth/AuthService";
import { CharacterLifecycleService } from "./character/CharacterLifecycleService";
import { createPool } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { createApiHandler } from "./http/createApiHandler";
import { AccountRepository } from "./persistence/AccountRepository";
import { ActiveConnectionRegistry } from "./server/ActiveConnectionRegistry";
import { createGameServer } from "./server/createGameServer";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 30);

let httpServer;
let persistentGameDeps:
  | {
      authService: AuthService;
      characters: CharacterLifecycleService;
      activeConnections: ActiveConnectionRegistry;
    }
  | undefined;

if (databaseUrl) {
  const pool = createPool(databaseUrl);
  await runMigrations(pool);
  const characterService = new CharacterLifecycleService(pool);
  const activeConnections = new ActiveConnectionRegistry();
  const authService = new AuthService(
    pool,
    new AccountRepository(pool),
    characterService,
    sessionTtlDays
  );
  httpServer = createServer(
    createApiHandler({
      authService,
      characterService,
      activeConnections,
      clientOrigin
    })
  );
  persistentGameDeps = {
    authService,
    characters: characterService,
    activeConnections
  };
} else {
  console.warn(
    "DATABASE_URL is not configured; starting the legacy in-memory game endpoint until persistent auth deployment is configured."
  );
  httpServer = createServer();
}

createGameServer(httpServer, persistentGameDeps);

httpServer.listen(port, host, () => {
  console.log(`WEB MMORPG server listening on http://${host}:${port}`);
});
