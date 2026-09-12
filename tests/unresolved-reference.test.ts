import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { unresolvedReferenceRule } from "../src/rules/unresolved-reference.js";
import { resolveCss } from "../src/resolve.js";
import { fixtureCss } from "./fixture.js";

/**
 * Rule 5 — UNRESOLVED REFERENCE.
 *
 * The rule is one predicate — a name is used by some `var()` and declared in
 * no scope — over data the parser already collects. These tests pin the four
 * populations that used to pass silent, the masking shape where the tool's one
 * old signal pointed AWAY from the defect, the one-per-name aggregation, the
 * `@theme inline` lookup subtlety, the known `@property` false positive the
 * rule's docstring names, suppression through BOTH doors (the config
 * entry and the site-scoped directive, the latter reading the rule's
 * `evidence.usedIn` positions), the exit code, and the preservation of the
 * calibration fixture's census — derived member-by-member, never asserted from
 * memory.
 */

/**
 * One sheet holding all four populations at once, plus the controls that keep
 * them honest:
 *
 *   - the typo `--app-sucess` sits beside `--app-success`, which is declared
 *     AND referenced — exactly the shape `dead-token` is blind to, because its
 *     signal is about the DECLARED side;
 *   - `--color-app-typo` (the alias layer's own name) is used by a plain rule
 *     and resolves through the `@theme inline` declaration — the lookup hit
 *     that must NOT be reported;
 *   - the sheet produces a fully known report: no second theme (no
 *     family-consistency), one colour token (no collision), no state pair (no
 *     scale-collapse), and `--chain-a` is declared-but-unreferenced, so the
 *     dead-token count is exactly 1.
 */
const HOSTILE_CSS = `
:root {
  --app-success: #22C55E;
  --chain-a: var(--never-declared);
}
.btn-a { background: var(--app-success); }
.btn-b { background: var(--app-sucess); }
.fallback { color: var(--missing-thing, #FF0000); }
@theme inline {
  --color-app-typo: var(--app-cta-typo);
}
.alias-user { color: var(--color-app-typo); }
`;

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

const tmp = mkdtempSync(join(tmpdir(), "themeguard-unresolved-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

describe("the unresolved-reference rule — the four silent populations", () => {
  const resolved = resolveCss(HOSTILE_CSS);
  const report = audit(resolved);

  it("produces a fully known report — 4 unresolved names, and dead-token on exactly its own half", () => {
    expect(report.countsByRule).toEqual({
      collision: 0,
      "dead-token": 1,
      "scale-collapse": 0,
      "family-consistency": 0,
      "unresolved-reference": 4,
      "cycle-reference": 0,
      "duplicate-declaration": 0,
      "unresolved-import": 0,
    });
    expect(report.findings.map((f) => [f.rule, f.tokens[0]])).toEqual([
      ["dead-token", "--chain-a"],
      ["unresolved-reference", "--app-cta-typo"],
      ["unresolved-reference", "--app-sucess"],
      ["unresolved-reference", "--missing-thing"],
      ["unresolved-reference", "--never-declared"],
    ]);
  });

  it("names a typo'd use whose sibling is declared AND referenced — the shape dead-token cannot see", () => {
    const finding = report.findings.find((f) => f.tokens[0] === "--app-sucess");
    expect(finding?.rule).toBe("unresolved-reference");
    expect(finding?.message).toBe(
      "--app-sucess is used at .btn-b:7 and no scope in this stylesheet declares it.",
    );
  });

  it("reports a fallback-dangling use — the written fallback substitutes at runtime, and is not a defence", () => {
    const finding = report.findings.find((f) => f.tokens[0] === "--missing-thing");
    expect(finding?.message).toBe(
      "--missing-thing is used at .fallback:8 and no scope in this stylesheet declares it.",
    );
  });

  it("names the missing link of a broken declaration chain — the defect the old report pointed AWAY from", () => {
    const finding = report.findings.find((f) => f.tokens[0] === "--never-declared");
    expect(finding?.message).toBe(
      "--never-declared is used at :root:4 and no scope in this stylesheet declares it.",
    );
    expect(finding?.evidence).toEqual({ usedIn: [":root:4"], useCount: 1 });
  });

  it("reports a dangling alias chain from inside the @theme inline layer — the breakage that reaches the generated utilities", () => {
    const finding = report.findings.find((f) => f.tokens[0] === "--app-cta-typo");
    expect(finding?.message).toBe(
      "--app-cta-typo is used at @theme inline:10 and no scope in this stylesheet declares it.",
    );
  });

  it("does NOT report an alias that exists: a @theme inline declaration is a lookup hit, and its name used by a plain rule resolves", () => {
    expect(report.findings.some((f) => f.tokens[0] === "--color-app-typo")).toBe(false);
  });

  it("the masking shape: dead-token and unresolved-reference fire TOGETHER on the declaration-chain case, each on its own half", () => {
    // dead-token's one signal says `--chain-a` is unreferenced; the actual
    // defect — `--never-declared` — is named only by rule 5. Both findings at
    // once is the point: the tool now reports the defect, not just its shadow.
    expect(report.findings.filter((f) => f.rule === "dead-token").map((f) => f.tokens[0])).toEqual([
      "--chain-a",
    ]);
    expect(report.findings.filter((f) => f.rule === "unresolved-reference").map((f) => f.tokens[0]))
      .toEqual(["--app-cta-typo", "--app-sucess", "--missing-thing", "--never-declared"]);
  });

  it("aggregates one finding per NAME with every use site listed", () => {
    const sheet = resolveCss(`
.one { color: var(--ghost); }
.two { border-color: var(--ghost); }
`);
    const findings = unresolvedReferenceRule(sheet);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.tokens).toEqual(["--ghost"]);
    expect(findings[0]?.theme).toBeNull();
    expect(findings[0]?.message).toBe(
      "--ghost is used at .one:2, .two:3 and no scope in this stylesheet declares it.",
    );
    expect(findings[0]?.evidence).toEqual({ usedIn: [".one:2", ".two:3"], useCount: 2 });
  });

  it("keeps every evidence value inside the declared Finding[\"evidence\"] contract on the hostile sheet", () => {
    for (const f of report.findings) {
      for (const [key, value] of Object.entries(f.evidence)) {
        expect(
          typeof value === "string" || typeof value === "number" || Array.isArray(value),
          `${f.rule}/${f.tokens.join(",")} evidence.${key} is ${JSON.stringify(value)}`,
        ).toBe(true);
      }
    }
  });

  it("a clean sheet reports nothing — the predicate is the defect, not the var()", () => {
    const sheet = resolveCss(`
:root { --a: #111111; }
@theme inline { --color-a: var(--a); }
.use { color: var(--color-a); border-color: var(--a); }
`);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
    expect(audit(sheet).countsByRule["unresolved-reference"]).toBe(0);
  });

  it("an @property registration is invisible to the lookup — the named false positive, pinned as a known state", () => {
    // The parser emits no scope for an `@property` block (its body carries no
    // `--`-prefixed declarations), so a name REGISTERED there but declared in
    // no scope is reported — even though with an `initial-value` it resolves
    // at runtime and the finding is a false positive. The rule's docstring
    // names this limit rather than letting it read as a bug; this test pins
    // the behaviour so the day it changes (a parser that models `@property`
    // registrations is a deliberate follow-up, fenced out of this rule) the
    // change is chosen, not accidental. The same sheet also carries the
    // control: `--app-surface` is declared in a real scope and reported by
    // nothing.
    const sheet = resolveCss(`
@property --brand-ramp {
  syntax: "<color>";
  inherits: false;
  initial-value: #3B82F6;
}
:root { --app-surface: #FFFFFF; }
.hero { background: var(--brand-ramp); color: var(--app-surface); }
`);
    const findings = unresolvedReferenceRule(sheet);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("unresolved-reference");
    expect(findings[0].theme).toBe(null);
    expect(findings[0].tokens).toEqual(["--brand-ramp"]);
    expect(findings[0].message).toBe(
      "--brand-ramp is used at .hero:8 and no scope in this stylesheet declares it.",
    );
    expect(audit(sheet).countsByRule["unresolved-reference"]).toBe(1);
  });
});

describe("suppression — the fifth rule id through both doors", () => {
  const SUPPRESS_CSS = `
/* themeguard-ignore unresolved-reference -- hook name arrives at runtime */
.widget { color: var(--runtime-name); }
.other { color: var(--other-name); }
`;

  it("a config entry naming the rule and the token moves the finding to the suppressed leg", () => {
    const resolved = resolveCss(SUPPRESS_CSS);
    const report = audit(resolved, {
      suppressions: [
        { rule: "unresolved-reference", token: "--runtime-name", reason: "hook name arrives at runtime" },
      ],
    });
    expect(report.countsByRule["unresolved-reference"]).toBe(1);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.tokens).toEqual(["--runtime-name"]);
    expect(report.suppressed[0]?.reason).toBe("hook name arrives at runtime");
    // The un-named finding still reports.
    expect(report.findings.map((f) => f.tokens[0])).toEqual(["--other-name"]);
  });

  it("a directive trailing the use line suppresses through the rule's published positions", () => {
    const css = `.widget { color: var(--runtime-name); /* themeguard-ignore unresolved-reference -- why */ }`;
    const resolved = resolveCss(css);
    const directives = scanIgnoreDirectives(css, "site.css");
    const report = audit(resolved, { suppressions: directives });
    expect(directives).toHaveLength(1);
    expect(directives[0]?.line).toBe(1);
    expect(report.countsByRule["unresolved-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive standalone on the line above suppresses too — the line+1 conjunct", () => {
    const css = [
      "/* themeguard-ignore unresolved-reference -- why */",
      ".widget { color: var(--runtime-name); }",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "above.css") });
    expect(report.countsByRule["unresolved-reference"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive somewhere else does NOT suppress — the miss self-announces", () => {
    const css = [
      ":root { --unrelated: #111111; }",
      ".widget { color: var(--runtime-name); }",
      ".elsewhere { color: var(--unrelated); /* themeguard-ignore unresolved-reference -- wrong site */ }",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "miss.css") });
    expect(report.countsByRule["unresolved-reference"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
  });
});

describe("runCli — the exit code moves with the fifth rule, both ways", () => {
  it("a dangling use is exit 1, its own section, and its count on the summary line", () => {
    const path = cssFixture("ghost.css", ".use { color: var(--ghost); }\n");
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unresolved-reference (1)");
    expect(result.stdout).toContain(
      "  [unresolved-reference] --ghost is used at .use:1 and no scope in this stylesheet declares it.",
    );
    expect(result.stdout).toContain(
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 1 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import.",
    );
  });

  it("suppressing it — config or directive — returns the exit to 0, counted in the suppressed section", () => {
    const directed = cssFixture(
      "ghost-suppressed.css",
      [
        "/* themeguard-ignore unresolved-reference -- hook name arrives at runtime */",
        ".use { color: var(--ghost); }",
        "",
      ].join("\n"),
    );
    const result = run(directed);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unresolved-reference (0)");
    expect(result.stdout).toContain("suppressed (1)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [unresolved-reference]"));
    expect(line).toContain('"hook name arrives at runtime"');
    expect(line).toContain("ghost-suppressed.css:1]");
    expect(result.stdout).toContain(
      "No findings.",
    );
  });

  it("a config entry suppresses the same finding to exit 0", () => {
    const dir = join(tmp, "config-door");
    mkdirSync(dir, { recursive: true });
    const path = cssFixture("config-door/ghost.css", ".use { color: var(--ghost); }\n");
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [{ rule: "unresolved-reference", token: "--ghost", reason: "runtime-provided" }],
      }),
      "utf8",
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
  });
});

describe("census preservation over the calibration fixture — the 0, derived", () => {
  it("every distinct name the fixture's var() uses is declared somewhere; the rule adds 0 findings", () => {
    const resolved = resolveCss(fixtureCss());
    const sheet = resolved.stylesheet;

    // The lookup side: every scope declares, `@theme inline` included.
    const declared = new Set<string>();
    for (const scope of sheet.scopes) {
      for (const d of scope.declarations) declared.add(d.name);
    }
    // The used side: the distinct names across all references.
    const used = new Set(sheet.references.map((r) => r.name));

    // The pinned totals the 0 rests on — re-derive, never retype, when the
    // fixture or the parser changes. The declaration total is over ALL scopes
    // (189, one `other`-scope declaration beyond the 188 the kind-filtered
    // CENSUS sums), because the rule's lookup reads every scope.
    expect(sheet.scopes.flatMap((s) => s.declarations.map((d) => d.name)).length).toBe(189);
    expect(declared.size).toBe(138);
    expect(sheet.references.length).toBe(214);
    expect(used.size).toBe(72);

    // The member-by-member derivation of the pinned 0: this list IS the
    // finding set, and it is empty.
    expect([...used].filter((name) => !declared.has(name)).sort()).toEqual([]);
    expect(unresolvedReferenceRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["unresolved-reference"]).toBe(0);
  });
});
