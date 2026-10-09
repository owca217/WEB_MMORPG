import { Router } from "express";
import type { Pool } from "pg";

interface IconRow {
  mime_type: "image/png" | "image/webp";
  bytes: Buffer;
}

const KEY_PATTERN = /^db-icons-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|webp)$/;

export function createItemIconRouter(pool: Pool): Router {
  const router = Router();

  router.get("/:key", async (req, res, next) => {
    try {
      const key = req.params.key;
      if (!KEY_PATTERN.test(key)) {
        res.status(404).end();
        return;
      }

      const result = await pool.query<IconRow>(
        "SELECT mime_type, bytes FROM item_icon_assets WHERE key = $1",
        [key]
      );
      const icon = result.rows[0];
      if (!icon) {
        res.status(404).end();
        return;
      }

      res.setHeader("Content-Type", icon.mime_type);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(icon.bytes);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
