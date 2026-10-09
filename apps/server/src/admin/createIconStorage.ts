import type { Pool } from "pg";
import type { IconStorage } from "./IconStorage";
import { PostgresIconStorage } from "./PostgresIconStorage";
import { S3IconStorage } from "./S3IconStorage";

const S3_REQUIRED = [
  "ITEM_ASSET_S3_BUCKET",
  "ITEM_ASSET_S3_REGION",
  "ITEM_ASSET_PUBLIC_BASE_URL"
] as const;

export function createIconStorage(
  pool: Pool,
  publicBaseUrl: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): IconStorage {
  const configured = S3_REQUIRED.filter((name) => env[name]?.trim()).length;

  if (configured === 0) {
    return new PostgresIconStorage(pool, publicBaseUrl);
  }

  return S3IconStorage.fromEnv(env);
}
