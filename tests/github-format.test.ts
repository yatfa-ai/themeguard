import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, formatReportGithub, HELP } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet } from "../src/resolve.js";
import { FIXTURE_PATH, fixtureWriter, scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * `--github` — one workflow command per site of each unsuppressed finding.
 * The renderer is read as data (like formatReportJson); the flag's CLI
 * contract (usage error with --json, exit-code parity) is read through runCli.
 */

const tmp = scratchDir("github-format");
const write = fixtureWriter(tmp);

function report(path: string): ReturnType<typeof audit> {
  return audit(resolveStylesheet(loadStylesheet(path)));
}

describe("formatReportGithub", () => {
  it("emits one command per site of a collision finding, with the same message", () => {
    const path = write(
      "collision/app.css",
      ":root {\n  --brand: #3366AA;\n  --link: #3366AA;\n}\n.x { color: var(--brand); background: var(--link); }\n",
    );
    const r = report(path);
    const collision = r.findings.find((f) => f.rule === "collision");
    expect(collision?.sites).toHaveLength(2);
    const lines = formatReportGithub(path, r);
    const message = collision!.message;
    expect(lines).toEqual([
      `::warning file=${path},line=2,title=themeguard/collision::${message}`,
      `::warning file=${path},line=3,title=themeguard/collision::${message}`,
    ]);
  });

  it("resolves an imported-file site to the origin joined onto the entry file's directory", () => {
    write("import/part.css", ":root { --part-fill: #3366AA; }\n");
    const path = write(
      "import/app.css",
      '@import "./part.css";\n\n:root { --root-fill: #3366AA; }\n.use { color: var(--part-fill); background: var(--root-fill); }\n',
    );
    const lines = formatReportGithub(path, report(path));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(`file=${tmp}/import/part.css,line=1,title=themeguard/collision::`);
    expect(lines[1]).toContain(`file=${path},line=3,title=themeguard/collision::`);
  });

  it("keeps the path as named on the command line for an entry-file site (relative stays relative)", () => {
    const lines = formatReportGithub("styles/app.css", {
      findings: [
        {
          rule: "dead-token",
          theme: null,
          tokens: ["--a"],
          message: "m",
          evidence: {},
          sites: [{ name: "--a", line: 4 }, { name: "--a", line: 9, origin: "../shared/t.css" }],
        },
      ],
    } as unknown as ReturnType<typeof audit>);
    expect(lines).toEqual([
      "::warning file=styles/app.css,line=4,title=themeguard/dead-token::m",
      "::warning file=shared/t.css,line=9,title=themeguard/dead-token::m",
    ]);
  });

  it("escapes %, CR, LF in the message and additionally : and , in property values", () => {
    const lines = formatReportGithub("a:b,c%d.css", {
      findings: [
        {
          rule: "collision",
          theme: null,
          tokens: [],
          message: "50% of a: b, c\r\nnext",
          evidence: {},
          sites: [{ name: "--a", line: 1 }],
        },
      ],
    } as unknown as ReturnType<typeof audit>);
    expect(lines).toEqual([
      "::warning file=a%3Ab%2Cc%25d.css,line=1,title=themeguard/collision::50%25 of a: b, c%0D%0Anext",
    ]);
  });

  it("emits a finding with no sites without file/line rather than dropping it", () => {
    const lines = formatReportGithub("a.css", {
      findings: [
        { rule: "cycle-reference", theme: null, tokens: [], message: "loop", evidence: {} },
      ],
    } as unknown as ReturnType<typeof audit>);
    expect(lines).toEqual(["::warning title=themeguard/cycle-reference::loop"]);
  });

  it("emits nothing for a suppressed finding", () => {
    write(
      "suppressed/themeguard.config.json",
      JSON.stringify({ suppress: [{ rule: "collision", tokens: ["--brand", "--link"], reason: "deliberate" }] }),
    );
    const path = write(
      "suppressed/app.css",
      ":root {\n  --brand: #3366AA;\n  --link: #3366AA;\n}\n.x { color: var(--brand); background: var(--link); }\n",
    );
    const result = run("--github", path);
    expect(result.out).toEqual([]);
    expect(result.code).toBe(EXIT_OK);
  });
});

describe("--github on the command line", () => {
  it("together with --json is a usage error: exit 2, message on stderr, nothing on stdout", () => {
    const result = run("--github", "--json", FIXTURE_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
    expect(result.stderr).toContain("--json and --github cannot be combined");
  });

  it("alone is the zero-positionals usage error", () => {
    const result = run("--github");
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
  });

  it("keeps exit-code parity with the prose run on the vendored fixture", () => {
    const prose = run(FIXTURE_PATH);
    const github = run("--github", FIXTURE_PATH);
    expect(prose.code).toBe(EXIT_FINDINGS);
    expect(github.code).toBe(prose.code);
    expect(github.out.length).toBeGreaterThan(0);
    expect(github.out.every((l) => l.startsWith("::warning "))).toBe(true);
    expect(github.stderr).toBe("");
  });

  it("is documented in --help", () => {
    expect(HELP).toContain("--github");
  });
});
