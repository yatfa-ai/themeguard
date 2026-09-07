import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("themeguard <file.css> over the vendored calibration fixture", () => {
  const result = run(FIXTURE_PATH);

  it("prints the pinned census — 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency", () => {
    expect(result.stdout).toContain("collision (11)");
    expect(result.stdout).toContain("dead-token (2)");
    expect(result.stdout).toContain("scale-collapse (2)");
    expect(result.stdout).toContain("family-consistency (7)");
    expect(result.stdout).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency.",
    );
  });

  it("prints one `[rule] message` line per finding, and 22 of them in total", () => {
    const lines = result.out.filter((l) =>
      /^ {2}\[(collision|dead-token|scale-collapse|family-consistency)\]/.test(l),
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

  it("exits 2 when given more than one file — one command, zero options", () => {
    const result = run(FIXTURE_PATH, FIXTURE_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("expected exactly one file, got 2");
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
});
