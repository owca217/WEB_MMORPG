import { createServer } from "node:http";
import { createGameServer } from "./server/createGameServer";

const port = Number(process.env.PORT ?? 3001);
const host = "0.0.0.0";
const httpServer = createServer();
createGameServer(httpServer);

httpServer.listen(port, host, () => {
  console.log(`WEB MMORPG server listening on http://${host}:${port}`);
});
