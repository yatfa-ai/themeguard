/**
 * Rule 9 — THEME PARTIAL TOKEN.
 *
 * A custom property declared only inside ONE theme's block is absent from every
 * other theme's view, and a declaration chain in such a view that reaches for it
 * ends unresolved — the browser falls back to unset/inherit, or to whatever
 * fallback was written. The stylesheet audits green today, and the silence has a
 * precise shape: resolution is PER-THEME, but the only rule judging reference
 * resolution asks a STYLESHEET-WIDE question.
 *
 * ── The two questions, and why each needs its own rule ─────────────────────
 * `unresolved-reference` (rule 5) asks: is this name declared ANYWHERE in the
 * stylesheet? Its population is the typos, the dangling fallbacks, the
 * declaration chains built on a name nobody wrote — defects that are defects in
 * every view at once, because no scope declares them at all. Its gate
 * (`names.declared`, the union of every scope's declarations) is correct FOR
 * THAT QUESTION, and deliberately not "fixed" here: a name declared in exactly
 * one theme is a lookup HIT under it, which is why rule 5 never fires on this
 * population.
 *
 * This rule asks the per-theme grain of the same data: a name declared
 * SOMEWHERE but absent from THIS theme's view. The resolver already represents
 * the fact — `resolveStylesheet`'s `lookup` is theme-keyed (own table → `:root`
 * → `@theme inline` alias, with NO path from one named theme to another), so a
 * chain in a view that lacks the name mints `kind: "unresolved"` carrying
 * `missingReference` — and until this rule the only readers of that half were
 * coverage's parenthetical and prose. The rule is one predicate over data the
 * resolver vouches for: zero parser or resolver changes.
 *
 * ── The predicate, partitioned so the two rules never double-report ────────
 * For every theme, for every token with `kind === "unresolved"`, look at
 * `missingReference` and partition against `TokenNames.declared`:
 *
 *   - declared in NO scope → rule 5's population. SKIP — a typo is one defect,
 *     and reporting it here too would print it twice.
 *   - declared SOMEWHERE but absent from this theme's view → this rule's
 *     finding. The name exists; the view does not receive it.
 *
 * The partition is what makes the pair exhaustive without overlap: every
 * unresolved fact names a missing reference that is either declared nowhere
 * (rule 5's) or declared only in views other than the one that broke (this
 * rule's).
 *
 * ── Emission: one finding per missing NAME, never per theme or consumer ────
 * The defect is the name's partial availability — one fact about the
 * stylesheet, however many views lack it and however many chains reach for it.
 * A two-consumer probe yields ONE finding listing both consumers; a name
 * missing from two views yields ONE finding naming both. The finding carries
 * `theme: null` (dead-token's stance): it is a CROSS-THEME fact by
 * construction — the declaring themes and the unresolved views are both named
 * in the message and the evidence, so scoping it to one theme would hide the
 * half that makes it a finding. Exit code ACTIVE like every other rule; the
 * report is the observation point.
 *
 * The message names all four halves: the token, the themes that DO declare it
 * (each cited at its own cascade-winner line, so the remedy — copy the
 * declaration, or restate it where the chain can see it — has an address),
 * the views it is unresolved in, and the consuming token(s) whose chains
 * break. `sites` carries the consumer positions first (where the defect
 * bites, and where a site-level directive is written) then the declaring
 * positions. Every position is read through `siteFromToken`, the contract
 * every rule honours since the audit's unit became the import closure: line
 * numbers are per-FILE, so a site spliced in from an imported sheet carries
 * its `origin` and is cited by file — in `sites` (which the directive fence
 * reads, so an entry-file `themeguard-ignore` can never silence a finding
 * whose site is another file's line) and in the declaration clause, which
 * goes file-aware the moment one of its sites carries an origin.
 *
 * ── What is deliberately NOT reported ──────────────────────────────────────
 *   - DIRECT COMPONENT CONSUMPTION, recorded residual: `.code-block {
 *     background: var(--app-code-bg) }` — a plain rule, no declaration chain —
 *     mints no unresolved token, because the resolver walks custom-property
 *     values, not component declarations. That face is reachable by joining
 *     `stylesheet.references` against per-theme tables, but shipping it needs
 *     selector-PREFIX reasoning this parser deliberately does not do: a
 *     consumer written INSIDE the declaring theme's own selector
 *     (`[data-theme="dark"] .card { … }`) is correct CSS — the element only
 *     ever renders inside the theme that declares the token — and its
 *     `Reference.kinds` reads `["other"]`, byte-indistinguishable from the
 *     genuinely broken unscoped consumer. Distinguishing them without prefix
 *     reasoning reports correct CSS as a defect, which is worse than the
 *     silence it replaces. The chain face this rule ships is the one the
 *     resolver itself vouches for; the consumption face waits for that
 *     design question and is named here rather than silently dropped.
 *   - A FALLBACK WITH A CONCRETE VALUE (`var(--target, #F5F5F5)`): the
 *     resolver substitutes the fallback and mints no unresolved token — the
 *     view is not broken, and there is nothing to report. (A fallback that is
 *     ITSELF a `var()` onto a theme-only name is not this carve-out: the walk
 *     substitutes the fallback expression and THEN breaks on it, minting the
 *     unresolved fact this rule reads.)
 *   - RULE 5'S POPULATION, by the partition above; `kind: "cycle"` chains
 *     (rule 6's shape); alias-layer names as the missing reference (an alias
 *     declaration is theme-independent — every view's lookup hits it — so an
 *     alias name can never be the thing a view lacks).
 *   - NO did-you-mean nearest-name guess and NO value judgement about which
 *     theme is "right": findings stay factual; intent is the reader's.
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding, FindingSite } from "./finding.js";
import { siteFromToken } from "./finding.js";
import { TokenNames } from "./tokens.js";

/** `"a"` / `"a" and "b"` / `"a", "b" and "c"` — the list shape the messages read. */
function joinList(items: readonly string[]): string {
  if (items.length === 1) return items[0] as string;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** `theme "dark"` / `themes "root" and "winter"` — the noun agrees with the list. */
function themeClause(themes: readonly string[]): string {
  return `${themes.length === 1 ? "theme" : "themes"} ${joinList(themes.map((t) => `"${t}"`))}`;
}

/**
 * The consumers' half of the message. One consumer is one chain; several are
 * several chains — the verb and the possessive follow the count, and the
 * possessive lands on the last name the way English writes a joint
 * possession: `--a and --b's var() chains`.
 */
function consumerClause(consumers: readonly string[]): string {
  const singular = consumers.length === 1;
  const names = singular ? consumers[0] as string : joinList(consumers);
  return `${names}'s var() chain${singular ? "" : "s"} resolve${singular ? "s" : ""} through it and find${singular ? "s" : ""} nothing`;
}

/**
 * The declaration half, in dead-token's voice with the theme named — when
 * every declaring site sits in the entry file the lines pair positionally
 * with the themes, which travel in theme order:
 * `Declared in theme "dark" at line 4.` /
 * `Declared in themes "dark" and "winter" at lines 4 and 9.`
 *
 * The audit's unit is the import closure, so a declaring site can sit in an
 * imported sheet, and a bare `at line 8` would point the reader into
 * whichever file they had open. The moment one declaring site carries an
 * `origin`, every site is cited the way {@link positionClause} cites —
 * `dark.css:8`, or `line 3 and dark.css:8` when the closure splits the
 * halves across two files — because the collective `lines` wording is
 * exactly the riddle a per-file number poses, and a bare number beside a
 * file-cited one would quietly claim they share a file. The theme-naming
 * shape is kept; only the citations go file-aware.
 */
function declarationClause(themes: readonly string[], sites: readonly FindingSite[]): string {
  if (sites.every((s) => s.origin === undefined)) {
    if (sites.length === 1) return `Declared in ${themeClause(themes)} at line ${sites[0].line}.`;
    const last = sites[sites.length - 1] as FindingSite;
    return `Declared in ${themeClause(themes)} at lines ${sites
      .slice(0, -1)
      .map((s) => String(s.line))
      .join(", ")} and ${last.line}.`;
  }
  const cited = sites.map((s) =>
    s.origin === undefined ? `line ${s.line}` : `${s.origin}:${s.line}`,
  );
  if (cited.length === 1) return `Declared in ${themeClause(themes)} at ${cited[0]}.`;
  return `Declared in ${themeClause(themes)} at ${cited.slice(0, -1).join(", ")} and ${cited[cited.length - 1]}.`;
}

export function themePartialTokenRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): Finding[] {
  // Per missing NAME: the views whose chains break on it, and the consumers
  // that break, with each consumer's cascade-winner position per view (a
  // theme-inheriting consumer resolves through the base declaration, so two
  // views can cite the same position — deduped, deliberately: one position
  // named twice is one position). The dedupe key carries the file along with
  // the line, because two files can legitimately contribute the same line
  // number for the same consumer name.
  const facts = new Map<
    string,
    { views: string[]; consumerSites: Map<string, Map<string, FindingSite>> }
  >();

  for (const theme of resolved.themes) {
    for (const token of resolved.tokensFor(theme)) {
      if (token.kind !== "unresolved") continue;
      const missing = token.missingReference;
      if (missing === null) continue;
      // The partition: a name declared in NO scope is rule 5's population —
      // one defect, one finding. Only a name that EXISTS somewhere but is
      // absent from THIS view is a partial-availability fact.
      if (!names.declared.has(missing)) continue;
      let fact = facts.get(missing);
      if (fact === undefined) {
        fact = { views: [], consumerSites: new Map() };
        facts.set(missing, fact);
      }
      if (!fact.views.includes(theme)) fact.views.push(theme);
      // The consumer's own position, read through `siteFromToken` like every
      // other rule reads a site: the line, plus the file it was spliced from
      // when it arrived over an `@import` edge. Without the file the
      // directive fence cannot tell an entry-file line from an imported one.
      const site = siteFromToken(token.name, token);
      const key = `${site.origin ?? ""}\u0000${site.line}`;
      const sites = fact.consumerSites.get(token.name) ?? new Map<string, FindingSite>();
      sites.set(key, site);
      fact.consumerSites.set(token.name, sites);
    }
  }

  const findings: Finding[] = [];
  for (const [name, fact] of [...facts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Where the name DOES exist: the themes whose own tables carry it. It
    // cannot be empty for this population — an alias-layer declaration is
    // theme-independent (every view's lookup hits it), and a `:root`
    // declaration is inherited everywhere, so a name a view can lack is by
    // construction declared in a named theme's block. The guard keeps the
    // types honest without a cast and the emission sound rather than lucky.
    const declaredIn = resolved.themes.filter(
      (theme) => resolved.token(name, theme)?.origin === "declared",
    );
    if (declaredIn.length === 0) continue;

    const consumers = [...fact.consumerSites.keys()].sort((a, b) => a.localeCompare(b));

    // Consumer positions first — where the defect bites, and where a
    // themeguard-ignore directive is written — then the declaring
    // positions. Both sets deduped and read in a deterministic order:
    // consumers by name then position, declarations in theme order.
    const consumerSites: FindingSite[] = [];
    for (const consumer of consumers) {
      const sites = fact.consumerSites.get(consumer) as Map<string, FindingSite>;
      consumerSites.push(
        ...[...sites.values()].sort(
          (a, b) => a.line - b.line || (a.origin ?? "").localeCompare(b.origin ?? ""),
        ),
      );
    }
    const declaredSites: FindingSite[] = [];
    const declaredLines: number[] = [];
    for (const theme of declaredIn) {
      const token = resolved.token(name, theme);
      if (token === undefined) continue;
      // `siteFromToken` carries the imported file a winning declaration was
      // spliced from, so a site in a closure file is cited by file — both in
      // `sites` and in the message clause — instead of as a bare line that
      // points into whichever file the reader has open.
      declaredSites.push(siteFromToken(name, token));
      declaredLines.push(token.line);
    }
    const sites: FindingSite[] = [
      ...[...consumerSites.values()].sort(
        (a, b) => a.name.localeCompare(b.name) || a.line - b.line,
      ),
      ...declaredSites,
    ];

    findings.push({
      rule: "theme-partial-token",
      theme: null,
      tokens: [name],
      message:
        `${name} is declared only in ${themeClause(declaredIn)} but never reaches ` +
        `${themeClause(fact.views)} — there, ${consumerClause(consumers)}, ` +
        `so the property falls back to unset/inherit. ` +
        `${declarationClause(declaredIn, declaredSites)}`,
      sites,
      evidence: {
        /** The themes whose own blocks declare the name, in theme order. */
        declaredInThemes: declaredIn,
        /**
         * Cascade-winner lines, positionally paired with `declaredInThemes`.
         * Per-FILE numbers: which file each belongs to travels on `sites`,
         * the structured form.
         */
        declaredLines: declaredLines.map(String),
        /** The views where chains break on the name, in theme order. */
        unresolvedInThemes: fact.views,
        /** The tokens whose chains break, sorted. */
        consumers,
        consumerCount: consumers.length,
      },
    });
  }
  return findings;
}
