/**
 * The audit entry point — the six rules over one resolved stylesheet.
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
 * The six questions, and where each is argued:
 *
 * | rule id | question | module |
 * |---|---|---|
 * | `collision` | two roles hold byte-identical colours in a theme | `rules/collision.ts` |
 * | `dead-token` | declared, and no `var()` references it | `rules/dead-token.ts` |
 * | `scale-collapse` | a state is under ΔL* 4 from its resting value | `rules/scale-collapse.ts` |
 * | `family-consistency` | a theme inherits a token whose family its own declarations tune | `rules/coverage.ts` |
 * | `unresolved-reference` | a `var()` names a property no scope declares | `rules/unresolved-reference.ts` |
 * | `cycle-reference` | a `var()` chain returns to a name already on it | `rules/cycle-reference.ts` |
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
 * The complement is reported alongside: declared entries that matched nothing
 * are carried on `unmatchedSuppressions` — counted, named, still not an
 * error — so a recorded judgement whose defect is gone can announce that
 * instead of going silent.
 * Suppression is a post-audit, explicit, structured declaration (rule id +
 * token dimension, optionally scoped to the theme and the exact token set the
 * finding was measured over — never message scraping): it filters a finished
 * report and edits no rule, so every rule module stays a pure function of the
 * resolver's data. An entry may additionally carry its SITE (`line`), the
 * shape an in-source `themeguard-ignore` directive arrives in — the judgement
 * bound to the position it was recorded at, so the config stays the
 * project-level mechanism and the directive its site-level complement. It may
 * equally carry a FILE SCOPE (`file`), naming the stylesheet the judgement
 * was recorded against — the config's answer to a directory that shares one
 * ledger among sibling stylesheets, where an unscoped judgement would
 * otherwise govern every file beside it.
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
import { cycleReferenceRule } from "./rules/cycle-reference.js";
import { unresolvedReferenceRule } from "./rules/unresolved-reference.js";
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
   * The declared suppressions that matched NO finding — the complement of
   * `suppressed`, in declaration order (config entries first, then
   * directives, exactly the order the caller's array carried). Suppression is
   * a standing ledger of exceptions, and before this leg nothing ever told a
   * reader that one of its entries had outlived the defect it was written
   * about: nothing matched, so nothing printed, and a config carrying dead
   * judgements was byte-indistinguishable from no config at all. Reported
   * under the same counted-not-silent discipline as `skipped` and
   * `suppressed` — hygiene, never a defect in the stylesheet, and it never
   * moves the exit code (the exit stays the unsuppressed-findings question).
   * The report cannot tell an EXPIRED judgement — the defect was fixed, the
   * entry should be retired — from a MIS-AIMED one that never matched
   * anything real — in the general case. It carries both and, for an entry
   * WITHOUT a declared file scope, names neither — the CLI's prose for this
   * section says so rather than pretending to know. An entry that DOES name
   * its file (a {@link FileScopedSuppressionEntry}, the `file` field
   * resolved) is a third, knowable case: it matched nothing HERE because it
   * aims at another stylesheet, and the entry itself says which — so this
   * leg carries the judgement whole, with its `file` spelling, and the CLI's
   * prose carves that case out of the retirement advice instead of pretending
   * the dichotomy still covers it.
   */
  readonly unmatchedSuppressions: readonly (
    SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry
  )[];
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
   *
   * An entry may also carry a FILE SCOPE — `file`, naming the stylesheet the
   * judgement was recorded against. The CLI resolves the spelling against the
   * config's directory and passes the audited ENTRY stylesheet as
   * {@link AuditOptions.stylesheet}; the entry then matches only findings
   * reported for that one stylesheet, so a judgement written for one member
   * of a directory that shares one config never silences its siblings'
   * questions. The scope is the audited ENTRY stylesheet — the unit the
   * invocation asked about — so whatever that unit covers, a matching entry
   * governs. An entry without `file` matches every stylesheet the config
   * governs, exactly the behaviour before this dimension existed.
   *
   * The complement is reported too: a declared entry that matches NO finding
   * moves nothing and stays an error-free no-op, and is carried on the
   * report's `unmatchedSuppressions` leg — counted and named, never an
   * error — so a judgement that has outlived its defect can say so instead
   * of going silent.
   */
  readonly suppressions?: readonly (
    SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry
  )[];

  /**
   * The stylesheet being audited, normalized the same way the CLI normalizes
   * an entry's resolved `file` (`path.resolve`). Optional and additive: a
   * caller that omits it gets today's semantics for every entry — except
   * that an entry declaring a `file` scope cannot claim a match against a
   * stylesheet the audit was never told about, so such an entry matches
   * nothing and lands on `unmatchedSuppressions`, which is the honest
   * reading: the entry claims a file the report does not cover. Omitted by
   * the one-arg call.
   */
  readonly stylesheet?: string;
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
 * WHERE a file-scoped suppression aims — the half the CLI computes and the
 * config never stores. A config entry's `file` is the stylesheet it was
 * recorded against, RELATIVE to the config's own directory; before matching,
 * the CLI resolves that spelling against the config's directory into this
 * absolute, normalized annotation — the same additive treatment
 * {@link SuppressionSite} gives a directive. `fileResolved` is the only half
 * matching reads; the entry's own `file` keeps the spelling the user wrote,
 * which is what the report's ` [file: …]` clause prints.
 */
export interface SuppressionFileScope {
  /** The entry's `file`, resolved against the config's directory. */
  readonly fileResolved: string;
}

/**
 * A suppression entry that carries its resolved file scope — a config entry
 * naming the stylesheet it was recorded against, annotated by the CLI at the
 * merge seam. Structurally a config entry (rule id, token dimension, the
 * `file` spelling), so it merges into `suppressions` at the one seam the CLI
 * already had, with the resolved path as the added conjunct that keeps the
 * judgement on the file it was recorded against. An entry without the field
 * — config or directive — is untouched, and behaves byte-identically to
 * before this dimension existed.
 */
export type FileScopedSuppressionEntry = SuppressionEntry & SuppressionFileScope;

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
   * The entry that matched, whole — its declared `theme`/`tokens`/`file`
   * scope included, and for a directive-sourced entry the site it was
   * recorded at.
   */
  readonly entry: SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry;
}

/**
 * Run all six rules over a resolved stylesheet.
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
  const unresolved = unresolvedReferenceRule(resolved, names);
  const cycles = cycleReferenceRule(resolved);

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
  //     self-announcing miss, never a silence. That miss is self-announcing
  //     only while the finding EXISTS: fix the defect rather than move it and
  //     there is nothing left to announce anything, which is the gap the
  //     `unmatchedSuppressions` leg below exists to close — the orphaned
  //     judgement is named there, still without becoming an error.
  //   - the FILE SCOPE — carried only by a config entry that names the
  //     stylesheet it was recorded against (`file`, resolved by the CLI into
  //     `fileResolved`; see `config.ts` for the field). The conjunct compares
  //     that resolved scope against `options.stylesheet` — the audited ENTRY
  //     stylesheet, the unit this invocation asked about — so a judgement
  //     written for one member of a directory that shares one config never
  //     governs its siblings. An entry without the scope matches every
  //     stylesheet, exactly the behaviour before this conjunct existed; an
  //     entry WITH one that names some other file matches nothing HERE — the
  //     truthful outcome, and it is self-announcing on the leg below, where
  //     the entry now can SAY which file it does aim at. A caller that omits
  //     `stylesheet` gets the same honest no-match for a scoped entry: an
  //     entry cannot claim a file the audit was never told about.
  const findingLines = (finding: Finding): readonly number[] => {
    if (finding.sites !== undefined)
      return finding.sites
        .filter((s) => s.origin === undefined)
        .map((s) => s.line);
    // A rule that carries no `sites` (dead-token) still publishes its lines —
    // as `evidence.declaredIn` strings in `":root:4"` shape. That is public,
    // honestly named data the finding already reports; reading it here adds a
    // location dimension to suppression without asking any rule to change.
    // `unresolved-reference` publishes its USE sites the same way, under the
    // key that names them honestly (`usedIn`) — a directive annotating the
    // declaration that holds the dangling `var()` is a judgement at the site
    // the finding lives at, exactly as it is for a declaration site.
    //
    // A citation of an IMPORTED file (`tokens.css:4`) is skipped: directives
    // are read from the entry file's text only, so a judgement written here
    // cannot govern a site living in another file — and since line numbers
    // restart per file, matching on the bare number would let an entry-file
    // directive silence a finding spliced in from a closure file whose line
    // happened to coincide. The known origins come from the sheet itself, so
    // the skip is exact rather than a shape guess.
    const declared: unknown =
      finding.evidence["declaredIn"] ?? finding.evidence["usedIn"];
    if (!Array.isArray(declared)) return [];
    const origins = new Set<string>();
    for (const s of resolved.stylesheet.scopes) if (s.origin !== undefined) origins.add(s.origin);
    for (const r of resolved.stylesheet.references)
      if (r.origin !== undefined) origins.add(r.origin);
    const lines: number[] = [];
    for (const entry of declared as readonly unknown[]) {
      const text = String(entry);
      const at = /:(\d+)$/.exec(text);
      if (at === null) continue;
      if (origins.has(text.slice(0, text.length - at[0].length))) continue;
      lines.push(Number(at[1]));
    }
    return lines;
  };
  const matches = (
    entry: SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry,
    finding: Finding,
  ): boolean => {
    if (entry.rule !== finding.rule) return false;
    if (entry.theme !== undefined && entry.theme !== finding.theme) return false;
    const named = entry.tokens ?? (entry.token !== undefined ? [entry.token] : undefined);
    if (named !== undefined && !named.every((name) => finding.tokens.includes(name))) {
      return false;
    }
    if ("file" in entry) {
      // The resolved scope when the CLI supplied one, the entry's own
      // spelling otherwise — a library caller passing a scope hands the
      // spelling it wants compared. Against `options.stylesheet` this is the
      // one conjunct: defined and different ⇒ the entry aims at another
      // stylesheet and matches nothing here.
      const scope = "fileResolved" in entry ? entry.fileResolved : entry.file;
      if (scope !== undefined && scope !== options.stylesheet) return false;
    }
    if ("line" in entry) {
      const at = findingLines(finding);
      if (!at.some((line) => line === entry.line || line === entry.line + 1)) return false;
    }
    return true;
  };
  const suppressions = options.suppressions ?? [];
  // Which declared entries matched is tracked by POSITION in the caller's
  // array, never by shape: the same entry can match many findings, and two
  // distinct entries can be structurally similar, so the complement below is
  // a set-difference over the entries themselves — the array's own slots —
  // and not over their fields. `findIndex` reads the same first-match the
  // `find` it replaces read, so the matching behaviour is unchanged; only
  // what the loop remembers about a match is new.
  const matched = new Array<boolean>(suppressions.length).fill(false);
  const suppressed: SuppressedFinding[] = [];
  const kept: Finding[] = [];
  for (const finding of sortFindings([
    ...collisions,
    ...dead,
    ...scale.findings,
    ...family,
    ...unresolved,
    ...cycles,
  ])) {
    const index = suppressions.findIndex((s) => matches(s, finding));
    if (index === -1) kept.push(finding);
    else {
      matched[index] = true;
      const entry = suppressions[index] as SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry;
      suppressed.push({ finding, reason: entry.reason, entry });
    }
  }

  return {
    findings: kept,
    countsByRule: {
      collision: kept.filter((f) => f.rule === "collision").length,
      "dead-token": kept.filter((f) => f.rule === "dead-token").length,
      "scale-collapse": kept.filter((f) => f.rule === "scale-collapse").length,
      "family-consistency": kept.filter((f) => f.rule === "family-consistency").length,
      "unresolved-reference": kept.filter((f) => f.rule === "unresolved-reference").length,
      "cycle-reference": kept.filter((f) => f.rule === "cycle-reference").length,
    },
    suppressed,
    // The complement, in declaration order: the caller's slots that no
    // finding claimed. Declared entries arrive as one ordered array at the
    // CLI's single merge seam (config entries first, then directives), so
    // this order IS the order the judgements were recorded in.
    unmatchedSuppressions: suppressions.filter((_, i) => !matched[i]),
    skipped: scale.skipped,
    coverage: coverageReport(resolved),
  };
}
