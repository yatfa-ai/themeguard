import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit, crossFileAims } from "../src/audit.js";
import { runCli, EXIT_FINDINGS, type CliIo } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet } from "../src/resolve.js";

const tmp = mkdtempSync(join(tmpdir(), "themeguard-aim-first-match-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, css: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, css, "utf8");
  return path;
}

const TOKENS = [":root {", "  --alpha: #111111;", "  --beta: #222222;", "}"].join("\n");

function entryFile(dir: string): string {
  write(`${dir}/tokens.css`, TOKENS);
  return write(
    `${dir}/main.css`,
    [
      '@import "./tokens.css";',
      ".a { color: red; } /* themeguard-ignore dead-token -- deliberate: public surface */",
    ].join("\n"),
  );
}

describe("crossFileAims — two live identity-matches, no own-file site", () => {
  it("the printed row points at the FIRST dead token's declaration, not the last", () => {
    const entry = entryFile("cli");
    const out: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: () => {} };
    const code = runCli([entry], io);
    const stdout = out.join("\n");
    expect(code).toBe(EXIT_FINDINGS);
    expect(stdout).toContain("dead-token (2)");
    expect(stdout).toContain("--alpha is declared at tokens.css:2");
    expect(stdout).toContain("--beta is declared at tokens.css:3");
    expect(stdout).toContain("unmatched (1)");
    const row = out.find((l) => l.startsWith("  [unmatched] "));
    expect(row).toBeDefined();
    expect(row).toContain("matches a live [dead-token] finding at tokens.css:2;");
    expect(row).not.toContain("tokens.css:3");
  });

  it("is first in the FINDINGS' order — reversing them moves the aim to the other site", () => {
    const entry = entryFile("order");
    const sheet = loadStylesheet(entry);
    const resolved = resolveStylesheet(sheet);
    const report = audit(resolved, { suppressions: sheet.directives ?? [] });
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.findings.filter((f) => f.rule === "dead-token")).toHaveLength(2);
    const forward = crossFileAims(report.unmatchedSuppressions, report.findings, resolved);
    expect(forward).toEqual([{ rule: "dead-token", site: "tokens.css:2" }]);
    const backward = crossFileAims(
      report.unmatchedSuppressions,
      [...report.findings].reverse(),
      resolved,
    );
    expect(backward).toEqual([{ rule: "dead-token", site: "tokens.css:3" }]);
  });
});
