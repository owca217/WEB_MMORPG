import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pagesWorkflow = readFileSync(
  resolve(here, "../../../.github/workflows/pages.yml"),
  "utf8"
);
const featureCi = readFileSync(
  resolve(here, "../../../.github/workflows/feature-ci.yml"),
  "utf8"
);
const gameSocket = readFileSync(
  resolve(here, "../../client/src/net/GameSocket.ts"),
  "utf8"
);
const serverPackage = JSON.parse(
  readFileSync(resolve(here, "../package.json"), "utf8")
) as { scripts?: Record<string, string> };

describe("production account-auth deployment", () => {
  it("deploys/builds the final main branch with npm 11", () => {
    expect(pagesWorkflow).toContain("      - main");
    expect(pagesWorkflow).toContain("npm install --global npm@11");
    expect(featureCi).toContain("      - main");
  });

  it("provides the Render production start command expected by the service", () => {
    expect(serverPackage.scripts?.start).toBe("tsx src/index.ts");
  });

  it("does not expose the retired temporary ADMIN-token login flow", () => {
    expect(pagesWorkflow).not.toContain("VITE_ENABLE_ADMIN_LOGIN");
    expect(pagesWorkflow).not.toContain("ADMIN_ACCESS_TOKEN");
    expect(featureCi).not.toContain("ADMIN_ACCESS_TOKEN");
    expect(gameSocket).not.toContain("adminToken");
    expect(gameSocket).not.toContain('emitWithAck("login"');
  });

  it("keeps the production game server URL in the Pages build", () => {
    expect(pagesWorkflow).toContain(
      "VITE_GAME_SERVER_URL: https://web-mmorpg-server.onrender.com"
    );
  });
});
