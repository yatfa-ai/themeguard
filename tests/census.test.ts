import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";
import { CENSUS, fixtureCss } from "./fixture.js";

/**
 * Success criterion 1 — CENSUS.
 *
 * Parsing the vendored fixture must yield every custom property with its theme
 * context, and the three-way split must match the stated baseline.
 *
 * Several of these are also success criterion 4's REVERT PROBES: the winter-block
 * test and the `@theme inline` test each fail on their own if that shape's
 * handling is removed, so no shape is passing by accident.
 */
describe("census of the vendored calibration stylesheet", () => {
  const sheet = parseStylesheet(fixtureCss());
  const root = sheet.scopes.filter((s) => s.kind === "root");
  const winter = sheet.scopes.filter((s) => s.kind === "theme" && s.theme === "winter");
  const inline = sheet.scopes.filter((s) => s.kind === "theme-inline");

  it("finds exactly one block of each of the three declaration shapes, at its documented line", () => {
    expect(root).toHaveLength(1);
    expect(root[0].line).toBe(17);

    expect(winter).toHaveLength(1);
    expect(winter[0].line).toBe(414);
    expect(winter[0].selector).toBe('[data-theme="winter"]');

    expect(inline).toHaveLength(1);
    expect(inline[0].line).toBe(632);
    expect(inline[0].selector).toBe("@theme inline");
  });

  it("counts 73 declarations in the :root block, all names unique", () => {
    const names = root[0].declarations.map((d) => d.name);
    expect(names).toHaveLength(CENSUS.root);
    expect(new Set(names).size).toBe(CENSUS.root);
  });

  // REVERT PROBE — delete the `[data-theme=…]` branch of `classify()` and this
  // test fails on its own: the winter block would be reported as `other`, so
  // `winter` above is empty and the count is 0, not 51.
  it("counts 51 declarations in the [data-theme=\"winter\"] block, all names unique", () => {
    const names = winter[0].declarations.map((d) => d.name);
    expect(names).toHaveLength(CENSUS.winter);
    expect(new Set(names).size).toBe(CENSUS.winter);
  });

  // REVERT PROBE — delete the `@theme` branch of `classify()` and this test fails
  // on its own: the at-rule is then treated as a nesting at-rule, recursed into,
  // and its 64 declarations are never collected.
  it("counts 64 declarations in the @theme inline block, all names unique and all var() aliases", () => {
    const decls = inline[0].declarations;
    expect(decls).toHaveLength(CENSUS.themeInline);
    expect(new Set(decls.map((d) => d.name)).size).toBe(CENSUS.themeInline);
    expect(decls.every((d) => /^var\(--[\w-]+\)$/.test(d.value))).toBe(true);
  });

  it("totals 188 declarations across the three shapes", () => {
    const total =
      root[0].declarations.length +
      winter[0].declarations.length +
      inline[0].declarations.length;
    expect(total).toBe(CENSUS.total);
    expect(CENSUS.root + CENSUS.winter + CENSUS.themeInline).toBe(CENSUS.total);
  });

  it("carries theme context and a true source line on every declaration", () => {
    const secondary = root[0].declarations.find((d) => d.name === "--app-secondary");
    expect(secondary).toBeDefined();
    // #29364D is declared at :28, after the multi-line comment that explains it.
    expect(secondary?.line).toBe(28);
    expect(secondary?.value).toBe("#29364D");
    expect(root[0].theme).toBeNull();
    expect(winter[0].theme).toBe("winter");
  });

  it("reports custom properties declared outside the three shapes without losing them", () => {
    // :1442 declares --vd-annotations-width on a component class. It is not part
    // of the theme system, but it must not be silently dropped either.
    const other = sheet.scopes.filter((s) => s.kind === "other");
    const names = other.flatMap((s) => s.declarations.map((d) => d.name));
    expect(names).toContain("--vd-annotations-width");
  });

  it("does not mistake a --token: value written inside a COMMENT for a declaration", () => {
    // This is the whole reconciliation: a naive line grep of :root returns 74-75.
    const names = root[0].declarations.map((d) => d.name);
    // The :root comment at :18-26 discusses --app-surface-raised and
    // --app-secondary in prose; only the real declarations may be counted.
    expect(names.filter((n) => n === "--app-secondary")).toHaveLength(1);
    expect(names.filter((n) => n === "--app-surface-raised")).toHaveLength(1);
  });
});

describe("a selector LIST opens every scope it names (audit YATFA-6991)", () => {
  // REVERT PROBE — collapse `classifySelectors` back to classifying the whole
  // prelude as one selector (i.e. let the `[data-theme=…]` branch win for the
  // whole list) and every test in this block fails: the `:root` half is
  // discarded silently, with nothing thrown and no scope reported for it.
  const css = `:root, [data-theme="dark"] { --bg: #020617; --fg: #F8FAFC; }
               [data-theme="light"] { --bg: #FFFFFF; }`;
  const scopes = parseStylesheet(css).scopes;

  it('reports :root, [data-theme="dark"] as BOTH a root scope and a dark theme scope', () => {
    expect(scopes.map((s) => s.kind)).toEqual(["root", "theme", "theme"]);
    expect(scopes.map((s) => s.theme)).toEqual([null, "dark", "light"]);
  });

  it("gives both halves the same declarations, and says which selector each came from", () => {
    const root = scopes.find((s) => s.kind === "root");
    const dark = scopes.find((s) => s.theme === "dark");
    expect(root?.declarations.map((d) => d.name)).toEqual(["--bg", "--fg"]);
    expect(dark?.declarations.map((d) => d.name)).toEqual(["--bg", "--fg"]);
    expect(root?.matchedSelector).toBe(":root");
    expect(dark?.matchedSelector).toBe('[data-theme="dark"]');
    // The full prelude is preserved on both, so the list is still recoverable.
    expect(root?.selector).toBe(':root, [data-theme="dark"]');
    expect(dark?.selector).toBe(':root, [data-theme="dark"]');
  });

  it("does not depend on the order the list is written in", () => {
    const reversed = parseStylesheet('[data-theme="dark"], :root { --a: #fff; }').scopes;
    expect(reversed.map((s) => s.kind).sort()).toEqual(["root", "theme"]);
  });

  it("still reports an ordinary selector list as ONE scope", () => {
    const ordinary = parseStylesheet(".card, .panel { --pad: 8px; }").scopes;
    expect(ordinary).toHaveLength(1);
    expect(ordinary[0].kind).toBe("other");
  });

  it("does not split a comma nested inside :is(), [attr] or a string", () => {
    expect(parseStylesheet(":is(.a, .b) { --x: 1px; }").scopes).toHaveLength(1);
    expect(parseStylesheet('[title="a,b"] { --x: 1px; }').scopes).toHaveLength(1);
  });
});

describe(":not() says what a selector is NOT, so it never names the scope's theme", () => {
  // A deliberate decision, not regex ordering: reading `winter` out of a
  // negation would file DARK's declarations under the LIGHT theme.
  it("classifies the dark-default idiom :root:not([data-theme]) as the ROOT scope", () => {
    const scopes = parseStylesheet(":root:not([data-theme]) { --bg: #020617; }").scopes;
    expect(scopes).toHaveLength(1);
    expect(scopes[0].kind).toBe("root");
    expect(scopes[0].theme).toBeNull();
  });

  it("does not read a theme name out of a negated attribute", () => {
    const scopes = parseStylesheet(':root:not([data-theme="winter"]) { --bg: #020617; }').scopes;
    expect(scopes[0].kind).toBe("root");
    expect(scopes[0].theme).toBeNull();
  });

  it("still reads a theme name from a NON-negated attribute on the same selector", () => {
    const scopes = parseStylesheet('[data-theme="winter"]:not(.print) { --bg: #fff; }').scopes;
    expect(scopes[0].kind).toBe("theme");
    expect(scopes[0].theme).toBe("winter");
  });
});

describe("census of a minimal hand-written stylesheet", () => {
  // themeguard is not yatfa-specific: the same parser must work on any CSS.
  const css = `
    :root { --a: #fff; /* --not-a-decl: #000; */ --b: 4px; }
    [data-theme="sepia"] { --a: #eec; }
    @theme inline { --color-a: var(--a); }
    @media (min-width: 40rem) { :root { --c: 2rem; } }
  `;

  it("finds every shape including a :root nested inside @media", () => {
    const scopes = parseStylesheet(css).scopes;
    expect(scopes.map((s) => s.kind).sort()).toEqual(["root", "root", "theme", "theme-inline"]);
    const names = scopes.flatMap((s) => s.declarations.map((d) => d.name));
    expect(names.sort()).toEqual(["--a", "--a", "--b", "--c", "--color-a"]);
  });
});
