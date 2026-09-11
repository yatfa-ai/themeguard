import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfig } from "../src/config.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { cycleReferenceRule } from "../src/rules/cycle-reference.js";
import { resolveCss } from "../src/resolve.js";
import { fixtureCss } from "./fixture.js";

/**
 * Rule 7 — CYCLE REFERENCE.
 *
 * The rule is one walk — per theme, the `kind === "cycle"` tokens the resolver
 * already reports, grouped by loop set and scoped by authorship — over data
 * that has flowed since the resolver represented its fourth fact explicitly.
 * These tests pin the shapes that used to pass silent (the root loop, the
 * self-loop, the three-token loop, the theme-authored loop), the two
 * authorship negatives that are the real test of the design (override-heals:
 * a theme that re-declares one member is clean while the root still reports;
 * inherited-dedupe: a root loop is one finding, not one per theme), the alias
 * namespace's stylesheet-wide stance, the cross-scope loop reported exactly as
 * the theme's view reports it, the tail-into-loop walk, suppression through
 * BOTH doors (the config entry and the site-scoped directive, the latter
 * reading the finding's `sites` positions), the exit code, and the
 * preservation of the calibration fixture's census — derived, never asserted
 * from memory.
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

const tmp = mkdtempSync(join(tmpdir(), "themeguard-cycle-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

describe("rule 6 — cycle reference, the shapes that used to pass silent", () => {
  it("a root loop with a consumer is ONE finding naming the loop as written, its declaration lines, and the consequence", () => {
    // Line 1 is empty; --a is line 3, --b is line 4.
    const css = `
:root {
  --a: var(--b);
  --b: var(--a);
}
.btn { color: var(--a); }
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.rule).toBe("cycle-reference");
    // The loop is authored in :root — a stylesheet-wide fact, not a theme's.
    expect(finding.theme).toBe(null);
    expect(finding.tokens).toEqual(["--a", "--b"]);
    expect(finding.message).toBe(
      "--a → --b → --a is a var() cycle: every property in the loop, and every var() consuming a member, is invalid at computed-value time. Declared at lines 3 and 4.",
    );
    expect(finding.sites).toEqual([
      { name: "--a", line: 3 },
      { name: "--b", line: 4 },
    ]);
    expect(finding.evidence["chain"]).toEqual(["--a", "--b", "--a"]);
    expect(finding.evidence["loop"]).toEqual(["--a", "--b"]);
    expect(finding.evidence["lines"]).toEqual(["3", "4"]);
    // Orthogonality pinned: dead-token is silent (both names ARE referenced —
    // by each other) and unresolved-reference is silent (both ARE declared),
    // so the audit's one finding is this rule's.
    const report = audit(resolveCss(css));
    expect(report.countsByRule["cycle-reference"]).toBe(1);
    expect(report.findings).toHaveLength(1);
  });

  it("a self-loop fires — one name is a loop of one", () => {
    const css = `
:root {
  --spinner: var(--spinner);
}
.use { color: var(--spinner); }
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
    expect(findings[0]!.tokens).toEqual(["--spinner"]);
    expect(findings[0]!.message).toContain("--spinner → --spinner is a var() cycle");
    expect(findings[0]!.sites).toEqual([{ name: "--spinner", line: 3 }]);
  });

  it("a three-token loop is ONE finding, not one per member", () => {
    const css = `
:root {
  --p: var(--q);
  --q: var(--r);
  --r: var(--p);
}
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    // The representative walk is the alphabetically first member's, as written.
    expect(findings[0]!.message).toContain("--p → --q → --r → --p is a var() cycle");
    expect(findings[0]!.tokens).toEqual(["--p", "--q", "--r"]);
    expect(findings[0]!.sites).toEqual([
      { name: "--p", line: 3 },
      { name: "--q", line: 4 },
      { name: "--r", line: 5 },
    ]);
  });

  it("a theme-authored loop is a THEME-scoped finding, and the root view — which resolves fine — is silent", () => {
    // Lines 6 and 7 are the dark block's own declarations.
    const css = `
:root {
  --accent: #22C55E;
}
[data-theme="dark"] {
  --accent: var(--accent2);
  --accent2: var(--accent);
}
.btn { color: var(--accent); }
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe("dark");
    expect(findings[0]!.tokens).toEqual(["--accent", "--accent2"]);
    // The lines are the theme's own cascade winners — where the loop closes.
    expect(findings[0]!.message).toBe(
      '--accent → --accent2 → --accent is a var() cycle in theme "dark": every property in the loop, and every var() consuming a member, is invalid at computed-value time. Declared at lines 6 and 7.',
    );
    expect(findings[0]!.sites).toEqual([
      { name: "--accent", line: 6 },
      { name: "--accent2", line: 7 },
    ]);
  });

  it("NEGATIVE — a theme that re-declares one loop member heals its view: that theme is clean while the root still reports", () => {
    const css = `
:root {
  --a: var(--b);
  --b: var(--a);
  --c: #003366;
}
[data-theme="dark"] {
  --b: var(--c);
}
`;
    const findings = cycleReferenceRule(resolveCss(css));
    // Exactly the root-authored loop, once: dark's --a walks out through its
    // own --b and resolves, so dark contributes no finding of any scoping.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
    expect(findings[0]!.tokens).toEqual(["--a", "--b"]);
  });

  it("NEGATIVE — a root loop an untouched theme inherits is ONE finding, not one per theme", () => {
    const css = `
:root {
  --a: var(--b);
  --b: var(--a);
}
[data-theme="dark"] {
  --accent: #111111;
}
`;
    const findings = cycleReferenceRule(resolveCss(css));
    // Dark's copies of --a/--b are the same loop seen inherited — deduped
    // under the root-authored finding, never re-emitted per theme.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
  });

  it("a loop authored in the @theme inline alias namespace is stylesheet-wide — the namespace is theme-independent", () => {
    // Lines 5 and 6 are the alias declarations.
    const css = `
:root {
  --app-cta: #22C55E;
}
@theme inline {
  --color-a: var(--color-b);
  --color-b: var(--color-a);
}
.x { color: var(--color-a); }
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
    expect(findings[0]!.tokens).toEqual(["--color-a", "--color-b"]);
    expect(findings[0]!.message).toContain("Declared at lines 6 and 7.");
  });

  it("a loop whose members span the base table and one theme is reported exactly as that theme's view reports it", () => {
    // --a is declared in :root (line 3), --b closes the loop from dark's own
    // block (line 6). Root's view cannot resolve --b at all, so the finding
    // belongs to the theme where the CSS consequence bites — with each member
    // cited at the line that theme resolves through.
    const css = `
:root {
  --a: var(--b);
}
[data-theme="dark"] {
  --b: var(--a);
}
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe("dark");
    // --a's line is the base declaration dark inherits; --b's is dark's own.
    expect(findings[0]!.sites).toEqual([
      { name: "--a", line: 3 },
      { name: "--b", line: 6 },
    ]);
    // And unresolved-reference stays silent: --b IS declared in this sheet.
    expect(audit(resolveCss(css)).countsByRule["unresolved-reference"]).toBe(0);
  });

  it("a walk with a tail into a loop is its own finding beside the loop's — the two say different things", () => {
    const css = `
:root {
  --a: var(--b);
  --b: var(--c);
  --c: var(--b);
}
`;
    const findings = cycleReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(2);
    const loop = findings.find((f) => f.tokens.join(",") === "--b,--c")!;
    const dependent = findings.find((f) => f.tokens.join(",") === "--a,--b,--c")!;
    // The loop itself.
    expect(loop.message).toContain("--b → --c → --b is a var() cycle");
    expect(loop.theme).toBe(null);
    // The dependent walk, printed as written — --a never returns to itself,
    // it points INTO the loop, and both halves are invalid all the same.
    expect(dependent.message).toContain("--a → --b → --c → --b is a var() cycle");
    expect(dependent.sites).toEqual([
      { name: "--a", line: 3 },
      { name: "--b", line: 4 },
      { name: "--c", line: 5 },
    ]);
  });
});

describe("suppression — the seventh rule id through both doors", () => {
  it("a config entry naming the rule and a member token moves the finding to the suppressed leg", () => {
    const css = `
:root {
  --a: var(--b);
  --b: var(--a);
}
.btn { color: var(--a); }
`;
    const report = audit(resolveCss(css), {
      suppressions: [
        { rule: "cycle-reference", token: "--a", reason: "re-pointed by the build step" },
      ],
    });
    expect(report.countsByRule["cycle-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.tokens).toEqual(["--a", "--b"]);
    expect(report.suppressed[0]?.reason).toBe("re-pointed by the build step");
  });

  it("a theme-scoped entry suppresses only its theme's finding, never the theme-less one", () => {
    const css = `
:root {
  --accent: #22C55E;
}
[data-theme="dark"] {
  --accent: var(--accent2);
  --accent2: var(--accent);
}
`;
    const report = audit(resolveCss(css), {
      suppressions: [
        { rule: "cycle-reference", theme: "dark", reason: "judged in dark only" },
      ],
    });
    expect(report.countsByRule["cycle-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.theme).toBe("dark");
  });

  it("a directive standalone on the line above the loop's first member suppresses — the line+1 conjunct", () => {
    const css = [
      ":root {",
      "  /* themeguard-ignore cycle-reference -- deliberate: re-pointed by the build */",
      "  --a: var(--b);",
      "  --b: var(--a);",
      "}",
    ].join("\n");
    const directives = scanIgnoreDirectives(css, "above.css");
    const report = audit(resolveCss(css), { suppressions: directives });
    expect(directives).toHaveLength(1);
    expect(report.countsByRule["cycle-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive trailing a loop member's own line suppresses too", () => {
    const css = [
      ":root {",
      "  --a: var(--b);",
      "  --b: var(--a); /* themeguard-ignore cycle-reference -- why */",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), {
      suppressions: scanIgnoreDirectives(css, "trailing.css"),
    });
    expect(report.countsByRule["cycle-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive somewhere else does NOT suppress — the miss self-announces", () => {
    const css = [
      ":root {",
      "  --a: var(--b);",
      "  --b: var(--a);",
      "}",
      ".else { color: var(--a); /* themeguard-ignore cycle-reference -- wrong site */ }",
    ].join("\n");
    const report = audit(resolveCss(css), {
      suppressions: scanIgnoreDirectives(css, "miss.css"),
    });
    expect(report.countsByRule["cycle-reference"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
  });
});

describe("runCli — the exit code moves with the seventh rule, both ways", () => {
  it("a loop is exit 1, its own section, and its count on the summary line", () => {
    const path = cssFixture(
      "loop.css",
      ":root {\n  --a: var(--b);\n  --b: var(--a);\n}\n.btn { color: var(--a); }\n",
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("cycle-reference (1)");
    expect(result.stdout).toContain(
      "  [cycle-reference] --a → --b → --a is a var() cycle: every property in the loop, and every var() consuming a member, is invalid at computed-value time. Declared at lines 2 and 3.",
    );
    expect(result.stdout).toContain(
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference, 1 cycle-reference, 0 duplicate-declaration.",
    );
  });

  it("suppressing it — directive or config — returns the exit to 0, counted in the suppressed section", () => {
    const directed = cssFixture(
      "loop-suppressed.css",
      [
        ":root {",
        "  /* themeguard-ignore cycle-reference -- loop kept for a vendored copy */",
        "  --a: var(--b);",
        "  --b: var(--a);",
        "}",
        "",
      ].join("\n"),
    );
    const result = run(directed);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("cycle-reference (0)");
    expect(result.stdout).toContain("suppressed (1)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [cycle-reference]"));
    expect(line).toContain('"loop kept for a vendored copy"');
    expect(line).toContain("loop-suppressed.css:2]");
    expect(result.stdout).toContain("No findings.");

    const dir = join(tmp, "config-door");
    mkdirSync(dir, { recursive: true });
    const cfgPath = cssFixture(
      "config-door/loop.css",
      ":root {\n  --a: var(--b);\n  --b: var(--a);\n}\n.btn { color: var(--a); }\n",
    );
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [{ rule: "cycle-reference", token: "--a", reason: "re-pointed by the build" }],
      }),
      "utf8",
    );
    const configured = run(cfgPath);
    expect(configured.code).toBe(EXIT_OK);
    expect(configured.stdout).toContain("suppressed (1)");
  });
});

describe("the config door — the seventh id is a valid suppression rule id", () => {
  it("parseConfig accepts a cycle-reference entry, and the unknown-rule error names the full list", () => {
    const entries = parseConfig(
      JSON.stringify({
        suppress: [{ rule: "cycle-reference", token: "--a", reason: "judged deliberate" }],
      }),
      "mem/config.json",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rule).toBe("cycle-reference");
  });
});

describe("census preservation over the calibration fixture — the 0, derived", () => {
  it("no token in any theme of the fixture resolves to a cycle; the rule adds 0 findings", () => {
    const resolved = resolveCss(fixtureCss());

    // The member-by-member derivation of the pinned 0: this list IS the
    // finding population, and it is empty in every theme.
    const cycleTokens = resolved.tokens.filter((t) => t.kind === "cycle");
    expect(cycleTokens.map((t) => `${t.theme}/${t.name}`)).toEqual([]);
    expect(cycleReferenceRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["cycle-reference"]).toBe(0);

    // And the fixture's census is untouched: the new heading prints at zero
    // and the ~22-finding pins keep their numbers (pinned in cli.test.ts,
    // config.test.ts and package.test.ts; re-pinned ADDITIVELY there).
    expect(audit(resolved).findings).toHaveLength(22);
  });
});
