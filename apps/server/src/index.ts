import { createServer } from "node:http";
import type { Pool } from "pg";
import { AuthService } from "./auth/AuthService";
import { CharacterLifecycleService } from "./character/CharacterLifecycleService";
import { createPool } from "./db/pool";
import { createApiHandler } from "./http/createApiHandler";
import { AccountRepository } from "./persistence/AccountRepository";
import { CharacterRepository } from "./persistence/CharacterRepository";
import { PlayerPersistenceService } from "./persistence/PlayerPersistenceService";
import { ActiveConnectionRegistry } from "./server/ActiveConnectionRegistry";
import { createGameServer } from "./server/createGameServer";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";
const databaseUrl = process.env.DATABASE_URL;
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 30);
const positionCheckpointMs = Number(
  process.env.POSITION_CHECKPOINT_MS ?? 2000
);

let pool: Pool | undefined;
let httpServer;
let persistentGameDeps:
  | {
      authService: AuthService;
      characters: CharacterLifecycleService;
      activeConnections: ActiveConnectionRegistry;
      characterRepository: CharacterRepository;
      playerPersistence: PlayerPersistenceService;
      clientOrigin: string;
      positionCheckpointMs: number;
    }
  | undefined;

if (databaseUrl) {
  pool = createPool(databaseUrl);
  const characterService = new CharacterLifecycleService(pool);
  const characterRepository = new CharacterRepository(pool);
  const playerPersistence = new PlayerPersistenceService(pool);
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
    activeConnections,
    characterRepository,
    playerPersistence,
    clientOrigin,
    positionCheckpointMs
  };
} else {
  console.warn(
    "DATABASE_URL is not configured; starting the legacy in-memory game endpoint."
  );
  httpServer = createServer();
}

const game = createGameServer(httpServer, persistentGameDeps);

httpServer.listen(port, host, () => {
  console.log(`WEB MMORPG server listening on http://${host}:${port}`);
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  try {
    await game.services.positions?.stop();

    await new Promise<void>((resolve) => {
      game.io.close(() => resolve());
    });

    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }

    await pool?.end();
  } catch (error) {
    console.error(
      "Graceful shutdown failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
