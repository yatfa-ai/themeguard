/**
 * Rule 5 — UNRESOLVED REFERENCE.
 *
 * A `var()` names a custom property that no scope in the stylesheet declares.
 * The resolver already represents this — the chain ends in `kind: "unresolved"`
 * naming the missing reference — but until this rule nothing read it, so a
 * typo'd name, a fallback pointing at nothing, a declaration built on a name
 * nobody wrote, or an alias chain into a typo all passed green while the
 * property falls back to unset/inherit, or to whatever fallback was written.
 *
 * ── One predicate over data already collected ──────────────────────────────
 * `parseStylesheet` collects every `var()` use in the sheet (see
 * {@link Reference}) — not only the ones inside custom-property values, so a
 * `width: var(--sidebar-width)` in a block that declares no tokens is judged
 * too. The rule is: for every name used, if that name is declared in NO scope,
 * report it. Zero parser or resolver changes; the data has flowed since the
 * reference graph existed.
 *
 * The predicate covers four populations that used to be silent:
 *
 *   - a typo'd use (`var(--app-sucess)`) — invisible to `dead-token`, which
 *     reads the DECLARED side, when the sibling is declared and referenced;
 *   - a fallback-dangling use (`var(--missing-thing, #FF0000)`) — the browser
 *     substitutes the fallback, and nothing else in the sheet is wrong;
 *   - a broken declaration chain (`:root { --a: var(--never-declared) }`) —
 *     the shape the tool's one signal pointed AWAY from: `dead-token` fires on
 *     `--a` ("no var() references it") while `--never-declared`, the actual
 *     defect, is never named. Here both rules fire, each on its own half;
 *   - a dangling alias chain (`@theme inline { --color-x: var(--typo) }`) —
 *     silent today, but the breakage propagates to the generated utility
 *     classes, the layer the project treats as public API.
 *
 * ── Declared means declared in ANY scope, `@theme inline` included ─────────
 * The lookup is deliberately WIDER than `dead-token`'s candidate loop, which
 * skips `theme-inline` scopes because their names are never judged as
 * declarations. Here `theme-inline` declarations are lookup HITS: an alias is
 * a real declaration of a real name, so a `var()` naming one (`var(--color-app-cta)`)
 * resolves and reports nothing. What survives the fence verbatim is the other
 * half of dead-token's discipline: the alias layer's own names are never a
 * judged population — and they do not need a skip for it, because a name in
 * that layer is by construction declared in the `@theme inline` scope, and a
 * name declared nowhere is by construction not in it.
 *
 * The CARVE-OUT this fence deliberately leaves to a sibling: "declared in ANY
 * scope" answers the STYLESHEET-WIDE question this rule exists for — a typo is
 * a defect in every view at once — and it is deliberately not the per-theme
 * question. A name declared inside exactly ONE theme's block is a lookup hit
 * here and is never reported, while a declaration chain in every OTHER theme's
 * view ends unresolved all the same. That per-theme grain is a different
 * question, and it is `theme-partial-token`'s (`rules/theme-partial-token.ts`),
 * which reads the resolver's `kind: "unresolved"` fact directly and partitions
 * against this rule's population so the two never double-report. This header's
 * scope decision stands verbatim for rule 5's population; the gap it leaves is
 * claimed by rule 9, not papered over here.
 *
 * ── What an unresolved reference is NOT ────────────────────────────────────
 * Not theme-scoped, same stance as `dead-token`: a name is missing from the
 * STYLESHEET or it is not, so the finding carries `theme: null` and there is
 * one finding per NAME with every use site listed. The STYLESHEET is the
 * audited file's `@import` closure — the audit follows the composition the
 * source declares (`loadStylesheet`), so a `var()` naming a token declared in
 * an imported file resolves and reports nothing. Beyond that closure — a
 * bundler's virtual sheet, a sibling file with no import edge, a consumer only
 * a build step generates — the read cannot know, and the finding says where
 * the use is so a human can check. A use site read from an imported file cites
 * the file (`tokens.css:5`) rather than a bare `selector:line`, whose line
 * number would point into whichever file the reader had open. That
 * stylesheet-wide stance stays true of THIS rule's findings: what a
 * theme-scoped question looks like when the name DOES exist somewhere is rule
 * 8's to answer, at the per-theme grain the resolver's theme-keyed `lookup`
 * already models.
 *
 * One KNOWN FALSE POSITIVE, named rather than left for a user to discover: an
 * `@property` block registers a custom property at the CSS level, but the
 * block carries no `--`-prefixed declarations, so the parser emits no scope
 * for it and this rule's lookup — which reads scope declarations — cannot see
 * the registration. A name registered there and declared in no scope IS
 * reported; with an `initial-value` the property resolves to that value at
 * runtime, nothing falls back, and the finding is a false positive. The
 * standing remedy is the ordinary one — declare the name in a scope, or
 * suppress the finding — because reading `@property` registrations into the
 * lookup is a parser change this rule deliberately does not make.
 *
 * Deliberately NOT reported:
 * `kind: "cycle"` chains (a var() loop is a different defect shape), and no
 * did-you-mean nearest-name guess — the finding stays factual; intent is the
 * reader's to supply.
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding } from "./finding.js";
import { siteString } from "./finding.js";
import { TokenNames } from "./tokens.js";

export function unresolvedReferenceRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): Finding[] {
  // One candidate per NAME, remembering every place it is used. Duplicates are
  // kept, deliberately: two `var()`s naming the same missing token from one
  // declaration is a fact about the stylesheet, and the list is the finding's
  // whole map of where the defect lives.
  const usedAt = new Map<string, { selector: string; line: number; origin?: string }[]>();
  for (const ref of resolved.stylesheet.references) {
    const sites = usedAt.get(ref.name) ?? [];
    sites.push({
      selector: ref.selector,
      line: ref.line,
      ...(ref.origin !== undefined ? { origin: ref.origin } : {}),
    });
    usedAt.set(ref.name, sites);
  }

  const findings: Finding[] = [];
  for (const [name, sites] of [...usedAt.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Declared in ANY scope counts — `names.declared` is every scope's
    // declarations, `@theme inline` included (see the header above).
    if (names.declared.has(name)) continue;
    findings.push({
      rule: "unresolved-reference",
      theme: null,
      tokens: [name],
      message:
        `${name} is used at ${sites.map(siteString).join(", ")} ` +
        `and no scope in this stylesheet declares it.`,
      evidence: {
        usedIn: sites.map(siteString),
        useCount: sites.length,
      },
    });
  }
  return findings;
}
