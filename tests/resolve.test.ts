import { describe, expect, it } from "vitest";
import { toCss } from "../src/color.js";
import { resolveCss, ROOT_THEME } from "../src/resolve.js";
import { CENSUS, fixtureCss } from "./fixture.js";

const sheet = resolveCss(fixtureCss());

describe("theme-keyed resolution of the calibration stylesheet", () => {
  it("discovers the themes from the source, root first", () => {
    expect(sheet.themes).toEqual([ROOT_THEME, "winter"]);
  });

  it("resolves a plain declaration in its own theme", () => {
    const dark = sheet.token("--app-secondary", ROOT_THEME);
    expect(dark?.origin).toBe("declared");
    expect(dark?.kind).toBe("color");
    expect(dark?.resolvedValue).toBe("#29364D");
    expect(dark?.chain).toEqual(["--app-secondary"]);

    const light = sheet.token("--app-secondary", "winter");
    expect(light?.origin).toBe("declared");
    expect(light?.resolvedValue).toBe("#CBD5E1");
  });
});

/**
 * REVERT PROBE — `var()` RESOLUTION (success criterion 4).
 *
 * Delete the `var()` chain-following loop in `resolveValue` and every test in
 * this block fails: an alias resolves to the literal text `var(--app-cta)`,
 * classified `non-color`, with a chain of length 1 and no colour.
 */
describe("var() indirection resolves per theme", () => {
  it("resolves an @theme inline alias to the value of its target IN THE CURRENT THEME", () => {
    const dark = sheet.token("--color-app-cta", ROOT_THEME);
    expect(dark?.kind).toBe("color");
    expect(dark?.resolvedValue).toBe("#22C55E");
    expect(dark?.chain).toEqual(["--color-app-cta", "--app-cta"]);

    const light = sheet.token("--color-app-cta", "winter");
    expect(light?.kind).toBe("color");
    // The SAME alias resolves to a DIFFERENT colour in winter. That is the whole
    // point of `@theme inline`, and the reason aliases are resolved per theme.
    expect(light?.resolvedValue).toBe("#16A34A");
  });

  it("resolves an indirection declared INSIDE a theme block (fixture :462)", () => {
    // winter: --app-info-toast-surface: var(--app-info-surface) -> #dbeafe
    const t = sheet.token("--app-info-toast-surface", "winter");
    expect(t?.declaredValue).toBe("var(--app-info-surface)");
    expect(t?.resolvedValue).toBe("#dbeafe");
    expect(t?.chain).toEqual(["--app-info-toast-surface", "--app-info-surface"]);
  });

  it("resolves a two-hop chain: alias -> theme override -> literal", () => {
    const t = sheet.token("--color-app-info-toast-surface", "winter");
    expect(t?.chain).toEqual([
      "--color-app-info-toast-surface",
      "--app-info-toast-surface",
      "--app-info-surface",
    ]);
    expect(t?.resolvedValue).toBe("#dbeafe");
  });

  it("resolves all 64 @theme inline aliases in both themes, none left as raw var() text", () => {
    for (const theme of sheet.themes) {
      const aliases = sheet
        .tokensFor(theme)
        .filter((t) => t.origin === "theme-inline" || t.chain[0].startsWith("--color-app-"));
      // 58 of the 64 are --color-app-*; the other 6 are Tailwind's --shadow-app,
      // --radius-app-* and --spacing-app-* namespaces, aliased the same way.
      expect(aliases).toHaveLength(CENSUS.themeInline);
      expect(aliases.filter((t) => t.name.startsWith("--color-app-"))).toHaveLength(58);
      expect(aliases.every((t) => t.chain.length > 1)).toBe(true);
      expect(aliases.some((t) => t.resolvedValue?.startsWith("var("))).toBe(false);
    }
  });
});

/**
 * REVERT PROBE — the WINTER BLOCK (success criterion 4).
 *
 * Delete the `[data-theme=…]` branch of `classify()` and this block fails:
 * `sheet.themes` collapses to `["root"]`, so every winter lookup is undefined.
 */
describe("theme override and theme ABSENCE are both first class", () => {
  it("prefers a theme's own declaration over the :root value", () => {
    expect(sheet.token("--app-background", ROOT_THEME)?.resolvedValue).toBe("#020617");
    expect(sheet.token("--app-background", "winter")?.resolvedValue).toBe("#F8FAFC");
    expect(sheet.token("--app-background", "winter")?.origin).toBe("declared");
  });

  it("marks a token winter does not override as INHERITED, not missing and not an error", () => {
    // Fixture :466 states it outright: "the focus geometry and control geometry
    // tokens in :root are theme-independent and deliberately have no winter value".
    const t = sheet.token("--app-focus-ring-width", "winter");
    expect(t).toBeDefined();
    expect(t?.origin).toBe("inherited");
    expect(t?.resolvedValue).toBe("2px");
    expect(t?.kind).toBe("non-color");
  });

  it("lists the 22 :root tokens winter legitimately lacks", () => {
    const winterAbsences = sheet.absences.filter((a) => a.theme === "winter");
    expect(winterAbsences).toHaveLength(CENSUS.winterAbsences);
    // 73 :root tokens - 51 winter declarations = 22 with no winter value.
    expect(CENSUS.root - CENSUS.winter).toBe(CENSUS.winterAbsences);
    expect(winterAbsences.map((a) => a.name)).toContain("--app-radius-control");
  });

  it("records no absences for the root theme itself", () => {
    expect(sheet.absences.filter((a) => a.theme === ROOT_THEME)).toHaveLength(0);
  });
});

describe("translucent and non-colour values are represented, never coerced", () => {
  it("marks the translucent :root fills as translucent WITHOUT compositing them", () => {
    const t = sheet.token("--app-success-surface", ROOT_THEME);
    expect(t?.kind).toBe("color");
    expect(t?.translucent).toBe(true);
    expect(t?.resolvedValue).toBe("rgba(34, 197, 94, 0.15)");
    expect(t?.color?.a).toBeCloseTo(0.15, 10);
    // No backdrop was invented: the value is reported exactly as declared.
    expect(toCss(t!.color!)).toBe("rgba(34, 197, 94, 0.15)");
  });

  it("finds the translucent-carrying :root values the fixture is known to hold", () => {
    const translucent = sheet
      .tokensFor(ROOT_THEME)
      .filter((t) => t.translucent && t.origin === "declared")
      .map((t) => t.name);
    expect(translucent.sort()).toEqual([
      "--app-error-surface",
      "--app-info-surface",
      "--app-neutral-surface",
      "--app-overlay",
      "--app-success-surface",
      "--app-warning-surface",
    ]);
    // The fixture's seventh "translucent-ish" :root value is --app-shadow, whose
    // rgba() appears inside a box-shadow LIST. It is a shadow, not a colour, so
    // it is classified non-color rather than being torn apart for its alpha.
    const shadow = sheet.token("--app-shadow", ROOT_THEME);
    expect(shadow?.kind).toBe("non-color");
    expect(shadow?.translucent).toBe(false);
  });

  it("carries translucency through an @theme inline alias", () => {
    const alias = sheet.token("--color-app-success-surface", ROOT_THEME);
    expect(alias?.origin).toBe("theme-inline");
    expect(alias?.translucent).toBe(true);
    expect(alias?.resolvedValue).toBe("rgba(34, 197, 94, 0.15)");
    // …and NOT in winter, where the same alias resolves to an opaque hex.
    expect(sheet.token("--color-app-success-surface", "winter")?.translucent).toBe(false);
  });

  it("classifies values that are not colours as non-color rather than dropping them", () => {
    const byName = (n: string) => sheet.token(n, ROOT_THEME);
    expect(byName("--app-radius-pill")?.kind).toBe("non-color");
    expect(byName("--transition-fast")?.resolvedValue).toBe("150ms");
    expect(byName("--font-family")?.kind).toBe("non-color");
    // A color-mix() expression is a colour a browser can compute but this stage
    // cannot: reported as non-color, never guessed at.
    const mix = byName("--app-success-toast-surface");
    expect(mix?.kind).toBe("non-color");
    expect(mix?.resolvedValue).toContain("color-mix(");
  });
});

/**
 * Success criterion 3 — COLLISION DATA.
 *
 * The resolver returns same-resolved-value groups per theme. It does NOT judge
 * them: `--app-warning` and `--app-warning-border` sharing a value is deliberate,
 * and `--app-border` sharing one with `--app-surface-raised` is the famous defect.
 * Telling those apart is rule 1's job, in a later slice.
 */
describe("same-resolved-value groups (the data rule 1 will judge)", () => {
  const darkGroups = sheet.collisionGroups(ROOT_THEME);
  const groupFor = (value: string) => darkGroups.find((g) => g.value === value);

  it("groups --app-border with --app-surface-raised at #1E293B in dark — the invisible border", () => {
    const g = groupFor("#1E293B");
    expect(g).toBeDefined();
    expect(g?.names).toEqual(expect.arrayContaining(["--app-border", "--app-surface-raised"]));
    expect(g?.theme).toBe(ROOT_THEME);
  });

  it('groups --app-cta with --app-success at #22C55E in dark — "do this" and "this worked"', () => {
    const g = groupFor("#22C55E");
    expect(g).toBeDefined();
    expect(g?.names).toEqual(expect.arrayContaining(["--app-cta", "--app-success"]));
  });

  it("includes the @theme inline aliases that resolve into a colliding group", () => {
    // --color-app-border and --color-app-surface-raised alias the same two
    // tokens, so they land in the same group once var() is resolved.
    const g = groupFor("#1E293B");
    expect(g?.names).toEqual(
      expect.arrayContaining(["--color-app-border", "--color-app-surface-raised"]),
    );
  });

  it("omits groups of one and reports no verdict of any kind", () => {
    expect(darkGroups.every((g) => g.names.length > 1)).toBe(true);
    for (const g of darkGroups) {
      expect(Object.keys(g).sort()).toEqual(["names", "theme", "value"]);
    }
  });

  it("groups PER THEME — a dark collision need not be a winter one", () => {
    const winterGroups = sheet.collisionGroups("winter");
    // In winter --app-border is #E2E8F0 and --app-surface-raised is #F1F5F9:
    // the famous dark collision simply is not there.
    const winterBorder = winterGroups.find((g) => g.names.includes("--app-border"));
    expect(winterBorder?.names ?? []).not.toContain("--app-surface-raised");
    expect(sheet.token("--app-border", "winter")?.resolvedValue).toBe("#E2E8F0");
    expect(sheet.token("--app-surface-raised", "winter")?.resolvedValue).toBe("#F1F5F9");
  });

  it("matches on RESOLVED value, not on written form", () => {
    const css = `:root { --a: #1e293b; --b: rgb(30, 41, 59); --c: var(--a); --d: #FFF; }`;
    const groups = resolveCss(css).collisionGroups(ROOT_THEME);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe("#1E293B");
    expect(groups[0].names).toEqual(["--a", "--b", "--c"]);
  });
});

describe("unresolved references and cycles are represented, never thrown", () => {
  it("reports a var() pointing at nothing as unresolved, naming the missing property", () => {
    const r = resolveCss(`:root { --a: var(--nope); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("unresolved");
    expect(t?.resolvedValue).toBeNull();
    expect(t?.missingReference).toBe("--nope");
    expect(t?.chain).toEqual(["--a", "--nope"]);
  });

  it("uses a var() fallback when the referenced property is absent", () => {
    const r = resolveCss(`:root { --a: var(--nope, #22C55E); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("color");
    expect(t?.resolvedValue).toBe("#22C55E");
  });

  it("terminates on a direct cycle and reports the path", () => {
    const r = resolveCss(`:root { --a: var(--b); --b: var(--a); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.resolvedValue).toBeNull();
    expect(t?.chain).toEqual(["--a", "--b", "--a"]);
  });

  it("terminates on a longer cycle and on self-reference", () => {
    const r = resolveCss(`:root { --a: var(--b); --b: var(--c); --c: var(--a); --s: var(--s); }`);
    expect(r.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--b", "--c", "--a"]);
    expect(r.token("--s", ROOT_THEME)?.kind).toBe("cycle");
  });

  it("leaves the calibration stylesheet with no unresolved reference and no cycle", () => {
    const broken = sheet.tokens.filter((t) => t.kind === "unresolved" || t.kind === "cycle");
    expect(broken).toEqual([]);
  });
});

describe("the resolver works on CSS that has nothing to do with the calibration fixture", () => {
  const css = `
    :root { --brand: #FF0000; --ink: var(--brand); --gap: 8px; }
    [data-theme="sepia"] { --brand: #C08040; }
    [data-theme="high-contrast"] { --brand: #000000; --ink: #FFFFFF; }
  `;
  const r = resolveCss(css);

  it("discovers every declared theme", () => {
    expect(r.themes).toEqual([ROOT_THEME, "sepia", "high-contrast"]);
  });

  it("re-resolves an inherited indirection through each theme's own override", () => {
    expect(r.token("--ink", ROOT_THEME)?.resolvedValue).toBe("#FF0000");
    // --ink is inherited in sepia, but its var() target IS overridden there, so
    // the resolved value differs from :root. Resolution is per theme, not cached.
    expect(r.token("--ink", "sepia")?.origin).toBe("inherited");
    expect(r.token("--ink", "sepia")?.resolvedValue).toBe("#C08040");
    expect(r.token("--ink", "high-contrast")?.origin).toBe("declared");
    expect(r.token("--ink", "high-contrast")?.resolvedValue).toBe("#FFFFFF");
  });
});
