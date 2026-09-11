/**
 * The shape every rule reports in.
 *
 * One `Finding` is one thing a human should look at. It carries the tokens it
 * is about, the theme it was measured in, and — always — the MEASUREMENT that
 * produced it, so a reader can check the verdict rather than take it. A rule
 * that cannot say what it measured is not reporting a defect, it is asserting
 * one.
 */

/** Which of the four questions a finding answers. */
export type RuleId =
  /** Two token names that must differ hold byte-identical colours. */
  | "collision"
  /** A token is declared and referenced by no `var()` anywhere. */
  | "dead-token"
  /** Two tokens meant to read apart are closer than a visible step in L*. */
  | "scale-collapse"
  /**
   * A theme inherits a token whose family the theme's own declarations tune —
   * at least one sibling sharing the token's declared family head is
   * overridden, so the un-restated member silently keeps the base value.
   */
  | "family-consistency";

/**
 * WHERE a finding's token was declared — the declaration the resolver actually
 * judged, not merely a place the name appears.
 *
 * `line` only, and deliberately NO selector. A theme's table is merged across
 * every scope that contributes to it, so by the time a rule reads a token there
 * is no single selector to attribute the winning declaration to; inventing one
 * would be a guess printed as a fact. `dead-token` can say `:root:402` because
 * it walks the parsed scopes itself, one declaration at a time, and never
 * consults a merged table. Adding scope attribution to the resolved tokens is a
 * resolver change, and it is not this one.
 */
export interface FindingSite {
  /** The token this position belongs to. */
  readonly name: string;
  /** 1-based line of the declaration the finding was measured from. */
  readonly line: number;
}

export interface Finding {
  readonly rule: RuleId;
  /**
   * The theme the finding was measured in, or `null` for a finding that is not
   * theme-specific. A dead token is dead in the STYLESHEET, not in a theme.
   */
  readonly theme: string | null;
  /**
   * The tokens the finding is about, in the order the message reads them.
   * Always at least one.
   */
  readonly tokens: readonly string[];
  /** One line, naming the tokens and the measurement. */
  readonly message: string;
  /**
   * The numbers behind the verdict. Rule-specific by design — a collision has a
   * shared value and no distance, a scale collapse has a distance and no shared
   * value — so callers read the key their rule defines rather than a lowest
   * common denominator that fits neither.
   */
  readonly evidence: Readonly<Record<string, string | number | readonly string[]>>;
  /**
   * WHERE the finding lives — one entry per token the rule measured, naming the
   * declaration that WON the cascade in the theme the finding was measured in.
   * A token declared in `:root` and again in a theme has two declarations and
   * only one of them was judged; this cites that one.
   *
   * OPTIONAL, and its absence is a fact rather than an omission: `dead-token`
   * carries none because it already says `:root:402` in its own message, with a
   * selector this field deliberately cannot supply (see {@link FindingSite}).
   * A consumer therefore reads `sites` as "the position, if the rule has one to
   * give", never as "every finding's position".
   */
  readonly sites?: readonly FindingSite[];
}

/**
 * The position clause a rule appends to its message, in `dead-token`'s voice
 * minus the selector it alone can supply: `Declared at line 41.`, or
 * `Declared at lines 41 and 33.` for a pair.
 *
 * The lines read in the order the SITES are given, and every rule gives them in
 * the order its own message names the tokens — so
 * `--app-border and --app-surface-raised … Declared at lines 41 and 33.` pairs
 * name with line positionally rather than asking the reader to match them up.
 * That ordering matters for the PROSE only: each site carries its own `name`,
 * so a machine reading `sites` never depends on it.
 *
 * Duplicates are kept, deliberately: two tokens resolving from ONE declaration
 * is a fact about the stylesheet, and de-duplicating would silently break the
 * positional pairing the sentence depends on.
 */
export function positionClause(sites: readonly FindingSite[]): string {
  const lines = sites.map((s) => String(s.line));
  if (lines.length === 0) return "";
  if (lines.length === 1) return `Declared at line ${lines[0]}.`;
  const last = lines[lines.length - 1] as string;
  return `Declared at lines ${lines.slice(0, -1).join(", ")} and ${last}.`;
}

/** Sort into a stable reading order: rule, then theme, then tokens. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: Record<RuleId, number> = {
    collision: 0,
    "dead-token": 1,
    "scale-collapse": 2,
    "family-consistency": 3,
  };
  return [...findings].sort(
    (a, b) =>
      order[a.rule] - order[b.rule] ||
      (a.theme ?? "").localeCompare(b.theme ?? "") ||
      a.tokens.join(",").localeCompare(b.tokens.join(",")),
  );
}
