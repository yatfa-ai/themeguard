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
  it("is version 0.1.0 — the first release with something to run", () => {
    expect(manifest.version).toBe("0.1.0");
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
    expect(result.stdout).toContain("15 findings: 11 collision, 2 dead-token, 2 scale-collapse.");
    expect(result.code).toBe(1);
  });

  it("keeps the exit contract across the install boundary", () => {
    const clean = join(consumer, "clean.css");
    writeFileSync(clean, ":root { --a: #FFF; --b: #000; }\nbody { color: var(--a); background: var(--b); }\n");
    expect(bin(clean).code).toBe(0);
    expect(bin(join(consumer, "absent.css")).code).toBe(2);
    expect(bin().code).toBe(2);
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
      '{"collision":11,"dead-token":2,"scale-collapse":2}',
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
    expect(readme).toContain("15 findings: 11 collision, 2 dead-token, 2 scale-collapse.");
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
  it("passes `npm publish --dry-run` and reports the 0.1.0 tarball", () => {
    const output = execFileSync("npm", ["publish", "--dry-run", "--ignore-scripts"], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const combined = output.toString();
    expect(combined).toContain("themeguard@0.1.0");
  }, 300_000);
});
