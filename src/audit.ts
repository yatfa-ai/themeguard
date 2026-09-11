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
 * `audit(resolved)` is the whole contract for a caller with no opinion. A caller
 * who DOES have one — a user who has looked at a finding and declared it
 * deliberate — passes `suppressions`, and matching findings move from
 * `findings` to the report's `suppressed` leg with their reason attached.
 * Suppression is a post-audit, explicit, structured declaration (rule id +
 * token dimension, optionally scoped to the theme and the exact token set the
 * finding was measured over — never message scraping): it filters a finished
 * report and edits no rule, so every rule module stays a pure function of the
 * resolver's data. An entry may additionally carry its SITE (`line`), the
 * shape an in-source `themeguard-ignore` directive arrives in — the judgement
 * bound to the position it was recorded at, so the config stays the
 * project-level mechanism and the directive its site-level complement.
 *
 * Each module's docstring carries its judgement heuristics and — more usefully
 * — what it deliberately does NOT report, because for every rule the raw
 * data contains far more candidates than there are defects, and the filtering
 * is the rule.
 */

import type { ResolvedStylesheet } from "./resolve.js";
import type { SuppressionEntry } from "./config.js";
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
   * Findings the caller declared deliberate via `AuditOptions.suppressions` —
   * each carried whole, with the user's reason, under the same
   * counted-not-silent discipline as `skipped`: a suppression is a recorded
   * judgement, never a silent drop. Empty on the one-arg call.
   */
  readonly suppressed: readonly SuppressedFinding[];
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

/**
 * What a caller may declare about the findings before the report is shaped.
 * Omitted entirely by the one-arg call, which behaves exactly as it always
 * has — this parameter is additive, and library consumers are unaffected.
 */
export interface AuditOptions {
  /**
   * Findings to suppress, as STRUCTURED declarations — a rule id and a token
   * dimension (the scalar `token`, or the `tokens` set) matched against the
   * finding's own fields, never message scraping, plus an optional `theme`
   * scope that narrows the entry to findings measured in that one theme. A
   * finding matching any entry moves from `findings` to `suppressed` with the
   * entry's reason; its absence from the counts is the user's recorded
   * judgement, and the report still names it. When several entries match one
   * finding, the first in the list supplies the reason.
   *
   * An entry may also carry a SITE — `line` and `source`, the shape
   * {@link SiteScopedSuppressionEntry} — which is how an in-source
   * `themeguard-ignore` directive participates: the entry then matches only
   * findings living at the directive's own position, so the judgement is
   * bound to its site by construction. A config entry never carries one, and
   * config entries behave byte-identically to before this dimension existed.
   */
  readonly suppressions?: readonly (SuppressionEntry | SiteScopedSuppressionEntry)[];
}

/**
 * WHERE a site-scoped suppression was recorded — the half a config entry
 * never carries. `line` is the directive comment's own 1-based line and the
 * only half matching reads; `source` is the `file:line` provenance the
 * report's `suppressed` section prints, so a run that exits 0 says where each
 * in-source judgement lives.
 */
export interface SuppressionSite {
  readonly line: number;
  readonly source: string;
}

/**
 * A suppression entry that carries its site — an in-source
 * `themeguard-ignore` directive, scanned by `directives.ts`. Structurally a
 * config entry (rule id, token dimension, reason), so it merges into
 * `suppressions` at the one seam the CLI already had, with the site as the
 * added conjunct that keeps the judgement where the code is.
 */
export type SiteScopedSuppressionEntry = SuppressionEntry & SuppressionSite;

/**
 * A finding the caller has declared deliberate: the finding itself, kept
 * whole so the reader can still check the measurement it was reported with,
 * and the reason the user gave for setting it aside. The matching entry is
 * carried too, so a reader — the CLI's `suppressed` section in particular —
 * can see the scope the entry declared rather than only that one matched.
 */
export interface SuppressedFinding {
  readonly finding: Finding;
  /** The user's reason, verbatim — quoted in the CLI's `suppressed` section. */
  readonly reason: string;
  /**
   * The entry that matched, whole — its declared `theme`/`tokens` scope
   * included, and for a directive-sourced entry the site it was recorded at.
   */
  readonly entry: SuppressionEntry | SiteScopedSuppressionEntry;
}

/**
 * Run all four rules over a resolved stylesheet.
 *
 * @param resolved the resolver's output — the facts to judge.
 * @param options optional caller declarations; omit for the plain report.
 */
export function audit(
  resolved: ResolvedStylesheet,
  options: AuditOptions = {},
): AuditReport {
  // Built once and shared: the naming structure is the same question for all
  // the rules, and deriving it twice invites them to disagree about it.
  const names = new TokenNames(resolved);

  const collisions = collisionRule(resolved, names);
  const dead = deadTokenRule(resolved, names);
  const scale = scaleCollapseRule(resolved, names);
  const family = familyConsistencyRule(resolved, names);

  // Partition the sorted report: kept findings, and the ones the caller has
  // marked deliberate. The partition reads the FINDING's own fields, so it
  // cannot be fooled by reworded messages; the order of `suppressed` is the
  // same reading order as `findings`, so the two legs read as one list.
  //
  // Matching is structured on three of the finding's own dimensions, each
  // narrowed only when the entry actually names it:
  //   - `rule` — always required.
  //   - `theme` — a scoped entry matches only findings measured in that
  //     theme. `undefined` (key absent) is the unscoped every-theme reading,
  //     exactly the behaviour before this field existed. Strict `===` also
  //     keeps a scoped entry off the theme-less findings (`theme: null` — a
  //     dead token is measured stylesheet-wide, not in a theme); no coercion.
  //   - the token dimension — the scalar `token` matches when the finding
  //     carries that ONE name; the `tokens` set matches only when the finding
  //     carries EVERY name listed, which is the precision a collision PAIR
  //     needs. Validation guarantees one spelling or the other — from the
  //     CONFIG, that is: a site-scoped directive may carry neither, because
  //     there the SITE is the judgement and the token dimension is genuinely
  //     optional, matching any finding of the rule that lives at the site.
  //   - the SITE — carried only by an in-source `themeguard-ignore` directive
  //     (`line`, see `directives.ts`); a config entry never has one, and for
  //     it this conjunct is absent, which is why config entries behave
  //     byte-identically to before it existed. A directive matches when one
  //     of the finding's own position lines equals the directive's line (a
  //     trailing comment on the judged declaration) or the line directly
  //     below it (a standalone comment on the preceding line) — the two
  //     industry placements. Move the defect and the directive orphans:
  //     nothing matches, the finding prints and moves the exit code — the
  //     self-announcing miss, never a silence.
  const findingLines = (finding: Finding): readonly number[] => {
    if (finding.sites !== undefined) return finding.sites.map((s) => s.line);
    // A rule that carries no `sites` (dead-token) still publishes its lines —
    // as `evidence.declaredIn` strings in `":root:4"` shape. That is public,
    // honestly named data the finding already reports; reading it here adds a
    // location dimension to suppression without asking any rule to change.
    const declared: unknown = finding.evidence["declaredIn"];
    if (!Array.isArray(declared)) return [];
    const lines: number[] = [];
    for (const entry of declared as readonly unknown[]) {
      const at = /:(\d+)$/.exec(String(entry));
      if (at !== null) lines.push(Number(at[1]));
    }
    return lines;
  };
  const matches = (
    entry: SuppressionEntry | SiteScopedSuppressionEntry,
    finding: Finding,
  ): boolean => {
    if (entry.rule !== finding.rule) return false;
    if (entry.theme !== undefined && entry.theme !== finding.theme) return false;
    const named = entry.tokens ?? (entry.token !== undefined ? [entry.token] : undefined);
    if (named !== undefined && !named.every((name) => finding.tokens.includes(name))) {
      return false;
    }
    if ("line" in entry) {
      const at = findingLines(finding);
      if (!at.some((line) => line === entry.line || line === entry.line + 1)) return false;
    }
    return true;
  };
  const suppressions = options.suppressions ?? [];
  const suppressed: SuppressedFinding[] = [];
  const kept: Finding[] = [];
  for (const finding of sortFindings([
    ...collisions,
    ...dead,
    ...scale.findings,
    ...family,
  ])) {
    const entry = suppressions.find((s) => matches(s, finding));
    if (entry === undefined) kept.push(finding);
    else suppressed.push({ finding, reason: entry.reason, entry });
  }

  return {
    findings: kept,
    countsByRule: {
      collision: kept.filter((f) => f.rule === "collision").length,
      "dead-token": kept.filter((f) => f.rule === "dead-token").length,
      "scale-collapse": kept.filter((f) => f.rule === "scale-collapse").length,
      "family-consistency": kept.filter((f) => f.rule === "family-consistency").length,
    },
    suppressed,
    skipped: scale.skipped,
    coverage: coverageReport(resolved),
  };
}
