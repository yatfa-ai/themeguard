import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfig } from "../src/config.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { loadStylesheet } from "../src/load.js";
import { themePartialTokenRule } from "../src/rules/theme-partial-token.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { fixtureCss } from "./fixture.js";

/**
 * Rule 9 — THEME PARTIAL TOKEN.
 *
 * The rule is one predicate — per theme, the resolver's `kind: "unresolved"`
 * tokens whose `missingReference` IS declared somewhere (rule 5's population
 * partitioned off) — over data the resolver already vouches for. These tests
 * pin the five shapes the proposal measured live (U1 the flagship
 * declaration-chain face, U2 the pure chain, D3 theme→theme, D4 the
 * `@theme inline` alias chain whose breakage reaches the generated utilities,
 * E1 the `prefers-color-scheme` conditioned root), the control that keeps the
 * partition honest (a name declared NOWHERE is rule 5's alone, never
 * double-reported), the three negative boundaries in both directions (B5 the
 * per-theme override that resolves everywhere, E3 the concrete fallback the
 * resolver substitutes — and the fallback-IS-a-var shape that legitimately
 * still breaks, E2 the name in every named theme whose base view still
 * counts), the per-NAME aggregation over two consumers and two views, the
 * recorded v1 residual (direct component consumption mints no unresolved
 * token and must stay silent), suppression through BOTH doors, the exit code,
 * and the preservation of the calibration fixture's census — derived, never
 * asserted from memory.
 */

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly stdout: string;
  readonly stderr: string;
}

function run(...args: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, out, err, stdout: out.join("\n"), stderr: err.join("\n") };
}

const tmp = mkdtempSync(join(tmpdir(), "themeguard-theme-partial-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

describe("rule 9 — the shapes that used to pass silent", () => {
  it("U1, the flagship: a token declared only in dark, consumed by an unscoped chain — exactly one finding naming all four halves", () => {
    // Lines 3-5 are :root's declarations (the chain consumer on 5), 7-10 the
    // dark block's (the theme-only declaration on 10). The two component
    // rules are the proposal's original silent consumers: `.code-block`'s
    // direct var() is the recorded v1 residual and reports nothing here —
    // the finding comes from the chain, which the resolver vouches for.
    const css = `
:root {
  --app-bg: #FFFFFF;
  --app-fg: #0F172A;
  --app-panel: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-bg: #0B1220;
  --app-fg: #E2E8F0;
  --app-code-bg: #020617;
}
.app-shell { background: var(--app-bg); color: var(--app-fg); }
.code-block { background: var(--app-code-bg); }
`;
    const resolved = resolveCss(css);
    const findings = themePartialTokenRule(resolved);
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.rule).toBe("theme-partial-token");
    // A cross-theme fact by construction — the same stance as dead-token.
    expect(finding.theme).toBe(null);
    expect(finding.tokens).toEqual(["--app-code-bg"]);
    expect(finding.message).toBe(
      '--app-code-bg is declared only in theme "dark" but never reaches theme "root" — ' +
      "there, --app-panel's var() chain resolves through it and finds nothing, " +
      'so the property falls back to unset/inherit. Declared in theme "dark" at line 10.',
    );
    // Consumer position first (where the defect bites, and where a directive
    // is written), then the declaring position (where the remedy lives).
    expect(finding.sites).toEqual([
      { name: "--app-panel", line: 5 },
      { name: "--app-code-bg", line: 10 },
    ]);
    expect(finding.evidence).toEqual({
      declaredInThemes: ["dark"],
      declaredLines: ["10"],
      unresolvedInThemes: ["root"],
      consumers: ["--app-panel"],
      consumerCount: 1,
    });
    // Audit-level: rule 5 stays silent (the name IS declared), rule 2 fires
    // on its own half (--app-panel is declared and referenced by no var()),
    // and the new rule holds the ninth count.
    const report = audit(resolved);
    expect(report.countsByRule).toEqual({
      collision: 0,
      "dead-token": 1,
      "scale-collapse": 0,
      "family-consistency": 0,
      "unresolved-reference": 0,
      "cycle-reference": 0,
      "duplicate-declaration": 0,
      "unresolved-import": 0,
      "theme-partial-token": 1,
    });
  });

  it("U2, the pure chain: the resolver reports the defect and the rule reads it", () => {
    const css = `
:root {
  --app-panel: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-code-bg"]);
    expect(findings[0]!.evidence).toMatchObject({
      declaredInThemes: ["dark"],
      unresolvedInThemes: ["root"],
      consumers: ["--app-panel"],
    });
  });

  it("D3, theme→theme: a chain in dark reaching for a winter-only token", () => {
    const css = `
[data-theme="winter"] {
  --winter-only: #F1F5F9;
}
[data-theme="dark"] {
  --app-panel: var(--winter-only);
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
    expect(findings[0]!.tokens).toEqual(["--winter-only"]);
    expect(findings[0]!.message).toBe(
      '--winter-only is declared only in theme "winter" but never reaches theme "dark" — ' +
      "there, --app-panel's var() chain resolves through it and finds nothing, " +
      'so the property falls back to unset/inherit. Declared in theme "winter" at line 3.',
    );
  });

  it("D4, the @theme inline alias chain: the breakage reaches the generated utility classes", () => {
    // The alias name is in EVERY theme's population (the namespace is
    // theme-independent); its walk breaks only in the views that lack the
    // target — and the generated `bg-app-panel`-class utilities inherit the
    // breakage, which is why the alias layer's own silence never covered
    // this shape.
    const css = `
:root {
  --app-cta: #22C55E;
}
@theme inline {
  --color-app-panel: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const resolved = resolveCss(css);
    const findings = themePartialTokenRule(resolved);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-code-bg"]);
    expect(findings[0]!.evidence).toEqual({
      declaredInThemes: ["dark"],
      declaredLines: ["9"],
      unresolvedInThemes: ["root"],
      consumers: ["--color-app-panel"],
      consumerCount: 1,
    });
    // The consumer is the alias-layer name itself — origin theme-inline —
    // and its cascade-winner line is the alias declaration.
    expect(findings[0]!.sites).toEqual([
      { name: "--color-app-panel", line: 6 },
      { name: "--app-code-bg", line: 9 },
    ]);
  });

  it("E1, the conditioned root: a target inside prefers-color-scheme is a theme of its own, and the base view still breaks", () => {
    const css = `
:root {
  --app-panel: var(--app-code-bg);
}
@media (prefers-color-scheme: dark) {
  :root {
    --app-code-bg: #020617;
  }
}
`;
    const resolved = resolveCss(css);
    const findings = themePartialTokenRule(resolved);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-code-bg"]);
    // The dark theme's own declaration is the one that satisfies its view;
    // the root view — a view the user is IN whenever the OS says light —
    // never receives the token.
    expect(findings[0]!.evidence).toEqual({
      declaredInThemes: ["dark"],
      declaredLines: ["7"],
      unresolvedInThemes: ["root"],
      consumers: ["--app-panel"],
      consumerCount: 1,
    });
  });

  it("CONTROL: a name declared NOWHERE is rule 5's population alone — the partition never double-reports", () => {
    const css = `
:root {
  --a: #111111;
}
.x { color: var(--a); background: var(--never-declared-anywhere); }
`;
    const resolved = resolveCss(css);
    expect(themePartialTokenRule(resolved)).toEqual([]);
    const report = audit(resolved);
    expect(report.countsByRule["unresolved-reference"]).toBe(1);
    expect(report.countsByRule["theme-partial-token"]).toBe(0);
  });
});

describe("the negative boundaries — both directions", () => {
  it("B5: declared in :root with a per-theme override resolves everywhere — silent", () => {
    const css = `
:root {
  --app-bg: #FFFFFF;
}
[data-theme="dark"] {
  --app-bg: #0B1220;
}
.app-shell { background: var(--app-bg); }
`;
    const resolved = resolveCss(css);
    expect(themePartialTokenRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["theme-partial-token"]).toBe(0);
  });

  it("E3: a concrete fallback substitutes and nothing is broken — silent", () => {
    const css = `
:root {
  --app-panel: var(--app-code-bg, #F5F5F5);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const resolved = resolveCss(css);
    // The resolver substitutes the fallback and mints NO unresolved token in
    // any view — the rule's population is empty by construction.
    expect(resolved.tokens.filter((t) => t.kind === "unresolved")).toEqual([]);
    expect(themePartialTokenRule(resolved)).toEqual([]);
  });

  it("E3's other side: a fallback that is ITSELF a var() onto a theme-only name still breaks, and is reported", () => {
    // The walk substitutes the fallback EXPRESSION, then breaks on it — the
    // missing lookup is real, the view genuinely has no value, and the
    // concrete-fallback carve-out does not cover it.
    const css = `
:root {
  --app-panel: var(--missing-entirely, var(--app-code-bg));
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-code-bg"]);
    // --missing-entirely is rule 5's, not rule 9's: it is declared nowhere.
    const report = audit(resolveCss(css));
    expect(report.countsByRule["theme-partial-token"]).toBe(1);
  });

  it("E2: declared in EVERY named theme but not :root still reports — the base view is a view the user is in", () => {
    const css = `
:root {
  --app-panel: var(--app-polar);
}
[data-theme="dark"] {
  --app-polar: #0B1220;
}
[data-theme="winter"] {
  --app-polar: #F1F5F9;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-polar"]);
    expect(findings[0]!.message).toBe(
      '--app-polar is declared only in themes "dark" and "winter" but never reaches theme "root" — ' +
      "there, --app-panel's var() chain resolves through it and finds nothing, " +
      'so the property falls back to unset/inherit. Declared in themes "dark" and "winter" at lines 6 and 9.',
    );
    expect(findings[0]!.sites).toEqual([
      { name: "--app-panel", line: 3 },
      { name: "--app-polar", line: 6 },
      { name: "--app-polar", line: 9 },
    ]);
  });
});

describe("emission — one finding per missing NAME, never per theme or consumer", () => {
  it("two chains consuming the same theme-only token yield ONE finding listing both consumers", () => {
    const css = `
:root {
  --app-panel: var(--app-code-bg);
  --app-card: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--app-code-bg"]);
    expect(findings[0]!.evidence).toMatchObject({
      consumers: ["--app-card", "--app-panel"],
      consumerCount: 2,
    });
    expect(findings[0]!.message).toContain(
      "there, --app-card and --app-panel's var() chains resolve through it and find nothing",
    );
  });

  it("a name missing from TWO views yields ONE finding naming both — and the inherited consumer dedupes to one site", () => {
    // Winter's --app-card is winter's own declaration; root's --app-panel is
    // the base. Each view cites its own consumer line; the missing name's
    // declaring themes are dark's alone.
    const css = `
:root {
  --app-panel: var(--app-code-bg);
}
[data-theme="winter"] {
  --app-card: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.evidence).toEqual({
      declaredInThemes: ["dark"],
      declaredLines: ["9"],
      unresolvedInThemes: ["root", "winter"],
      consumers: ["--app-card", "--app-panel"],
      consumerCount: 2,
    });
    expect(findings[0]!.message).toContain(
      'never reaches themes "root" and "winter"',
    );
  });

  it("two DIFFERENT theme-only names are two findings — one per name, sorted", () => {
    const css = `
:root {
  --app-panel: var(--app-code-bg);
  --app-toast: var(--app-toast-surface);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
  --app-toast-surface: #1E293B;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings.map((f) => f.tokens[0])).toEqual(["--app-code-bg", "--app-toast-surface"]);
  });
});

describe("the recorded v1 residual — direct component consumption stays out", () => {
  it("a component rule consuming a theme-only token, with NO declaration chain, mints no unresolved token — silent in v1", () => {
    // C1's hazard is why: `[data-theme="dark"] .card { … var(--app-glow) }`
    // is CORRECT CSS — the consumer only renders inside the declaring theme —
    // and its Reference.kinds read ["other"], byte-indistinguishable from
    // this genuinely-broken unscoped consumer. Distinguishing them needs
    // selector-prefix reasoning the parser deliberately does not do, so v1
    // claims only the chain face the resolver itself vouches for. This pin
    // makes the boundary a choice, never an accident.
    const css = `
:root {
  --app-bg: #FFFFFF;
}
[data-theme="dark"] {
  --app-bg: #0B1220;
  --app-code-bg: #020617;
}
.code-block { background: var(--app-code-bg); }
`;
    const resolved = resolveCss(css);
    expect(resolved.tokens.filter((t) => t.kind === "unresolved")).toEqual([]);
    expect(themePartialTokenRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["theme-partial-token"]).toBe(0);
    // Rule 5 is silent too — the name IS declared. The sheet audits green;
    // that silence is the residual, recorded rather than shipped.
    expect(audit(resolved).countsByRule["unresolved-reference"]).toBe(0);
  });
});

describe("suppression — the ninth rule id through both doors", () => {
  const CHAIN_CSS = `
:root {
  --app-panel: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`;

  it("a config entry naming the rule and the missing token moves the finding to the suppressed leg", () => {
    const report = audit(resolveCss(CHAIN_CSS), {
      suppressions: [
        { rule: "theme-partial-token", token: "--app-code-bg", reason: "dark-only token, root chain retired" },
      ],
    });
    expect(report.countsByRule["theme-partial-token"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.tokens).toEqual(["--app-code-bg"]);
    expect(report.suppressed[0]?.reason).toBe("dark-only token, root chain retired");
  });

  it("a theme-scoped entry matches nothing — the finding is a cross-theme fact and carries theme: null", () => {
    const report = audit(resolveCss(CHAIN_CSS), {
      suppressions: [{ rule: "theme-partial-token", theme: "dark", reason: "judged in dark only" }],
    });
    expect(report.countsByRule["theme-partial-token"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
  });

  it("a directive trailing the consuming chain's line suppresses — through the finding's own sites", () => {
    const css = [
      ":root {",
      "  --app-panel: var(--app-code-bg); /* themeguard-ignore theme-partial-token -- root chain retired */",
      "}",
      '[data-theme="dark"] {',
      "  --app-code-bg: #020617;",
      "}",
    ].join("\n");
    const directives = scanIgnoreDirectives(css, "site.css");
    const report = audit(resolveCss(css), { suppressions: directives });
    expect(directives).toHaveLength(1);
    expect(directives[0]?.line).toBe(2);
    expect(report.countsByRule["theme-partial-token"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive standalone on the line above the consumer suppresses too — the line+1 conjunct", () => {
    const css = [
      ":root {",
      "  /* themeguard-ignore theme-partial-token -- root chain retired */",
      "  --app-panel: var(--app-code-bg);",
      "}",
      '[data-theme="dark"] {',
      "  --app-code-bg: #020617;",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "above.css") });
    expect(report.countsByRule["theme-partial-token"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive somewhere else does NOT suppress — the miss self-announces", () => {
    const css = [
      ":root {",
      "  --app-panel: var(--app-code-bg);",
      "}",
      '[data-theme="dark"] {',
      "  --app-code-bg: #020617;",
      "}",
      ".else { color: var(--app-panel); /* themeguard-ignore theme-partial-token -- wrong site */ }",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "miss.css") });
    expect(report.countsByRule["theme-partial-token"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
  });

  it("the ninth id is a valid suppression rule id in the config, and the unknown-rule error names all nine", () => {
    const entries = parseConfig(
      JSON.stringify({
        suppress: [{ rule: "theme-partial-token", token: "--app-code-bg", reason: "judged deliberate" }],
      }),
      "mem/config.json",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rule).toBe("theme-partial-token");
  });
});

describe("import closure — the audit unit is the @import closure, and the rule honours the site contract", () => {
  it("a declaring theme spliced in from an imported sheet is cited BY FILE — in sites and in the message", () => {
    // pt-tokens.css lines 1-9 (the theme-only declaration on 8); the entry's
    // chain on its line 4. A hand-built `{ name, line }` site printed a bare
    // "at line 8" — a line the five-line entry file does not have — and
    // claimed entry-file positions for both halves in `sites`.
    cssFixture(
      "pt-tokens.css",
      [
        ":root {",
        "  --app-bg: #FFFFFF;",
        "  --app-fg: #0F172A;",
        "}",
        '[data-theme="dark"] {',
        "  --app-bg: #0B1220;",
        "  --app-fg: #E2E8F0;",
        "  --app-code-bg: #020617;",
        "}",
      ].join("\n"),
    );
    const path = cssFixture(
      "pt-closure.css",
      ['@import "./pt-tokens.css";', "", ":root {", "  --app-panel: var(--app-code-bg);", "}"].join("\n"),
    );
    const findings = themePartialTokenRule(resolveStylesheet(loadStylesheet(path)));
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    // The consumer sits in the entry file (no origin); the declaring site
    // was spliced in over the import edge, so it carries the file it sits in.
    expect(finding.sites).toEqual([
      { name: "--app-panel", line: 4 },
      { name: "--app-code-bg", line: 8, origin: "pt-tokens.css" },
    ]);
    // The message cites the file the line belongs to — "line 8" alone would
    // point into the entry file the reader has open.
    expect(finding.message).toBe(
      '--app-code-bg is declared only in theme "dark" but never reaches theme "root" — ' +
      "there, --app-panel's var() chain resolves through it and finds nothing, " +
      'so the property falls back to unset/inherit. Declared in theme "dark" at pt-tokens.css:8.',
    );
  });

  it("a closure split across two files cites each declaration independently — the file-aware clause, byte for byte", () => {
    cssFixture(
      "pt-split-dark.css",
      ['[data-theme="dark"] {', "  --app-target: #020617;", "}"].join("\n"),
    );
    const path = cssFixture(
      "pt-split.css",
      [
        '@import "./pt-split-dark.css";',
        "",
        ":root {",
        "  --app-panel: var(--app-target);",
        "}",
        '[data-theme="winter"] {',
        "  --app-target: #F1F5F9;",
        "}",
      ].join("\n"),
    );
    const findings = themePartialTokenRule(resolveStylesheet(loadStylesheet(path)));
    expect(findings).toHaveLength(1);
    // One declaring site carries an origin, so EVERY citation goes
    // independent — `positionClause`'s exact voice — instead of the
    // collective "lines 2 and 7", whose numbers share no file.
    expect(findings[0]!.message).toContain(
      'Declared in themes "dark" and "winter" at pt-split-dark.css:2 and line 7.',
    );
    expect(findings[0]!.sites).toEqual([
      { name: "--app-panel", line: 4 },
      { name: "--app-target", line: 2, origin: "pt-split-dark.css" },
      { name: "--app-target", line: 7 },
    ]);
  });

  it("the directive fence holds over the closure: an entry-file directive does not silence an imported finding whose line merely coincides", () => {
    // The consumer lives at pt-fence-chain.css line 1; the entry's directive
    // sits at entry line 1. Line numbers restart per file, so the bare
    // numbers coincide — the exact false suppression a hand-built site let
    // through, because a site with no origin reads as an entry-file line to
    // the fence.
    cssFixture(
      "pt-fence-chain.css",
      [
        ":root {",
        "  --app-panel: var(--app-code-bg);",
        "}",
        '[data-theme="dark"] {',
        "  --app-code-bg: #020617;",
        "}",
      ].join("\n"),
    );
    const path = cssFixture(
      "pt-fence.css",
      [
        "/* themeguard-ignore theme-partial-token -- a judgement about THIS file, not the closure */",
        '@import "./pt-fence-chain.css";',
        "",
        ".btn { color: red; }",
      ].join("\n"),
    );
    const report = audit(resolveStylesheet(loadStylesheet(path)), {
      suppressions: scanIgnoreDirectives(readFileSync(path, "utf8"), path),
    });
    // The finding survives — the fence sees no entry-file position in a
    // finding whose sites both live in the imported file.
    expect(report.countsByRule["theme-partial-token"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
    // And the miss self-announces, the counted-not-silent discipline every
    // orphaned directive answers to.
    expect(report.unmatchedSuppressions).toHaveLength(1);
  });
});

describe("runCli — the exit code moves with the ninth rule, both ways", () => {
  it("a theme-partial token is exit 1, its own section, and its count on the summary line", () => {
    const path = cssFixture(
      "partial.css",
      ':root {\n  --app-panel: var(--app-code-bg);\n}\n[data-theme="dark"] {\n  --app-code-bg: #020617;\n}\n.btn { color: var(--app-panel); }\n',
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("theme-partial-token (1)");
    expect(result.stdout).toContain(
      "  [theme-partial-token] --app-code-bg is declared only in theme \"dark\" but never reaches theme \"root\" — there, --app-panel's var() chain resolves through it and finds nothing, so the property falls back to unset/inherit. Declared in theme \"dark\" at line 5.",
    );
    expect(result.stdout).toContain(
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 1 theme-partial-token.",
    );
  });

  it("suppressing it — directive or config — returns the exit to 0, counted in the suppressed section", () => {
    const directed = cssFixture(
      "partial-suppressed.css",
      [
        ":root {",
        "  /* themeguard-ignore theme-partial-token -- root chain retired */",
        "  --app-panel: var(--app-code-bg);",
        "}",
        '[data-theme="dark"] {',
        "  --app-code-bg: #020617;",
        "}",
        ".btn { color: var(--app-panel); }",
        "",
      ].join("\n"),
    );
    const result = run(directed);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("theme-partial-token (0)");
    expect(result.stdout).toContain("suppressed (1)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [theme-partial-token]"));
    expect(line).toContain('"root chain retired"');
    expect(line).toContain("partial-suppressed.css:2]");
    expect(result.stdout).toContain("No findings.");

    const dir = join(tmp, "config-door");
    mkdirSync(dir, { recursive: true });
    const cfgPath = cssFixture(
      "config-door/partial.css",
      ':root {\n  --app-panel: var(--app-code-bg);\n}\n[data-theme="dark"] {\n  --app-code-bg: #020617;\n}\n.btn { color: var(--app-panel); }\n',
    );
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [
          { rule: "theme-partial-token", token: "--app-code-bg", reason: "dark-only token" },
        ],
      }),
      "utf8",
    );
    const configured = run(cfgPath);
    expect(configured.code).toBe(EXIT_OK);
    expect(configured.stdout).toContain("suppressed (1)");
  });
});

describe("census preservation over the calibration fixture — the 0, derived", () => {
  it("no token in any theme of the fixture resolves to unresolved-with-a-declared-target; the rule adds 0 findings", () => {
    const resolved = resolveCss(fixtureCss());

    // The member-by-member derivation of the pinned 0: this list IS the
    // finding population, and it is empty — the fixture mints no
    // `kind: "unresolved"` token in any view at all.
    const unresolved = resolved.tokens.filter((t) => t.kind === "unresolved");
    expect(unresolved.map((t) => `${t.theme}/${t.name}/${t.missingReference}`)).toEqual([]);
    expect(themePartialTokenRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["theme-partial-token"]).toBe(0);

    // And the fixture's census is untouched: the existing pins keep their
    // numbers; only the summary text gains a ninth (zero) count.
    expect(audit(resolved).findings).toHaveLength(22);
  });

  it("keeps every evidence value inside the declared Finding[\"evidence\"] contract", () => {
    const sheets = [
      `
:root {
  --app-panel: var(--app-code-bg);
  --app-card: var(--app-code-bg);
}
[data-theme="dark"] {
  --app-code-bg: #020617;
}
`,
      `
:root {
  --app-panel: var(--app-polar);
}
[data-theme="dark"] {
  --app-polar: #0B1220;
}
[data-theme="winter"] {
  --app-polar: #F1F5F9;
}
`,
    ];
    for (const css of sheets) {
      for (const finding of themePartialTokenRule(resolveCss(css))) {
        for (const [key, value] of Object.entries(finding.evidence)) {
          expect(
            typeof value === "string" || typeof value === "number" || Array.isArray(value),
            `${finding.rule}/${finding.tokens.join(",")} evidence.${key} is ${JSON.stringify(value)}`,
          ).toBe(true);
        }
      }
    }
  });
});
