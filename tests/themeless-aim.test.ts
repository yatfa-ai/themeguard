import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit, themelessAims } from "../src/audit.js";
import { THEMELESS_RULES, type Finding } from "../src/rules/finding.js";
import {
  formatReport,
  formatReportJson,
  runCli,
  EXIT_FINDINGS,
  EXIT_OK,
  type CliIo,
} from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet } from "../src/resolve.js";

/**
 * The THEME-SCOPE DEAD ARM of the `unmatched` section's advice (0.1.26).
 *
 * The section offers a reader two readings — "the defect was fixed and the
 * judgement can be retired" / "the entry never aimed at a finding that exists"
 * — and for ONE more shape both are false: a config entry whose `theme` scope
 * names a rule that measures STYLESHEET-WIDE. `matchesEntryIdentity` rejects a
 * finding when `entry.theme !== finding.theme`, and five of the nine rules push
 * `theme: null` at their own push sites by construction, so the conjunct is not
 * a near-miss a different file or a different run might satisfy — it is a
 * STRUCTURALLY DEAD scope. The defect prints above in the same report, the
 * entry's rule and tokens DO match it, and the judgement is ONE KEY DELETION
 * from working. A reader following the advice retires it.
 *
 * That is the same false-retirement harm class the cross-file arm deleted
 * (0.1.24, `tests/cross-file-aim.test.ts`, whose shape this spec follows) — a
 * DIFFERENT arm of the same section, and one no landed test constructed:
 * `tests/unmatched.test.ts` carries zero theme-scoped entries, and the only
 * `[theme:` pins in the suite are scope-suffix renders on MATCHED rows.
 *
 * ⚠️ DIAGNOSIS, NEVER SUPPRESSION. Every fence is a pin in here: the matching
 * semantics are untouched, the entry stays ON the `unmatched` leg, the counts
 * stay put and the exit code does not move. The slice adds a SENTENCE to a row
 * that was already printing.
 *
 * ⚠️ THE ONE-KEY MOVE IS IDENTITY-ONLY. The clause promises that deleting the
 * theme key aims the judgement — a promise that is FALSE for an entry that
 * ALSO carries a `file` scope, where a second dead conjunct would leave the
 * entry unmatched after the deletion (the exact defect a review probe caught:
 * the advice was executed and suppressed nothing). `themelessAims` therefore
 * declines any entry carrying a `file` scope, and this spec pins all three
 * sub-cases — sibling file, beyond-config-home, and the audited sheet itself —
 * each keeping the generic prose byte-identical and the `--json` key absent.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-themeless-aim-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, contents: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
  return path;
}

function config(dir: string, suppress: unknown[]): void {
  write(`${dir}/themeguard.config.json`, JSON.stringify({ suppress }));
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

/** The section's own tellable-case line, quoted by its opening — never a regex. */
const SECTION_LINE = "an entry whose [theme: …] scope names a rule measured STYLESHEET-WIDE";

/** The clause a dead theme scope earns, whole, for the ticket's first probed rule. */
const DEAD_TOKEN_CLAUSE =
  " — [dead-token] findings are measured stylesheet-wide and carry no theme, so the" +
  " [theme: winter] scope can never match; drop the theme key to aim the judgement.";

/** The ticket's probe sheet: one dead token beside a live collision. */
const PROBE = [
  ":root {",
  "  --brand: #22C55E;",
  "  --accent: #22C55E;",
  "  --unused-accent: #ff0000;",
  "}",
  ".a { color: var(--brand); }",
  ".b { color: var(--accent); }",
].join("\n");

describe("the theme-scope dead arm — a theme scope on a rule that reports no theme", () => {
  it("names the rule, the dead scope and the one-key move, on a row that still reports unmatched", () => {
    const entry = write("probe/a.css", PROBE);
    config("probe", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        reason: "reviewed winter only",
      },
    ]);
    const result = run(entry);

    // The FENCE first, because the clause must never read as a suppression:
    // the finding prints, nothing is suppressed, the entry is still unmatched
    // and the exit code still moves.
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("dead-token (1)");
    expect(result.stdout).toContain(
      "--unused-accent is declared at :root:4 and no var() in this stylesheet references it.",
    );
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");

    // And the row now says WHY the scope can never match — the whole line,
    // byte for byte: the existing prefix unchanged, the diagnosis appended.
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "reviewed winter only" [token: --unused-accent]' +
        " [theme: winter]" +
        DEAD_TOKEN_CLAUSE,
    );
  });

  it("states the case beside the section's two readings, so the prose and the row agree", () => {
    // Without this line a reader scanning the prose is handed a dichotomy both
    // of whose clauses the row below it contradicts. The carve-out follows the
    // `[file: …]` and cross-file precedents: it prints only when the section
    // actually carries such an entry, so every section it does not apply to
    // stays byte-identical.
    const entry = write("prose/a.css", PROBE);
    config("prose", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        reason: "reviewed winter only",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain(SECTION_LINE);
    expect(unmatchedRow(result)).toContain(DEAD_TOKEN_CLAUSE);
  });

  it("is ONE KEY DELETION from working — the move the clause names actually suppresses", () => {
    // The clause is only worth printing if its advice is true, so the advice is
    // executed here rather than asserted: the same entry, minus the theme key,
    // suppresses with its own reason and leaves the section empty.
    const entry = write("dropped/a.css", PROBE);
    config("dropped", [
      { rule: "dead-token", token: "--unused-accent", reason: "reviewed winter only" },
    ]);
    const result = run(entry);
    // The collision is still live, so the exit stays 1 — what moved is the
    // dead-token finding, which the judgement now covers.
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("dead-token (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain('"reviewed winter only"');
    expect(result.stdout).toContain("unmatched (0)");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("earns the clause on the ticket's SECOND probed rule too — the arm is the rule's stance, not one rule", () => {
    // unresolved-reference pushes `theme: null` at its own site for the same
    // reason dead-token does: the name is declared in the STYLESHEET or it is
    // not. Its token dimension is the unresolved SPECIFIER, which is what the
    // entry names.
    const entry = write(
      "second/a.css",
      [":root { --card: var(--missing-token); }", ".c { color: var(--card); }"].join("\n"),
    );
    config("second", [
      {
        rule: "unresolved-reference",
        token: "--missing-token",
        theme: "winter",
        reason: "winter fixture only",
      },
    ]);
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unresolved-reference (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [unresolved-reference] — "winter fixture only" [token: --missing-token]' +
        " [theme: winter] — [unresolved-reference] findings are measured stylesheet-wide and" +
        " carry no theme, so the [theme: winter] scope can never match; drop the theme key to" +
        " aim the judgement.",
    );
  });
});

describe("the arms that KEEP the existing advice — the diagnosis is the dead-scope one only", () => {
  it("a theme scope on a theme-BEARING rule keeps the advice byte-for-byte", () => {
    // CROSS-THEME MISS: `collision` measures per theme and publishes a real
    // theme string, so a scope naming another theme is a MISS and not a dead
    // conjunct — a shared-subtree config may aim the entry at a sibling file
    // where that theme exists, which is exactly what the generic prose leaves
    // open. The row must not gain a clause claiming the rule reports no theme.
    const entry = write("bearing/a.css", PROBE);
    config("bearing", [
      {
        rule: "collision",
        tokens: ["--brand", "--accent"],
        theme: "winter",
        reason: "cross-theme scope",
      },
    ]);
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [collision] — "cross-theme scope" [theme: winter, tokens: --brand, --accent]',
    );
    expect(result.stdout).not.toContain("measured stylesheet-wide and carry no theme");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("cycle-reference DECLINES even when this run's findings happen to be all-null", () => {
    // The pin for the predicate's most-argued decision, and the reason the
    // rule's stance is DECLARED (`THEMELESS_RULES`) rather than inferred from a
    // run's findings. cycle-reference's push site is `themeAuthored ? theme :
    // null`, so the scope stays aimable IN PRINCIPLE — a theme-authored loop
    // carries the theme — and a clause asserting "this rule reports no theme,
    // ever" would simply be false about it.
    //
    // ⚠️ THE FIXTURE IS DELIBERATELY ALL-NULL-IN-THIS-RUN. The sheet below
    // carries a base-authored loop AND a theme-authored one, and the entry's
    // token dimension narrows to the BASE one — so every finding the entry's
    // non-theme conjuncts match carries `theme: null`, and a derivation reading
    // only this run's findings would mint the clause. The declared set is what
    // declines it; under the inferred mutation this row gains the clause.
    const entry = write(
      "cycle/a.css",
      [
        ":root {",
        "  --base-a: var(--base-b);",
        "  --base-b: var(--base-a);",
        "}",
        '[data-theme="dark"] {',
        "  --dk-a: var(--dk-b);",
        "  --dk-b: var(--dk-a);",
        "}",
        ".x { color: var(--base-a); }",
        ".y { color: var(--dk-a); }",
      ].join("\n"),
    );
    config("cycle", [
      {
        rule: "cycle-reference",
        token: "--base-a",
        theme: "winter",
        reason: "mixed population",
      },
    ]);
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    // The run genuinely carries BOTH shapes: a base-authored loop reported
    // `theme: null`, and a theme-authored one reported under its own theme.
    const json = JSON.parse(run("--json", entry).out[0] as string) as {
      findings: { rule: string; theme: string | null }[];
    };
    const cycles = json.findings.filter((f) => f.rule === "cycle-reference");
    expect(cycles.map((f) => f.theme)).toEqual([null, "dark"]);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [cycle-reference] — "mixed population" [token: --base-a] [theme: winter]',
    );
    expect(result.stdout).not.toContain("measured stylesheet-wide and carry no theme");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("an UNSCOPED entry keeps the advice — it has no theme conjunct to be dead", () => {
    // "Matched nothing" is HONEST for an entry that names no theme: nothing
    // about a theme narrowed it, and there is no key to delete.
    //
    // ⚠️ THE FIXTURE IS FILE-SCOPED, DELIBERATELY, and cannot be simplified to
    // a bare unscoped entry. The gate this pins is `theme === undefined`, and
    // it only bites on an entry whose OTHER conjuncts match a live theme-less
    // finding — an entry that matches nothing declines for want of a match
    // instead, so it cannot tell the gate's presence from its absence. A plain
    // unscoped config entry matching a live finding would have SUPPRESSED it
    // (it has no site conjunct), so it could never reach this leg; a `file`
    // scope aimed at a sibling is what keeps it unmatched while its rule and
    // tokens match perfectly. Without the gate this row gains a clause reading
    // "the [theme: undefined] scope can never match" — an invented scope, and
    // advice to delete a key the entry does not carry.
    const entry = write("unscoped/a.css", PROBE);
    write("unscoped/sibling.css", ":root { --s: #101010; }\n.s { color: var(--s); }\n");
    config("unscoped", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        file: "sibling.css",
        reason: "recorded against the sibling",
      },
    ]);
    const result = run(entry);
    // The finding IS live and the entry's rule and token DO match it — only
    // the file scope kept it unmatched.
    expect(result.stdout).toContain("dead-token (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "recorded against the sibling" [token: --unused-accent]' +
        " [file: sibling.css]",
    );
    expect(result.stdout).not.toContain("can never match");
    expect(result.stdout).not.toContain(SECTION_LINE);
    // Its own carve-out stands, and the new one is not printed beside it.
    expect(result.stdout).toContain("an entry carrying a [file: …] clause names the stylesheet");
  });

  it("a theme-scoped entry whose TOKENS match nothing keeps the advice", () => {
    // The rule is theme-less and the scope IS dead — but the entry aims at a
    // token no finding of that rule carries, so the report cannot say the
    // defect exists. Both generic readings remain live for it, and minting the
    // clause would trade one false claim for another.
    const entry = write("notoken/a.css", PROBE);
    config("notoken", [
      {
        rule: "dead-token",
        token: "--never-declared",
        theme: "winter",
        reason: "aims at nothing real",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "aims at nothing real" [token: --never-declared] [theme: winter]',
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("points at a LIVE finding only — one another entry suppressed is not a dead scope worth naming", () => {
    // Telling an author their scope is dead against a finding nothing is
    // holding against the stylesheet would trade one false claim for another:
    // the entry cannot be "one key from working" when deleting the key still
    // suppresses nothing new. The unscoped entry below claims the dead token,
    // so `report.findings` carries none and the scoped one has nothing live.
    const entry = write("suppressed-aim/a.css", PROBE);
    config("suppressed-aim", [
      { rule: "dead-token", token: "--unused-accent", reason: "project-level sign-off" },
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        reason: "the scoped twin",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).not.toContain("measured stylesheet-wide and carry no theme");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("leaves the [file: …] carve-out and the beyond-config-home line byte-identical", () => {
    // Two of the section's existing carve-outs, exercised on a sheet that also
    // carries a dead-scope entry: the three lines coexist, each stating its own
    // entry's truth, and none is reworded by the arrival of the third.
    const entry = write("carveouts/nested/a.css", PROBE);
    write("carveouts/nested/sibling.css", ":root { --s: #101010; }\n.s { color: var(--s); }\n");
    config("carveouts/nested", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        reason: "the dead scope",
      },
      {
        rule: "collision",
        tokens: ["--brand", "--accent"],
        file: "sibling.css",
        reason: "recorded against the sibling",
      },
      {
        rule: "collision",
        tokens: ["--brand", "--accent"],
        file: "../outside.css",
        reason: "beyond the config's home",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (3)");
    expect(result.stdout).toContain("an entry carrying a [file: …] clause names the stylesheet");
    expect(result.stdout).toContain(
      "an entry whose [file: …] clause resolves OUTSIDE this config's own directory",
    );
    expect(result.stdout).toContain(SECTION_LINE);
    // The two file-scoped rows carry their own clauses and NOT the new one.
    const rows = result.out.filter((l) => l.startsWith("  [unmatched] "));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(DEAD_TOKEN_CLAUSE);
    expect(rows[1]).toBe(
      '  [unmatched] [collision] — "recorded against the sibling" [tokens: --brand, --accent]' +
        " [file: sibling.css]",
    );
    expect(rows[2]).toBe(
      '  [unmatched] [collision] — "beyond the config\'s home" [tokens: --brand, --accent]' +
        " [file: ../outside.css]",
    );
  });

  it("leaves the zero-state line untouched", () => {
    const entry = write("zero/a.css", PROBE);
    const result = run(entry);
    expect(result.stdout).toContain(
      "  nothing unmatched — every recorded judgement still covers a finding this report carries.",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
  });
});

describe("an entry that ALSO carries a `file` scope DECLINES — the theme is not the only dead conjunct", () => {
  // The review probe that forced this gate: a theme-scoped entry whose `file`
  // scope names ANOTHER stylesheet matched every gate the derivation asked
  // (identity minus theme is exactly its match), so its row earned "drop the
  // theme key to aim the judgement" — and executing that advice suppressed
  // NOTHING, because the `file` scope is what kept the entry out. The clause
  // claims the theme is the WHOLE reason nothing matched; a `file` scope is a
  // second dead conjunct, and the whole entry disqualifies — the same move
  // `crossFileAims` makes for a same-file identity match. The unscoped twin in
  // "an UNSCOPED entry keeps the advice" IS this entry minus the theme key,
  // and it stays unmatched — which is why the promise must never print here.

  it("a `file` scope naming a SIBLING stylesheet keeps the generic advice byte-for-byte", () => {
    const entry = write("filescope/a.css", PROBE);
    write("filescope/sibling.css", ":root { --s: #101010; }\n.s { color: var(--s); }\n");
    config("filescope", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        file: "sibling.css",
        reason: "sibling, winter only",
      },
    ]);
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("dead-token (1)");
    expect(result.stdout).toContain("unmatched (1)");
    // No clause: the row is exactly what it was before the arm existed.
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "sibling, winter only" [token: --unused-accent]' +
        " [theme: winter] [file: sibling.css]",
    );
    expect(result.stdout).not.toContain("measured stylesheet-wide and carry no theme");
    expect(result.stdout).not.toContain(SECTION_LINE);
    // And its own carve-out stands, alone.
    expect(result.stdout).toContain("an entry carrying a [file: …] clause names the stylesheet");
  });

  it("a `file` scope resolving OUTSIDE the config's home earns no clause beside its fate line", () => {
    // The sharpest form of the defect: before the gate, this section printed
    // "one key deletion from working rather than retirable" DIRECTLY BESIDE
    // "re-aim the entry inside the config's directory, or retire it" — two
    // carve-out lines contradicting each other about the same single entry.
    // The fate line is the true one; the clause must not exist beside it.
    const entry = write("beyond/a.css", PROBE);
    config("beyond", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        file: "../outside.css",
        reason: "beyond home",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "beyond home" [token: --unused-accent]' +
        " [theme: winter] [file: ../outside.css]",
    );
    // The fate line prints on its own terms, and the clause's section line
    // and row sentence are both silent.
    expect(result.stdout).toContain(
      "an entry whose [file: …] clause resolves OUTSIDE this config's own directory",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
    expect(result.stdout).not.toContain("one key deletion from working");
    expect(result.stdout).not.toContain("measured stylesheet-wide and carry no theme");
  });

  it("even a scope naming the AUDITED sheet itself declines — the derivation cannot resolve the comparison", () => {
    // The one sub-case where the advice WOULD hold: `fileResolved` equals the
    // audited stylesheet, so only the theme conjunct is dead and deleting the
    // key does suppress (probed in review). It is declined anyway, on purpose:
    // deciding it is a comparison against `options.stylesheet`, which
    // `themelessAims` never holds, and a missing sentence costs a reader a
    // hint while a wrong one costs them a working judgement. The generic
    // prose — which at least promises nothing — is what prints.
    const entry = write("selffile/a.css", PROBE);
    config("selffile", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        file: "a.css",
        reason: "this sheet, winter only",
      },
    ]);
    const result = run(entry);
    expect(result.stdout).toContain("dead-token (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [dead-token] — "this sheet, winter only" [token: --unused-accent]' +
        " [theme: winter] [file: a.css]",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
    expect(result.stdout).not.toContain("measured stylesheet-wide and carry no theme");
  });
});

describe("the CROSS-FILE arm is byte-identical — the two diagnoses are structurally disjoint", () => {
  it("a directive can never earn this clause: the grammar carries no theme scope", () => {
    // The disjointness is STRUCTURAL rather than incidental: the directive
    // grammar is `themeguard-ignore <rule> [--token …] -- <reason>` and has no
    // theme, so a site-scoped entry's `theme` is always `undefined` and the
    // predicate's first gate declines it. This is the cross-file arm's own
    // fixture shape, re-run to pin that its row is unchanged.
    write("crossfile/tokens.css", [":root {", "  --accent: #22C55E;", "  --success: #22C55E;", "}"].join("\n"));
    const entry = write(
      "crossfile/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toContain("matches a live [collision] finding at tokens.css:2");
    expect(result.stdout).toContain("a third case this report CAN tell");
    // And the new arm is silent on it, row and section alike.
    expect(unmatchedRow(result)).not.toContain("measured stylesheet-wide and carry no theme");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });
});

describe("--json carries the same diagnosis as data", () => {
  it("adds `themelessAim` to the unmatched row, and to no other row", () => {
    const entry = write("json/a.css", PROBE);
    config("json", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        reason: "reviewed winter only",
      },
    ]);
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
      "skippedDisabled",
      "coverage",
    ]);
    // The findings are still LIVE in the data, exactly as the prose reports.
    expect(report.findings).toHaveLength(2);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    // Every existing key is untouched, and the diagnosis rides beside them.
    expect(row).toMatchObject({
      rule: "dead-token",
      token: "--unused-accent",
      theme: "winter",
      reason: "reviewed winter only",
    });
    expect(row.themelessAim).toEqual({ rule: "dead-token" });
    // The sibling key is not minted by this arm.
    expect("crossFileAim" in row).toBe(false);
  });

  it("OMITS the key on a row with no dead scope rather than emitting null", () => {
    // The same absence-is-a-fact discipline `sites` and `crossFileAim` carry: a
    // consumer reads `themelessAim` as "the diagnosis, IF the report has one to
    // give", and `null` would invent a value the report never had.
    const entry = write("json-none/a.css", PROBE);
    config("json-none", [
      {
        rule: "collision",
        tokens: ["--brand", "--accent"],
        theme: "winter",
        reason: "cross-theme scope",
      },
    ]);
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect("themelessAim" in (report.unmatchedSuppressions[0] as object)).toBe(false);
  });

  it("carries the key on a `file`-scoped row NOT AT ALL — no machine-readable self-contradiction", () => {
    // The review's second, sharper form: before the gate, a beyond-config-home
    // row carried BOTH `fileBeyondConfigHome: true` (the fate annotation —
    // this entry can never be honoured, anywhere) AND `themelessAim` ("one key
    // deletion from working"). The two claims contradict each other, and on
    // this channel the contradiction is machine-readable. The gate removes the
    // second claim wherever the first stands.
    const entry = write("json-file/a.css", PROBE);
    config("json-file", [
      {
        rule: "dead-token",
        token: "--unused-accent",
        theme: "winter",
        file: "../outside.css",
        reason: "beyond home",
      },
    ]);
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    expect(row.fileBeyondConfigHome).toBe(true);
    expect("themelessAim" in row).toBe(false);
  });

  it("carries the key on a CROSS-FILE fixture's rows not at all — the two keys are disjoint", () => {
    write("json-cf/tokens.css", [":root {", "  --accent: #22C55E;", "  --success: #22C55E;", "}"].join("\n"));
    const entry = write(
      "json-cf/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore collision --accent --success -- aimed across the edge */",
        ".a { color: var(--accent); }",
        ".b { color: var(--success); }",
      ].join("\n"),
    );
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    expect(row.crossFileAim).toEqual({ rule: "collision", site: "tokens.css:2" });
    expect("themelessAim" in row).toBe(false);
  });
});

describe("the renderers are byte-identical without the diagnosis — the argument is additive", () => {
  it("both renderers omit the diagnosis entirely when a caller passes none", () => {
    // A library caller holding only a report must get exactly the report it got
    // before the diagnosis existed, on both channels.
    const entry = write("additive/a.css", PROBE);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const suppressions = [
      {
        rule: "dead-token" as const,
        token: "--unused-accent",
        theme: "winter",
        reason: "reviewed winter only",
      },
    ];
    const report = audit(resolved, { suppressions });
    expect(report.unmatchedSuppressions).toHaveLength(1);

    const bare = formatReport(entry, report);
    expect(bare.find((l) => l.startsWith("  [unmatched] "))).not.toContain(
      "measured stylesheet-wide and carry no theme",
    );
    expect(bare.join("\n")).not.toContain(SECTION_LINE);
    expect(JSON.parse(formatReportJson(entry, report))).toEqual({ path: entry, ...report });

    // Handed the diagnosis, the SAME report renders the clause — so the
    // argument is what the CLI supplies, never a second derivation inside the
    // renderer.
    const themeless = themelessAims(report.unmatchedSuppressions, report.findings);
    expect(
      formatReport(entry, report, [], themeless).find((l) => l.startsWith("  [unmatched] ")),
    ).toContain(DEAD_TOKEN_CLAUSE);
  });
});

describe("the derivation reads the rule's declared stance and the matcher's own semantics", () => {
  it("THEMELESS_RULES names exactly the five rules whose push sites pin `theme: null`", () => {
    // The set is a claim about the RULES, so it is pinned as a set rather than
    // inferred from a fixture: dead-token, duplicate-declaration,
    // theme-partial-token, unresolved-import and unresolved-reference each push
    // the literal at their own push site. cycle-reference's is conditional
    // (`themeAuthored ? theme : null`) and is deliberately absent; collision,
    // scale-collapse and family-consistency all measure per theme.
    expect([...THEMELESS_RULES].sort()).toEqual([
      "dead-token",
      "duplicate-declaration",
      "theme-partial-token",
      "unresolved-import",
      "unresolved-reference",
    ]);
  });

  it("FIVE of the NINE — the arithmetic the section line and the row clause both assert", () => {
    // The prose says "five of the nine rules report no theme at all", and that
    // sentence is a COUNT a later rule addition would silently falsify: a tenth
    // rule, or a sixth theme-less one, makes the printed line wrong with
    // nothing to catch it. Pinned against a REPORT's own `countsByRule`, which
    // is a `Record<RuleId, number>` and therefore exhaustive by type — rather
    // than against a literal list typed a second time here, which is exactly
    // the twin this project keeps refusing to mint.
    const report = audit(resolveStylesheet(loadStylesheet(write("arith/a.css", PROBE))));
    const everyRule = Object.keys(report.countsByRule);
    expect(everyRule).toHaveLength(9);
    expect(THEMELESS_RULES.size).toBe(5);
    // And every member names a real rule: a typo'd entry would silently never
    // match and the arm would just stop firing for that rule.
    for (const rule of THEMELESS_RULES) expect(everyRule).toContain(rule);
  });

  it("themelessAims aligns BY INDEX, so two identical judgements are two answers", () => {
    // The leg reports SLOTS — two structurally identical ledger lines are two
    // entries — so a keyed lookup would fold them into one. Both entries below
    // are the same dead scope, so both earn the same diagnosis, each at its own
    // index; a shape-keyed fold would return one.
    const entry = write("slots/a.css", PROBE);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "dead-token" as const,
          token: "--unused-accent",
          theme: "winter",
          reason: "first ledger line",
        },
        {
          rule: "dead-token" as const,
          token: "--unused-accent",
          theme: "winter",
          reason: "second ledger line",
        },
      ],
    });
    expect(report.unmatchedSuppressions).toHaveLength(2);
    const themeless = themelessAims(report.unmatchedSuppressions, report.findings);
    expect(themeless).toHaveLength(2);
    expect(themeless[0]).toEqual({ rule: "dead-token" });
    expect(themeless[1]).toEqual({ rule: "dead-token" });
  });

  it("reads the token dimension through the matcher — a `tokens` SET needs every name", () => {
    // The includes semantics are the matcher's own (`matchesEntryIdentity` with
    // the theme dropped), never a re-derived twin: a set naming a token the
    // finding does not carry matches nothing, so no clause is minted.
    const entry = write("tokens-set/a.css", PROBE);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "dead-token" as const,
          tokens: ["--unused-accent", "--also-not-there"],
          theme: "winter",
          reason: "over-specified set",
        },
      ],
    });
    expect(themelessAims(report.unmatchedSuppressions, report.findings)).toEqual([undefined]);
  });

  it("declines when a declared theme-less rule publishes a THEME-BEARING finding — the belt beside the set", () => {
    // The set is a declaration about push sites, and a push site can be edited.
    // The belt is what keeps the clause from LYING if one ever is: a rule in
    // the set that starts carrying a theme makes "this rule reports no theme,
    // ever" false, and the arm must decline rather than assert it.
    //
    // ⚠️ THE FINDING IS SYNTHETIC, DELIBERATELY, and this test says so rather
    // than implying the shape is reachable today: no rule in `THEMELESS_RULES`
    // can currently produce it — that is exactly what the set asserts — so a
    // fixture cannot construct it and the predicate is exercised directly. It
    // pins DRIFT RESISTANCE, not a live population.
    //
    // ⚠️ AND IT NEEDS TWO FINDINGS, one bearing a theme and one not, for the
    // reason the cross-file arm's whole-entry pin needs two: with a single
    // theme-bearing finding, per-finding skip (`continue`) and whole-entry
    // disqualification (`return undefined`) are INDISTINGUISHABLE — the loop
    // runs out of candidates and returns the same `undefined`. Only a MIXED
    // population separates them: under the `continue` mutation the theme-less
    // sibling sets the match and the clause is minted anyway; it must not be.
    const bearing: Finding = {
      rule: "dead-token",
      theme: "winter",
      tokens: ["--unused-accent"],
      message: "synthetic: a theme-less rule that started carrying a theme",
      evidence: {},
    };
    const themelessSibling: Finding = { ...bearing, theme: null };
    const entry = {
      rule: "dead-token" as const,
      token: "--unused-accent",
      theme: "winter",
      reason: "reviewed winter only",
    };
    expect(themelessAims([entry], [bearing, themelessSibling])).toEqual([undefined]);
    // Order-independent: the disqualification is about the ENTRY, so a
    // theme-bearing finding seen LAST disqualifies just as one seen first.
    expect(themelessAims([entry], [themelessSibling, bearing])).toEqual([undefined]);
    // And against the theme-less finding ALONE the clause IS minted — so the
    // declines above are the belt firing, not the entry failing some other
    // conjunct.
    expect(themelessAims([entry], [themelessSibling])).toEqual([{ rule: "dead-token" }]);
  });

  it("declines an entry carrying a `file` scope — the theme would not be the only dead conjunct", () => {
    // The review probe, asked of the predicate directly: a theme-scoped entry
    // whose `file` scope names another stylesheet has a SECOND dead conjunct,
    // so the clause's one-key promise is false for it and the whole entry
    // disqualifies. The scope is read exactly as `matches` reads it —
    // `fileResolved` when the CLI resolved one, the entry's own spelling
    // otherwise — so both spellings are pinned.
    const finding: Finding = {
      rule: "dead-token",
      theme: null,
      tokens: ["--unused-accent"],
      message: "synthetic: the theme-less finding the entry's identity matches",
      evidence: {},
    };
    const resolvedSpelling = {
      rule: "dead-token" as const,
      token: "--unused-accent",
      theme: "winter",
      file: "sibling.css",
      fileResolved: "/elsewhere/sibling.css",
      reason: "sibling, winter only",
    };
    const writtenSpelling = {
      rule: "dead-token" as const,
      token: "--unused-accent",
      theme: "winter",
      file: "sibling.css",
      reason: "sibling, winter only",
    };
    expect(themelessAims([resolvedSpelling], [finding])).toEqual([undefined]);
    expect(themelessAims([writtenSpelling], [finding])).toEqual([undefined]);
    // And the SAME entries without the scope DO earn it — so the declines
    // above are the file gate firing, not some other conjunct failing.
    const unscoped = {
      rule: "dead-token" as const,
      token: "--unused-accent",
      theme: "winter",
      reason: "sibling, winter only",
    };
    expect(themelessAims([unscoped], [finding])).toEqual([{ rule: "dead-token" }]);
  });

  it("the matching semantics are untouched — the same entry suppresses nothing, before and after", () => {
    // The slice's headline fence, asked of the library directly: the entry is
    // on the unmatched leg, `suppressed` is empty, and the finding is live.
    const entry = write("fence/a.css", PROBE);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "dead-token" as const,
          token: "--unused-accent",
          theme: "winter",
          reason: "reviewed winter only",
        },
      ],
    });
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.countsByRule["dead-token"]).toBe(1);
    expect(report.findings.some((f) => f.rule === "dead-token")).toBe(true);
  });

  it("a clean sheet with a dead-scope entry still exits 0 — the section is outside the exit", () => {
    // The entry is unmatched and diagnosed, and the exit stays the
    // unsuppressed-findings question it has always been.
    const entry = write(
      "exit/a.css",
      [":root { --only: #101010; }", ".o { color: var(--only); }"].join("\n"),
    );
    config("exit", [
      { rule: "dead-token", token: "--gone", theme: "winter", reason: "stale" },
    ]);
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain("No findings.");
  });
});
