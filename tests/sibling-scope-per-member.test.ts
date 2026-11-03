import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";

// siblingScopeClause (src/cli.ts) has two shapes. When both members live in the
// SAME themes it reads as one fact ("the pair is declared only in ..."); in every
// other shape it names each member with its own themes and lines, joined by
// joinAnd. The existing skip-reason tests only reach the shared shape with ONE theme.
const tmp = mkdtempSync(join(tmpdir(), "themeguard-sibling-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function skippedLines(name: string, css: string): string[] {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: () => {} };
  runCli([path], io);
  return out
    .join("\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("[skipped]"));
}

describe("siblingScopeClause — the per-member form", () => {
  it("names each member with its own theme and line when the members live in different themes", () => {
    const css = `:root {
  --page: #ffffff;
}
[data-theme="winter"] {
  --card-bg: #f1f5f9;
}
[data-theme="sepia"] {
  --card-bg-hover: #f4ecd8;
}
`;
    const lines = skippedLines("a.css", css);
    expect(lines).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "root": absent — ' +
        '--card-bg is declared only in theme "winter" at line 5 and ' +
        '--card-bg-hover is declared only in theme "sepia" at line 8',
    );
    // One member resolves in the audited theme; the other lives in a single
    // sibling theme. That is ONE scope entry, so it must read per-member, not
    // as "the pair".
    expect(lines).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "winter": absent — ' +
        '--card-bg-hover is declared only in theme "sepia" at line 8',
    );
    expect(lines).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "sepia": absent — ' +
        '--card-bg is declared only in theme "winter" at line 5',
    );
  });

  it("joins three themes with commas and a final 'and' when the pair is declared in the same three themes", () => {
    const css = `:root {
  --page: #ffffff;
}
[data-theme="winter"] {
  --card-bg: #f1f5f9;
  --card-bg-hover: #e2e8f0;
}
[data-theme="sepia"] {
  --card-bg: #f4ecd8;
  --card-bg-hover: #e8dcc0;
}
[data-theme="autumn"] {
  --card-bg: #f5e6d3;
  --card-bg-hover: #e9d3b8;
}
`;
    const lines = skippedLines("b.css", css);
    expect(lines).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "root": absent — ' +
        'the pair is declared only in themes "winter", "sepia" and "autumn" ' +
        "(--card-bg at lines 5, 9 and 13, --card-bg-hover at lines 6, 10 and 14)",
    );
  });
});
