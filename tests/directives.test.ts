import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { DirectiveError, scanIgnoreDirectives } from "../src/directives.js";
import { audit } from "../src/audit.js";
import { resolveCss } from "../src/resolve.js";

/**
 * `/* themeguard-ignore … *\/` — the site-scoped suppression slice.
 *
 * Three layers, tested at the layer that owns the behaviour (the same split
 * `config.test.ts` uses for the project-level mechanism this complements):
 *
 *   - `scanIgnoreDirectives` is PURE over the stylesheet text, so the
 *     grammar — both placements, token names, the required reason, and every
 *     hard error — is a data-in, error-out assertion. The errors are the
 *     point: a directive the package cannot honour names its line and exits
 *     2, never a silent skip.
 *   - `audit` owns the MATCHING: an entry carrying `line` matches only a
 *     finding living at the directive's site (its own line, or the line
 *     directly below a standalone comment); an entry without one — every
 *     config entry — behaves byte-identically to before.
 *   - `runCli` owns the RUN-3 scenario this slice exists for: a judgement
 *     recorded at a site stops covering the finding when the code moves away
 *     from it — the orphaned directive self-announces through the finding
 *     printing again and the exit code moving — while an annotation on the
 *     live line suppresses with its `[file:line]` source clause.
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

describe("scanIgnoreDirectives — the grammar, as data in and errors out", () => {
  it("reads the trailing placement — the comment's own line, and file:line source", () => {
    const css = [
      ":root {",
      "  --success: #16A34A;",
      "  --accent: #16A34A; /* themeguard-ignore collision --accent --success -- vendor brand */",
      "}",
    ].join("\n");
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([
      {
        rule: "collision",
        tokens: ["--accent", "--success"],
        reason: "vendor brand",
        line: 3,
        source: "vendor.css:3",
      },
    ]);
  });

  it("reads the standalone placement — a comment on the line directly above", () => {
    const css = [
      ":root {",
      "  /* themeguard-ignore dead-token --legacy-logout -- kept for the native app */",
      "  --legacy-logout: #00AA00;",
      "}",
    ].join("\n");
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([
      {
        rule: "dead-token",
        tokens: ["--legacy-logout"],
        reason: "kept for the native app",
        line: 2,
        source: "vendor.css:2",
      },
    ]);
  });

  it("returns every directive, in source order, and no others", () => {
    const css = [
      "/* an ordinary comment that mentions --tokens: value prose */",
      ":root {",
      "  --a: #111111; /* themeguard-ignore dead-token --a -- one */",
      "  --b: #222222;",
      "  /* themeguard-ignore collision --b --c -- two */",
      "  --c: #222222;",
      "}",
    ].join("\n");
    const directives = scanIgnoreDirectives(css, "vendor.css");
    expect(directives).toHaveLength(2);
    expect(directives[0]?.rule).toBe("dead-token");
    expect(directives[0]?.line).toBe(3);
    expect(directives[1]?.rule).toBe("collision");
    expect(directives[1]?.tokens).toEqual(["--b", "--c"]);
    expect(directives[1]?.line).toBe(5);
  });

  it("parses several token names, in order, with the set-includes meaning of a config entry", () => {
    const css =
      "/* themeguard-ignore collision --accent --success --cta -- four names, one reason */";
    const [directive] = scanIgnoreDirectives(css, "vendor.css");
    expect(directive?.tokens).toEqual(["--accent", "--success", "--cta"]);
    expect(directive?.reason).toBe("four names, one reason");
  });

  it("accepts a directive that names no token — the site is the judgement", () => {
    const css = ":root { --accent: #16A34A; } /* themeguard-ignore collision -- deliberate here */";
    const [directive] = scanIgnoreDirectives(css, "vendor.css");
    // The entry carries NO token dimension at all — absence is legible, not
    // an empty set that would read as naming something.
    expect(directive).toEqual({
      rule: "collision",
      reason: "deliberate here",
      line: 1,
      source: "vendor.css:1",
    });
  });

  it("ignores the keyword inside a CSS string — the scan is string-aware", () => {
    const css = `.x { content: "/* themeguard-ignore dead-token --x -- prose, not a directive */"; }`;
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([]);
  });

  it("ignores near-miss keywords — only the exact word starts a directive", () => {
    const css = [
      "/* themeguard-ignored -- not a directive */",
      "/* themeguard-ignorecollision -- not a directive */",
      "/* themeguard-ignorex */",
    ].join("\n");
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([]);
  });

  it("returns nothing for a stylesheet with no directives — an absent mechanism is empty, not an error", () => {
    const css = ":root { --a: #111111; } /* a plain comment */";
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([]);
  });

  it("dates a multi-line directive comment from the line it STARTS on", () => {
    const css = [
      "/* themeguard-ignore collision",
      "  --accent --success",
      "  -- a reason that spans lines */",
      ":root { --accent: #16A34A; --success: #16A34A; }",
    ].join("\n");
    const [directive] = scanIgnoreDirectives(css, "vendor.css");
    expect(directive?.line).toBe(1);
    expect(directive?.reason).toBe("a reason that spans lines");
  });

  it("rejects an unknown rule id, naming the comment's line and the canonical rule ids", () => {
    const css = [
      ":root {",
      "  --a: #111111; /* themeguard-ignore colision --a -- typo */",
      "}",
    ].join("\n");
    const error = (() => {
      try {
        scanIgnoreDirectives(css, "vendor.css");
      } catch (e) {
        return e as DirectiveError;
      }
      throw new Error("expected scanIgnoreDirectives to throw");
    })();
    expect(error).toBeInstanceOf(DirectiveError);
    expect(error.message).toContain("vendor.css:2");
    expect(error.message).toContain('unknown rule "colision"');
    // The list is config's own sentence — the same seven ids a config entry's
    // error names — reached through config's own parser, never a local copy.
    expect(error.message).toContain(
      "collision, dead-token, scale-collapse, family-consistency, unresolved-reference, cycle-reference, duplicate-declaration",
    );
    expect(error.path).toBe("vendor.css");
    expect(error.line).toBe(2);
  });

  it("rejects a directive with no rule id after the keyword", () => {
    const css = "/* themeguard-ignore */";
    expect(() => scanIgnoreDirectives(css, "vendor.css")).toThrowError(
      /vendor\.css:1 — names no rule — a directive is "themeguard-ignore <rule> \[--token …\] -- <why>"/,
    );
  });

  it("rejects a missing reason — no bare -- separator, no suppression", () => {
    const css = "/* themeguard-ignore collision --accent */";
    expect(() => scanIgnoreDirectives(css, "vendor.css")).toThrowError(
      /vendor\.css:1 — ends without a reason/,
    );
  });

  it("rejects an empty reason — the report quotes the why, and there is nothing to quote", () => {
    const css = "/* themeguard-ignore collision --accent -- */";
    expect(() => scanIgnoreDirectives(css, "vendor.css")).toThrowError(
      /vendor\.css:1 — "reason" must be a non-empty string/,
    );
  });

  it("rejects a head word that is neither the rule id nor a token name", () => {
    const css = "/* themeguard-ignore collision vendor brand */";
    expect(() => scanIgnoreDirectives(css, "vendor.css")).toThrowError(
      /vendor\.css:1 — expected a token name like --accent, or the bare "--" that starts the reason — got "vendor"/,
    );
  });
});

/**
 * A stylesheet with exactly two findings, each on a KNOWN line: the
 * `--accent`/`--success` collision (declared at lines 2 and 3) and the dead
 * `--unused` token (declared at line 4, which carries no `sites` — its
 * position is `evidence.declaredIn`'s `":root:4"`).
 */
const SITE_CSS = `:root {
  --accent: #16A34A;
  --success: #16A34A;
  --unused: #123456;
}

.a { color: var(--accent); }
.b { color: var(--success); }
`;

describe("audit — the site conjunct, on top of entry matching that has not changed", () => {
  const resolved = resolveCss(SITE_CSS);

  it("suppresses when a finding site sits on the directive's line — the trailing placement", () => {
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          reason: "vendor brand",
          line: 2,
          source: "vendor.css:2",
        },
      ],
    });
    // The collision moved to `suppressed` carrying the reason; the dead token
    // — a different rule at a different site — is untouched.
    expect(report.findings.map((f) => f.rule)).toEqual(["dead-token"]);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.reason).toBe("vendor brand");
    expect(report.suppressed[0]?.finding.rule).toBe("collision");
  });

  it("suppresses through the standalone placement — a site on the line directly below", () => {
    // Line 1 holds the (modelled) standalone comment; --accent's declaration
    // is on line 2, directly below it.
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          reason: "vendor brand",
          line: 1,
          source: "vendor.css:1",
        },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.findings.map((f) => f.rule)).toEqual(["dead-token"]);
  });

  it("leaves the finding when NO site is at or below the directive — the orphan, at unit grain", () => {
    // Line 9 is nowhere near either declaration: the judgement was recorded
    // about a site the finding no longer lives at, so the finding prints.
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          reason: "vendor brand",
          line: 9,
          source: "vendor.css:9",
        },
      ],
    });
    expect(report.findings).toHaveLength(2);
    expect(report.suppressed).toHaveLength(0);
  });

  it("reaches a dead token through evidence.declaredIn — the position it already publishes", () => {
    // --unused is declared at line 4 with no `sites`; its lines come from the
    // `":root:4"` strings its own evidence carries.
    const at = audit(resolved, {
      suppressions: [
        { rule: "dead-token", reason: "not yet wired up", line: 4, source: "vendor.css:4" },
      ],
    });
    expect(at.findings.map((f) => f.rule)).toEqual(["collision"]);
    expect(at.suppressed.map((s) => s.finding.tokens)).toEqual([["--unused"]]);

    // And the same conjunct keeps a dead-token directive from reaching across
    // the file: line 2 is the collision's line, not the declaration's.
    const elsewhere = audit(resolved, {
      suppressions: [
        { rule: "dead-token", reason: "not yet wired up", line: 2, source: "vendor.css:2" },
      ],
    });
    expect(elsewhere.findings).toHaveLength(2);
    expect(elsewhere.suppressed).toHaveLength(0);
  });

  it("keeps every config entry byte-identical — no line, no site conjunct, exactly today's reach", () => {
    // The SAME identity as the orphan case above, minus `line`: the config
    // mechanism suppresses wherever the finding lives, which is precisely the
    // behaviour the site conjunct was added beside, not over.
    const report = audit(resolved, {
      suppressions: [{ rule: "collision", tokens: ["--accent", "--success"], reason: "vendor brand" }],
    });
    expect(report.findings.map((f) => f.rule)).toEqual(["dead-token"]);
    expect(report.suppressed).toHaveLength(1);
    // The entry the caller passed comes back whole — no padded site fields.
    expect(report.suppressed[0]?.entry).toEqual({
      rule: "collision",
      tokens: ["--accent", "--success"],
      reason: "vendor brand",
    });
  });

  it("carries the site through to the suppressed entry, so the report can name where", () => {
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          reason: "vendor brand",
          line: 2,
          source: "vendor.css:2",
        },
      ],
    });
    expect(report.suppressed[0]?.entry).toMatchObject({ line: 2, source: "vendor.css:2" });
  });
});

/**
 * The RUN-3 scenario, at the layer a user actually runs — the whole point of
 * the slice. A vendor stylesheet carries a deliberate collision; the
 * annotation lives IN the file; the file is then refactored.
 */
describe("runCli — the site-scoped suppression, end to end", () => {
  const tmp = mkdtempSync(join(tmpdir(), "themeguard-directives-"));

  function cssFixture(name: string, css: string): string {
    const path = join(tmp, name);
    writeFileSync(path, css, "utf8");
    return path;
  }

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** The deliberate pair, annotated where it is written (standalone, line 3, above line 4). */
  const ANNOTATED = [
    ":root {",
    "  --success: #16A34A;",
    "  /* themeguard-ignore collision --accent --success -- vendor brand: accent intentionally matches success green */",
    "  --accent: #16A34A;",
    "}",
    ".a { color: var(--success); }",
    ".b { color: var(--accent); }",
  ].join("\n");

  /** The same stylesheet after a refactor moves --accent to line 7 — the annotation did not follow. */
  const REFACTORED_STALE = [
    ":root {",
    "  --success: #16A34A;",
    "  /* themeguard-ignore collision --accent --success -- vendor brand: accent intentionally matches success green */",
    "}",
    ".a { color: var(--success); }",
    "",
    ":root { --accent: #16A34A; }",
    ".b { color: var(--accent); }",
  ].join("\n");

  /** The refactored stylesheet, annotated again — this time on the LIVE line (trailing, line 7). */
  const REFACTORED_ANNOTATED = [
    ":root {",
    "  --success: #16A34A;",
    "}",
    ".a { color: var(--success); }",
    "",
    ":root {",
    "  --accent: #16A34A; /* themeguard-ignore collision --accent --success -- vendor brand: accent intentionally matches success green */",
    "}",
    ".b { color: var(--accent); }",
  ].join("\n");

  it("RUN 2 — the annotation on the original line suppresses the finding, quoted, with its [file:line] clause, exit 0", () => {
    const path = cssFixture("vendor-a.css", ANNOTATED);
    const result = run(path);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("No findings.");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [collision]"));
    expect(line).toContain('"vendor brand: accent intentionally matches success green"');
    expect(line).toContain("[tokens: --accent, --success]");
    expect(line).toContain("vendor-a.css:3]");
  });

  it("RUN 3 — after the refactor, the orphaned directive no longer covers the defect: it re-reports, counted, exit 1", () => {
    const path = cssFixture("vendor-b.css", REFACTORED_STALE);
    const result = run(path);
    // The orphan self-announces: the finding the judgement used to cover is
    // back in the counts, under its own rule, with its new position printed.
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain(
      "1 finding: 1 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration.",
    );
    expect(
      result.out.find((l) => l.startsWith("  [collision]")),
    ).toContain("Declared at lines 7 and 2.");
  });

  it("RUN 3, repaired — annotating the LIVE line suppresses again, with the new site as the source clause", () => {
    const path = cssFixture("vendor-c.css", REFACTORED_ANNOTATED);
    const result = run(path);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("vendor-c.css:7]");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [collision]"));
    expect(line).toContain("Declared at lines 7 and 2.");
  });

  it("a malformed directive is the config's own contract — exit 2 naming the comment's line, and no report", () => {
    const path = cssFixture(
      "vendor-bad.css",
      [":root {", "  --a: #111111; /* themeguard-ignore colision --a -- typo */", "}"].join("\n"),
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("vendor-bad.css:2");
    expect(result.stderr).toContain('unknown rule "colision"');
    expect(result.out).toEqual([]);
  });

  it("config entries and directive entries merge at the one seam — each suppresses by its own scope, and only the directive's line carries a source clause", () => {
    const path = cssFixture(
      "both.css",
      [
        ":root {",
        "  --accent: #16A34A;",
        "  --success: #16A34A;",
        "  --unused: #123456; /* themeguard-ignore dead-token --unused -- kept for an upcoming page */",
        "}",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    writeFileSync(join(tmp, "themeguard.config.json"), JSON.stringify({
      suppress: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          theme: "root",
          reason: "brand, whole",
        },
      ],
    }));
    const result = run(path);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (2)");
    const lines = result.out.filter((l) => l.startsWith("  [suppressed]"));
    // The config entry's line discloses its theme/token scope and NO site.
    const configLine = lines.find((l) => l.includes('"brand, whole"'));
    expect(configLine).toContain("[theme: root, tokens: --accent, --success]");
    expect(configLine).not.toMatch(/\.css:\d+\]/);
    // The directive's line discloses where the judgement lives.
    const directiveLine = lines.find((l) => l.includes("kept for an upcoming page"));
    expect(directiveLine).toContain("both.css:4]");
    expect(result.stdout).toContain(
      "findings marked deliberate — in themeguard.config.json or in a themeguard-ignore directive in the stylesheet.",
    );
  });
});
