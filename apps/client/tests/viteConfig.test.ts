import { describe, expect, it } from "vitest";
import { resolveViteBasePath } from "../vite.config";

describe("Vite hosting base path", () => {
  it("uses the GitHub Pages base when no base is configured", () => {
    expect(resolveViteBasePath(undefined)).toBe("/WEB_MMORPG/");
  });

  it("uses the web root for the Render build", () => {
    expect(resolveViteBasePath("/")).toBe("/");
  });
});
