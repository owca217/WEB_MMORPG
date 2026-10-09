import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { IconStorage, IconUploadInput, StoredIcon } from "./IconStorage";

export class PostgresIconStorage implements IconStorage {
  private readonly publicBaseUrl: string;

  constructor(
    private readonly pool: Pool,
    publicBaseUrl: string
  ) {
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, "");
  }

  async putIcon(input: IconUploadInput): Promise<StoredIcon> {
    const extension = input.mimeType === "image/png" ? "png" : "webp";
    const key = `db-icons-${randomUUID()}.${extension}`;

    await this.pool.query(
      `INSERT INTO item_icon_assets (key, mime_type, bytes)
       VALUES ($1, $2, $3)`,
      [key, input.mimeType, input.bytes]
    );

    return {
      key,
      url: `${this.publicBaseUrl}/api/item-icons/${key}`
    };
  }
}
