import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseStylesheet, type Scope } from "../src/parse.js";
import { resolveCss } from "../src/resolve.js";

/**
 * The shadow-DOM host is the base scope. Lit / Shoelace / Stencil / Material-Web
 * stylesheets declare their tokens on `:host { … }` with `:host(.dark) { … }`
 * for the dark palette; until this slice those blocks filed under `other`, no
 * base theme existed and a real collision audited green ("Silence is never read
 * as intent").
 *
 * A bare `:host` (whole prelude, case-folded) is the base at rank 1, below every
 * `:root` spelling; `:host(<compound>)` is read through its argument, because the
 * argument of `:host()` is the host element's own compound. `:host-context()`,
 * `::slotted()`, `:host .child` and `:host(.a) .b` keep their `other` reading.
 */

const kind = (css: string) => parseStylesheet(`${css} { --x: 1px; }`).scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`);
const rootScopeOf = (css: string): Scope[] => parseStylesheet(css).scopes.filter((s) => s.kind === "root");

describe("scope kind and theme of the :host spellings", () => {
  const table: [string, string[]][] = [
    [":host", ["root/-"]],
    [":HOST", ["root/-"]],
    [":where(:host)", ["root/-"]],
    [":is(:host)", ["root/-"]],
    [":host(.dark)", ["theme/dark"]],
    [":host(.light)", ["theme/light"]],
    [":HOST(.dark)", ["theme/dark"]],
    [":host( .dark )", ["theme/dark"]],
    [':host([data-theme="dark"])', ["theme/dark"]],
    [":host([data-theme=dark])", ["theme/dark"]],
    [':host([data-bs-theme="dark"])', ["theme/dark"]],
    [":host(.dark), .dark", ["theme/dark"]],
    // unchanged readings
    [":host-context(.dark)", ["other/-"]],
    [':host-context([data-theme="winter"])', ["other/-"]],
    ["::slotted(.dark)", ["other/-"]],
    [":host .child", ["other/-"]],
    [":host(.dark) .child", ["other/-"]],
    [":host > .child", ["other/-"]],
    [":host:hover", ["other/-"]],
    [":host(.dark):hover", ["other/-"]],
    [":host(.card)", ["other/-"]],
    [":host(.dark.card)", ["other/-"]],
    [":host(html)", ["other/-"]],
    [":host(:root)", ["other/-"]],
    [":host(:not(.dark))", ["other/-"]],
    [":host, body", ["other/-"]],
    [":where(:host, body)", ["other/-"]],
  ];
  for (const [selector, expected] of table) {
    it(`${selector} → ${expected.join(",")}`, () => {
      expect(kind(selector)).toEqual(expected);
    });
  }

  it("a configured class theme works under :host() exactly as on html", () => {
    const scopes = parseStylesheet(":host(.theme-dark) { --x: 1px; }", { themes: ["theme-dark"] }).scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["theme/theme-dark"]);
  });

  it("carries its cascade rank", () => {
    expect(rootScopeOf(":host { --x: 1px; }").map((s) => s.baseRank)).toEqual([1]);
    expect(rootScopeOf(":is(:host) { --x: 1px; }").map((s) => s.baseRank)).toEqual([1]);
    expect(rootScopeOf(":where(:host) { --x: 1px; }").map((s) => s.baseRank)).toEqual([0]);
    expect(rootScopeOf(":root { --x: 1px; }").map((s) => s.baseRank)).toEqual([2]);
  });
});

const BASE = "\n  --bg: #ffffff;\n  --surface: #f4f4f4;\n";
const DARK = "\n  --bg: #101010;\n  --surface: #101010;\n";
const sheet = (base: string, dark: string) =>
  `${base} {${BASE}}\n${dark} {${DARK}}\n.a { color: var(--bg); background: var(--surface); }\n`;

const summarise = (css: string) => {
  const r = audit(resolveCss(css));
  return {
    themes: r.coverage.map((c) => c.theme),
    findings: r.findings.map((f) => `${f.rule}: ${f.message}`).sort(),
  };
};

describe(":host / :host(.dark) report exactly like their :root / :root.dark twin", () => {
  const twin = summarise(sheet(":root", ":root.dark"));

  it("the :root twin reports the dark collision", () => {
    expect(twin.themes).toEqual(["root", "dark"]);
    expect(twin.findings.some((f) => f.startsWith("collision:") && f.includes('"dark"'))).toBe(true);
  });

  it(":host / :host(.dark) is byte-identical to the twin", () => {
    expect(summarise(sheet(":host", ":host(.dark)"))).toEqual(twin);
  });

  it(":host / :host([data-theme=dark]) is byte-identical to the attribute twin", () => {
    expect(summarise(sheet(":host", ":host([data-theme=dark])"))).toEqual(
      summarise(sheet(":root", ':root[data-theme="dark"]')),
    );
  });

  it(":root, :host / :host(.dark) (Tailwind v4 / Shoelace) is not silent", () => {
    expect(summarise(sheet(":root, :host", ":host(.dark)"))).toEqual(twin);
  });
});

describe("`:root, :host` stays byte-identical — the host member mints no second base scope", () => {
  const css = `:root, :host {${BASE}}\n.a { color: var(--bg); }\n`;
  const rootOnly = `:root {${BASE}}\n.a { color: var(--bg); }\n`;

  it("opens exactly one root scope, at the :root rank", () => {
    expect(rootScopeOf(css).map((s) => s.baseRank)).toEqual([2]);
    expect(rootScopeOf(`:host, :root {${BASE}}`).map((s) => s.baseRank)).toEqual([2]);
  });

  it("parses to the same scopes and audits to the same report as :root alone", () => {
    const strip = (c: string) =>
      parseStylesheet(c).scopes.map((s) => ({ kind: s.kind, theme: s.theme, n: s.declarations.length }));
    expect(strip(css)).toEqual(strip(rootOnly));
    expect(summarise(css)).toEqual(summarise(rootOnly));
  });
});

describe("cascade precedence against :host", () => {
  const bgIn = (css: string) => resolveCss(css).token("--bg", "root")?.declaredValue;

  it(":root beats :host from either side", () => {
    expect(bgIn(":root { --bg: red; }\n:host { --bg: blue; }")).toBe("red");
    expect(bgIn(":host { --bg: blue; }\n:root { --bg: red; }")).toBe("red");
  });

  it(":where(:host) loses to :host from either side", () => {
    expect(bgIn(":host { --bg: blue; }\n:where(:host) { --bg: green; }")).toBe("blue");
    expect(bgIn(":where(:host) { --bg: green; }\n:host { --bg: blue; }")).toBe("blue");
  });

  it("within :host the fold stays document order", () => {
    expect(bgIn(":host { --bg: red; }\n:host { --bg: blue; }")).toBe("blue");
  });
});
