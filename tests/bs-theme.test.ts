import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseStylesheet } from "../src/parse.js";
import { resolveCss } from "../src/resolve.js";

/**
 * Bootstrap 5.3 colour modes — `[data-bs-theme=dark]` — are themes exactly as
 * `[data-theme=dark]` is: the theme is the attribute VALUE. The built-in
 * attribute-name set is `data-theme`, `data-bs-theme`; any other name is a theme only when
 * `themeAttributes` configures it (see attribute-theme.test.ts).
 */

const ROOT = `
  :root {
    --background: #ffffff;
    --card: #ffffff;
    --foreground: #0a0a0a;
    --muted: #f5f5f5;
    --border: #e5e5e5;
    --primary: #171717;
  }
`;
const DARK_BODY = `
  --background: #0a0a0a;
  --card: #262626;
  --foreground: #fafafa;
  --muted: #262626;
  --border: #262626;
  --primary: #fafafa;
`;
const withSelector = (selector: string) => `${ROOT}\n${selector} {${DARK_BODY}}\n`;

const scopesOf = (css: string) =>
  parseStylesheet(css).scopes.map((s) => ({ kind: s.kind, theme: s.theme }));

const summarise = (css: string) => {
  const r = audit(resolveCss(css));
  return {
    themes: r.coverage.map((c) => c.theme),
    collisions: r.findings
      .filter((f) => f.rule === "collision")
      .map((f) => `${f.theme}: ${f.tokens.join(" == ")}`)
      .sort(),
  };
};

describe("[data-bs-theme] is a theme like [data-theme]", () => {
  const twin = summarise(withSelector('[data-theme="dark"]'));

  it("the data-theme twin reports two themes", () => {
    expect(twin.themes).toEqual(["root", "dark"]);
  });

  for (const selector of [
    '[data-bs-theme="dark"]',
    "[data-bs-theme=dark]",
    "[data-bs-theme='dark']",
    "[ data-bs-theme = dark ]",
  ]) {
    it(`${selector} reports the same findings as [data-theme="dark"]`, () => {
      expect(summarise(withSelector(selector))).toEqual(twin);
    });
  }

  it("`:root, [data-bs-theme=light]` opens root AND light", () => {
    const css = `:root, [data-bs-theme=light] { --a: #fff; }`;
    expect(scopesOf(css)).toEqual(scopesOf(`:root, [data-theme=light] { --a: #fff; }`));
    expect(scopesOf(css)).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "light" },
    ]);
  });

  it("both attribute names for one theme land in one table", () => {
    const css = `${ROOT}
      [data-theme="dark"] { --background: #0a0a0a; }
      [data-bs-theme=dark] { --card: #262626; }`;
    const r = resolveCss(css);
    expect(r.themes.filter((t) => t === "dark")).toHaveLength(1);
    expect(r.token("--background", "dark")?.resolvedValue).toBe("#0a0a0a");
    expect(r.token("--card", "dark")?.resolvedValue).toBe("#262626");
  });

  it("a compound subject classifies as a theme, same as [data-theme]", () => {
    const bs = scopesOf(`.navbar[data-bs-theme=dark] { --a: #000; }`);
    expect(bs).toEqual(scopesOf(`.navbar[data-theme=dark] { --a: #000; }`));
    expect(bs).toEqual([{ kind: "theme", theme: "dark" }]);
  });

  it("[data-mode=dark] is not a theme", () => {
    expect(scopesOf(`[data-mode="dark"] { --a: #000; }`)).toEqual([{ kind: "other", theme: null }]);
    expect(scopesOf(`:root[data-mode="dark"] { --a: #000; }`)).toEqual([
      { kind: "root", theme: null },
    ]);
  });

  it("a descendant [data-bs-theme=dark] .form-select stays other", () => {
    expect(scopesOf(`[data-bs-theme=dark] .form-select { --a: #000; }`)).toEqual([
      { kind: "other", theme: null },
    ]);
  });

  it(":root:not([data-bs-theme]) is still the base scope", () => {
    expect(scopesOf(`:root:not([data-bs-theme]) { --a: #000; }`)).toEqual([
      { kind: "root", theme: null },
    ]);
  });
});
