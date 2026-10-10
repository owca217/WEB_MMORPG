import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function buildClientForRender(env = process.env, spawn = spawnSync) {
  if (env.RENDER !== "true") return 0;

  const result = spawn(
    "npm",
    ["run", "build", "-w", "@web-mmorpg/client"],
    {
      env: {
        ...env,
        VITE_BASE_PATH: "/",
        VITE_GAME_SERVER_URL: "https://web-mmorpg-server.onrender.com",
      },
      stdio: "inherit",
    }
  );

  if (result.error) throw result.error;
  return result.status ?? 1;
}

const scriptPath = process.argv[1];
if (
  scriptPath &&
  import.meta.url === pathToFileURL(resolve(scriptPath)).href
) {
  process.exitCode = buildClientForRender();
}
