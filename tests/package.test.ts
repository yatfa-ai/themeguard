import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_PATH } from "./fixture.js";

/**
 * Success criteria 3 and 4 — THE PACKAGE, exercised the way a consumer gets it.
 *
 * Every other test in this repo imports from `src/`, which proves the code works
 * and proves nothing at all about what is INSTALLABLE. The manifest decides
 * that, and a manifest is only wrong in ways that are invisible from inside the
 * repository: `files` that omits `dist/`, a `bin` path that points at a file the
 * build does not emit, an `exports` map that resolves for a bundler and not for
 * node. Each of those leaves the whole suite green and ships a package that
 * cannot be run.
 *
 * So this suite packs a real tarball, installs it into a scratch project outside
 * this tree, and drives it from there: the bin over the vendored fixture (whose
 * census must survive the round trip byte for byte), and the library through the
 * `exports` map — runtime and types. That is the "any project that installs
 * this" criterion tested rather than asserted.
 *
 * It is slower than the rest of the suite by a wide margin, which is the cost of
 * testing the thing itself instead of a proxy for it.
 */

const repo = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  files: string[];
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
  "//": string;
};

/**
 * Run a command, with npm's own config scrubbed out of the child's environment.
 *
 * The scrub is REQUIRED, and the reason is not obvious. This suite is reached
 * two ways: directly by `npm test`, and by `npm publish`, whose `prepublishOnly`
 * hook runs `npm test`. On the second path `npm publish --dry-run` exports
 * `npm_config_dry_run=true`, npm's env-var form of the flag — and every nested
 * npm invocation inherits it. The `npm pack` below then performs a DRY pack,
 * prints the filename it would have written, and writes nothing, so the install
 * that follows fails on a tarball that was never created. The failure names a
 * missing file and says nothing about the flag that caused it.
 *
 * `npm_config_ignore_scripts` is scrubbed for the mirror-image reason: a human
 * publishing with `--ignore-scripts` must not have it silently applied to the
 * consumer install this suite performs on their behalf.
 */
function sh(command: string, args: string[], cwd: string): string {
  const env = { ...process.env };
  delete env["npm_config_dry_run"];
  delete env["npm_config_ignore_scripts"];
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let scratch: string;
let consumer: string;
let tarball: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "themeguard-pack-"));
  consumer = join(scratch, "consumer");
  mkdirSync(consumer);

  // `--ignore-scripts` is REQUIRED here and is not a convenience. `npm pack`
  // runs `prepublishOnly`, which runs this very suite, which packs again: the
  // recursion never terminates and the tarball is never written. So the build
  // is run explicitly first and the pack is told not to re-run the hook. This
  // is also what lets a human's real `npm publish` finish — its `prepublishOnly`
  // reaches this test, which packs WITHOUT triggering the hook a second time.
  sh("npm", ["run", "build"], repo);
  const packed = sh(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", scratch],
    repo,
  ).trim().split("\n");
  tarball = join(scratch, packed[packed.length - 1] as string);

  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", version: "1.0.0", type: "module", private: true }, null, 2),
  );
  sh("npm", ["install", "--no-audit", "--no-fund", tarball], consumer);
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("the manifest, before anything is packed", () => {
  // The version is NOT pinned to a literal. The release workflow bumps the
  // manifest (patch-only, scripts/bump-version.sh) and then runs this very
  // suite over the bumped tree — a literal here would make every release
  // commit red by construction, and 0.1.18's first release attempt died on
  // exactly that. The version ledger is prose, not an assertion: feature
  // commits append their notes to this title and to the manifest's "//"
  // comment; a release bump adds a version and no prose.
  it("is a plain semver — the ledger records what each version added: 0.1.6 added the fifth rule, unresolved-reference; 0.1.7 takes one invocation over several stylesheets; 0.1.9 adds the sixth rule, cycle-reference: a var() loop is a defect, judged from the resolver's kind:\"cycle\" chains; 0.1.11 lets a config judgement name the stylesheet it was recorded against; 0.1.10 makes the audit unit the file's import closure; 0.1.12 adds the seventh rule, duplicate-declaration: a name declared twice in one scope with differing values; 0.1.13 makes config discovery walk to the nearest ancestor; 0.1.14 adds the eighth rule, unresolved-import: a relative @import edge the loader could not follow — the file the specifier names is missing or unreadable — reports instead of auditing green; 0.1.15 adds the ninth rule, theme-partial-token: a token declared only in one theme's block never reaches the other views, and a chain that breaks on it is reported; 0.1.17 adds the command's first and only option, --json: the report as NDJSON, one object per stylesheet, so a pipeline caller reads the data beside the verdict instead of scraping prose; 0.1.19 makes the suppression half closure-wide too: themeguard-ignore directives are scanned from every member of the import closure, each imported file's entries stamped with its entry-relative origin and matched on (origin, line) — an entry-file directive still matches only entry-file sites — and a malformed directive in any member exits 2 naming its own file and line; 0.1.20 completes the resolver's coverage of its own cycle fact: a var() loop whose closing edge is embedded in a compound value (`1px solid var(--c)`, `calc(var(--x) + 2px)`) minted no kind:\"cycle\" token, so cycle-reference was structurally silent on the commonest token-value shape — the compound branch now reads each var() call's primary-position reference for a back edge, never a name inside a fallback segment, and every whole-value shape is byte-identical by construction; 0.1.21 completes the dependent-declaration half: a walk that stops at a compound value is re-marked kind:\"cycle\" when the stopped value's primary-position references name a walk-minted cycle in the same theme view, so the tail of a compound loop and the compound tail of a loop carry the designed finding, read from the walks' finished results only; 0.1.22 makes that consult complete: it asks loop MEMBERSHIP rather than the walker's kind-carrying identity — so a byte-identical tail no longer fires or stays silent according to which member of a compound-closed loop its walk happened to close — and it iterates to a FIXED POINT over its own re-marks, so a dependent two or more hops from the loop resolves instead of staying a residual; 0.1.23 mints the loop that consult could never see: a names-only cycle pass over the theme's primary-position edges — declared names only, fallback segments unread, no value substituted — runs per theme view before the dependent-declaration pass and marks the unmarked members of the loops no walk closes, so an all-compound loop and its dependents carry the finding instead of auditing green; 0.1.24 makes the unmatched section's advice true for the arm where both its readings were false — an entry-file themeguard-ignore directive whose rule and tokens match a finding living in an IMPORTED member of the closure suppresses nothing (the fence is unchanged) and was told the defect was fixed or it never aimed at anything real, while the finding printed above and the judgement was one file move from working: the row now names the live finding's file:line and the two moves that reach it, --json carries the same pointer as an additive crossFileAim key, and the diagnosis reuses the matcher's own hoisted halves rather than a twin that could drift; 0.1.25 splits the skipped row's reason on the skip branch's own arms: one condition (from===undefined || to===undefined || kind!==\"color\") already distinguished three whys and reported all three as not-a-color, two of them falsely — a pair declared only in a sibling theme's block has no value in this view to be a colour or not, and a var() chain that found nothing is exactly what the unresolved-reference section says about the same token three sections down — the reason is now read at that condition's own || boundaries into absent / unresolvable / not-a-color, and an absent row names the sibling theme the pair actually lives in with each member's line; translucent and not-a-color keep their exact strings and populations, --json carries the widened values plus an absent-never-null declaredIn key, and no count, no finding and no exit code moves; 0.1.26 makes the unmatched section's advice true for the last arm where both its readings were false — a config entry whose theme scope names one of the five rules that report theme: null by construction (dead-token, duplicate-declaration, theme-partial-token, unresolved-import, unresolved-reference) can never match anything, in this file, any file of the closure or any run of that config, and was told the defect was fixed or it never aimed at anything real while the finding printed above and the judgement was one key deletion from working: the row now names the rule, the dead scope and the move, the section gains its own tellable-case line beside the two it had, --json carries the same diagnosis as an additive themelessAim key absent on every row that did not earn it, and the rule's theme-lessness is DECLARED beside the rule ids rather than inferred from one run's findings, so cycle-reference's conditional stance keeps the generic prose even in a run whose loops all happen to be base-authored, and an entry that also carries a file scope keeps it too — the theme not being the only reason nothing matched there; the matching semantics, the counts and the exit code do not move; and 0.1.27 adds the project-level policy face the per-finding ledger could not express: an optional top-level suppress-rule key — an array of rule ids — turns a rule OFF for the whole project, so an adopter who has judged a RULE not-a-defect stops hand-writing one entry per finding per regeneration; validated with suppress's own discipline (an unknown rule id exits 2 naming the element, the same rule-id list the entries' rule field names), a named rule's findings move out of findings and the counts onto a counted suppressedDisabled leg printed suppressed-disabled, appended after unmatchedSuppressions, rows carrying the policy's own [disabled by policy] marker instead of a quoted reason, out of the exit code, and the policy check runs before the per-entry match so an entry naming a disabled rule stays unmatched with an honest carve-out instead of false retirement advice", () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("declares the bin at a path the build actually emits", () => {
    expect(manifest.bin).toEqual({ themeguard: "dist/cli.js" });
    sh("npm", ["run", "build"], repo);
    expect(existsSync(join(repo, "dist", "cli.js"))).toBe(true);
  }, 120_000);

  it("ships dist/ and drops src/ and tests/ from the tarball", () => {
    expect(manifest.files).toEqual(["dist/", "README.md", "LICENSE"]);
    expect(manifest.files).not.toContain("src/");
    expect(manifest.files).not.toContain("tests/");
  });

  it("no longer describes itself as a placeholder with nothing to run", () => {
    expect(manifest["//"]).not.toMatch(/placeholder/i);
    expect(manifest["//"]).not.toMatch(/no entry point/i);
    expect(manifest["//"]).toMatch(/themeguard <file\.css>/);
  });

  it("has a build script and a prepublishOnly that typechecks, tests and builds", () => {
    expect(manifest.scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(manifest.scripts.prepublishOnly).toContain("typecheck");
    expect(manifest.scripts.prepublishOnly).toContain("test");
    expect(manifest.scripts.prepublishOnly).toContain("build");
  });
});

describe("the packed tarball", () => {
  it("contains dist/ and the licence, and no src/ or tests/", () => {
    const listing = sh("tar", ["-tzf", tarball], scratch);
    expect(listing).toContain("package/dist/cli.js");
    expect(listing).toContain("package/dist/index.js");
    expect(listing).toContain("package/dist/index.d.ts");
    expect(listing).toContain("package/README.md");
    expect(listing).toContain("package/LICENSE");
    expect(listing).not.toMatch(/package\/src\//);
    expect(listing).not.toMatch(/package\/tests\//);
  });
});

describe("a project that has installed the package", () => {
  function bin(...args: string[]): { code: number; stdout: string; stderr: string } {
    const cli = join(consumer, "node_modules", ".bin", "themeguard");
    try {
      return { code: 0, stdout: sh(cli, args, consumer), stderr: "" };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("exposes the bin on PATH as `themeguard`", () => {
    expect(existsSync(join(consumer, "node_modules", ".bin", "themeguard"))).toBe(true);
  });

  it("reproduces the pinned census over the fixture, from the installed bin", () => {
    const result = bin(FIXTURE_PATH);
    expect(result.stdout).toContain("collision (11)");
    expect(result.stdout).toContain("dead-token (2)");
    expect(result.stdout).toContain("scale-collapse (2)");
    expect(result.stdout).toContain("family-consistency (7)");
    expect(result.stdout).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
    );
    expect(result.code).toBe(1);
  });

  it("keeps the exit contract across the install boundary", () => {
    const clean = join(consumer, "clean.css");
    writeFileSync(clean, ":root { --a: #FFF; --b: #000; }\nbody { color: var(--a); background: var(--b); }\n");
    expect(bin(clean).code).toBe(0);
    expect(bin(join(consumer, "absent.css")).code).toBe(2);
    expect(bin().code).toBe(2);
  });

  it("emits the report as NDJSON under --json, from the installed bin", () => {
    // The CLI consumer and the library consumer now read ONE shape — the test
    // below pins `JSON.stringify(report.countsByRule)` as an exact byte string
    // through the library, and this pins that the command hands out the same
    // object rather than a projection of it. The key order is the report
    // object's own insertion order, which is the compatibility surface that
    // pin has always asserted.
    const result = bin("--json", FIXTURE_PATH);
    expect(result.code).toBe(1);
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0]!) as { path: string; countsByRule: Record<string, number> };
    expect(Object.keys(report)).toEqual([
      "path",
      "findings",
      "countsByRule",
      "suppressed",
      "unmatchedSuppressions",
      "suppressedDisabled",
      "skipped",
      "coverage",
    ]);
    expect(report.path).toBe(FIXTURE_PATH);
    expect(JSON.stringify(report.countsByRule)).toBe(
      '{"collision":11,"dead-token":2,"scale-collapse":2,"family-consistency":7,"unresolved-reference":0,"cycle-reference":0,"duplicate-declaration":0,"unresolved-import":0,"theme-partial-token":0}',
    );
  });

  it("resolves the library through the exports map at RUNTIME", () => {
    const script = join(consumer, "use-library.mjs");
    writeFileSync(
      script,
      [
        'import { readFileSync } from "node:fs";',
        'import { resolveCss, audit } from "themeguard";',
        `const report = audit(resolveCss(readFileSync(${JSON.stringify(FIXTURE_PATH)}, "utf8")));`,
        "console.log(JSON.stringify(report.countsByRule));",
      ].join("\n"),
    );
    expect(sh(process.execPath, [script], consumer).trim()).toBe(
      '{"collision":11,"dead-token":2,"scale-collapse":2,"family-consistency":7,"unresolved-reference":0,"cycle-reference":0,"duplicate-declaration":0,"unresolved-import":0,"theme-partial-token":0}',
    );
  });

  it("resolves the library's TYPES through the exports map", () => {
    const probe = join(consumer, "types-probe.ts");
    writeFileSync(
      probe,
      [
        'import { audit, resolveCss, type AuditReport, type Finding } from "themeguard";',
        "const report: AuditReport = audit(resolveCss(':root { --a: #fff; }'));",
        "const findings: readonly Finding[] = report.findings;",
        "const n: number = report.countsByRule.collision + findings.length;",
        "export default n;",
      ].join("\n"),
    );
    // No tsconfig in the consumer: these flags ARE the consumer's config, and
    // `node16` resolution is the strict reading — an exports map that satisfies
    // a bundler but omits `types` fails here and passes under `bundler`.
    const tsc = join(repo, "node_modules", ".bin", "tsc");
    expect(() =>
      sh(
        tsc,
        [
          "--noEmit",
          "--strict",
          "--module",
          "node16",
          "--moduleResolution",
          "node16",
          "--target",
          "ES2022",
          "--skipLibCheck",
          probe,
        ],
        consumer,
      ),
    ).not.toThrow();
  }, 120_000);
});

describe("the README, which is the tarball's only prose", () => {
  const readme = readFileSync(join(repo, "README.md"), "utf8");

  // REVERT PROBE — restore either placeholder sentence and this fails on its
  // own. The README ships IN the tarball, so a stale "there is nothing to run
  // yet" is not a documentation lag, it is the installed package telling a
  // consumer the opposite of what its own bin does.
  it("no longer says there is no CLI, or that install is 'Not yet'", () => {
    expect(readme).not.toMatch(/no CLI yet/i);
    expect(readme).not.toMatch(/Not yet\. When there is something to run/i);
    expect(readme).not.toContain("`0.0.2`");
  });

  it("documents the command, the exit codes and the worked census", () => {
    expect(readme).toContain("npx themeguard path/to/application.css");
    expect(readme).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
    );
    expect(readme).toMatch(/\| `0` \| The audit ran and reported nothing\. \|/);
    expect(readme).toMatch(/\| `1` \| The audit ran and reported findings\. \|/);
    expect(readme).toMatch(/\| `2` \| The audit did not run/);
  });
});

describe("publication readiness", () => {
  /**
   * `npm publish --dry-run` validates the manifest and the file list without a
   * credential — which is the whole reason it is the end of this slice. The
   * sandbox has no npm auth (`npm whoami` → ENEEDAUTH, no ~/.npmrc, no
   * NPM_TOKEN), so the registry push itself is the one gesture left to a human.
   *
   * `--ignore-scripts` for the same reason the pack above needs it: without it
   * the dry run fires `prepublishOnly`, which runs this suite, which dry-runs
   * again. The hook's three commands are each verified elsewhere — `typecheck`
   * and `test` are this very run, and `build` is asserted against the emitted
   * `dist/cli.js` above — so what is left for this test is the manifest
   * validation the dry run performs, which is what it asserts.
   */
  it("passes `npm publish --dry-run` and reports the tarball of the advertised version", () => {
    const output = execFileSync("npm", ["publish", "--dry-run", "--ignore-scripts"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const combined = output.toString();
    // The version comes from the manifest, not a literal: this suite runs
    // unchanged over the release workflow's bumped tree, and still proves
    // the dry run validated a tarball named for the version being shipped.
    expect(combined).toContain(`themeguard@${manifest.version}`);
  }, 300_000);
});
