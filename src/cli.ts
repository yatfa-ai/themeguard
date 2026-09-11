#!/usr/bin/env node
/**
 * The command — `themeguard <file.css> [file.css…]`.
 *
 * One command, zero options; the positionals repeat. Each named stylesheet is
 * read from disk, run through the same `audit(resolveCss(css))` the library
 * exposes, and printed under its own `themeguard — <path>` header. It adds
 * no rule, no heuristic and no judgement of its own: everything here is I/O and
 * presentation over reports the library already produced.
 *
 * The files are audited INDEPENDENTLY — the single-file contract unchanged per
 * file. References do not cross files: one stylesheet's tokens are invisible to
 * the next, and the config beside each stylesheet governs it alone. A
 * suppression is worth exactly the file it was recorded against — and since
 * 0.1.11 that is true by DECLARATION, not by accident of where the config
 * sits: an entry may name the file it was judged against (`file`, relative to
 * the config's own directory), and a file-scoped entry governs that one
 * stylesheet — so a directory sharing one ledger among siblings can record a
 * judgement for `tokens.css` without it silencing `buttons.css`. An entry
 * without the field keeps the whole-config reading it has always had. The
 * invocation fails fast on the first file that cannot be audited, and the
 * per-file outcomes aggregate into ONE exit code for the invocation — the
 * precedence is stated in the exit contract below, because a caller in a
 * pipeline gets one invocation and one verdict, not N runs to OR by hand.
 *
 * ── What it prints, and why in this shape ──────────────────────────────────
 * Findings are grouped by rule, each group headed by its COUNT, and every line
 * is the README's own `[rule] message` shape so a line pasted into an issue
 * still says which question it answers. All four rule headings are printed
 * even at zero, because a rule that reports nothing and a rule that did not run
 * look identical if the heading is omitted — and "no findings" reads as a pass.
 *
 * For the same reason `skipped` is rendered EXPLICITLY rather than dropped. A
 * pair rule 3 could not measure (a translucent member has no lightness until it
 * is composited, and themeguard never invents a backdrop) is silence, and
 * silence reads exactly like a clean result. The library goes to the trouble of
 * counting it; a CLI that swallowed it would undo that.
 *
 * ── The config ────────────────────────────────────────────────────────────
 * `themeguard.config.json`, OPTIONAL, is discovered NEXT TO THE STYLESHEET —
 * not the process CWD: a run names stylesheets — `themeguard <file.css>
 * [file.css…]` — and the config that governs a file is the one beside it.
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
 * the two possible causes and stops — the tool cannot tell an expired
 * judgement (defect fixed, retire the entry) from a mis-aimed one, and must
 * not pretend to. One cause it CAN tell, and since 0.1.11 says so: an entry
 * carrying a ` [file: …]` clause names the stylesheet it was recorded
 * against, so its presence on this report is neither expiry nor mis-aim — it
 * aims at a sibling file this config governs, and that file's report is the
 * one that states its fate. A clause-carrying entry is never advised retired
 * on this report's word.
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
 * The `unmatched` section is likewise outside the exit: a declared entry that
 * matched nothing is a stale or mis-aimed JUDGEMENT, not a defect in the
 * stylesheet, so an expired judgement must never turn a green pipeline red.
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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, type SiteScopedSuppressionEntry } from "./audit.js";
import { ConfigError, loadConfig, type SuppressionEntry } from "./config.js";
import { DirectiveError, scanIgnoreDirectives } from "./directives.js";
import { resolveCss } from "./resolve.js";
import type { TokenKind } from "./resolve.js";
import type { RuleId } from "./rules/finding.js";

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

export const USAGE = "usage: themeguard <file.css> [file.css…]";

/** The order groups are printed in — the library's own reading order. */
const RULE_ORDER: readonly RuleId[] = [
  "collision",
  "dead-token",
  "scale-collapse",
  "family-consistency",
  "unresolved-reference",
  "cycle-reference",
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
 * Run the command over `args` (the arguments AFTER the program name) and return
 * the exit code. Zero arguments is the usage error it has always been; one or
 * more paths are audited IN ORDER, each through {@link auditStylesheet} — its
 * reports print as they complete, the first file that cannot be audited ends
 * the invocation fail-fast with 2, and otherwise the per-file outcomes
 * aggregate into one code: 1 if ANY file reported unsuppressed findings, else
 * 0 (precedence 2 > 1 > 0 — see the exit contract in the header). Pure but for
 * the file reads: everything printed goes through `io`, so a test reads the
 * report instead of scraping a subprocess.
 */
export function runCli(args: readonly string[], io: CliIo): number {
  if (args.length === 0) {
    io.err(USAGE);
    io.err("themeguard: no stylesheet given.");
    return EXIT_ERROR;
  }

  // The invocation-level verdict: whether ANY file completed with unsuppressed
  // findings. Each file's own outcome is decided inside the loop below; this
  // is what survives the loop and turns into the aggregated exit.
  let anyFindings = false;

  for (const path of args) {
    const outcome = auditStylesheet(path, io);
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
 * invocation names. Reads the file, loads the config discovered BESIDE it,
 * scans its directives, audits, prints its report under its own
 * `themeguard — <path>` header, and returns that file's outcome — 1 when the
 * file carries unsuppressed findings, 0 when it is clean, 2 when it cannot be
 * audited at all (with the diagnostic on `io.err`, naming this file's path or
 * this file's config or directive). Pure but for the file read: everything
 * printed goes through `io`, so a test reads the report instead of scraping a
 * subprocess.
 */
function auditStylesheet(path: string, io: CliIo): number {
  let css: string;
  try {
    css = readFileSync(path, "utf8");
  } catch (error) {
    io.err(`themeguard: cannot read ${path}`);
    io.err(`  ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }

  // The config, if the user wrote one, sits NEXT TO the stylesheet — not in
  // the process CWD. A run is `themeguard <file.css>`, so the config that
  // governs a file is the one beside it; a CWD lookup would make the same
  // command mean different things from different directories. Absent file ⇒
  // no suppressions — every existing line of the report is unchanged and the
  // exit codes hold; the only addition is the counted `suppressed` section —
  // while a present but unhonourable one ⇒ exit 2, bad usage's own contract,
  // never a silent skip.
  let suppressions;
  try {
    suppressions = loadConfig(path);
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

  // The in-source complement: `/* themeguard-ignore … *\/` directives,
  // scanned from the ORIGINAL stylesheet text — the judgement recorded where
  // a reader of the CSS can see it, bound to its site by construction. A
  // malformed directive is the config's own contract: exit 2 naming the
  // comment's line, never a silent skip.
  let directives;
  try {
    directives = scanIgnoreDirectives(css, path);
  } catch (error) {
    io.err(
      error instanceof DirectiveError
        ? `themeguard: ${error.message}`
        : `themeguard: cannot scan themeguard-ignore directives — ${
            error instanceof Error ? error.message : String(error)
          }`,
    );
    return EXIT_ERROR;
  }

  // The merge seam: a directive entry is structurally a config entry carrying
  // one extra conjunct (its line), so the audit sees one suppression list.
  // Config entries come first, so a config/directive tie resolves to the
  // config's reason — the same first-wins rule the list itself has.
  //
  // File-scoped entries are resolved HERE, the only place that knows both
  // halves: the entry carries `file` relative to the CONFIG's own directory,
  // and this function knows that directory (the stylesheet's — the config
  // sits beside it). Each scoped entry is shallow-copied with the resolved
  // absolute path as an additive annotation, the same treatment the 0.1.4
  // site scope gave a directive; the written spelling rides along untouched,
  // so the report's ` [file: …]` clause prints what the user wrote. Entries
  // without the field pass through as the SAME objects — no scope, no copy,
  // byte-identical behaviour. The audited stylesheet travels alongside as
  // `stylesheet`, normalized the same way, which is what the conjunct
  // compares against.
  const scoped = (suppressions ?? []).map((entry) =>
    entry.file === undefined
      ? entry
      : { ...entry, fileResolved: resolve(dirname(path), entry.file) },
  );
  const report = audit(resolveCss(css), {
    suppressions: [...scoped, ...directives],
    stylesheet: resolve(path),
  });
  for (const line of formatReport(path, report)) io.out(line);

  // Findings here are the UNSUPPRESSED ones — a finding the user has recorded
  // as deliberate no longer holds the exit code hostage, which is the whole
  // point of the config.
  return report.findings.length > 0 ? EXIT_FINDINGS : EXIT_OK;
}

/** The printed report, as lines. Separated from the I/O so tests can read it. */
export function formatReport(
  path: string,
  report: ReturnType<typeof audit>,
): string[] {
  const lines: string[] = [`themeguard — ${path}`, ""];

  for (const rule of RULE_ORDER) {
    const found = report.findings.filter((f) => f.rule === rule);
    lines.push(`${rule} (${report.countsByRule[rule]})`);
    for (const finding of found) lines.push(`  [${finding.rule}] ${finding.message}`);
    lines.push("");
  }

  // Never dropped: an unmeasurable pair is silence, and silence reads as a pass.
  lines.push(`skipped (${report.skipped.length})`);
  if (report.skipped.length === 0) {
    lines.push("  nothing skipped — every pair rule 3 derived was measurable.");
  } else {
    lines.push("  pairs rule 3 could not measure. Not findings, and not a pass either.");
    for (const pair of report.skipped) {
      lines.push(
        `  [skipped] ${pair.state} against ${pair.base} in theme "${pair.theme}": ${pair.reason}`,
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
  // names the two causes honestly and stops: the tool cannot tell an expired
  // judgement (defect fixed, retire the entry) from a mis-aimed one, and
  // must not pretend to. ONE case it can tell, and the carve-out line below
  // says so whenever this section carries such an entry: an entry with a
  // `file` scope names the stylesheet it was recorded against, so its
  // unmatchedness HERE is neither expiry nor mis-aim — it aims at a sibling
  // this config governs, and that file's report states its fate. The carve-
  // out prints only when at least one unmatched entry carries the clause, so
  // every section it does not apply to stays byte-identical.
  lines.push(`unmatched (${report.unmatchedSuppressions.length})`);
  if (report.unmatchedSuppressions.length === 0) {
    lines.push(
      "  nothing unmatched — every recorded judgement still covers a finding this report carries.",
    );
  } else {
    lines.push(
      "  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.",
    );
    if (report.unmatchedSuppressions.some((entry) => entry.file !== undefined)) {
      lines.push(
        "  an entry carrying a [file: …] clause names the stylesheet it was recorded against — for it, this report can tell: the judgement aims at that file, which this config governs too, and it neither expired here nor mis-aimed here. That file's report is the one that states its fate.",
      );
    }
    for (const entry of report.unmatchedSuppressions) {
      lines.push(
        `  [unmatched] [${entry.rule}] — "${entry.reason}"${tokenScope(entry)}${scopeSuffix(entry)}${fileClause(entry)}${sourceClause(entry)}`,
      );
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
