import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import type { SuppressionEntry } from "../src/config.js";
import { resolveCss } from "../src/resolve.js";

/**
 * File-scoped suppression entries — the `file` field on a config entry, the
 * stylesheet a judgement was recorded against.
 *
 * The gap this closes is the shared-config directory: one
 * `themeguard.config.json` governing sibling stylesheets, where an entry
 * written for `tokens.css`'s brand collision used to govern `buttons.css`
 * too — suppressing questions it never judged, and reading as `unmatched`
 * (advise-retirement) on the very reports its sibling findings print in.
 * Since `file` exists the doctrine in the CLI header — "a suppression is
 * worth exactly the file it was recorded against" — is true by DECLARATION.
 *
 * Three layers, tested at the layer that owns the behaviour:
 *
 *   - `audit` owns the conjunct: an entry carrying a file scope matches only
 *     when its resolved scope equals `options.stylesheet`, the audited ENTRY
 *     stylesheet; an entry without one matches everything, which is today's
 *     semantics byte for byte.
 *   - the CLI owns the resolution: `file` is relative to the config's own
 *     directory and is resolved there before matching, and the report's
 *     clause prints the spelling AS WRITTEN.
 *   - the fixtures under `tests/fixtures/styles/` own the flagship shape:
 *     one shared config, one suppressed file, one sibling that reports with
 *     the entry named as aimed-elsewhere.
 */
const repo = fileURLToPath(new URL("..", import.meta.url));

/** The shared-config pair, IN-REPO (see tests/fixtures/README.md, `styles/`). */
const STYLES_DIR = fileURLToPath(new URL("./fixtures/styles/", import.meta.url));
const TOKENS_CSS = join(STYLES_DIR, "tokens.css");
const BUTTONS_CSS = join(STYLES_DIR, "buttons.css");

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
 * The report slice for ONE file of a multi-file invocation: everything the
 * file's own header opened, up to the next header (or the end).
 */
function reportFor(out: readonly string[], header: string, nextHeader: string): string[] {
  const start = out.indexOf(header);
  const end = nextHeader === "" ? out.length : out.indexOf(nextHeader);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return out.slice(start, end);
}

/** The library-grain sheet: one collision, one dead token — same shape `unmatched.test.ts` pins. */
const SHEET_CSS = `:root {
  --accent: #16A34A;
  --success: #16A34A;
  --unused: #123456;
}

.a { color: var(--accent); }
.b { color: var(--success); }
`;

describe("audit — the file-scope conjunct", () => {
  const resolved = resolveCss(SHEET_CSS);
  const ENTRY: SuppressionEntry = {
    rule: "collision",
    tokens: ["--accent", "--success"],
    file: "/proj/styles/tokens.css",
    reason: "brand equality, this file only",
  };

  it("a file-scoped entry suppresses the stylesheet it names — the resolved scope equals the audited stylesheet", () => {
    const report = audit(resolved, {
      suppressions: [ENTRY],
      stylesheet: "/proj/styles/tokens.css",
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.reason).toBe("brand equality, this file only");
    expect(report.unmatchedSuppressions).toEqual([]);
  });

  it("a file-scoped entry does NOT suppress a different stylesheet — the finding prints, the entry is unmatched, naming where it aims", () => {
    const report = audit(resolved, {
      suppressions: [ENTRY],
      stylesheet: "/proj/styles/buttons.css",
    });
    expect(report.findings).toHaveLength(2);
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toEqual([ENTRY]);
  });

  it("an entry without a file scope matches regardless of the audited stylesheet — today's semantics, pinned", () => {
    const unscoped: SuppressionEntry = {
      rule: "collision",
      tokens: ["--accent", "--success"],
      reason: "brand equality, every file this config governs",
    };
    for (const stylesheet of [undefined, "/proj/styles/tokens.css", "/proj/styles/buttons.css"]) {
      const report = audit(resolved, {
        suppressions: [unscoped],
        ...(stylesheet !== undefined ? { stylesheet } : {}),
      });
      expect(report.suppressed).toHaveLength(1);
      expect(report.unmatchedSuppressions).toEqual([]);
    }
  });

  it("a file-scoped entry with NO stylesheet declared matches nothing — an entry cannot claim a file the audit was never told about", () => {
    const report = audit(resolved, { suppressions: [ENTRY] });
    expect(report.suppressed).toHaveLength(0);
    expect(report.findings).toHaveLength(2);
    // The no-match is honest and visible: the leg carries the entry whole,
    // scope intact, so the reader can see the claim no report covered.
    expect(report.unmatchedSuppressions).toEqual([ENTRY]);
  });

  it("keeps the entry's spelling on the carried leg — matching compared the scope the caller handed it", () => {
    // A library caller hands the scope it wants compared; there is no
    // resolution at this grain. Same spelling in, same spelling out — the
    // `file` field rides along untouched for whoever renders the entry.
    const report = audit(resolved, {
      suppressions: [{ ...ENTRY, file: "./tokens.css" }],
      stylesheet: "./tokens.css",
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.entry.file).toBe("./tokens.css");
  });
});

describe("the shared-config pair — tests/fixtures/styles, one ledger, two stylesheets", () => {
  it("the flagship invocation: tokens.css suppressed WITH its clause, buttons.css reporting with the entry named as aimed elsewhere", () => {
    const result = run(TOKENS_CSS, BUTTONS_CSS);
    // tokens.css's finding is suppressed; buttons.css's is not — the
    // aggregate is 1, exactly the file that still carries its defect.
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stderr).toBe("");

    const tokensReport = reportFor(result.out, `themeguard — ${TOKENS_CSS}`, `themeguard — ${BUTTONS_CSS}`);
    expect(tokensReport).toContain("collision (0)");
    expect(tokensReport).toContain("suppressed (1)");
    expect(tokensReport).toContain(
      `  [suppressed] [collision] --accent and --primary both resolve to #16A34A in theme "root". They are separate roles, and no other theme declares them apart, so nothing here shows the equality is intended. Declared at lines 12 and 13. — "brand tokens are identical by design" [tokens: --accent, --primary] [file: tokens.css]`,
    );
    expect(tokensReport).toContain("unmatched (0)");
    expect(tokensReport).toContain(
      "  nothing unmatched — every recorded judgement still covers a finding this report carries.",
    );
    expect(tokensReport).toContain("No findings.");

    const buttonsReport = reportFor(result.out, `themeguard — ${BUTTONS_CSS}`, "");
    expect(buttonsReport).toContain("unresolved-reference (1)");
    expect(buttonsReport).toContain("suppressed (0)");
    expect(buttonsReport).toContain("unmatched (1)");
    // The generic prose still prints — it is true of every entry WITHOUT a
    // clause — and the carve-out beside it resolves the dichotomy for the
    // clause-carrying one: no retirement advice applies to it here.
    expect(buttonsReport).toContain(
      "  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.",
    );
    expect(buttonsReport).toContain(
      "  an entry carrying a [file: …] clause names the stylesheet it was recorded against — for it, this report can tell: the judgement aims at that file, which this config governs too, and it neither expired here nor mis-aimed here. That file's report is the one that states its fate.",
    );
    expect(buttonsReport).toContain(
      `  [unmatched] [collision] — "brand tokens are identical by design" [tokens: --accent, --primary] [file: tokens.css]`,
    );
  });

  it("audits the sibling ALONE the same way — the config governs each file independently of the invocation", () => {
    const result = run(BUTTONS_CSS);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain(
      `  [unmatched] [collision] — "brand tokens are identical by design" [tokens: --accent, --primary] [file: tokens.css]`,
    );
    expect(result.stdout).toContain(
      "  an entry carrying a [file: …] clause names the stylesheet it was recorded against",
    );
  });

  it("names each file's fate in ORDER — the suppressed file first, the reporting file second", () => {
    const result = run(TOKENS_CSS, BUTTONS_CSS);
    const tokensHeader = result.out.indexOf(`themeguard — ${TOKENS_CSS}`);
    const buttonsHeader = result.out.indexOf(`themeguard — ${BUTTONS_CSS}`);
    expect(tokensHeader).toBeGreaterThan(-1);
    expect(buttonsHeader).toBeGreaterThan(tokensHeader);
  });
});

/*
 * ── tmp fixtures: the scoping pair, coexistence, and the unscoped control ──
 * Same shape as cli.test.ts: a directory per scenario, a config beside the
 * stylesheets, runCli driven in-process so the report is read as data.
 */
const tmp = mkdtempSync(join(tmpdir(), "themeguard-file-scoped-"));

function scenario(
  name: string,
  config: readonly SuppressionEntry[],
  files: Readonly<Record<string, string>>,
): string[] {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const paths = Object.entries(files).map(([filename, css]) => {
    const path = join(dir, filename);
    writeFileSync(path, css, "utf8");
    return path;
  });
  writeFileSync(
    join(dir, "themeguard.config.json"),
    JSON.stringify({ suppress: config }),
    "utf8",
  );
  return paths;
}

/** One deliberate brand collision, self-contained. */
const BRAND_CSS = `
:root {
  --accent: #16A34A;
  --primary: #16A34A;
}

.a { color: var(--accent); }
.b { color: var(--primary); }
`;

/** One dead token, self-contained: declared, referenced by no var(). */
const DEAD_CSS = `
:root {
  --unused: #123456;
}

.x { color: var(--other); }
:root { --other: #345678; }
`;

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("a file-scoped entry moves the exit only for its own file", () => {
  const [a, b] = scenario(
    "own-file-only",
    [{ rule: "collision", tokens: ["--accent", "--primary"], file: "b.css", reason: "deliberate, but only on b" }],
    { "a.css": BRAND_CSS, "b.css": BRAND_CSS },
  );

  it("the same finding reports on a.css and is suppressed on b.css — aggregate exit 1", () => {
    const result = run(a, b);
    expect(result.code).toBe(EXIT_FINDINGS);
    const aReport = reportFor(result.out, `themeguard — ${a}`, `themeguard — ${b}`);
    const bReport = reportFor(result.out, `themeguard — ${b}`, "");
    expect(aReport).toContain("collision (1)");
    expect(aReport).toContain("suppressed (0)");
    expect(aReport).toContain("unmatched (1)");
    // a.css's report names the entry as aimed elsewhere — the clause is what
    // stops the sibling from reading the entry as retireable.
    expect(aReport).toContain(
      `  [unmatched] [collision] — "deliberate, but only on b" [tokens: --accent, --primary] [file: b.css]`,
    );
    expect(aReport.join("\n")).toContain(
      "  an entry carrying a [file: …] clause names the stylesheet it was recorded against",
    );
    expect(bReport).toContain("collision (0)");
    expect(bReport).toContain("suppressed (1)");
    expect(bReport).toContain(
      `  [suppressed] [collision] --accent and --primary both resolve to #16A34A in theme "root". They are separate roles, and no other theme declares them apart, so nothing here shows the equality is intended. Declared at lines 3 and 4. — "deliberate, but only on b" [tokens: --accent, --primary] [file: b.css]`,
    );
    expect(bReport).toContain("No findings.");
  });
});

describe("a directive and a file-scoped config entry coexist on one stylesheet", () => {
  const [sheet] = scenario(
    "coexistence",
    [{ rule: "collision", tokens: ["--accent", "--primary"], file: "sheet.css", reason: "brand equality" }],
    {
      "sheet.css": `:root {
  --accent: #16A34A;
  --primary: #16A34A;
  /* themeguard-ignore dead-token -- kept for the upcoming print sheet */
  --unused: #123456;
}

.a { color: var(--accent); }
.b { color: var(--primary); }
`,
    },
  );

  it("both judgements suppress their own finding, each clause naming its own kind of scope", () => {
    const result = run(sheet);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("dead-token (0)");
    expect(result.stdout).toContain("suppressed (2)");
    expect(result.stdout).toContain(
      `— "brand equality" [tokens: --accent, --primary] [file: sheet.css]`,
    );
    expect(result.stdout).toContain(
      `— "kept for the upcoming print sheet" [${sheet}:4]`,
    );
    expect(result.stdout).toContain("unmatched (0)");
  });
});

describe("an unscoped config in a shared directory keeps 0.1.7's whole-config reading", () => {
  const [a, b] = scenario(
    "unscoped-control",
    [{ rule: "dead-token", token: "--unused", reason: "reserved in every sibling" }],
    { "a.css": DEAD_CSS, "b.css": DEAD_CSS },
  );

  it("the entry suppresses BOTH files' findings, clause-free — byte-identical lines, aggregate exit 0", () => {
    const result = run(a, b);
    expect(result.code).toBe(EXIT_OK);
    const aReport = reportFor(result.out, `themeguard — ${a}`, `themeguard — ${b}`);
    const bReport = reportFor(result.out, `themeguard — ${b}`, "");
    for (const report of [aReport, bReport]) {
      expect(report).toContain("dead-token (0)");
      expect(report).toContain("suppressed (1)");
      expect(report.join("\n")).toContain(`— "reserved in every sibling"`);
      expect(report.join("\n")).not.toContain("[file:");
      expect(report).toContain("unmatched (0)");
    }
  });
});

describe("a malformed file scope is the config's own contract at the CLI", () => {
  it("an ABSOLUTE file exits 2 naming the entry, printing no report", () => {
    const [sheet] = scenario(
      "cli-absolute",
      [{ rule: "dead-token", token: "--unused", file: "/proj/a.css", reason: "aimed absolutely" }],
      { "a.css": DEAD_CSS },
    );
    const result = run(sheet);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("invalid themeguard.config.json");
    expect(result.stderr).toContain('entry 1 of "suppress": "file" must be a path relative');
    expect(result.out).toEqual([]);
  });

  it("an EMPTY file exits 2 naming the entry — a scope naming nothing would silently match everything", () => {
    const [sheet] = scenario(
      "cli-empty-file",
      [{ rule: "dead-token", token: "--unused", file: "", reason: "names nothing" }],
      { "a.css": DEAD_CSS },
    );
    const result = run(sheet);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain('entry 1 of "suppress": "file" must be a non-empty string');
    expect(result.out).toEqual([]);
  });
});
