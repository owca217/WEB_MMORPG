import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const rootPackage = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8")
) as { scripts?: Record<string, string> };
const buildScript = resolve(root, "scripts/build-render-client.mjs");

describe("Render client install build", () => {
  it("registers the Render build as an npm install lifecycle hook", () => {
    expect(rootPackage.scripts?.postinstall).toBe(
      "node scripts/build-render-client.mjs"
    );
  });

  it("builds with root asset paths on Render and skips other installs", () => {
    const temp = mkdtempSync(resolve(tmpdir(), "render-client-build-"));
    const bin = resolve(temp, "bin");
    const npmShim = resolve(bin, "npm");
    const capture = resolve(temp, "capture.json");

    try {
      mkdirSync(bin);
      writeFileSync(
        npmShim,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          "fs.writeFileSync(",
          "  process.env.CAPTURE_FILE,",
          "  JSON.stringify({",
          "    args: process.argv.slice(2),",
          "    base: process.env.VITE_BASE_PATH,",
          "    server: process.env.VITE_GAME_SERVER_URL,",
          "  })",
          ");",
          "",
        ].join("\n")
      );
      chmodSync(npmShim, 0o755);

      const env = {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        RENDER: "true",
        CAPTURE_FILE: capture,
        VITE_BASE_PATH: "/WEB_MMORPG/",
        VITE_GAME_SERVER_URL: "https://previous-server.example",
      };
      const renderResult = spawnSync(process.execPath, [buildScript], {
        env,
        encoding: "utf8",
      });

      expect(renderResult.status).toBe(0);
      expect(JSON.parse(readFileSync(capture, "utf8"))).toEqual({
        args: ["run", "build", "-w", "@web-mmorpg/client"],
        base: "/",
        server: "",
      });

      rmSync(capture, { force: true });
      const localResult = spawnSync(process.execPath, [buildScript], {
        env: { ...env, RENDER: "false" },
        encoding: "utf8",
      });

      expect(localResult.status).toBe(0);
      expect(existsSync(capture)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
