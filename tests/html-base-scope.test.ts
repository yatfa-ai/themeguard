import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseStylesheet, type Scope } from "../src/parse.js";
import { resolveCss } from "../src/resolve.js";
import { CENSUS, fixtureCss } from "./fixture.js";

/**
 * The document element is the base scope. `:root` names the `html` element
 * with class-level specificity, but real stylesheets spell the base palette
 * on the element itself — `html { --tokens… }` (design systems that never
 * write `:root`), `:where(html) { … }` (the zero-specificity reset idiom) and
 * `:is(html)` — and until this slice those blocks filed under `other`: no
 * theme table, no base tokens, and every base-reading rule silent on a sheet
 * it had, in truth, read half of.
 *
 * The recognition is deliberately the EXACT spelling — the compound must be
 * `html` alone (case-folded, `:is()`/`:where()` arguments pulled out and
 * nothing left around them) — so every narrowed shape keeps its current
 * `other` reading: `html .card`, `html:not(.dark)`, `html:hover`,
 * `html::before`, `html:has(…)`, a bare `body`, and the `html, body` union
 * (body's half scopes a subtree). `body` stays out on purpose: it is a
 * DESCENDANT of the element `:root` names, so its declarations scope a
 * subtree — the component-override shape — and folding them into the base
 * would report a token narrowed to one element as the document's value.
 *
 * Because the admitted shapes are exactly three, their cascade order is a
 * three-value key the parser stamps on each root scope (`baseRank`) and the
 * resolver sorts on before its document-order fold: `:root` (rank 2) beats a
 * bare `html` (rank 1) from either side, `:where(html)` (rank 0) loses to
 * both, and within one rank the fold stays document order — the reading two
 * `:root` blocks have always had, so existing sheets fold exactly as before.
 */

const BASE = "\n  --surface: #ffffff;\n  --card: #ffffff;\n";
const DARK = "\n  --surface: #101010;\n  --card: #1c1c1c;\n";
const withBase = (selector: string) => `${selector} {${BASE}}\n[data-theme="dark"] {${DARK}}\n.a { color: var(--surface); background: var(--card); }\n`;

const summarise = (css: string) => {
  const r = audit(resolveCss(css));
  return {
    themes: r.coverage.map((c) => c.theme),
    findings: r.findings.map((f) => `${f.rule}: ${f.message}`).sort(),
  };
};

const rootScopeOf = (css: string): Scope[] =>
  parseStylesheet(css).scopes.filter((s) => s.kind === "root");

describe("the document element spellings report their :root twin's findings", () => {
  const twin = summarise(withBase(":root"));

  it("the :root twin reports the light collision and the dark theme", () => {
    expect(twin.themes).toEqual(["root", "dark"]);
    expect(twin.findings).toHaveLength(1);
    expect(twin.findings[0]).toContain('collision: --card and --surface both resolve to #FFFFFF in theme "root"');
  });

  for (const selector of ["html", ":where(html)", ":is(html)", "html:root", "HTML"]) {
    it(`${selector} is byte-identical to its :root twin`, () => {
      expect(summarise(withBase(selector))).toEqual(twin);
    });
  }

  it("html scopes carry their specificity rank", () => {
    expect(rootScopeOf(withBase(":root")).map((s) => s.baseRank)).toEqual([2]);
    expect(rootScopeOf(withBase("html")).map((s) => s.baseRank)).toEqual([1]);
    expect(rootScopeOf(withBase("html:root")).map((s) => s.baseRank)).toEqual([2]);
    expect(rootScopeOf(withBase(":where(html)")).map((s) => s.baseRank)).toEqual([0]);
    expect(rootScopeOf(withBase(":is(html)")).map((s) => s.baseRank)).toEqual([1]);
  });
});

describe("an OS-preference palette on the document element", () => {
  const flatTwin = summarise(
    `:root {${BASE}}\n@media (prefers-color-scheme: dark) { :root {${DARK}} }\n.a { color: var(--surface); background: var(--card); }\n`,
  );

  it("the :root spelling is the dark theme beside the base", () => {
    expect(flatTwin.themes).toEqual(["root", "dark"]);
    expect(flatTwin.findings.some((f) => f.startsWith("collision:") && f.includes('in theme "root"'))).toBe(true);
  });

  it("@media (prefers-color-scheme: dark) { html { … } } is the same dark theme", () => {
    expect(
      summarise(
        `:root {${BASE}}\n@media (prefers-color-scheme: dark) { html {${DARK}} }\n.a { color: var(--surface); background: var(--card); }\n`,
      ),
    ).toEqual(flatTwin);
  });

  it("the nested writing html { @media … { … } } too", () => {
    expect(
      summarise(
        `:root {${BASE}}\nhtml { @media (prefers-color-scheme: dark) {${DARK}} }\n.a { color: var(--surface); background: var(--card); }\n`,
      ),
    ).toEqual(flatTwin);
  });
});

describe("what is still NOT the base scope", () => {
  // body was the silent control before this slice; the pinned shapes must
  // stay exactly as silent as it is.
  const control = summarise(`body {${BASE}}\n[data-theme="dark"] {${DARK}}\n.a { color: var(--surface); background: var(--card); }\n`);

  for (const selector of [
    "body",
    "html, body",
    ":is(html, body)",
    ":where(html, body)",
    "html .card",
    "html:not(.dark)",
    "html:hover",
    "html::before",
    "html:has(.dark)",
  ]) {
    it(`${selector} keeps the body reading — no base tokens, no findings`, () => {
      expect(summarise(`${selector} {${BASE}}\n[data-theme="dark"] {${DARK}}\n.a { color: var(--surface); background: var(--card); }\n`)).toEqual(control);
      expect(control.themes).toEqual(["root", "dark"]);
      expect(control.findings).toEqual([]);
    });
  }

  it("the pinned shapes parse as other scopes, never root", () => {
    for (const selector of ["body", "html, body", ":is(html, body)", "html .card", "html:not(.dark)", "html:hover", "html::before", "html:has(.dark)"]) {
      const scopes = parseStylesheet(`${selector} {${BASE}}`).scopes;
      expect(scopes.map((s) => s.kind)).toEqual(["other"]);
    }
  });
});

describe("the theme spellings on the element keep their reading", () => {
  // A light base plus the dark palette under the spelling under test.
  const withDark = (darkSelector: string) => `:root {${BASE}}\n${darkSelector} {${DARK}}\n.a { color: var(--surface); background: var(--card); }\n`;
  const darkTwin = summarise(withDark('[data-theme="dark"]'));

  it("the attribute twin: the light collision stays in root, the dark theme stays clean", () => {
    expect(darkTwin.themes).toEqual(["root", "dark"]);
    expect(darkTwin.findings).toHaveLength(1);
    expect(darkTwin.findings[0]).toContain('collision: --card and --surface both resolve to #FFFFFF in theme "root"');
  });

  for (const darkSelector of ["html.dark", "html[data-theme=dark]", "HTML.dark"]) {
    it(`${darkSelector} reports exactly the attribute twin's findings — never a base scope`, () => {
      expect(summarise(withDark(darkSelector))).toEqual(darkTwin);
    });
  }
});

describe("cascade precedence across the base spellings", () => {
  const surfaceIn = (css: string) => resolveCss(css).token("--surface", "root")?.declaredValue;

  it(":root beats html from either side", () => {
    expect(surfaceIn(":root { --surface: red; }\nhtml { --surface: blue; }")).toBe("red");
    expect(surfaceIn("html { --surface: blue; }\n:root { --surface: red; }")).toBe("red");
  });

  it(":where(html) loses to html from either side", () => {
    expect(surfaceIn("html { --surface: blue; }\n:where(html) { --surface: green; }")).toBe("blue");
    expect(surfaceIn(":where(html) { --surface: green; }\nhtml { --surface: blue; }")).toBe("blue");
  });

  it(":where(html) loses to :root from either side", () => {
    expect(surfaceIn(":root { --surface: red; }\n:where(html) { --surface: green; }")).toBe("red");
    expect(surfaceIn(":where(html) { --surface: green; }\n:root { --surface: red; }")).toBe("red");
  });

  it(":is(html) ties a bare html block — document order decides, as the cascade does", () => {
    expect(surfaceIn(":is(html) { --surface: green; }\nhtml { --surface: blue; }")).toBe("blue");
    expect(surfaceIn("html { --surface: blue; }\n:is(html) { --surface: green; }")).toBe("green");
  });

  it("within one spelling the fold stays document order — two :root blocks as always", () => {
    expect(surfaceIn(":root { --surface: red; }\n:root { --surface: blue; }")).toBe("blue");
    expect(surfaceIn("html { --surface: red; }\nhtml { --surface: blue; }")).toBe("blue");
  });

  it("a :where anywhere in the wrapping chain zeroes the rank — both nestings", () => {
    expect(rootScopeOf(":where(:is(html)) { --surface: red; }").map((s) => s.baseRank)).toEqual([0]);
    expect(rootScopeOf(":is(:where(html)) { --surface: red; }").map((s) => s.baseRank)).toEqual([0]);
  });
});

describe("nesting under the element spelling", () => {
  it("a nested & inside html is the base scope, exactly as inside :root", () => {
    const css = "html { --surface: red; & { --card: blue; } }\n";
    expect(rootScopeOf(css).map((s) => s.matchedSelector)).toEqual(["html", "html"]);
    expect(resolveCss(css).token("--card", "root")?.declaredValue).toBe("blue");
  });

  it("a nested descendant keeps its other reading", () => {
    expect(parseStylesheet("html { & body { --card: blue; } }").scopes.map((s) => s.kind)).toEqual(["other"]);
  });
});

describe("the vendored calibration fixture is untouched", () => {
  it("its census is still the pinned all-:root one", () => {
    const sheet = parseStylesheet(fixtureCss());
    expect(sheet.scopes.filter((s) => s.kind === "root")).toHaveLength(1);
    expect(sheet.scopes.every((s) => s.baseRank === undefined || s.baseRank === 2)).toBe(true);
    expect(CENSUS.root).toBe(73);
  });
});
