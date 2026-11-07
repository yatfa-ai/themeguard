import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";

const kinds = (css: string) =>
  parseStylesheet(css).scopes.map((s) => [s.kind, s.theme]);

describe("unclosed :not() argument list", () => {
  it("drops the unclosed negation, so the attribute inside it cannot decide the scope", () => {
    expect(kinds(':root:not([data-theme="winter"] { --x: 1px; }')).toEqual([["root", null]]);
  });
  it("keeps classifying the compound in front of the unclosed list", () => {
    expect(kinds('[data-theme="dark"]:not(.a { --x: 1px; }')).toEqual([["theme", "dark"]]);
  });
  it("leaves nothing to classify when the unclosed negation is the whole selector", () => {
    expect(kinds(":not(.a { --x: 1px; }")).toEqual([["other", null]]);
  });
  it("agrees with the closed form (control arm)", () => {
    expect(kinds(':root:not([data-theme="winter"]) { --x: 1px; }')).toEqual([["root", null]]);
  });
});

describe("unclosed functional pseudo argument list", () => {
  it("does not read a theme out of an unclosed :has() on a non-scope compound", () => {
    expect(kinds('.card:has([data-theme="winter"] { --x: 1px; }')).toEqual([["other", null]]);
  });
  it("does not read a theme out of an unclosed :has() behind :root", () => {
    expect(kinds(':root:has([data-theme="winter"] { --x: 1px; }')).toEqual([["root", null]]);
  });
});

describe("nested parens inside a functional pseudo argument list", () => {
  it("closes a :not() at its matching paren, not at the first one", () => {
    expect(kinds(':root:not(:not(.a)[data-theme="winter"]) { --x: 1px; }')).toEqual([["root", null]]);
  });
  it("closes a :has() at its matching paren, not at the first one", () => {
    expect(kinds('.card:has(:nth-child(2)[data-theme="winter"]) { --x: 1px; }')).toEqual([["other", null]]);
  });
});
