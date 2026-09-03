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
