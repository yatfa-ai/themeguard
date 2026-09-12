import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfig } from "../src/config.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { loadStylesheet } from "../src/load.js";
import { duplicateDeclarationRule } from "../src/rules/duplicate-declaration.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { fixtureCss } from "./fixture.js";

/**
 * Rule 7 — DUPLICATE DECLARATION.
 *
 * The rule is one walk — per scope, the pre-fold `scope.declarations` the
 * parser already keeps, grouped by name, flagged when one name is declared
 * twice or more with DIFFERING values — over data that has flowed since the
 * first parse; the resolver's last-wins fold is the finding's subject, never
 * something to change. These tests pin the shapes that used to pass silent
 * (the referenced duplicate that coverage even deduped into one token, the
 * theme-scope duplicate, the selector-list block that parses as two scopes
 * over one source block), the negatives that are the real test of the design
 * (cross-scope override is the theme system working; a same-value repeat
 * resolves to the identical cascade outcome; `@theme inline` is the reference
 * layer), the alias-name fence (duplicate-ness is judgeable from the source,
 * so unlike dead-token the rule never skips alias names), suppression through
 * BOTH doors (the config entry and the site-scoped directive), the exit code,
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

const tmp = mkdtempSync(join(tmpdir(), "themeguard-duplicate-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

describe("rule 7 — duplicate declaration, the shapes that used to pass silent", () => {
  it("a referenced duplicate in :root is ONE finding naming both sites, both values, and that the later wins", () => {
    // Line 1 is empty; the two declarations are lines 3 and 4.
    const css = `
:root {
  --accent: #FF0000;
  --accent: #00AA00;
}
.btn { color: var(--accent); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.rule).toBe("duplicate-declaration");
    // Duplicate-ness is a fact about the SOURCE block, not a theme's view.
    expect(finding.theme).toBe(null);
    expect(finding.tokens).toEqual(["--accent"]);
    expect(finding.message).toBe(
      "--accent is declared twice in one scope: #FF0000 at :root:3, shadowed by #00AA00 at :root:4 — the later declaration silently wins.",
    );
    expect(finding.evidence["declaredIn"]).toEqual([":root:3", ":root:4"]);
    expect(finding.evidence["values"]).toEqual(["#FF0000", "#00AA00"]);
    expect(finding.evidence["declarationCount"]).toBe(2);
    expect(finding.evidence["shadowedValue"]).toBe("#FF0000");
    expect(finding.evidence["winnerValue"]).toBe("#00AA00");
    // No `sites`, like dead-token: the positions are named in the message,
    // with a selector the merged theme tables cannot supply.
    expect(finding.sites).toBeUndefined();

    // And the audit carries it, exit-code active, as its own section count.
    const report = audit(resolveCss(css));
    expect(report.countsByRule["duplicate-declaration"]).toBe(1);
  });

  it("an UNREFERENCED duplicate fires on BOTH rules — duplicate and dead-token name different facts", () => {
    const css = `
:root {
  --orphan: #FF0000;
  --orphan: #00AA00;
}
`;
    const resolved = resolveCss(css);
    expect(duplicateDeclarationRule(resolved)).toHaveLength(1);
    expect(audit(resolved).countsByRule["dead-token"]).toBe(1);
    expect(audit(resolved).countsByRule["duplicate-declaration"]).toBe(1);
    // Orthogonality pinned: dead-token already listed both SITES; only this
    // rule names the VALUES and the silent win. Neither subsumes the other.
  });

  it("a duplicate in a theme scope fires — [data-theme] blocks are judged scopes", () => {
    const css = `
[data-theme="dark"] {
  --accent: #FF0000;
  --accent: #00AA00;
}
.btn { color: var(--accent); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe(null);
    expect(findings[0]!.message).toBe(
      '--accent is declared twice in one scope: #FF0000 at [data-theme="dark"]:3, shadowed by #00AA00 at [data-theme="dark"]:4 — the later declaration silently wins.',
    );
  });

  it("a duplicate in a component class (an `other` scope) fires", () => {
    const css = `
.btn {
  --btn-accent: #FF0000;
  --btn-accent: #00AA00;
  color: var(--btn-accent);
}
`;
    expect(duplicateDeclarationRule(resolveCss(css))).toHaveLength(1);
  });

  it("a duplicate inside a prefers-color-scheme block fires — that block is its own scope", () => {
    const css = `
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #FF0000;
    --accent: #00AA00;
  }
}
.btn { color: var(--accent); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("shadowed by #00AA00 at :root:5");
  });

  it("NEGATIVE — a cross-scope override is the theme system working and never fires", () => {
    const css = `
:root {
  --accent: #FF0000;
}
[data-theme="dark"] {
  --accent: #00AA00;
}
.btn { color: var(--accent); }
`;
    // Referenced on both sides, so dead-token and unresolved-reference are
    // silent too: the audit is CLEAN. Override is what themes are FOR.
    expect(audit(resolveCss(css)).findings).toHaveLength(0);
  });

  it("NEGATIVE — a same-value repeat is harmless copy-paste and never fires", () => {
    const css = `
:root {
  --accent: #FF0000;
  --accent: #FF0000;
}
.btn { color: var(--accent); }
`;
    expect(audit(resolveCss(css)).findings).toHaveLength(0);
  });

  it("NEGATIVE — a same-value repeat that is also unreferenced gets dead-token only", () => {
    const css = `
:root {
  --orphan: #FF0000;
  --orphan: #FF0000;
}
`;
    const report = audit(resolveCss(css));
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.countsByRule["dead-token"]).toBe(1);
  });

  it("a selector-list block yields ONE finding, not one per scope half — and names the full prelude", () => {
    // One source block, two Scopes (`:root` and `[data-theme="dark"]`) over
    // the same declarations: the emission is deduped to one finding, and the
    // block is named by its FULL prelude — the halves cannot say where the
    // declarations live.
    const css = `
:root, [data-theme="dark"] {
  --q: #111111;
  --q: #222222;
}
.btn { color: var(--q); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      '--q is declared twice in one scope: #111111 at :root, [data-theme="dark"]:3, shadowed by #222222 at :root, [data-theme="dark"]:4 — the later declaration silently wins.',
    );
  });

  it("three declarations is ONE finding, and the shadowed site named is the last value that differs from the winner", () => {
    const css = `
:root {
  --accent: #FF0000;
  --accent: #00AA00;
  --accent: #0000FF;
}
.btn { color: var(--accent); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    // The winner is line 5; the latest value that differs from it is #00AA00
    // on line 4. Every site is in the evidence, value-paired.
    expect(findings[0]!.message).toBe(
      "--accent is declared 3 times in one scope: #00AA00 at :root:4, shadowed by #0000FF at :root:5 — the later declaration silently wins.",
    );
    expect(findings[0]!.evidence["declaredIn"]).toEqual([":root:3", ":root:4", ":root:5"]);
    expect(findings[0]!.evidence["values"]).toEqual(["#FF0000", "#00AA00", "#0000FF"]);
    expect(findings[0]!.evidence["declarationCount"]).toBe(3);
  });

  it("first and last values coinciding keeps the message truthful: the middle differing value is the shadowed site", () => {
    const css = `
:root {
  --accent: #FF0000;
  --accent: #00AA00;
  --accent: #FF0000;
}
.btn { color: var(--accent); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      "--accent is declared 3 times in one scope: #00AA00 at :root:4, shadowed by #FF0000 at :root:5 — the later declaration silently wins.",
    );
  });

  it("an alias-shape name declared twice in a judged scope IS a finding — the isAlias skip is dead-token's, not this rule's", () => {
    // dead-token skips alias NAMES because their consumption is invisible to
    // a source read; duplicate-ness is judgeable from the source itself.
    // The declarations live in :root — a judged scope — so the rule fires.
    const css = `
:root {
  --color-accent: #FF0000;
  --color-accent: #00AA00;
}
@theme inline {
  --color-accent: var(--accent);
}
`;
    expect(duplicateDeclarationRule(resolveCss(css))).toHaveLength(1);
  });

  it("NEGATIVE — a duplicate inside @theme inline does not fire: that scope kind is the reference layer", () => {
    const css = `
@theme inline {
  --color-accent: var(--accent);
  --color-accent: var(--accent-hover);
}
:root {
  --accent: #FF0000;
  --accent-hover: #00AA00;
}
`;
    expect(duplicateDeclarationRule(resolveCss(css))).toHaveLength(0);
  });

  it("findings read in name order when several names are duplicated", () => {
    const css = `
:root {
  --z: #FF0000;
  --z: #00AA00;
  --a: #FF0000;
  --a: #00AA00;
}
.btn { color: var(--a); background: var(--z); }
`;
    const findings = duplicateDeclarationRule(resolveCss(css));
    expect(findings.map((f) => f.tokens[0])).toEqual(["--a", "--z"]);
  });
});

describe("suppression — the seventh rule id through both doors", () => {
  it("a config entry naming the rule and the token moves the finding to the suppressed leg", () => {
    const css = `
:root {
  --accent: #FF0000;
  --accent: #00AA00;
}
.btn { color: var(--accent); }
`;
    const report = audit(resolveCss(css), {
      suppressions: [
        { rule: "duplicate-declaration", token: "--accent", reason: "vendored override kept deliberately" },
      ],
    });
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.tokens).toEqual(["--accent"]);
    expect(report.suppressed[0]?.reason).toBe("vendored override kept deliberately");
  });

  it("a directive standalone on the line above the first declaration suppresses — the line+1 conjunct", () => {
    const css = [
      ":root {",
      "  /* themeguard-ignore duplicate-declaration -- deliberate: vendored patch re-declares it */",
      "  --accent: #FF0000;",
      "  --accent: #00AA00;",
      "}",
    ].join("\n");
    const directives = scanIgnoreDirectives(css, "above.css");
    const report = audit(resolveCss(css), { suppressions: directives });
    expect(directives).toHaveLength(1);
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive trailing the winning declaration's own line suppresses too", () => {
    const css = [
      ":root {",
      "  --accent: #FF0000;",
      "  --accent: #00AA00; /* themeguard-ignore duplicate-declaration -- the win is judged here */",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), {
      suppressions: scanIgnoreDirectives(css, "trailing.css"),
    });
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
  });

  it("a directive somewhere else does NOT suppress — the miss self-announces", () => {
    const css = [
      ":root {",
      "  --accent: #FF0000;",
      "  --accent: #00AA00;",
      "}",
      ".else { color: red; /* themeguard-ignore duplicate-declaration -- wrong site */ }",
    ].join("\n");
    const report = audit(resolveCss(css), {
      suppressions: scanIgnoreDirectives(css, "miss.css"),
    });
    expect(report.countsByRule["duplicate-declaration"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
  });
});

describe("runCli — the exit code moves with the seventh rule, both ways", () => {
  it("a duplicate is exit 1, its own section, and its count on the summary line", () => {
    const path = cssFixture(
      "duplicate.css",
      ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n.btn { color: var(--accent); }\n",
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("duplicate-declaration (1)");
    expect(result.stdout).toContain(
      "  [duplicate-declaration] --accent is declared twice in one scope: #FF0000 at :root:2, shadowed by #00AA00 at :root:3 — the later declaration silently wins.",
    );
    expect(result.stdout).toContain(
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference, 0 cycle-reference, 1 duplicate-declaration, 0 unresolved-import.",
    );
  });

  it("suppressing it — directive or config — returns the exit to 0, counted in the suppressed section", () => {
    const directed = cssFixture(
      "duplicate-suppressed.css",
      [
        ":root {",
        "  /* themeguard-ignore duplicate-declaration -- the later value is the shipped one, judged */",
        "  --accent: #FF0000;",
        "  --accent: #00AA00;",
        "}",
        ".btn { color: var(--accent); }",
        "",
      ].join("\n"),
    );
    const result = run(directed);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("duplicate-declaration (0)");
    expect(result.stdout).toContain("suppressed (1)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] [duplicate-declaration]"));
    expect(line).toContain('"the later value is the shipped one, judged"');
    expect(line).toContain("duplicate-suppressed.css:2]");
    expect(result.stdout).toContain("No findings.");

    const dir = join(tmp, "config-door");
    mkdirSync(dir, { recursive: true });
    const cfgPath = cssFixture(
      "config-door/duplicate.css",
      ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n.btn { color: var(--accent); }\n",
    );
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [
          { rule: "duplicate-declaration", token: "--accent", reason: "vendored override kept deliberately" },
        ],
      }),
      "utf8",
    );
    const configured = run(cfgPath);
    expect(configured.code).toBe(EXIT_OK);
    expect(configured.stdout).toContain("suppressed (1)");
  });
});

describe("the config door — the seventh id is a valid suppression rule id", () => {
  it("parseConfig accepts a duplicate-declaration entry, and the unknown-rule error names the full seven", () => {
    const entries = parseConfig(
      JSON.stringify({
        suppress: [{ rule: "duplicate-declaration", token: "--accent", reason: "judged deliberate" }],
      }),
      "mem/config.json",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rule).toBe("duplicate-declaration");

    let error: unknown;
    try {
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "no-such-rule", token: "--a", reason: "r" }] }),
        "mem/config.json",
      );
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain(
      "collision, dead-token, scale-collapse, family-consistency, unresolved-reference, cycle-reference, duplicate-declaration",
    );
  });
});

describe("the import closure — a duplicate inside an imported file is cited BY FILE", () => {
  /**
   * Since 0.1.10 the audit's unit is the entry file's `@import` closure, and
   * line numbers restart at 1 in every sheet spliced in. A duplicate living
   * inside an imported file is still a duplicate — the two declarations share
   * ONE scope, in one source block — but `:root:2` would point the reader at
   * line 2 of whichever file they had open. The site is therefore cited by
   * the file the line belongs to.
   */
  it("names the imported file rather than a bare selector:line", () => {
    const dir = mkdtempSync(join(tmpdir(), "themeguard-duplicate-import-"));
    writeFileSync(
      join(dir, "tokens.css"),
      ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n",
      "utf8",
    );
    const entry = join(dir, "app.css");
    writeFileSync(entry, '@import "./tokens.css";\n.btn { color: var(--accent); }\n', "utf8");

    const findings = duplicateDeclarationRule(resolveStylesheet(loadStylesheet(entry)));
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.message).toContain("#FF0000 at tokens.css:2");
    expect(finding?.message).toContain("#00AA00 at tokens.css:3");
    expect(finding?.message).not.toContain(":root:2");
    expect(finding?.evidence?.["declaredIn"]).toEqual(["tokens.css:2", "tokens.css:3"]);

    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The negative that keeps the rule's scope discipline honest across the
   * import edge: an imported `:root` and the entry file's own `:root` are two
   * scopes, so a name each declares differently is a cascade override — the
   * composition working — and never a duplicate, even though the two
   * declarations now sit in one audited document.
   */
  it("does not fire across the import edge — two files' :root blocks are two scopes", () => {
    const dir = mkdtempSync(join(tmpdir(), "themeguard-duplicate-cross-file-"));
    writeFileSync(join(dir, "tokens.css"), ":root { --accent: #FF0000; }\n", "utf8");
    const entry = join(dir, "app.css");
    writeFileSync(
      entry,
      '@import "./tokens.css";\n:root { --accent: #00AA00; }\n.btn { color: var(--accent); }\n',
      "utf8",
    );

    expect(duplicateDeclarationRule(resolveStylesheet(loadStylesheet(entry)))).toEqual([]);

    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The suppression doors, read across the import edge — the question the
   * `origin` fence in `audit.ts`'s `findingLines` exists to answer, pinned
   * here because this rule reaches that fence by a path no other rule takes.
   *
   * `duplicate-declaration` carries no `sites` (dead-token's stance: the rule
   * names its positions in its own message), so site-scoped directive
   * matching falls through to the `evidence.declaredIn` branch — and that
   * fallback predates 0.1.10's closure work. The fence it gained is the one
   * these two tests pin: a citation naming a known imported origin is SKIPPED
   * when collecting a finding's lines, because directives are scanned from
   * the entry file's text ONLY and line numbers restart at 1 in every spliced
   * sheet. Without it, an entry-file directive on line 2 would silence a
   * finding whose site is line 2 OF ANOTHER FILE — a coincidence of numbers
   * reading as a judgement.
   *
   * The entry-file-only scan is the platform's, not this rule's: a directive
   * written INSIDE an imported file is not seen for any rule (verified
   * against `dead-token` too), so the token-scoped CONFIG entry is the door
   * that governs an imported site — and it binds, because it matches on the
   * finding's structured fields rather than on a line.
   */
  it("an ENTRY-file directive does NOT silence a duplicate living in an IMPORTED file", () => {
    const dir = mkdtempSync(join(tmpdir(), "themeguard-duplicate-suppress-import-"));
    writeFileSync(
      join(dir, "tokens.css"),
      ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n",
      "utf8",
    );
    const entryCss = [
      '@import "./tokens.css";',
      "/* themeguard-ignore duplicate-declaration -- entry-file judgement, line 2 */",
      ".btn { color: var(--accent); }",
    ].join("\n");
    const entry = join(dir, "app.css");
    writeFileSync(entry, `${entryCss}\n`, "utf8");

    // The directive sits at entry line 2; the shadowed site is tokens.css:2.
    // The bare numbers coincide — the origin fence is what keeps them apart.
    const directives = scanIgnoreDirectives(entryCss, entry);
    expect(directives).toHaveLength(1);
    expect(directives[0]?.line).toBe(2);

    const report = audit(resolveStylesheet(loadStylesheet(entry)), {
      suppressions: directives,
    });
    expect(report.countsByRule["duplicate-declaration"]).toBe(1);
    expect(report.suppressed).toHaveLength(0);
    // And the judgement that bound to nothing says so rather than going quiet.
    expect(report.unmatchedSuppressions).toHaveLength(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("a token-scoped CONFIG entry DOES suppress an imported duplicate — the door that crosses files", () => {
    const dir = mkdtempSync(join(tmpdir(), "themeguard-duplicate-config-import-"));
    writeFileSync(
      join(dir, "tokens.css"),
      ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n",
      "utf8",
    );
    const entry = join(dir, "app.css");
    writeFileSync(entry, '@import "./tokens.css";\n.btn { color: var(--accent); }\n', "utf8");

    const report = audit(resolveStylesheet(loadStylesheet(entry)), {
      suppressions: [
        {
          rule: "duplicate-declaration",
          token: "--accent",
          reason: "vendored token file re-declares it deliberately",
        },
      ],
    });
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.message).toContain("tokens.css:2");
    expect(report.unmatchedSuppressions).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("census preservation over the calibration fixture — the 0, derived", () => {
  it("no name is declared twice within one scope; the rule adds 0 findings", () => {
    const resolved = resolveCss(fixtureCss());

    // The member-by-member derivation of the pinned 0: this walk IS the
    // finding population, and it is empty over the fixture's scopes.
    let duplicatePairs = 0;
    let declarations = 0;
    for (const scope of resolved.stylesheet.scopes) {
      if (scope.kind === "theme-inline") continue;
      const byName = new Map<string, string[]>();
      for (const d of scope.declarations) {
        declarations++;
        const values = byName.get(d.name) ?? [];
        values.push(d.value);
        byName.set(d.name, values);
      }
      for (const values of byName.values()) {
        if (values.length >= 2 && new Set(values).size >= 2) duplicatePairs++;
      }
    }
    expect(declarations).toBeGreaterThan(0);
    expect(duplicatePairs).toBe(0);

    expect(duplicateDeclarationRule(resolved)).toEqual([]);
    expect(audit(resolved).countsByRule["duplicate-declaration"]).toBe(0);

    // And the fixture's census is untouched: the new heading prints at zero
    // and the ~22-finding pins keep their numbers (pinned in cli.test.ts,
    // config.test.ts and package.test.ts; re-pinned ADDITIVELY there).
    expect(audit(resolved).findings).toHaveLength(22);
  });
});
