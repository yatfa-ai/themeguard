import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  audit,
  crossFileAims,
  closureOrigins,
  findingLinesIn,
  findingSiteCoordinates,
  matchesEntryIdentity,
  siteLineCovers,
} from "../src/audit.js";
import { formatReport, formatReportJson, runCli, EXIT_FINDINGS, EXIT_OK, type CliIo } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet } from "../src/resolve.js";

/**
 * The CROSS-FILE arm of the `unmatched` section's advice (0.1.24).
 *
 * The section offers a reader two readings — "the defect was fixed and the
 * judgement can be retired" / "the entry never aimed at a finding that exists"
 * — and for ONE shape both are false in the natural sense: an entry-file
 * `themeguard-ignore` directive whose rule and tokens match a collision living
 * in an imported closure file. The defect is NOT fixed (the finding prints in
 * the same report, above) and the entry DID aim at a finding that exists, one
 * `@import` edge away. A reader following the advice retires a judgement that
 * is ONE FILE MOVE from working, with nothing saying where it would work.
 *
 * That is the same false-retirement harm class the every-match booking deleted
 * for the overlap arm (`98431c7`, pinned at `tests/unmatched.test.ts`) — a
 * DIFFERENT arm of the same section, and one no landed test constructed: the
 * overlap pins are config×config and config+directive, and neither builds an
 * entry-file directive against an imported finding.
 *
 * ⚠️ DIAGNOSIS, NEVER SUPPRESSION. Every fence is a pin in here: a directive
 * still governs only the file it is written in, the site conjunct is untouched,
 * the entry stays ON the `unmatched` leg, the counts stay put and the exit code
 * does not move. The slice adds a POINTER to a row that was already printing.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-cross-file-aim-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, css: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, css, "utf8");
  return path;
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

/** The imported member of the ticket's probe: one collision, two lines. */
const TOKENS = [":root {", "  --accent: #22C55E;", "  --success: #22C55E;", "}"].join("\n");

/** The suffix a cross-file aim earns, whole — asserted as bytes, never a regex. */
const AIM_SUFFIX =
  " — matches a live [collision] finding at tokens.css:2; a directive governs only the file it is" +
  " written in — move it there, or record it in themeguard.config.json to cover the whole closure.";

describe("the cross-file arm — an entry-file directive aimed at an imported finding", () => {
  it("names the file:line the misfiled judgement would govern, on a row that still reports unmatched", () => {
    write("probe/tokens.css", TOKENS);
    // The directive's line 4 covers lines 4–5 of ITS OWN file; the collision's
    // two sites live at lines 2 and 3 of tokens.css. `findingLinesIn` for origin
    // `undefined` is therefore EMPTY — the FILE, not the line, is the whole
    // reason nothing matched, which is exactly the arm this suffix claims.
    const entry = write(
      "probe/main.css",
      [
        '@import "./tokens.css";',
        "",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }" +
          " /* themeguard-ignore collision --accent --success -- deliberate: brand tracks success */",
      ].join("\n"),
    );
    const result = run(entry);

    // The FENCE first, because the suffix must never read as a suppression:
    // the finding prints, nothing is suppressed, the entry is still unmatched
    // and the exit code still moves.
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("Declared at tokens.css:2 and tokens.css:3.");
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");

    // And the row now says WHERE the judgement would work — the whole line,
    // byte for byte: the existing prefix unchanged, the diagnosis appended.
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [collision] — "deliberate: brand tracks success" [tokens: --accent, --success] [' +
        entry +
        ":4]" +
        AIM_SUFFIX,
    );
  });

  it("states the third case beside the section's two readings, so the prose and the row agree", () => {
    // Without this line a reader scanning the prose is handed a dichotomy both
    // of whose clauses the row below it contradicts. The carve-out follows the
    // `[file: …]` precedent: it prints only when the section actually carries
    // such an entry, so every section it does not apply to stays byte-identical.
    write("prose/tokens.css", TOKENS);
    const entry = write(
      "prose/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.stdout).toContain(
      "an entry naming a live finding in another file is a third case this report CAN tell",
    );
    expect(unmatchedRow(result)).toContain(AIM_SUFFIX);
  });

  it("is ONE FILE MOVE from working — the move the suffix names actually suppresses", () => {
    // The suffix is only worth printing if its advice is true, so the advice is
    // executed here rather than asserted: the same directive, moved into the
    // file the suffix named and placed at the finding's own site, suppresses
    // with its own reason and leaves the section empty.
    write(
      "moved/tokens.css",
      [
        ":root {",
        "  --accent: #22C55E;",
        "  --success: #22C55E;" +
          " /* themeguard-ignore collision --accent --success -- moved here, works */",
        "}",
      ].join("\n"),
    );
    const entry = write(
      "moved/main.css",
      ['@import "./tokens.css";', "", ".a { color: var(--accent); }", ".b { color: var(--success); }"].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain('"moved here, works"');
    expect(result.stdout).toContain("unmatched (0)");
  });

  it("names the OTHER move too — a config entry covers the closure, and then nothing is unmatched", () => {
    write("configured/tokens.css", TOKENS);
    write(
      "configured/themeguard.config.json",
      JSON.stringify({
        suppress: [
          { rule: "collision", tokens: ["--accent", "--success"], reason: "project-level sign-off" },
        ],
      }),
    );
    const entry = write(
      "configured/main.css",
      ['@import "./tokens.css";', "", ".a { color: var(--accent); }", ".b { color: var(--success); }"].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain('"project-level sign-off"');
    expect(result.stdout).toContain("unmatched (0)");
  });
});

describe("the arms that KEEP the existing advice — the diagnosis is the cross-file one only", () => {
  it("a directive whose site misses in its OWN file keeps the advice byte-for-byte", () => {
    // SAME-FILE-WRONG-LINE: origin matches, no line within the ±1 window. Both
    // existing readings are closer to true here — the defect did move, and the
    // entry IS about this file — so the row must not gain a pointer. This is
    // the arm that makes the two misses disjoint, and it is a single-file sheet
    // precisely so the miss cannot be about a file at all.
    const entry = write(
      "wrongline/main.css",
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
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [collision] — "wrong line, same file" [tokens: --accent, --success] [' + entry + ":6]",
    );
    expect(result.stdout).not.toContain("matches a live");
    expect(result.stdout).not.toContain("a third case this report CAN tell");
  });

  it("the same miss in a CLOSURE keeps the advice — an own-file site is not a cross-file miss", () => {
    // The sharper form of the arm above: the directive sits in the entry file,
    // the collision has a site in the entry file AND a site in the import, and
    // the directive's line covers neither. `findingLinesIn` for origin
    // `undefined` is NON-empty, so the file is not the reason it missed — the
    // entry keeps the existing advice even though an imported site exists.
    //
    // ONE finding, so this pins the per-finding answer and NOT the whole-entry
    // disqualification — with a single candidate the two are indistinguishable.
    // The entry-level decision is pinned below, on a two-finding fixture.
    write("mixed/part.css", ":root { --imported-fill: #22C55E; }");
    const entry = write(
      "mixed/main.css",
      [
        '@import "./part.css";',
        ":root {",
        "  --entry-fill: #22C55E;",
        "}",
        "",
        "/* themeguard-ignore collision --imported-fill --entry-fill -- misses on line, not on file */",
        ".a { color: var(--imported-fill); }",
        ".b { color: var(--entry-fill); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    // The finding genuinely spans both files — one site in each, cited in the
    // order the message names the tokens.
    expect(result.stdout).toContain("Declared at line 3 and part.css:1.");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).not.toContain("matches a live");
  });

  it("ONE own-file identity-match disqualifies the WHOLE entry, not merely that finding", () => {
    // The pin for the predicate's most-argued decision: an own-file site makes
    // `crossFileAims` abandon the entry outright (`return undefined`) rather
    // than skip that one finding and keep looking (`continue`). The suffix
    // claims the FILE is the whole reason nothing matched, and for an entry
    // that also aims at a finding in its own file that claim is simply false —
    // following it would move the comment into `tokens.css` and leave the
    // entry-file finding unsuppressed, the same false-retirement harm class
    // this slice exists to delete.
    //
    // ⚠️ THE FIXTURE NEEDS TWO FINDINGS AND CANNOT BE SIMPLIFIED TO ONE. With a
    // single finding, per-finding skip and whole-entry disqualification are
    // INDISTINGUISHABLE — `continue` runs out of findings and returns the same
    // `undefined` — which is why `mixed/` above cannot catch this and why the
    // shape here is a RULE-ONLY directive (no `tokens`, so its identity
    // conjuncts match every `dead-token`) against one own-file finding and one
    // imported one. Under the `continue` mutation this row gains
    // `— matches a live [dead-token] finding at tokens.css:1`; it must not.
    write("wholeentry/tokens.css", ":root { --imported-dead: #111111; }");
    const entry = write(
      "wholeentry/main.css",
      [
        '@import "./tokens.css";',
        ":root { --entry-dead: #222222; }",
        "",
        "/* themeguard-ignore dead-token -- blanket, and one of the two lives here */",
        ".a { color: red; }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    // BOTH findings are live and BOTH match the entry's identity conjuncts —
    // one declared in the entry file, one in the import.
    expect(result.stdout).toContain("dead-token (2)");
    expect(result.stdout).toContain("--entry-dead is declared at :root:2");
    expect(result.stdout).toContain("--imported-dead is declared at tokens.css:1");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).not.toContain("matches a live");
    expect(result.stdout).not.toContain("a third case this report CAN tell");
  });

  it("a directive whose rule and tokens match NOTHING keeps the advice", () => {
    write("nothing/tokens.css", TOKENS);
    const entry = write(
      "nothing/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore scale-collapse --nowhere -- matches nothing at all */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).not.toContain("matches a live");
  });

  it("a CONFIG entry keeps the advice byte-for-byte — its matching is already closure-wide", () => {
    // "Matched nothing" is HONEST for a config entry: it has no site conjunct,
    // so nothing about a file narrowed it, and there is no move to suggest.
    write("cfg/tokens.css", TOKENS);
    write(
      "cfg/themeguard.config.json",
      JSON.stringify({
        suppress: [
          { rule: "collision", tokens: ["--accent", "--success"], reason: "the one that works" },
          { rule: "collision", tokens: ["--accent", "--gone"], reason: "stale ledger line" },
        ],
      }),
    );
    const entry = write(
      "cfg/main.css",
      ['@import "./tokens.css";', "", ".a { color: var(--accent); }", ".b { color: var(--success); }"].join("\n"),
    );
    const result = run(entry);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [collision] — "stale ledger line" [tokens: --accent, --gone]',
    );
  });

  it("a FILE-SCOPED config entry whose identity DOES match a live imported finding keeps its own carve-out", () => {
    // The `line` gate's real work, and the one shape that tests it: a config
    // entry can be unmatched while its rule and tokens match a live finding
    // perfectly — a `file` scope aiming at a SIBLING is the whole reason it
    // missed. Every clause of the directive-worded suffix would be false for
    // it: nothing about a file's line numbers narrowed it, it does not "govern
    // only the file it is written in", and it IS already recorded in the
    // config the suffix would tell its author to record it in. The section
    // already tells this entry's truth — the `[file: …]` carve-out — and that
    // carve-out must not be contradicted one line below by a second sentence.
    write("filescoped/tokens.css", TOKENS);
    write("filescoped/sibling.css", ":root { --sibling: #101010; }\n.s { color: var(--sibling); }\n");
    write(
      "filescoped/themeguard.config.json",
      JSON.stringify({
        suppress: [
          {
            rule: "collision",
            tokens: ["--accent", "--success"],
            file: "sibling.css",
            reason: "recorded against the sibling, not this closure",
          },
        ],
      }),
    );
    const entry = write(
      "filescoped/main.css",
      ['@import "./tokens.css";', "", ".a { color: var(--accent); }", ".b { color: var(--success); }"].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    // The finding IS live and the entry's identity conjuncts DO match it —
    // this is the cross-file arm's predicate in every respect but the `line`.
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [collision] — "recorded against the sibling, not this closure"' +
        " [tokens: --accent, --success] [file: sibling.css]",
    );
    // Its own carve-out stands, and the cross-file one is not printed beside it.
    expect(result.stdout).toContain("an entry carrying a [file: …] clause names the stylesheet");
    expect(result.stdout).not.toContain("a third case this report CAN tell");
  });

  it("points at a LIVE finding only — one another entry suppressed is not an aim", () => {
    // Pointing an author at a finding that is already suppressed would trade
    // one false claim for another: the directive cannot be "one move from
    // working" against a finding nothing is holding against the stylesheet.
    // The config entry below claims the collision, so `report.findings` is
    // empty and the directive has nothing live to name.
    write("suppressed-aim/tokens.css", TOKENS);
    write(
      "suppressed-aim/themeguard.config.json",
      JSON.stringify({
        suppress: [
          { rule: "collision", tokens: ["--accent", "--success"], reason: "project-level sign-off" },
        ],
      }),
    );
    const entry = write(
      "suppressed-aim/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- in-file, aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (1)");
    // The directive matched nothing (its site conjunct fails on file grounds)
    // and is unmatched — but the finding it would have named is not live, so
    // no pointer is minted.
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).not.toContain("matches a live");
  });
});

describe("an IMPORTED member's directive earns the aim symmetrically", () => {
  it("names the entry-file site a member's directive cannot reach", () => {
    // The mirror of the arm above, and the reason the predicate reads the
    // entry's OWN origin rather than "is the finding imported": a directive
    // living in an imported file whose conjuncts match an ENTRY-file finding
    // misses on exactly the same file grounds, and is exactly as retirable.
    write(
      "reverse/part.css",
      [
        ":root {",
        "  --part-only: #101010;",
        "}",
        "/* themeguard-ignore collision --entry-a --entry-b -- member judging the entry */",
      ].join("\n"),
    );
    const entry = write(
      "reverse/main.css",
      [
        '@import "./part.css";',
        ":root {",
        "  --entry-a: #22C55E;",
        "  --entry-b: #22C55E;",
        "}",
        ".x { color: var(--part-only); }",
        ".a { color: var(--entry-a); }",
        ".b { color: var(--entry-b); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("unmatched (1)");
    // The entry-file sites are cited the way the finding's own message cites
    // them — a bare `line N`, since they carry no origin.
    expect(unmatchedRow(result)).toContain(
      "— matches a live [collision] finding at line 3; a directive governs only the file it is written in",
    );
  });
});

describe("--json carries the same pointer as data", () => {
  it("adds `crossFileAim` to the unmatched row, and to no other row", () => {
    write("json/tokens.css", TOKENS);
    const entry = write(
      "json/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run("--json", entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    const report = JSON.parse(result.out[0] as string) as {
      findings: unknown[];
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
      "coverage",
    ]);
    // The finding is still LIVE in the data, exactly as the prose reports it.
    expect(report.findings).toHaveLength(1);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    // Every existing key is untouched, and the aim rides beside them.
    expect(row).toMatchObject({
      rule: "collision",
      tokens: ["--accent", "--success"],
      reason: "aimed across the edge",
      line: 2,
    });
    expect(row.crossFileAim).toEqual({ rule: "collision", site: "tokens.css:2" });
  });

  it("OMITS the key on a row with no aim rather than emitting null", () => {
    // The same absence-is-a-fact discipline `sites` carries: a consumer reads
    // `crossFileAim` as "the pointer, IF the report has one to give", and
    // `null` would invent a value the report never had.
    const entry = write(
      "json-none/main.css",
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
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect("crossFileAim" in (report.unmatchedSuppressions[0] as object)).toBe(false);
  });
});

describe("the renderers are byte-identical without the diagnosis — the argument is additive", () => {
  it("both renderers omit the aims entirely when a caller passes none", () => {
    // A library caller holding only a report — and not the resolved sheet the
    // aims are derived from — must get exactly the report it got before the
    // diagnosis existed, on both channels.
    write("additive/tokens.css", TOKENS);
    const entry = write(
      "additive/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const sheet = loadStylesheet(entry);
    const report = audit(resolved, { suppressions: sheet.directives ?? [] });
    expect(report.unmatchedSuppressions).toHaveLength(1);

    const bare = formatReport(entry, report);
    expect(bare.find((l) => l.startsWith("  [unmatched] "))).not.toContain("matches a live");
    expect(bare.join("\n")).not.toContain("a third case this report CAN tell");
    expect(JSON.parse(formatReportJson(entry, report))).toEqual({ path: entry, ...report });

    // Handed the aims, the SAME report renders the diagnosis — so the argument
    // is what the CLI supplies, never a second derivation inside the renderer.
    const aims = crossFileAims(report.unmatchedSuppressions, report.findings, resolved);
    expect(formatReport(entry, report, aims).find((l) => l.startsWith("  [unmatched] "))).toContain(
      "matches a live [collision] finding at tokens.css:2",
    );
  });
});

describe("the derivation reuses the matcher's own semantics", () => {
  it("crossFileAims aligns BY INDEX, so two identical judgements are two answers", () => {
    // The leg reports SLOTS — two structurally identical directives are two
    // ledger lines — so a keyed lookup would fold them into one. Here BOTH
    // directives are the same cross-file miss: the collision's only sites are
    // the two DECLARATION sites in tokens.css (a `var()` use line is never a
    // site), so neither directive has an entry-file site at all, both reach
    // the leg, and both earn the same aim. The risk this pins is therefore
    // DEDUPE, not misalignment: two identical aims must survive as two
    // answers, each at its own index, and a shape-keyed fold would return one.
    //
    // A mixed shape — one suppressor, one aimer — could not pin index
    // alignment at all: a suppressing directive never reaches the leg, leaving
    // a single slot. Two leg entries are required. The whole-entry
    // disqualification (a site in the directive's OWN file) is pinned
    // separately, by "ONE own-file identity-match disqualifies the WHOLE
    // entry" above — that one needs two findings, which this fixture is not.
    write("slots/tokens.css", TOKENS);
    const entry = write(
      "slots/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- first ledger line */",
        "/* themeguard-ignore collision --accent --success -- second ledger line */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const sheet = loadStylesheet(entry);
    const resolved = resolveStylesheet(sheet);
    const report = audit(resolved, { suppressions: sheet.directives ?? [] });
    expect(report.unmatchedSuppressions).toHaveLength(2);
    const aims = crossFileAims(report.unmatchedSuppressions, report.findings, resolved);
    expect(aims).toHaveLength(2);
    expect(aims[0]).toEqual({ rule: "collision", site: "tokens.css:2" });
    expect(aims[1]).toEqual({ rule: "collision", site: "tokens.css:2" });
  });

  it("matchesEntryIdentity asks the identity conjuncts ALONE — never the site", () => {
    // The predicate the diagnosis shares with the matcher, exercised directly:
    // rule, theme-where-named, and the token dimension with its includes
    // semantics (`tokens` needs EVERY name, the precision a PAIR needs).
    const resolved = resolveStylesheet(loadStylesheet(write("identity/main.css", TOKENS + "\n.a { color: var(--accent); }\n.b { color: var(--success); }\n")));
    const finding = audit(resolved).findings.find((f) => f.rule === "collision");
    expect(finding).toBeDefined();
    const site = { line: 999, source: "nowhere.css:999" };
    // The site is hopeless in every case below, and the identity question is
    // answered regardless — that separation IS the point of the split.
    expect(
      matchesEntryIdentity(
        { rule: "collision", tokens: ["--accent", "--success"], reason: "r", ...site },
        finding!,
      ),
    ).toBe(true);
    expect(
      matchesEntryIdentity({ rule: "collision", token: "--accent", reason: "r", ...site }, finding!),
    ).toBe(true);
    // A set naming one token the finding does NOT carry fails the includes-check.
    expect(
      matchesEntryIdentity(
        { rule: "collision", tokens: ["--accent", "--absent"], reason: "r", ...site },
        finding!,
      ),
    ).toBe(false);
    // Another rule, and a theme the finding was not measured in.
    expect(matchesEntryIdentity({ rule: "dead-token", reason: "r", ...site }, finding!)).toBe(false);
    expect(
      matchesEntryIdentity({ rule: "collision", theme: "winter", reason: "r", ...site }, finding!),
    ).toBe(false);
  });

  it("findingLinesIn is the per-file filter, and EMPTY is the cross-file signal", () => {
    write("filter/tokens.css", TOKENS);
    const entry = write(
      "filter/main.css",
      ['@import "./tokens.css";', "", ".a { color: var(--accent); }", ".b { color: var(--success); }"].join("\n"),
    );
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const origins = closureOrigins(resolved);
    expect(origins.has("tokens.css")).toBe(true);
    const finding = audit(resolved).findings.find((f) => f.rule === "collision");
    expect(finding).toBeDefined();
    // Both sites live in the import, so the entry file's reading is EMPTY —
    // the exact predicate the cross-file arm fires on — while the import's own
    // reading names both lines.
    expect(findingLinesIn(finding!, undefined, origins)).toEqual([]);
    expect(findingLinesIn(finding!, "tokens.css", origins)).toEqual([2, 3]);
    // The coordinates the filter reads carry the same origins.
    expect(findingSiteCoordinates(finding!, origins)).toEqual([
      { name: "--accent", line: 2, origin: "tokens.css" },
      { name: "--success", line: 3, origin: "tokens.css" },
    ]);
  });

  it("recovers coordinates from an `evidence` citation for a rule that publishes no `sites`", () => {
    // dead-token carries no `sites` and publishes `evidence.declaredIn` in
    // `":root:2"` / `"tokens.css:2"` shape instead. The reader classifies the
    // prefix against the sheet's own origins — exact, never a shape guess — so
    // a selector prefix yields an entry-file coordinate and a file prefix an
    // imported one. Both spellings appear in one closure here.
    write("evidence/tokens.css", ":root { --imported-orphan: #101010; }");
    const entry = write(
      "evidence/main.css",
      ['@import "./tokens.css";', ":root { --entry-orphan: #202020; }", ".x { color: red; }"].join("\n"),
    );
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const origins = closureOrigins(resolved);
    const dead = audit(resolved).findings.filter((f) => f.rule === "dead-token");
    const imported = dead.find((f) => f.tokens.includes("--imported-orphan"));
    const own = dead.find((f) => f.tokens.includes("--entry-orphan"));
    expect(imported).toBeDefined();
    expect(own).toBeDefined();
    expect(findingSiteCoordinates(imported!, origins)).toEqual([{ line: 1, origin: "tokens.css" }]);
    expect(findingSiteCoordinates(own!, origins)).toEqual([{ line: 2 }]);
    // And the filter reads them the same way the matcher does.
    expect(findingLinesIn(imported!, undefined, origins)).toEqual([]);
    expect(findingLinesIn(own!, undefined, origins)).toEqual([2]);
  });

  it("siteLineCovers is AT the site or ONE LINE ABOVE it — never below", () => {
    // The direction is load-bearing for every placement in this file: a
    // directive is a trailing comment on the judged declaration, or a
    // standalone comment on the line before it.
    expect(siteLineCovers(4, 4)).toBe(true);
    expect(siteLineCovers(4, 5)).toBe(true);
    expect(siteLineCovers(4, 3)).toBe(false);
    expect(siteLineCovers(4, 6)).toBe(false);
  });
});
