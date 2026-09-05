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

describe("a selector names a scope only when it IS one (audit YATFA-6991 round 2)", () => {
  // REVERT PROBE — restore substring classification (test `[data-theme=…]` and
  // `:root` against the WHOLE selector, with no combinator check and no
  // `:is()`/`:where()` descent) and every test in this block fails.
  //
  // The failure shape is the same silent-wrong-data one the round-1 audit
  // blocked on: nothing throws, nothing is `unresolved`, nothing is a `cycle`,
  // and `absences` is empty — a healthy-looking report of wrong data. A
  // component scoped INSIDE a theme is reported as that theme's global value,
  // and a scope written inside `:is()` disappears entirely.

  it("looks THROUGH :is() and :where(), which only group selectors", () => {
    // `:is(:root, [data-theme="dark"])` matches exactly what
    // `:root, [data-theme="dark"]` matches, so it genuinely IS both scopes.
    // :where() is the zero-specificity form of the same thing, which is why
    // generated stylesheets (Tailwind's own output included) reach for it.
    for (const wrapper of ["is", "where"]) {
      const scopes = parseStylesheet(
        `:${wrapper}(:root, [data-theme="dark"]) { --bg: #020617; --fg: #F8FAFC; }`,
      ).scopes;
      expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-", "theme/dark"]);
      expect(scopes[0].declarations).toHaveLength(2);
      expect(scopes[1].declarations).toHaveLength(2);
    }
  });

  it("does NOT let a theme claim a component nested inside it", () => {
    // `[data-theme="winter"] .code-block` is a component INSIDE the winter
    // theme, not the winter theme. Merging its declarations into winter's table
    // would report a token narrowed to one subtree as that theme's value
    // everywhere — and would erase a genuine absence.
    const scopes = parseStylesheet(
      '[data-theme="winter"] .code-block { --chip: #FFFFFF; }',
    ).scopes;
    expect(scopes).toHaveLength(1);
    expect(scopes[0].kind).toBe("other");
    expect(scopes[0].theme).toBeNull();
  });

  it("rejects every combinator, not only the descendant space", () => {
    for (const sel of [
      '[data-theme="winter"] .code-block',
      '[data-theme="winter"] > .code-block',
      '[data-theme="winter"] + .sibling',
      '[data-theme="winter"] ~ .sibling',
      ":root .code-block",
      ":root > main",
    ]) {
      const scopes = parseStylesheet(`${sel} { --x: 1px; }`).scopes;
      expect(scopes.map((s) => s.kind)).toEqual(["other"]);
    }
  });

  it("still classifies when the recognised token is not at the START of the subject", () => {
    // The subject compound may carry anything: `html:root` is the base scope,
    // and a class-qualified theme attribute is still that theme.
    expect(parseStylesheet("html:root { --x: 1px; }").scopes[0].kind).toBe("root");
    expect(parseStylesheet('body[data-theme="winter"] { --x: 1px; }').scopes[0].theme).toBe(
      "winter",
    );
  });

  it("does not classify off a :root written inside an attribute STRING", () => {
    const scopes = parseStylesheet('[data-sel=":root"] { --x: 1px; }').scopes;
    expect(scopes[0].kind).toBe("other");
  });
});

describe("a functional pseudo-class's ARGUMENT is not the subject (audit YATFA-6991 round 3)", () => {
  // REVERT PROBE — delete the `stripFunctionalArgs()` call from `classifyOne`
  // (or the function itself) and every test in this block fails.
  //
  // Same mechanism as the block above, arriving by a different route. The
  // combinator check closes `[data-theme="winter"] .code-block`; containment can
  // also be written INSIDE a compound, and then there is no combinator to see:
  // `html:has([data-theme="winter"])` is one element that CONTAINS the winter
  // root. Reading the theme out of that argument is the round-2 defect verbatim,
  // with the same silence — nothing thrown, nothing `unresolved`.
  //
  // `:has()` is not hypothetical: it is baseline since 2023, it appears in this
  // project's own calibration fixture (`.app-choice:has(:disabled)`, :1757), and
  // `html:has([data-theme="dark"])` is a standard way to write theme detection.

  it("does not let an element that merely CONTAINS a theme claim that theme", () => {
    for (const sel of ['html:has([data-theme="dark"])', '.card:has([data-theme="winter"])']) {
      const scopes = parseStylesheet(`${sel} { --x: 1px; }`).scopes;
      expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["other/-"]);
    }
  });

  it("does not let an element that merely CONTAINS :root claim the base scope", () => {
    expect(parseStylesheet(".x:has(:root) { --x: 1px; }").scopes[0].kind).toBe("other");
  });

  it("classifies by the SUBJECT even when a :has() argument names another scope", () => {
    // The subject here really IS `:root`; the `:has()` only narrows WHEN the rule
    // applies. Filing it under `winter` is the round-1 defect: a base-scope block
    // landing in a theme's table.
    const scopes = parseStylesheet(':root:has([data-theme="winter"]) { --x: 1px; }').scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-"]);
  });

  it("strips by SHAPE, so every other functional pseudo is covered by construction", () => {
    // Named individually only to record that they were measured — none of them
    // has a special case in the source, and a pseudo-class invented next year is
    // handled the same way.
    for (const sel of [
      ':host-context([data-theme="winter"])',
      '::slotted([data-theme="winter"])',
      ':nth-child(1 of [data-theme="winter"])',
    ]) {
      expect(parseStylesheet(`${sel} { --x: 1px; }`).scopes[0].kind).toBe("other");
    }
  });

  it("leaves a NON-functional pseudo on the subject alone", () => {
    // `:root:hover` carries no argument list; stripping must not touch it.
    expect(parseStylesheet(":root:hover { --x: 1px; }").scopes[0].kind).toBe("root");
    expect(parseStylesheet('[data-theme="winter"]:hover { --x: 1px; }').scopes[0].theme).toBe(
      "winter",
    );
  });
});

describe("a grouping pseudo-class NESTED inside a containment one is not the subject (audit YATFA-6991 round 4)", () => {
  // REVERT PROBE — make `extractMatchesAny()`'s search depth-blind again (swap
  // `findTopLevel(rest, /^:(?:is|where|…)\s*\(/i)` back for
  // `rest.search(/:(?:is|where|…)\s*\(/i)`) and every test in this block fails.
  //
  // `:is()` and `:where()` are looked THROUGH, because their arguments genuinely
  // are scopes — but only when the grouping pseudo is on the subject compound. A
  // depth-blind search also finds one nested inside a CONTAINMENT pseudo and
  // hoists its argument out as a scope in its own right, before
  // `stripFunctionalArgs()` ever sees the `:has()` that makes it irrelevant. The
  // theme escapes past the mechanism placed to stop it, and
  // `html:has(:is([data-theme="winter"]))` reproduces the round-2 defect exactly:
  // an element that merely CONTAINS a themed subtree claiming the theme's table.
  //
  // Not a contrived shape. `:has(:is(a, b))` is how "contains any of these
  // themes" is written, which is what a multi-theme detector looks like as soon
  // as there are more than two themes — and the bare form
  // `html:has([data-theme="dark"], [data-theme="midnight"])` is already correct,
  // so wrapping the same list in `:is()` must not change the answer.

  it("does not let :is() smuggle a theme out of a :has() argument", () => {
    for (const sel of [
      'html:has(:is([data-theme="winter"]))',
      '.card:has(:where([data-theme="dark"]))',
      'html:has(:is([data-theme="dark"], [data-theme="midnight"]))',
    ]) {
      const scopes = parseStylesheet(`${sel} { --x: 1px; }`).scopes;
      expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["other/-"]);
    }
  });

  it("classifies a wrapped list exactly as it classifies the bare list", () => {
    // `:is()` changes specificity, never what the selector matches, so these two
    // must agree. They are the same question asked twice.
    const bare = parseStylesheet(
      'html:has([data-theme="dark"], [data-theme="midnight"]) { --x: 1px; }',
    ).scopes;
    const wrapped = parseStylesheet(
      'html:has(:is([data-theme="dark"], [data-theme="midnight"])) { --x: 1px; }',
    ).scopes;
    expect(wrapped.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(
      bare.map((s) => `${s.kind}/${s.theme ?? "-"}`),
    );
  });

  it("does not let :is() smuggle :root out of a containment argument either", () => {
    for (const sel of [".x:has(:is(:root))", ".x:has(:where(:root))"]) {
      expect(parseStylesheet(`${sel} { --x: 1px; }`).scopes[0].kind).toBe("other");
    }
  });

  it("covers containment pseudos other than :has() by the same construction", () => {
    expect(
      parseStylesheet('.x:nth-child(1 of :is([data-theme="winter"])) { --x: 1px; }').scopes[0].kind,
    ).toBe("other");
    expect(
      parseStylesheet(':host-context(:is([data-theme="winter"])) { --x: 1px; }').scopes[0].kind,
    ).toBe("other");
  });

  it("still classifies by the SUBJECT when the subject IS a scope", () => {
    // The `:has(:is(…))` only narrows WHEN the rule applies; the subject is
    // `:root`, so this is the base scope and nothing else.
    const scopes = parseStylesheet(':root:has(:is([data-theme="winter"])) { --x: 1px; }').scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-"]);
  });

  it("still looks through a grouping pseudo that IS on the subject, nested or not", () => {
    // The narrowing must not cost the feature it narrows. A `:is()` inside
    // another `:is()` still resolves, because the outer one's argument is
    // recursed back through the classifier, where the inner one is top-level.
    expect(
      parseStylesheet(':is(:root, [data-theme="dark"]) { --x: 1px; }').scopes.map(
        (s) => `${s.kind}/${s.theme ?? "-"}`,
      ),
    ).toEqual(["root/-", "theme/dark"]);
    expect(parseStylesheet(":is(:where(:root), .z) { --x: 1px; }").scopes[0].kind).toBe("root");
    expect(
      parseStylesheet(':where(:is([data-theme="winter"])) { --x: 1px; }').scopes[0].theme,
    ).toBe("winter");
  });
});

describe("a NESTED rule's declarations belong to its own subject (audit YATFA-6991 round 5)", () => {
  // REVERT PROBE J — remove the `blankNestedBlocks(rawBody)` call from
  // `readDeclarations()` (parse it as `body = rawBody`) and every test in this
  // block fails, as do five in `resolve.test.ts`.
  //
  // Every round before this one audited a block's PRELUDE. This is the block
  // BODY, and it was depth-blind about braces in exactly the way
  // `extractMatchesAny` was depth-blind about parens. Since CSS Nesting a body
  // is declarations AND nested rules, so a `;` written inside a nested rule ends
  // one of the ENCLOSING block's declarations. Two silent failures compound:
  // the nested value is filed under the enclosing scope, and the nested rule's
  // leftover prelude then absorbs the declaration after its closing brace,
  // dropping it outright.
  //
  // Not a contrived shape, and not a feature request: CSS Nesting is Baseline
  // across every major engine since 2023, `&[data-theme="winter"]` is exactly
  // how a theme override is written inside `:root`, and this file's own header
  // promises that anything else declaring custom properties is reported under
  // `other` "so nothing is silently dropped". The calibration fixture happens
  // not to use nesting, which is why four rounds of fixture-driven review did
  // not reach it.

  it("does not let a nested rule's declaration leak into the enclosing scope", () => {
    const scopes = parseStylesheet(":root { --a: #111; .card { --a: #999; } --b: #222; }").scopes;
    const root = scopes.filter((s) => s.kind === "root");
    expect(root.flatMap((s) => s.declarations.map((d) => `${d.name}=${d.value}`))).toEqual([
      "--a=#111",
      "--b=#222",
    ]);
  });

  it("does not let a nested rule's prelude swallow the declaration after it", () => {
    // The declaration AFTER the closing brace is the one that disappears: the
    // leftover prelude runs on until the next `;`, taking `--b` with it. This is
    // the half a naive "skip the nested block" fix leaves live.
    for (const css of [
      ":root { --a: #111; .card { --a: #999; } --b: #222; }",
      ":root { --a: #111; .x { --z: 1 } --b: #222 }",
      ":root { --a: #111; .x{.y{.z{--q: 1;}}} --b: #222; }",
    ]) {
      const names = parseStylesheet(css)
        .scopes.filter((s) => s.kind === "root")
        .flatMap((s) => s.declarations.map((d) => d.name));
      expect(names).toContain("--b");
    }
  });

  it("reports a nested rule under its OWN subject rather than dropping it", () => {
    // Taking the nested region out of the enclosing block must not throw it
    // away — the header's promise is that nothing is silently dropped, not that
    // nothing lands in the wrong place.
    const scopes = parseStylesheet(":root { --a: #111; .card { --z: 1px; } }").scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-", "other/-"]);
    expect(scopes[1].declarations.map((d) => d.name)).toEqual(["--z"]);
  });

  it("resolves `&` against the parent, so a nested theme override IS that theme", () => {
    // `&[data-theme="winter"]` inside `:root` stands for
    // `:root[data-theme="winter"]`, which is the winter scope — the same answer
    // the flat form gets, from the same classifier.
    const scopes = parseStylesheet(
      ':root { --bg: #0F172A; &[data-theme="winter"] { --bg: #FFFFFF; } --border: #1E293B; }',
    ).scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-", "theme/winter"]);
    expect(scopes[0].declarations.map((d) => d.name)).toEqual(["--bg", "--border"]);
    expect(scopes[1].declarations.map((d) => `${d.name}=${d.value}`)).toEqual(["--bg=#FFFFFF"]);
  });

  it("treats a nested selector with no `&` as the descendant it is", () => {
    // A bare nested selector is an implicit DESCENDANT of the parent, so its
    // subject is not the parent — `.card` inside `:root` is a component within
    // the base scope, exactly as the flat `:root .card` is, and lands in `other`.
    const nested = parseStylesheet(':root { .card { --z: 1px; } }').scopes;
    const flat = parseStylesheet(':root .card { --z: 1px; }').scopes;
    expect(nested.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(
      flat.map((s) => `${s.kind}/${s.theme ?? "-"}`),
    );
  });

  it("tracks braces inside strings and comments, so a flat body is unchanged", () => {
    // The depth counter must not desync on a brace or a quote that is DATA. The
    // `url("a;b")` case is the regression that matters: the existing paren/string
    // handling in `splitDeclarations` has to keep working through the new pass.
    for (const [css, expected] of [
      [':root { --a: #111; .x[t="}"] { --z: 1; } --b: #222; }', ["--a", "--b"]],
      [':root { --a: #111; .x[t="a\\"b"] { --z: 1; } --b: #222; }', ["--a", "--b"]],
      [':root { --a: url("a;b"); --b: #222; }', ["--a", "--b"]],
      [":root { --a: #111; --b: #222; }", ["--a", "--b"]],
    ] as const) {
      const names = parseStylesheet(css)
        .scopes.filter((s) => s.kind === "root")
        .flatMap((s) => s.declarations.map((d) => d.name));
      expect(names).toEqual(expected);
    }
  });

  it("keeps line numbers true across a nested block", () => {
    // `blankNestedBlocks` preserves byte positions and newlines for the same
    // reason `blankComments` does: the declaration lines are read off the
    // ORIGINAL offsets, and a census that cannot cite a line is not evidence.
    const scopes = parseStylesheet(
      ":root {\n  --a: #111;\n  .x {\n    --z: 1;\n  }\n  --b: #222;\n}",
    ).scopes;
    const root = scopes.find((s) => s.kind === "root");
    expect(root?.declarations.map((d) => [d.name, d.line])).toEqual([
      ["--a", 2],
      ["--b", 6],
    ]);
  });

  it("does not drop declarations written directly in a nested at-rule", () => {
    // A nested `@media` is transparent to nesting: its own declarations belong
    // to the parent rule's subject, conditionally. `:root { @media print { --p }}`
    // must reach the same scope the flat `@media print { :root { --p } }` does.
    const nested = parseStylesheet(":root { --a: #111; @media print { --p: #999; } --b: #222; }")
      .scopes.filter((s) => s.kind === "root")
      .flatMap((s) => s.declarations.map((d) => d.name));
    expect(nested).toEqual(["--a", "--b", "--p"]);
    expect(
      parseStylesheet("@media print { :root { --p: #999; } }").scopes[0].kind,
    ).toBe("root");
  });

  it("leaves the fixture census exactly where it was", () => {
    // The calibration fixture uses no nesting, so a correct body parser must move
    // NOTHING here. This is the cost check, asserted rather than promised.
    const sheet = parseStylesheet(fixtureCss());
    const count = (k: string, theme: string | null) =>
      sheet.scopes
        .filter((s) => s.kind === k && s.theme === theme)
        .reduce((n, s) => n + s.declarations.length, 0);
    expect(count("root", null)).toBe(CENSUS.root);
    expect(count("theme", "winter")).toBe(CENSUS.winter);
    expect(count("theme-inline", null)).toBe(CENSUS.themeInline);
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

describe("a brace inside a string in a NESTED body does not desync the depth (audit YATFA-6991 round 7)", () => {
  // REVERT PROBE K — restore the `depth === 0 &&` guard on the string-open test
  // in `blankNestedBlocks()` and every test here fails, as do six in
  // `resolve.test.ts`.
  //
  // Round 5's fix added `blankNestedBlocks`, whose docstring cites
  // `blankComments` as the technique it follows — and `blankComments` opens a
  // string UNCONDITIONALLY. This one gated it on `depth === 0`, and by
  // construction it is never at depth 0 inside the region it exists to blank, so
  // it was string-blind precisely there. Same class as the round-4 "top-level"
  // docstring over a depth-blind search: a comment quietly disagreeing with its
  // implementation.
  //
  // Measured before the fix, over 18 awkward declaration bodies placed once in a
  // nested body and once in a flat one: 7 of 18 lost a declaration nested, 2 of
  // 18 flat (both pre-existing, unquoted `url(a}b)` and a `--x: "}"` value).

  const rootNames = (css: string) =>
    parseStylesheet(css)
      .scopes.filter((s) => s.kind === "root")
      .flatMap((s) => s.declarations.map((d) => d.name));

  it("does not let a closing brace inside a nested body's string end the block early", () => {
    expect(rootNames(':root { --a: #111; .x { content: "}"; --nested: #999; } --b: #222; --c: #333; }'))
      .toEqual(["--a", "--b", "--c"]);
  });

  it("does not let an OPENING brace inside a nested body's string desync the other way", () => {
    expect(rootNames(':root { --a: #111; .x { content: "{"; } --b: #222; --c: #333; }'))
      .toEqual(["--a", "--b", "--c"]);
  });

  it("handles single quotes, escapes and url() the same way, at nested depth", () => {
    for (const [css, expected] of [
      [":root { --a: #111; .x { content: '}'; } --b: #222; }", ["--a", "--b"]],
      [':root { --a: #111; .x { content: "a\\"}b"; } --b: #222; }', ["--a", "--b"]],
      [':root { --a: #111; .x { background: url("a}b"); } --b: #222; }', ["--a", "--b"]],
      [':root { --a: #111; .x { background: url("a{b"); } --b: #222; }', ["--a", "--b"]],
      // Two levels down is still never depth 0.
      [':root { --a: #111; .x { .y { content: "}"; } } --b: #222; }', ["--a", "--b"]],
    ] as const) {
      expect(rootNames(css)).toEqual(expected);
    }
  });

  it("still reports the string-bearing nested rule under its own subject", () => {
    // The declaration must not merely survive in `:root` — the nested rule's own
    // declaration is still reported, under `other`, exactly as round 5 requires.
    const scopes = parseStylesheet(
      ':root { --a: #111; .x { content: "}"; --nested: #999; } --b: #222; }',
    ).scopes;
    expect(scopes.map((s) => `${s.kind}/${s.theme ?? "-"}`)).toEqual(["root/-", "other/-"]);
    expect(scopes[1].declarations.map((d) => d.name)).toEqual(["--nested"]);
  });

  it("leaves the fixture census exactly where it was", () => {
    // The cost check, asserted rather than promised: the calibration fixture uses
    // no nesting, so a correct string scan must move NOTHING here.
    const sheet = parseStylesheet(fixtureCss());
    const count = (k: string, theme: string | null) =>
      sheet.scopes
        .filter((s) => s.kind === k && s.theme === theme)
        .reduce((n, s) => n + s.declarations.length, 0);
    expect(count("root", null)).toBe(CENSUS.root);
    expect(count("theme", "winter")).toBe(CENSUS.winter);
    expect(count("theme-inline", null)).toBe(CENSUS.themeInline);
  });
});

describe("every var() USE is collected, not only the ones in token values", () => {
  // REVERT PROBE — restrict `readReferences` to custom-property declarations
  // (`if (!property.startsWith("--")) continue`) and every test here fails, as
  // do four in `rules.test.ts`.
  //
  // The distinction is not academic. A token can be USED by an ordinary
  // property in a block that declares no custom property at all — `.app-sidebar
  // { width: var(--sidebar-width) }` — which produces no `Scope`, so reading
  // uses out of declaration values alone leaves that use invisible. Over this
  // fixture that is the difference between 9 apparently-unreferenced tokens and
  // the 2 that genuinely are: `--font-family`, `--sidebar-width`,
  // `--app-focus-ring-width` and `--app-focus-ring-offset` are each used, and
  // each used ONLY by an ordinary property. Reporting them as referenced by
  // nothing is a false statement about the stylesheet, not a judgement call.
  const sheet = parseStylesheet(fixtureCss());

  it("collects 214 var() uses across the fixture", () => {
    expect(sheet.references).toHaveLength(214);
  });

  it("finds the uses that no custom-property value contains", () => {
    const use = (name: string) =>
      sheet.references.filter((r) => r.name === name).map((r) => `${r.property}:${r.line}`);
    expect(use("--sidebar-width")).toEqual(["width:881"]);
    expect(use("--app-focus-ring-width")).toEqual(["outline:777"]);
    expect(use("--font-family")).toEqual([
      "font-family:756",
      "font-family:2019",
      "font-family:2147",
    ]);
  });

  it("collects a use from a block that declares no custom property at all", () => {
    // `.app-sidebar` declares nothing, so it is not among `scopes` — the use
    // would be lost entirely if references rode on declarations.
    const sidebar = sheet.references.find((r) => r.name === "--sidebar-width");
    expect(sidebar?.kinds).toEqual(["other"]);
    expect(
      sheet.scopes.some((s) => s.declarations.some((d) => d.name === "--sidebar-width" && s.kind === "other")),
    ).toBe(false);
  });

  it("records the scope kinds of the block a use was written in", () => {
    // The `@theme inline` aliases are uses too — that is exactly what makes them
    // the reference layer rather than a dead namespace.
    const alias = sheet.references.filter((r) => r.kinds.includes("theme-inline"));
    expect(alias).toHaveLength(CENSUS.themeInline);
    // Every one is a `--<tailwind-namespace>-*: var(--app-*)` alias. Note the
    // namespace is NOT always `--color-`: Tailwind keys the generated utility
    // off it, so geometry aliases into `--radius-`/`--spacing-`/`--shadow-`.
    // A rule that recognised the alias layer by a `--color-` name prefix rather
    // than by its SCOPE would miss these six.
    expect(alias.every((r) => /^--[\w-]+$/.test(r.property))).toBe(true);
    const namespaces = new Set(alias.map((r) => (r.property.match(/^--([a-z]+)-/) ?? [])[1]));
    expect([...namespaces].sort()).toEqual(["color", "radius", "shadow", "spacing"]);
  });

  it("counts both names in a var() with a fallback", () => {
    const refs = parseStylesheet(":root { --a: var(--b, var(--c)); }").references;
    expect(refs.map((r) => r.name)).toEqual(["--b", "--c"]);
  });

  it("does not read a var() out of a comment", () => {
    const refs = parseStylesheet(":root { /* var(--ghost) */ --a: #fff; }").references;
    expect(refs.map((r) => r.name)).toEqual([]);
  });

  it("attributes a use in a nested rule to that rule, not to the enclosing scope", () => {
    const refs = parseStylesheet(":root { --a: #111; .card { color: var(--a); } }").references;
    expect(refs.map((r) => `${r.name}/${r.kinds.join(",")}`)).toEqual(["--a/other"]);
  });
});
