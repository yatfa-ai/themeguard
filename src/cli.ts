#!/usr/bin/env node
/**
 * The command — `themeguard [--json] <file.css> [file.css…]`.
 *
 * One command, ONE option; the positionals repeat. The sentence this replaces
 * — "one command, zero options" — was written at 0.1.2, when the command took
 * a single stylesheet, ran three rules, and had no pipeline caller to serve:
 * it described the surface as it then was, and it never argued that no caller
 * would ever need the DATA. 0.1.7 made the pipeline caller first-class (N
 * files, ONE aggregated verdict) without giving it anything but the number,
 * and `--json` is the other half of that: the number stays the verdict
 * channel, and the flag adds a DATA channel beside it. It is the only option,
 * it is accepted anywhere among the arguments, and repeating it changes
 * nothing. Everything that is not `--json` is a positional, exactly as
 * before — an unknown `--flag` is still read as a path and still fails as
 * one, because inventing flag VALIDATION here would change the exit
 * semantics of invocations that work today.
 *
 * Each named stylesheet is
 * read from disk, run through the same
 * `audit(resolveStylesheet(loadStylesheet(path)))` the library exposes — that
 * file's IMPORT CLOSURE, not the file alone — and printed under its own
 * `themeguard — <path>` header. It adds
 * no rule, no heuristic and no judgement of its own: everything here is I/O and
 * presentation over reports the library already produced.
 *
 * The files are audited INDEPENDENTLY, each through its own import closure.
 * One POSITIONAL's tokens are invisible to the next — files named together on
 * a command line state no relationship, and none is invented; what crosses is
 * only what a file's own text declares, along the `@import` edges its audit
 * follows. The config governing each stylesheet — the nearest
 * `themeguard.config.json` in its directory or any directory above it —
 * governs it alone. A suppression
 * is worth exactly the stylesheet it was recorded against — and since 0.1.11
 * that is true by DECLARATION, not by accident of where the config sits: an
 * entry may name the file it was judged against (`file`, relative to the
 * config's own directory), and a file-scoped entry governs that one
 * stylesheet — so a directory sharing one ledger among siblings can record a
 * judgement for `tokens.css` without it silencing `buttons.css`. An entry
 * without the field keeps the whole-stylesheet reading it has always had —
 * and since the audit unit is the closure, that whole is the file's import
 * closure: an unscoped entry beside the root governs findings spliced in from
 * imported files too, and a file-scoped entry names the ENTRY stylesheet, the
 * closure's root. The
 * invocation fails fast on the first file that cannot be audited, and the
 * per-file outcomes aggregate into ONE exit code for the invocation — the
 * precedence is stated in the exit contract below, because a caller in a
 * pipeline gets one invocation and one verdict, not N runs to OR by hand.
 *
 * ── What it prints, and why in this shape ──────────────────────────────────
 * Findings are grouped by rule, each group headed by its COUNT, and every line
 * is the README's own `[rule] message` shape so a line pasted into an issue
 * still says which question it answers. All the rule headings are printed
 * even at zero, because a rule that reports nothing and a rule that did not run
 * look identical if the heading is omitted — and "no findings" reads as a pass.
 *
 * For the same reason `skipped` is rendered EXPLICITLY rather than dropped. A
 * pair rule 3 could not measure (a translucent member has no lightness until it
 * is composited, and themeguard never invents a backdrop) is silence, and
 * silence reads exactly like a clean result. The library goes to the trouble of
 * counting it; a CLI that swallowed it would undo that. Each row names WHICH
 * silence it is — `translucent`, `not-a-color`, `absent`, `unresolvable` — and
 * an `absent` row goes one further and names the sibling theme the pair is
 * declared in, because "not measurable in theme X" and "these names are
 * broken" are different claims and the reader cannot tell them apart from a
 * bare skip.
 *
 * ── The config ────────────────────────────────────────────────────────────
 * `themeguard.config.json`, OPTIONAL, is discovered by walking UP from the
 * stylesheet's directory — the nearest `themeguard.config.json` at or above
 * it, never the process CWD: a run names stylesheets — `themeguard <file.css>
 * [file.css…]` — and the config that governs a file is the first one found on
 * the way from its directory to the filesystem root (nearest wins, the
 * eslint/tsconfig/.editorconfig prior). The walk is what makes one ledger
 * govern a subtree: a config at `styles/` reaches `styles/components/` too,
 * so the standard component-library layout is ONE config, not a copy per
 * directory — and a config beside the stylesheet is still the first hop, so
 * every layout the previous discovery understood is byte-identical.
 * Absent file ⇒ no suppressions: no
 * existing line of the report changes and the exit codes are unchanged — the
 * only addition is the counted `suppressed` section, printed even at zero.
 * Each entry lists a rule id, a token dimension (one `token`, or a `tokens`
 * set), an optional `theme` scope, and a `reason`, strictly validated: a
 * config this package cannot honour exits 2 naming the entry, never a silent
 * skip. An entry may also name the STYLESHEET the judgement was recorded
 * against — `file`, relative to the config's own directory, resolved there
 * before matching; an entry scoped that way governs that one stylesheet and
 * no sibling, which is what makes a shared-config directory's ledger honest
 * (see the independence paragraph above). Matching findings move out of the
 * per-rule counts and into a `suppressed` section with their reason quoted —
 * counted, named, never dropped, and out of the exit code by declaration
 * rather than by silence — and a scoped entry says so there (` [theme: …]` /
 * ` [tokens: …]` / ` [file: …]` after the reason), so a run that exits 0
 * shows how far each judgement reached.
 *
 * The config's second, PROJECT-LEVEL key is `suppress-rule`: an array of rule
 * ids the adopter has judged not-a-defect for the project whole. A per-finding
 * ledger structurally cannot say "we have looked at this RULE and judged it" —
 * the answer is wholesale, and one entry per finding is one entry per
 * regeneration of every generated sheet the rule fires on. A rule named there
 * stops reporting: its findings move out of the counts into the counted
 * `suppressed-disabled` section — printed even at zero, the policy's marker on
 * every row, out of the exit code by the same not-a-defect-by-declaration
 * reasoning — and never reach the per-entry match, so a `suppress` entry
 * naming a disabled rule lands on `unmatched` with an honest clause (a
 * disabled rule cannot match; re-enable or retire) instead of retirement
 * advice that would be false. The key is validated with `suppress`'s own
 * discipline: an unknown rule id exits 2 naming the element, an empty array
 * disables nothing, and an absent key is byte-identical to the one-key
 * config.
 *
 * ── The directives ────────────────────────────────────────────────────────
 * `/* themeguard-ignore … *\/` comments in the stylesheet are the SITE-level
 * complement: the same structured entry, written where a reader of the CSS
 * can see it and bound to the position it was recorded at — a trailing
 * comment on the judged declaration, or a standalone comment on the line
 * directly above. Matching is the config entry's, plus the one conjunct the
 * site contributes; a refactored defect moves away from its directive, the
 * directive orphans, and the finding prints and moves the exit code again —
 * the self-announcing miss, never a silence. That miss is self-announcing
 * only while the finding still exists: a defect FIXED rather than moved
 * leaves nothing to announce anything, and there the report's counted
 * `unmatched` section (below) names the orphaned judgement instead — still
 * not an error. A malformed directive (unknown
 * rule id, missing reason) is the config's own contract: exit 2 naming the
 * comment's line, never a silent skip. The two mechanisms merge at the single
 * `suppressions` seam below; the config stays the project-level mechanism,
 * the directive its site-level one, and neither changed the other's semantics.
 * Since 0.1.10 the audit sees the file's import closure, and since 0.1.19 the
 * directives are the closure's too: the LOADER scans every member's text in
 * the same pass that stamps each member's `origin`, and hands the whole set
 * back on the sheet — an imported file's judgement now reaches the audit that
 * imports it, matched against that file's own sites. Matching stays exact:
 * an entry-file directive matches only entry-file sites, and a member's
 * directive matches only its own file's sites — the fence that kept a
 * coinciding line from silencing a splice survives, as file equality instead
 * of an entry-only rule. A malformed directive in ANY member exits 2 naming
 * ITS file and line, the same never-silently-ignored contract the entry file
 * always had.
 *
 * ── The unmatched ─────────────────────────────────────────────────────────
 * The complement of `suppressed`, under the same counted-even-at-zero
 * discipline: a declared suppression that matched NOTHING is named, with its
 * rule, its scope, its `file:line` source where it has one, and its reason
 * quoted. Suppression is a standing ledger of signed-off exceptions, and
 * before this section nothing ever told the reader that an entry had
 * outlived the defect it was written about — a config carrying dead
 * judgements was byte-indistinguishable from no config at all. The section
 * prints even at zero, because an empty section is the PROOF that every
 * recorded judgement is still doing work; like `skipped` and `coverage` it
 * is hygiene, never a defect, and never moves the exit code. Its prose names
 * the two possible causes and stops — IN GENERAL the tool cannot tell an
 * expired judgement (defect fixed, retire the entry) from a mis-aimed one, and
 * must not pretend to. Two causes it CAN tell, each with its own line beside
 * that prose. Since 0.1.11: an entry carrying a ` [file: …]` clause names the
 * stylesheet it was recorded against, so its presence on this report is neither
 * expiry nor mis-aim — it aims at a sibling file this config governs, and that
 * file's report is the one that states its fate. A clause-carrying entry is
 * never advised retired on this report's word. And since 0.1.24: a SITE-scoped
 * judgement whose rule and tokens match a live finding every one of whose sites
 * lives in ANOTHER file of the closure. There both readings are outright false
 * — the defect is not fixed (the finding prints above, in this same report) and
 * the entry did aim at a finding that exists, one `@import` edge away — so the
 * row names the finding, WHERE it sits, and the two moves that reach it: move
 * the comment into that file, or record the judgement in the config, whose
 * reach is the closure. Claimed only where the FILE is the whole reason nothing
 * matched; a directive that missed on its LINE while its own file holds a site
 * keeps the existing advice, whose clauses are closer to true there, and so
 * does every config entry, whose identity matching is already closure-wide.
 * DIAGNOSIS and never suppression: the entry is still unmatched, the counts and
 * the exit code do not move, and a directive still never reaches across an
 * edge — {@link crossFileAims} reads a FINISHED report. And since 0.1.26: a
 * judgement whose `theme` scope names a rule measured STYLESHEET-WIDE. Five of
 * the nine rules report `theme: null` by construction, so such a scope is not
 * a near-miss but a structurally DEAD conjunct — no finding of that rule in
 * this file, any file of the closure, or any run of this config carries a
 * theme — while the finding the entry's rule and tokens DO match prints above.
 * Both readings are false again, and the row names the rule, the dead scope
 * and the one-key move that revives the judgement — claimed only where the
 * THEME is the whole reason nothing matched, since an entry that also carries
 * a `file` scope would still match nothing after the deletion. DIAGNOSIS on
 * the same terms: {@link themelessAims} reads a FINISHED report, the matcher
 * is untouched, and the entry stays unmatched.
 *
 * `coverage` is printed under the same precedent. It is the fact inventory rule
 * 4 is measured over — per theme, every base-theme token marked overridden or
 * inherited, with the colour/non-colour split of the inherited set — and it is
 * INFORMATIONAL by construction: inherited is normal (theme-independent tokens
 * have no override by design), so the section is counted, named, printed even
 * at zero, and never moves the exit code. The mixed shape the inventory makes
 * visible is judged by rule 4, whose findings DO count.
 *
 * The split partitions the set it headlines: a base token whose `var()` chain
 * does not resolve in a theme — or cycles — is neither colour nor non-colour,
 * so those kinds are appended to the parenthetical when present rather than
 * vanishing from the count.
 *
 * ── `--json`: the data channel beside the number ──────────────────────────
 * With `--json`, stdout carries ONE compact JSON object per file — NDJSON,
 * one line per stylesheet, emitted as each file completes, in argument order.
 * The prose above is not produced at all in that mode, and the prose mode is
 * not changed by a byte when the flag is absent.
 *
 * The object is the {@link AuditReport} the library already returns, rendered
 * verbatim, with the audited `path` in front of it: no field is renamed,
 * summarized or dropped. That is the point — the prose renderer is a lossy
 * PROJECTION (sites become clause text, evidence becomes sentence fragments,
 * scopes become bracket suffixes), so a caller that wanted "which file, which
 * token, which line" had to scrape sentences the tool shapes for people.
 *
 * ONE key is the CLI's own rather than the library's, and it is additive: an
 * `unmatchedSuppressions` row whose judgement names a live finding in another
 * file of the closure carries `crossFileAim`, `{rule, site}` — the machine form
 * of the prose's `— matches a live …` clause, so the pointer is read as data
 * instead of regexed out of a sentence. ABSENT (never `null`) on every row
 * without one, the same absence-is-a-fact discipline `sites` carries, which is
 * what keeps every row this does not apply to byte-identical. A SECOND such key
 * since 0.1.26, on the same terms: `themelessAim`, `{rule}` — the machine form
 * of the dead-theme-scope clause, on the rows whose `theme` scope names a rule
 * that reports no theme at all.
 *
 * Three properties a pipeline caller may rely on:
 *
 *   - The exit codes are UNCHANGED. The flag adds a channel; it does not move
 *     the verdict. A caller branches on the number exactly as it does today
 *     and parses stdout for the detail behind it.
 *   - stdout is never MIXED. It is either pure prose or pure NDJSON — usage
 *     errors, unreadable files, `ConfigError` and `DirectiveError` stay on
 *     stderr as prose in BOTH modes — so every line of a `--json` run parses
 *     without a mode check, and `jq` needs no filter for stray diagnostics.
 *   - Fail-fast keeps the lines already written. The first file that cannot
 *     be audited ends the invocation with 2, and the JSON lines for the files
 *     before it are already on stdout — the same contract the prose reports
 *     have had since 0.1.7.
 *
 * ── The exit contract, and why findings are not code 2 ─────────────────────
 * Three distinct codes, because a caller in a shell — a pipeline, a
 * pre-commit hook — can only branch on the number:
 *
 *   0  the audit ran and reported nothing
 *   1  the audit ran and reported findings
 *   2  the audit did not run (usage error, or the file could not be read)
 *
 * Collapsing 1 into 0 would make a defective stylesheet indistinguishable from
 * a clean one; collapsing 1 into 2 would make a real finding indistinguishable
 * from a typo in the path. Skipped pairs do NOT raise the code: they are not
 * findings, and a stylesheet whose only unmeasurable pair is translucent has
 * not been shown to have a defect.
 *
 * The exit computes over UNSUPPRESSED findings — a finding the user has
 * recorded as deliberate in themeguard.config.json no longer holds the exit
 * code hostage, which is the point of the config. A malformed config is the
 * opposite case: the audit did not run on the terms the user wrote, so it is
 * exit 2 alongside the usage errors, naming the offending entry.
 *
 * The project POLICY is outside the exit by the same reasoning, one level up:
 * findings a rule reported after the project turned that rule off in
 * `suppress-rule` are recorded — counted, named, the policy's marker on every
 * row in `suppressed-disabled` — and hold no code. The judgement they carry is
 * the adopter's own, made about the RULE rather than per finding, and the exit
 * stays the question it has always been: were there UNSUPPRESSED findings. A
 * malformed `suppress-rule` is the config case above — exit 2 naming the
 * element — never a silently ignored key.
 *
 * The `unmatched` section is likewise outside the exit: a declared entry that
 * matched nothing is a stale, mis-aimed or MISFILED JUDGEMENT, not a defect in
 * the stylesheet, so an expired judgement must never turn a green pipeline red.
 * That holds for the misfiled one too — a site-scoped judgement whose finding
 * lives one `@import` edge away has its aim NAMED on its row since 0.1.24, and
 * naming it moves nothing: the finding was already counted (it is live, and it
 * prints), the entry is still unmatched, and the code is what it was.
 * The exit stays exactly the question it has always been — were there
 * unsuppressed findings.
 *
 * Over ONE invocation naming several stylesheets, the same three codes
 * aggregate per invocation with the precedence 2 > 1 > 0: if ANY file errored,
 * the invocation exits 2; else if ANY file reported unsuppressed findings, it
 * exits 1; else 0. The 2 is fail-fast — the first file that cannot be audited
 * (unreadable, unhonourable config, malformed directive) ends the invocation,
 * its error naming THAT file, and the files before it keep the reports they
 * already printed. One invocation, one verdict: the alternative this replaces —
 * running the tool once per stylesheet and OR-ing the codes by hand in the
 * caller — lets one mistyped path silently poison the aggregate.
 */

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  audit,
  crossFileAims,
  skippedAims,
  themelessAims,
  type CrossFileAim,
  type FileScopedSuppressionEntry,
  type SkippedAim,
  type ThemelessAim,
  type SiteScopedSuppressionEntry,
} from "./audit.js";
import {
  CONFIG_FILENAME,
  ConfigError,
  configPathFor,
  readConfigDocument,
  type SuppressionEntry,
} from "./config.js";
import { DirectiveError } from "./directives.js";
import { loadStylesheet } from "./load.js";
import { resolveStylesheet } from "./resolve.js";
import type { TokenKind } from "./resolve.js";
import type { Stylesheet } from "./parse.js";
import type { FindingSite, RuleId } from "./rules/finding.js";
import { citeSiteList } from "./rules/finding.js";
import type { SkippedPair } from "./rules/scale-collapse.js";

/** The audit ran and reported nothing. */
export const EXIT_OK = 0;
/** The audit ran and reported at least one finding. */
export const EXIT_FINDINGS = 1;
/** The audit did not run: bad usage, or a file could not be audited. */
export const EXIT_ERROR = 2;

/** Where the command writes. Injected so the report is testable as data. */
export interface CliIo {
  /** A line of the report. */
  readonly out: (line: string) => void;
  /** A line of diagnostics — usage, unreadable file. */
  readonly err: (line: string) => void;
}

export const USAGE = "usage: themeguard [--json] <file.css> [file.css…]";

/**
 * The one option, and the only argument that is not a stylesheet path.
 *
 * Deliberately no short alias in v1: `-j` is cheap to add later and
 * impossible to take back, and nothing has asked for it yet.
 */
const JSON_FLAG = "--json";

/** The order groups are printed in — the library's own reading order. */
const RULE_ORDER: readonly RuleId[] = [
  "collision",
  "dead-token",
  "scale-collapse",
  "family-consistency",
  "unresolved-reference",
  "cycle-reference",
  "duplicate-declaration",
  "unresolved-import",
  "theme-partial-token",
];

/**
 * The scope a suppression entry declared, printed after its reason so a line
 * that suppressed a finding says how far the judgement reached — an unscoped
 * entry suppresses across every theme and every token set, and the reader is
 * owed the difference. `""` for an unscoped entry, which keeps today's line
 * byte-identical; ` [theme: winter]`, ` [tokens: --accent, --success]`, or
 * both segments in one bracket when the entry names both.
 */
function scopeSuffix(entry: SuppressionEntry): string {
  const segments: string[] = [];
  if (entry.theme !== undefined) segments.push(`theme: ${entry.theme}`);
  if (entry.tokens !== undefined) segments.push(`tokens: ${entry.tokens.join(", ")}`);
  return segments.length === 0 ? "" : ` [${segments.join(", ")}]`;
}

/**
 * Where a directive-sourced judgement lives, printed after its reason (and
 * after any token scope) as `[sheet.css:4]`. A config entry has no site and
 * no clause, which keeps every config line byte-identical to before; a
 * directive's clause is what makes an exit-0 run answer "judged where?" for
 * an in-source judgement — the same disclosure duty `scopeSuffix` serves for
 * a scoped config entry.
 */
function sourceClause(entry: SuppressionEntry | SiteScopedSuppressionEntry): string {
  return "source" in entry ? ` [${entry.source}]` : "";
}

/**
 * The stylesheet a file-scoped config entry was recorded against, as
 * ` [file: tokens.css]` — the spelling AS WRITTEN in the config, not the
 * resolved path matching used (that half is the audit's business; the report
 * quotes the user's own ledger back to them). `""` for an unscoped entry,
 * which keeps today's line byte-identical. It joins the `scopeSuffix` /
 * `sourceClause` family in both sections where an entry is named: a
 * `suppressed` line shows how far the judgement reached, and an `unmatched`
 * line shows where the judgement DOES aim — the difference between "this
 * entry matched nothing" and "this entry was never about this file", which
 * is exactly the ambiguity the section's prose otherwise cannot resolve.
 */
function fileClause(entry: SuppressionEntry): string {
  return entry.file !== undefined ? ` [file: ${entry.file}]` : "";
}

/**
 * Whether an unmatched entry's `file` scope resolves OUTSIDE the config's
 * governed subtree — the seam's `fileBeyondConfigHome` annotation. Asked, not
 * assumed: the audit carries the flag opaquely, and only config entries carry
 * it at all, so the report narrows by its presence rather than by the entry's
 * declared shape. `true` moves the entry out of the sibling carve-out's
 * comfort (the config does NOT govern the file it names) and into the
 * boundary line that states its fate instead.
 */
function beyondConfigHome(
  entry: SuppressionEntry | SiteScopedSuppressionEntry,
): boolean {
  return "fileBeyondConfigHome" in entry && entry.fileBeyondConfigHome === true;
}

/**
 * The scalar `token` spelling of a config entry's token dimension, as
 * ` [token: --name]` — `""` for every other entry. DELIBERATELY NOT folded
 * into `scopeSuffix`: the `suppressed` line's format is pinned byte-identical
 * and needs no token segment, because the finding's own message sits in the
 * middle of that line and already names the tokens the judgement covered. An
 * `unmatched` line has no finding by definition, so the token dimension is
 * the only field that can distinguish one entry from another — omitting it
 * here would render three different judgements about three different tokens
 * as three byte-identical lines. It rides this line alone for exactly that
 * reason; `scopeSuffix` stays untouched.
 */
function tokenScope(entry: SuppressionEntry | SiteScopedSuppressionEntry): string {
  return entry.token !== undefined ? ` [token: ${entry.token}]` : "";
}

/**
 * The cross-file aim clause an unmatched site-scoped judgement earns when its
 * conjuncts match a live finding that lives in ANOTHER file of the closure —
 * the additive sentence that keeps the section's retirement advice from being
 * flatly wrong about it.
 *
 * The section's two readings are "the defect was fixed, retire the entry" and
 * "the entry never aimed at a finding that exists". For this one shape BOTH are
 * false: the finding prints above in the same report, and the entry did aim at
 * it — one `@import` edge away. So this clause says what the report DOES know:
 * which finding, WHERE it sits, and the two ways to reach it. A directive
 * governs only the file it is written in (the fence is unchanged, and this
 * clause is a diagnosis rather than a suppression), so the moves are moving the
 * comment into that file, or recording the judgement in the config, whose reach
 * is the whole closure.
 *
 * `""` for every other entry, which keeps every section this does not apply to
 * byte-identical. It joins the `tokenScope` / `scopeSuffix` / `fileClause` /
 * `sourceClause` family and composes after them: in practice disjoint from the
 * `[file: …]` clause (a file-scoped config entry carries no `line`, so it never
 * earns an aim), and the composition stays honest if some shape ever carries
 * both.
 */
function crossFileClause(aim: CrossFileAim | undefined): string {
  return aim === undefined
    ? ""
    : ` — matches a live [${aim.rule}] finding at ${aim.site}; a directive governs only the file it is written in — move it there, or record it in ${CONFIG_FILENAME} to cover the whole closure.`;
}

/**
 * The dead-theme-scope clause an unmatched judgement earns when its `theme`
 * scope names a rule that measures STYLESHEET-WIDE — the additive sentence
 * that keeps the section's retirement advice from being flatly wrong about it.
 *
 * The section's two readings are "the defect was fixed, retire the entry" and
 * "the entry never aimed at a finding that exists". For this shape BOTH are
 * false: the finding prints above in the same report, and the entry's rule and
 * tokens match it — only the theme conjunct failed, and it fails
 * STRUCTURALLY. Five of the nine rules push `theme: null` at their own push
 * sites, so no theme spelling can ever equal it, in this file, any file of the
 * closure, or any run of this config. So this clause says what the report DOES
 * know: which rule, why the scope is dead, and the one-key move that revives
 * the judgement.
 *
 * THE ONE-KEY MOVE IS IDENTITY-ONLY. An entry whose `file` scope names
 * ANOTHER stylesheet earns `""` — the theme would not be the only reason
 * nothing matched, so deleting it would not aim the judgement, and the row's
 * own `[file: …]` clause (or the beyond-config-home line above it) is what
 * speaks for it. `themelessAims` declines exactly that population; see there.
 * A scope naming the audited stylesheet itself is NOT a second dead conjunct
 * (the file conjunct passes there), so the sub-case earns the clause.
 *
 * `""` for every other entry, which keeps every section this does not apply to
 * byte-identical. It joins the `tokenScope` / `scopeSuffix` / `fileClause` /
 * `sourceClause` / `crossFileClause` family and composes after them: in
 * practice disjoint from the cross-file clause (a directive carries no theme
 * scope — the grammar has none — so a row can never earn both), and the
 * composition stays honest if some shape ever carries both.
 */
function themelessClause(
  entry: SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry,
  aim: ThemelessAim | undefined,
): string {
  return aim === undefined
    ? ""
    : ` — [${aim.rule}] findings are measured stylesheet-wide and carry no theme, so the [theme: ${entry.theme}] scope can never match; drop the theme key to aim the judgement.`;
}

/**
 * The kept-skipped clause an unmatched judgement earns when its identity
 * conjuncts match a pair rule 3 could not measure — the additive sentence that
 * keeps the section's retirement advice from being flatly wrong about it, the
 * same harm class the cross-file, dead-theme-scope and disabled-rule clauses
 * removed before it.
 *
 * The section's two readings are "the defect was fixed, retire the entry" and
 * "the entry never aimed at a finding that exists". For this shape BOTH are
 * false: the pair is not a finding, so the entry matched nothing and landed
 * here — but the pair PRINTS, one section up, in the skipped section's own
 * doctrine "not findings, and not a pass either", under the same rule id and
 * token names the entry names. So this clause says what the report DOES know:
 * WHICH pair (in the skipped row's own vocabulary), which silence it is, that
 * the judgement never governed it and never can (a skip is not a finding, and
 * entries govern findings only), and the real moves — make the pair
 * measurable, accept the silence by turning the rule off with `suppress-rule`
 * (where the disabled-rule carve-out takes the row over), or retire the entry.
 *
 * `""` for every other entry, which keeps every row this does not apply to
 * byte-identical. It joins the tokenScope / scopeSuffix / fileClause /
 * sourceClause / crossFileClause / themelessClause family and composes after
 * `themelessClause`, before the disabled-rule clause: in practice disjoint
 * from both neighbours (a kept-skipped row's rule is `scale-collapse` ENABLED,
 * so the policy never partitions its pairs and the disabled clause is empty
 * for it; a themeless row's rule is in `THEMELESS_RULES`, which
 * `scale-collapse` is not), and the composition stays honest if some shape
 * ever carried both.
 */
function skippedClause(aim: SkippedAim | undefined): string {
  return aim === undefined
    ? ""
    : ` — its conjuncts match the pair rule 3 could not measure, ${aim.state} against ${aim.base} in theme "${aim.theme}" (${aim.reason}), printed one section up in skipped; entries govern findings only, so this judgement can never silence a skipped row — make the pair measurable (fix the value), accept the silence by turning the rule off with "suppress-rule", or retire the entry.`;
}

/**
 * The disabled-rule clause an unmatched judgement earns when its rule is one
 * the project turned OFF in `suppress-rule` — the additive sentence that keeps
 * the section's retirement advice from being flatly wrong about it, the same
 * harm class the cross-file and dead-theme-scope clauses removed before it.
 *
 * The section's two readings are "the defect was fixed, retire the entry" and
 * "the entry never aimed at a finding that exists". For this shape BOTH are
 * false when the disabled rule is REPORTING: its output prints in the
 * report's counted policy sections — findings under `suppressed-disabled`,
 * skipped pairs under `skipped-disabled` — and the entry did aim at
 * measurements that exist, but the policy check ran before the entry match,
 * so the entry can never claim one while the rule is off. So this clause
 * says what the report DOES know: which rule is off, and the two moves that
 * aim the judgement — re-enable the rule, or retire it.
 *
 * `reporting` is the set of disabled rules that actually REPORTED on THIS
 * report, derived from the report alone: only the policy puts rows on its
 * two policy legs — `suppressedDisabled` and `skippedDisabled`, the findings
 * channel and the skipped one — so membership there IS the fact
 * rule-reported-and-was-disabled, with no second derivation of it to drift.
 * BOTH legs count: the report has two output channels and the policy
 * partitions both, so a rule that reported into `skipped` ONLY — its
 * findings silent — is a reporting rule here exactly as a findings-reporting
 * one is; reading the findings leg alone would call such a rule silent and
 * leave its entries' ordinary advice standing while the pairs printed one
 * section up. A rule that is disabled AND silent on BOTH channels — it
 * reported nothing anywhere — leaves its entries' ordinary advice standing,
 * because there "the defect was fixed" may be exactly true, and "re-enable"
 * would be noise beside it.
 *
 * `""` for every other entry, which keeps every row this does not apply to
 * byte-identical. It joins the tokenScope / scopeSuffix / fileClause /
 * sourceClause / crossFileClause / themelessClause family and composes last.
 */
function disabledRuleClause(
  entry: SuppressionEntry | SiteScopedSuppressionEntry | FileScopedSuppressionEntry,
  reporting: ReadonlySet<RuleId>,
): string {
  return reporting.has(entry.rule)
    ? ' — [' + entry.rule + '] is disabled by this project\'s "suppress-rule" policy, so the judgement can never match while the rule is off: re-enable the rule, or retire the entry.'
    : "";
}

/**
 * The sibling-scope pointer an `absent` skipped row carries: WHERE the pair
 * that is missing from this theme's view actually lives.
 *
 * The row's own sentence already says the pair could not be measured in theme
 * X; without this clause it could not say that the tokens are perfectly
 * healthy one block away, which is the whole difference between "these names
 * are broken" and "these names are winter's". Scopes are cited the way every
 * other file-aware clause cites — `line 4` in the entry file, `tokens.css:4`
 * for a declaration spliced in over an `@import` edge — through the shared
 * {@link citeSiteList}, so the spelling cannot drift from
 * `positionClause`'s, which is that same list under its own frame.
 *
 * Both members missing from one sibling theme is the ordinary shape (a
 * theme-local pair audited from another view), and it reads as ONE fact —
 * `the pair is declared only in theme "winter"` — rather than as the same
 * theme named twice. The per-member form stands for every other shape: one
 * member missing while the other resolves, or two members living in
 * different themes.
 *
 * `""` when the row carries no scopes: `absent` with nothing found anywhere
 * (the rule says nothing rather than naming a wrong scope), and every
 * non-absent reason, which has no sibling scope to name. That is what keeps
 * the translucent and not-a-color rows byte-identical.
 */
function siblingScopeClause(pair: SkippedPair): string {
  const scopes = pair.declaredIn;
  if (scopes === undefined || scopes.length === 0) return "";

  // Per member, in the order the rule collected them (base then state), each
  // with the themes whose own blocks declare it and the position in each.
  const members: { name: string; themes: string[]; sites: FindingSite[] }[] = [];
  for (const scope of scopes) {
    const existing = members.find((m) => m.name === scope.name);
    const member = existing ?? { name: scope.name, themes: [], sites: [] };
    if (existing === undefined) members.push(member);
    member.themes.push(scope.theme);
    member.sites.push(scope.site);
  }

  const themesOf = (m: { themes: string[] }): string => m.themes.join("\u0000");
  const shared =
    members.length > 1 && members.every((m) => themesOf(m) === themesOf(members[0]));
  if (shared) {
    const first = members[0] as { themes: string[] };
    const where = members.map((m) => `${m.name} at ${citeSiteList(m.sites)}`).join(", ");
    return ` — the pair is declared only in ${themeList(first.themes)} (${where})`;
  }
  return ` — ${joinAnd(
    members.map(
      (m) => `${m.name} is declared only in ${themeList(m.themes)} at ${citeSiteList(m.sites)}`,
    ),
  )}`;
}

/** `"a"` / `"a" and "b"` / `"a", "b" and "c"`. */
function joinAnd(items: readonly string[]): string {
  if (items.length === 1) return items[0] as string;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `theme "dark"` / `themes "dark" and "winter"` — the noun agrees with the list. */
function themeList(themes: readonly string[]): string {
  return `${themes.length === 1 ? "theme" : "themes"} ${joinAnd(themes.map((t) => `"${t}"`))}`;
}

/**
 * Run the command over `args` (the arguments AFTER the program name) and return
 * the exit code. Zero arguments is the usage error it has always been; one or
 * more paths are audited IN ORDER, each through {@link auditStylesheet} — its
 * reports print as they complete, the first file that cannot be audited ends
 * the invocation fail-fast with 2, and otherwise the per-file outcomes
 * aggregate into one code: 1 if ANY file reported unsuppressed findings, else
 * 0 (precedence 2 > 1 > 0 — see the exit contract in the header). Pure but for
 * the file reads: everything printed goes through `io`, so a test reads the
 * report instead of scraping a subprocess.
 *
 * `--json` is the one option, and it is removed here rather than anywhere
 * deeper: everything that survives the filter is a positional, so the rest of
 * the command sees exactly the argument list it always saw. The flag is
 * position-free (any slot among the paths) and idempotent (`--json --json` is
 * one flag), because both are free consequences of a filter and a caller that
 * appends it to an argv it did not build should not have to care.
 *
 * The zero-positionals case stays the usage error it has always been, and
 * that INCLUDES `themeguard --json` alone: a flag is not a stylesheet, and a
 * run with nothing to audit must not answer 0 with an empty stdout — a
 * pipeline reading that as "clean" is exactly the false pass the exit
 * contract exists to prevent.
 */
export function runCli(args: readonly string[], io: CliIo): number {
  const json = args.includes(JSON_FLAG);
  const paths = args.filter((arg) => arg !== JSON_FLAG);

  if (paths.length === 0) {
    io.err(USAGE);
    io.err("themeguard: no stylesheet given.");
    return EXIT_ERROR;
  }

  // The invocation-level verdict: whether ANY file completed with unsuppressed
  // findings. Each file's own outcome is decided inside the loop below; this
  // is what survives the loop and turns into the aggregated exit.
  let anyFindings = false;

  for (const path of paths) {
    const outcome = auditStylesheet(path, io, json);
    if (outcome === EXIT_ERROR) {
      // Fail-fast: the first file that cannot be audited ends the invocation
      // with 2, whatever the files before it reported — those reports are
      // already printed, and auditing past a file the caller misnamed would
      // let the aggregate read as a verdict over files it never saw.
      return EXIT_ERROR;
    }
    if (outcome === EXIT_FINDINGS) anyFindings = true;
  }

  // The aggregation, precedence 2 > 1 > 0: 2 has already been returned
  // fail-fast above, so what remains is 1 if ANY file reported unsuppressed
  // findings, else 0.
  return anyFindings ? EXIT_FINDINGS : EXIT_OK;
}

/**
 * Audit ONE stylesheet: the per-file body, unchanged by how many files the
 * invocation names. Reads the file, loads the config discovered AT OR ABOVE
 * it (the nearest `themeguard.config.json`, per {@link configPathFor}'s walk),
 * loads the closure — whose loader scans every member's directives — audits,
 * prints its report under its own
 * `themeguard — <path>` header, and returns that file's outcome — 1 when the
 * file carries unsuppressed findings, 0 when it is clean, 2 when it cannot be
 * audited at all (with the diagnostic on `io.err`, naming this file's path or
 * this file's config or any member's malformed directive). Pure but for the
 * file read: everything printed goes through `io`, so a test reads the report
 * instead of scraping a subprocess.
 *
 * `json` selects the RENDERER and nothing else. Every line above this one —
 * the read, the config walk, the directive scan, the audit, the outcome — is
 * byte-identical in both modes, and so are the diagnostics, which stay prose
 * on `io.err` either way: the flag chooses what a SUCCESSFUL audit prints to
 * stdout, never what an error says or which code it returns.
 */
function auditStylesheet(path: string, io: CliIo, json = false): number {
  // The entry's readability gate, byte-identical to 0.1.4: this read pins the
  // `cannot read <path>` diagnostic — and its precedence, ahead of the
  // config's, exactly as shipped. The loader re-reads the file (it has since
  // the audit unit became the closure) and since 0.1.19 scans the directives
  // there too; this read's remaining job is this diagnostic, in this order.
  try {
    readFileSync(path, "utf8");
  } catch (error) {
    io.err(`themeguard: cannot read ${path}`);
    io.err(`  ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }

  // The config governing this stylesheet is the NEAREST `themeguard.config.json`
  // at or above it — not the process CWD, and not only the stylesheet's own
  // directory: discovery walks up from the stylesheet's directory and stops at
  // the first directory holding one (nearest wins — the eslint/tsconfig prior),
  // bounded at the filesystem root. A run is `themeguard <file.css>`, so what
  // governs a file is decided by where the file LIVES, never by wherever the
  // command happens to be invoked from; a config beside the stylesheet is the
  // walk's first hop, so every layout the previous discovery understood is
  // byte-identical. Absent config anywhere up the tree ⇒ no suppressions —
  // every existing line of the report is unchanged and the exit codes hold;
  // the only addition is the counted `suppressed` section — while a present
  // but unhonourable one ⇒ exit 2, bad usage's own contract, never a silent
  // skip. ONE walk serves both halves — the entries, and the home their
  // `file` scopes resolve against below.
  let suppressions;
  let disabledRules: readonly RuleId[] | undefined;
  let configDir: string | null = null;
  try {
    const configPath = configPathFor(path);
    if (configPath !== null) {
      configDir = dirname(configPath);
      // The whole document, one read: the entries merge into the suppression
      // list below, the policy rides to the audit beside them. `suppressions`
      // and `disabledRules` stay undefined together when no config exists —
      // the byte-identical-before-the-policy-key case.
      const document = readConfigDocument(configPath);
      suppressions = document?.suppress;
      disabledRules = document?.disabledRules;
    }
  } catch (error) {
    io.err(
      error instanceof ConfigError
        ? `themeguard: ${error.message}`
        : `themeguard: cannot read themeguard.config.json — ${
            error instanceof Error ? error.message : String(error)
          }`,
    );
    return EXIT_ERROR;
  }

  // The in-source complement: `/* themeguard-ignore … *\/` directives. Since
  // 0.1.19 the scan lives IN THE LOADER — every member of the closure is
  // scanned as it is read, each imported member's entries stamped with its
  // entry-relative origin, the entry file's left unstamped exactly as this
  // function's own entry-only scan left them — and the closure's judgements
  // arrive on the sheet this call loads. The grammar's contract rides along:
  // a malformed directive in ANY member throws out of the load and ends this
  // file's audit with 2, the same sentence the entry-only scan threw, now
  // naming the comment's own file and line.
  let sheet: Stylesheet;
  try {
    sheet = loadStylesheet(path);
  } catch (error) {
    if (error instanceof DirectiveError) {
      io.err(`themeguard: ${error.message}`);
      return EXIT_ERROR;
    }
    // Anything else is not this function's sentence to rewrite: the read
    // above gates the entry's I/O and a member's read failure is recorded,
    // never thrown, so nothing else is known to escape the loader — whatever
    // does propagates unchanged, exactly as it did before the scan moved in.
    throw error;
  }

  // The merge seam: a directive entry is structurally a config entry carrying
  // one extra conjunct (its line), so the audit sees one suppression list.
  // Config entries come first, so a config/directive tie resolves to the
  // config's reason — the same first-wins rule the list itself has.
  //
  // The audit unit is the file's IMPORT CLOSURE, not the file alone: the file
  // is loaded through `loadStylesheet`, which follows the `@import` edges its
  // text declares.
  //
  // File-scoped entries are resolved HERE, the only place that knows both
  // halves: the entry carries `file` relative to the CONFIG's own directory,
  // and this function knows that directory — the home `configPathFor`
  // discovered, which is the stylesheet's own directory only when the config
  // happens to sit beside it. That is the schema's documented semantics made
  // true in general rather than by coincidence of layout: with a config at
  // `styles/` governing `styles/components/` too, `"file":
  // "components/card.css"` names card.css relative to `styles/`, and the
  // scope fires on the component file the judgement was recorded against.
  // Each scoped entry is shallow-copied with the resolved
  // absolute path as an additive annotation, the same treatment the 0.1.4
  // site scope gave a directive; the written spelling rides along untouched,
  // so the report's ` [file: …]` clause prints what the user wrote. Entries
  // without the field pass through as the SAME objects — no scope, no copy,
  // byte-identical behaviour. The audited stylesheet travels alongside as
  // `stylesheet`, normalized the same way — the ENTRY file, which is the file
  // scope a closure-level judgement names: an entry scoped to the root
  // governs every finding the closure produced, imported or not (whatever the
  // audited unit covers, the entry governs), while an unscoped entry governs
  // the same span by having no file axis at all.
  //
  // The copy is also where a scope's reach is JUDGED against the config's
  // own: a config governs its own directory and below — exactly the subtree
  // its discovery walks down from the config's home — so an aim resolving
  // OUTSIDE that subtree can never match any stylesheet this config governs,
  // in this run or any other. Such an entry is annotated (`fileBeyondConfigHome`)
  // for the report, whose `unmatched` section states that fate instead of
  // offering retirement advice aimed at a sibling that cannot exist.
  // In-subtree aims carry no flag at all — byte-identical to 0.1.11.
  const scoped = (suppressions ?? []).map((entry) => {
    if (entry.file === undefined || configDir === null) return entry;
    const fileResolved = resolve(configDir, entry.file);
    return {
      ...entry,
      fileResolved,
      ...(fileResolved === configDir || fileResolved.startsWith(configDir + sep)
        ? {}
        : { fileBeyondConfigHome: true as const }),
    };
  });
  const resolved = resolveStylesheet(sheet);
  const auditedStylesheet = resolve(path);
  const report = audit(resolved, {
    suppressions: [...scoped, ...(sheet.directives ?? [])],
    // The policy rides to the audit beside the entries: a disabled rule's
    // findings never reach the per-entry match, so an entry naming a disabled
    // rule lands on `unmatchedSuppressions` — where the report can say WHY it
    // matched nothing — instead of suppressing by accident of ordering.
    disabledRules,
    stylesheet: auditedStylesheet,
  });
  // The cross-file aim of each unmatched site-scoped judgement — DIAGNOSIS
  // only, derived from the finished report and consulted by nothing that
  // suppresses. Computed here because this is the one frame holding both
  // halves: the report, and the resolved sheet whose origin set tells an
  // imported citation from an entry-file one.
  const aims = crossFileAims(report.unmatchedSuppressions, report.findings, resolved);
  // The dead-theme-scope diagnosis, on the same footing: derived from the
  // finished report, consulted by nothing that suppresses. It needs the report
  // and the audited stylesheet — the rule's theme-lessness is DECLARED beside
  // the rule ids (`THEMELESS_RULES`) and the findings carry their own `theme`,
  // and the audited path decides the one file-scope sub-case the decline
  // still honors (a scope naming this very sheet is NOT a second dead
  // conjunct, so the sub-case earns the clause).
  const themeless = themelessAims(report.unmatchedSuppressions, report.findings, auditedStylesheet);
  // The kept-skipped diagnosis, on the same footing: derived from the finished
  // report, consulted by nothing that suppresses. It needs the report and the
  // audited stylesheet — the adapter literal (`skippedAims`) carries the
  // channel's one rule id, the pairs carry their own theme and token names,
  // and the audited path narrows the file-scope decline to OTHER-file scopes:
  // a scope naming this very sheet aims at a pair this report holds, one
  // section up.
  const skipped = skippedAims(report.unmatchedSuppressions, report.skipped, auditedStylesheet);
  if (json) io.out(formatReportJson(path, report, aims, themeless, skipped));
  else
    for (const line of formatReport(path, report, aims, themeless, skipped, auditedStylesheet))
      io.out(line);

  // Findings here are the UNSUPPRESSED ones — a finding the user has recorded
  // as deliberate no longer holds the exit code hostage, which is the whole
  // point of the config.
  return report.findings.length > 0 ? EXIT_FINDINGS : EXIT_OK;
}

/**
 * The printed report, as lines. Separated from the I/O so tests can read it.
 *
 * `aims` is the per-unmatched-entry cross-file diagnosis
 * ({@link crossFileAims}), ALIGNED BY INDEX with `report.unmatchedSuppressions`
 * — the leg reports SLOTS, so a keyed lookup would fold two structurally
 * identical judgements into one. Additive and optional: omit it and every line
 * is byte-identical to before the diagnosis existed, which is what a caller
 * holding only a report (and not the resolved sheet the aims are derived from)
 * gets.
 *
 * `themeless` is the sibling diagnosis ({@link themelessAims}), aligned by
 * index the same way and additive on the same terms: a theme-scoped entry
 * aimed at a rule that measures stylesheet-wide earns a clause naming the dead
 * scope, and every other row is untouched.
 *
 * `skipped` is the kept-skipped diagnosis ({@link skippedAims}), aligned by
 * index the same way and additive on the same terms: an entry whose identity
 * conjuncts match a pair rule 3 could not measure earns a clause naming that
 * pair, and every other row is untouched.
 *
 * `auditedStylesheet` is the audited ENTRY stylesheet, path-resolved — the
 * same value `audit()` was given as `options.stylesheet`, which this renderer
 * never derived. It narrows the `[file: …]` carve-out's gate: a scope naming
 * THIS sheet is not an aim elsewhere (the report in the reader's hands is that
 * file's report), so such an entry no longer vouches the fate line into
 * printing. Omitting it keeps the gate byte-identical — a caller that cannot
 * name the audited sheet cannot resolve the comparison, and every entry with
 * a `file` scope keeps the carve-out.
 */
export function formatReport(
  path: string,
  report: ReturnType<typeof audit>,
  aims: readonly (CrossFileAim | undefined)[] = [],
  themeless: readonly (ThemelessAim | undefined)[] = [],
  skipped: readonly (SkippedAim | undefined)[] = [],
  auditedStylesheet?: string,
): string[] {
  const lines: string[] = [`themeguard — ${path}`, ""];

  // The disabled rules that actually REPORTED on this report — the population
  // the unmatched section's disabled-rule carve-out can honestly vouch for.
  // Derived from the report alone: only the policy puts rows on the two
  // policy legs, so membership there IS the fact, never a second derivation
  // of it. BOTH legs count, because the report has two output channels and
  // the policy partitions both: a rule that reported into `skipped` ONLY
  // (its findings silent) must earn the carve-out exactly as a
  // findings-reporting rule does — the old single-leg derivation read such a
  // rule as "disabled AND silent" and restored the false retirement advice
  // the carve-out was built to remove, while the pairs printed one section
  // up.
  const policyReportingRules = new Set<RuleId>([
    ...report.suppressedDisabled.map((row) => row.rule),
    ...report.skippedDisabled.map((row) => row.rule),
  ]);
  for (const rule of RULE_ORDER) {
    const found = report.findings.filter((f) => f.rule === rule);
    lines.push(`${rule} (${report.countsByRule[rule]})`);
    for (const finding of found) lines.push(`  [${finding.rule}] ${finding.message}`);
    lines.push("");
  }

  // Never dropped: an unmeasurable pair is silence, and silence reads as a pass.
  lines.push(`skipped (${report.skipped.length})`);
  if (report.skipped.length === 0) {
    if (report.skippedDisabled.length > 0) {
      // The policy holds the pairs, so measurability was never established
      // for them — this line must not claim it. The truthful sentence names
      // where the pairs went: the counted set-aside printed directly below.
      // (The partition is all-or-nothing per rule — `scale-collapse` is the
      // skipped channel's only producer — so a kept count of 0 beside a
      // populated set-aside means every pair the rule derived is below.)
      lines.push(
        "  nothing kept here — every pair rule 3 derived was set aside below by project policy, not found measurable.",
      );
    } else {
      lines.push("  nothing skipped — every pair rule 3 derived was measurable.");
    }
  } else {
    lines.push("  pairs rule 3 could not measure. Not findings, and not a pass either.");
    for (const pair of report.skipped) {
      lines.push(
        `  [skipped] ${pair.state} against ${pair.base} in theme "${pair.theme}": ` +
          `${pair.reason}${siblingScopeClause(pair)}`,
      );
    }
  }
  // The skipped channel's own policy set-aside — the counted-not-silent
  // discipline applied to the partition: a rule the project turned off
  // stops reporting into THIS channel too, and pairs that silently
  // vanished under the policy would reproduce exactly the silence this
  // section is built against. Counted under its own headline, named with
  // the policy's marker beside the channel's own. The headline prints only
  // when the set-aside holds rows — an always-printed empty headline would
  // change every policy-free report's bytes — and that gate is a DIFFERENT
  // surface from the zero line in the kept section above: the gate protects
  // policy-free byte-identity, while the zero line is policy-on output
  // territory and names this set-aside when it holds rows, never asserting
  // a measurability the run did not establish. Each row reuses the kept
  // rows' vocabulary — state,
  // base, theme, the pair's own reason, the sibling-scope clause — so a
  // reader moves between the two lists without learning a second shape;
  // the only difference is the marker, because WHO removed the row from
  // this list is the fact the row exists to state.
  if (report.skippedDisabled.length > 0) {
    lines.push(`skipped-disabled (${report.skippedDisabled.length})`);
    lines.push(
      '  skipped pairs a rule the project turned off in the "suppress-rule" key of themeguard.config.json also reported — counted here, named below, out of this section by project policy and never by a measurement: the pairs are exactly as unmeasured as they were, and the rule is off whole, its findings set aside under suppressed-disabled just as its pairs are set aside here.',
    );
    for (const { skipped: pair } of report.skippedDisabled) {
      lines.push(
        `  [disabled by policy] [skipped] ${pair.state} against ${pair.base} in theme "${pair.theme}": ` +
          `${pair.reason}${siblingScopeClause(pair)}`,
      );
    }
  }
  lines.push("");

  // The same counted-not-silent discipline, for what the USER has judged: a
  // finding marked deliberate — in themeguard.config.json, or in a
  // themeguard-ignore directive in the stylesheet itself — leaves the counts
  // above — and the exit code — but never the record. It is named here with
  // the reason its suppressor gave, so a run that exits 0 still says what it
  // chose not to hold against the stylesheet. The headline prints even at
  // zero: an empty section is the proof that nothing was set aside, and a
  // section that vanished at zero would read as a pass by omission.
  lines.push(`suppressed (${report.suppressed.length})`);
  if (report.suppressed.length === 0) {
    lines.push("  nothing suppressed — every finding above is one the report stands behind.");
  } else {
    lines.push(
      "  findings marked deliberate — in themeguard.config.json or in a themeguard-ignore directive in the stylesheet. Counted here, named below with the reason each was given — out of the counts and the exit code by declaration, never by silence.",
    );
    for (const { finding, reason, entry } of report.suppressed) {
      lines.push(`  [suppressed] [${finding.rule}] ${finding.message} — "${reason}"${scopeSuffix(entry)}${fileClause(entry)}${sourceClause(entry)}`);
    }
  }
  lines.push("");

  // The complement of `suppressed`, under the same counted-not-silent
  // discipline: a declared judgement that matched NOTHING is printed, because
  // silence is exactly what made a stale entry invisible. Suppression is a
  // standing ledger of signed-off exceptions, and nothing ever told the
  // reader one had outlived its defect — a config carrying dead entries read
  // byte-identically to no config at all. The section prints even at ZERO:
  // an empty section is the proof that every recorded judgement is still
  // doing work, and a section that vanished at zero would reproduce the very
  // silence this removes. It never moves the exit code — a stale entry is
  // hygiene, not a defect in the stylesheet, the same posture `skipped` and
  // `coverage` take. Each line reuses the vocabulary the `suppressed` lines
  // already have — the rule, the declared scope, the directive's `file:line`
  // source where it has one, the reason quoted — because an unmatched entry
  // is an entry like any other, only without a finding behind it. The prose
  // names the two causes honestly and stops: IN GENERAL the tool cannot tell
  // an expired judgement (defect fixed, retire the entry) from a mis-aimed
  // one, and must not pretend to. SIX cases it CAN tell, each with its own
  // carve-out line below, each printing only when this section actually
  // carries such an entry — so every section they do not apply to stays
  // byte-identical. FIRST, an entry with a
  // `file` scope names the stylesheet it was recorded against, so its
  // unmatchedness HERE is neither expiry nor mis-aim — it aims at a sibling
  // this config governs, and that file's report states its fate. SECOND, an
  // entry carrying a SITE whose rule and tokens match a live finding every one
  // of whose sites lives in ANOTHER file of the closure: there BOTH readings
  // are false — the defect prints above in this same report, and the entry did
  // aim at a finding that exists, one `@import` edge away — and the row names
  // that finding, where it sits, and the two moves that reach it. DIAGNOSIS
  // and never suppression: the entry is still unmatched, the fence that keeps
  // a directive inside its own file is untouched, and `crossFileAims` reads a
  // FINISHED report. THIRD, since 0.1.26: an entry whose `theme` scope names a
  // rule that measures STYLESHEET-WIDE — five of the nine push `theme: null`
  // at their own push sites — so the theme conjunct is not a near-miss but a
  // structurally DEAD scope, and the entry can never suppress anything in any
  // run. Both readings are false there too (the defect prints above, and the
  // rule and tokens DO match the finding that printed), and the row names the
  // rule, the dead scope and the one-key move. THE ONE-KEY MOVE IS
  // IDENTITY-ONLY: an entry whose `file` scope names ANOTHER stylesheet earns
  // no clause and does not print this line — the theme would not be the only
  // reason nothing matched there, so promising the key deletion would be the
  // very false advice this line exists to replace, and the file clauses below
  // are what speak for such an entry (`themelessAims` declines it). FOURTH,
  // since the `suppress-rule` policy: an entry whose rule the project turned
  // OFF can never match while the rule is off, and when that rule actually
  // REPORTED into either counted policy leg the row says so — one policy
  // decision from working — while a rule off AND silent keeps the ordinary
  // advice, there the defect may genuinely be gone. FIFTH, the kept-skipped
  // arm: an entry whose identity conjuncts match a pair rule 3 could not
  // measure — the pair is not a finding, so the entry matched nothing, yet the
  // pair prints one section up under the same rule id and token names. The row
  // names the pair and its silence, states that entries govern findings only
  // (this judgement never silenced a skipped row and never will), and gives
  // the real moves — make the pair measurable, accept the silence with
  // `suppress-rule`, or retire. A `file` scope naming ANOTHER stylesheet
  // declines it whole (`skippedAims` — the decline is other-file only; a scope
  // naming the audited sheet itself aims at a pair this report holds, one
  // section up, and earns the clause), and the disabled arm
  // never fires beside it: a disabled rule's pairs sit on `skippedDisabled`,
  // not kept `skipped`, so the two carve-outs are disjoint by construction. A
  // BOUNDARY the
  // section also states, since config discovery reaches down a subtree: the
  // config governs its own directory and below, so an entry whose scope
  // resolves OUTSIDE that subtree can never be honoured by ANY run — and for
  // it the sibling carve-out's comfort would be false. When such an entry is
  // unmatched here, the second line below prints instead (beside the
  // carve-out, if in-subtree aims share the section): this report is that
  // entry's fate-statement, not a retirement advisory about a file that
  // cannot exist.
  lines.push(`unmatched (${report.unmatchedSuppressions.length})`);
  if (report.unmatchedSuppressions.length === 0) {
    lines.push(
      "  nothing unmatched — every recorded judgement still covers a finding this report carries.",
    );
  } else {
    lines.push(
      "  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.",
    );
    if (aims.some((aim) => aim !== undefined)) {
      lines.push(
        "  an entry naming a live finding in another file is a third case this report CAN tell: its rule and tokens match a finding printed above, whose declaration lives in another file of the import closure. Neither reading above holds for it — the defect is not fixed, and the entry did aim at a finding that exists — so it is one move from working rather than retirable, and its line names where.",
      );
    }
    if (themeless.some((aim) => aim !== undefined)) {
      lines.push(
        "  an entry whose [theme: …] scope names a rule measured STYLESHEET-WIDE is a further case this report CAN tell: five of the nine rules report no theme at all, so such a scope matches nothing in this file, in any file of the closure, or in any run of this config. Neither reading above holds for it — the defect is not fixed, and the entry did aim at a finding that exists — so it is one key deletion from working rather than retirable, and its line names which key.",
      );
    }
    if (report.unmatchedSuppressions.some((entry) => policyReportingRules.has(entry.rule))) {
      lines.push(
        '  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell: a disabled rule reports into the counted policy sections of this report — suppressed-disabled for its findings, skipped-disabled for the pairs it could not measure — and can never match, so this judgement is neither expired nor mis-aimed — it is one policy decision away from working. Re-enable the rule, or retire the entry.',
      );
    }
    if (
      report.unmatchedSuppressions.some((entry) => {
        if (entry.file === undefined || beyondConfigHome(entry)) return false;
        // A scope naming the AUDITED stylesheet itself does not aim elsewhere:
        // "that file's report" is the report in the reader's hands, so the
        // advice is circular there and such an entry stops vouching the line
        // into existence. Read exactly as `matches` reads the scope
        // (`fileResolved` once the CLI has resolved one, the entry's own
        // spelling otherwise), compared against the same resolved path the
        // file conjunct compares; a caller that passed no audited stylesheet
        // cannot resolve the comparison and keeps the carve-out for every
        // scoped entry — the gate is byte-identical there.
        const scope = "fileResolved" in entry ? entry.fileResolved : entry.file;
        return scope !== auditedStylesheet;
      })
    ) {
      lines.push(
        "  an entry carrying a [file: …] clause names the stylesheet it was recorded against — for it, this report can tell: the judgement aims at that file, which this config governs too, and it neither expired here nor mis-aimed here. That file's report is the one that states its fate.",
      );
    }
    if (report.unmatchedSuppressions.some((entry) => beyondConfigHome(entry))) {
      lines.push(
        "  an entry whose [file: …] clause resolves OUTSIDE this config's own directory can never be honoured — a config governs its own directory and below, and no run of this config audits a stylesheet beyond its reach, so this report is that entry's fate-statement: re-aim the entry inside the config's directory, or retire it.",
      );
    }
    if (skipped.some((aim) => aim !== undefined)) {
      lines.push(
        "  an entry aimed at a pair rule 3 could not measure is a further case this report CAN tell: the skipped section above holds that pair — not findings, and not a pass either — and the entry's identity conjuncts match it. Neither reading above holds for it — the pair prints, so the judgement is not retirable against it, and a skip is not a finding: entries govern findings only, so this judgement never silenced that row and never will. The real moves are in its line: make the pair measurable (fix the value), accept the silence by turning the rule off with \"suppress-rule\", or retire the entry.",
      );
    }
    for (const [index, entry] of report.unmatchedSuppressions.entries()) {
      lines.push(
        `  [unmatched] [${entry.rule}] — "${entry.reason}"${tokenScope(entry)}${scopeSuffix(entry)}${fileClause(entry)}${sourceClause(entry)}${crossFileClause(aims[index])}${themelessClause(entry, themeless[index])}${skippedClause(skipped[index])}${disabledRuleClause(entry, policyReportingRules)}`,
      );
    }
  }
  lines.push("");

  // The policy's counted section, in the same counted-not-silent discipline
  // as `suppressed`: findings a PROJECT POLICY set aside — the rule each was
  // reported under is named in the config's `suppress-rule` key — leave the
  // per-rule counts above and the exit code, but never the record. The
  // headline prints even at zero: an empty section is the proof that no rule
  // is off, and a section that vanished at zero would read as a pass by
  // omission — the same silence discipline every counted section here is
  // built against. The rows print the policy's marker where `suppressed`
  // quotes a per-finding reason, because the policy names rules, not prose:
  // the judgement it records is the same for every finding the rule reported.
  lines.push(`suppressed-disabled (${report.suppressedDisabled.length})`);
  if (report.suppressedDisabled.length === 0) {
    lines.push(
      "  nothing disabled by policy — every finding above was reported by a rule the project has not turned off.",
    );
  } else {
    lines.push(
      '  findings reported by a rule the project turned off — its id is named in the "suppress-rule" key of themeguard.config.json. Counted here, named below — out of the counts and the exit code by project policy, never by silence.',
    );
    for (const { finding, reason } of report.suppressedDisabled) {
      lines.push(`  ${reason} [${finding.rule}] ${finding.message}`);
    }
  }
  lines.push("");

  // Coverage under the skipped precedent: the fact inventory rule 4 is measured
  // over, counted, named, printed even at zero, and never an exit code. An
  // inherited token is normal — theme-independent tokens have no override by
  // design — so the listing reports what each theme receives and stops; the
  // mixed shape inside it is judged by rule 4, whose findings DO count.
  const themeCount = report.coverage.length;
  const baseCount = report.coverage[0]?.baseTokens ?? 0;
  lines.push(
    `coverage (${themeCount} ${themeCount === 1 ? "theme" : "themes"}, ${baseCount} base tokens)`,
  );
  for (const theme of report.coverage) {
    const byKind = (kind: TokenKind) =>
      theme.inherited.filter((e) => e.kind === kind).length;
    const color = byKind("color");
    const nonColor = byKind("non-color");
    if (theme.inherited.length === 0) {
      lines.push(`  ${theme.theme}: declares all ${theme.baseTokens} base tokens, inherits 0.`);
    } else {
      // The split must partition the set it headlines. Colour and non-colour
      // are the ordinary two, but a base token's `var()` chain can also fail
      // to resolve in a theme (`unresolved`) or come back around (`cycle`) —
      // kinds that would otherwise vanish from both buckets and headline
      // `0 color / 0 non-color` against a non-zero total. They are appended
      // when present, so the parenthetical always sums to the inherited
      // count; when none are present the two-segment form stands unchanged.
      const segments = [`${color} color`, `${nonColor} non-color`];
      for (const kind of ["unresolved", "cycle"] as const) {
        const count = byKind(kind);
        if (count > 0) segments.push(`${count} ${kind}`);
      }
      lines.push(
        `  ${theme.theme}: declares ${theme.overridden.length} of ${theme.baseTokens} base tokens, ` +
          `inherits ${theme.inherited.length} (${segments.join(" / ")}).`,
      );
      for (const entry of theme.inherited) {
        lines.push(`    [inherited] ${entry.name} (${entry.kind})`);
      }
    }
  }
  lines.push("");

  const total = report.findings.length;
  lines.push(
    total === 0
      ? "No findings."
      : `${total} ${total === 1 ? "finding" : "findings"}: ` +
          RULE_ORDER.map((rule) => `${report.countsByRule[rule]} ${rule}`).join(", ") +
          ".",
  );

  return lines;
}

/**
 * The report as ONE line of JSON — the `--json` renderer, separated from the
 * I/O for exactly the reason {@link formatReport} is: a test reads it as data
 * instead of scraping a subprocess.
 *
 * One compact object per file, emitted as that file completes, which makes an
 * invocation's stdout NDJSON: `themeguard --json a.css b.css | jq …` streams,
 * and a fail-fast exit 2 on the second file leaves the first file's line
 * already written and already parseable. There is deliberately no
 * invocation-level envelope around the lines — an array would have to be
 * closed at the end, and the end is exactly what a fail-fast run does not
 * reach.
 *
 * ── The shape ─────────────────────────────────────────────────────────────
 * The {@link AuditReport} VERBATIM, with `path` in front of it. Nothing is
 * renamed, summarized, flattened or dropped: a consumer that has the library's
 * types has this object's types, and the CLI stops being the one consumer that
 * only gets prose. `path` is the string the caller NAMED on the command line,
 * not a resolved absolute — it is what the caller will match its own argv
 * against, and the prose header quotes it the same way.
 *
 * ⚠️ The key order is the REPORT OBJECT's own insertion order — `findings`,
 * `countsByRule`, `suppressed`, `unmatchedSuppressions`, `suppressedDisabled`,
 * `skipped`, `skippedDisabled`, `coverage` (`audit.ts`'s return literal). That
 * is NOT the prose renderer's
 * section order, which prints `skipped` BEFORE `suppressed`. Follow the
 * object: `JSON.stringify` preserves insertion order, and the project already
 * treats that order as a compatibility surface — `tests/package.test.ts` pins
 * `JSON.stringify(report.countsByRule)` as an exact byte string, key order
 * included. A later reader "fixing" this to match the prose would break a
 * consumer for cosmetics.
 *
 * `skippedDisabled` is the skipped channel's own policy leg, appended after
 * `skipped` so the two legs of one channel sit beside each other: the same
 * additive-key status every other report-level leg carries, empty — not
 * absent — wherever no rule is off, exactly as `suppressedDisabled` is.
 *
 * ⚠️ `sites` is ABSENT on the findings of rules that carry none
 * (`dead-token`, `unresolved-reference`, `duplicate-declaration`) rather than
 * `null`. That is the library's own serialization — `JSON.stringify` omits an
 * undefined optional — and {@link import("./rules/finding").Finding.sites}
 * documents the absence as a FACT rather than an omission: a consumer reads
 * `sites` as "the position, if the rule has one to give". Emitting `null`
 * would invent a value the library never had.
 *
 * `suppressed` entries carry `{finding, reason, entry}` whole, the entry
 * including its scope fields (`theme` / `tokens` / `token` / `file` /
 * `source` / `line`) and the `fileBeyondConfigHome` annotation — the prose
 * renders those as bracket suffixes, and a machine consumer gets the fields.
 *
 * ⚠️ `unmatchedSuppressions` rows are the library's entries with ONE additive
 * key: `crossFileAim`, `{rule, site}` naming the live finding the entry's
 * conjuncts match in ANOTHER file of the closure — the machine form of the
 * prose's `— matches a live …` clause, so a pipeline caller reads the pointer
 * as data instead of regexing a sentence out of it. The key is ABSENT (not
 * `null`) on every row without one, which is every config entry and every
 * directive whose miss is not the cross-file one — the same absence-is-a-fact
 * discipline `sites` carries above, and what keeps every row this does not
 * apply to byte-identical. It is a DIAGNOSIS, never a suppression: the entry is
 * still unmatched, it is still on this leg, and the counts and the exit code are
 * untouched.
 *
 * `aims` is that diagnosis ({@link crossFileAims}), ALIGNED BY INDEX with
 * `report.unmatchedSuppressions`. Additive and optional: omit it and the object
 * is byte-identical to before the diagnosis existed.
 *
 * ⚠️ A SECOND additive key rides the same discipline since 0.1.26:
 * `themelessAim`, `{rule}` naming the theme-less rule an entry's `theme` scope
 * aimed at — the machine form of the prose's `— [rule] findings are measured
 * stylesheet-wide …` clause. ABSENT (not `null`) on every row without one, and
 * `themeless` ({@link themelessAims}) is that diagnosis, aligned by index the
 * same way and optional on the same terms.
 *
 * ⚠️ A THIRD additive key rides the same discipline: `skippedAim`,
 * `{theme, base, state, reason}` naming the kept pair rule 3 could not measure
 * that an entry's identity conjuncts match — the machine form of the prose's
 * `— its conjuncts match the pair rule 3 could not measure …` clause, the
 * pair spelled exactly as the skipped section prints it. ABSENT (not `null`)
 * on every row without one, and `skipped` ({@link skippedAims}) is that
 * diagnosis, aligned by index the same way and optional on the same terms.
 */
export function formatReportJson(
  path: string,
  report: ReturnType<typeof audit>,
  aims: readonly (CrossFileAim | undefined)[] = [],
  themeless: readonly (ThemelessAim | undefined)[] = [],
  skipped: readonly (SkippedAim | undefined)[] = [],
): string {
  // The rows are rebuilt only where an aim exists, and the entry's own keys are
  // spread FIRST so the added one lands last and no existing key order moves. A
  // row with no aim is passed through as the SAME object — not a copy with an
  // undefined key, which would serialize identically but invites a reader to
  // think the shape changed for every row.
  const unmatchedSuppressions = report.unmatchedSuppressions.map((entry, index) => {
    const aim = aims[index];
    const themelessAim = themeless[index];
    const skippedAim = skipped[index];
    if (aim === undefined && themelessAim === undefined && skippedAim === undefined) return entry;
    return {
      ...entry,
      ...(aim === undefined ? {} : { crossFileAim: aim }),
      ...(themelessAim === undefined ? {} : { themelessAim }),
      ...(skippedAim === undefined ? {} : { skippedAim }),
    };
  });
  return JSON.stringify({ path, ...report, unmatchedSuppressions });
}

/**
 * True when THIS file is the process entry point.
 *
 * `process.argv[1]` is the path node was handed, which for an installed package
 * is npm's `node_modules/.bin/themeguard` SYMLINK, while `import.meta.url` is
 * always the real file node resolved it to — so comparing the two directly
 * reports false exactly where it matters most, on a real installation. The
 * realpath is what makes the two comparable.
 */
function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const code = runCli(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
  process.exitCode = code;
}
