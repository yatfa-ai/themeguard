import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { parseStylesheet } from "../src/parse.js";

/**
 * `themeguard-ignore` directives across an IMPORT CLOSURE (0.1.19).
 *
 * Before this slice a directive worked only while its file was the ENTRY:
 * the same comment, one `@import` edge away, was silently discarded — not
 * suppressed, not unmatched, not named — which falsified the property the
 * feature documents as its reason to exist (the judgement travels with the
 * file into vendored, regenerated or forked copies; since 0.1.10 the ordinary
 * way a vendored file is consumed is by being imported). The loader now scans
 * every member as it reads it, stamps each imported member's entries with its
 * entry-relative origin, and the audit matches a directive against its OWN
 * file's sites only.
 *
 * The fence that made site-scoped matching honest is a regression pin here,
 * byte for byte: an ENTRY-file directive still matches only entry-file sites,
 * so a coinciding line in an imported file reports its finding and the
 * entry-file judgement names itself `unmatched` — never a silence.
 *
 * Each scenario is pinned at the layer that owns it: `loadStylesheet` owns
 * the collection and the stamps, `runCli` owns the report and the exit.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-closure-directives-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, css: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, css, "utf8");
  return path;
}

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly stderr: string;
  readonly stdout: string;
}

function run(...args: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, out, stderr: err.join("\n"), stdout: out.join("\n") };
}

/** A composing sheet over an imported card whose two roles hold one colour. */
const CARD_WITH_DIRECTIVE = [
  ":root {",
  "  --card-bg: #3366cc;",
  "  --brand-primary: #3366cc; /* themeguard-ignore collision --card-bg --brand-primary -- deliberate: card chrome tracks brand */",
  "}",
].join("\n");

const CARD_WITHOUT_DIRECTIVE = [
  ":root {",
  "  --card-bg: #3366cc;",
  "  --brand-primary: #3366cc;",
  "}",
].join("\n");

const COMPOSER = ['@import "./card.css";', "", "a { color: var(--card-bg); }", "b { color: var(--brand-primary); }"].join(
  "\n",
);

describe("a directive inside an imported member governs its own file's finding", () => {
  it("suppresses the imported collision by the trailing directive IN the imported file — exit 0", () => {
    write("trailing/card.css", CARD_WITH_DIRECTIVE);
    const entry = write("trailing/app.css", COMPOSER);
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (1)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] "));
    expect(line).toContain('"deliberate: card chrome tracks brand"');
    expect(line).toContain("[card.css:3]");
  });

  it("honours the STANDALONE placement inside an imported file too", () => {
    write(
      "standalone/card.css",
      [
        ":root {",
        "  --card-bg: #3366cc;",
        "  /* themeguard-ignore collision --card-bg --brand-primary -- deliberate: card chrome tracks brand */",
        "  --brand-primary: #3366cc;",
        "}",
      ].join("\n"),
    );
    const entry = write("standalone/app.css", COMPOSER);
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.out.find((l) => l.startsWith("  [suppressed] "))).toContain("[card.css:3]");
  });

  it("carries a directive two hops in, stamped by ITS OWN frame's origin — never an outer edge's", () => {
    write(
      "hops/shared/leaf.css",
      [
        ":root {",
        "  --leaf-a: #3366cc;",
        "  --leaf-b: #3366cc; /* themeguard-ignore collision --leaf-a --leaf-b -- leaf's own judgement */",
        "}",
      ].join("\n"),
    );
    write("hops/shared/mid.css", '@import "./leaf.css";');
    const entry = write(
      "hops/app.css",
      ['@import "./shared/mid.css";', "", "a { color: var(--leaf-a); }", "b { color: var(--leaf-b); }"].join("\n"),
    );
    // The library half: the stamp names the file the comment was WRITTEN in,
    // entry-relative, however deep — not the edge that happened to load it.
    const sheet = loadStylesheet(entry);
    expect(sheet.directives).toHaveLength(1);
    expect(sheet.directives?.[0]).toMatchObject({
      rule: "collision",
      line: 3,
      origin: "shared/leaf.css",
      source: "shared/leaf.css:3",
    });
    // The run half: that one stamp is what the judgement binds by.
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.out.find((l) => l.startsWith("  [suppressed] "))).toContain("[shared/leaf.css:3]");
  });

  it("carries the entry file's own directives unstamped, and the text-only path sets no directives at all", () => {
    write(
      "shapes/entry.css",
      [
        "/* themeguard-ignore dead-token -- reserved */",
        '@import "./dep.css";',
        "",
        ":root { --homegrown: #00FF00; }",
        ".btn { color: var(--kept); }",
      ].join("\n"),
    );
    write("shapes/dep.css", ":root { --kept: #101010; }");
    const sheet = loadStylesheet(join(tmp, "shapes/entry.css"));
    expect(sheet.directives).toHaveLength(1);
    expect(sheet.directives?.[0]).toMatchObject({ rule: "dead-token", line: 1 });
    expect(sheet.directives?.[0]).not.toHaveProperty("origin");
    // The text-only parse never sets the field — no file, no scan.
    expect(parseStylesheet("/* themeguard-ignore dead-token -- reserved */\n:root { --a: #111111; }")).not.toHaveProperty(
      "directives",
    );
  });
});

describe("the closure's never-silently-ignored contract", () => {
  it("a malformed directive in an IMPORTED file exits 2 naming ITS file and line", () => {
    write(
      "malformed/inner.css",
      [
        ":root {",
        "  --p: #3366cc; /* themeguard-ignore nonsense-rule --x --y -- bogus */",
        "  --q: #3366cc;",
        "}",
      ].join("\n"),
    );
    const entry = write(
      "malformed/root.css",
      ['@import "./inner.css";', "", "a { color: var(--p); }", "b { color: var(--q); }"].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("invalid /* themeguard-ignore */ directive at inner.css:2");
    expect(result.stderr).toContain('unknown rule "nonsense-rule"');
    // The audit never ran, so nothing pretends to be a report.
    expect(result.stdout).toBe("");
  });

  it("the byte-identical comment in the ENTRY file still names the entry — the two errors stay distinct", () => {
    const entry = write(
      "malformed/entry-bad.css",
      [":root {", "  --p: #3366cc; /* themeguard-ignore nonsense-rule --x --y -- bogus */", "}"].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain(`directive at ${entry}:2`);
  });
});

describe("the fence that must survive — an entry-file directive never crosses an import edge", () => {
  const INNER = [
    ":root {",
    "  --p: #3366cc;",
    "  --q: #3366cc;",
    "}",
  ].join("\n");

  it("a coinciding imported line reports its finding, and the entry judgement is unmatched — byte for byte", () => {
    write("fence/inner.css", INNER);
    const entry = write(
      "fence/root.css",
      [
        '@import "./inner.css";',
        "/* themeguard-ignore collision --p --q -- entry-file judgement aimed at an imported site */",
        "",
        "a { color: var(--p); }",
        "b { color: var(--q); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("Declared at inner.css:2 and inner.css:3.");
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");
    // The SUPPRESSION half of this pin is the fence and is unchanged: the
    // finding prints, the directive suppresses nothing, the exit moves. What
    // the line now ALSO says is where the judgement would work — the
    // cross-file diagnosis, additive to a byte-identical prefix. The retirement
    // advice above it was flatly wrong about exactly this shape: the defect is
    // not fixed (it prints, one line up in this same assertion) and the entry
    // did aim at a finding that exists, one `@import` edge away. Diagnosis
    // only: nothing here is suppressed, and the next assertion holds the fence.
    expect(result.out.find((l) => l.startsWith("  [unmatched] "))).toBe(
      '  [unmatched] [collision] — "entry-file judgement aimed at an imported site" [tokens: --p, --q] [' +
        entry +
        ":2] — matches a live [collision] finding at inner.css:2; a directive governs only the file it is" +
        " written in — move it there, or record it in themeguard.config.json to cover the whole closure.",
    );
    // And the section states the third case beside its two readings, so a
    // reader scanning the prose is not left with a dichotomy both of whose
    // clauses the row below contradicts.
    expect(result.stdout).toContain(
      "an entry naming a live finding in another file is a third case this report CAN tell",
    );
  });

  it("an entry directive aimed at an imported finding from FAR away is unmatched, truthfully", () => {
    write("fence/inner2.css", INNER);
    const entry = write(
      "fence/root2.css",
      [
        '@import "./inner2.css";',
        "",
        "",
        "/* themeguard-ignore collision --p --q -- aimed at the import, nowhere near it */",
        "a { color: var(--p); }",
        "b { color: var(--q); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");
  });

  it("an entry-file directive still governs an ENTRY-file finding inside a closure run", () => {
    write("fence/inner3.css", ":root { --kept: #101010; }");
    const entry = write(
      "fence/root3.css",
      [
        '@import "./inner3.css";',
        "/* themeguard-ignore dead-token -- reserved for the generated print stylesheet */",
        ":root { --homegrown: #00FF00; }",
        ".btn { color: var(--kept); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("dead-token (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("unmatched (0)");
  });
});

describe("what did not change — the config and the visited set", () => {
  it("a config entry beside the entry still governs an imported finding, exit 0", () => {
    write("config/inner.css", INNER_LIKE);
    const entry = write(
      "config/root.css",
      ['@import "./inner.css";', "", "a { color: var(--p); }", "b { color: var(--q); }"].join("\n").replace(
        "inner.css",
        "inner.css",
      ),
    );
    write(
      "config/themeguard.config.json",
      JSON.stringify({
        suppress: [{ rule: "collision", tokens: ["--p", "--q"], reason: "config-side deliberate" }],
      }),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    const line = result.out.find((l) => l.startsWith("  [suppressed] "));
    expect(line).toContain('"config-side deliberate"');
    // A config entry carries no site clause — the closure-wide mechanism.
    expect(line).not.toMatch(/\.css:\d+\]/);
  });

  it("the visited set splices a shared member once — its directive is carried once, never double-counted", () => {
    write(
      "diamond/common.css",
      [
        ":root {",
        "  --c-a: #3366cc;",
        "  --c-b: #3366cc; /* themeguard-ignore collision --c-a --c-b -- shared judgement */",
        "}",
      ].join("\n"),
    );
    write("diamond/left.css", '@import "./common.css";');
    write("diamond/right.css", '@import "./common.css";');
    const entry = write(
      "diamond/app.css",
      ['@import "./left.css";', '@import "./right.css";', "", "a { color: var(--c-a); }", "b { color: var(--c-b); }"].join(
        "\n",
      ),
    );
    const sheet = loadStylesheet(entry);
    expect(sheet.directives).toHaveLength(1);
    expect(sheet.directives?.[0]).toMatchObject({ origin: "common.css" });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("unmatched (0)");
  });

  it("a member the loader never loads contributes no directives — by construction, not by a new rule", () => {
    // The bare specifier is fenced, the relative-but-missing edge is recorded
    // as the eighth rule's finding, and the one member that DID load keeps
    // working directive coverage of its own finding.
    write(
      "gaps/card.css",
      [
        ":root {",
        "  --card-bg: #3366cc;",
        "  --brand-primary: #3366cc; /* themeguard-ignore collision --card-bg --brand-primary -- deliberate */",
        "}",
      ].join("\n"),
    );
    const entry = write(
      "gaps/app.css",
      [
        '@import "tailwindcss";',
        '@import "./card.css";',
        '@import "./missing.css";',
        "",
        "a { color: var(--card-bg); }",
        "b { color: var(--brand-primary); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unresolved-import (1)");
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.out.find((l) => l.startsWith("  [suppressed] "))).toContain("[card.css:3]");
  });
});

const INNER_LIKE = [":root {", "  --p: #3366cc;", "  --q: #3366cc;", "}"].join("\n");

describe("--json carries the closure's directives whole", () => {
  it("a suppressed entry from an imported member carries its origin and its source spelling", () => {
    write("json/card.css", CARD_WITH_DIRECTIVE);
    const entry = write("json/app.css", COMPOSER);
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(["--json", entry], { out: (l) => out.push(l), err: (l) => err.push(l) });
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out[0]!) as {
      suppressed: { entry: Record<string, unknown> }[];
    };
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]!.entry).toMatchObject({
      rule: "collision",
      line: 3,
      source: "card.css:3",
      origin: "card.css",
    });
    void err;
  });
});
