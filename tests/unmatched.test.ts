import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { resolveCss } from "../src/resolve.js";
import type { SuppressionEntry } from "../src/config.js";

/**
 * `unmatchedSuppressions` — the declared entries that matched NOTHING, the
 * complement of `suppressed`.
 *
 * Suppression is a standing ledger of exceptions, and before this leg nothing
 * ever told a reader that one of its entries had outlived the defect it was
 * written about: a config carrying dead judgements was byte-indistinguishable
 * from no config at all, and a directive whose defect was FIXED (rather than
 * moved) was equally silent — there was no finding left to announce anything.
 * These tests pin the leg itself: it is carried at library grain, in
 * declaration order, by entry identity (never by shape), and it is a no-op on
 * everything else — the matched entries, the counts, the exit-relevant
 * findings are untouched.
 */
const SHEET_CSS = `:root {
  --accent: #16A34A;
  --success: #16A34A;
  --unused: #123456;
}

.a { color: var(--accent); }
.b { color: var(--success); }
`;

describe("audit — the unmatchedSuppressions leg", () => {
  const resolved = resolveCss(SHEET_CSS);

  it("is empty when no suppressions are passed — the one-arg call is unchanged", () => {
    const report = audit(resolved);
    expect(report.unmatchedSuppressions).toEqual([]);
  });

  it("is empty when every declared entry matched a finding — the success state", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", tokens: ["--accent", "--success"], reason: "vendor brand" },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.unmatchedSuppressions).toEqual([]);
  });

  it("carries a valid entry that matched nothing — the mis-aimed entry, still not an error", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "scale-collapse", token: "--token-that-exists-nowhere", reason: "stale entry" },
      ],
    });
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.unmatchedSuppressions[0]).toEqual({
      rule: "scale-collapse",
      token: "--token-that-exists-nowhere",
      reason: "stale entry",
    });
    // And the finding the entry missed is still reported: the miss changed
    // nothing about the report's verdict.
    expect(report.findings).toHaveLength(2);
  });

  it("keeps declaration order — config entries first, then directives, as the caller listed them", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "scale-collapse", token: "--nowhere-a", reason: "first" },
        { rule: "dead-token", line: 9, source: "vendor.css:9", reason: "orphaned directive" },
        { rule: "scale-collapse", token: "--nowhere-b", reason: "third" },
      ] as readonly (SuppressionEntry | (SuppressionEntry & { line: number; source: string }))[],
    });
    expect(report.unmatchedSuppressions.map((e) => (e as SuppressionEntry).reason)).toEqual([
      "first",
      "orphaned directive",
      "third",
    ]);
  });

  it("counts an entry that matched MANY findings as matched — once is enough", () => {
    // Two dead tokens DECLARED ON ONE LINE: a token-less dead-token directive
    // at that line matches both findings through the same site conjunct. The
    // entry is carried once in `suppressed`'s two rows and appears in the
    // complement exactly never — matching many findings is still matching,
    // and the complement is over the entries, not over the matches.
    const crowded = resolveCss(`:root {
  --accent: #16A34A;
  --success: #16A34A;
  --unused-a: #123456; --unused-b: #123457;
}

.a { color: var(--accent); }
.b { color: var(--success); }
`);
    const report = audit(crowded, {
      suppressions: [
        { rule: "dead-token", line: 4, source: "vendor.css:4", reason: "not yet wired up" },
      ],
    });
    expect(report.suppressed).toHaveLength(2);
    expect(report.suppressed.every((s) => s.entry.reason === "not yet wired up")).toBe(true);
    expect(report.unmatchedSuppressions).toEqual([]);
  });

  it("reports an entry as unmatched by IDENTITY, not by shape", () => {
    // Two entries that are structurally similar but distinct objects: the
    // first matches the collision, the second — same shape, different reason
    // — matched nothing, and it is THE SECOND one the leg carries.
    const first = {
      rule: "collision" as const,
      tokens: ["--accent", "--success"],
      reason: "the real judgement",
    };
    const second = {
      rule: "collision" as const,
      tokens: ["--accent", "--success"],
      reason: "a duplicate nobody aimed",
    };
    const report = audit(resolved, { suppressions: [first, second] });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.entry).toBe(first);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.unmatchedSuppressions[0]).toBe(second);
  });

  it("leaves a second entry unmatched when the first already claimed the finding — first match wins", () => {
    // Both entries would match the collision; the first supplies the reason.
    // The second is honestly reported as matching nothing THIS run — the
    // partition's first-wins rule is unchanged, and the leg tells the truth
    // about what each entry did.
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", tokens: ["--accent", "--success"], reason: "the one that worked" },
        { rule: "collision", tokens: ["--accent", "--success"], reason: "redundant twin" },
      ],
    });
    expect(report.suppressed[0]?.reason).toBe("the one that worked");
    expect(report.unmatchedSuppressions.map((e) => (e as SuppressionEntry).reason)).toEqual([
      "redundant twin",
    ]);
  });

  it("names an orphaned directive whose defect was FIXED — the case no finding can announce", () => {
    // Line 9 is nowhere near either declaration, so the site conjunct misses:
    // the findings print (pinned by the orphan test beside this one), and the
    // orphaned judgement itself is carried here, site and provenance intact.
    const report = audit(resolved, {
      suppressions: [
        {
          rule: "collision",
          tokens: ["--accent", "--success"],
          reason: "vendor brand",
          line: 9,
          source: "vendor.css:9",
        },
      ],
    });
    expect(report.findings).toHaveLength(2);
    expect(report.suppressed).toHaveLength(0);
    expect(report.unmatchedSuppressions).toEqual([
      {
        rule: "collision",
        tokens: ["--accent", "--success"],
        reason: "vendor brand",
        line: 9,
        source: "vendor.css:9",
      },
    ]);
  });

  it("is a no-op on the rest of the report — same findings, counts and coverage", () => {
    const bare = audit(resolved);
    const withDead = audit(resolved, {
      suppressions: [{ rule: "scale-collapse", token: "--nowhere", reason: "stale" }],
    });
    expect(withDead.findings).toEqual(bare.findings);
    expect(withDead.countsByRule).toEqual(bare.countsByRule);
    expect(withDead.skipped).toEqual(bare.skipped);
    expect(withDead.coverage).toEqual(bare.coverage);
    expect(withDead.suppressed).toEqual(bare.suppressed);
  });
});
