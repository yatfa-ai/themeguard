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
      '  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell: a disabled rule reports its findings into the suppressed-disabled section above and can never match, so this judgement is neither expired nor mis-aimed — it is one policy decision away from working. Re-enable the rule, or retire the entry.',
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
