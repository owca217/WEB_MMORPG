import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pagesWorkflow = readFileSync(
  resolve(here, "../../../.github/workflows/pages.yml"),
  "utf8"
);

describe("production GitHub Pages deployment", () => {
  it("deploys the final main branch", () => {
    expect(pagesWorkflow).toContain("      - main");
  });

  it("builds a client that exposes the ADMIN bootstrap login field", () => {
    expect(pagesWorkflow).toContain('          VITE_ENABLE_ADMIN_LOGIN: "true"');
  });

  it("uses npm 11 like the verified feature CI", () => {
    expect(pagesWorkflow).toContain("npm install --global npm@11");
  });
});
