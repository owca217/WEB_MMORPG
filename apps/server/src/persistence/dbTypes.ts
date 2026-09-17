import type { Pool, PoolClient } from "pg";

export type DbExecutor = Pool | PoolClient;
