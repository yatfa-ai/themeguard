#!/usr/bin/env node
/**
 * The command — `themeguard <file.css>`.
 *
 * One command, zero options. It reads a stylesheet from disk, runs the same
 * `audit(resolveCss(css))` the library exposes, and prints the report. It adds
 * no rule, no heuristic and no judgement of its own: everything here is I/O and
 * presentation over a report the library already produced.
 *
 * ── What it prints, and why in this shape ──────────────────────────────────
 * Findings are grouped by rule, each group headed by its COUNT, and every line
 * is the README's own `[rule] message` shape so a line pasted into an issue
 * still says which question it answers. All three rule headings are printed
 * even at zero, because a rule that reports nothing and a rule that did not run
 * look identical if the heading is omitted — and "no findings" reads as a pass.
 *
 * For the same reason `skipped` is rendered EXPLICITLY rather than dropped. A
 * pair rule 3 could not measure (a translucent member has no lightness until it
 * is composited, and themeguard never invents a backdrop) is silence, and
 * silence reads exactly like a clean result. The library goes to the trouble of
 * counting it; a CLI that swallowed it would undo that.
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
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { audit } from "./audit.js";
import { resolveCss } from "./resolve.js";
import type { RuleId } from "./rules/finding.js";

/** The audit ran and reported nothing. */
export const EXIT_OK = 0;
/** The audit ran and reported at least one finding. */
export const EXIT_FINDINGS = 1;
/** The audit did not run: bad usage, or the file could not be read. */
export const EXIT_ERROR = 2;

/** Where the command writes. Injected so the report is testable as data. */
export interface CliIo {
  /** A line of the report. */
  readonly out: (line: string) => void;
  /** A line of diagnostics — usage, unreadable file. */
  readonly err: (line: string) => void;
}

export const USAGE = "usage: themeguard <file.css>";

/** The order groups are printed in — the library's own reading order. */
const RULE_ORDER: readonly RuleId[] = ["collision", "dead-token", "scale-collapse"];

/**
 * Run the command over `args` (the arguments AFTER the program name) and return
 * the exit code. Pure but for the file read: everything printed goes through
 * `io`, so a test reads the report instead of scraping a subprocess.
 */
export function runCli(args: readonly string[], io: CliIo): number {
  if (args.length !== 1) {
    io.err(USAGE);
    io.err(
      args.length === 0
        ? "themeguard: no stylesheet given."
        : `themeguard: expected exactly one file, got ${args.length}.`,
    );
    return EXIT_ERROR;
  }

  const path = args[0] as string;

  let css: string;
  try {
    css = readFileSync(path, "utf8");
  } catch (error) {
    io.err(`themeguard: cannot read ${path}`);
    io.err(`  ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_ERROR;
  }

  const report = audit(resolveCss(css));
  for (const line of formatReport(path, report)) io.out(line);

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
