/**
 * `/* themeguard-ignore … *\/` — the site-scoped half of suppression, written
 * IN the stylesheet it judges.
 *
 * The config records a judgement NEXT TO the stylesheet; a directive records
 * it where a reader of the CSS can see it. That difference is not cosmetic.
 * A config entry matches a finding's identity — rule, token dimension, theme —
 * so when the code moves, the judgement stays: an entry written about line 4
 * keeps suppressing after a refactor moves the defect to line 7, silently
 * holding down a defect nobody judged. A directive is bound to its site BY
 * CONSTRUCTION: it lives at the site, so moving the defect orphans the
 * directive, the finding it used to cover prints again and moves the exit
 * code — the same self-announcing miss a mis-aimed config entry gets, and
 * deliberately not a silence. That miss is self-announcing only while the
 * finding still exists: FIX the defect rather than moving it and there is
 * nothing left to announce anything, so the orphaned judgement is named
 * instead by the audit report's counted `unmatchedSuppressions` leg (the
 * CLI's `unmatched` section) — still not an error, never a silence. And when
 * the file is vendored, regenerated or forked, the judgement travels with it.
 *
 * The grammar is one comment:
 *
 *     themeguard-ignore <rule> [--token …] -- <reason>
 *
 * The keyword, then the rule id, then optional `--`-prefixed token names (the
 * same includes-semantics as a config entry's `tokens` set: the finding must
 * carry every name listed), then a required non-empty reason after the bare
 * `--` separator. The separator is a word of exactly two hyphens, so it can
 * never be confused with a token NAME — `--accent` is a token, `--` alone is
 * the split. Everything after it is the reason, verbatim.
 *
 * Two placements match a finding: TRAILING, on the judged declaration's own
 * line, and STANDALONE on the line directly above it — the two the industry's
 * `eslint-disable-next-line` and `stylelint-disable-line` established. A
 * directive's line is where its comment STARTS.
 *
 * Validation is config's own, on purpose. The directive's fields are
 * round-tripped through `parseConfig` — the only door to the canonical
 * rule-id list, which lives unexported in `config.ts` — so a directive cannot
 * drift from what a config entry may say: an unknown rule id, a missing or
 * empty reason is a HARD ERROR naming the comment's line (config's
 * never-silently-ignored discipline; a directive that silently did nothing
 * would leave a finding reported after all). The one shape config itself
 * rejects is a directive that names no token — the SITE replaces the token
 * dimension there — so the round-trip carries a probe name for that field
 * alone, and the entry this module returns carries only what the directive
 * wrote.
 */

import { CONFIG_FILENAME, ConfigError, parseConfig } from "./config.js";
import type { SiteScopedSuppressionEntry } from "./audit.js";

/** The comment keyword. A comment is a directive when its body STARTS with this word. */
export const IGNORE_KEYWORD = "themeguard-ignore";

/**
 * What a directive that names no token round-trips through `parseConfig` as.
 * The config schema demands a token dimension; a directive's site replaces
 * it. The probe satisfies that one field so the OTHER fields still validate
 * against config's own rules — and it is never carried: the returned entry
 * names no token, which is the directive's meaning. The probe is safe by
 * construction: `parseConfig` is pure and can never reject a token for not
 * existing in a stylesheet, only for being empty.
 */
const SITE_PROBE_TOKEN = "--themeguard-site-probe";

/**
 * A suppression recorded at its site: the entry fields a config entry carries
 * (a directive never carries `theme` — the grammar has no scope beyond the
 * site), plus where the judgement lives. `line` is what matching reads; see
 * `audit`. `source` is the `file:line` provenance the report prints.
 */
export type IgnoreDirective = SiteScopedSuppressionEntry;

/** A directive this package cannot honour — always the user's own comment. */
export class DirectiveError extends Error {
  /** The path of the stylesheet holding the directive. */
  readonly path: string;
  /** The 1-based line the directive's comment starts on. */
  readonly line: number;

  constructor(path: string, line: number, detail: string) {
    super(`invalid /* ${IGNORE_KEYWORD} */ directive at ${path}:${line} — ${detail}`);
    this.name = "DirectiveError";
    this.path = path;
    this.line = line;
  }
}

const DIRECTIVE_COMMENT = /^themeguard-ignore(?=\s|$)/;

/** The head/reason split: the first word of exactly two hyphens. */
const REASON_SEPARATOR = /(?:^|\s)--(?:\s|$)/;

/**
 * Scan the ORIGINAL stylesheet text for `themeguard-ignore` directives and
 * return one entry per comment, in source order. String-aware, on the same
 * terms as `parse.ts`'s `blankComments`: a `themeguard-ignore` comment inside
 * a CSS string (`content: "/* themeguard-ignore … *\/"`) is prose, not a
 * directive. This walk is a conscious small duplicate of that walk — the
 * scanner needs comment BODIES and their lines, which blanking deliberately
 * erases; consolidating the two would put directive grammar inside the parser,
 * which must stay judgement-free.
 *
 * Pure: the caller reads the file; this module judges its text. Any malformed
 * directive throws {@link DirectiveError} naming the comment's line — an
 * unhonourable directive is never silently skipped, exactly as an
 * unhonourable config entry is never silently skipped.
 */
export function scanIgnoreDirectives(
  css: string,
  path: string,
): readonly IgnoreDirective[] {
  const directives: IgnoreDirective[] = [];
  let i = 0;
  let inString: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const stop = close === -1 ? css.length : close + 2;
      // An unterminated comment ends at EOF — the same reading parse.ts's
      // blanker takes; the stylesheet is already broken on its own terms.
      const body = css.slice(i + 2, close === -1 ? css.length : close).trim();
      if (DIRECTIVE_COMMENT.test(body)) {
        directives.push(parseDirective(body, lineOf(css, i), path));
      }
      i = stop;
      continue;
    }
    i += 1;
  }
  return directives;
}

/**
 * The 1-based line of `offset` — the same newline convention parse.ts's line
 * index uses, so a directive's line and a finding's site line are the same
 * number for the same place. Computed per directive comment, which is rare by
 * nature: directives are hand-written annotations, not generated content.
 */
function lineOf(css: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (css[i] === "\n") line += 1;
  return line;
}

/**
 * Parse one directive comment body (already trimmed, already known to start
 * with the keyword) into an entry bound to its site. The grammar errors —
 * a missing separator, a word in the head that is neither the rule id nor a
 * `--` token name — are this module's own sentences; what an entry may SAY —
 * the rule id, the reason's emptiness, the token names — is validated by
 * config's own parser, so the two mechanisms cannot drift apart.
 */
function parseDirective(body: string, line: number, path: string): IgnoreDirective {
  const fail = (detail: string): never => {
    throw new DirectiveError(path, line, detail);
  };

  const head = body.slice(IGNORE_KEYWORD.length).trim();

  // Split head (rule id + token names) from reason at the first standalone
  // `--`. The split is word-level, not substring-level, because token NAMES
  // also begin with `--`: `--accent` never matches the separator, the bare
  // `--` always does. Everything after it is the reason, verbatim.
  const separator = REASON_SEPARATOR.exec(head);
  const headText = separator === null ? head : head.slice(0, separator.index);
  const reason =
    separator === null ? "" : head.slice(separator.index + separator[0].length).trim();

  const words = headText.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    // `/* themeguard-ignore */` and nothing else: the grammar sentence is the
    // remedy here, and it quotes no rule-id list — that list is config's to
    // name, and it is named (by config's own sentence) when a rule id is
    // present but unknown.
    fail(`names no rule — a directive is "${IGNORE_KEYWORD} <rule> [--token …] -- <why>"`);
  }
  const rule = words[0] as string;
  const tokenNames: string[] = [];
  for (const word of words.slice(1)) {
    if (!word.startsWith("--") || word.length === 2) {
      fail(
        `expected a token name like --accent, or the bare "--" that starts the reason — got ${JSON.stringify(word)}`,
      );
    }
    tokenNames.push(word);
  }
  if (separator === null) {
    fail(
      `ends without a reason — a directive is "${IGNORE_KEYWORD} <rule> [--token …] -- <why>", and the report quotes the why`,
    );
  }

  // Round-trip through config's own parser: the canonical rule-id list is
  // config's, unexported, and this is the door to it. A rule id, an empty
  // reason or an empty token name that config would reject, the directive
  // rejects with config's own sentence — relocated to the comment's line.
  const candidate: { rule: string; reason: string; tokens: string[] } = {
    rule,
    reason,
    tokens: tokenNames.length > 0 ? tokenNames : [SITE_PROBE_TOKEN],
  };

  let validated;
  try {
    [validated] = parseConfig(JSON.stringify({ suppress: [candidate] }), path);
  } catch (error) {
    if (error instanceof ConfigError) {
      fail(configDetail(error, path));
    }
    throw error;
  }

  return {
    rule: validated.rule,
    reason: validated.reason,
    ...(tokenNames.length > 0 ? { tokens: tokenNames } : {}),
    line,
    source: `${path}:${line}`,
  };
}

/**
 * Keep config's sentence — the same words a config entry's error prints,
 * which is the consistency the round-trip is for — minus the two location
 * clauses that name the wrong thing here: the config-file prologue and the
 * synthetic "entry 1" wrapper the round-trip builds. Both literals are
 * constructed here, so the strip is exact; a future config error matching
 * neither prints whole (mislocated, never silent).
 */
function configDetail(error: ConfigError, path: string): string {
  return error.message
    .replace(`invalid ${CONFIG_FILENAME} at ${path} — `, "")
    .replace('entry 1 of "suppress": ', "");
}
