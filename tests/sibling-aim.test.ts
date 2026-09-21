import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  audit,
  siblingAims,
  themelessAims,
  type ThemelessAim,
} from "../src/audit.js";
import {
  formatReport,
  formatReportJson,
  runCli,
  EXIT_FINDINGS,
  EXIT_OK,
  type CliIo,
} from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";

/**
 * THE FILE-SIBLING ARM of the `unmatched` section's advice — its OLDEST tell,
 * and the last of the section's SIX tellable cases to gain a `--json` key.
 *
 * Since 0.1.11 the section's fate line has vouched for the case: an entry
 * carrying a `[file: …]` clause names the stylesheet it was recorded against,
 * so its unmatchedness HERE is neither expiry nor mis-aim — it aims at that
 * sibling, and THAT file's report states its fate. The prose has always told
 * the reader this. The machine channel never did: a sibling-aiming entry and
 * a same-file dead entry produced `--json` rows carrying no verdict key at
 * all — `{file, fileResolved, reason, rule, …}` are the entry's own fields,
 * not a diagnosis — so a pipeline caller pruning stale judgements through the
 * README's own `themeguard --json … | jq …` pattern deletes live
 * sibling-aiming entries byte-identically to dead ones.
 *
 * The verdict is also NOT consumer-derivable from the row. The fate-line gate
 * compares the RESOLVED scope against the path-resolved audited stylesheet,
 * and both the config home and the audited sheet are the tool's own
 * discovery: a directive row carries no `fileResolved`, and the entry's
 * `file` is the caller's spelling. Three sibling tells each got a key with
 * exactly this rationale — `crossFileAim` (0.1.24), `themelessAim` (0.1.26),
 * `skippedAim` (0.1.29) — each landing with its own new tell, none
 * retrofitted onto the tells that predate the convention. This slice gives
 * the oldest one its key.
 *
 * ⚠️ DIAGNOSIS, NEVER SUPPRESSION. Every fence is a pin in here: the file
 * conjunct is untouched, the entry stays ON the `unmatched` leg, the counts
 * stay put and the exit code does not move — and the TEXT channel is
 * untouched too: the fate line is section-level prose that already prints,
 * and the row it describes gains nothing. The slice adds a KEY to a row that
 * was already printing.
 *
 * ⚠️ THE DECLINES ARE THE PROSE GATE'S OWN, in the same order: a
 * `fileBeyondConfigHome: true` annotation declines (the boundary arm speaks
 * for itself — no run of this config audits the file the scope names), and a
 * scope naming the AUDITED stylesheet declines (the fate line's advice is
 * circular there — "that file's report" is the report in the reader's hands).
 * What remains is exactly the population that vouches the fate line into
 * printing, so the key and the prose line can never disagree.
 *
 * ⚠️ DISJOINT FROM THE OTHER AIM KEYS, BY CONSTRUCTION. `themelessAims` and
 * `skippedAims` decline OTHER-file scopes — the population this arm earns on;
 * `crossFileAims` needs a directive, and a directive cannot carry a `file`
 * scope. One row can never carry `siblingAim` beside another aim key.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-sibling-aim-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, contents: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
  return path;
}

function config(dir: string, document: Record<string, unknown>): void {
  write(`${dir}/themeguard.config.json`, JSON.stringify(document));
}

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly stdout: string;
}

function run(...args: string[]): Run {
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: () => {} };
  const code = runCli(args, io);
  return { code, out, stdout: out.join("\n") };
}

/** The one `[unmatched]` row of a report, or `undefined` when there is none. */
function unmatchedRow(result: Run): string | undefined {
  return result.out.find((l) => l.startsWith("  [unmatched] "));
}

/** The fate line, quoted by its opening — the prose this key is the form of. */
const FATE_LINE =
  "an entry carrying a [file: …] clause names the stylesheet it was recorded against";

/** The boundary line — the arm that speaks for beyond-config-home scopes. */
const BOUNDARY_LINE =
  "an entry whose [file: …] clause resolves OUTSIDE this config's own directory";

/**
 * The audited sheet: clean, so the sibling-aiming entry is unmatched for the
 * FILE's sake — nothing about its identity is near a finding here.
 */
const CLEAN = [":root {", "  --own: #101010;", "}", ".x { color: var(--own); }"].join("\n");

/** The sibling stylesheet the config also governs. */
const SIBLING = ":root { --sib: #202020; }\n.s { color: var(--sib); }\n";

describe("the file-sibling arm — an entry whose [file: …] scope names a sibling this config governs", () => {
  it("keeps the row byte-identical — the diagnosis is a --json key, never prose", () => {
    // The zero-text-channel fence, pinned as a whole-line equality: the row
    // prints exactly what it printed before this slice existed. The fate line
    // is section-level prose that already carried the case; the row gains no
    // clause, because the row's `[file: …]` spelling IS its prose pointer.
    const entry = write("text/a.css", CLEAN);
    write("text/sibling.css", SIBLING);
    config("text", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "sibling.css",
          reason: "recorded against the sibling",
        },
      ],
    });
    const result = run(entry);

    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "recorded against the sibling"' +
        " [token: --long-gone] [file: sibling.css]",
    );
    // The prose line the key is the machine form of — still printing, beside
    // a row it now has a data channel for.
    expect(result.stdout).toContain(FATE_LINE);
  });

  it("a clean sheet with a sibling-aiming entry still exits 0 — the section is outside the exit", () => {
    const entry = write("exit/a.css", CLEAN);
    write("exit/sibling.css", SIBLING);
    config("exit", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "sibling.css",
          reason: "recorded against the sibling",
        },
      ],
    });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain("No findings.");
  });

  it("the matching semantics are untouched — the sibling-aiming entry suppresses nothing", () => {
    // Asked of the library directly: the file conjunct is the one standing
    // between this entry and a suppression, and this slice must not move it.
    const sheet = write("fence/a.css", CLEAN);
    const resolved = resolveStylesheet(loadStylesheet(sheet));
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "dead-token" as const,
          token: "--long-gone",
          file: "sibling.css",
          reason: "recorded against the sibling",
        },
      ],
      stylesheet: sheet,
    });
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.countsByRule["dead-token"]).toBe(0);
  });
});

describe("--json carries the same fate as data", () => {
  it("adds `siblingAim` to the unmatched row, and to no other row", () => {
    const entry = write("json/a.css", CLEAN);
    const sibling = write("json/sibling.css", SIBLING);
    config("json", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "sibling.css",
          reason: "recorded against the sibling",
        },
      ],
    });
    const result = run("--json", entry);
    expect(result.code).toBe(EXIT_OK);
    const report = JSON.parse(result.out[0] as string) as {
      findings: unknown[];
      skipped: unknown[];
      unmatchedSuppressions: Record<string, unknown>[];
    };
    // The key order of the OBJECT is a compatibility surface and the additive
    // field must not move it: `unmatchedSuppressions` keeps its slot.
    expect(Object.keys(report)).toEqual([
      "path",
      "findings",
      "countsByRule",
      "suppressed",
      "unmatchedSuppressions",
      "suppressedDisabled",
      "skipped",
      "skippedDisabled",
      "coverage",
    ]);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    // Every existing key is untouched, and the diagnosis rides beside them.
    expect(row).toMatchObject({
      rule: "dead-token",
      token: "--long-gone",
      file: "sibling.css",
      reason: "recorded against the sibling",
    });
    // The aim carries the scope AS READ — `fileResolved` once the CLI has
    // resolved one — the file whose own report states this judgement's fate.
    expect(row.siblingAim).toEqual({ file: sibling });
    // The sibling machine keys are not minted by this arm.
    expect("crossFileAim" in row).toBe(false);
    expect("themelessAim" in row).toBe(false);
    expect("skippedAim" in row).toBe(false);
  });

  it("OMITS the key on a row that names this very sheet rather than emitting null", () => {
    // The same absence-is-a-fact discipline `sites`, `crossFileAim`,
    // `themelessAim` and `skippedAim` carry: the fate line's advice is
    // circular for a same-file entry, so no diagnosis exists to give, and
    // `null` would invent one.
    const entry = write("json-self/a.css", CLEAN);
    config("json-self", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "a.css",
          reason: "recorded against this sheet",
        },
      ],
    });
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    expect(row.file).toBe("a.css");
    expect("siblingAim" in row).toBe(false);
  });

  it("carries the key on the boundary fixture's rows NOT AT ALL — the boundary arm speaks there", () => {
    // A scope resolving outside the config's governed subtree is the OTHER
    // fate line's population ("re-aim the entry inside the config's
    // directory, or retire it"), and the section prints that one beside the
    // carve-out. A `siblingAim` here would name a file no run of this config
    // can ever audit — a pointer the prose explicitly refuses to give.
    const entry = write("json-boundary/a.css", CLEAN);
    config("json-boundary", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "../outside.css",
          reason: "beyond the config's reach",
        },
      ],
    });
    // The prose run first: the boundary line is the section's word for this
    // entry, and the fate line — the line this key is the form of — stays
    // silent whole.
    const prose = run(entry);
    expect(prose.code).toBe(EXIT_OK);
    expect(prose.stdout).toContain(BOUNDARY_LINE);
    expect(prose.stdout).not.toContain(FATE_LINE);
    const result = run("--json", entry);
    expect(result.code).toBe(EXIT_OK);
    const report = JSON.parse(result.out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    // The annotation is ON the row — it is how the boundary arm is readable
    // at all — and the sibling key is not beside it.
    expect(row.fileBeyondConfigHome).toBe(true);
    expect("siblingAim" in row).toBe(false);
  });

  it("a MIXED section earns on the sibling row alone", () => {
    // The gate narrows per ENTRY, never whole-section: the sibling-scoped row
    // carries the key, the same-file row beside it carries none.
    const entry = write("mixed/a.css", CLEAN);
    write("mixed/sibling.css", SIBLING);
    config("mixed", {
      suppress: [
        {
          rule: "dead-token",
          token: "--long-gone",
          file: "sibling.css",
          reason: "the sibling's token",
        },
        {
          rule: "dead-token",
          token: "--also-gone",
          file: "a.css",
          reason: "this sheet's token",
        },
      ],
    });
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(2);
    const siblingRow = report.unmatchedSuppressions[0] as Record<string, unknown>;
    const selfRow = report.unmatchedSuppressions[1] as Record<string, unknown>;
    expect(siblingRow.file).toBe("sibling.css");
    expect("siblingAim" in siblingRow).toBe(true);
    expect(selfRow.file).toBe("a.css");
    expect("siblingAim" in selfRow).toBe(false);
  });

  it("directive rows never earn — directives cannot carry file scopes", () => {
    // The SITE is a directive's judgement, and the `file` scope is not in its
    // schema, so the fate line has never spoken for one and neither does the
    // key. The directive below is the SAME-FILE-WRONG-LINE miss: its own file
    // holds the finding's sites, at lines it does not cover — a miss whose
    // existing advice is closer to true, and which no arm here touches.
    const entry = write(
      "json-directive/a.css",
      [
        ":root {",
        "  --accent: #22C55E;",
        "  --success: #22C55E;",
        "}",
        "",
        "/* themeguard-ignore collision --accent --success -- wrong line, same file */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run("--json", entry);
    expect(result.code).toBe(EXIT_FINDINGS); // the collision prints, live
    const report = JSON.parse(result.out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    expect(row.line).toBe(6);
    expect("siblingAim" in row).toBe(false);
    expect("crossFileAim" in row).toBe(false);
  });
});

describe("the renderers are byte-identical without the diagnosis — the argument is additive", () => {
  it("both renderers omit the diagnosis entirely when a caller passes none", () => {
    // A library caller holding only a report must get exactly the report it
    // got before the diagnosis existed, on both channels.
    const entry = write("additive/a.css", CLEAN);
    write("additive/sibling.css", SIBLING);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const suppressions = [
      {
        rule: "dead-token" as const,
        token: "--long-gone",
        file: "sibling.css",
        reason: "recorded against the sibling",
      },
    ];
    const report = audit(resolved, { suppressions });
    expect(report.unmatchedSuppressions).toHaveLength(1);

    const bare = formatReport(entry, report);
    expect(bare.find((l) => l.startsWith("  [unmatched] "))).toBe(
      '  [unmatched] [dead-token] — "recorded against the sibling"' +
        " [token: --long-gone] [file: sibling.css]",
    );
    expect(JSON.parse(formatReportJson(entry, report))).toEqual({ path: entry, ...report });

    // Handed the diagnosis, the SAME report renders the key — so the argument
    // is what the CLI supplies, never a second derivation inside the renderer.
    const siblings = siblingAims(report.unmatchedSuppressions, entry);
    expect(
      (
        JSON.parse(formatReportJson(entry, report, [], [], [], siblings)) as {
          unmatchedSuppressions: Record<string, unknown>[];
        }
      ).unmatchedSuppressions[0],
    ).toMatchObject({ siblingAim: { file: "sibling.css" } });
  });
});

describe("the derivation reads the prose gate's own population", () => {
  const earned = { file: "sibling.css" };
  const scoped = {
    rule: "dead-token" as const,
    token: "--long-gone",
    file: "sibling.css",
    reason: "sibling only",
  };

  it("reads the scope exactly as `matches` does, and the aim carries the scope as read", () => {
    // The written spelling is compared as the caller handed it — the entry's
    // own ledger quoted back; the resolved spelling is what the CLI supplies
    // beside the clause it resolved (the seam only annotates entries that
    // carry a `file`, and the gate requires the clause to exist — an entry
    // with a resolution and no spelling is not a shape the CLI produces, and
    // it declines like the gate does).
    expect(siblingAims([scoped], "/proj/a.css")).toEqual([earned]);
    const resolvedSpelling = { ...scoped, fileResolved: "/proj/sibling.css" };
    expect(siblingAims([resolvedSpelling], "/proj/a.css")).toEqual([
      { file: "/proj/sibling.css" },
    ]);
  });

  it("a scope naming the AUDITED stylesheet declines — the fate line's advice is circular there", () => {
    const selfResolved = { ...scoped, fileResolved: "/proj/a.css" };
    expect(siblingAims([selfResolved], "/proj/a.css")).toEqual([undefined]);
    // The written spelling compared as handed: equal when the caller says so.
    expect(siblingAims([scoped], "sibling.css")).toEqual([undefined]);
  });

  it("WITHOUT the parameter the population is the fate line's own — every scoped, non-boundary entry", () => {
    // The parameter is the `options.stylesheet` precedent (0.1.30), and the
    // omission reads the prose gate's own terms: a caller that cannot name
    // the audited sheet cannot resolve the same-file comparison, so the gate
    // keeps the carve-out for every scoped entry — and the key must agree
    // with the line it is the form of, byte-for-byte, in the same state.
    expect(siblingAims([scoped])).toEqual([earned]);
    expect(siblingAims([scoped], undefined)).toEqual([earned]);
    // The boundary arm keeps speaking for itself at both arities: the
    // annotation is a fact about the config's reach, not about this sheet.
    const beyond = { ...scoped, fileResolved: "/elsewhere/sibling.css", fileBeyondConfigHome: true as const };
    expect(siblingAims([beyond])).toEqual([undefined]);
    expect(siblingAims([beyond], "/proj/a.css")).toEqual([undefined]);
  });

  it("an entry with no file scope, and a directive, never earn", () => {
    // A directive's judgement is its SITE — the `file` scope is not in its
    // schema — and an unscoped config entry has no file to name; both keep
    // whatever other advice holds for them.
    expect(siblingAims([{ rule: "dead-token" as const, token: "--x", reason: "r" }])).toEqual([
      undefined,
    ]);
    expect(
      siblingAims([{ rule: "collision" as const, line: 2, reason: "r" } as never]),
    ).toEqual([undefined]);
  });

  it("siblingAims aligns BY INDEX, so two identical judgements are two answers", () => {
    // The leg reports SLOTS — two structurally identical sibling-aiming
    // entries are two ledger lines — so a keyed lookup would fold them.
    const sheet = resolveCss(CLEAN);
    const report = audit(sheet, {
      suppressions: [scoped, { ...scoped, reason: "the same aim, twice" }],
      stylesheet: "/proj/a.css",
    });
    expect(report.unmatchedSuppressions).toHaveLength(2);
    expect(siblingAims(report.unmatchedSuppressions, "/proj/a.css")).toEqual([earned, earned]);
  });

  it("is disjoint from the other aim keys BY CONSTRUCTION — the two file gates are mirror images", () => {
    // `themelessAims` declines exactly the population this arm earns on (the
    // other-file scope), and earns exactly the population this arm declines
    // (no scope, or the audited sheet itself). Both asked of the same report:
    // no entry can carry both keys.
    const sheet = resolveCss([
      ":root {",
      "  --unused: #101010;", // dead — theme null by construction
      "}",
    ].join("\n"));
    const report = audit(sheet);
    const kept = report.findings;
    expect(kept).toHaveLength(1);

    const siblingEntry = {
      rule: "dead-token" as const,
      token: "--unused",
      file: "sibling.css",
      reason: "the sibling's token",
    };
    expect(siblingAims([siblingEntry], "/proj/a.css")).toEqual([earned]);
    expect(themelessAims([siblingEntry], kept, "/proj/a.css")).toEqual([undefined]);

    const selfEntry = {
      rule: "dead-token" as const,
      theme: "root",
      token: "--unused",
      fileResolved: "/proj/a.css",
      reason: "this sheet's token",
    };
    expect(siblingAims([selfEntry], "/proj/a.css")).toEqual([undefined]);
    expect(themelessAims([selfEntry], kept, "/proj/a.css")).toEqual([
      { rule: "dead-token" } satisfies ThemelessAim,
    ]);
  });
});
