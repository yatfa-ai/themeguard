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

describe("the dark-default form `:root, [data-theme=\"dark\"]` resolves as BOTH scopes", () => {
  // REVERT PROBE — let the whole prelude classify as one kind again (the
  // `[data-theme=…]` branch winning for the list) and every test here fails:
  // there is no root scope, `tokensFor("root")` is empty, no theme inherits
  // anything, `absences` is empty — and NOTHING is thrown, no token is
  // `unresolved`, none is a `cycle`. The resolver would report a perfectly
  // healthy stylesheet whose base scope does not exist. That silent-wrong-data
  // shape is exactly what this block exists to catch.
  const css = `:root, [data-theme="dark"] {
                 --bg: #020617; --fg: #F8FAFC; --border: #1E293B; --raised: #1E293B;
               }
               [data-theme="light"] { --bg: #FFFFFF; }`;
  const r = resolveCss(css);

  it("keeps the base scope: root carries all four tokens", () => {
    expect(r.tokensFor(ROOT_THEME)).toHaveLength(4);
    expect(r.token("--bg", ROOT_THEME)?.resolvedValue).toBe("#020617");
    expect(r.token("--bg", ROOT_THEME)?.origin).toBe("declared");
  });

  it("names dark as a theme in its own right, alongside root", () => {
    expect(r.themes).toEqual([ROOT_THEME, "dark", "light"]);
    expect(r.token("--bg", "dark")?.origin).toBe("declared");
    expect(r.token("--bg", "dark")?.resolvedValue).toBe("#020617");
  });

  it("lets another theme INHERIT from the base half of the list", () => {
    const fg = r.token("--fg", "light");
    expect(fg).toBeDefined();
    expect(fg?.origin).toBe("inherited");
    expect(fg?.resolvedValue).toBe("#F8FAFC");
    expect(r.token("--bg", "light")?.origin).toBe("declared");
  });

  it("lists the three tokens light does not override as absences", () => {
    const lightAbsences = r.absences.filter((a) => a.theme === "light").map((a) => a.name);
    expect(lightAbsences.sort()).toEqual(["--border", "--fg", "--raised"]);
  });

  it("finds the value collision in the base scope, not only in dark", () => {
    for (const theme of [ROOT_THEME, "dark"]) {
      const g = r.collisionGroups(theme).find((x) => x.value === "#1E293B");
      expect(g?.names).toEqual(["--border", "--raised"]);
    }
  });
});

describe("a component scoped inside a theme is not that theme's global value", () => {
  // REVERT PROBE — restore substring classification in `classifyOne` and every
  // test here fails, with nothing thrown and nothing marked unresolved: a token
  // narrowed to one subtree is reported as the theme's value everywhere, and a
  // real absence vanishes. That is exactly the wrong data rules 1-3 would judge.
  const css = `:root                             { --chip: #1E293B; --pad: 8px; }
               [data-theme="winter"]             { --chip: #F1F5F9; }
               [data-theme="winter"] .code-block { --chip: #FFFFFF; --pad: 999px; }
               :root .code-block                 { --chip: #000000; }`;
  const r = resolveCss(css);

  it("keeps the base scope's own value, not the value of a component inside it", () => {
    expect(r.token("--chip", ROOT_THEME)?.resolvedValue).toBe("#1E293B");
  });

  it("keeps the theme's own value, not the value of a component inside it", () => {
    expect(r.token("--chip", "winter")?.resolvedValue).toBe("#F1F5F9");
  });

  it("still reports a token the theme genuinely lacks as inherited, and as an absence", () => {
    const pad = r.token("--pad", "winter");
    expect(pad?.origin).toBe("inherited");
    expect(pad?.resolvedValue).toBe("8px");
    expect(r.absences.filter((a) => a.theme === "winter").map((a) => a.name)).toEqual(["--pad"]);
  });

  it("does not group a subtree-scoped token with the global ones", () => {
    // #FFFFFF and #000000 belong to `.code-block`, not to any theme, so they
    // must not appear in either theme's collision data.
    for (const theme of [ROOT_THEME, "winter"]) {
      const values = r.collisionGroups(theme).map((g) => g.value);
      expect(values).not.toContain("#FFFFFF");
      expect(values).not.toContain("#000000");
    }
  });

  it("resolves a scope written inside :is() as that scope", () => {
    const wrapped = resolveCss(`:is(:root, [data-theme="dark"]) { --bg: #020617; --fg: #F8FAFC; }
                                [data-theme="light"] { --bg: #FFFFFF; }`);
    expect(wrapped.tokensFor(ROOT_THEME)).toHaveLength(2);
    expect(wrapped.themes).toEqual([ROOT_THEME, "dark", "light"]);
    expect(wrapped.token("--fg", "light")?.origin).toBe("inherited");
    expect(wrapped.absences.filter((a) => a.theme === "light").map((a) => a.name)).toEqual([
      "--fg",
    ]);
  });
});

describe("an element that merely CONTAINS a theme does not carry that theme's values", () => {
  // REVERT PROBE — delete the `stripFunctionalArgs()` call from `classifyOne`
  // and every test here fails, with nothing thrown, nothing `unresolved` and no
  // `cycle`: the same healthy-looking report of wrong data the combinator check
  // closes for `[data-theme="winter"] .code-block`, reached through `:has()`.
  //
  // `html:has([data-theme="winter"])` styles the element CONTAINING the winter
  // root, not the winter root. Its declarations must not become winter's global
  // values — which would corrupt `--chip`, flip `--pad` from inherited to
  // declared, and erase a genuine absence.
  const css = `:root                            { --chip: #1E293B; --pad: 8px; --ring: #334155; }
               [data-theme="winter"]            { --chip: #F1F5F9; --ring: #CBD5E1; }
               html:has([data-theme="winter"])  { --chip: #000000; --pad: 999px; --ring: #000000; }`;
  const r = resolveCss(css);

  it("keeps the theme's own value, not the containing element's", () => {
    expect(r.token("--chip", "winter")?.resolvedValue).toBe("#F1F5F9");
  });

  it("still reports a token the theme genuinely lacks as inherited, and as an absence", () => {
    const pad = r.token("--pad", "winter");
    expect(pad?.origin).toBe("inherited");
    expect(pad?.resolvedValue).toBe("8px");
    expect(r.absences.filter((a) => a.theme === "winter").map((a) => a.name)).toEqual(["--pad"]);
  });

  it("does not group the containing element's values with the theme's", () => {
    for (const theme of [ROOT_THEME, "winter"]) {
      expect(r.collisionGroups(theme).map((g) => g.value)).not.toContain("#000000");
    }
  });

  it("reports the corruption's absence as data, not as an error", () => {
    // The defect this pins is SILENT: were it live, `--chip` and `--ring` would
    // both read `#000000` in winter and nothing below would move. These
    // assertions exist so a future reader knows the probe's failure mode is wrong
    // VALUES, and cannot be found by looking for thrown errors.
    expect(r.tokens.filter((t) => t.kind === "unresolved")).toHaveLength(0);
    expect(r.tokens.filter((t) => t.kind === "cycle")).toHaveLength(0);
    expect(r.tokensFor("winter").map((t) => t.resolvedValue)).toEqual([
      "#F1F5F9",
      "8px",
      "#CBD5E1",
    ]);
  });

  it("keeps the base scope's own value when the subject IS :root but has a themed descendant", () => {
    const scoped = resolveCss(`:root                            { --chip: #1E293B; }
                               [data-theme="winter"]            { --chip: #F1F5F9; }
                               :root:has([data-theme="winter"]) { --pad: 4px; }`);
    expect(scoped.token("--chip", ROOT_THEME)?.resolvedValue).toBe("#1E293B");
    // `--pad` is declared on the base scope, so winter inherits it.
    expect(scoped.token("--pad", ROOT_THEME)?.resolvedValue).toBe("4px");
    expect(scoped.token("--pad", "winter")?.origin).toBe("inherited");
  });
});

describe("a theme wrapped in :is() inside a containment pseudo does not carry that theme's values", () => {
  // REVERT PROBE — make `extractMatchesAny()`'s search depth-blind again (swap
  // `findTopLevel(rest, /^:(?:is|where|…)\s*\(/i)` back for
  // `rest.search(/:(?:is|where|…)\s*\(/i)`) and every test here fails.
  //
  // This is the block above's defect reached past the fix that closed it.
  // `stripFunctionalArgs()` would strip this `:has()` correctly — but it never
  // runs on it, because a depth-blind `:is()` search hoists the argument out
  // first. So the theme escapes the containment check that exists to stop it,
  // and the damage is byte-for-byte identical: `--chip` corrupted, `--pad`
  // flipped from inherited to declared, a genuine absence erased.
  //
  // Pinned at the resolver level rather than only on `parse()` because the wrong
  // VALUES are what a later rule would judge — a collision rule reading this
  // table reports a collision that is not in the stylesheet, and a ramp rule
  // measures a ΔL* between two colours no user ever sees together.
  const css = `:root                                 { --chip: #1E293B; --pad: 8px; --ring: #334155; }
               [data-theme="winter"]                 { --chip: #F1F5F9; --ring: #CBD5E1; }
               html:has(:is([data-theme="winter"]))  { --chip: #000000; --pad: 999px; --ring: #000000; }`;
  const r = resolveCss(css);

  it("keeps the theme's own value, not the containing element's", () => {
    expect(r.token("--chip", "winter")?.resolvedValue).toBe("#F1F5F9");
  });

  it("still reports a token the theme genuinely lacks as inherited, and as an absence", () => {
    const pad = r.token("--pad", "winter");
    expect(pad?.origin).toBe("inherited");
    expect(pad?.resolvedValue).toBe("8px");
    expect(r.absences.filter((a) => a.theme === "winter").map((a) => a.name)).toEqual(["--pad"]);
  });

  it("reports the corruption's absence as data, not as an error", () => {
    // Same silence as the block above: were the defect live, `--chip` and
    // `--ring` would both read `#000000` in winter and NOTHING here would move.
    // Asserting the quiet directly is the point — the failure mode is wrong
    // values, and cannot be found by looking for thrown errors.
    expect(r.tokens.filter((t) => t.kind === "unresolved")).toHaveLength(0);
    expect(r.tokens.filter((t) => t.kind === "cycle")).toHaveLength(0);
    expect(r.tokensFor("winter").map((t) => t.resolvedValue)).toEqual([
      "#F1F5F9",
      "8px",
      "#CBD5E1",
    ]);
  });

  it("does not invent a collision between the container's value and the theme's", () => {
    for (const theme of [ROOT_THEME, "winter"]) {
      expect(r.collisionGroups(theme).map((g) => g.value)).not.toContain("#000000");
    }
  });

  it("resolves a multi-theme detector to no theme at all", () => {
    // `:has(:is(a, b))` — "contains any of these themes" — is the shape that
    // makes this defect likely in a real stylesheet, and it must open NEITHER
    // theme's table rather than both.
    const many = resolveCss(
      `:root { --chip: #1E293B; }
       [data-theme="winter"] { --chip: #F1F5F9; }
       [data-theme="midnight"] { --chip: #020617; }
       html:has(:is([data-theme="winter"], [data-theme="midnight"])) { --chip: #000000; }`,
    );
    expect(many.token("--chip", "winter")?.resolvedValue).toBe("#F1F5F9");
    expect(many.token("--chip", "midnight")?.resolvedValue).toBe("#020617");
    expect(many.token("--chip", ROOT_THEME)?.resolvedValue).toBe("#1E293B");
  });
});

describe("a theme override written as a NESTED rule is that theme's value, not the parent's", () => {
  // REVERT PROBE J — remove the `blankNestedBlocks(rawBody)` call from
  // `readDeclarations()` in `src/parse.ts` and every test here fails, as do
  // eight in `census.test.ts`.
  //
  // Weighted to the resolver because wrong VALUES are what a later rule judges.
  // But the row this block exists for is the LAST one: the resolver reports
  // `winter:--chip` as an ABSENCE while winter demonstrably overrides `--chip`
  // three lines up. That is a FABRICATED fact, and it is a genuinely new failure
  // mode — every previous round's defect corrupted a value or dropped one, none
  // of them INVENTED one. A dead-variable rule reading it concludes winter has
  // no `--chip` override when it plainly does; a ramp rule then measures a ΔL*
  // between two colours the stylesheet never puts side by side.
  //
  // Worth knowing why the obvious fix is not enough: merely skipping the nested
  // region (so it is neither parsed nor reported) closes the dropped `--ring`
  // and the corrupted `--chip`, and STILL leaves the fabricated absence live —
  // winter's override is gone, so winter still "lacks" `--chip`. Only reporting
  // the nested rule under its own subject closes all three, which is why the
  // absence assertion below is the load-bearing one.
  const css = `:root {
                 --chip: #1E293B;
                 --pad: 8px;
                 &[data-theme="winter"] { --chip: #F1F5F9; }
                 --ring: #334155;
                 --cta: #22C55E;
               }
               [data-theme="winter"] { --pad: 4px; }`;
  const r = resolveCss(css);

  it("does not invent an absence for a token the theme demonstrably overrides", () => {
    // THE row. `--chip` IS overridden by winter, in the source, in a nested
    // rule. Reporting it as an absence hands a later rule a fact that is not in
    // the stylesheet.
    const winterAbsences = r.absences.filter((a) => a.theme === "winter").map((a) => a.name);
    expect(winterAbsences).not.toContain("--chip");
    expect(winterAbsences.sort()).toEqual(["--cta", "--ring"]);
  });

  it("gives the theme its own nested value, declared rather than inherited", () => {
    const chip = r.token("--chip", "winter");
    expect(chip?.resolvedValue).toBe("#F1F5F9");
    expect(chip?.origin).toBe("declared");
  });

  it("does not let the nested value win in the ENCLOSING scope", () => {
    // `tableFor()` takes the last declaration, so a nested value leaking into
    // `:root` does not merely appear there — it WINS there.
    expect(r.token("--chip", ROOT_THEME)?.resolvedValue).toBe("#1E293B");
  });

  it("keeps the declaration written after the nested rule's closing brace", () => {
    // `--ring` follows the nested block, and is what the leftover prelude eats.
    expect(r.token("--ring", ROOT_THEME)?.resolvedValue).toBe("#334155");
    expect(r.token("--cta", ROOT_THEME)?.resolvedValue).toBe("#22C55E");
  });

  it("reports all of it as data, not as an error", () => {
    // The same silence every previous round blocked on: were the defect live,
    // NOTHING here would move. The failure mode is wrong data, and cannot be
    // found by looking for thrown errors — so the quiet is asserted directly.
    expect(r.tokens.filter((t) => t.kind === "unresolved")).toHaveLength(0);
    expect(r.tokens.filter((t) => t.kind === "cycle")).toHaveLength(0);
    expect(r.tokensFor("winter").map((t) => `${t.name}=${t.resolvedValue}`)).toEqual([
      "--chip=#F1F5F9",
      "--pad=4px",
      "--ring=#334155",
      "--cta=#22C55E",
    ]);
  });

  it("does not invent a collision out of a leaked nested value", () => {
    // A nested value filed under the enclosing scope sits in that scope's table
    // alongside tokens it never shared a value with, so the collision data a
    // later rule reads reports a group that is not in the stylesheet.
    const leaked = resolveCss(
      `:root { --a: #111111; --b: #222222; &[data-theme="winter"] { --b: #111111; } }`,
    );
    expect(leaked.collisionGroups(ROOT_THEME)).toEqual([]);
    expect(leaked.collisionGroups("winter").map((g) => g.names)).toEqual([["--a", "--b"]]);
  });

  it("resolves a nested rule the same way as its flat equivalent", () => {
    // The invariant rather than a hard-coded expectation: nesting is a way of
    // WRITING a selector, never a different selector, so the two spellings must
    // produce the same table.
    const flat = resolveCss(
      `:root { --chip: #1E293B; --pad: 8px; --ring: #334155; }
       :root[data-theme="winter"] { --chip: #F1F5F9; }`,
    );
    const nest = resolveCss(
      `:root { --chip: #1E293B; --pad: 8px; &[data-theme="winter"] { --chip: #F1F5F9; } --ring: #334155; }`,
    );
    const table = (s: typeof flat) =>
      s.themes.map((t) => [t, s.tokensFor(t).map((k) => `${k.name}=${k.resolvedValue}`)]);
    expect(table(nest)).toEqual(table(flat));
    expect(nest.absences.map((a) => `${a.theme}:${a.name}`)).toEqual(
      flat.absences.map((a) => `${a.theme}:${a.name}`),
    );
  });

  it("leaves the calibration fixture's resolution exactly where it was", () => {
    // The fixture uses no nesting, so a correct body parser moves nothing.
    expect(sheet.absences.filter((a) => a.theme === "winter")).toHaveLength(
      CENSUS.winterAbsences,
    );
    expect(sheet.tokens.filter((t) => t.kind === "unresolved")).toHaveLength(0);
    expect(sheet.tokens.filter((t) => t.kind === "cycle")).toHaveLength(0);
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

describe("a brace written inside a STRING in a nested body is text, not structure (audit YATFA-6991 round 7)", () => {
  // REVERT PROBE K — restore the `depth === 0 &&` guard on the string-open test
  // in `blankNestedBlocks()` (`src/parse.ts`) and every test here fails, as do
  // four in `census.test.ts`.
  //
  // `blankNestedBlocks` spends its whole working life at depth > 0 — that is the
  // region it exists to blank — so gating its string tracking on `depth === 0`
  // made it string-blind exactly there. A `}` inside a string then counted as
  // structure, the depth returned to 0 early, the real closing brace drove it to
  // -1 (clamped) while emitting a second `;`, and everything from there to the
  // end of the block landed in a chunk that no longer starts with `--`, which
  // `readDeclarations` discards. An unmatched `{` desyncs it the other way; a
  // string containing BOTH happens to balance, which is what made this quiet.
  //
  // Weighted to the resolver because the dropped declarations are what a later
  // rule reads: the round-5 finding was a value in the wrong place, this one is
  // a value that is not there at all — including a collision group that
  // evaporates because one of its two members was silently dropped.
  //
  // Not a contrived shape. `content: "{"` is how a code-block renders a brace
  // glyph, an SVG data-URI carrying an inline <style> does the same, and so does
  // any url() whose path or query contains a brace.
  const css = `:root {
                 --chip: #1E293B;
                 .icon::before { content: "}"; }
                 --ring: #334155;
                 --cta: #22C55E;
               }
               [data-theme="winter"] { --chip: #F1F5F9; --ring: #94A3B8; --cta: #16A34A; }`;
  const r = resolveCss(css);

  it("keeps every declaration written after the string-bearing nested rule", () => {
    // Both are gone when the scan is string-blind: `--ring` to the leftover
    // prelude, `--cta` to the desynced depth.
    expect(r.token("--ring", ROOT_THEME)?.resolvedValue).toBe("#334155");
    expect(r.token("--cta", ROOT_THEME)?.resolvedValue).toBe("#22C55E");
    expect(r.token("--chip", ROOT_THEME)?.resolvedValue).toBe("#1E293B");
  });

  it("still reports the collision group those declarations are part of", () => {
    // THE row for criterion 3: this is the resolver's own output. Drop one member
    // of a shared-value pair and the group does not become wrong — it ceases to
    // exist, so a collision rule reading this reports nothing at all.
    const green = resolveCss(
      `:root {
         --cta: #22C55E;
         .icon::before { content: "}"; }
         --success: #22C55E;
       }`,
    );
    expect(green.collisionGroups(ROOT_THEME).map((g) => g.names)).toEqual([["--cta", "--success"]]);
  });

  it("resolves a var() reference into a declaration that follows the nested rule", () => {
    // With the target dropped, the reference resolves to `undefined` rather than
    // to `unresolved` — so even the failure-mode representation never fires.
    const ref = resolveCss(
      `:root { --a: #111111; .x { content: "}"; } --b: #222222; --c: var(--b); }`,
    );
    expect(ref.token("--c", ROOT_THEME)?.resolvedValue).toBe("#222222");
    expect(ref.token("--c", ROOT_THEME)?.kind).toBe("color");
  });

  it("still reports the theme absence of a token declared after the nested rule", () => {
    // The other direction from round 5's FABRICATED absence: here the absence is
    // real and goes MISSING. `--ring` and `--cta` are declared in `:root` after
    // the string-bearing nested rule and are not overridden in winter, so winter
    // genuinely lacks both. Drop them from `:root` and there is nothing left for
    // winter to lack — a dead-variable rule reads a theme with no gaps at all.
    const partial = resolveCss(
      `:root {
         --chip: #1E293B;
         .icon::before { content: "}"; }
         --ring: #334155;
         --cta: #22C55E;
       }
       [data-theme="winter"] { --chip: #F1F5F9; }`,
    );
    expect(
      partial.absences
        .filter((a) => a.theme === "winter")
        .map((a) => a.name)
        .sort(),
    ).toEqual(["--cta", "--ring"]);
    // And the whole-block case: winter overrides all three, so it lacks nothing.
    expect(r.absences.filter((a) => a.theme === "winter")).toEqual([]);
  });

  it("reports all of it as data, not as an error", () => {
    // The same silence every previous round blocked on: were the defect live,
    // NOTHING here would move — nothing thrown, nothing unresolved, no cycle.
    expect(r.tokens.filter((t) => t.kind === "unresolved")).toHaveLength(0);
    expect(r.tokens.filter((t) => t.kind === "cycle")).toHaveLength(0);
    expect(r.tokensFor(ROOT_THEME).map((t) => `${t.name}=${t.resolvedValue}`)).toEqual([
      "--chip=#1E293B",
      "--ring=#334155",
      "--cta=#22C55E",
    ]);
  });

  it("agrees with the flat spelling of the same stylesheet", () => {
    // The invariant, not a hard-coded answer: a string is text wherever it is
    // written, so hoisting the nested rule out must change nothing.
    const flat = resolveCss(
      `:root { --chip: #1E293B; --ring: #334155; --cta: #22C55E; }
       :root .icon::before { content: "}"; }
       [data-theme="winter"] { --chip: #F1F5F9; --ring: #94A3B8; --cta: #16A34A; }`,
    );
    const table = (s: typeof flat) =>
      s.themes.map((t) => [t, s.tokensFor(t).map((k) => `${k.name}=${k.resolvedValue}`)]);
    expect(table(r)).toEqual(table(flat));
  });
});
