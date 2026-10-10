import cors from "cors";
import express, { type Router } from "express";

export interface CreateHttpAppOptions {
  itemIconRouter: Router;
  apiRouter: Router;
  adminRouter: Router;
  clientDistDirectory: string;
}

export function createHttpApp({
  itemIconRouter,
  apiRouter,
  adminRouter,
  clientDistDirectory
}: CreateHttpAppOptions): express.Express {
  const app = express();
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/item-icons", itemIconRouter);
  app.use("/api", apiRouter);
  app.use("/api/admin", adminRouter);
  app.use(express.static(clientDistDirectory));
  return app;
}
