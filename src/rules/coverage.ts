/**
 * Rule 4 — FAMILY CONSISTENCY, and the per-theme coverage facts it is measured
 * over.
 *
 * The first three rules all judge WITHIN a theme. The cross-theme question a
 * token author most needs — what does each theme actually receive? — is
 * answered here, in two halves kept apart the same way the resolver and the
 * rules are:
 *
 *   1. COVERAGE (a fact inventory, never a judgement). {@link coverageReport}
 *      marks every base-theme (`:root`) token per theme as `overridden` — the
 *      theme declares it itself — or `inherited` — the theme says nothing and
 *      the base value flows in — each with the kind the theme's copy resolves
 *      to (colour vs non-colour). Inherited is NORMAL, not a defect: the
 *      theme-independent tokens (focus geometry, control sizing, transitions)
 *      deliberately have no override, and inventing a finding for them would
 *      be inventing intent. The resolver already represents the fact —
 *      `absences` and `origin` — so this is a re-arrangement of data the
 *      resolver vouches for, never a second parser.
 *
 *   2. THE FINDING (the evidence-bearing half, exit-code-active like the other
 *      rules). {@link familyConsistencyRule} reports an inherited token when
 *      the theme's OWN declarations prove per-theme tuning of its family: at
 *      least one member sharing the token's DECLARED family head is
 *      overridden. That is the mixed shape — a theme that re-declares
 *      `--app-success-border`, `--app-success-surface` and friends but not
 *      `--app-success` itself has tuned the family and silently kept the base
 *      value for the one member it did not restate. The overridden siblings
 *      are the evidence, and they travel with the finding so the verdict can
 *      be checked rather than taken. The resolved value rides along as a
 *      courtesy when the member's chain resolves; when it does not, there is
 *      no value to carry and the evidence omits the key — `resolvedValue` is
 *      typed `string`, and a `null` is no string — while `kind` names the
 *      no-value state on every finding, so an absent key reads as "nothing
 *      resolves here" and never as a forgotten one.
 *
 * ── Why the family head is the hinge, and why it is read, never guessed ────
 * Family membership is {@link TokenNames.head}'s derivation, unchanged: a
 * prefix is only a family head when the stylesheet ITSELF declares that
 * shorter name. The discipline is what keeps this rule from over-firing. The
 * calibration stylesheet inherits `--app-solid-label` in winter, and a naive
 * "inherited token that shares a prefix with an overridden token" reading
 * reports it — its prefix neighbour `--app-solid-hover` IS overridden. But
 * `--app-solid` is never declared, so `--app-solid-label` is its own head, the
 * `--app-solid-*` names are a DIFFERENT family, and the correct answer is no
 * finding: the stylesheet's declarations say nothing about a family there, and
 * a rule that reported one would be reporting a vocabulary it invented.
 *
 * ── What is deliberately NOT reported ──────────────────────────────────────
 *   - WHOLLY-INHERITED FAMILIES. When a theme re-declares no member of a
 *     family, inheritance is the theme's whole answer and there is nothing to
 *     cite: no finding, listing only. The fixture's control-height, radius,
 *     sidebar, transition and font families are exactly this, and they are the
 *     reason the correct finding set over the live stylesheet is 7 and not 8.
 *   - ANY VALUE-CORRECTNESS JUDGEMENT. The finding says a value flowed in
 *     un-restated; which value SHOULD win — the theme's tuning or the base —
 *     is a design decision this package has no standing to make, the same
 *     stance `collision` takes on which side of a collision should move.
 *   - THE ALIAS LAYER. `@theme inline` names are a reference layer (see
 *     `dead-token.ts`): they never resolve with origin `declared`, so they can
 *     be neither the inherited token nor the evidence, and a family finding
 *     never cites one.
 *   - SORTED-ADJACENCY REVIVED. Which tokens form a family is read from
 *     declared heads — the derivation `scale-collapse.ts` documents in its
 *     refutation of lightness-sorted adjacency, whose manufacture of pairs the
 *     fixture denies applies with equal force here.
 *   - TRANSLUCENCY IS IRRELEVANT. This is a declaration-PRESENCE fact, never a
 *     colour measurement, so a translucent value is reported like any other.
 *
 * The coverage half carries no exit-code weight anywhere: the CLI prints it as
 * an informational section under the `skipped` precedent — counted, named,
 * headline even at zero — and only the findings half is a rule.
 */

import { ROOT_THEME, type ResolvedStylesheet } from "../resolve.js";
import type { TokenKind } from "../resolve.js";
import { positionClause, type Finding, type FindingSite } from "./finding.js";
import { TokenNames } from "./tokens.js";

/** Whether the theme declares the base token itself or inherits it. */
export type CoverageStatus =
  /** The theme declares the token in its own scope. */
  | "overridden"
  /** The theme declares nothing; the value comes from `:root`. */
  | "inherited";

/** One base-theme token, as one theme receives it. */
export interface CoverageEntry {
  readonly name: string;
  readonly status: CoverageStatus;
  /**
   * What the theme's copy of the token resolves to. An inherited token
   * resolves through the THEME, so this is per-theme data, not a property of
   * the name: a `var()` at `:root` pointing at a token only one theme declares
   * is a colour there and unresolved elsewhere, and coverage reports what each
   * theme actually receives rather than what the name means at `:root`.
   */
  readonly kind: TokenKind;
}

/** Per theme, how the theme's token set relates to the base theme's. */
export interface ThemeCoverage {
  readonly theme: string;
  /** How many base-theme (`:root`) tokens are in scope for this theme. */
  readonly baseTokens: number;
  /** The base tokens this theme declares itself, sorted by name. */
  readonly overridden: readonly CoverageEntry[];
  /**
   * The base tokens this theme inherits from `:root`, sorted by name. The root
   * theme is the base and inherits nothing; a theme-independent token lives
   * here by design, which is why this is a listing and not a defect set.
   */
  readonly inherited: readonly CoverageEntry[];
}

/**
 * Per theme, every base-theme token marked overridden or inherited.
 *
 * A fact inventory over the resolver's own output — `tokensFor(ROOT_THEME)`
 * for the population, `absences`/`origin` for the split, `token()` for the
 * per-theme kind. No rule runs here and nothing is judged.
 */
export function coverageReport(
  resolved: ResolvedStylesheet,
): readonly ThemeCoverage[] {
  const baseNames = resolved
    .tokensFor(ROOT_THEME)
    .filter((t) => t.origin === "declared")
    .map((t) => t.name)
    .sort();

  return resolved.themes.map((theme) => {
    const overridden: CoverageEntry[] = [];
    const inherited: CoverageEntry[] = [];
    for (const name of baseNames) {
      // Every base name resolves in every theme — own scope first, then the
      // base — so this is type-narrowing, not a case the data can produce.
      const token = resolved.token(name, theme);
      if (token === undefined) continue;
      const entry: CoverageEntry = {
        name,
        status: token.origin === "declared" ? "overridden" : "inherited",
        kind: token.kind,
      };
      if (entry.status === "inherited") inherited.push(entry);
      else overridden.push(entry);
    }
    return { theme, baseTokens: baseNames.length, overridden, inherited };
  });
}

/**
 * Rule 4 — an inherited token whose family the theme's own declarations tune.
 *
 * The evidence predicate demands a SIBLING, not a prefix match: a member
 * sharing the token's declared family head, overridden by THIS theme. A theme
 * that declares nothing about the family provides no evidence, and an
 * undeclared family head means there is no family to tune (see the module
 * docstring's `--app-solid-label` case).
 */
export function familyConsistencyRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): Finding[] {
  const findings: Finding[] = [];

  // Family membership runs over the stylesheet's own names, alias layer
  // excluded — an alias restates a token under a second name and tunes
  // nothing. (They are excluded twice over: they never resolve with origin
  // `declared` either, so they could not be evidence regardless.)
  const members = [...names.declared].filter((n) => !names.isAlias(n)).sort();

  for (const theme of resolved.themes) {
    for (const token of resolved.tokensFor(theme)) {
      if (token.origin !== "inherited") continue;
      const head = names.head(token.name);
      const overriddenSiblings = members.filter(
        (n) =>
          n !== token.name &&
          names.head(n) === head &&
          resolved.token(n, theme)?.origin === "declared",
      );
      if (overriddenSiblings.length === 0) continue;
      // The finding is a declaration-PRESENCE fact; the resolved value is a
      // courtesy beside it, and a courtesy must not lie. `resolvedValue` is
      // typed `string | null` — `null` when the chain does not resolve — and
      // `Finding["evidence"]` is typed `string | number | readonly string[]`,
      // so a cast would ship a runtime `null` through a `string` field to
      // every consumer reading the declared type. When there is no value,
      // there is no key: the evidence omits it, the message says the chain
      // does not resolve, and `kind` rides on EVERY finding so the absence
      // explains itself.
      const valueClause =
        token.resolvedValue === null
          ? `its var() chain does not resolve in this theme`
          : `resolving to ${token.resolvedValue}`;
      // WHERE the inherited value comes from: the `:root` declaration this
      // theme is silently reading. The token's origin is `inherited` by the
      // guard at the top of the loop, so `line` is the BASE declaration's line
      // — the one to copy into the theme's own block, which is exactly the
      // remedy this finding implies and the question it could not answer
      // before. (It is never a line in the theme's block: a theme that declared
      // the member would not be inheriting it.)
      const sites: FindingSite[] = [{ name: token.name, line: token.line }];
      findings.push({
        rule: "family-consistency",
        theme,
        tokens: [token.name],
        message:
          `${token.name} is inherited from :root in theme "${theme}" (${valueClause}) ` +
          `while the same theme declares ` +
          `${overriddenSiblings.join(", ")} — the theme tunes this family, so ` +
          `the member it does not re-declare silently keeps the base value. ` +
          positionClause(sites),
        sites,
        evidence: {
          familyHead: head,
          /** The `:root` declaration's value, as written. */
          inheritedValue: token.declaredValue,
          /**
           * What the theme's copy resolves to — colour, non-colour, or one of
           * the two no-value kinds. Present on every finding, so a missing
           * `resolvedValue` reads as "nothing resolves here", never as a
           * forgotten one.
           */
          kind: token.kind,
          /**
           * What the theme actually receives, after `var()` substitution.
           * Omitted when the chain does not resolve: the field is typed
           * `string`, and `null` is no string. The absence is the honest
           * form of "there is no value here".
           */
          ...(token.resolvedValue === null
            ? {}
            : { resolvedValue: token.resolvedValue }),
          /** The overridden family members cited as evidence, sorted. */
          overriddenSiblings,
        },
      });
    }
  }
  return findings;
}
