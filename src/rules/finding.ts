/**
 * The shape every rule reports in.
 *
 * One `Finding` is one thing a human should look at. It carries the tokens it
 * is about, the theme it was measured in, and — always — the MEASUREMENT that
 * produced it, so a reader can check the verdict rather than take it. A rule
 * that cannot say what it measured is not reporting a defect, it is asserting
 * one.
 */

/** Which of the eight questions a finding answers. */
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
  | "family-consistency"
  /**
   * A `var()` names a custom property that no scope in the stylesheet declares,
   * so it resolves to nothing — the property falls back to unset/inherit, or to
   * whatever fallback was written.
   */
  | "unresolved-reference"
  /**
   * A `var()` chain returns to a name already on it. Every property in the
   * loop — and every `var()` consuming a member — is invalid at computed-value
   * time; the finding is scoped by authorship, `theme: null` for a loop the
   * base declarations (or the alias namespace) author, theme-scoped for one a
   * theme's own declarations close.
   */
  | "cycle-reference"
  /**
   * A custom property is declared more than once in ONE scope with differing
   * values. The cascade keeps the last declaration and silently discards the
   * rest, so the file the author reads says one thing and the browser paints
   * another — `dead-token` cannot see the shape (both halves are the same
   * name, one cascade winner) and `collision` is its mirror, not its
   * population.
   */
  | "duplicate-declaration"
  /**
   * A RELATIVE `@import` edge the loader could not follow — the file the
   * specifier names is missing or unreadable. The audit unit is the import
   * closure, so a failed edge breaks the unit's own composition; the finding
   * is `theme: null` (dead-token's stance — the edge is broken in every
   * theme's document) and the specifier occupies the token dimension, so the
   * ordinary suppression doors aim at it.
   */
  | "unresolved-import";

/**
 * WHERE a finding's token was declared — the declaration the resolver actually
 * judged, not merely a place the name appears.
 *
 * `line` plus an OPTIONAL `origin`, and deliberately NO selector. A theme's
 * table is merged across every scope that contributes to it, so by the time a
 * rule reads a token there is no single selector to attribute the winning
 * declaration to; inventing one would be a guess printed as a fact.
 * `dead-token` can say `:root:402` because it walks the parsed scopes itself,
 * one declaration at a time, and never consults a merged table. Adding scope
 * attribution to the resolved tokens is a resolver change, and it is not this
 * one.
 *
 * `origin` names the imported file the winning declaration was spliced from,
 * in the same spelling {@link import("../parse").Scope.origin} writes it — the
 * path relative to the audit's entry file. It exists because line numbers are
 * per-FILE and restart at 1 in every imported sheet: once a closure is
 * audited, two sites in one finding can sit in two files, and `line 2` beside
 * `line 3` becomes a riddle about which file each means. A site carrying
 * `origin` renders as `tokens.css:2`; a site without one is an entry-file
 * declaration and renders as the bare line it always was, so no existing
 * report changes by a byte.
 */
export interface FindingSite {
  /** The token this position belongs to. */
  readonly name: string;
  /** 1-based line of the declaration the finding was measured from. */
  readonly line: number;
  /**
   * The imported file this declaration was spliced from (path relative to the
   * audit's entry file), set only when it arrived over an `@import` edge.
   * Absent on entry-file declarations.
   */
  readonly origin?: string;
}

/**
 * Build a {@link FindingSite} from the resolved token a rule measured: the
 * cascade winner's line, plus the file it was spliced from when the winner
 * arrived over an `@import` edge. A token resolved from the entry file gives a
 * site with no origin, which renders byte-identically to before — the split is
 * {@link positionClause}'s to render, not the rule's to make.
 */
export function siteFromToken(
  name: string,
  token: { readonly line: number; readonly importOrigin?: string },
): FindingSite {
  return token.importOrigin === undefined
    ? { name, line: token.line }
    : { name, line: token.line, origin: token.importOrigin };
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
 *
 * ── Files ──────────────────────────────────────────────────────────────────
 * Since the audit's unit became the import closure, two sites in one finding
 * can sit in two files, and line numbers are per-file — `lines 2 and 3` could
 * name one file or two, and the reader cannot tell. So a site that carries an
 * `origin` is cited BY FILE, in `siteString`'s voice (`tokens.css:2`), and the
 * moment one site in a clause carries an origin every site in it is cited
 * independently — `line 2 and tokens.css:3` — because the collective `lines 2
 * and 3` wording is exactly the riddle, and a bare number beside a file-cited
 * one would quietly claim they share a file. Sites with no origin anywhere are
 * entry-file findings, and keep the exact wording this clause has always
 * rendered (`line 41`, `lines 41 and 33`), which is what keeps every existing
 * report byte-identical.
 */
export function positionClause(sites: readonly FindingSite[]): string {
  if (sites.length === 0) return "";
  if (sites.every((s) => s.origin === undefined)) {
    if (sites.length === 1) return `Declared at line ${sites[0].line}.`;
    const last = sites[sites.length - 1] as FindingSite;
    return `Declared at lines ${sites
      .slice(0, -1)
      .map((s) => String(s.line))
      .join(", ")} and ${last.line}.`;
  }
  const cited = sites.map((s) => (s.origin === undefined ? `line ${s.line}` : `${s.origin}:${s.line}`));
  if (cited.length === 1) return `Declared at ${cited[0]}.`;
  return `Declared at ${cited.slice(0, -1).join(", ")} and ${cited[cited.length - 1]}.`;
}

/**
 * The `selector:line` site string dead-token and unresolved-reference render
 * into their messages — OR, for a site that arrived over an `@import` edge,
 * `origin:line`.
 *
 * The origin spelling is not decoration. Both rules read the PARSED
 * stylesheet directly, so their sites can name a declaration or a use inside
 * an imported file — and `:root:2` would then point the reader at line 2 of
 * whichever file they happened to have open. Citing the file the line belongs
 * to (`tokens.css:2`) is the difference between a citation and a riddle. A
 * root-file site carries no origin and keeps the exact string it has always
 * rendered, so no existing report changes by a byte.
 */
export function siteString(site: { selector: string; line: number; origin?: string }): string {
  return site.origin === undefined ? `${site.selector}:${site.line}` : `${site.origin}:${site.line}`;
}

/** Sort into a stable reading order: rule, then theme, then tokens. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: Record<RuleId, number> = {
    collision: 0,
    "dead-token": 1,
    "scale-collapse": 2,
    "family-consistency": 3,
    "unresolved-reference": 4,
    "cycle-reference": 5,
    "duplicate-declaration": 6,
    "unresolved-import": 7,
  };
  return [...findings].sort(
    (a, b) =>
      order[a.rule] - order[b.rule] ||
      (a.theme ?? "").localeCompare(b.theme ?? "") ||
      a.tokens.join(",").localeCompare(b.tokens.join(",")),
  );
}
