import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, HELP } from "../src/cli.js";
import { FIXTURE_PATH, fixtureCss, fixtureStubCss, fixtureWriter, scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * `--suppress-entries --reason <text>` — one config `suppress` entry per
 * unsuppressed finding, printed as ONE JSON document on stdout.
 */

const tmp = scratchDir("suppress-entries");
const write = fixtureWriter(tmp);

interface Entry {
  rule: string;
  tokens: string[];
  theme?: string;
  file: string;
  reason: string;
}

function entries(result: ReturnType<typeof run>): Entry[] {
  expect(result.out).toHaveLength(1);
  return (JSON.parse(result.stdout) as { suppress: Entry[] }).suppress;
}

const COLLISION =
  ":root {\n  --brand: #3366AA;\n  --link: #3366AA;\n}\n.x { color: var(--brand); background: var(--link); }\n";

describe("--suppress-entries", () => {
  it("round-trips: the generated entries, written as the config, silence every finding of the fixture", () => {
    write("fixture/actiontext.css", fixtureStubCss());
    const css = write("fixture/application.tailwind.css", fixtureCss());
    const before = run(css);
    expect(before.code).toBe(EXIT_FINDINGS);

    const generated = run("--suppress-entries", "--reason", "legacy, tracked in #123", css);
    expect(generated.code).toBe(EXIT_OK);
    expect(generated.stderr).not.toContain("skipped");
    const list = entries(generated);
    expect(list).toHaveLength(22);
    expect(list.every((e) => e.reason === "legacy, tracked in #123")).toBe(true);
    expect(list.every((e) => e.file === "application.tailwind.css")).toBe(true);

    write("fixture/themeguard.config.json", generated.stdout);
    const after = run(css);
    expect(after.code).toBe(EXIT_OK);
    expect(after.stdout).toContain("suppressed (22)");
    expect(after.stdout).toContain("unmatched (0)");
    expect(after.stdout).not.toMatch(/^  \[(collision|family-consistency|scale-collapse|dead-token)\]/m);

    // Already-suppressed findings are excluded by construction.
    const again = run("--suppress-entries", "--reason", "x", css);
    expect(again.code).toBe(EXIT_OK);
    expect(entries(again)).toEqual([]);
  });

  it("supports the README's adoption flow: generate for a directory, move the document into that directory, re-run clean", () => {
    write("adopt/styles/actiontext.css", fixtureStubCss());
    write("adopt/styles/application.tailwind.css", fixtureCss());
    const dir = join(tmp, "adopt", "styles");

    // The generator runs while no config exists; the document goes outside the tree first.
    const generated = run("--suppress-entries", "--reason", "legacy, tracked in #123", dir);
    expect(generated.code).toBe(EXIT_OK);
    expect(entries(generated)).toHaveLength(22);

    // Entries are relative to `styles/`, so the config must be saved there (not in its parent).
    write("adopt/styles/themeguard.config.json", generated.stdout);
    const after = run(dir);
    expect(after.code).toBe(EXIT_OK);
    expect(after.stdout).toContain("suppressed (22)");
    expect(after.stdout).toContain("unmatched (0)");
  });

  it("is why the README redirects outside the tree: an empty config already in place (the shell's `> themeguard.config.json`) is refused", () => {
    write("redirect/styles/application.tailwind.css", COLLISION);
    write("redirect/styles/themeguard.config.json", "");
    const result = run("--suppress-entries", "--reason", "r", join(tmp, "redirect", "styles"));
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
    expect(result.stderr).toContain("invalid themeguard.config.json");
  });

  it("prints a generated entry under `unmatched` once its finding is fixed", () => {
    const css = write("fixed/app.css", COLLISION);
    const generated = run("--suppress-entries", "--reason", "legacy", css);
    expect(entries(generated)).toHaveLength(1);
    write("fixed/themeguard.config.json", generated.stdout);
    expect(run(css).code).toBe(EXIT_OK);

    write("fixed/app.css", COLLISION.replace("--link: #3366AA", "--link: #AA3333"));
    const result = run(css);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");
  });

  it("emits sorted tokens and no `theme` key for a theme-less dead-token finding", () => {
    const css = write("dead/app.css", ":root {\n  --zz-dead: #112233;\n  --aa-dead: #445566;\n}\n");
    const list = entries(run("--suppress-entries", "--reason", "r", css));
    const dead = list.filter((e) => e.rule === "dead-token");
    expect(dead.length).toBeGreaterThan(0);
    for (const entry of dead) expect("theme" in entry).toBe(false);
    for (const entry of list) expect(entry.tokens).toEqual([...entry.tokens].sort());
  });

  it("carries `theme` for a theme-scoped finding", () => {
    const css = write("themed/app.css", COLLISION);
    const [entry] = entries(run("--suppress-entries", "--reason", "r", css));
    expect(entry).toEqual({
      rule: "collision",
      tokens: ["--brand", "--link"],
      theme: "root",
      file: "app.css",
      reason: "r",
    });
  });

  it("names the entry stylesheet, relative to the discovered config home, for a finding inside an @import-ed file", () => {
    write("home/themeguard.config.json", "{}");
    write("home/sub/part.css", ":root { --part-fill: #3366AA; }\n");
    const css = write(
      "home/sub/app.css",
      '@import "./part.css";\n\n:root { --root-fill: #3366AA; }\n.use { color: var(--part-fill); background: var(--root-fill); }\n',
    );
    const result = run("--suppress-entries", "--reason", "r", css);
    const list = entries(result);
    expect(list).toHaveLength(1);
    expect(list[0]?.file).toBe("sub/app.css");

    write("home/themeguard.config.json", result.stdout);
    const after = run(css);
    expect(after.code).toBe(EXIT_OK);
    expect(after.stdout).toContain("suppressed (1)");
    expect(after.stdout).toContain("unmatched (0)");
  });

  it("without a config, takes the home as the deepest directory containing every audited stylesheet", () => {
    write("tree/a.css", COLLISION);
    write("tree/components/b.css", COLLISION);
    const result = run("--suppress-entries", "--reason", "r", join(tmp, "tree"));
    expect(entries(result).map((e) => e.file)).toEqual(["a.css", "components/b.css"]);
    write("tree/themeguard.config.json", result.stdout);
    const after = run(join(tmp, "tree"));
    expect(after.code).toBe(EXIT_OK);
    // Each stylesheet's own finding is suppressed; the sibling's entry reads as
    // that sibling's (the shared-config fate line), not as a mis-aimed one.
    expect(after.stdout.match(/suppressed \(1\)/g)).toHaveLength(2);
    expect(after.stdout).toContain("[file: components/b.css]");
    expect(after.stdout).toContain("That file's report is the one that states its fate.");
    expect(after.stdout).not.toMatch(/^collision \([1-9]/m);
  });

  it("deduplicates whole entries across stylesheets", () => {
    write("dedup/themeguard.config.json", "{}");
    const a = write("dedup/a.css", COLLISION);
    const list = entries(run("--suppress-entries", "--reason", "r", a, a));
    expect(list).toHaveLength(1);
  });

  it("accepts --reason=<text> and any argument order", () => {
    const css = write("order/app.css", COLLISION);
    const result = run(css, "--reason=because", "--suppress-entries");
    expect(result.code).toBe(EXIT_OK);
    expect(entries(result)[0]?.reason).toBe("because");
  });

  it.each([
    ["no --reason", ["--suppress-entries", FIXTURE_PATH]],
    ["a blank --reason", ["--suppress-entries", "--reason", "  ", FIXTURE_PATH]],
    ["an empty --reason=", ["--suppress-entries", "--reason=", FIXTURE_PATH]],
    ["a trailing --reason", [FIXTURE_PATH, "--suppress-entries", "--reason"]],
    ["--reason swallowing a flag", ["--suppress-entries", "--reason", "--suppress-entries", FIXTURE_PATH]],
  ])("is a usage error (exit 2, nothing on stdout) with %s", (_name, args) => {
    const result = run(...args);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
    expect(result.stderr).toContain("--reason");
  });

  it("rejects --reason without --suppress-entries", () => {
    const result = run("--reason", "x", FIXTURE_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
  });

  it.each(["--json", "--github"])("cannot be combined with %s: exit 2, nothing on stdout", (flag) => {
    const result = run("--suppress-entries", "--reason", "r", flag, FIXTURE_PATH);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
    expect(result.stderr).toContain(`--suppress-entries cannot be combined with ${flag}`);
  });

  it("keeps the fail-fast exit 2 for a file that cannot be audited, printing no document", () => {
    const result = run("--suppress-entries", "--reason", "r", join(tmp, "missing.css"));
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
  });

  it("needs a stylesheet: the zero-positionals usage error", () => {
    const result = run("--suppress-entries", "--reason", "r");
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
  });

  it("is documented in --help and the README", () => {
    expect(HELP).toContain("--suppress-entries");
    expect(HELP).toContain("--reason");
    const readme = readFileSync(join(dirname(FIXTURE_PATH), "..", "..", "README.md"), "utf8");
    expect(readme).toContain("--suppress-entries");
  });
});
