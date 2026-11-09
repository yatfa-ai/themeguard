import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { unresolvedReferenceRule } from "../src/rules/unresolved-reference.js";
import { loadStylesheet } from "../src/load.js";
import { parseStylesheet } from "../src/parse.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { fixtureCss, fixtureWriter, scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * Rule 5 — UNRESOLVED REFERENCE.
 *
 * The rule is one predicate — a name is used by some `var()` and declared in
 * no scope — over data the parser already collects. These tests pin the four
 * populations that used to pass silent, the masking shape where the tool's one
 * old signal pointed AWAY from the defect, the one-per-name aggregation, the
 * `@theme inline` lookup subtlety, `@property` registrations (an initial-value declares, a
 * `*` without one does not), suppression through BOTH doors (the config
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

const tmp = scratchDir("unresolved");

const cssFixture = fixtureWriter(tmp);

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
      "theme-partial-token": 0,
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
});

/**
 * `@property` registrations. A registration carrying an initial value declares
 * a name that always resolves; a `syntax: '*'` registration without one is
 * guaranteed-invalid and declares nothing. The registration is not a scope
 * declaration, so none of this may leak into the declared-name populations
 * the other rules read.
 */
describe("@property registrations", () => {
  const BRAND = `@property --brand { syntax: "<color>"; initial-value: #f00; inherits: true }`;

  it("a registered name with an initial-value is declared — no finding", () => {
    const sheet = resolveCss(`${BRAND}\n.x { color: var(--brand); }\n`);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
    expect(audit(sheet).countsByRule["unresolved-reference"]).toBe(0);
  });

  it("an unregistered neighbour beside a registered name is still reported, one finding", () => {
    const sheet = resolveCss(`${BRAND}\n.x { color: var(--brand); gap: var(--gap2, 1px); margin: var(--gap2, 2px); }\n`);
    const findings = unresolvedReferenceRule(sheet);
    expect(findings).toHaveLength(1);
    expect(findings[0].tokens).toEqual(["--gap2"]);
    expect(findings[0].message).toBe(
      "--gap2 is used at .x:2, .x:2 and no scope in this stylesheet declares it.",
    );
  });

  it("a syntax:'*' registration WITHOUT an initial-value is guaranteed-invalid — still reported", () => {
    const sheet = resolveCss(`@property --free { syntax: "*"; inherits: false }\n.x { color: var(--free); }\n`);
    const findings = unresolvedReferenceRule(sheet);
    expect(findings.map((f) => f.tokens)).toEqual([["--free"]]);
  });

  it("a syntax:'*' registration WITH an initial-value registers", () => {
    const sheet = resolveCss(`@property --free { syntax: "*"; inherits: false; initial-value: 4px }\n.x { width: var(--free); }\n`);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
  });

  it("a non-* syntax with no initial-value is invalid CSS and does not register", () => {
    const sheet = resolveCss(`@property --bad { syntax: "<color>"; inherits: false }\n.x { color: var(--bad); }\n`);
    expect(unresolvedReferenceRule(sheet).map((f) => f.tokens)).toEqual([["--bad"]]);
  });

  it("a registration with no syntax is invalid and does not register", () => {
    const sheet = resolveCss(`@property --bad { inherits: false; initial-value: #f00 }\n.x { color: var(--bad); }\n`);
    expect(unresolvedReferenceRule(sheet).map((f) => f.tokens)).toEqual([["--bad"]]);
  });

  it("the last valid registration wins: a later '*' without initial-value withdraws the earlier initial-value", () => {
    const sheet = resolveCss(`${BRAND}\n@property --brand { syntax: "*"; inherits: true }\n.x { color: var(--brand); }\n`);
    expect(unresolvedReferenceRule(sheet).map((f) => f.tokens)).toEqual([["--brand"]]);
  });

  it("a registration nested in @layer / @media is read", () => {
    const sheet = resolveCss(`
@layer base {
  @property --brand { syntax: "<color>"; initial-value: #f00; inherits: true }
}
@media (min-width: 1px) {
  @property --gap { syntax: "<length>"; initial-value: 2px; inherits: false }
}
.x { color: var(--brand); padding: var(--gap); }
`);
    expect(sheet.stylesheet.registrations?.map((r) => r.name)).toEqual(["--brand", "--gap"]);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
  });

  it("an @property nested inside a style rule is not a registration (CSS drops it)", () => {
    const css = `.x { @property --a { syntax: "<color>"; initial-value: red; inherits: false } color: var(--a); }\n`;
    expect(parseStylesheet(css).registrations).toBeUndefined();
    const findings = unresolvedReferenceRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0].tokens).toEqual(["--a"]);
  });

  it("a single-quoted syntax: '*' withdraws an earlier initial-value like the double-quoted spelling", () => {
    const sheet = resolveCss(`${BRAND}\n@property --brand { syntax: '*'; inherits: true }\n.x { color: var(--brand); }\n`);
    expect(unresolvedReferenceRule(sheet)).toHaveLength(1);
  });

  it("@PROPERTY is read case-insensitively", () => {
    const sheet = resolveCss(`@PROPERTY --brand { syntax: "<color>"; initial-value: #f00; inherits: true }\n.x { color: var(--brand); }\n`);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
  });

  it("descriptor names fold case", () => {
    const sheet = resolveCss(`@property --brand { Syntax: "<color>"; Initial-Value: #f00; Inherits: true }\n.x { color: var(--brand); }\n`);
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
  });

  it("a descriptor written twice keeps the last", () => {
    const css = `@property --brand { syntax: "<color>"; initial-value: #f00; syntax: "*"; inherits: true }`;
    expect(parseStylesheet(css).registrations?.[0]?.syntax).toBe("*");
  });

  it("a registration is not a scope declaration — scopes and declared names are unchanged", () => {
    const sheet = resolveCss(`${BRAND}\n.x { color: var(--brand); }\n`);
    expect(sheet.stylesheet.scopes).toEqual([]);
    expect(sheet.tokens).toEqual([]);
  });

  it("a sheet with no @property carries no registrations key", () => {
    const sheet = resolveCss(`:root { --a: #111; }\n.x { color: var(--a); }\n`);
    expect("registrations" in sheet.stylesheet).toBe(false);
  });

  it("a chain reaching a registered name resolves to its initial value — not kind unresolved", () => {
    const sheet = resolveCss(`${BRAND}
:root { --accent: var(--brand); --compound: 1px solid var(--brand); }
.x { color: var(--accent); border: var(--compound); }
`);
    const accent = sheet.token("--accent", "root")!;
    expect(accent.kind).toBe("color");
    expect(accent.resolvedValue).toBe("#f00");
    expect(accent.missingReference).toBe(null);
    expect(accent.chain).toEqual(["--accent", "--brand"]);
    expect(sheet.token("--compound", "root")!.kind).toBe("non-color");
    expect(unresolvedReferenceRule(sheet)).toEqual([]);
  });

  it("a chain into a '*' registration without an initial-value stays unresolved", () => {
    const sheet = resolveCss(`@property --free { syntax: "*"; inherits: false }
:root { --accent: var(--free); }
.x { color: var(--accent); }
`);
    expect(sheet.token("--accent", "root")!.kind).toBe("unresolved");
  });

  it("a scope declaration of the registered name wins over its initial-value", () => {
    const sheet = resolveCss(`${BRAND}
:root { --brand: #00f; --accent: var(--brand); }
[data-theme="dark"] { --other: #111; }
.x { color: var(--accent); }
`);
    expect(sheet.token("--accent", "root")!.resolvedValue).toBe("#00f");
    expect(sheet.token("--accent", "dark")!.resolvedValue).toBe("#00f");
  });

  it("a registration in an imported file registers the name for the whole closure", () => {
    const d = mkdtempSync(join(tmpdir(), "themeguard-property-"));
    try {
      writeFileSync(join(d, "props.css"), `${BRAND}\n`, "utf8");
      writeFileSync(
        join(d, "main.css"),
        `@import "./props.css";\n:root { --accent: var(--brand); }\n.x { color: var(--accent); background: var(--brand); }\n`,
        "utf8",
      );
      const sheet = resolveStylesheet(loadStylesheet(join(d, "main.css")));
      expect(sheet.stylesheet.registrations?.map((r) => [r.name, r.origin])).toEqual([["--brand", "props.css"]]);
      expect(unresolvedReferenceRule(sheet)).toEqual([]);
      expect(sheet.token("--accent", "root")!.kind).toBe("color");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
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
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 1 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
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
