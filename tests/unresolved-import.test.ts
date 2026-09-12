import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { loadStylesheet } from "../src/load.js";
import { parseStylesheet } from "../src/parse.js";
import { readFileSync } from "node:fs";
import { resolveStylesheet } from "../src/resolve.js";

/**
 * Rule 8 — UNRESOLVED IMPORT.
 *
 * The rule is one projection — one finding per entry of
 * `Stylesheet.unresolvedImports`, the failed RELATIVE edges the loader
 * records — over bookkeeping that travelled with the sheet since the audit
 * unit became the closure; only the follow OUTCOME used to be discarded, so a
 * stylesheet whose own composition could not load audited green. These tests
 * pin the three live shapes (missing, unreadable, the one-character path
 * typo), the accumulation across frames (an edge broken two hops in is named
 * with its own from-file, cited by file), the negatives that are the real
 * test of the design (a working import, a cycle, a shared repeat, a bare
 * specifier with a real file behind it, an absolute path and a URL — all
 * silent), the root-cause pairing with `unresolved-reference`, suppression
 * through BOTH doors including the origin fence (an entry-file directive
 * cannot silence an edge whose statement lives in another file), the exit
 * code both ways, and the library shape (`theme: null`, the specifier in the
 * token dimension, `sites` carrying the statement's own position).
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-unresolved-import-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string, base: string = tmp): string {
  const path = join(base, name);
  writeFileSync(path, css, "utf8");
  return path;
}

const findingsOf = (path: string) => audit(resolveStylesheet(loadStylesheet(path))).findings;

function run(...args: string[]): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

describe("the loader records failed relative edges", () => {
  it("a missing target is recorded with the specifier as written and the classification", () => {
    const path = cssFixture("rec-missing.css", '@import "./nope.css";\n.x { color: red; }');
    expect(loadStylesheet(path).unresolvedImports).toEqual([
      { specifier: "./nope.css", line: 1, code: "missing" },
    ]);
  });

  it("an entry-file edge carries no `from`; an edge two hops in carries its own from-file", () => {
    writeFileSync(join(tmp, "rec-deep.css"), ":root { --deep: #101010; }\n");
    writeFileSync(
      join(tmp, "rec-mid.css"),
      '@import "./rec-gone.css";\n\n:root { --mid: #202020; }\n',
    );
    const path = cssFixture(
      "rec-root.css",
      '@import "./rec-mid.css";\n\n:root { --top: #303030; }\n',
    );
    expect(loadStylesheet(path).unresolvedImports).toEqual([
      { specifier: "./rec-gone.css", line: 1, from: "rec-mid.css", code: "missing" },
    ]);
  });

  it("an unreadable target (a directory at the path) is classified `unreadable`", () => {
    mkdirSync(join(tmp, "sealed.css"), { recursive: true });
    const path = cssFixture("rec-unreadable.css", '@import "./sealed.css";\n');
    expect(loadStylesheet(path).unresolvedImports).toEqual([
      { specifier: "./sealed.css", line: 1, code: "unreadable" },
    ]);
  });

  it("a working import records nothing; a cycle records nothing", () => {
    writeFileSync(join(tmp, "rec-tokens.css"), ":root { --accent: #FF0000; }\n");
    const ok = cssFixture(
      "rec-ok.css",
      '@import "./rec-tokens.css";\n\n.btn { color: var(--accent); }\n',
    );
    expect(loadStylesheet(ok).unresolvedImports).toEqual([]);

    writeFileSync(join(tmp, "cyc-a.css"), '@import "./cyc-b.css";\n\n:root { --a: #111111; }\n');
    writeFileSync(join(tmp, "cyc-b.css"), '@import "./cyc-a.css";\n\n:root { --b: #222222; }\n');
    expect(loadStylesheet(join(tmp, "cyc-a.css")).unresolvedImports).toEqual([]);
  });

  it("a repeated edge to one missing file is attempted once — the failure is a fact about the FILE", () => {
    const path = cssFixture(
      "rec-twice.css",
      '@import "./ghost.css";\n@import "./ghost.css";\n\n.x { color: red; }\n',
    );
    expect(loadStylesheet(path).unresolvedImports).toEqual([
      { specifier: "./ghost.css", line: 1, code: "missing" },
    ]);
  });

  it("bare, absolute and URL specifiers never reach the file system and are never recorded", () => {
    // `bare-real.css` EXISTS relative to the sheet: a loader that guessed at
    // bare specifiers would follow it, and one that recorded bare failures
    // would report it. The v1 fence skips it before any read, so the record
    // stays empty — byte-identical silence.
    writeFileSync(join(tmp, "bare-real.css"), ":root { --pkg: #00AA00; }\n");
    const path = cssFixture(
      "rec-bare.css",
      '@import "bare-real.css";\n@import "/absolute/nope.css";\n@import url("http://example.com/nope.css");\n\n.x { color: red; }\n',
    );
    expect(loadStylesheet(path).unresolvedImports).toEqual([]);
  });

  it("the text-only path never sets the field — parseStylesheet/resolveCss are untouched", () => {
    const sheet = parseStylesheet('@import "./nope.css";\n.x { color: red; }');
    expect(sheet.imports).toHaveLength(1);
    expect(sheet.unresolvedImports).toBeUndefined();
    expect("unresolvedImports" in sheet).toBe(false);
  });
});

describe("the unresolved-import rule", () => {
  it("one finding per failed edge: theme null, the specifier in the token dimension, sites at the statement", () => {
    const path = cssFixture("rule-one.css", '@import "./toens.css";\n\n:root { --a: #101010; }\n');
    const findings = findingsOf(path).filter((f) => f.rule === "unresolved-import");
    expect(findings).toEqual([
      {
        rule: "unresolved-import",
        theme: null,
        tokens: ["./toens.css"],
        message:
          '@import "./toens.css" — no file exists at the path it names. The import never loads, ' +
          "so every declaration inside it is invisible to this audit. Declared at line 1.",
        evidence: { specifier: "./toens.css", code: "missing", line: 1 },
        sites: [{ name: "./toens.css", line: 1 }],
      },
    ]);
  });

  it("the message names the outcome: missing vs unreadable", () => {
    mkdirSync(join(tmp, "dir-target.css"), { recursive: true });
    const path = cssFixture("rule-unreadable.css", '@import "./dir-target.css";\n');
    const [finding] = findingsOf(path).filter((f) => f.rule === "unresolved-import");
    expect(finding?.message).toBe(
      '@import "./dir-target.css" — the path it names exists but could not be read. The import never loads, ' +
        "so every declaration inside it is invisible to this audit. Declared at line 1.",
    );
    expect(finding?.evidence["code"]).toBe("unreadable");
  });

  it("a one-character path typo reports instead of shipping green (the U3 shape)", () => {
    // tokens.css exists; the sheet's own text typos the edge. Before rule 8
    // this printed `No findings.` at exit 0 — the whole defect.
    writeFileSync(join(tmp, "typo-tokens.css"), ":root { --accent: #FF0000; }\n");
    const path = cssFixture(
      "rule-typo.css",
      '@import "./typo-token.css";\n\n.btn { color: var(--accent); }\n',
    );
    const messages = findingsOf(path).map((f) => f.message);
    expect(messages).toContainEqual(
      '@import "./typo-token.css" — no file exists at the path it names. The import never loads, ' +
        "so every declaration inside it is invisible to this audit. Declared at line 1.",
    );
  });

  it("the root cause is named beside the honest unresolved-reference (the U2 shape)", () => {
    // --accent is declared only in the file the broken edge names. The
    // unresolved-reference is TRUE of the closure as loaded; the
    // unresolved-import names WHY — the file that declares it never loads —
    // so the reader is not sent hunting for a var() typo that does not exist.
    const path = cssFixture(
      "rule-u2.css",
      '@import "./u2-tokens.css";\n\n.btn { color: var(--accent); }\n',
    );
    const messages = findingsOf(path).map((f) => f.message);
    expect(messages).toEqual([
      "--accent is used at .btn:3 and no scope in this stylesheet declares it.",
      '@import "./u2-tokens.css" — no file exists at the path it names. The import never loads, so every declaration inside it is invisible to this audit. Declared at line 1.',
    ]);
  });

  it("an edge broken two hops in is cited by its own from-file, through sites and positionClause", () => {
    writeFileSync(join(tmp, "hop-deep.css"), ":root { --deep: #101010; }\n");
    writeFileSync(
      join(tmp, "hop-mid.css"),
      '@import "./hop-gone.css";\n\n:root { --mid: #202020; }\n',
    );
    const path = cssFixture(
      "hop-root.css",
      '@import "./hop-mid.css";\n\n:root { --top: #303030; }\n',
    );
    const [finding] = findingsOf(path).filter((f) => f.rule === "unresolved-import");
    // The statement lives in hop-mid.css at line 1 — cited by file, never a
    // bare number the reader could aim at the wrong file with. The `sites`
    // carry the same origin the other rules' sites do, so the audit's
    // directive fence (entry-file directives match entry-file sites only)
    // holds for free.
    expect(finding?.sites).toEqual([{ name: "./hop-gone.css", line: 1, origin: "hop-mid.css" }]);
    expect(finding?.message).toContain("Declared at hop-mid.css:1.");
  });

  it("a working import audits clean and a cycle stays correctly silent", () => {
    writeFileSync(join(tmp, "neg-tokens.css"), ":root { --accent: #FF0000; }\n");
    const ok = cssFixture(
      "neg-ok.css",
      '@import "./neg-tokens.css";\n\n.btn { color: var(--accent); }\n',
    );
    expect(findingsOf(ok)).toEqual([]);

    // Enter the cycle from a USING sheet, as a browser would render it: the
    // visited set dedupes, each file splices once, and — the rule-8 fact —
    // no cycle edge is ever a failed edge.
    writeFileSync(join(tmp, "ncyc-a.css"), '@import "./ncyc-b.css";\n\n:root { --a: #111111; }\n');
    writeFileSync(join(tmp, "ncyc-b.css"), '@import "./ncyc-a.css";\n\n:root { --b: #222222; }\n');
    const useA = cssFixture(
      "ncyc-use-a.css",
      '@import "./ncyc-a.css";\n\n.use { color: var(--a); background: var(--b); }\n',
    );
    const useB = cssFixture(
      "ncyc-use-b.css",
      '@import "./ncyc-b.css";\n\n.use { color: var(--b); background: var(--a); }\n',
    );
    expect(findingsOf(useA)).toEqual([]);
    expect(findingsOf(useB)).toEqual([]);
  });
});

describe("the rule participates in the report machinery", () => {
  it("counts into countsByRule, prints its own section, and moves the exit code", () => {
    const path = cssFixture("mach-exit.css", '@import "./gone.css";\n\n.x { color: red; }\n');
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unresolved-import (1)");
    expect(result.stdout).toContain(
      '  [unresolved-import] @import "./gone.css" — no file exists at the path it names. The import never loads, so every declaration inside it is invisible to this audit. Declared at line 1.',
    );
    expect(result.stdout).toContain(
      "1 finding: 0 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 1 unresolved-import.",
    );
  });

  it("a config entry suppresses by rule id or by the specifier token — and the exit returns to 0", () => {
    const dir = join(tmp, "sup-entry");
    mkdirSync(dir);
    const path = cssFixture(
      "sup.css",
      '@import "./gone.css";\n\n.x { color: red; }\n',
      dir,
    );
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [
          { rule: "unresolved-import", token: "./gone.css", reason: "generated file, restored at build" },
        ],
      }),
      "utf8",
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("generated file, restored at build");
    expect(result.stdout).toContain("No findings.");
  });

  it("an entry-file directive at the import's line suppresses; the same directive cannot silence an edge whose statement lives in another file", () => {
    // Entry-file edge, directive standalone on the line above: the two
    // industry placements — site-precise by construction.
    const entryPath = cssFixture(
      "dir-entry.css",
      '/* themeguard-ignore unresolved-import -- vendored sheet, target appears at build */\n@import "./gone.css";\n\n.x { color: red; }\n',
    );
    const entryReport = audit(resolveStylesheet(loadStylesheet(entryPath)), {
      suppressions: scanIgnoreDirectives(readFileSync(entryPath, "utf8"), entryPath),
    });
    expect(entryReport.findings).toEqual([]);
    expect(entryReport.unmatchedSuppressions).toHaveLength(0);

    // The edge broken two hops in: the directive sits in the ENTRY file, the
    // statement lives in hop-mid.css — line numbers restart per file, so a
    // bare-number match would let the entry file silence someone else's
    // statement. The sites carry the origin; the fence filters them out.
    // Every token in the closure is USED, so the only finding left is the
    // rule-8 one the entry-file directive cannot reach.
    writeFileSync(join(tmp, "fence-deep.css"), ":root { --deep: #101010; }\n");
    writeFileSync(
      join(tmp, "fence-mid.css"),
      '@import "./fence-gone.css";\n@import "./fence-deep.css";\n\n:root { --mid: #202020; }\n',
    );
    const fencePath = cssFixture(
      "fence-root.css",
      '/* themeguard-ignore unresolved-import -- not this file\'s edge */\n@import "./fence-mid.css";\n\n:root { --top: #303030; }\n.x { color: var(--mid); background: var(--top); border-color: var(--deep); }\n',
    );
    const fenceReport = audit(resolveStylesheet(loadStylesheet(fencePath)), {
      suppressions: scanIgnoreDirectives(readFileSync(fencePath, "utf8"), fencePath),
    });
    expect(fenceReport.findings).toHaveLength(1);
    expect(fenceReport.findings[0]?.rule).toBe("unresolved-import");
    expect(fenceReport.unmatchedSuppressions).toHaveLength(1);
  });

  it("fix the edge and a recorded judgement announces itself as unmatched", () => {
    const dir = join(tmp, "unmatched");
    mkdirSync(dir);
    // The config is recorded against a broken edge…
    const broken = cssFixture("un.css", '@import "./ghost.css";\n\n.x { color: red; }\n', dir);
    writeFileSync(
      join(dir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [{ rule: "unresolved-import", token: "./ghost.css", reason: "temporary" }],
      }),
      "utf8",
    );
    expect(run(broken).code).toBe(EXIT_OK);
    // …then the edge resolves: the entry matched nothing, and says so.
    writeFileSync(join(dir, "ghost.css"), ":root { --ghost: #404040; }\n.x { color: var(--ghost); }\n");
    const result = run(broken);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain("./ghost.css");
  });
});
