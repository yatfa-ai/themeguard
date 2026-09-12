import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { scanIgnoreDirectives } from "../src/directives.js";
import { loadStylesheet } from "../src/load.js";
import { parseStylesheet } from "../src/parse.js";
import { positionClause, type FindingSite } from "../src/rules/finding.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { FIXTURE_PATH, fixtureCss } from "./fixture.js";

/**
 * The import closure — 0.1.10.
 *
 * CSS's composition unit is the file's import closure; the audit's unit was
 * one FILE. On the standard layout (tokens in a base file, components in other
 * sheets, one composing file importing them) the one-file audit produced false
 * defects in BOTH directions: the composing file reported every imported token
 * as an unresolved reference, and the imported file reported its own tokens as
 * dead that the composing sheet's `var()`s reach over the import edge. These
 * tests pin the fix at every layer: the parser COLLECTS the statements, the
 * loader FOLLOWS the relative ones, the rules' lookups hit imported
 * declarations with no predicate change, and the calibration fixture's own
 * report — three bare package imports and one missing relative target, all
 * correctly skipped — keeps its numbers AND its bytes.
 */

/** One tmpdir for the file-based tests; the CLI block works in a subdir of it, */
/** because a config beside the stylesheet is discovered per-directory and     */
/** must not leak between the blocks.                                          */
let dir: string;
let cliDir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "themeguard-import-"));
  cliDir = join(dir, "cli");
  mkdirSync(cliDir, { recursive: true });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeSheet = (name: string, css: string, base: string = dir): string => {
  const path = join(base, name);
  writeFileSync(path, css, "utf8");
  return path;
};

const messagesOf = (path: string): string[] =>
  audit(resolveStylesheet(loadStylesheet(path))).findings.map((f) => f.message);

const run = (...args: string[]): { code: number; out: string[] } => {
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: () => {} };
  return { code: runCli(args, io), out };
};

describe("the parser collects @import statements", () => {
  it("collects the quoted form with its specifier and line", () => {
    const sheet = parseStylesheet('@import "./tokens.css";\n\n.btn { color: red; }');
    expect(sheet.imports).toEqual([{ specifier: "./tokens.css", line: 1 }]);
  });

  it("collects the url() form, quotes optional, media suffix dropped", () => {
    const sheet = parseStylesheet(
      '@import url("./tokens.css");\n@import url(./more.css) screen;\n.x { color: red; }',
    );
    expect(sheet.imports).toEqual([
      { specifier: "./tokens.css", line: 1 },
      { specifier: "./more.css", line: 2 },
    ]);
  });

  it("collects bare package specifiers too — collection is honest data, FOLLOWING is the loader's decision", () => {
    const sheet = parseStylesheet('@import "tailwindcss";\n.x { color: red; }');
    expect(sheet.imports).toEqual([{ specifier: "tailwindcss", line: 1 }]);
  });

  it("does not collect an @import written after the first qualified rule — dead text by CSS's own rules", () => {
    const sheet = parseStylesheet('.btn { color: red; }\n@import "./late.css";');
    expect(sheet.imports).toEqual([]);
  });

  it("does not collect an @import inside a block — never legal at any depth but the top", () => {
    const sheet = parseStylesheet('@media screen { @import "./nested.css"; }\n.x { color: red; }');
    expect(sheet.imports).toEqual([]);
  });

  it("collects the calibration fixture's four imports, exactly as written", () => {
    const sheet = parseStylesheet(fixtureCss());
    expect(sheet.imports).toEqual([
      { specifier: "tailwindcss", line: 1 },
      { specifier: "xterm/css/xterm.css", line: 3 },
      { specifier: "asciinema-player/dist/bundle/asciinema-player.css", line: 4 },
      { specifier: "./actiontext.css", line: 5 },
    ]);
  });

  it("parses a sheet with no @import to an empty import list and exactly today's scopes and references", () => {
    const css = ":root { --ink: #101010; }\nbody { color: var(--ink); }";
    const sheet = parseStylesheet(css);
    expect(sheet.imports).toEqual([]);
    expect(sheet.scopes).toHaveLength(1);
    expect(sheet.references).toHaveLength(1);
  });
});

describe("loadStylesheet follows the relative edges and skips the rest", () => {
  it("composes the closure: an imported token is declared, and a real use of it resolves", () => {
    writeSheet("tokens.css", ":root {\n  --accent: #FF0000;\n  --muted: #CCCCCC;\n}");
    const path = writeSheet(
      "composed.css",
      '@import "./tokens.css";\n\n.btn { color: var(--accent); }\n.card { border-color: var(--muted); }',
    );
    // The flagship RED case of 0.1.6–0.1.9: this audited as two false
    // unresolved-reference findings at exit 1, with coverage claiming
    // "0 base tokens". The closure is the audit unit now, so both names are
    // declared and nothing reports.
    expect(messagesOf(path)).toEqual([]);
  });

  it("follows the url() form identically", () => {
    writeSheet("url-tokens.css", ":root { --accent: #FF0000; }");
    const path = writeSheet(
      "composed-url.css",
      '@import url("./url-tokens.css");\n\n.btn { color: var(--accent); }',
    );
    expect(messagesOf(path)).toEqual([]);
  });

  it("follows a media-suffixed import, like the parser's unconditional @media treatment", () => {
    writeSheet("m-tokens.css", ":root { --accent: #FF0000; }");
    const path = writeSheet(
      "composed-media.css",
      '@import "./m-tokens.css" screen;\n\n.btn { color: var(--accent); }',
    );
    expect(messagesOf(path)).toEqual([]);
  });

  it("follows a transitive closure a → b → c, resolving c's tokens in a's audit", () => {
    writeSheet("c.css", ":root { --deep: #00AA00; }");
    writeSheet("b.css", '@import "./c.css";\n:root { --mid: #0000AA; }');
    const path = writeSheet(
      "a.css",
      '@import "./b.css";\n\n.use { color: var(--deep); background: var(--mid); }',
    );
    expect(messagesOf(path)).toEqual([]);
  });

  it("terminates an import cycle (a ⇄ b), splices each file once, and still resolves both sides", () => {
    writeSheet("cyc-a.css", '@import "./cyc-b.css";\n\n:root { --a-token: #111111; }');
    writeSheet("cyc-b.css", '@import "./cyc-a.css";\n\n:root { --b-token: #222222; }');
    // Enter the cycle from either side: the visited set stops the second hop,
    // and each entry's closure carries exactly one :root per file — a cycle
    // that looped forever, or spliced a file twice, would fail the length.
    const bPath = join(dir, "cyc-b.css");
    expect(loadStylesheet(bPath).scopes.filter((s) => s.selector === ":root")).toHaveLength(2);
    const aPath = join(dir, "cyc-a.css");
    expect(loadStylesheet(aPath).scopes.filter((s) => s.selector === ":root")).toHaveLength(2);
    // And with both tokens used, either entry audits clean.
    const useA = writeSheet("cyc-use-a.css", '@import "./cyc-a.css";\n.use { color: var(--a-token); background: var(--b-token); }');
    const useB = writeSheet("cyc-use-b.css", '@import "./cyc-b.css";\n.use { color: var(--b-token); background: var(--a-token); }');
    expect(messagesOf(useA)).toEqual([]);
    expect(messagesOf(useB)).toEqual([]);
  });

  it("skips a missing import target silently — an import-resolution failure is not a finding", () => {
    const path = writeSheet(
      "missing.css",
      '@import "./no-such-file.css";\n\n.btn { color: var(--accent); }',
    );
    // --accent now genuinely resolves to nothing: the one HONEST
    // unresolved-reference stays, and no finding names the missing file.
    expect(messagesOf(path)).toEqual([
      "--accent is used at .btn:3 and no scope in this stylesheet declares it.",
    ]);
  });

  it("skips a bare package specifier even when a file of that name exists relative to the sheet", () => {
    // The positive form of the skip: `bare-pkg/styles.css` EXISTS on disk, so
    // a loader that guessed at bare specifiers would follow it and declare
    // --pkg. The v1 fence skips it, so the use below is honestly unresolved.
    mkdirSync(join(dir, "bare-pkg"), { recursive: true });
    writeSheet("bare-pkg/styles.css", ":root { --pkg: #00AA00; }");
    const path = writeSheet(
      "bare.css",
      '@import "bare-pkg/styles.css";\n\n.x { color: var(--pkg); }',
    );
    expect(messagesOf(path)).toEqual([
      "--pkg is used at .x:3 and no scope in this stylesheet declares it.",
    ]);
  });
});

describe("the rules' lookups hit imported declarations with no predicate change", () => {
  it("a typo'd use in the composing file still fires — the fix removes false positives, not true ones", () => {
    writeSheet("typo-tokens.css", ":root { --accent: #FF0000; }");
    const path = writeSheet(
      "typo.css",
      '@import "./typo-tokens.css";\n\n.btn { color: var(--acccent); }',
    );
    expect(messagesOf(path)).toEqual([
      // Both findings are TRUE positives: the typo is unresolved, and the
      // correctly-spelled --accent it sits beside is now genuinely unused in
      // this closure — which is exactly the pair of facts the old one-file
      // audit could not hold at once.
      "--accent is declared at typo-tokens.css:1 and no var() in this stylesheet references it.",
      "--acccent is used at .btn:3 and no scope in this stylesheet declares it.",
    ]);
  });

  it("an imported token unused anywhere in the closure is dead, citing its own file: tokens2.css:3", () => {
    writeSheet("tokens2.css", ":root {\n  --accent: #FF0000;\n  --orphan: #00FF00;\n}");
    const path = writeSheet(
      "orphan.css",
      '@import "./tokens2.css";\n\n.btn { color: var(--accent); }',
    );
    expect(messagesOf(path)).toEqual([
      "--orphan is declared at tokens2.css:3 and no var() in this stylesheet references it.",
    ]);
  });

  it("a use written INSIDE an imported file cites the imported file, not a bare selector:line", () => {
    writeSheet(
      "broken-tokens.css",
      ":root { --chain: var(--never-declared); }\n.use-in-import { color: var(--also-missing); }",
    );
    const path = writeSheet("broken-root.css", '@import "./broken-tokens.css";');
    const messages = messagesOf(path);
    expect(messages).toContainEqual(
      "--also-missing is used at broken-tokens.css:2 and no scope in this stylesheet declares it.",
    );
    expect(messages).toContainEqual(
      "--never-declared is used at broken-tokens.css:1 and no scope in this stylesheet declares it.",
    );
  });

  it("the importing file's own :root re-declaration of an imported name wins, as the cascade says", () => {
    writeSheet("over-tokens.css", ":root { --accent: #FF0000; }");
    const path = writeSheet(
      "override.css",
      '@import "./over-tokens.css";\n\n:root { --accent: #00FF00; }\n\n.btn { color: var(--accent); }',
    );
    const resolved = resolveStylesheet(loadStylesheet(path));
    expect(audit(resolved).findings).toEqual([]);
    // The winner is the IMPORTER's value: imported scopes splice first, the
    // entry's own fold after, so a lookup reads #00FF00 — no
    // duplicate-declaration or collision regression.
    const accent = resolved.tokensFor("root").find((t) => t.name === "--accent");
    expect(accent?.resolvedValue?.toUpperCase()).toBe("#00FF00");
    expect(audit(resolved).coverage[0]?.baseTokens).toBe(1);
  });

  it("an origin-bearing site renders origin:line while root-file sites render selector:line unchanged", () => {
    writeSheet(
      "mixed.css",
      ":root { --kept: #101010; --orphan: #202020; }\n.bad { color: var(--nope); }",
    );
    const path = writeSheet(
      "mixed-root.css",
      '@import "./mixed.css";\n\n:root { --fine: #303030; }\n.here { color: var(--also-nope); border-color: var(--kept); background: var(--fine); }\n.dead-root { --unused-root: #404040; }',
    );
    const messages = messagesOf(path);
    // Imported sites cite the file the line belongs to…
    expect(messages).toContainEqual(
      "--orphan is declared at mixed.css:1 and no var() in this stylesheet references it.",
    );
    expect(messages).toContainEqual(
      "--nope is used at mixed.css:2 and no scope in this stylesheet declares it.",
    );
    // …and root-file sites keep the exact selector:line strings they always
    // rendered — byte-identical, which is what keeps every existing pin.
    expect(messages).toContainEqual(
      "--unused-root is declared at .dead-root:5 and no var() in this stylesheet references it.",
    );
    expect(messages).toContainEqual(
      "--also-nope is used at .here:4 and no scope in this stylesheet declares it.",
    );
    expect(messages).toHaveLength(4);
  });
});

describe("an origin names the file the item was WRITTEN in, at any depth", () => {
  // The stamp must survive the hops: `load`'s recursive frame returns the
  // child's ENTIRE closure, deeper items already carrying their own correct
  // entry-relative origins, and an unconditional spread at this frame would
  // overwrite every one of them with THIS edge's target — citing any item two
  // or more hops in with the wrong file. Nothing at one hop can see that (the
  // wrong name is still an imported file's name), so these pins are the only
  // guard the suite has, and each drives a different consumer of the origin:
  // dead-token's own scope walk, unresolved-reference's use sites, and the
  // resolver's `importOrigin` flowing into `siteFromToken`-shaped `sites`.
  it("a dead token declared two hops in cites the file it was written in, at that file's line", () => {
    writeSheet("deep-tokens.css", ":root {\n  --deep-dead: #00AA00;\n}");
    writeSheet("deep-mid.css", '@import "./deep-tokens.css";\n\n:root { --mid-own: #222222; }');
    const path = writeSheet("deep-app.css", '@import "./deep-mid.css";\n\n.btn { color: red; }');
    // `--deep-dead` is WRITTEN at line 2 of deep-tokens.css. deep-mid.css
    // also has a line 2 — its own `:root` — so under the wrong-stamp
    // regression this message cited `deep-mid.css:2`, a named file whose
    // named line points at someone else's declaration: a citation with false
    // authority, worse than a bare number.
    expect(messagesOf(path)).toEqual([
      "--deep-dead is declared at deep-tokens.css:2 and no var() in this stylesheet references it.",
      "--mid-own is declared at deep-mid.css:3 and no var() in this stylesheet references it.",
    ]);
  });

  it("a dangling var() written two hops in cites the file the USE was written in", () => {
    writeSheet(
      "hop2-deep.css",
      ":root { --hop-ok: #303030; --hop-dead: #404040; }\n\n.deep-use { color: var(--hop-missing); }",
    );
    writeSheet(
      "hop2-mid.css",
      '@import "./hop2-deep.css";\n\n:root { --hop-mid: #202020; }\n.mid-use { color: var(--hop-dead); }',
    );
    const path = writeSheet(
      "hop2-app.css",
      '@import "./hop2-mid.css";\n\n.btn { color: var(--hop-mid); background: var(--hop-ok); }',
    );
    // The `var(--hop-missing)` is written in hop2-deep.css at line 3.
    // hop2-mid.css also has a line 3, so the wrong stamp renders a
    // plausible-looking citation for the wrong file.
    expect(messagesOf(path)).toEqual([
      "--hop-missing is used at hop2-deep.css:3 and no scope in this stylesheet declares it.",
    ]);
  });

  it("a collision whose winner sits two hops in carries origin through siteFromToken into sites", () => {
    writeSheet("col2-part.css", ":root { --deep-fill: #3366AA; }");
    writeSheet(
      "col2-mid.css",
      '@import "./col2-part.css";\n\n:root { --mid-fill: #123456; }\n.use { color: var(--mid-fill); }',
    );
    const path = writeSheet(
      "col2-app.css",
      '@import "./col2-mid.css";\n\n:root { --root-fill: #3366AA; }\n.use { color: var(--deep-fill); background: var(--root-fill); }',
    );
    // The `ResolvedToken.importOrigin` leg itself: the root-theme winner of
    // `--deep-fill` was written in col2-part.css at line 1 — not spliced from
    // col2-mid.css, the file that merely imported it onward.
    const resolved = resolveStylesheet(loadStylesheet(path));
    const deep = resolved.token("--deep-fill", "root");
    expect(deep?.importOrigin).toBe("col2-part.css");
    expect(deep?.line).toBe(1);
    // And that leg is what `siteFromToken` reads: the structured `sites` —
    // the same data collision's message clause renders — cite each side by
    // its own file.
    const collision = audit(resolved).findings.find((f) => f.rule === "collision");
    expect(collision?.tokens).toEqual(["--deep-fill", "--root-fill"]);
    expect(collision?.sites).toEqual([
      { name: "--deep-fill", line: 1, origin: "col2-part.css" },
      { name: "--root-fill", line: 3 },
    ]);
    expect(collision?.message).toContain("Declared at col2-part.css:1 and line 3.");
  });
});

describe("a root-only sheet is byte-identical through the loader to today's one-file read", () => {
  it("produces the same findings object resolveCss produces on the same text", () => {
    const css = [
      ":root {",
      "  --page-bg: #FFFFFF;",
      "  --page-ink: #101010;",
      "  --page-ink-hover: #606060;",
      "}",
      "",
      "body { background: var(--page-bg); color: var(--page-ink); }",
      "",
      "a:hover { color: var(--page-ink-hover); }",
    ].join("\n");
    const path = writeSheet("rootonly.css", css);
    const viaText = audit(resolveCss(css)).findings;
    const viaLoader = audit(resolveStylesheet(loadStylesheet(path))).findings;
    expect(viaLoader).toEqual(viaText);
  });

  it("the vendored fixture audits byte-identically through the loader — its imports all skip", () => {
    // The census-closure fact, pinned: three bare package specifiers and one
    // missing relative target are all correctly skipped, so the 22-finding
    // calibration report keeps its numbers AND its bytes through the new seam.
    const viaText = audit(resolveCss(fixtureCss()));
    const viaLoader = audit(resolveStylesheet(loadStylesheet(FIXTURE_PATH)));
    expect(viaLoader.findings).toEqual(viaText.findings);
    expect(viaLoader.countsByRule).toEqual(viaText.countsByRule);
    expect(viaLoader.coverage).toEqual(viaText.coverage);
  });
});

describe("the CLI audits the closure, and the config beside the ROOT governs it", () => {
  it("flagship: the composing sheet exits 0 with coverage reading the composition", () => {
    writeSheet(
      "cli-tokens.css",
      ":root {\n  --accent: #FF0000;\n  --muted: #CCCCCC;\n}",
      cliDir,
    );
    const path = writeSheet(
      "cli-composed.css",
      '@import "./cli-tokens.css";\n\n.btn { color: var(--accent); }\n.card { border-color: var(--muted); }',
      cliDir,
    );
    const { code, out } = run(path);
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("coverage (1 theme, 2 base tokens)");
    expect(out).toContain("No findings.");
  });

  it("a config entry written beside the ROOT stylesheet suppresses a finding living in an imported file", () => {
    writeSheet("sup-tokens.css", ":root { --orphan: #00FF00; }", cliDir);
    const path = writeSheet(
      "sup-composed.css",
      '@import "./sup-tokens.css";\n\n.btn { color: red; }',
      cliDir,
    );
    writeFileSync(
      join(cliDir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [
          { rule: "dead-token", token: "--orphan", reason: "reserved for the pricing page" },
        ],
      }),
      "utf8",
    );
    const { code, out } = run(path);
    // An unscoped entry has no file axis at all, so the root's config governs
    // findings spliced in from imported files.
    expect(code).toBe(EXIT_OK);
    expect(out.some((l) => l.startsWith("suppressed (1)"))).toBe(true);
    expect(
      out.some((l) => l.includes("--orphan is declared at sup-tokens.css:1") && l.includes("reserved for the pricing page")),
    ).toBe(true);
  });

  it("a FILE-scoped entry naming the root governs the closure's imported findings too", () => {
    // The 0.1.11 composition this rebase creates: a file scope is compared
    // against the audited ENTRY stylesheet — the unit the invocation asked
    // about — and the unit here is the closure, so a judgement scoped to the
    // root covers the findings its imports spliced in.
    writeSheet("scoped-tokens.css", ":root { --orphan: #00FF00; }", cliDir);
    const path = writeSheet(
      "scoped-composed.css",
      '@import "./scoped-tokens.css";\n\n.btn { color: red; }',
      cliDir,
    );
    writeFileSync(
      join(cliDir, "themeguard.config.json"),
      JSON.stringify({
        suppress: [
          {
            rule: "dead-token",
            token: "--orphan",
            file: "scoped-composed.css",
            reason: "reserved for the pricing page",
          },
        ],
      }),
      "utf8",
    );
    const { code, out } = run(path);
    expect(code).toBe(EXIT_OK);
    expect(out).toContain("suppressed (1)");
    expect(
      out.some((l) => l.includes("[file: scoped-composed.css]") && l.includes("reserved for the pricing page")),
    ).toBe(true);
    expect(out.some((l) => l.includes("declared at scoped-tokens.css:1"))).toBe(true);
  });

  it("a REAL finding in the closure still holds exit 1", () => {
    writeSheet("exit-tokens.css", ":root { --accent: #FF0000; }", cliDir);
    const path = writeSheet(
      "exit-composed.css",
      '@import "./exit-tokens.css";\n\n.btn { color: var(--acccent); }',
      cliDir,
    );
    const { code } = run(path);
    expect(code).toBe(EXIT_FINDINGS);
  });
});

describe("the cascade folds the closure in document order, never per-file line numbers", () => {
  // The configuration the line sort got wrong and nothing else could catch:
  // the imported theme block sits at a HIGHER line number than the importer's
  // own, because every file's lines restart at 1. Sorted by line, the imported
  // block lands after the importer's own and wins the fold — the inverse of
  // the browser, which reads the importer's restatement later in the document.
  it("the importing file's own theme re-declaration wins even when the imported block sits at a higher line number", () => {
    writeSheet(
      "ord-tokens.css",
      ':root { --accent: #FF0000; }\n\n/* padding pushes the dark block to line 4, above the importer\'s line 2 */\n\n[data-theme="dark"] { --accent: #111111; }',
    );
    const path = writeSheet(
      "ord-app.css",
      '@import "./ord-tokens.css";\n[data-theme="dark"] { --accent: #999999; }\n.btn { color: var(--accent); }',
    );
    const resolved = resolveStylesheet(loadStylesheet(path));
    const dark = resolved.token("--accent", "dark");
    expect(dark?.resolvedValue?.toUpperCase()).toBe("#999999");
    // And the winner's citation carries the file it came from: the importer's
    // own declaration, so NO origin — an entry-file site.
    expect(dark?.importOrigin).toBeUndefined();
    expect(dark?.line).toBe(2);
    expect(audit(resolved).findings).toEqual([]);
  });

  it("theme enumeration follows the merged document: an imported theme precedes an entry theme written at a lower line number", () => {
    writeSheet(
      "enum-tokens.css",
      ':root { --x: #101010; }\n\n/* pad so zeta sits at line 5 */\n\n[data-theme="zeta"] { --x: #202020; }',
    );
    const path = writeSheet(
      "enum-app.css",
      '@import "./enum-tokens.css";\n[data-theme="alpha"] { --x: #303030; }\n.use { color: var(--x); }',
    );
    // The document reads zeta first (spliced at the statement) and alpha
    // second; the documented "root first, then every theme in source order"
    // contract is about THIS document, not about whichever file happens to
    // have the smaller line number.
    expect(resolveStylesheet(loadStylesheet(path)).themes).toEqual(["root", "zeta", "alpha"]);
  });

  it("a scale collapse the importer writes is reported, and one the importer fixes is not — the cascade winner decides, not line numbers", () => {
    // Direction 1 — the FALSE positive the line sort produced: the imported
    // dark block collapses the ramp (both #88BBFF, at line 4) and the
    // importer's own dark block pulls --brand-hover apart (line 2). The
    // browser reads the importer's pair; so does the fixed fold.
    writeSheet(
      "sc-tokens.css",
      ':root { --brand: #101010; --brand-hover: #606060; }\n\n[data-theme="dark"] { --brand: #88BBFF; --brand-hover: #88BBFF; }',
    );
    const fixed = writeSheet(
      "sc-app.css",
      '@import "./sc-tokens.css";\n[data-theme="dark"] { --brand: #88BBFF; --brand-hover: #5599DD; }\n.b { color: var(--brand); }\n.bh { color: var(--brand-hover); }',
    );
    expect(
      audit(resolveStylesheet(loadStylesheet(fixed))).findings
        .filter((f) => f.rule === "scale-collapse"),
    ).toEqual([]);

    // Direction 2 — the MASKED true positive, the mirror image: the imported
    // dark block is healthy (lines 4, kept apart) and the importer's own dark
    // block collapses the pair at line 2. The importer wins the cascade, so
    // the collapse is real and must fire.
    writeSheet(
      "sc2-tokens.css",
      ':root { --brand: #101010; --brand-hover: #606060; }\n\n[data-theme="dark"] { --brand: #88BBFF; --brand-hover: #5599DD; }',
    );
    const broken = writeSheet(
      "sc2-app.css",
      '@import "./sc2-tokens.css";\n[data-theme="dark"] { --brand: #88BBFF; --brand-hover: #88BBFF; }\n.b { color: var(--brand); }\n.bh { color: var(--brand-hover); }',
    );
    const findings = audit(resolveStylesheet(loadStylesheet(broken))).findings.filter(
      (f) => f.rule === "scale-collapse",
    );
    expect(findings).toHaveLength(1);
    // The collapse cites the IMPORTER's own declarations — line 2 of the
    // entry, bare, because that is where the measured pair lives. `sites`
    // reads base-then-state, matching the finding's `tokens`.
    expect(findings[0]?.sites).toEqual([
      { name: "--brand", line: 2 },
      { name: "--brand-hover", line: 2 },
    ]);
    expect(findings[0]?.message).toContain("Declared at lines 2 and 2.");
  });
});

describe("positions in one finding can sit in two files, and every citation says which", () => {
  it("positionClause cites imported sites by file and keeps entry-file wording byte-identical", () => {
    const site = (name: string, line: number, origin?: string): FindingSite =>
      origin === undefined ? { name, line } : { name, line, origin };
    // Entry-file sites: the exact strings this clause has always rendered.
    expect(positionClause([])).toBe("");
    expect(positionClause([site("--a", 41)])).toBe("Declared at line 41.");
    expect(positionClause([site("--a", 41), site("--b", 33)])).toBe("Declared at lines 41 and 33.");
    // Imported sites: cited by file, in siteString's voice.
    expect(positionClause([site("--a", 2, "tokens.css")])).toBe("Declared at tokens.css:2.");
    // Mixed company: each site cited independently — the collective `lines 2
    // and 3` wording is exactly the riddle a bare number beside a file-cited
    // one would extend.
    expect(positionClause([site("--a", 2), site("--b", 3, "tokens.css")])).toBe(
      "Declared at line 2 and tokens.css:3.",
    );
    expect(positionClause([site("--a", 2, "a.css"), site("--b", 5, "b.css")])).toBe(
      "Declared at a.css:2 and b.css:5.",
    );
  });

  it("a collision whose two sides live on opposite sides of the import edge cites each by its own file", () => {
    writeSheet("col-part.css", ":root { --part-fill: #3366AA; }");
    const path = writeSheet(
      "col-app.css",
      '@import "./col-part.css";\n\n:root { --root-fill: #3366AA; }\n.use { color: var(--part-fill); background: var(--root-fill); }',
    );
    const findings = audit(resolveStylesheet(loadStylesheet(path))).findings;
    const collision = findings.find((f) => f.rule === "collision");
    expect(collision?.tokens).toEqual(["--part-fill", "--root-fill"]);
    // The imported side carries its origin; the entry side carries none — the
    // structured pair of exactly what the message cites.
    expect(collision?.sites).toEqual([
      { name: "--part-fill", line: 1, origin: "col-part.css" },
      { name: "--root-fill", line: 3 },
    ]);
    expect(collision?.message).toBe(
      '--part-fill and --root-fill both resolve to #3366AA in theme "root". ' +
        "They are separate roles, and no other theme declares them apart, so " +
        "nothing here shows the equality is intended. " +
        "Declared at col-part.css:1 and line 3.",
    );
  });
});

describe("a site-scoped themeguard-ignore directive governs its own file only", () => {
  it("an entry-file directive does not silence an imported finding whose line merely coincides", () => {
    writeSheet("dir-tokens.css", ":root { --orphan: #00FF00; }");
    const path = writeSheet(
      "dir-app.css",
      '/* themeguard-ignore dead-token -- reserved */\n@import "./dir-tokens.css";\n\n.btn { color: red; }',
    );
    // The directive sits at entry line 1, which matches lines 1–2 of ITS OWN
    // file; the dead token lives at line 1 of dir-tokens.css. Line numbers
    // restart per file, so the coincidence is real and, before the fence, the
    // directive silently absorbed a finding it was never written against.
    const report = audit(resolveStylesheet(loadStylesheet(path)), {
      suppressions: scanIgnoreDirectives(readFileSync(path, "utf8"), path),
    });
    expect(report.findings.map((f) => f.message)).toContainEqual(
      "--orphan is declared at dir-tokens.css:1 and no var() in this stylesheet references it.",
    );
    // The judgement is not silently swallowed either: it announces itself as
    // unmatched, the same counted-not-silent discipline as any orphaned
    // directive.
    expect(report.unmatchedSuppressions).toHaveLength(1);
    // And a directive at the SAME line of the entry file still governs an
    // ENTRY-file finding — the fence is about the file, never the number.
    const entryPath = writeSheet(
      "dir-entry.css",
      '/* themeguard-ignore dead-token -- reserved */\n:root { --homegrown: #00FF00; }\n.btn { color: red; }',
    );
    const entryReport = audit(resolveStylesheet(loadStylesheet(entryPath)), {
      suppressions: scanIgnoreDirectives(readFileSync(entryPath, "utf8"), entryPath),
    });
    expect(entryReport.findings).toEqual([]);
    expect(entryReport.unmatchedSuppressions).toHaveLength(0);
  });
});
