import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseStylesheet, type Scope } from "../src/parse.js";
import { resolveCss } from "../src/resolve.js";

/**
 * A body-scoped no-JS dark-default palette is the dark theme. Inside a
 * `@media (prefers-color-scheme: dark)` block — flat or nested — a SOLO body
 * subject carrying only `:not(…)` negations (`body:not(.light)`, the OS-dark
 * spelling apps that toggle `document.body` write) is that palette's scope:
 * kind `theme`, named by the block's scheme, exactly like the `body.dark`
 * affirmative spelling. Its `html:not(.light)` twin reads the same sheet as a
 * root scope carrying the scheme (html is the base subject; body is
 * deliberately not), and the resolver lands both in one `dark` table, so the
 * twin's findings — the collision and scale-collapse a dark palette can carry
 * — fire for body byte-for-byte.
 *
 * The recognition keeps the html arm's gates and adds one: the negation is
 * REQUIRED on the body arm. html carries its bare spelling (`html { … }` in the
 * block) into the same conditioned read through the base recognition; body has
 * no `bareBody` base read at all, so a bare `body` — flat or nested-writing —
 * inside the block is the component-override shape and stays `other`. Every
 * narrowed shape keeps its `other` reading too: `body:hover`, `body::before`,
 * `body:has(…)`, `body:not(.light):hover` (something is left behind on the
 * negation-stripped compound), the unions (`body:not(.light), body`,
 * `html:not(.light), body:not(.light)`), a grouping (`:where(body:not(.light))`
 * — its argument arrives at the recursion negation-stripped, i.e. bare body),
 * another element (`div:not(.light)`), and the unconditional `body:not(.light)`
 * outside any scheme block.
 */

const LIGHT = "\n  --bg: #ffffff;\n  --surface: #f5f5f5;\n";
const NIGHT = "\n  --bg: #111111;\n  --surface: #111111;\n";
const USE = ".a { color: var(--bg); background: var(--surface); }\n";
const flat = (sel: string) => `:root {${LIGHT}}\n@media (prefers-color-scheme: dark) { ${sel} {${NIGHT}} }\n${USE}`;
const nested = (sel: string) =>
  `:root {${LIGHT}}\n@media (min-width: 40rem) {\n  @media (prefers-color-scheme: dark) { ${sel} {${NIGHT}} }\n}\n${USE}`;

const summarise = (css: string) => {
  const r = audit(resolveCss(css));
  return {
    themes: r.coverage.map((c) => c.theme),
    findings: r.findings.map((f) => `${f.rule}: ${f.message}`).sort(),
  };
};

const scopesOf = (css: string): readonly Scope[] => parseStylesheet(css).scopes;

describe("a negated body subject inside a prefers-color-scheme block", () => {
  const htmlTwin = summarise(flat("html:not(.light)"));

  it("body:not(.light) reports the dark collision beside the base — its html twin's findings", () => {
    const body = summarise(flat("body:not(.light)"));
    expect(body.themes).toEqual(["root", "dark"]);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toContain('collision: --bg and --surface both resolve to #111111 in theme "dark"');
    expect(body.findings[0]).toContain('theme "root" declares them apart');
  });

  it("is byte-identical to its html:not(.light) twin except the subject spelling", () => {
    expect(summarise(flat("body:not(.light)"))).toEqual(htmlTwin);
  });

  it("a dark palette collapsed to one value fires the same scale-collapse the html twin fires", () => {
    const collapsed = (sel: string) =>
      `:root { --bg: #ffffff; --bg-hover: #ededed; }\n@media (prefers-color-scheme: dark) { ${sel} { --bg: #111111; --bg-hover: #111111; } }\n.a { color: var(--bg); background: var(--bg-hover); }\n`;
    const body = summarise(collapsed("body:not(.light)"));
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toContain("scale-collapse: --bg-hover is ΔL* 0.00 from --bg in theme \"dark\"");
    expect(body).toEqual(summarise(collapsed("html:not(.light)")));
  });

  it("nested inside a media at-rule the scheme block still names the theme — twin-identical", () => {
    expect(summarise(nested("body:not(.light)"))).toEqual(summarise(nested("html:not(.light)")));
    expect(summarise(nested("body:not(.light)")).findings).toHaveLength(1);
    expect(summarise(nested("body:not(.light)")).findings[0]).toContain("collision:");
  });

  it("files as a theme scope named by the block's scheme, never a root scope", () => {
    const scopes = scopesOf(flat("body:not(.light)"));
    expect(scopes.map((s) => s.kind)).toEqual(["root", "theme"]);
    expect(scopes.find((s) => s.kind === "theme")?.theme).toBe("dark");
    expect(scopes.every((s) => s.kind !== "root" || s.colorScheme === undefined)).toBe(true);
  });

  it("a light scheme block names the theme light — the block's value, not a hard-coded dark", () => {
    const css = `:root {${NIGHT}}\n@media (prefers-color-scheme: light) { body:not(.dark) {${LIGHT}} }\n${USE}`;
    expect(scopesOf(css).map((s) => s.kind)).toEqual(["root", "theme"]);
    expect(scopesOf(css).find((s) => s.kind === "theme")?.theme).toBe("light");
  });

  it("case-folded BODY:not(.light) and an attribute negation read the same theme", () => {
    expect(scopesOf(flat("BODY:not(.light)")).map((s) => s.kind)).toEqual(["root", "theme"]);
    expect(scopesOf(flat('body:not([data-theme="light"])')).map((s) => s.kind)).toEqual(["root", "theme"]);
  });
});

describe("shapes that keep their other reading", () => {
  const inBlock = (sel: string) => `@media (prefers-color-scheme: dark) { ${sel} {${NIGHT}} }`;

  for (const sel of ["body:hover", "body::before", "body:has(.dark)", "body:not(.light):hover"]) {
    it(`${sel} inside the block stays other — something is left on the stripped compound`, () => {
      expect(scopesOf(inBlock(sel)).map((s) => s.kind)).toEqual(["other"]);
    });
  }

  it("a bare body inside the block stays other — the negation is required on this arm", () => {
    expect(scopesOf(inBlock("body")).map((s) => s.kind)).toEqual(["other"]);
  });

  it("the nested writing body { @media … { … } } stays other too", () => {
    expect(scopesOf(`body { @media (prefers-color-scheme: dark) {${NIGHT}} }`).map((s) => s.kind)).toEqual(["other"]);
  });

  for (const sel of ["body:not(.light), body", "html:not(.light), body:not(.light)", ":where(body:not(.light))", "div:not(.light)"]) {
    it(`${sel} inside the block stays other`, () => {
      expect(scopesOf(inBlock(sel)).map((s) => s.kind)).toEqual(["other"]);
    });
  }

  it("without the media condition body:not(.light) is still other", () => {
    expect(scopesOf(`body:not(.light) {${NIGHT}}`).map((s) => s.kind)).toEqual(["other"]);
  });
});
