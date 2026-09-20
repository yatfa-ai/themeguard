import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit, skippedAims } from "../src/audit.js";
import type { SkippedPair } from "../src/rules/scale-collapse.js";
import {
  formatReport,
  formatReportJson,
  runCli,
  EXIT_FINDINGS,
  EXIT_OK,
  type CliIo,
} from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet, resolveCss } from "../src/resolve.js";

/**
 * THE KEPT-SKIPPED ARM of the `unmatched` section's advice (the sixth tellable
 * case).
 *
 * The section offers a reader two readings — "the defect was fixed and the
 * judgement can be retired" / "the entry never aimed at a finding that exists"
 * — and for ONE more shape both are false in the natural sense: an entry whose
 * identity conjuncts match a pair rule 3 could not MEASURE. The pair is not a
 * finding, so the entry matched nothing and landed here — but the pair PRINTS,
 * one section up, in the skipped section's own doctrine "not findings, and not
 * a pass either", under the same rule id and token names the entry names. Both
 * offered readings fail: the target was not fixed (it prints, skipped), and
 * the entry DID aim at a row that exists. A reader following the advice
 * retires a judgement aimed squarely at a row the same report is showing them.
 *
 * The report's verdict on this aim already flipped on an unrelated config key
 * before this arm existed: turn the rule off and the SAME entry earns the
 * disabled-rule carve-out ("one policy decision away from working"), because a
 * disabled rule's pairs sit on `skippedDisabled` — a channel the policy
 * partitions. The kept leg could not honestly claim ignorance the machinery
 * does not have.
 *
 * That is the same false-retirement harm class the cross-file arm deleted
 * (0.1.24, `tests/cross-file-aim.test.ts`) and the dead-theme-scope arm
 * deleted (0.1.26, `tests/themeless-aim.test.ts`, whose shape this spec
 * follows) — a DIFFERENT arm of the same section, and one no landed test
 * constructed: `grep skipped` over the landed carve-out specs yields only
 * Object.keys order pins, and `tests/policy.test.ts` covers ONLY the disabled
 * arm.
 *
 * ⚠️ DIAGNOSIS, NEVER SUPPRESSION. Every fence is a pin in here: the matching
 * semantics are untouched, the entry stays ON the `unmatched` leg (a skip is
 * not a finding, and entries govern findings only — no entry can ever claim a
 * skipped row), the counts stay put and the exit code does not move. The slice
 * adds a SENTENCE to a row that was already printing.
 *
 * ⚠️ THE ARM IS DISJOINT FROM THE POLICY CARVE-OUT, BY CONSTRUCTION. When the
 * rule is off, its pairs sit on `skippedDisabled`, not kept `skipped`, so this
 * derivation finds nothing there and the existing carve-out speaks
 * byte-identically — pinned by the policy-polarity test below, which runs the
 * SAME fixture under `suppress-rule` and shows the verdict flip on the config
 * key alone.
 *
 * ⚠️ FILE-SCOPED ENTRIES DECLINE WHOLE — the themeless arm's own discipline.
 * The clause's moves are aimed at THIS report's pair, but a file-scoped entry
 * was recorded against ANOTHER stylesheet; the `[file: …]` clauses are what
 * speak for such an entry.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-skipped-aim-"));
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

/** The section's own tellable-case line, quoted by its opening — never a regex. */
const SECTION_LINE =
  "an entry aimed at a pair rule 3 could not measure is a further case this report CAN tell";

/** The clause the ticket's probed entry earns, whole. */
const TRANSLUCENT_CLAUSE =
  ' — its conjuncts match the pair rule 3 could not measure, --card-bg-hover against' +
  ' --card-bg in theme "root" (translucent), printed one section up in skipped; entries' +
  " govern findings only, so this judgement can never silence a skipped row — make the" +
  ' pair measurable (fix the value), accept the silence by turning the rule off with' +
  ' "suppress-rule", or retire the entry.';

/**
 * The ticket's probe sheet: a translucent hover pair — measurable to the eye,
 * unmeasurable to L* (the rule never invents a backdrop) — with both members
 * referenced so `dead-token` stays out of the way.
 */
const PROBE = [
  ":root {",
  "  --card-bg: #1a1a2e;",
  "  --card-bg-hover: rgba(26, 26, 46, 0.55);",
  "}",
  ".x { background: var(--card-bg); }",
  ".y { background: var(--card-bg-hover); }",
].join("\n");

/** The SAME pair, made measurable: the control every arm test needs. */
const MEASURABLE = [
  ":root {",
  "  --card-bg: #1a1a2e;",
  "  --card-bg-hover: #1b1b2f;",
  "}",
  ".x { background: var(--card-bg); }",
  ".y { background: var(--card-bg-hover); }",
].join("\n");

describe("the kept-skipped arm — an entry whose conjuncts match a pair rule 3 could not measure", () => {
  it("names the pair, its silence and the real moves, on a row that still reports unmatched", () => {
    const entry = write("probe/a.css", PROBE);
    config("probe", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);

    // The FENCE first, because the clause must never read as a suppression:
    // nothing is suppressed, the entry is still unmatched, and — the skipped
    // section's own standing contract — the exit code does not move.
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain('skipped (1)');
    expect(result.stdout).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "root": translucent',
    );

    // And the row now says WHERE the judgement aims — the whole line, byte for
    // byte: the existing prefix unchanged, the diagnosis appended.
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "reviewed, translucent by design"' +
        " [tokens: --card-bg, --card-bg-hover]" +
        TRANSLUCENT_CLAUSE,
    );
  });

  it("states the case beside the section's two readings, so the prose and the row agree", () => {
    // Without this line a reader scanning the prose is handed a dichotomy both
    // of whose clauses the row below it contradicts. The carve-out follows the
    // five landed precedents: it prints only when the section actually carries
    // such an entry, so every section it does not apply to stays
    // byte-identical.
    const entry = write("prose/a.css", PROBE);
    config("prose", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain(SECTION_LINE);
    expect(unmatchedRow(result)).toContain(TRANSLUCENT_CLAUSE);
  });

  it("is aimed at a REAL row — the pair made measurable, the entry suppresses the finding it becomes", () => {
    // The clause is only worth printing if its first move is true, so the move
    // is executed here rather than asserted: the same entry against the same
    // token names, the translucent member made opaque. The pair measures, the
    // measurement collapses, the finding prints — and the entry the report
    // almost retired SUPPRESSES it. That is the proof the aim was real.
    const entry = write("real/a.css", MEASURABLE);
    config("real", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("scale-collapse (0)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain('"reviewed, translucent by design"');
    expect(result.stdout).toContain("unmatched (0)");
    expect(result.stdout).toContain("nothing skipped");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("fires on the SCALAR token conjunct too — the arm is conjunct-agnostic", () => {
    // One token name of the pair is enough: the includes semantics are the
    // matcher's own (`token` ⊆ the pair), not a pairs-only special case.
    const entry = write("scalar/a.css", PROBE);
    config("scalar", {
      suppress: [
        { rule: "scale-collapse", token: "--card-bg-hover", reason: "the state member only" },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "the state member only" [token: --card-bg-hover]' +
        TRANSLUCENT_CLAUSE,
    );
  });

  it("fires WITH a theme scope naming the pair's own theme", () => {
    const entry = write("themed/a.css", PROBE);
    config("themed", {
      suppress: [
        {
          rule: "scale-collapse",
          theme: "root",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "root only",
        },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "root only" [theme: root, tokens: --card-bg,' +
        " --card-bg-hover]" +
        TRANSLUCENT_CLAUSE,
    );
  });

  it("a theme scope naming the view where the pair MEASURED fine earns no clause", () => {
    // The negative of the scope test above, and the case the generic advice
    // may genuinely be true of: the winter-local pair below is unmeasurable in
    // `root` (absent) but measured FINE in `winter` (a real step apart, no
    // finding) — so an entry scoped to winter aims at a row that never printed
    // as skipped, and the derivation must stay silent for it. Minting the
    // clause here would trade the false dichotomy for a false diagnosis.
    const entry = write("scoped-miss/a.css", [
      ":root {",
      "  --gap: 4px;",
      "  --gap-hover: 8px;",
      "}",
      '[data-theme="winter"] {',
      "  --w: #101010;",
      "  --w-hover: #202020;",
      "}",
      ".x { background: var(--gap); }",
      ".y { background: var(--gap-hover); }",
      ".z { background: var(--w); }",
      ".w { background: var(--w-hover); }",
    ].join("\n"));
    config("scoped-miss", {
      suppress: [
        { rule: "scale-collapse", theme: "winter", token: "--w", reason: "winter only" },
      ],
    });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "winter only" [token: --w] [theme: winter]',
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
    expect(result.stdout).not.toContain("can never silence a skipped row");
  });
});

describe("the derivation is reason-agnostic — every silence on the kept leg earns it", () => {
  // The four reasons are asked at the LIBRARY level, where one sheet can carry
  // all of them and each row's aim is asserted directly, aligned by index.
  const SHEET = resolveCss(
    [
      ":root {",
      "  --gap: 4px;",
      "  --gap-hover: 8px;", // not-a-color
      "  --u: var(--missing-token);",
      "  --u-hover: #123456;", // unresolvable
      "}",
      '[data-theme="winter"] {',
      "  --w: #101010;",
      "  --w-hover: #202020;", // measurable in winter, ABSENT from root
      "}",
      ":root {",
      "  --t: #123456;",
      "  --t-hover: rgba(18, 52, 86, 0.5);", // translucent
      "}",
      ".a { background: var(--gap); }",
      ".b { background: var(--gap-hover); }",
      ".c { background: var(--u); }",
      ".d { background: var(--u-hover); }",
      ".e { background: var(--w); }",
      ".f { background: var(--w-hover); }",
      ".g { background: var(--t); }",
      ".h { background: var(--t-hover); }",
    ].join("\n"),
  );
  const report = audit(SHEET);
  const pairAt = (base: string, theme: string): SkippedPair | undefined =>
    report.skipped.find((p) => p.base === base && p.theme === theme);
  const aimFor = (entry: Record<string, unknown>): ReturnType<typeof skippedAims>[number] =>
    skippedAims([entry as never], report.skipped)[0];

  it("carries all four reasons on the kept leg, and the aim names each pair's own silence", () => {
    expect([...new Set(report.skipped.map((p) => p.reason))].sort()).toEqual([
      "absent",
      "not-a-color",
      "translucent",
      "unresolvable",
    ]);
    for (const [base, theme] of [
      ["--gap", "root"],
      ["--u", "root"],
      ["--w", "root"],
      ["--t", "root"],
    ] as const) {
      const pair = pairAt(base, theme);
      expect(pair).toBeDefined();
      expect(
        aimFor({ rule: "scale-collapse", tokens: [pair!.base, pair!.state], reason: "r" }),
      ).toEqual({
        theme: pair!.theme,
        base: pair!.base,
        state: pair!.state,
        reason: pair!.reason,
      });
    }
  });

  it("declines an entry whose TOKENS match no pair the report carries", () => {
    expect(
      aimFor({ rule: "scale-collapse", tokens: ["--absent-a", "--absent-b"], reason: "r" }),
    ).toBeUndefined();
    expect(aimFor({ rule: "scale-collapse", token: "--no-such-token", reason: "r" })).toBeUndefined();
  });

  it("declines an entry of ANOTHER rule — identity is rule equality first", () => {
    expect(aimFor({ rule: "collision", tokens: ["--t", "--t-hover"], reason: "r" })).toBeUndefined();
  });

  it("keeps ONE pointer, not a census — the first matching pair in report order", () => {
    // Two rows carry the same token pair under two themes in this sheet? No —
    // the sharp form is the --gap pair, which is skipped once PER THEME. One
    // unscoped entry matches both rows; the aim is the FIRST slot's pair.
    const unscoped = aimFor({ rule: "scale-collapse", token: "--gap", reason: "r" });
    expect(unscoped).toEqual({
      theme: "root",
      base: "--gap",
      state: "--gap-hover",
      reason: "not-a-color",
    });
  });
});

describe("the arms that KEEP the existing advice — the diagnosis is the kept-skipped one only", () => {
  it("an entry aimed at a MEASURABLE pair suppresses the finding and earns no clause", () => {
    // The control for the whole arm: the same token names, an opaque pair. The
    // measurement collapses, the entry covers the finding, nothing is
    // unmatched, and the section (and its sixth line) never prints.
    const entry = write("measurable/a.css", MEASURABLE);
    config("measurable", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (0)");
    expect(unmatchedRow(result)).toBeUndefined();
    expect(result.stdout).not.toContain("can never silence a skipped row");
    expect(result.stdout).not.toContain(SECTION_LINE);
  });

  it("an entry matching no pair at all keeps the generic prose only", () => {
    const entry = write("nomatch/a.css", PROBE);
    config("nomatch", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--never-declared", "--never-declared-hover"],
          reason: "aims at nothing real",
        },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "aims at nothing real"' +
        " [tokens: --never-declared, --never-declared-hover]",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
  });
});

describe("the POLICY arm is byte-identical — the two carve-outs are disjoint by construction", () => {
  it("the same fixture under suppress-rule moves the pair to skipped-disabled and the entry to the policy carve-out", () => {
    // The ticket's sharpening probe, pinned: an IDENTICAL aim, one config key
    // apart, earns a different carve-out — and the kept-skipped arm stays out
    // of the way entirely. A disabled rule's pairs sit on `skippedDisabled`,
    // never kept `skipped`, so the derivation finds nothing there; the policy
    // line speaks alone.
    const entry = write("policy/a.css", PROBE);
    config("policy", {
      "suppress-rule": ["scale-collapse"],
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("skipped (0)");
    expect(result.stdout).toContain("skipped-disabled (1)");
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain(
      "an entry whose rule the project turned OFF in \"suppress-rule\" is a further case this report CAN tell",
    );
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "reviewed, translucent by design"' +
        " [tokens: --card-bg, --card-bg-hover] — [scale-collapse] is disabled by this" +
        ' project\'s "suppress-rule" policy, so the judgement can never match while the' +
        " rule is off: re-enable the rule, or retire the entry.",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
    expect(result.stdout).not.toContain("can never silence a skipped row");
  });
});

describe("a file-scoped entry DECLINES — the themeless arm's own discipline", () => {
  it("a `file` scope aimed at a kept pair earns no clause; its own carve-out stands", () => {
    // The clause's moves are aimed at THIS report's pair, but the entry was
    // recorded against ANOTHER stylesheet — whose own skipped rows this report
    // holds none of. The `[file: …]` clauses are what speak for such an entry.
    const entry = write("filescope/a.css", PROBE);
    write("filescope/sibling.css", ":root { --s: #101010; }\n.s { color: var(--s); }\n");
    config("filescope", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          file: "sibling.css",
          reason: "recorded against the sibling",
        },
      ],
    });
    const result = run(entry);
    expect(result.stdout).toContain("unmatched (1)");
    expect(unmatchedRow(result)).toBe(
      '  [unmatched] [scale-collapse] — "recorded against the sibling"' +
        " [tokens: --card-bg, --card-bg-hover] [file: sibling.css]",
    );
    expect(result.stdout).not.toContain(SECTION_LINE);
    expect(result.stdout).not.toContain("can never silence a skipped row");
    expect(result.stdout).toContain("an entry carrying a [file: …] clause names the stylesheet");
  });
});

describe("co-firing — an entry matching a foreign finding AND a kept pair renders BOTH clauses", () => {
  it("the cross-file clause and the kept-skipped clause compose on one row, in that order", () => {
    // The directive below aims across the `@import` edge at the tokens.css
    // winter collapse (cross-file arm) and, by the same token names' luck, at
    // main.css's own translucent root pair (kept-skipped arm). BOTH arms of
    // this composition need the entry's rule to be `scale-collapse`: the pair
    // adapter names that rule, so the foreign finding must be a
    // scale-collapse finding too — a winter-local MEASURABLE collapse in the
    // import, while the entry file's own pair is translucent and kept.
    // Clause order is the renderer's own: crossFileClause, then the
    // kept-skipped clause, then the disabled clause — the family's landed
    // order, the new clause inserted after `themelessClause`.
    write("cofire/tokens.css", [
      '[data-theme="winter"] {',
      "  --x: #101010;",
      "  --x-hover: #121212;",
      "}",
    ].join("\n"));
    const entry = write(
      "cofire/main.css",
      [
        '@import "./tokens.css";',
        "/* themeguard-ignore scale-collapse --x -- aimed across the edge */",
        ":root {",
        "  --x: #1a1a2e;",
        "  --x-hover: rgba(26, 26, 46, 0.55);",
        "}",
        ".x { background: var(--x); }",
        ".y { background: var(--x-hover); }",
      ].join("\n"),
    );
    const result = run(entry);
    expect(result.code).toBe(EXIT_FINDINGS); // the winter collapse prints, live
    expect(result.stdout).toContain("unmatched (1)");
    const row = unmatchedRow(result);
    expect(row).toBeDefined();
    // Both clauses on one row, in the family's order: the cross-file aim
    // first, then the kept-skipped clause. Pinned by index rather than by
    // whole-line equality — the source clause cites the directive's own
    // (temporary) path.
    const crossFileAt = row!.indexOf("matches a live [scale-collapse] finding at tokens.css:2");
    const skippedAt = row!.indexOf("its conjuncts match the pair rule 3 could not measure");
    expect(crossFileAt).toBeGreaterThan(-1);
    expect(skippedAt).toBeGreaterThan(crossFileAt);
    expect(row).toContain("its conjuncts match the pair rule 3 could not measure," +
      ' --x-hover against --x in theme "root" (translucent)');
    // Both case lines share the section.
    expect(result.stdout).toContain("a third case this report CAN tell");
    expect(result.stdout).toContain(SECTION_LINE);
  });
});

describe("--json carries the same diagnosis as data", () => {
  it("adds `skippedAim` to the unmatched row, and to no other row", () => {
    const entry = write("json/a.css", PROBE);
    config("json", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
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
    // The pair is still unmeasured in the data, exactly as the prose reports.
    expect(report.skipped).toHaveLength(1);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    // Every existing key is untouched, and the diagnosis rides beside them.
    expect(row).toMatchObject({
      rule: "scale-collapse",
      tokens: ["--card-bg", "--card-bg-hover"],
      reason: "reviewed, translucent by design",
    });
    expect(row.skippedAim).toEqual({
      theme: "root",
      base: "--card-bg",
      state: "--card-bg-hover",
      reason: "translucent",
    });
    // The sibling keys are not minted by this arm.
    expect("crossFileAim" in row).toBe(false);
    expect("themelessAim" in row).toBe(false);
  });

  it("OMITS the key on a row with no kept pair rather than emitting null", () => {
    // The same absence-is-a-fact discipline `sites`, `crossFileAim` and
    // `themelessAim` carry: a consumer reads `skippedAim` as "the diagnosis,
    // IF the report has one to give", and `null` would invent a value the
    // report never had.
    const entry = write("json-none/a.css", MEASURABLE);
    config("json-none", {
      suppress: [
        {
          rule: "unresolved-reference",
          token: "--no-such-token",
          reason: "aims at nothing",
        },
      ],
    });
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect("skippedAim" in (report.unmatchedSuppressions[0] as object)).toBe(false);
  });

  it("carries the key on the policy fixture's rows NOT AT ALL — no machine-readable self-contradiction", () => {
    // The disabled row's truth is "one policy decision away from working"; a
    // `skippedAim` beside it would claim the report still holds an unmeasured
    // pair the entry matches — it does not, the policy moved the pair. The two
    // claims must never ride one row.
    const entry = write("json-policy/a.css", PROBE);
    config("json-policy", {
      "suppress-rule": ["scale-collapse"],
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const report = JSON.parse(run("--json", entry).out[0] as string) as {
      unmatchedSuppressions: Record<string, unknown>[];
    };
    expect(report.unmatchedSuppressions).toHaveLength(1);
    const row = report.unmatchedSuppressions[0] as Record<string, unknown>;
    expect("skippedAim" in row).toBe(false);
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
        rule: "scale-collapse" as const,
        tokens: ["--card-bg", "--card-bg-hover"],
        reason: "reviewed, translucent by design",
      },
    ];
    const report = audit(resolved, { suppressions });
    expect(report.unmatchedSuppressions).toHaveLength(1);

    const bare = formatReport(entry, report);
    expect(bare.find((l) => l.startsWith("  [unmatched] "))).not.toContain(
      "can never silence a skipped row",
    );
    expect(bare.join("\n")).not.toContain(SECTION_LINE);
    expect(JSON.parse(formatReportJson(entry, report))).toEqual({ path: entry, ...report });

    // Handed the diagnosis, the SAME report renders the clause — so the
    // argument is what the CLI supplies, never a second derivation inside the
    // renderer.
    const aims = skippedAims(report.unmatchedSuppressions, report.skipped);
    expect(
      formatReport(entry, report, [], [], aims).find((l) => l.startsWith("  [unmatched] ")),
    ).toContain(TRANSLUCENT_CLAUSE);
  });
});

describe("the derivation reads the matcher's own semantics — never a re-derived twin", () => {
  it("declines both file-scope spellings, and earns the aim without one", () => {
    // The gate reads the scope exactly as `matches` reads it: `fileResolved`
    // once the CLI has resolved one, the entry's own spelling otherwise.
    const finding = { theme: "root", base: "--card-bg", state: "--card-bg-hover", reason: "translucent" as const };
    const resolvedSpelling = {
      rule: "scale-collapse" as const,
      tokens: ["--card-bg", "--card-bg-hover"],
      fileResolved: "/elsewhere/sibling.css",
      reason: "sibling only",
    };
    const writtenSpelling = {
      rule: "scale-collapse" as const,
      tokens: ["--card-bg", "--card-bg-hover"],
      file: "sibling.css",
      reason: "sibling only",
    };
    expect(skippedAims([resolvedSpelling], [finding])).toEqual([undefined]);
    expect(skippedAims([writtenSpelling], [finding])).toEqual([undefined]);
    // And the SAME entry without the scope DOES earn it — so the declines
    // above are the file gate firing, not some other conjunct failing.
    const unscoped = {
      rule: "scale-collapse" as const,
      tokens: ["--card-bg", "--card-bg-hover"],
      reason: "sibling only",
    };
    expect(skippedAims([unscoped], [finding])).toEqual([
      { theme: "root", base: "--card-bg", state: "--card-bg-hover", reason: "translucent" },
    ]);
  });

  it("matchesEntryIdentity asks the identity conjuncts ALONE — the pair adapter proves the includes semantics are the matcher's own", () => {
    // The pair's own adapter, exercised through the derivation: a scalar
    // `token` matches when it names EITHER member, a `tokens` set only when
    // EVERY name is carried, the theme conjunct is strict, and another rule
    // never matches. The pair below is a real `SkippedPair` shape — the
    // adapter builds its target FROM base and state, so a shapeless stub
    // would test the adapter, not the conjuncts.
    const pair: SkippedPair = {
      theme: "root",
      base: "--a",
      state: "--a-hover",
      reason: "translucent",
    };
    const entry = { rule: "scale-collapse" as const, reason: "r" };
    const aim = { theme: "root", base: "--a", state: "--a-hover", reason: "translucent" };
    expect(skippedAims([{ ...entry, token: "--a" }], [pair])).toEqual([aim]);
    expect(skippedAims([{ ...entry, token: "--a-hover" }], [pair])).toEqual([aim]);
    expect(skippedAims([{ ...entry, tokens: ["--a", "--a-hover"] }], [pair])).toEqual([aim]);
    // A set naming one token the pair does not carry fails the includes-check.
    expect(
      skippedAims([{ ...entry, tokens: ["--a", "--absent"] }], [pair]),
    ).toEqual([undefined]);
    // The theme conjunct is strict: another theme's scope misses.
    expect(
      skippedAims([{ ...entry, theme: "winter", token: "--a" }], [pair]),
    ).toEqual([undefined]);
    // Another rule never matches.
    expect(
      skippedAims([{ rule: "collision" as const, token: "--a", reason: "r" }], [pair]),
    ).toEqual([undefined]);
  });

  it("the matching semantics are untouched — the same entry suppresses nothing, and the pair stays skipped", () => {
    // The slice's headline fence, asked of the library directly: the entry is
    // on the unmatched leg, `suppressed` is empty, the counts are the counts
    // they always were, and the skipped channel carries the pair.
    const entry = write("fence/a.css", PROBE);
    const resolved = resolveStylesheet(loadStylesheet(entry));
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "scale-collapse" as const,
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.skipped).toHaveLength(1);
    expect(report.countsByRule["scale-collapse"]).toBe(0);
    expect(report.findings).toHaveLength(0);
  });

  it("a clean sheet with a kept-skipped entry still exits 0 — the section is outside the exit", () => {
    // The entry is unmatched and diagnosed, and the exit stays the
    // unsuppressed-findings question it has always been — the ticket's own
    // probe contract.
    const entry = write("exit/a.css", PROBE);
    config("exit", {
      suppress: [
        {
          rule: "scale-collapse",
          tokens: ["--card-bg", "--card-bg-hover"],
          reason: "reviewed, translucent by design",
        },
      ],
    });
    const result = run(entry);
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("unmatched (1)");
    expect(result.stdout).toContain("No findings.");
  });
});
