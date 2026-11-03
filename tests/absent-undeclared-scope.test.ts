import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { runCli, type CliIo } from "../src/cli.js";
import { resolveCss } from "../src/resolve.js";
import { scaleCollapseRule, type SkippedPair } from "../src/rules/scale-collapse.js";

// An ABSENT skipped pair whose members are declared only where no theme view
// can reach them (here a `.card` block — a scope that is neither :root nor a
// theme) has no sibling theme to name. The rule says nothing rather than naming
// a wrong scope: the row carries NO `declaredIn` key at all (absence is a
// fact, never an empty array), and the text report adds no scope clause.
const CSS = `.card {
  --k: #ffffff;
  --k-hover: #eeeeee;
}
:root {
  --z: 1px;
}
[data-theme="dark"] {
  --z: 2px;
}
`;

const tmp = mkdtempSync(join(tmpdir(), "themeguard-absent-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("absent pair declared only outside every theme view", () => {
  it("is skipped as absent once per theme, with no declaredIn key", () => {
    const { skipped, findings } = scaleCollapseRule(resolveCss(CSS));
    expect(findings).toEqual([]);
    // toStrictEqual is load-bearing: toEqual treats `declaredIn: undefined`
    // as equal to a missing key, and toStrictEqual also catches that.
    expect(skipped).toStrictEqual([
      { theme: "root", base: "--k", state: "--k-hover", reason: "absent" },
      { theme: "dark", base: "--k", state: "--k-hover", reason: "absent" },
    ]);
  });

  it("is the same when only the STATE is missing (the base resolves in :root)", () => {
    const css = `.card {\n  --m-hover: #eeeeee;\n}\n:root {\n  --m: #ffffff;\n}\n`;
    expect(scaleCollapseRule(resolveCss(css)).skipped).toStrictEqual([
      { theme: "root", base: "--m", state: "--m-hover", reason: "absent" },
    ]);
  });

  it("is the same when only the BASE is missing (the state resolves in :root)", () => {
    const css = `.card {\n  --n: #ffffff;\n}\n:root {\n  --n-hover: #eeeeee;\n}\n`;
    expect(scaleCollapseRule(resolveCss(css)).skipped).toStrictEqual([
      { theme: "root", base: "--n", state: "--n-hover", reason: "absent" },
    ]);
  });

  it("round-trips through JSON with the key still absent", () => {
    const rows = JSON.parse(JSON.stringify(audit(resolveCss(CSS)).skipped)) as SkippedPair[];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.reason).toBe("absent");
      expect("declaredIn" in row).toBe(false);
    }
  });

  it("prints the skipped line with no 'declared only in' clause", () => {
    const path = join(tmp, "card.css");
    writeFileSync(path, CSS, "utf8");
    const out: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: () => {} };
    runCli([path], io);
    // Trimmed because the report indents the skipped line two spaces.
    const lines = out
      .join("\n")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("[skipped]"));
    expect(lines).toEqual([
      '[skipped] --k-hover against --k in theme "root": absent',
      '[skipped] --k-hover against --k in theme "dark": absent',
    ]);
  });
});
