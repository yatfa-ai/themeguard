/**
 * Rule 7 — DUPLICATE DECLARATION.
 *
 * A custom property declared more than once in ONE scope with differing
 * values. The cascade keeps the last declaration and silently discards the
 * rest, so the file the author reads says one thing and the browser paints
 * another. Until this rule the shape was unjudged — and actively hidden:
 * `resolve.ts`'s `tableFor()` folds with last-wins (`map.set(d.name, …)`),
 * the shadowed declaration leaves no record in `ResolvedStylesheet`, every
 * table-reading rule sees one declaration, and coverage counted the folded
 * table — so the duplicate audited green and printed as ONE base token.
 *
 * ── The data was never lost ────────────────────────────────────────────────
 * The fold's discard is the finding's SUBJECT, not something to change: the
 * shadowed value is gone from the resolved tables BY DESIGN — last
 * declaration wins, exactly as the cascade does. But `parse.ts` keeps every
 * declaration (name + value + line) on `scope.declarations`, and
 * `resolved.stylesheet` exposes the scopes. This rule walks the pre-fold
 * declarations the way `dead-token` walks them — the same scope loop,
 * skipping `kind === "theme-inline"` — and adds the one dimension
 * dead-token does not read: the VALUE. Zero parse or resolve changes.
 *
 * Collision is the mirror, not the same question: one VALUE held by many
 * NAMES (collision), one NAME holding many VALUES in one scope (this rule).
 * The vocabulary is the family's; the populations are disjoint.
 *
 * ── One finding per (scope, name), deduped across selector halves ─────────
 * A selector-list prelude (`:root, [data-theme="dark"] { … }`) is genuinely
 * two scopes over the SAME declarations, so a walk over scope objects meets
 * the duplicate twice. Emissions are deduped by (name, shadow line, winner
 * line): lines are source positions, so the same key arriving from two
 * scope halves is one source block, and exactly one finding is printed for
 * it. The finding's message names the block by its FULL prelude — the half
 * selectors cannot say which block the declarations live in, the whole
 * prelude can.
 *
 * ── What a duplicate is NOT ────────────────────────────────────────────────
 * Not cross-scope. `:root { --accent: red }` beside
 * `[data-theme="dark"] { --accent: blue }` is the theme system working —
 * inheritance and override, the tool's whole subject. Only declarations
 * within ONE scope object are judged, so a legitimate override never fires.
 * Not a same-value repeat. `--x: #FFF; --x: #FFF;` is harmless copy-paste
 * the cascade resolves identically; the predicate is DIFFERING values, so a
 * repeat that changes nothing audits green.
 * Not theme-scoped. Duplicate-ness is a fact about the SOURCE block — the
 * same fact in every theme's view — so the finding carries `theme: null`
 * (dead-token's stylesheet-wide stance).
 * The `@theme inline` alias layer is skipped — but only HALF of dead-token's
 * discipline is copied, deliberately. Dead-token skips the alias SCOPE KIND
 * (the reference layer, never judged) and the alias NAMES (their consumption
 * by generated utility classes is invisible to a source read, so deadness
 * there is unjudgeable). Duplicate-ness has no such blind spot — it is fully
 * judgeable from the source itself — so this rule skips the scope kind and
 * never the names: an alias-shape name declared twice with differing values
 * in a judged scope is a genuine finding.
 *
 * ── Which sites the message names ─────────────────────────────────────────
 * The winner is the LAST declaration — what the cascade keeps. The shadowed
 * site named in the message is the latest declaration whose value differs
 * from the winner's: with the ordinary two-declaration shape that is the
 * first one, and with three or more it keeps the message truthful when the
 * first and last values happen to coincide. Every site is in
 * `evidence.declaredIn` (dead-token's `selector:line` shape), `evidence.
 * values` positionally paired with it, and the named pair in
 * `evidence.shadowedValue` / `evidence.winnerValue` — a verdict checkable
 * rather than taken.
 *
 * `evidence.declaredIn` is also what audit's site-scoped directive matching
 * reads for a rule that carries no `sites`, so a
 * `themeguard-ignore duplicate-declaration` directive binds to the finding's
 * own lines. No `sites` field, like `dead-token`: the rule names its
 * positions in its own message, with a selector the merged theme tables
 * cannot supply (see {@link FindingSite}).
 *
 * Deliberately NOT reported: did-you-mean value hints (7936's fence — the
 * finding stays factual; intent is the reader's to supply); which `var()`s
 * consume the surviving value (the defect is the declaration pair, and
 * unresolved-reference owns use-site listing); anything multi-file (a
 * duplicate across files is a cascade question between sheets, not a
 * question inside one scope, and references do not cross files).
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding } from "./finding.js";

/** One declaration site, as the pre-fold scope records it. */
interface Site {
  readonly selector: string;
  readonly line: number;
  readonly value: string;
}

export function duplicateDeclarationRule(
  resolved: ResolvedStylesheet,
): Finding[] {
  // Dedupe selector-list emissions: the key is the name plus the two source
  // positions the message names. Lines are source positions, so two scope
  // halves producing the same key are one block, and two blocks cannot
  // produce it.
  const emitted = new Set<string>();
  const findings: Finding[] = [];

  for (const scope of resolved.stylesheet.scopes) {
    if (scope.kind === "theme-inline") continue; // reference layer, not judged

    // Every declaration of a name within this ONE scope, in source order.
    const byName = new Map<string, Site[]>();
    for (const d of scope.declarations) {
      const sites = byName.get(d.name) ?? [];
      sites.push({ selector: scope.selector, line: d.line, value: d.value });
      byName.set(d.name, sites);
    }

    for (const [name, sites] of byName) {
      if (sites.length < 2) continue;
      // The predicate: differing values. A same-value repeat resolves to the
      // identical cascade outcome and is not a finding.
      const values = new Set(sites.map((s) => s.value));
      if (values.size < 2) continue;

      // The winner is the LAST declaration — what the cascade keeps. The
      // shadowed site named in the message is the latest declaration whose
      // value differs from the winner's (guaranteed to exist: the values
      // differ). With two declarations that is the first; with more it keeps
      // the sentence truthful when first and last coincide.
      const winner = sites[sites.length - 1] as Site;
      let shadow = sites[0] as Site;
      for (let i = sites.length - 2; i >= 0; i--) {
        const candidate = sites[i] as Site;
        if (candidate.value !== winner.value) {
          shadow = candidate;
          break;
        }
      }

      const key = `${name}\u0000${shadow.line}\u0000${winner.line}`;
      if (emitted.has(key)) continue;
      emitted.add(key);

      const times = sites.length === 2 ? "twice" : `${sites.length} times`;
      findings.push({
        rule: "duplicate-declaration",
        theme: null,
        tokens: [name],
        message:
          `${name} is declared ${times} in one scope: ${shadow.value} at ` +
          `${shadow.selector}:${shadow.line}, shadowed by ${winner.value} at ` +
          `${winner.selector}:${winner.line} — the later declaration silently wins.`,
        evidence: {
          declaredIn: sites.map((s) => `${s.selector}:${s.line}`),
          /** The declared values, positionally paired with `declaredIn`. */
          values: sites.map((s) => s.value),
          declarationCount: sites.length,
          shadowedValue: shadow.value,
          winnerValue: winner.value,
        },
      });
    }
  }

  // Deterministic reading order: by name, then scope order (stable sort).
  return findings.sort((a, b) =>
    (a.tokens[0] ?? "").localeCompare(b.tokens[0] ?? ""),
  );
}
