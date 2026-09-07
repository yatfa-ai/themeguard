/**
 * The audit entry point — the four rules over one resolved stylesheet.
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
 * The four questions, and where each is argued:
 *
 * | rule id | question | module |
 * |---|---|---|
 * | `collision` | two roles hold byte-identical colours in a theme | `rules/collision.ts` |
 * | `dead-token` | declared, and no `var()` references it | `rules/dead-token.ts` |
 * | `scale-collapse` | a state is under ΔL* 4 from its resting value | `rules/scale-collapse.ts` |
 * | `family-consistency` | a theme inherits a token whose family its own declarations tune | `rules/coverage.ts` |
 *
 * Alongside the findings, `coverage` carries the fact inventory rule 4 is
 * measured over — per theme, every base-theme token marked overridden or
 * inherited, colour vs non-colour. It is a listing, not a judgement: wholly
 * inherited families are normal, and only the mixed shape above is a finding.
 *
 * Each module's docstring carries its judgement heuristics and — more usefully
 * — what it deliberately does NOT report, because for every rule the raw
 * data contains far more candidates than there are defects, and the filtering
 * is the rule.
 */

import type { ResolvedStylesheet } from "./resolve.js";
import { collisionRule } from "./rules/collision.js";
import {
  coverageReport,
  familyConsistencyRule,
  type ThemeCoverage,
} from "./rules/coverage.js";
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
  /**
   * Per theme, every base-theme token marked `overridden` or `inherited`, with
   * the kind each theme's copy resolves to. A fact inventory, never a
   * judgement: a wholly inherited family is normal (theme-independent tokens
   * have no override by design), and the finding that names the MIXED shape —
   * a theme inheriting one member of a family it otherwise tunes — lives in
   * `findings` under `family-consistency`. Printed by the CLI as an
   * informational section; it never moves the exit code.
   */
  readonly coverage: readonly ThemeCoverage[];
}

/** Run all four rules over a resolved stylesheet. */
export function audit(resolved: ResolvedStylesheet): AuditReport {
  // Built once and shared: the naming structure is the same question for all
  // the rules, and deriving it twice invites them to disagree about it.
  const names = new TokenNames(resolved);

  const collisions = collisionRule(resolved, names);
  const dead = deadTokenRule(resolved, names);
  const scale = scaleCollapseRule(resolved, names);
  const family = familyConsistencyRule(resolved, names);

  return {
    findings: sortFindings([
      ...collisions,
      ...dead,
      ...scale.findings,
      ...family,
    ]),
    countsByRule: {
      collision: collisions.length,
      "dead-token": dead.length,
      "scale-collapse": scale.findings.length,
      "family-consistency": family.length,
    },
    skipped: scale.skipped,
    coverage: coverageReport(resolved),
  };
}
