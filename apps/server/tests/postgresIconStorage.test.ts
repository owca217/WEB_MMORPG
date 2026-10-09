import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("PostgreSQL item icon fallback", () => {
  const pool = createPool(databaseUrl);

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists an icon and serves the same bytes from the public icon endpoint", async () => {
    const storageModulePath = "../src/admin/PostgresIconStorage";
    const routerModulePath = "../src/http/createItemIconRouter";
    const { PostgresIconStorage } = await import(storageModulePath);
    const { createItemIconRouter } = await import(routerModulePath);

    const storage = new PostgresIconStorage(
      pool,
      "https://web-mmorpg-server.onrender.com"
    );
    const stored = await storage.putIcon({
      bytes: Buffer.from([137, 80, 78, 71, 1, 2, 3]),
      mimeType: "image/png",
      originalName: "sword.png"
    });

    expect(stored.key).toMatch(/^db-icons-[0-9a-f-]+\.png$/);
    expect(stored.url).toBe(
      `https://web-mmorpg-server.onrender.com/api/item-icons/${stored.key}`
    );

    const app = express();
    app.use("/api/item-icons", createItemIconRouter(pool));
    const response = await request(app).get(`/api/item-icons/${stored.key}`).expect(200);

    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.headers["cache-control"]).toContain("immutable");
    expect(Buffer.from(response.body)).toEqual(Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  });
});
