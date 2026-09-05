/**
 * Rule 2 — DEAD TOKEN.
 *
 * A custom property is declared and no `var()` anywhere in the stylesheet names
 * it. Nothing reads it, so it costs a maintainer attention on every palette
 * change and pays nothing back.
 *
 * ── The population is the judgement ────────────────────────────────────────
 * Asking "declared, and referenced by no `var()`" over the calibration fixture
 * returns 66 names. Exactly 2 are defects. The other 64 are Tailwind v4's
 * `@theme inline` alias namespace, and they are not dead in any sense that
 * matters:
 *
 *   - Each is a `var()` alias (`--color-app-cta: var(--app-cta)`) whose purpose
 *     is to be consumed by the UTILITY CLASSES Tailwind generates at build time
 *     (`bg-app-cta`). Those consumers are not in this stylesheet and never will
 *     be — they are generated from it.
 *   - So the layer is unreachable to a source-reading tool by construction, and
 *     a rule that judges it reports the project's entire public token API as
 *     dead. 64 findings, every one of them wrong, burying the 2 that are right.
 *
 * The alias layer is therefore the REFERENCE layer, never the judged one: its
 * declarations still COUNT AS USES of what they point at (which is exactly what
 * they are), and its own names are not candidates. This is a scoping decision
 * about a build-time API surface, not a special case for one framework — any
 * layer whose consumers are generated has the same property.
 *
 * ── Uses are read from EVERY declaration, not only custom-property ones ────
 * `--sidebar-width` is declared in `:root` and used once, by
 * `.app-sidebar { width: var(--sidebar-width) }` — a block that declares no
 * custom property at all. Reading uses out of the resolver's `var()` chains
 * alone (which only ever traverse custom-property values) misses it and three
 * others, and reports 9 dead tokens instead of 2. `parseStylesheet` therefore
 * collects every `var()` use in the sheet; see {@link Reference}.
 *
 * ── What a dead token is NOT ───────────────────────────────────────────────
 * Not theme-scoped. A token is dead in the STYLESHEET or not at all, so a name
 * declared in `:root` and overridden in a theme is one candidate, not two, and
 * the finding carries `theme: null`. A token used only by an unreachable rule,
 * or used from another stylesheet, is beyond what a single-file source read can
 * see; the finding says where the declaration is so a human can check.
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding } from "./finding.js";
import { TokenNames } from "./tokens.js";

export function deadTokenRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): Finding[] {
  const referenced = new Set(resolved.stylesheet.references.map((r) => r.name));

  // One candidate per NAME, remembering every place it is declared.
  const declaredAt = new Map<string, { selector: string; line: number }[]>();
  for (const scope of resolved.stylesheet.scopes) {
    if (scope.kind === "theme-inline") continue; // reference layer, not judged
    for (const d of scope.declarations) {
      const sites = declaredAt.get(d.name) ?? [];
      sites.push({ selector: scope.matchedSelector, line: d.line });
      declaredAt.set(d.name, sites);
    }
  }

  const findings: Finding[] = [];
  for (const [name, sites] of [...declaredAt.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (referenced.has(name)) continue;
    if (names.isAlias(name)) continue;
    findings.push({
      rule: "dead-token",
      theme: null,
      tokens: [name],
      message:
        `${name} is declared at ${sites.map((s) => `${s.selector}:${s.line}`).join(", ")} ` +
        `and no var() in this stylesheet references it.`,
      evidence: {
        declaredIn: sites.map((s) => `${s.selector}:${s.line}`),
        declarationCount: sites.length,
        referenceCount: 0,
      },
    });
  }
  return findings;
}
