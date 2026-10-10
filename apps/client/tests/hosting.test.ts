import { describe, expect, it } from "vitest";
import { getGitHubPagesRedirectUrl, resolveGameServerUrl } from "../src/hosting";

describe("production hosting", () => {
  it("uses localhost for an unconfigured development server", () => {
    expect(resolveGameServerUrl(undefined, true)).toBe("http://localhost:3001");
  });

  it("uses the current origin for an unconfigured production server", () => {
    expect(resolveGameServerUrl(undefined, false)).toBe("");
  });

  it("keeps an explicitly empty server URL on the current origin", () => {
    expect(resolveGameServerUrl("", false)).toBe("");
  });

  it("keeps an explicitly configured server URL", () => {
    expect(resolveGameServerUrl("https://game.example.test", false)).toBe(
      "https://game.example.test"
    );
  });

  it("redirects the GitHub Pages app to Render and preserves query and hash", () => {
    expect(
      getGitHubPagesRedirectUrl(
        "https://owca217.github.io/WEB_MMORPG/?ref=old#login"
      )
    ).toBe("https://web-mmorpg-server.onrender.com/?ref=old#login");
  });

  it("does not redirect unrelated hosts or lookalike Pages hostnames", () => {
    expect(getGitHubPagesRedirectUrl("https://example.com/WEB_MMORPG/")).toBeNull();
    expect(
      getGitHubPagesRedirectUrl(
        "https://owca217.github.io.attacker.test/WEB_MMORPG/"
      )
    ).toBeNull();
  });
});
