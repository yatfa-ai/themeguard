import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfigDocument, parseConfig } from "../src/config.js";
import { resolveCss } from "../src/resolve.js";
import { RULE_IDS, sortFindings, type Finding } from "../src/rules/finding.js";

/**
 * The rule-id vocabulary has ONE list (`RULE_IDS`), and everything that needs
 * "every rule, in reading order" derives from it. These specs pin that each
 * consumer actually covers the whole tuple, so a tenth rule cannot silently
 * drop out of sorting, the counts, or config validation.
 */
describe("RULE_IDS", () => {
  it("lists the nine rules in reading order with no duplicates", () => {
    expect([...RULE_IDS]).toEqual([
      "collision",
      "dead-token",
      "scale-collapse",
      "family-consistency",
      "unresolved-reference",
      "cycle-reference",
      "duplicate-declaration",
      "unresolved-import",
      "theme-partial-token",
    ]);
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
  });

  it("sortFindings returns one finding per rule in RULE_IDS order, whatever the input order", () => {
    const findings: Finding[] = RULE_IDS.map((rule) => ({
      rule,
      theme: null,
      tokens: ["--x"],
      message: rule,
      evidence: {},
    }));
    const shuffled = [...findings].reverse();
    shuffled.push(shuffled.shift() as Finding);
    expect(sortFindings(shuffled).map((f) => f.rule)).toEqual([...RULE_IDS]);
  });

  it("audit() countsByRule has every rule id as a key, in RULE_IDS order", () => {
    const report = audit(resolveCss(":root { --a: #fff; }"));
    expect(Object.keys(report.countsByRule)).toEqual([...RULE_IDS]);
  });

  it.each([...RULE_IDS])("config validation accepts %s as an entry rule and a suppress-rule element", (rule) => {
    const entry = parseConfig(
      JSON.stringify({ suppress: [{ rule, token: "--a", reason: "r" }] }),
      "themeguard.config.json",
    );
    expect(entry[0]?.rule).toBe(rule);
    const doc = parseConfigDocument(
      JSON.stringify({ suppress: [], "suppress-rule": [rule] }),
      "themeguard.config.json",
    );
    expect(doc.disabledRules).toEqual([rule]);
  });
});
