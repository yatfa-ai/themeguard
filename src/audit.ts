/**
 * The audit entry point — the three rules over one resolved stylesheet.
 *
 * This is the stage the resolver's docstring promises: `resolve.ts` produces
 * DATA and passes no judgement, and `audit()` is where the judging happens.
 * Every rule is a pure function of `resolveStylesheet`'s output. No browser, no
 * DOM, no second parse of the source, no regex rule over the raw CSS — the
 * roadmap's own record of a source-walking implementation (953 phantom nodes, a
 * 5× compositing error) is why.
 *
 * ```ts
 * import { resolveCss, audit } from "themeguard";
 *
 * const report = audit(resolveCss(css));
 * for (const finding of report.findings) console.log(finding.message);
 * ```
 *
 * The three questions, and where each is argued:
 *
 * | rule id | question | module |
 * |---|---|---|
 * | `collision` | two roles hold byte-identical colours in a theme | `rules/collision.ts` |
 * | `dead-token` | declared, and no `var()` references it | `rules/dead-token.ts` |
 * | `scale-collapse` | a state is under ΔL* 4 from its resting value | `rules/scale-collapse.ts` |
 *
 * Each module's docstring carries its judgement heuristics and — more usefully
 * — what it deliberately does NOT report, because for all three rules the raw
 * data contains far more candidates than there are defects, and the filtering
 * is the rule.
 */

import type { ResolvedStylesheet } from "./resolve.js";
import { collisionRule } from "./rules/collision.js";
import { deadTokenRule } from "./rules/dead-token.js";
import { scaleCollapseRule, type SkippedPair } from "./rules/scale-collapse.js";
import { sortFindings, type Finding, type RuleId } from "./rules/finding.js";
import { TokenNames } from "./rules/tokens.js";

export interface AuditReport {
  /** Every finding, sorted rule → theme → tokens. */
  readonly findings: readonly Finding[];
  /** Findings per rule id. Every rule id is present, `0` included. */
  readonly countsByRule: Readonly<Record<RuleId, number>>;
  /**
   * Pairs rule 3 could not measure — a translucent member has no lightness
   * until it is composited, and themeguard never invents a backdrop. Reported
   * so the silence is countable rather than looking like a pass.
   */
  readonly skipped: readonly SkippedPair[];
}

/** Run all three rules over a resolved stylesheet. */
export function audit(resolved: ResolvedStylesheet): AuditReport {
  // Built once and shared: the naming structure is the same question for all
  // three rules, and deriving it twice invites them to disagree about it.
  const names = new TokenNames(resolved);

  const collisions = collisionRule(resolved, names);
  const dead = deadTokenRule(resolved, names);
  const scale = scaleCollapseRule(resolved, names);

  return {
    findings: sortFindings([...collisions, ...dead, ...scale.findings]),
    countsByRule: {
      collision: collisions.length,
      "dead-token": dead.length,
      "scale-collapse": scale.findings.length,
    },
    skipped: scale.skipped,
  };
}
