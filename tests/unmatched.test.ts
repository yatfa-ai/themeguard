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

  it("reports an entry as unmatched by SLOT IDENTITY, not by shape", () => {
    // The property: the complement is a set-difference over the caller's
    // array SLOTS, never over entry shape — the specific object that matched
    // nothing is the one carried, and two slots carrying the same shape are
    // two separate answers rather than one deduped one.
    //
    // This used to be demonstrated with two IDENTICAL-shape collision
    // entries, asserting the second was left unmatched because the first had
    // claimed the finding. That demonstration is no longer constructible:
    // every matching slot is now booked, and `matches()` is a pure function
    // of an entry's own fields, so two identical shapes always match exactly
    // the same findings — slot-booking and shape-booking converge there. The
    // two scenarios below are the ones that still tell them apart.
    //
    // (a) Structurally similar entries where exactly ONE matches: both name
    // `--accent`, but only the first pairs it with a token the collision
    // finding does not carry, so the finding fails its includes-check. The
    // leg carries THAT slot — the one that genuinely matched nothing — and
    // not merely "the later entry".
    const missing = {
      rule: "collision" as const,
      tokens: ["--accent", "--unused"],
      reason: "aimed at a pair that does not collide",
    };
    const matching = {
      rule: "collision" as const,
      tokens: ["--accent", "--success"],
      reason: "the real judgement",
    };
    const report = audit(resolved, { suppressions: [missing, matching] });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.entry).toBe(matching);
    expect(report.unmatchedSuppressions).toHaveLength(1);
    expect(report.unmatchedSuppressions[0]).toBe(missing);

    // (b) Two entries of the SAME shape that both match nothing are BOTH
    // carried, in declaration order: the leg reports slots, so it never
    // folds two judgements into one because they happen to read alike.
    const twinA = {
      rule: "scale-collapse" as const,
      token: "--token-that-exists-nowhere",
      reason: "first ledger line",
    };
    const twinB = {
      rule: "scale-collapse" as const,
      token: "--token-that-exists-nowhere",
      reason: "second ledger line",
    };
    const twins = audit(resolved, { suppressions: [twinA, twinB] });
    expect(twins.suppressed).toHaveLength(0);
    expect(twins.unmatchedSuppressions).toHaveLength(2);
    expect(twins.unmatchedSuppressions[0]).toBe(twinA);
    expect(twins.unmatchedSuppressions[1]).toBe(twinB);
  });

  it("does not report a second entry that covers the same finding — first match wins ATTRIBUTION only", () => {
    // Both entries match the collision. The FIRST supplies the reason and
    // the finding is suppressed exactly once — that partition rule is
    // unchanged. What the second entry is NOT is unmatched: it matched a
    // finding, and the complement's prose offers a reader only two readings
    // ("the defect was fixed and the judgement can be retired" / "the entry
    // never aimed at a finding that exists"), both false here — the finding
    // it covers is printed under `suppressed` in the same report. Reporting
    // it would steer the author into retiring a working judgement.
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", tokens: ["--accent", "--success"], reason: "the one that worked" },
        { rule: "collision", tokens: ["--accent", "--success"], reason: "redundant twin" },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.reason).toBe("the one that worked");
    expect(report.unmatchedSuppressions.map((e) => (e as SuppressionEntry).reason)).toEqual([]);
  });

  it("does not report a site directive that covers the same finding as a config entry — the README's advertised combination", () => {
    // The OTHER half of the same fix, and a different matching path: a
    // directive carries `line` + `source`, so `matches()` runs the site
    // conjunct a config entry skips entirely. README:469 advertises using
    // both together ("the two work together — both merge into the same
    // `suppressions` section"), and the CLI composes exactly that at
    // `src/cli.ts:543`: `[...scoped, ...(sheet.directives ?? [])]` — one
    // array, config entries first, directives after. Before every matching
    // slot was booked, the directive fell into the complement and the report
    // advised retiring a judgement whose finding was printed under
    // `suppressed` in the same report.
    const configEntry = {
      rule: "collision" as const,
      tokens: ["--accent", "--success"],
      reason: "project-level: accent is deliberately the success green",
    };
    const directiveEntry = {
      rule: "collision" as const,
      tokens: ["--accent", "--success"],
      reason: "in-file judgement: vendor brand",
      line: 2,
      source: "tokens.css:2",
    };
    const report = audit(resolved, {
      suppressions: [configEntry, directiveEntry] as readonly (
        | SuppressionEntry
        | (SuppressionEntry & { line: number; source: string })
      )[],
    });
    // Attribution is unchanged: the FIRST match supplies the reason, and the
    // finding is suppressed exactly once.
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.reason).toBe(
      "project-level: accent is deliberately the success green",
    );
    // And the directive — which matched — is NOT advertised as retirable.
    expect(report.unmatchedSuppressions.map((e) => (e as SuppressionEntry).reason)).toEqual([]);

    // Order-independent across the two entry KINDS: declare the directive
    // first and attribution moves to it, while the config twin it displaced
    // still matched and so still must not be reported.
    const reversed = audit(resolved, {
      suppressions: [directiveEntry, configEntry] as readonly (
        | SuppressionEntry
        | (SuppressionEntry & { line: number; source: string })
      )[],
    });
    expect(reversed.suppressed).toHaveLength(1);
    expect(reversed.suppressed[0]?.reason).toBe("in-file judgement: vendor brand");
    expect(reversed.unmatchedSuppressions.map((e) => (e as SuppressionEntry).reason)).toEqual([]);
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
