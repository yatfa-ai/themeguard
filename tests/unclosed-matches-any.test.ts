import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";

// An UNCLOSED `:is(` / `:where(` argument list runs to the end of the selector
// (extractMatchesAny, src/parse.ts): its arguments are still looked through as
// scopes, and the compound in front of it is still classified.
const scopes = (css: string) =>
  parseStylesheet(css).scopes.map((s) => [s.kind, s.theme, s.matchedSelector]);

describe("unclosed :is()/:where() argument list", () => {
  it("still opens every scope its arguments name", () => {
    expect(scopes(':is(:root, [data-theme="dark"] { --x: 1px; }')).toEqual([
      ["root", null, ":root"],
      ["theme", "dark", '[data-theme="dark"]'],
    ]);
    expect(scopes(':where([data-theme="dark"] { --x: 1px; }')).toEqual([
      ["theme", "dark", '[data-theme="dark"]'],
    ]);
  });

  it("keeps classifying the compound in front of the unclosed list", () => {
    expect(scopes(":root:is(.a, .b { --x: 1px; }").map((s) => [s[0], s[1]])).toEqual([
      ["root", null],
    ]);
  });

  it("agrees with the closed form (control arm)", () => {
    expect(scopes(':is(:root, [data-theme="dark"]) { --x: 1px; }')).toEqual([
      ["root", null, ":root"],
      ["theme", "dark", '[data-theme="dark"]'],
    ]);
  });
});
