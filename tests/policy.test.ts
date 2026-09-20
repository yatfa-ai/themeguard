import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfig, parseConfigDocument } from "../src/config.js";
import { loadStylesheet } from "../src/load.js";
import { resolveStylesheet } from "../src/resolve.js";
import type { RuleId } from "../src/rules/finding.js";
import {
  EXIT_FINDINGS,
  EXIT_OK,
  formatReport,
  runCli,
  type CliIo,
} from "../src/cli.js";
import { fixtureCss, fixtureStubCss, FIXTURE_PATH } from "./fixture.js";

/**
 * The project-level RULE POLICY — the `suppress-rule` config key (YATFA-8490).
 *
 * The per-finding ledger judges ONE finding at a time, and no list of entries
 * can say "we have looked at this RULE for THIS PROJECT and judged it
 * not-a-defect" — that answer is wholesale. The policy is that judgement: an
 * array of rule ids whose findings leave `findings` and the counts for the
 * counted `suppressedDisabled` leg, printed by the CLI as its
 * `suppressed-disabled` section, outside the exit code like every other
 * recorded set-aside.
 *
 * Three layers, tested at the layer that owns the behaviour:
 *
 *   - `parseConfigDocument` owns the validation: the key must be an array of
 *     rule ids this package knows, an unknown element is an ERROR naming it,
 *     an empty array is legal and disables nothing, and an absent key parses
 *     byte-identically to the one-key config. `parseConfig` is the
 *     entries-only view over the same document — the door the directive
 *     scanner round-trips through — and must be unchanged by the second key.
 *   - `audit` owns the partition: the policy check PRECEDES the per-entry
 *     match (a disabled rule's findings never reach the entry loop, so an
 *     entry naming a disabled rule stays UNMATCHED rather than claiming what
 *     the policy took away), the counts read the kept findings only, and the
 *     one-arg call is byte-identical.
 *   - `runCli` / `formatReport` own the report: the counted section prints
 *     even at zero, the rows carry the policy's marker, the exit is computed
 *     over kept findings only, and the `unmatched` section tells a reader
 *     whose entry names a disabled rule the truth — a disabled rule cannot
 *     match; re-enable or retire — instead of retirement advice that would
 *     be false there.
 *
 * The census this suite pins on the fixture copy is the 22-finding one every
 * other suite pins: disabling `dead-token` must move exactly its 2 findings —
 * 11 / 0 / 2 / 7 = 20 — the findings move, they do not vanish.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-policy-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function write(rel: string, contents: string): string {
  const path = join(tmp, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
  return path;
}

function config(dir: string, document: object): void {
  write(`${dir}/themeguard.config.json`, JSON.stringify(document));
}

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly stdout: string;
}

function run(...args: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, out, err, stdout: out.join("\n") };
}

/** The one dead-token finding, the cheapest kind to summon deterministically. */
const ONE_DEAD_TOKEN_CSS = `
:root {
  --used: #101010;
  --unused: #202020;
}

.x { color: var(--used); }
`;

/**
 * Findings from TWO rules, so a policy that turns one rule off must leave the
 * other's findings live and holding the exit code: --unused is dead, and the
 * hover is a hair under 4 L* from its base, so the sheet reports one
 * dead-token finding and one scale-collapse finding and nothing else.
 */
const TWO_RULE_CSS = `
:root {
  --used: #101010;
  --unused: #909090;
  --panel: #202020;
  --panel-hover: #252525;
}

.x { color: var(--used); }
.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
`;

const TWO_RULE_PATH = write("two-rule.css", TWO_RULE_CSS);
const ONE_DEAD_TOKEN_PATH = write("one-dead-token.css", ONE_DEAD_TOKEN_CSS);

/** The vendored fixture copied OUT of tests/fixtures/ (whose census every other suite pins), with its stub travelling beside it — so a config can govern the copy without touching the vendored tree. The copy's census stays the 22-finding calibration report. */
const FIXTURE_COPY_DIR = join(tmp, "fixture-copy");
mkdirSync(FIXTURE_COPY_DIR, { recursive: true });
const FIXTURE_COPY = write("fixture-copy/sheet.css", fixtureCss());
write("fixture-copy/actiontext.css", fixtureStubCss());

function auditTwoRule(disabledRules?: readonly RuleId[]) {
  return audit(resolveStylesheet(loadStylesheet(TWO_RULE_PATH)), {
    ...(disabledRules === undefined ? {} : { disabledRules }),
  });
}

describe("parseConfigDocument — the policy key validates with suppress's own discipline", () => {
  it("reads the policy shape, entries absent", () => {
    expect(parseConfigDocument('{"suppress-rule": ["dead-token"]}', "mem/config.json")).toEqual({
      suppress: [],
      disabledRules: ["dead-token"],
    });
    expect(
      parseConfigDocument(
        '{"suppress-rule": ["dead-token", "collision"]}',
        "mem/config.json",
      ),
    ).toEqual({ suppress: [], disabledRules: ["dead-token", "collision"] });
  });

  it("reads both keys from one document — each half whole", () => {
    expect(
      parseConfigDocument(
        JSON.stringify({
          suppress: [{ rule: "collision", token: "--a", reason: "deliberate" }],
          "suppress-rule": ["dead-token"],
        }),
        "mem/config.json",
      ),
    ).toEqual({
      suppress: [{ rule: "collision", token: "--a", reason: "deliberate" }],
      disabledRules: ["dead-token"],
    });
  });

  it("an empty array is legal and disables nothing; neither key is required", () => {
    expect(parseConfigDocument('{"suppress-rule": []}', "mem/config.json")).toEqual({
      suppress: [],
      disabledRules: [],
    });
    expect(parseConfigDocument("{}", "mem/config.json")).toEqual({
      suppress: [],
      disabledRules: [],
    });
  });

  it("an unknown rule id is an ERROR naming the element, with the entry sentence's list", () => {
    expect(() =>
      parseConfigDocument(
        '{"suppress-rule": ["dead-token", "no-such-rule"]}',
        "mem/config.json",
      ),
    ).toThrowError(
      /element 2 of "suppress-rule": unknown rule "no-such-rule" — expected one of collision, dead-token/,
    );
  });

  it("a non-string element is the same refusal, naming what was written", () => {
    expect(() =>
      parseConfigDocument('{"suppress-rule": [42]}', "mem/config.json"),
    ).toThrowError(/element 1 of "suppress-rule": unknown rule 42 — expected one of /);
  });

  it("a non-array policy is an error, the suppress array sentence's shape", () => {
    expect(() =>
      parseConfigDocument('{"suppress-rule": "dead-token"}', "mem/config.json"),
    ).toThrowError(/"suppress-rule" must be an array of rule ids, got "dead-token"/);
  });

  it("an unknown top-level key still refuses, now naming both keys it knows", () => {
    expect(() =>
      parseConfigDocument('{"rules": ["dead-token"]}', "mem/config.json"),
    ).toThrowError(/unknown key "rules" — expected "suppress" or "suppress-rule"/);
  });

  it("parseConfig is the entries-only view, unchanged by the policy key", () => {
    expect(
      parseConfig(
        JSON.stringify({
          suppress: [{ rule: "collision", token: "--a", reason: "deliberate" }],
          "suppress-rule": ["dead-token"],
        }),
        "mem/config.json",
      ),
    ).toEqual([{ rule: "collision", token: "--a", reason: "deliberate" }]);
    expect(parseConfig('{"suppress-rule": ["dead-token"]}', "mem/config.json")).toEqual([]);
  });

  it("loadConfig keeps its entries-only contract on a policy-only config", () => {
    expect(parseConfig('{"suppress-rule": ["dead-token"]}', "mem/config.json")).toEqual([]);
  });
});

describe("audit — the partition widens", () => {
  it("a disabled rule's findings move out of findings and the counts, onto the leg, whole", () => {
    const report = auditTwoRule(["dead-token"]);
    expect(report.findings.map((f) => f.rule)).toEqual(["scale-collapse"]);
    // The population moved, it did not vanish from the vocabulary: the key
    // stays, reading the kept findings only.
    expect(report.countsByRule["dead-token"]).toBe(0);
    expect(report.countsByRule["scale-collapse"]).toBe(1);
    expect(report.suppressedDisabled).toHaveLength(1);
    const row = report.suppressedDisabled[0]!;
    expect(row.rule).toBe("dead-token");
    expect(row.finding.tokens).toContain("--unused");
    // The policy names rules, not prose: one reason, verbatim, every row.
    expect(row.reason).toBe("[disabled by policy]");
    expect(row.finding).toBe(row.finding);
  });

  it("reports the policy rows in the report's own reading order", () => {
    // Two dead tokens → two policy rows, in the sorted order findings print in.
    const path = write(
      "two-dead.css",
      `:root {
  --used: #101010;
  --unused-a: #202020;
  --unused-b: #303030;
}

.x { color: var(--used); }
`,
    );
    const report = audit(resolveStylesheet(loadStylesheet(path)), {
      disabledRules: ["dead-token"],
    });
    expect(report.findings).toHaveLength(0);
    expect(report.suppressedDisabled.map((r) => r.finding.tokens)).toEqual([
      ["--unused-a"],
      ["--unused-b"],
    ]);
  });

  it("the policy check precedes the per-entry match: an entry naming a disabled rule stays UNMATCHED", () => {
    const report = auditTwoRule(["dead-token"]);
    const entry = { rule: "dead-token" as const, token: "--unused", reason: "judged wholesale" };
    const withEntry = audit(resolveStylesheet(loadStylesheet(TWO_RULE_PATH)), {
      suppressions: [entry],
      disabledRules: ["dead-token"],
    });
    // The entry never claimed the policy's set-aside: the finding is on the
    // policy leg, the entry is on the complement, where the report can tell
    // its author the rule is off.
    expect(withEntry.suppressed).toHaveLength(0);
    expect(withEntry.unmatchedSuppressions).toEqual([entry]);
    expect(withEntry.suppressedDisabled).toEqual(report.suppressedDisabled);
  });
  it("an entry naming a LIVE rule still suppresses, byte-identically, beside a policy", () => {
    const entry = {
      rule: "scale-collapse" as const,
      token: "--panel-hover",
      reason: "deliberately subtle hover",
    };
    const withEntry = audit(resolveStylesheet(loadStylesheet(TWO_RULE_PATH)), {
      suppressions: [entry],
      disabledRules: ["dead-token"],
    });
    expect(withEntry.findings).toHaveLength(0);
    expect(withEntry.suppressed).toEqual([
      { finding: withEntry.suppressed[0]!.finding, reason: entry.reason, entry },
    ]);
    expect(withEntry.countsByRule["scale-collapse"]).toBe(0);
  });

  it("the one-arg call and an empty policy produce the identical report", () => {
    expect(auditTwoRule()).toEqual(auditTwoRule([]));
  });

  it("a policy naming a rule with nothing to report changes nothing at all", () => {
    const plain = auditTwoRule();
    const quiet = auditTwoRule(["cycle-reference"]);
    expect(quiet).toEqual(plain);
    expect(quiet.suppressedDisabled).toEqual([]);
  });
});

describe("the CLI — the counted section, the exit, and the unmatched truth", () => {
  it("the section prints even at ZERO — an empty section is the proof no rule is off", () => {
    const result = run(FIXTURE_PATH);
    expect(result.out).toContain("suppressed-disabled (0)");
    expect(result.out).toContain(
      "  nothing disabled by policy — every finding above was reported by a rule the project has not turned off.",
    );
    // The census is untouched: the new section is additive, and every other
    // line — counts, total, exit — is byte-identical to before the key.
    expect(result.out).toContain("collision (11)");
    expect(result.out).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
    );
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("the section sits between `unmatched` and `coverage`, mirroring the report object", () => {
    const lines = formatReport(FIXTURE_PATH, audit(resolveStylesheet(loadStylesheet(FIXTURE_PATH))));
    const unmatched = lines.findIndex((l) => l === "unmatched (0)");
    const disabled = lines.findIndex((l) => l === "suppressed-disabled (0)");
    const coverage = lines.findIndex((l) => l.startsWith("coverage ("));
    expect(unmatched).toBeGreaterThan(-1);
    expect(disabled).toBe(unmatched + 3); // zero line and blank between the headlines
    expect(coverage).toBeGreaterThan(disabled);
  });

  it("a disabled rule's findings print counted and marked, and the counts read the kept findings", () => {
    const dir = join(tmp, "policy-on-two-rule");
    mkdirSync(dir, { recursive: true });
    const path = write("policy-on-two-rule/sheet.css", TWO_RULE_CSS);
    config("policy-on-two-rule", { "suppress-rule": ["dead-token"] });
    const result = run(path);
    expect(result.out).toContain("dead-token (0)");
    expect(result.out).toContain("scale-collapse (1)");
    expect(result.out).toContain("suppressed-disabled (1)");
    expect(result.out).toContain(
      '  findings reported by a rule the project turned off — its id is named in the "suppress-rule" key of themeguard.config.json. Counted here, named below — out of the counts and the exit code by project policy, never by silence.',
    );
    const row = result.out.find((l) => l.startsWith("  [disabled by policy] [dead-token] "));
    expect(row).toBeDefined();
    expect(row).toContain("--unused");
    expect(result.stdout).toContain("1 finding: 0 collision, 0 dead-token, 1 scale-collapse");    // The live finding holds the exit: the policy moved the dead token, not
    // the verdict over what remains.
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("a stylesheet whose ONLY findings the policy set aside exits 0", () => {
    const path = write("policy-all/sheet.css", ONE_DEAD_TOKEN_CSS);
    config("policy-all", { "suppress-rule": ["dead-token"] });
    const result = run(path);
    expect(result.out).toContain("suppressed-disabled (1)");
    expect(result.out).toContain("No findings.");
    expect(result.code).toBe(EXIT_OK);
  });

  it("an unknown rule id in the policy exits 2 naming the element, never a silent policy", () => {
    const path = write("policy-bad/sheet.css", ONE_DEAD_TOKEN_CSS);
    config("policy-bad", { "suppress-rule": ["no-such-rule"] });
    const result = run(path);
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toMatch(
      /element 1 of "suppress-rule": unknown rule "no-such-rule"/,
    );
  });

  it("the fixture census moves by exactly the disabled rule's findings — 22 to 20", () => {
    const path = write("policy-fixture/sheet.css", fixtureCss());
    write("policy-fixture/actiontext.css", fixtureStubCss());
    config("policy-fixture", { "suppress-rule": ["dead-token"] });
    const result = run(path);
    expect(result.out).toContain("dead-token (0)");
    expect(result.out).toContain("suppressed-disabled (2)");
    expect(result.out).toContain("collision (11)");
    expect(result.out).toContain("scale-collapse (2)");
    expect(result.out).toContain("family-consistency (7)");
    expect(result.out).toContain(
      "20 findings: 11 collision, 0 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
    );
    // Both dead-token findings carry the marker, whole with their messages.
    const rows = result.out.filter((l) => l.startsWith("  [disabled by policy] [dead-token] "));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("--topbar-height");
    expect(rows[1]).toContain("--transition-slow");
    expect(result.code).toBe(EXIT_FINDINGS);
  });
});

describe("the unmatched interaction — the entry a policy disabled", () => {
  it("an entry naming a disabled REPORTING rule earns the honest clause, not retirement advice", () => {
    const path = write("policy-entry/sheet.css", ONE_DEAD_TOKEN_CSS);
    config("policy-entry", {
      suppress: [
        { rule: "dead-token", token: "--unused", reason: "reserved for the print stylesheet" },
      ],
      "suppress-rule": ["dead-token"],
    });
    const result = run(path);
    // The finding is policy-suppressed; the entry matched nothing, and the
    // section says WHY instead of offering the two false readings.
    expect(result.out).toContain("suppressed-disabled (1)");
    expect(result.out).toContain("unmatched (1)");
    expect(result.out).toContain(
      '  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell: a disabled rule reports into the counted policy sections of this report — suppressed-disabled for its findings, skipped-disabled for the pairs it could not measure — and can never match, so this judgement is neither expired nor mis-aimed — it is one policy decision away from working. Re-enable the rule, or retire the entry.',
    );
    const row = result.out.find((l) => l.startsWith("  [unmatched] "));
    expect(row).toBeDefined();
    expect(row).toContain(
      ' — [dead-token] is disabled by this project\'s "suppress-rule" policy, so the judgement can never match while the rule is off: re-enable the rule, or retire the entry.',
    );
    expect(result.code).toBe(EXIT_OK);
  });

  it("an entry beside a policy naming a LIVE rule keeps its row byte-identical", () => {
    const path = write("policy-entry-live/sheet.css", TWO_RULE_CSS);
    config("policy-entry-live", {
      suppress: [
        { rule: "scale-collapse", token: "--panel-hover", reason: "deliberately subtle hover" },
      ],
      "suppress-rule": ["dead-token"],
    });
    const result = run(path);
    expect(result.out).toContain("suppressed (1)");
    expect(result.out).toContain("suppressed-disabled (1)");
    expect(result.out).toContain("unmatched (0)");
    // No carve-out paragraph: no unmatched entry qualifies.
    expect(
      result.out.some((l) => l.includes("suppress-rule") && l.startsWith("  an entry whose rule")),
    ).toBe(false);
  });

  it("a disabled-but-SILENT rule's entry keeps the ordinary advice — the clause claims only a reporting rule", () => {
    // `cycle-reference` is off and reported nothing: the entry naming it is
    // unmatched for the ORDINARY reason (there was nothing to match), and
    // "the defect was fixed" may be exactly true — so the paragraph and the
    // clause stay out, and the zero policy section prints instead.
    const path = write("policy-silent/sheet.css", ONE_DEAD_TOKEN_CSS);
    config("policy-silent", {
      suppress: [{ rule: "cycle-reference", token: "--unused", reason: "no loops here" }],
      "suppress-rule": ["cycle-reference"],
    });
    const result = run(path);
    expect(result.out).toContain("suppressed-disabled (0)");
    expect(result.out).toContain("unmatched (1)");
    expect(
      result.out.some((l) => l.includes("suppress-rule") && l.startsWith("  an entry whose rule")),
    ).toBe(false);
    const row = result.out.find((l) => l.startsWith("  [unmatched] "));
    expect(row).toBeDefined();
    expect(row).not.toContain("disabled by this project");
  });

  it("a directive naming a disabled rule is unmatched with the same truth", () => {
    const path = write(
      "policy-directive/sheet.css",
      ONE_DEAD_TOKEN_CSS.replace(
        "  --unused: #202020;",
        "  /* themeguard-ignore dead-token -- reserved for the print stylesheet */\n  --unused: #202020;",
      ),
    );
    config("policy-directive", { "suppress-rule": ["dead-token"] });
    const result = run(path);
    expect(result.out).toContain("suppressed-disabled (1)");
    expect(result.out).toContain("unmatched (1)");
    expect(result.stdout).toContain(
      '  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell:',
    );
    const row = result.out.find((l) => l.startsWith("  [unmatched] "));
    expect(row).toBeDefined();
    expect(row).toContain("re-enable the rule, or retire the entry");
  });
});

/**
 * THE SKIPPED CHANNEL — the policy partitions the report's SECOND output.
 *
 * `scale-collapse` is the one rule with two output channels: it returns a
 * `{findings, skipped}` pair where every other rule returns `Finding[]`, so
 * the findings-only partition loop left its skipped rows on the report
 * byte-identically to the no-policy control — a machine consumer reading
 * `suppressedDisabled: []` concluded the rule was silent while the same
 * object carried its output. The skipped channel now partitions at the same
 * `disabled` set onto `skippedDisabled`, counted and named in the skipped
 * section, and the unmatched section's carve-out derives its reporting-rule
 * fact from BOTH legs — a skipped-only disabled rule earns the
 * one-policy-decision-away truth instead of retirement advice.
 */
describe("the skipped channel — the policy partitions the second output", () => {
  /**
   * Skipped rows WITHOUT scale-collapse findings: a translucent pair and a
   * pair of lengths — both arms the skip branch reports, and neither one a
   * finding. `--used` gives the sheet one live token so it is a real audit.
   */
  const SKIPPED_ONLY_CSS = `
:root {
  --scrim: #ffffff33;
  --scrim-hover: #ffffff55;
  --gap: 4px;
  --gap-hover: 8px;
  --used: #101010;
}

.x { background: var(--scrim) var(--gap) var(--used); }
.y { background: var(--scrim-hover) var(--gap-hover); }
`;

  /**
   * BOTH channels at once: the two-rule sheet's real scale-collapse finding
   * (--panel/--panel-hover sit under 4 L* apart) beside a translucent pair.
   */
  const COMPOSITE_CSS = `
:root {
  --used: #101010;
  --unused: #909090;
  --panel: #202020;
  --panel-hover: #252525;
  --scrim: #ffffff33;
  --scrim-hover: #ffffff55;
}

.x { color: var(--used); }
.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
.scrim { background: var(--scrim); }
.scrim:hover { background: var(--scrim-hover); }
`;

  const SKIPPED_ONLY_PATH = write("skipped-only.css", SKIPPED_ONLY_CSS);
  const COMPOSITE_PATH = write("composite.css", COMPOSITE_CSS);

  function auditOf(path: string, disabledRules?: readonly RuleId[]) {
    return audit(resolveStylesheet(loadStylesheet(path)), {
      ...(disabledRules === undefined ? {} : { disabledRules }),
    });
  }

  it("a disabled scale-collapse's skipped pairs move off `skipped`, whole, onto `skippedDisabled`", () => {
    const plain = auditOf(SKIPPED_ONLY_PATH);
    // The sheet really does carry skipped rows and no scale-collapse
    // findings — the exact population the old partition left leaking.
    expect(plain.findings.map((f) => f.rule)).toEqual([]);
    expect(plain.skipped).toHaveLength(2);
    expect(plain.skippedDisabled).toEqual([]);

    const policy = auditOf(SKIPPED_ONLY_PATH, ["scale-collapse"]);
    // The population moved, it did not vanish: the kept leg is empty and
    // the set-aside carries the pairs whole, in the rule's own reading
    // order, under the policy's marker.
    expect(policy.skipped).toEqual([]);
    expect(policy.findings).toEqual([]);
    expect(policy.skippedDisabled).toHaveLength(2);
    expect(
      policy.skippedDisabled.map((row) => ({
        theme: row.skipped.theme,
        base: row.skipped.base,
        state: row.skipped.state,
        reason: row.skipped.reason,
      })),
    ).toEqual(
      plain.skipped.map((pair) => ({
        theme: pair.theme,
        base: pair.base,
        state: pair.state,
        reason: pair.reason,
      })),
    );
    // The policy names rules, not prose — the same marker the findings leg
    // carries — while each pair's own skip reason stays nested, untouched.
    for (const row of policy.skippedDisabled) {
      expect(row.rule).toBe("scale-collapse");
      expect(row.reason).toBe("[disabled by policy]");
    }
    // Both arms the skip branch reports ride along, order-agnostically: the
    // set-aside preserves the rule's own reading order (asserted above
    // against `plain`), it does not reshuffle it.
    expect(policy.skippedDisabled.map((row) => row.skipped.reason).sort()).toEqual([
      "not-a-color",
      "translucent",
    ]);
  });

  it("a policy naming a DIFFERENT rule leaves every skipped pair exactly where it was", () => {
    const plain = auditOf(SKIPPED_ONLY_PATH);
    const other = auditOf(SKIPPED_ONLY_PATH, ["dead-token"]);
    expect(other.skipped).toEqual(plain.skipped);
    expect(other.skippedDisabled).toEqual([]);
    expect(other).toEqual(plain);
  });

  it("a policy-free report still sets nothing aside from either channel", () => {
    const oneArg = audit(resolveStylesheet(loadStylesheet(SKIPPED_ONLY_PATH)));
    expect(oneArg.skippedDisabled).toEqual([]);
    expect(oneArg).toEqual(auditOf(SKIPPED_ONLY_PATH, []));
  });

  it("BOTH channels partition on one disabled rule: findings to the findings leg, pairs to the skipped leg", () => {
    const policy = auditOf(COMPOSITE_PATH, ["scale-collapse"]);
    // Only the disabled rule's findings leave: `--unused` still reports, and
    // holds the exit exactly as it would beside a live scale-collapse.
    expect(policy.findings.map((f) => f.rule)).toEqual(["dead-token"]);
    expect(policy.skipped).toEqual([]);
    expect(policy.suppressedDisabled.map((row) => row.rule)).toEqual(["scale-collapse"]);
    expect(policy.suppressedDisabled[0]!.finding.tokens).toContain("--panel-hover");
    expect(policy.skippedDisabled).toHaveLength(1);
    expect(policy.skippedDisabled[0]!.skipped.reason).toBe("translucent");
    expect(policy.skippedDisabled[0]!.rule).toBe("scale-collapse");
  });

  it("the skipped section counts the set-aside beside the kept rows, under its own headline", () => {
    config("skipped-prose", { "suppress-rule": ["scale-collapse"] });
    const path = write("skipped-prose/sheet.css", COMPOSITE_CSS);
    const result = run(path);
    // The kept leg keeps its own count; the set-aside is counted under its
    // own headline, named, and never a silence reading as a pass.
    expect(result.out).toContain("skipped (0)");
    expect(result.out).toContain("skipped-disabled (1)");
    expect(result.out).toContain(
      '  skipped pairs a rule the project turned off in the "suppress-rule" key of themeguard.config.json also reported — counted here, named below, out of this section by project policy and never by a measurement: the pairs are exactly as unmeasured as they were, and the rule is off whole, its findings set aside under suppressed-disabled just as its pairs are set aside here.',
    );
    // The row keeps the channel's own vocabulary — state, base, theme, the
    // pair's own reason — with the policy's marker in front.
    const row = result.out.find((l) => l.startsWith("  [disabled by policy] [skipped] "));
    expect(row).toBeDefined();
    expect(row).toContain('--scrim-hover against --scrim in theme "root": translucent');
    // The live finding from the other rule still holds the exit.
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("a policy naming a rule with NO skipped rows prints no set-aside headline at all", () => {
    config("skipped-quiet", { "suppress-rule": ["dead-token"] });
    const path = write("skipped-quiet/sheet.css", TWO_RULE_CSS);
    const result = run(path);
    expect(result.out).toContain("skipped (0)");
    expect(result.out.some((l) => l.startsWith("skipped-disabled"))).toBe(false);
  });

  it("a stylesheet whose ONLY scale-collapse output was skipped rows exits 0 — skipped never held the exit, and neither does the set-aside", () => {
    config("skipped-exit", { "suppress-rule": ["scale-collapse"] });
    const path = write("skipped-exit/sheet.css", SKIPPED_ONLY_CSS);
    const result = run(path);
    expect(result.out).toContain("No findings.");
    expect(result.out).toContain("skipped-disabled (2)");
    expect(result.code).toBe(EXIT_OK);
    // Parity with the same stylesheet under no policy: the exit was 0
    // before the leg existed and stays 0 — the partition moved prose, not
    // the verdict.
    expect(run(SKIPPED_ONLY_PATH).code).toBe(EXIT_OK);
  });

  it("the unmatched carve-out fires for a skipped-only disabled rule — the oracle reads BOTH policy legs", () => {
    const path = write("skipped-carveout/sheet.css", SKIPPED_ONLY_CSS);
    config("skipped-carveout", {
      suppress: [
        { rule: "scale-collapse", token: "--scrim-hover", reason: "judged wholesale" },
      ],
      "suppress-rule": ["scale-collapse"],
    });
    const result = run(path);
    // The rule reported into `skipped` ONLY: the old single-leg derivation
    // read it as disabled-and-silent and kept the retirement advice, while
    // the pair printed one section up. Both legs now count as reporting.
    expect(result.out).toContain("suppressed-disabled (0)");
    expect(result.out).toContain("skipped-disabled (2)");
    expect(result.out).toContain("unmatched (1)");
    expect(result.out).toContain(
      '  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell: a disabled rule reports into the counted policy sections of this report — suppressed-disabled for its findings, skipped-disabled for the pairs it could not measure — and can never match, so this judgement is neither expired nor mis-aimed — it is one policy decision away from working. Re-enable the rule, or retire the entry.',
    );
    const row = result.out.find((l) => l.startsWith("  [unmatched] "));
    expect(row).toBeDefined();
    expect(row).toContain(
      ' — [scale-collapse] is disabled by this project\'s "suppress-rule" policy, so the judgement can never match while the rule is off: re-enable the rule, or retire the entry.',
    );
    expect(result.code).toBe(EXIT_OK);
  });

  it("--json serves `skippedDisabled` after `skipped`, rows whole, empty when no rule is off", () => {
    const plainPath = write("skipped-json-plain.css", SKIPPED_ONLY_CSS);
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
    const code = runCli(["--json", plainPath], io);
    expect(code).toBe(EXIT_OK);
    const report = JSON.parse(out.join("\n")) as Record<string, unknown>;
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
    // Additive, not absent: the leg is an empty array wherever no rule is
    // off — the same status `suppressedDisabled` has always had.
    expect(report.skippedDisabled).toEqual([]);
    expect((report.skipped as unknown[]).length).toBe(2);

    config("skipped-json", { "suppress-rule": ["scale-collapse"] });
    const path = write("skipped-json/sheet.css", SKIPPED_ONLY_CSS);
    const out2: string[] = [];
    const io2: CliIo = { out: (l) => out2.push(l), err: () => {} };
    expect(runCli(["--json", path], io2)).toBe(EXIT_OK);
    const policyReport = JSON.parse(out2.join("\n")) as {
      skipped: unknown[];
      skippedDisabled: {
        skipped: { base: string; state: string; theme: string; reason: string };
        rule: string;
        reason: string;
      }[];
    };
    expect(policyReport.skipped).toEqual([]);
    expect(
      policyReport.skippedDisabled
        .map((r) => [r.rule, r.reason, r.skipped.reason] as const)
        .sort((a, b) => (a[2] < b[2] ? -1 : 1)),
    ).toEqual([
      ["scale-collapse", "[disabled by policy]", "not-a-color"],
      ["scale-collapse", "[disabled by policy]", "translucent"],
    ]);
  });
});
