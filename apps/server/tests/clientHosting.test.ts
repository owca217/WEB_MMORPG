import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpApp } from "../src/http/createHttpApp";

describe("client static hosting", () => {
  let clientDistDirectory: string;
  let app: express.Express;

  beforeEach(async () => {
    clientDistDirectory = await mkdtemp(join(tmpdir(), "web-mmorpg-client-"));
    await mkdir(join(clientDistDirectory, "assets"), { recursive: true });
    await writeFile(
      join(clientDistDirectory, "index.html"),
      "<!doctype html><html><body><main>WEB MMORPG</main></body></html>"
    );
    await writeFile(join(clientDistDirectory, "assets", "game.js"), "window.gameReady = true;");

    const itemIconRouter = express.Router();
    const apiRouter = express.Router();
    apiRouter.get("/auth/session", (_req, res) =>
      res.status(401).json({ code: "AUTH_REQUIRED" })
    );
    apiRouter.post("/auth/login", (_req, res) =>
      res.status(401).json({ code: "INVALID_CREDENTIALS" })
    );

    const adminRouter = express.Router();
    adminRouter.get("/items", (_req, res) => res.json({ source: "admin-api" }));

    app = createHttpApp({
      itemIconRouter,
      apiRouter,
      adminRouter,
      clientDistDirectory
    });
  });

  afterEach(async () => {
    await rm(clientDistDirectory, { recursive: true, force: true });
  });

  it("serves the built game and assets from the web root", async () => {
    const page = await request(app).get("/").expect(200);
    expect(page.text).toContain("<main>WEB MMORPG</main>");

    const asset = await request(app).get("/assets/game.js").expect(200);
    expect(asset.text).toBe("window.gameReady = true;");
  });

  it("routes API requests before files with the same paths in the client build", async () => {
    const sessionFile = join(clientDistDirectory, "api", "auth", "session");
    const adminFile = join(clientDistDirectory, "api", "admin", "items");
    await mkdir(join(clientDistDirectory, "api", "auth"), { recursive: true });
    await mkdir(join(clientDistDirectory, "api", "admin"), { recursive: true });
    await writeFile(sessionFile, "static session file must not win");
    await writeFile(adminFile, "static admin file must not win");

    const session = await request(app).get("/api/auth/session").expect(401);
    expect(session.body).toEqual({ code: "AUTH_REQUIRED" });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "test", password: "dummy" })
      .expect(401);
    expect(login.body).toEqual({ code: "INVALID_CREDENTIALS" });

    const admin = await request(app).get("/api/admin/items").expect(200);
    expect(admin.body).toEqual({ source: "admin-api" });
  });

  it("keeps API routes available and the root not found when the client build is missing", async () => {
    const missingClientApp = createHttpApp({
      itemIconRouter: express.Router(),
      apiRouter: express.Router().get("/auth/session", (_req, res) =>
        res.status(401).json({ code: "AUTH_REQUIRED" })
      ),
      adminRouter: express.Router(),
      clientDistDirectory: join(clientDistDirectory, "missing-dist")
    });

    const session = await request(missingClientApp).get("/api/auth/session").expect(401);
    expect(session.body).toEqual({ code: "AUTH_REQUIRED" });
    await request(missingClientApp).get("/").expect(404);
  });
});
