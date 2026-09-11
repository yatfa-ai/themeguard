/**
 * Rule 6 — CYCLE REFERENCE.
 *
 * A `var()` chain that returns to a name already on it. The resolver represents
 * the fact explicitly — `kind: "cycle"`, carrying the path — and never throws
 * and never loops forever; until this rule nothing read it, so a loop passed
 * green while, per CSS custom-property semantics, every property in the loop —
 * and every `var()` consuming a member — is INVALID AT COMPUTED-VALUE TIME.
 * The shape falls exactly between the two rules that fence it: `dead-token` is
 * silent because both names ARE referenced (by each other), and
 * `unresolved-reference` is silent because both ARE declared — its doc block
 * declines this population by name ("a var() loop is a different defect
 * shape"). This rule is that shape.
 *
 * ── Cycles are per-theme facts; the finding is scoped by AUTHORSHIP ────────
 * The resolver resolves every theme separately, so a loop is a fact about a
 * theme's VIEW, not about the stylesheet: a theme that re-declares one member
 * HEALS the cycle in its own view (its walk leaves the loop through the
 * theme's own declaration and resolves), while the base view's copy stays
 * cyclic. Two wrong emissions sit either side of the right one, and both are
 * pinned by tests: a blanket `theme: null` stance (wrong where a theme closed
 * the loop with its own declarations — the base view is healthy there), and
 * per-theme emission without dedup (wrong where a theme merely INHERITS a
 * root-authored loop — one defect reported once per theme).
 *
 * The predicate walks `resolved.themes`, collects each theme's
 * `kind === "cycle"` tokens, groups them by LOOP SET — the unique names in
 * `chain`; a 3-loop marks all three members `cycle`, and per-name emission
 * would report one defect three times — and emits one finding per distinct
 * (loop set, author):
 *
 *   - authored OUTSIDE any theme's own declarations — in the base `:root`
 *     table, or in the theme-independent `@theme inline` alias namespace —
 *     the loop is a stylesheet-wide fact every theme receives: ONE finding,
 *     `theme: null` (dead-token's stance);
 *   - closed by a theme's OWN declarations (any member of the loop is
 *     `origin: "declared"` in that theme): a THEME-scoped finding for that
 *     theme (collision's stance — the base view may resolve fine there, and
 *     its silence must not read as a pass);
 *   - a theme whose loop members are ALL not its own — `inherited`, or
 *     `theme-inline`, which is the same "no declaration of ours here" fact —
 *     is a loop authored elsewhere seen again: SKIPPED, dedupe, never
 *     re-emitted per theme. Sound by construction: with no member of its own
 *     in the loop, the theme's resolution walk IS the base walk (own table
 *     empty for these names → base table → alias), so the base view reported
 *     the same loop under `theme: null` already.
 *
 * ── The walk and the loop ──────────────────────────────────────────────────
 * A chain can carry a TAIL: `--a: var(--b); --b: var(--c); --c: var(--b)`
 * walks `--a → --b → --c → --b` — `--a` never returns to itself, it POINTS
 * INTO the `--b`/`--c` loop, and the resolver marks it `cycle` all the same.
 * Per the loop-set definition (the unique names in `chain`) that walk is its
 * own finding beside the loop's own: the two findings say different things —
 * `--b → --c → --b` is the loop, `--a → --b → --c → --b` is a declaration
 * that depends on it — and both halves are invalid at computed-value time.
 * Chains of one loop set are rotations of each other (each member's walk
 * enters and closes the same cycle), so the DEDUPE key is the sorted unique
 * names and the display comes from one deterministic representative: the
 * group's alphabetically first token, whose walk is printed AS WRITTEN.
 *
 * ── What the finding carries ───────────────────────────────────────────────
 * The loop as written (`--a → --b → --a`), the consequence sentence, and the
 * position clause. `sites` cites each member's cascade-winner line IN THE
 * THEME MEASURED — the discipline `FindingSite` documents: for the
 * stylesheet-wide finding that is the `:root` (or alias) declaration; for a
 * theme-scoped one it is the theme's own declaration where the member has
 * one and the inherited base line where it does not. `evidence.lines`
 * repeats those numbers as strings, positionally paired with
 * `evidence.loop`, because the evidence value union is
 * `string | number | readonly string[]` and a number ARRAY does not fit —
 * the structured half of the same fact is `sites`.
 *
 * ── What the rule deliberately does NOT do ─────────────────────────────────
 * No consumer/use-site listing (which `var()`s eat the broken values — the
 * loop's own declarations are the defect, and the finding states the
 * consequence for every consumer; enumerating them is unresolved-reference's
 * shape, not this rule's). No did-you-mean hints — findings stay factual
 * (7936's fence). No cross-theme attribution beyond what the resolver
 * reports per theme: a loop whose members are spread across the base table
 * and one theme is reported exactly as the theme's own view reports it,
 * which is where the CSS consequence actually bites. No `@property`
 * interplay (the registration is invisible to scope lookup — the named
 * false-positive class of unresolved-reference — and reading it is a parser
 * change). No parse or resolve changes: `kind: "cycle"` and `chain` are this
 * rule's SUBJECT, not something to change.
 */

import { ROOT_THEME, type ResolvedStylesheet } from "../resolve.js";
import { positionClause, siteFromToken, type Finding, type FindingSite } from "./finding.js";

/**
 * The cycle tokens of one theme, grouped by loop set. The key is the sorted
 * unique names joined with a separator — rotations of one loop share it, a
 * tail walk into a loop does not (its set gains the tail), which is exactly
 * the split the two findings describe.
 */
function groupByLoopSet(
  cycles: readonly { name: string; chain: readonly string[]; origin: string }[],
): Map<string, { name: string; chain: readonly string[]; origin: string }[]> {
  const groups = new Map<
    string,
    { name: string; chain: readonly string[]; origin: string }[]
  >();
  for (const token of cycles) {
    const key = [...new Set(token.chain)].sort((a, b) => a.localeCompare(b)).join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(token);
    groups.set(key, group);
  }
  return groups;
}

export function cycleReferenceRule(resolved: ResolvedStylesheet): Finding[] {
  const findings: Finding[] = [];

  for (const theme of resolved.themes) {
    const cycles = resolved
      .tokensFor(theme)
      .filter((t) => t.kind === "cycle")
      .map((t) => ({ name: t.name, chain: t.chain, origin: t.origin }));

    for (const [, group] of groupByLoopSet(cycles)) {
      // The authorship branch. The base theme's own view (and the alias
      // namespace it reads) is authored outside every theme's block — one
      // stylesheet-wide finding. A named theme reports only loops its OWN
      // declarations close; anything else there is the elsewhere-authored
      // loop the base view already carried.
      const themeAuthored =
        theme !== ROOT_THEME && group.some((t) => t.origin === "declared");
      if (theme !== ROOT_THEME && !themeAuthored) continue;

      // One representative supplies the walk as written: the alphabetically
      // first token of the group, so the same loop prints the same sentence
      // on every run. Same-set chains are rotations of each other, so the
      // choice changes the reading, never the defect.
      const representative = [...group].sort((a, b) => a.name.localeCompare(b.name))[0];
      const chain = representative.chain;
      const members = [...new Set(chain)];
      const loopText = chain.join(" → ");

      // Each member's cascade-winner line in the theme measured, plus the
      // imported file it was spliced from when it came in over an `@import`
      // edge (a loop can span a closure: one link written in `tokens.css`,
      // the closing one in the entry). A member of
      // the loop always resolves here (its own walk produced a cycle token),
      // so a missing lookup is impossible rather than merely unlikely — but
      // the guard keeps the types honest without a cast, and a member that
      // somehow vanished is dropped from `sites` rather than printed as a
      // fabricated line.
      const sites: FindingSite[] = members.flatMap((name) => {
        const token = resolved.token(name, theme);
        return token === undefined ? [] : [siteFromToken(name, token)];
      });

      findings.push({
        rule: "cycle-reference",
        theme: themeAuthored ? theme : null,
        tokens: members,
        message:
          `${loopText} is a var() cycle` +
          (themeAuthored ? ` in theme "${theme}"` : "") +
          `: every property in the loop, and every var() consuming a member, ` +
          `is invalid at computed-value time.` +
          (sites.length > 0 ? ` ${positionClause(sites)}` : ""),
        sites,
        evidence: {
          /** The representative's walk as written, closing repeat included. */
          chain,
          /** The loop set — the unique names, in walk order. */
          loop: members,
          /**
           * Each member's cascade-winner line, positionally paired with
           * `loop`. Strings because the evidence value union has no number
           * ARRAY; the structured form is `sites`.
           */
          lines: sites.map((s) => String(s.line)),
        },
      });
    }
  }

  return findings;
}
