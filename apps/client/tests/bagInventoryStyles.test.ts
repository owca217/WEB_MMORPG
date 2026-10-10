import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import postcss, { type AtRule, type Rule } from "postcss";

describe("bag inventory responsive styles", () => {
  it("keeps the mobile checkerboard off the bag contents background", () => {
    const stylesheet = readFileSync(new URL("../src/theme/classic-rpg.css", import.meta.url), "utf8");
    const root = postcss.parse(stylesheet);
    const responsiveStyles = root.nodes.find(
      (node): node is AtRule => node.type === "atrule" && node.params === "(max-width: 600px)"
    );
    const checkerboardRules: string[] = [];

    responsiveStyles?.walkRules((rule: Rule) => {
      if (rule.nodes?.some((node) =>
        node.type === "decl" &&
        node.prop === "background" &&
        node.value.includes("repeating-linear-gradient(to right")
      )) {
        checkerboardRules.push(rule.selector);
      }
    });

    expect(checkerboardRules).toEqual([
      'body[data-game-ui-theme="classic-rpg"] .game-panel--inventory .inventory-list:not(.inventory-list--bag)'
    ]);
  });
});
