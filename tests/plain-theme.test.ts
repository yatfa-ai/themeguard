import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/cli.js";
import { parseStylesheet } from "../src/parse.js";
import { resolveCss } from "../src/resolve.js";
import { numberedSheetWriter, scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * A plain Tailwind v4 `@theme { --color-… }` block declares the PALETTE: its
 * literals become utilities, and nothing else in the sheet declares them. It
 * must be judged like a `:root` palette — only `@theme inline`, whose entries
 * are `var()` pointers at a palette declared elsewhere, is the alias layer.
 * The one judgement a plain `@theme` is exempt from is dead-token: its
 * consumers are generated utilities a source read cannot see.
 */

/** The ticket's repro, with the block opener swapped in. */
const repro = (opener: string): string => `${opener} {
  --color-brand: #3366ff;
  --color-brand: #ff0000;
  --color-brand-500: #3366ff;
  --color-brand-600: #3367ff;
  --color-brand-700: #3368ff;
}
.dark { --color-brand-500: #99aaff; --color-brand-600: #99aaff; }
.btn { background: var(--color-brand-500); }
`;

const findingKeys = (css: string): string[] =>
  audit(resolveCss(css))
    .findings.map((f) => `${f.rule}:${f.tokens.join(",")}`)
    .sort();

describe("plain @theme is a palette scope", () => {
  it("reports the same findings as its :root twin, minus dead-token", () => {
    const theme = findingKeys(repro("@theme"));
    const root = findingKeys(repro(":root"));
    expect(root.some((k) => k.startsWith("dead-token:"))).toBe(true);
    expect(theme).toEqual(root.filter((k) => !k.startsWith("dead-token:")));
    // The specific findings the ticket names.
    expect(theme).toContain("duplicate-declaration:--color-brand");
    expect(theme.filter((k) => k.startsWith("family-consistency:"))).toEqual([
      "family-consistency:--color-brand",
      "family-consistency:--color-brand-700",
    ]);
  });

  it("exits non-zero on the repro, where it used to print No findings", () => {
    const dir = scratchDir("plain-theme");
    const sheet = numberedSheetWriter(dir);
    const result = run(sheet(repro("@theme")));
    expect(result.stdout).not.toContain("No findings.");
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("measures a hover state that collapses into its resting token (scale-collapse)", () => {
    const css = `@theme { --color-brand: #3366ff; --color-brand-hover: #3366ff; }
.x { color: var(--color-brand); background: var(--color-brand-hover); }`;
    const rule = (c: string) =>
      audit(resolveCss(c)).findings.filter((f) => f.rule === "scale-collapse").map((f) => f.tokens);
    expect(rule(css)).toEqual([["--color-brand", "--color-brand-hover"]]);
    expect(rule(css.replace("@theme", ":root"))).toEqual(rule(css));
  });

  it("counts the block's tokens as base tokens in coverage and shows a .dark override", () => {
    const report = audit(resolveCss(repro("@theme")));
    const root = report.coverage.find((t) => t.theme === "root");
    expect(root?.baseTokens).toBe(4);
    const dark = report.coverage.find((t) => t.theme === "dark");
    expect(dark?.overridden.map((e) => e.name)).toEqual(["--color-brand-500", "--color-brand-600"]);
    const stdout = run(numberedSheetWriter(scratchDir("plain-theme-cov"))(repro("@theme"))).stdout;
    expect(stdout).toContain("4 base tokens");
  });

  it("still counts the tokens as declared for unresolved-reference", () => {
    const css = `@theme { --color-brand: #3366ff; }
.x { color: var(--color-brand); border-color: var(--color-missing); }`;
    const names = audit(resolveCss(css))
      .findings.filter((f) => f.rule === "unresolved-reference")
      .map((f) => f.tokens.join(","));
    expect(names).toEqual(["--color-missing"]);
  });
});

describe("plain @theme and dead-token", () => {
  const css = (opener: string) => `${opener} { --color-brand-500: #3366ff; }
.x { color: red; }`;
  const dead = (c: string) =>
    audit(resolveCss(c)).findings.filter((f) => f.rule === "dead-token").map((f) => f.tokens.join(","));

  it("is silent for an @theme name", () => {
    expect(dead(css("@theme"))).toEqual([]);
  });

  it("still reports the same name declared in :root (the :root twin)", () => {
    expect(dead(css(":root"))).toEqual(["--color-brand-500"]);
  });

  it("still reports a :root name that merely sits beside an @theme block", () => {
    expect(dead(`@theme { --color-a: #111111; }\n:root { --lonely: #00aa00; }`)).toEqual(["--lonely"]);
  });
});

describe("@theme inline is unchanged: the alias layer", () => {
  it("reports collision only for the repro's literals", () => {
    const keys = findingKeys(repro("@theme inline"));
    expect(keys.filter((k) => !k.startsWith("collision:"))).toEqual([]);
  });

  it("reports no hover collapse for an alias pair", () => {
    const css = `@theme inline { --color-brand: #3366ff; --color-brand-hover: #3366ff; }
.x { color: var(--color-brand); background: var(--color-brand-hover); }`;
    expect(audit(resolveCss(css)).findings.filter((f) => f.rule === "scale-collapse")).toEqual([]);
  });
});

describe("each @theme option is read", () => {
  const one = (opener: string) => {
    const sheet = parseStylesheet(`${opener} { --color-a: #111111; }`);
    return sheet.scopes.map((s) => ({ kind: s.kind, rank: s.baseRank, atTheme: s.atTheme }));
  };

  it.each([
    ["@theme", "root"],
    ["@theme static", "root"],
    ["@theme default", "root"],
    ["@theme reference", "root"],
    ['@theme prefix(tw)', "root"],
    ["@theme inline", "theme-inline"],
    ["@theme inline reference", "theme-inline"],
    ["@theme reference inline", "theme-inline"],
    ["@theme  INLINE", "theme-inline"],
  ])("%s → %s", (opener, kind) => {
    const [scope] = one(opener);
    expect(scope?.kind).toBe(kind);
    if (kind === "root") {
      expect(scope?.atTheme).toBe(true);
      expect(scope?.rank).toBe(-1);
    } else {
      expect(scope?.atTheme).toBeUndefined();
    }
  });

  it("a prefix literally named inline does not make the block an alias layer", () => {
    expect(one("@theme prefix(inline)")[0]?.kind).toBe("root");
  });
});

describe("cascade rank: @theme sits below every unlayered base spelling", () => {
  const value = (css: string): string | undefined =>
    resolveCss(css).token("--color-a", "root")?.declaredValue;

  it("loses to :root and html, and to :where(html), whatever the document order", () => {
    for (const spelling of [":root", "html", ":where(html)"]) {
      expect(value(`${spelling} { --color-a: #222222; }\n@theme { --color-a: #111111; }`)).toBe("#222222");
      expect(value(`@theme { --color-a: #111111; }\n${spelling} { --color-a: #222222; }`)).toBe("#222222");
    }
  });

  it("later @theme blocks override earlier ones, as Tailwind merges them", () => {
    expect(value("@theme { --color-a: #111111; }\n@theme static { --color-a: #333333; }")).toBe("#333333");
  });
});

describe("unread-colors names the declaring block", () => {
  it("says `declared in @theme at` for a plain @theme token, and `declared at` for :root", () => {
    const body = `{ --font-x: color-mix(in hsl, red, blue); }`;
    const out = (opener: string) =>
      run(numberedSheetWriter(scratchDir("plain-theme-unread"))(`${opener} ${body}`)).stdout;
    expect(out("@theme")).toContain('    [unread] --font-x (color-mix) in theme "root", declared in @theme at line 1');
    expect(out(":root")).toContain('    [unread] --font-x (color-mix) in theme "root", declared at line 1');
    expect(out("@theme inline")).toContain("declared in @theme inline at line 1");
  });

  it("is OK exit on a clean plain @theme palette", () => {
    const result = run(
      numberedSheetWriter(scratchDir("plain-theme-clean"))(
        `@theme { --color-brand: #3366ff; --color-ink: #111111; }\n.x { color: var(--color-ink); }`,
      ),
    );
    expect(result.code).toBe(EXIT_OK);
  });
});
