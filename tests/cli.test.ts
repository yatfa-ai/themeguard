import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXIT_ERROR,
  EXIT_FINDINGS,
  EXIT_OK,
  USAGE,
  runCli,
  type CliIo,
} from "../src/cli.js";
import { FIXTURE_PATH } from "./fixture.js";

/**
 * The CLI — success criteria 1 and 2.
 *
 * `runCli` is driven directly rather than through a subprocess for the bulk of
 * these, so the report is read as DATA instead of scraped out of a terminal.
 * The one thing that cannot be established that way is that a real `node
 * dist/cli.js` behaves the same, so the last describe block compiles the
 * package and runs the built file for real — and `tests/package.test.ts` goes
 * one further and runs it out of an installed tarball.
 *
 * The census these assert (11 / 2 / 2) is the same one `rules.test.ts` pins on
 * the library. It is repeated here on purpose: the CLI is presentation over the
 * library, and a presentation layer that quietly drops or double-counts a
 * finding would leave the library's own tests green.
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

/**
 * A stylesheet with nothing to report, written to be clean for a REASON in each
 * rule rather than by being small: two distinct values (no collision), every
 * token referenced by a `var()` (no dead token), and a hover a full 20 L* from
 * its base (no scale collapse).
 */
const CLEAN_CSS = `
:root {
  --page-bg: #FFFFFF;
  --page-ink: #101010;
  --page-ink-hover: #606060;
}

body {
  background: var(--page-bg);
  color: var(--page-ink);
}

a:hover {
  color: var(--page-ink-hover);
}
`;

/**
 * Rule 3 refuses to composite a translucent colour against a backdrop it was
 * never told about, so this pair is SKIPPED rather than measured. The CLI has
 * to say so: an unmeasured pair that prints as nothing is indistinguishable
 * from a pass.
 */
const TRANSLUCENT_CSS = `
:root {
  --panel: #202020;
  --panel-hover: rgba(255, 255, 255, 0.08);
}

.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
`;

/*
 * Written at MODULE LOAD, not in a `beforeAll`. Several suites below call
 * `run(...)` in the describe body, which vitest evaluates during collection —
 * i.e. before any hook has run — so a path set in `beforeAll` would still be
 * undefined at the moment it is read, and the command would report a missing
 * file rather than the stylesheet under test.
 */
const tmp = mkdtempSync(join(tmpdir(), "themeguard-cli-"));

function fixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

const CLEAN_PATH = fixture("clean.css", CLEAN_CSS);
const TRANSLUCENT_PATH = fixture("translucent.css", TRANSLUCENT_CSS);

/*
 * ── Multi-file invocation fixtures ────────────────────────────────────────
 * One finding, the cheapest kind to summon deterministically: a declared
 * token no var() references (dead-token), every other question with nothing
 * to say. A SECOND clean stylesheet with different content — two clean files
 * must be two independent audits, not one result printed twice.
 */
const ONE_FINDING_CSS = `
:root {
  --used: #101010;
  --unused: #202020;
}

.x { color: var(--used); }
`;

const CLEAN_CSS_2 = `
:root {
  --bg: #FAFAFA;
  --fg: #0A0A0A;
}

main { background: var(--bg); color: var(--fg); }
`;

const ONE_FINDING_PATH = fixture("one-finding.css", ONE_FINDING_CSS);
const CLEAN2_PATH = fixture("clean-2.css", CLEAN_CSS_2);

/*
 * Per-file suppression needs per-file DIRECTORIES: the config is discovered
 * BESIDE each stylesheet, so a judgement that reaches one file and not its
 * twin requires the two to live apart. The directive twin suppresses by
 * living in the stylesheet; the malformed twins exist to pin fail-fast — the
 * invocation stops at the file that cannot be audited, whichever of the
 * three per-file contracts it breaks.
 */
const CONFIG_DIR = join(tmp, "with-config");
const DIRECTIVE_DIR = join(tmp, "with-directive");
const BAD_DIRECTIVE_DIR = join(tmp, "with-bad-directive");
const BAD_CONFIG_DIR = join(tmp, "with-bad-config");
for (const dir of [CONFIG_DIR, DIRECTIVE_DIR, BAD_DIRECTIVE_DIR, BAD_CONFIG_DIR]) {
  mkdirSync(dir, { recursive: true });
}

const SUPPRESSED_BY_CONFIG_PATH = join(CONFIG_DIR, "a.css");
writeFileSync(SUPPRESSED_BY_CONFIG_PATH, ONE_FINDING_CSS, "utf8");
writeFileSync(
  join(CONFIG_DIR, "themeguard.config.json"),
  JSON.stringify({
    suppress: [
      { rule: "dead-token", token: "--unused", reason: "reserved for the generated print stylesheet" },
    ],
  }),
  "utf8",
);

const SUPPRESSED_BY_DIRECTIVE_PATH = join(DIRECTIVE_DIR, "a.css");
writeFileSync(
  SUPPRESSED_BY_DIRECTIVE_PATH,
  ONE_FINDING_CSS.replace(
    "  --unused: #202020;",
    "  /* themeguard-ignore dead-token -- reserved for the generated print stylesheet */\n  --unused: #202020;",
  ),
  "utf8",
);

const BAD_DIRECTIVE_PATH = join(BAD_DIRECTIVE_DIR, "a.css");
writeFileSync(
  BAD_DIRECTIVE_PATH,
  ONE_FINDING_CSS.replace(
    "  --unused: #202020;",
    "  /* themeguard-ignore dead-token */\n  --unused: #202020;",
  ),
  "utf8",
);

const BAD_CONFIG_PATH = join(BAD_CONFIG_DIR, "a.css");
writeFileSync(BAD_CONFIG_PATH, ONE_FINDING_CSS, "utf8");
writeFileSync(
  join(BAD_CONFIG_DIR, "themeguard.config.json"),
  JSON.stringify({
    suppress: [{ rule: "no-such-rule", token: "--unused", reason: "aimed at nothing real" }],
  }),
  "utf8",
);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("themeguard <file.css> over the vendored calibration fixture", () => {
  const result = run(FIXTURE_PATH);

  it("prints the pinned census — 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency", () => {
    expect(result.stdout).toContain("collision (11)");
    expect(result.stdout).toContain("dead-token (2)");
    expect(result.stdout).toContain("scale-collapse (2)");
    expect(result.stdout).toContain("family-consistency (7)");
    expect(result.stdout).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference.",
    );
  });

  it("prints one `[rule] message` line per finding, and 22 of them in total", () => {
    const lines = result.out.filter((l) =>
      /^ {2}\[(collision|dead-token|scale-collapse|family-consistency|unresolved-reference)\]/.test(l),
    );
    expect(lines).toHaveLength(22);
    expect(lines.filter((l) => l.startsWith("  [collision]"))).toHaveLength(11);
    expect(lines.filter((l) => l.startsWith("  [dead-token]"))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith("  [scale-collapse]"))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith("  [family-consistency]"))).toHaveLength(7);
  });

  it("names the two famous collisions and both dead tokens, with their measurements", () => {
    expect(result.stdout).toContain("--app-border and --app-surface-raised both resolve to #1E293B");
    expect(result.stdout).toContain("--app-cta and --app-success both resolve to #22C55E");
    expect(result.stdout).toContain("--topbar-height is declared at :root:402");
    expect(result.stdout).toContain("--transition-slow is declared at :root:407");
    expect(result.stdout).toContain("ΔL* 3.90");
  });

  /**
   * The position clause, as a PASTED LINE — which is the thing the CLI's own
   * docstring promises ("a line pasted into an issue still says which question
   * it answers") and which a collision line could not deliver before: it named
   * the tokens and the value, and left the receiver to re-derive the cascade by
   * hand over a 5,000-line stylesheet.
   */
  it("ends a collision, scale-collapse and family-consistency line with WHERE it lives", () => {
    const line = (prefix: string, contains: string) =>
      result.out.find((l) => l.startsWith(prefix) && l.includes(contains));

    // The fixture declares --app-border at 41 and --app-surface-raised at 33,
    // both in the base :root block. Those are the lines root's finding was
    // measured from — winter's 438/421 belong to winter's own finding.
    expect(line("  [collision]", "--app-border and --app-surface-raised")).toContain(
      "Declared at lines 41 and 33.",
    );
    expect(line("  [scale-collapse]", 'theme "root"')).toContain(
      "Declared at lines 376 and 375.",
    );
    expect(line("  [family-consistency]", "--app-success is inherited")).toContain(
      "Declared at line 54.",
    );

    // EVERY line of those three rules carries one — a clause on the famous
    // examples and nowhere else would be a demo, not a feature.
    const positioned = result.out.filter((l) =>
      /^ {2}\[(collision|scale-collapse|family-consistency)\]/.test(l),
    );
    expect(positioned).toHaveLength(20);
    for (const l of positioned) expect(l).toMatch(/Declared at lines? [\d, and]+\.$/);
  });

  it("leaves both dead-token lines byte-identical — that rule already said where", () => {
    // dead-token names `:root:402`, with a SELECTOR the merged theme tables
    // cannot supply, so it is untouched by this slice. Pinned whole rather than
    // by `toContain`, because the claim is that nothing was appended.
    expect(result.out.filter((l) => l.startsWith("  [dead-token]"))).toEqual([
      "  [dead-token] --topbar-height is declared at :root:402 and no var() in this stylesheet references it.",
      "  [dead-token] --transition-slow is declared at :root:407 and no var() in this stylesheet references it.",
    ]);
  });

  it("exits 1 — findings found, which is never the same code as a clean run", () => {
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(EXIT_FINDINGS).not.toBe(EXIT_OK);
    expect(EXIT_FINDINGS).not.toBe(EXIT_ERROR);
  });
});

describe("a stylesheet with nothing to report", () => {
  const result = run(CLEAN_PATH);

  it("exits 0 and says so in words, not only in the code", () => {
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("No findings.");
    expect(result.stderr).toBe("");
  });

  it("still prints all four rule headings at zero, so a silent rule is visible", () => {
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("dead-token (0)");
    expect(result.stdout).toContain("scale-collapse (0)");
    expect(result.stdout).toContain("family-consistency (0)");
  });
});

/**
 * The coverage section — informational by construction, printed under the same
 * precedent as `skipped`: counted, named, headline even at zero, and NEVER an
 * exit code. Inherited is normal — theme-independent tokens have no override by
 * design — so a stylesheet whose only story is inheritance must exit 0.
 */
describe("the coverage section — facts, counted and named, never an exit code", () => {
  const result = run(FIXTURE_PATH);

  it("prints the headline and both themes' inventories over the fixture", () => {
    expect(result.stdout).toContain("coverage (2 themes, 73 base tokens)");
    expect(result.stdout).toContain("root: declares all 73 base tokens, inherits 0.");
    expect(result.stdout).toContain(
      "winter: declares 51 of 73 base tokens, inherits 22 (8 color / 14 non-color).",
    );
  });

  it("names every inherited token with its kind — 22 of them", () => {
    const inherited = result.out.filter((l) => l.startsWith("    [inherited] "));
    expect(inherited).toHaveLength(22);
    expect(inherited.filter((l) => l.endsWith("(color)"))).toHaveLength(8);
    expect(inherited.filter((l) => l.endsWith("(non-color)"))).toHaveLength(14);
    // A colour the theme silently receives, and a length it legitimately does:
    // both are the listing's business, neither is a finding.
    expect(result.stdout).toContain("    [inherited] --app-success (color)");
    expect(result.stdout).toContain("    [inherited] --font-family (non-color)");
  });

  it("prints the family-consistency section with its seven findings", () => {
    expect(result.stdout).toContain('family-consistency (7)');
    expect(result.stdout).toContain('--app-success is inherited from :root in theme "winter"');
  });

  it("still headlines the section when a theme inherits nothing", () => {
    const single = run(CLEAN_PATH);
    expect(single.stdout).toContain("coverage (1 theme, 3 base tokens)");
    expect(single.stdout).toContain("root: declares all 3 base tokens, inherits 0.");
  });

  it("never moves the exit code — inheritance alone is a clean run", () => {
    // A theme that inherits a wholly-inherited colour family (no tuning, no
    // finding) beside an unrelated override: the coverage section has something
    // to name, rule 4 has nothing to say, and the run exits 0.
    const path = fixture(
      "inherited-only.css",
      `
:root {
  --tone: #22C55E;
  --tone-soft: #86EFAC;
  --ink: #101010;
}

[data-theme="night"] { --ink: #EEEEEE; }

.x { background: var(--tone); }
.badge { background: var(--tone-soft); color: var(--ink); }
`,
    );
    const quiet = run(path);
    expect(quiet.code).toBe(EXIT_OK);
    expect(quiet.stdout).toContain("No findings.");
    expect(quiet.stdout).toContain("family-consistency (0)");
    // And the inventory is still on the record: night inherits both tone
    // members whole, which is the listing's business, not a defect's.
    expect(quiet.stdout).toContain("night: declares 1 of 3 base tokens, inherits 2");
    expect(quiet.stdout).toContain("    [inherited] --tone (color)");
    expect(quiet.stdout).toContain("    [inherited] --tone-soft (color)");
  });

  it("appends the no-value kinds to the split, so the parenthetical partitions the set", () => {
    // A base token whose var() chain does not resolve in a theme is neither
    // colour nor non-colour; a split that counted only those two headlines
    // `0 color / 0 non-color` against a non-zero total — a census that does
    // not close. The no-value kinds are appended when present, and absent
    // from every ordinary split, which stays byte-identical.
    const path = fixture(
      "unresolved-inherited.css",
      `
:root { --tone: var(--brand-green); --tone-border: #16A34A; }
[data-theme="night"] { --tone-border: #86EFAC; }
.x { background: var(--tone); border: 1px solid var(--tone-border); }
`,
    );
    const result = run(path);
    expect(result.stdout).toContain(
      "night: declares 1 of 2 base tokens, inherits 1 (0 color / 0 non-color / 1 unresolved).",
    );
    expect(result.stdout).toContain("    [inherited] --tone (unresolved)");
  });
});

describe("pairs rule 3 could not measure", () => {
  const result = run(TRANSLUCENT_PATH);

  // REVERT PROBE — drop the `skipped` block from `formatReport` and this test
  // fails on its own: the run still exits 0 with no findings, which is exactly
  // the pass this stylesheet has NOT earned.
  it("renders the skipped pair explicitly, with its reason", () => {
    expect(result.stdout).toContain("skipped (1)");
    expect(result.stdout).toContain(
      '[skipped] --panel-hover against --panel in theme "root": translucent',
    );
  });

  it("does not count a skipped pair as a finding — the exit code stays 0", () => {
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("No findings.");
  });

  it("says so when nothing was skipped, rather than printing an empty section", () => {
    expect(run(FIXTURE_PATH).stdout).toContain(
      "nothing skipped — every pair rule 3 derived was measurable.",
    );
  });
});

describe("usage and file errors", () => {
  it("exits 2 with usage when given no file", () => {
    const result = run();
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.err).toContain(USAGE);
    expect(result.out).toEqual([]);
  });

  it("accepts several files in one invocation — the positionals repeat, still zero options", () => {
    // The exact invocation the single-file contract REJECTED — one path, the
    // same path twice — is the multi-file contract's acceptance case: each
    // positional is audited, each report prints under its own header, and the
    // per-file outcomes aggregate into one exit for the invocation.
    const result = run(FIXTURE_PATH, FIXTURE_PATH);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.out.filter((l) => l === `themeguard — ${FIXTURE_PATH}`)).toHaveLength(2);
    expect(result.stdout).toContain("22 findings");
  });

  it("exits 2 and names the path when the file cannot be read", () => {
    const missing = join(tmp, "does-not-exist.css");
    const result = run(missing);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain(`cannot read ${missing}`);
    expect(result.stderr).toContain("ENOENT");
    expect(result.out).toEqual([]);
  });

  it("distinguishes an error from findings — the codes are 2 and 1, never both", () => {
    expect(run(join(tmp, "nope.css")).code).toBe(EXIT_ERROR);
    expect(run(FIXTURE_PATH).code).toBe(EXIT_FINDINGS);
  });
});

/**
 * Several stylesheets in one invocation — the multi-file contract. Each file
 * is audited INDEPENDENTLY (its config and directives are its own; references
 * do not cross files), each report prints under its own `themeguard — <path>`
 * header as it completes, the invocation fails fast on the first file that
 * cannot be audited with the error naming THAT file, and the per-file
 * outcomes aggregate into one exit for the invocation: 2 > 1 > 0.
 */
describe("several stylesheets in one invocation", () => {
  it("audits two clean files independently — two reports, exit 0", () => {
    const result = run(CLEAN_PATH, CLEAN2_PATH);
    expect(result.code).toBe(EXIT_OK);
    expect(result.out.filter((l) => l === `themeguard — ${CLEAN_PATH}`)).toHaveLength(1);
    expect(result.out.filter((l) => l === `themeguard — ${CLEAN2_PATH}`)).toHaveLength(1);
    // Both files' own summaries, in order: independence means each report is
    // over ITS file, and the invocation over both is still clean.
    expect(result.out.indexOf(`themeguard — ${CLEAN_PATH}`)).toBeLessThan(
      result.out.indexOf(`themeguard — ${CLEAN2_PATH}`),
    );
    expect(result.stderr).toBe("");
  });

  it("exits 1 when only the SECOND file reports findings — both reports printed", () => {
    const result = run(CLEAN_PATH, ONE_FINDING_PATH);
    expect(result.code).toBe(EXIT_FINDINGS);
    // The clean file's verdict is not swallowed by the aggregate: both
    // headers print, the clean one saying "No findings." in its own report.
    expect(result.stdout).toContain(`themeguard — ${CLEAN_PATH}`);
    expect(result.stdout).toContain(`themeguard — ${ONE_FINDING_PATH}`);
    expect(result.out.indexOf("No findings.")).toBeGreaterThan(-1);
    expect(result.out.indexOf("dead-token (1)")).toBeGreaterThan(-1);
  });

  it("fails fast on an unreadable second file — first report printed, the error names it, exit 2", () => {
    const missing = join(tmp, "does-not-exist.css");
    const result = run(CLEAN_PATH, missing);
    expect(result.code).toBe(EXIT_ERROR);
    // The file BEFORE the bad one keeps the report it already printed…
    expect(result.out.filter((l) => l === `themeguard — ${CLEAN_PATH}`)).toHaveLength(1);
    expect(result.out.indexOf("No findings.")).toBeGreaterThan(-1);
    // …and the diagnostic names THE file that could not be read, not the
    // invocation.
    expect(result.stderr).toContain(`cannot read ${missing}`);
    // Fail-fast, not fail-slow: nothing was audited after the bad path.
    expect(result.out.filter((l) => l === `themeguard — ${missing}`)).toHaveLength(0);
  });

  it("fails fast on an unhonourable config beside the second file — exit 2 naming that config", () => {
    const result = run(CLEAN_PATH, BAD_CONFIG_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out.filter((l) => l === `themeguard — ${CLEAN_PATH}`)).toHaveLength(1);
    expect(result.stderr).toContain(join(BAD_CONFIG_DIR, "themeguard.config.json"));
    expect(result.stderr).toContain("no-such-rule");
  });

  it("fails fast on a malformed directive in the second file — exit 2 naming that comment's line", () => {
    const result = run(CLEAN_PATH, BAD_DIRECTIVE_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out.filter((l) => l === `themeguard — ${CLEAN_PATH}`)).toHaveLength(1);
    expect(result.stderr).toContain(`${BAD_DIRECTIVE_PATH}:`);
  });

  it("honours the config beside EACH stylesheet — one suppressed, its unconfigured twin reports", () => {
    // Same stylesheet content, two directories: the config beside file A
    // suppresses its dead token; file B, with no config beside it, reports
    // the same token. The aggregated exit is 1 — file B's finding — and each
    // report tells its own story.
    const result = run(SUPPRESSED_BY_CONFIG_PATH, ONE_FINDING_PATH);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain(`themeguard — ${SUPPRESSED_BY_CONFIG_PATH}`);
    expect(result.stdout).toContain(`themeguard — ${ONE_FINDING_PATH}`);
    // A's verdict, from A's report only…
    const aReport = result.out.slice(
      result.out.indexOf(`themeguard — ${SUPPRESSED_BY_CONFIG_PATH}`),
      result.out.indexOf(`themeguard — ${ONE_FINDING_PATH}`),
    );
    expect(aReport).toContain("dead-token (0)");
    expect(aReport).toContain("suppressed (1)");
    expect(aReport.join("\n")).toContain("reserved for the generated print stylesheet");
    // …and B's, from B's report.
    const bReport = result.out.slice(result.out.indexOf(`themeguard — ${ONE_FINDING_PATH}`));
    expect(bReport).toContain("dead-token (1)");
    expect(bReport.join("\n")).not.toContain("suppressed (1)");
  });

  it("fires a themeguard-ignore directive in its own file only — the twin without it reports", () => {
    // The judgement lives IN the stylesheet, so the twin — identical but for
    // the missing comment — has no judgement recorded and reports the token.
    const result = run(SUPPRESSED_BY_DIRECTIVE_PATH, ONE_FINDING_PATH);
    expect(result.code).toBe(EXIT_FINDINGS);
    const aReport = result.out.slice(
      result.out.indexOf(`themeguard — ${SUPPRESSED_BY_DIRECTIVE_PATH}`),
      result.out.indexOf(`themeguard — ${ONE_FINDING_PATH}`),
    );
    const bReport = result.out.slice(result.out.indexOf(`themeguard — ${ONE_FINDING_PATH}`));
    expect(aReport).toContain("dead-token (0)");
    expect(aReport).toContain("suppressed (1)");
    expect(aReport.join("\n")).toContain(`${SUPPRESSED_BY_DIRECTIVE_PATH}:4`);
    expect(bReport).toContain("dead-token (1)");
  });
});

/**
 * The built file, run by node the way the `bin` entry runs it. Everything above
 * calls `runCli` in-process, which proves the report but not that the compiled
 * module executes anything when node is pointed at it — the entry-point guard,
 * the shebang and the emitted `.js` are all outside that reach.
 */
describe("node dist/cli.js — the built artifact", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const cli = join(repo, "dist", "cli.js");

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: repo, stdio: "pipe" });
  }, 120_000);

  function spawn(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("reproduces the census over the fixture and exits 1", () => {
    const result = spawn(FIXTURE_PATH);
    expect(result.stdout).toContain("collision (11)");
    expect(result.stdout).toContain("dead-token (2)");
    expect(result.stdout).toContain("scale-collapse (2)");
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("exits 0 on the clean stylesheet and 2 on a missing one", () => {
    expect(spawn(CLEAN_PATH).code).toBe(EXIT_OK);
    expect(spawn(join(tmp, "absent.css")).code).toBe(EXIT_ERROR);
  });

  it("aggregates several files in one invocation — one verdict through the built binary", () => {
    // Two clean files, one invocation: the aggregate is over the per-file
    // outcomes, so 0 and 0 aggregate to 0.
    const cleanPair = spawn(CLEAN_PATH, CLEAN2_PATH);
    expect(cleanPair.code).toBe(EXIT_OK);
    expect(cleanPair.stdout.split(`themeguard — ${CLEAN_PATH}`)).toHaveLength(2);
    expect(cleanPair.stdout.split(`themeguard — ${CLEAN2_PATH}`)).toHaveLength(2);
    // 0 and 1 aggregate to 1 — a finding in ANY file holds the invocation.
    expect(spawn(CLEAN_PATH, ONE_FINDING_PATH).code).toBe(EXIT_FINDINGS);
    // And the first file's report is already on stdout when the second
    // cannot be read — the fail-fast contract, through a real process.
    const failed = spawn(CLEAN_PATH, join(tmp, "absent.css"));
    expect(failed.code).toBe(EXIT_ERROR);
    expect(failed.stdout).toContain(`themeguard — ${CLEAN_PATH}`);
    expect(failed.stdout).toContain("No findings.");
    expect(failed.stderr).toContain("cannot read");
  });
});

/**
 * The `unmatched` section — the complement of `suppressed`, under the same
 * counted-even-at-zero discipline. A declared suppression that matched
 * NOTHING is named, with its rule, its declared scope, its `[file:line]`
 * source where it has one, and its reason quoted — because a standing ledger
 * of signed-off exceptions must say when one of its entries has outlived the
 * defect it was written about. Like `skipped` and `coverage` it is hygiene,
 * never a defect: it prints at zero and NEVER moves the exit code, so an
 * expired judgement cannot turn a green pipeline red.
 */
describe("the unmatched section — judgements that matched nothing, counted and named", () => {
  const dir = join(tmp, "unmatched-fixtures");

  function fx(name: string, css: string): string {
    const path = join(dir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, css, "utf8");
    return path;
  }

  function config(json: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "themeguard.config.json"), json, "utf8");
  }

  const DEAD_ENTRIES = JSON.stringify({
    suppress: [
      { rule: "scale-collapse", token: "--page-ink-hover", reason: "deliberate hover, signed off 2026-02-01" },
      { rule: "dead-token", token: "--legacy-ink", reason: "reserved for the pricing page, signed off 2026-03-10" },
      { rule: "collision", tokens: ["--page-bg", "--page-ink"], reason: "reviewed 2025-11-20, kept for the print theme" },
    ],
  });

  it("names every dead config entry — rule, scope, reason quoted — on a CLEAN sheet, at exit 0", () => {
    config(DEAD_ENTRIES);
    const result = run(fx("dead-entries.css", CLEAN_CSS));
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (3)");
    expect(result.stdout).toContain(
      "  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.",
    );
    expect(result.out.filter((l) => l.startsWith("  [unmatched] "))).toEqual([
      '  [unmatched] [scale-collapse] — "deliberate hover, signed off 2026-02-01" [token: --page-ink-hover]',
      '  [unmatched] [dead-token] — "reserved for the pricing page, signed off 2026-03-10" [token: --legacy-ink]',
      '  [unmatched] [collision] — "reviewed 2025-11-20, kept for the print theme" [tokens: --page-bg, --page-ink]',
    ]);
  });

  it("distinguishes entries that share a rule and a reason — the scalar token is the only difference, and it prints", () => {
    // The reviewer's probe shape: a batch of tokens signed off together —
    // same rule, same reason, different scalar tokens. These three entries
    // are distinguishable ONLY by their token dimension, and the unmatched
    // line has no finding to name it instead, so the token MUST render or
    // the three lines collapse into one another.
    config(
      JSON.stringify({
        suppress: [
          { rule: "dead-token", token: "--legacy-ink", reason: "reserved, signed off 2026-03-10" },
          { rule: "dead-token", token: "--legacy-accent", reason: "reserved, signed off 2026-03-10" },
          { rule: "dead-token", token: "--legacy-panel", reason: "reserved, signed off 2026-03-10" },
        ],
      }),
    );
    const result = run(fx("same-shape.css", CLEAN_CSS));
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (3)");
    expect(result.out.filter((l) => l.startsWith("  [unmatched] "))).toEqual([
      '  [unmatched] [dead-token] — "reserved, signed off 2026-03-10" [token: --legacy-ink]',
      '  [unmatched] [dead-token] — "reserved, signed off 2026-03-10" [token: --legacy-accent]',
      '  [unmatched] [dead-token] — "reserved, signed off 2026-03-10" [token: --legacy-panel]',
    ]);
  });

  it("prints even at ZERO, in prose — an empty section is the proof every judgement still works", () => {
    // No config beside this sheet (the only one lives beside the other
    // fixtures in `dir`): the section must headline anyway, the exact silence
    // this ticket removes being a section that vanished at zero.
    const result = run(CLEAN_PATH);
    expect(result.stdout).toContain("unmatched (0)");
    expect(result.stdout).toContain(
      "  nothing unmatched — every recorded judgement still covers a finding this report carries.",
    );
    expect(result.out.filter((l) => l.startsWith("  [unmatched] "))).toEqual([]);
  });

  it("sits with the counted sections — after `suppressed`, before `coverage`", () => {
    config(DEAD_ENTRIES);
    const result = run(fx("dead-entries.css", CLEAN_CSS));
    const suppressedAt = result.out.findIndex((l) => l === "suppressed (0)");
    const unmatchedAt = result.out.findIndex((l) => l === "unmatched (3)");
    const coverageAt = result.out.findIndex((l) => l.startsWith("coverage ("));
    expect(suppressedAt).toBeGreaterThan(-1);
    expect(unmatchedAt).toBeGreaterThan(suppressedAt);
    expect(coverageAt).toBeGreaterThan(unmatchedAt);
  });

  it("never moves the exit code — findings alone decide, here and on a finding-bearing sheet", () => {
    // A clean sheet with three dead judgements exits 0 (pinned above); the
    // fence's other side: the SAME dead entries on a sheet WITH a finding
    // still exit 1 — an unmatched section neither adds nor removes a finding.
    config(DEAD_ENTRIES);
    const oneFinding = fx(
      "one-finding.css",
      `
:root {
  --panel: #202020;
  --panel-hover: #252525;
}

.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
`,
    );
    const withFinding = run(oneFinding);
    expect(withFinding.code).toBe(EXIT_FINDINGS);
    expect(withFinding.stdout).toContain("scale-collapse (1)");
    expect(withFinding.stdout).toContain("unmatched (3)");
  });

  it("names an orphaned directive whose defect was FIXED, with its [file:line] source clause", () => {
    // The judgement was recorded about an equality that no longer exists —
    // the one case with no finding left to announce the miss.
    config("{}");
    const orphanSheet = fx(
      "orphaned-directive.css",
      CLEAN_CSS.replace(
        "  --page-bg: #FFFFFF;",
        "  /* themeguard-ignore collision --page-bg --page-ink -- vendor brand, signed off 2026-01-15 */\n  --page-bg: #FFFFFF;",
      ),
    );
    const result = run(orphanSheet);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.out.find((l) => l.startsWith("  [unmatched] "))).toBe(
      '  [unmatched] [collision] — "vendor brand, signed off 2026-01-15" [tokens: --page-bg, --page-ink] [' +
        orphanSheet +
        ":3]",
    );
  });

  it("splits the ledger honestly — the entry that worked stays in `suppressed`, the dead one in `unmatched`", () => {
    config(
      JSON.stringify({
        suppress: [
          { rule: "scale-collapse", token: "--panel-hover", reason: "deliberately subtle, still holding" },
          { rule: "dead-token", token: "--legacy-ink", reason: "stale — the token is long gone" },
        ],
      }),
    );
    // The finding-bearing sheet: the hover entry genuinely suppresses the one
    // finding (so the run exits 0); the dead-token entry matches nothing and
    // is named as unmatched. One ledger, two fates, both visible.
    const result = run(fx(
      "mixed.css",
      `
:root {
  --panel: #202020;
  --panel-hover: #252525;
}

.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
`,
    ));
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.out.find((l) => l.startsWith("  [suppressed] "))).toContain(
      '"deliberately subtle, still holding"',
    );
    expect(result.out.find((l) => l.startsWith("  [unmatched] "))).toContain(
      '"stale — the token is long gone"',
    );
  });
});
