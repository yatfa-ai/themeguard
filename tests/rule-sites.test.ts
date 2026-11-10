import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { loadStylesheet } from "../src/load.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { fixtureWriter, scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * `sites` on the three rules that used to carry none: dead-token,
 * unresolved-reference and duplicate-declaration.
 *
 * Each now publishes one `{name, line, origin?}` per position it already
 * cites, in the same order as `evidence.declaredIn` / `evidence.usedIn`, with
 * `origin` present only for a position that arrived over an `@import` edge.
 * The selector stays ONLY in the evidence strings. These tests read the real
 * `--json` channel, so the contract pinned is the one a pipeline caller sees,
 * and each rule is shown with BOTH an imported position (origin set) and an
 * entry-file one (origin key absent, not undefined-valued).
 */

const tmp = scratchDir("rule-sites");
const write = fixtureWriter(tmp);

interface JsonFinding {
  rule: string;
  tokens: string[];
  message: string;
  sites: { name: string; line: number; origin?: string }[];
  evidence: Record<string, unknown>;
}

/** The `--json` findings of one rule for the named entry file. */
function jsonFindings(entry: string, rule: string): JsonFinding[] {
  const result = run("--json", entry);
  expect(result.out).toHaveLength(1);
  const report = JSON.parse(result.out[0] as string) as { findings: JsonFinding[] };
  return report.findings.filter((f) => f.rule === rule);
}

describe("dead-token publishes one site per declaration", () => {
  const entry = write(
    "dead/app.css",
    [
      '@import "./tokens.css";', //                  1
      ":root {", //                                  2
      "  --dead-own: #111111;", //                   3  entry-file declaration
      "  --dead-both: #333333;", //                  4  declared in both files
      "}",
      ".x { color: red; }",
    ].join("\n"),
  );
  write(
    "dead/tokens.css",
    [":root {", "  --dead-imported: #222222;", "  --dead-both: #444444;", "}"].join("\n"),
  );

  it("an @import-ed declaration carries its origin; an entry-file one carries no origin key", () => {
    const findings = jsonFindings(entry, "dead-token");
    const byToken = (name: string) => findings.find((f) => f.tokens[0] === name)!;

    const imported = byToken("--dead-imported");
    expect(imported.evidence["declaredIn"]).toEqual(["tokens.css:2"]);
    expect(imported.sites).toEqual([{ name: "--dead-imported", line: 2, origin: "tokens.css" }]);

    const own = byToken("--dead-own");
    expect(own.evidence["declaredIn"]).toEqual([":root:3"]);
    expect(own.sites).toEqual([{ name: "--dead-own", line: 3 }]);
    // Absent, never `undefined`/`null`: the key is not on the serialized site.
    expect("origin" in (own.sites[0] as object)).toBe(false);
    // The selector lives only in the evidence string.
    expect("selector" in (own.sites[0] as object)).toBe(false);
  });

  it("a name declared in both files lists both sites in declaredIn order", () => {
    const both = jsonFindings(entry, "dead-token").find((f) => f.tokens[0] === "--dead-both")!;
    expect(both.evidence["declaredIn"]).toEqual(["tokens.css:3", ":root:4"]);
    expect(both.sites).toEqual([
      { name: "--dead-both", line: 3, origin: "tokens.css" },
      { name: "--dead-both", line: 4 },
    ]);
  });

  it("leaves the message untouched — the prose still names selector:line", () => {
    const own = jsonFindings(entry, "dead-token").find((f) => f.tokens[0] === "--dead-own")!;
    expect(own.message).toBe(
      "--dead-own is declared at :root:3 and no var() in this stylesheet references it.",
    );
  });

  it("a site-scoped directive still matches the same finding", () => {
    const css = [
      ":root {",
      "  --unused: #101010; /* themeguard-ignore dead-token -- reserved for print */",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "d.css") });
    expect(report.countsByRule["dead-token"]).toBe(0);
    expect(report.suppressed.map((s) => s.finding.tokens)).toEqual([["--unused"]]);
    expect(report.suppressed[0]?.finding.sites).toEqual([{ name: "--unused", line: 2 }]);
  });
});

describe("unresolved-reference publishes one site per use", () => {
  const entry = write(
    "unresolved/app.css",
    [
      '@import "./tokens.css";', //                              1
      ".a { color: var(--ghost-own); }", //                       2  entry-file use
      ".b { color: var(--ghost-both); }", //                      3  entry-file use
    ].join("\n"),
  );
  write(
    "unresolved/tokens.css",
    [
      ".c { color: var(--ghost-imported); }", //                  1  imported use
      ".d { color: var(--ghost-both); }", //                      2  imported use
    ].join("\n"),
  );

  it("an @import-ed use carries its origin; an entry-file use carries no origin key", () => {
    const findings = jsonFindings(entry, "unresolved-reference");
    const imported = findings.find((f) => f.tokens[0] === "--ghost-imported")!;
    expect(imported.evidence["usedIn"]).toEqual(["tokens.css:1"]);
    expect(imported.sites).toEqual([{ name: "--ghost-imported", line: 1, origin: "tokens.css" }]);

    const own = findings.find((f) => f.tokens[0] === "--ghost-own")!;
    expect(own.evidence["usedIn"]).toEqual([".a:2"]);
    expect(own.sites).toEqual([{ name: "--ghost-own", line: 2 }]);
    expect("origin" in (own.sites[0] as object)).toBe(false);
  });

  it("a name used in both files lists every use site in usedIn order", () => {
    const both = jsonFindings(entry, "unresolved-reference").find(
      (f) => f.tokens[0] === "--ghost-both",
    )!;
    expect(both.evidence["usedIn"]).toEqual(["tokens.css:2", ".b:3"]);
    expect(both.sites).toEqual([
      { name: "--ghost-both", line: 2, origin: "tokens.css" },
      { name: "--ghost-both", line: 3 },
    ]);
  });

  it("a site-scoped directive still matches the same finding", () => {
    const css = [
      ".a {",
      "  color: var(--ghost); /* themeguard-ignore unresolved-reference -- supplied by the host page */",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "u.css") });
    expect(report.countsByRule["unresolved-reference"]).toBe(0);
    expect(report.suppressed.map((s) => s.finding.tokens)).toEqual([["--ghost"]]);
    expect(report.suppressed[0]?.finding.sites).toEqual([{ name: "--ghost", line: 2 }]);
  });
});

describe("duplicate-declaration publishes one site per declaration", () => {
  const entry = write(
    "duplicate/app.css",
    [
      '@import "./tokens.css";', //  1
      ".btn { color: var(--own); background: var(--imported); }", // 2
      ":root {", //                  3
      "  --own: #FF0000;", //        4
      "  --own: #00AA00;", //        5
      "}",
    ].join("\n"),
  );
  write(
    "duplicate/tokens.css",
    [":root {", "  --imported: #FF0000;", "  --imported: #00AA00;", "}"].join("\n"),
  );

  it("an @import-ed duplicate carries its origin on shadowed AND winner", () => {
    const imported = jsonFindings(entry, "duplicate-declaration").find(
      (f) => f.tokens[0] === "--imported",
    )!;
    expect(imported.evidence["declaredIn"]).toEqual(["tokens.css:2", "tokens.css:3"]);
    expect(imported.sites).toEqual([
      { name: "--imported", line: 2, origin: "tokens.css" },
      { name: "--imported", line: 3, origin: "tokens.css" },
    ]);
  });

  it("an entry-file duplicate carries no origin key on either site", () => {
    const own = jsonFindings(entry, "duplicate-declaration").find((f) => f.tokens[0] === "--own")!;
    expect(own.evidence["declaredIn"]).toEqual([":root:4", ":root:5"]);
    expect(own.sites).toEqual([
      { name: "--own", line: 4 },
      { name: "--own", line: 5 },
    ]);
    for (const site of own.sites) expect("origin" in site).toBe(false);
  });

  it("a three-declaration duplicate publishes all three, in source order", () => {
    const css = [":root {", "  --a: #111;", "  --a: #222;", "  --a: #333;", "}", ".x { color: var(--a); }"].join("\n");
    const finding = audit(resolveCss(css)).findings.find((f) => f.rule === "duplicate-declaration")!;
    expect(finding.sites).toEqual([
      { name: "--a", line: 2 },
      { name: "--a", line: 3 },
      { name: "--a", line: 4 },
    ]);
  });

  it("a site-scoped directive still matches the same finding, and an imported site still ignores an entry-file directive", () => {
    const css = [
      ":root {",
      "  --accent: #FF0000;",
      "  --accent: #00AA00; /* themeguard-ignore duplicate-declaration -- the win is judged here */",
      "}",
    ].join("\n");
    const report = audit(resolveCss(css), { suppressions: scanIgnoreDirectives(css, "x.css") });
    expect(report.countsByRule["duplicate-declaration"]).toBe(0);
    expect(report.suppressed[0]?.finding.sites).toEqual([
      { name: "--accent", line: 2 },
      { name: "--accent", line: 3 },
    ]);

    // The origin fence: entry line 2 coincides with tokens.css line 2, and the
    // directive must still not reach across the edge.
    const dir = "duplicate-fence";
    write(`${dir}/tokens.css`, ":root {\n  --accent: #FF0000;\n  --accent: #00AA00;\n}\n");
    const entryCss = [
      '@import "./tokens.css";',
      "/* themeguard-ignore duplicate-declaration -- entry-file judgement */",
      ".btn { color: var(--accent); }",
    ].join("\n");
    const fenceEntry = write(`${dir}/app.css`, `${entryCss}\n`);
    const fenced = audit(resolveStylesheet(loadStylesheet(fenceEntry)), {
      suppressions: scanIgnoreDirectives(entryCss, fenceEntry),
    });
    expect(fenced.countsByRule["duplicate-declaration"]).toBe(1);
    expect(fenced.suppressed).toHaveLength(0);
  });
});
