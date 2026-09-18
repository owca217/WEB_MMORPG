import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  AppearanceSelection,
  CharacterProfile,
  LoginResponse,
  RegisterResponse
} from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { Pool } from "pg";
import { AuthService } from "../../src/auth/AuthService";
import { CharacterLifecycleService } from "../../src/character/CharacterLifecycleService";
import { runMigrations } from "../../src/db/migrate";
import { createApiHandler } from "../../src/http/createApiHandler";
import { AccountRepository } from "../../src/persistence/AccountRepository";
import { CharacterRepository } from "../../src/persistence/CharacterRepository";
import { PlayerPersistenceService } from "../../src/persistence/PlayerPersistenceService";
import { ActiveConnectionRegistry } from "../../src/server/ActiveConnectionRegistry";
import { createGameServer } from "../../src/server/createGameServer";

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

export interface TestApp {
  baseUrl: string;
  pool: Pool;
  game: ReturnType<typeof createGameServer>;
  register(username: string, password?: string): Promise<RegisterResponse>;
  login(username: string, password?: string): Promise<LoginResponse>;
  createCharacter(
    token: string,
    nickname: string,
    appearance?: AppearanceSelection
  ): Promise<CharacterProfile>;
  connectSocket(token: string): Promise<Socket>;
  close(): Promise<void>;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}:${JSON.stringify(body)}`);
  }
  return body as T;
}

export async function startTestApp(): Promise<TestApp> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);

  const characters = new CharacterLifecycleService(pool);
  const authService = new AuthService(
    pool,
    new AccountRepository(pool),
    characters
  );
  const activeConnections = new ActiveConnectionRegistry();
  const characterRepository = new CharacterRepository(pool);
  const playerPersistence = new PlayerPersistenceService(pool);
  const httpServer = createServer(
    createApiHandler({
      authService,
      characterService: characters,
      activeConnections,
      clientOrigin: "https://client.test"
    })
  );
  const game = createGameServer(httpServer, {
    authService,
    characters,
    activeConnections,
    characterRepository,
    playerPersistence,
    clientOrigin: "https://client.test",
    positionCheckpointMs: 2000
  });

  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve)
  );
  const address = httpServer.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];

  return {
    baseUrl,
    pool,
    game,
    async register(username, password = "correct horse battery") {
      return json<RegisterResponse>(
        await fetch(baseUrl + "/api/auth/register", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://client.test"
          },
          body: JSON.stringify({
            username,
            password,
            passwordConfirmation: password
          })
        })
      );
    },
    async login(username, password = "correct horse battery") {
      return json<LoginResponse>(
        await fetch(baseUrl + "/api/auth/login", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://client.test"
          },
          body: JSON.stringify({ username, password })
        })
      );
    },
    async createCharacter(token, nickname, appearance = defaultAppearance) {
      return json<CharacterProfile>(
        await fetch(baseUrl + "/api/character", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            origin: "https://client.test"
          },
          body: JSON.stringify({ nickname, appearance })
        })
      );
    },
    async connectSocket(token) {
      const socket = createClient(baseUrl, {
        transports: ["websocket"],
        forceNew: true,
        auth: { token }
      });
      sockets.push(socket);

      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await game.services.positions?.stop();
      await new Promise<void>((resolve) => game.io.close(() => resolve()));
      if (httpServer.listening) {
        await new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve()))
        );
      }
      await pool.end();
    }
  };
}
