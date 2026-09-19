/**
 * Rule 3 — SCALE COLLAPSE.
 *
 * Two tokens that must read apart are closer than a visible step. Measured in
 * CIE L*, with a bar of ΔL* ≥ 4.
 *
 * ── Why L*, and never contrast ratio ───────────────────────────────────────
 * A WCAG ratio compares a MARK to its BACKDROP. Two adjacent surface fills a
 * whole visible step apart still measure around 1.2:1, so a contrast bar
 * either passes everything or fails everything and discriminates nothing. The
 * calibration fixture makes the same argument in its own comments and sizes its
 * surface steps in L* for exactly this reason (:150).
 *
 * ── The pairing derivation, and why it is the hard part ────────────────────
 * "Adjacent tokens on a ladder" is not given by the data: which tokens form a
 * ladder, and which members are adjacent, is a choice, and the census follows
 * entirely from it. This rule pairs a token with its DECLARED INTERACTION
 * STATE — `X` with `X-hover`, `X-active`, … — where both names are declared.
 *
 * That derivation is chosen over sorting a family by lightness and pairing
 * neighbours, and the fixture refutes the sorted alternative twice:
 *
 *   1. IT MANUFACTURES PAIRS THE AUTHOR EXPLICITLY DENIES. Sorted by L*, the
 *      dark surface family is background 1.85, surface 7.96, hover 14.21,
 *      raised 16.39, active 22.46 — making `hover`↔`raised` adjacent at ΔL*
 *      2.18, a finding. The fixture answers it before it is raised: "THESE TWO
 *      TOKENS ARE NOT ONE ELEMENT'S 'hover then pressed' RAMP. They are two
 *      independent interaction steps, each paired with the resting fill it is
 *      used on top of … the bar each one has to clear is a step away from ITS
 *      OWN base, and '-active' never sits on --app-surface-hover" (:129-148).
 *      Nothing ever paints hover against raised, so their distance is not a
 *      measurement of anything a user sees.
 *
 *   2. IT COLLIDES WITH RULE 1'S DELIBERATE-TWIN CARVE-OUT. Sorted adjacency
 *      inside a semantic family puts `--app-warning` next to
 *      `--app-warning-border` at ΔL* 0.00 — the very pair the fixture calls
 *      deliberate. A pairing that has to special-case the exception is the
 *      wrong pairing.
 *
 * State pairing has neither problem, because it measures the comparison the
 * stylesheet ITSELF asserts: naming a token `X-hover` is a claim that it is the
 * hover of `X`, and those two ARE painted in the same place at different times.
 * The pair is read from the author's names, not from a ladder themeguard
 * imagined. The bar is the fixture's own: "sized in CIE L*, where a step of >= 4
 * is comfortably perceptible" (:151).
 *
 * ── Its limit, stated rather than hidden ───────────────────────────────────
 * It sees only pairs the naming convention exposes. A ladder written
 * `--gray-100 … --gray-900` declares no state relationship, so this rule says
 * nothing about it — silence there is honest ("I have no pairing to measure"),
 * where a sorted-adjacency answer would be confident and unfounded. A
 * convention-independent derivation is a genuine open question, not something
 * this rule pretends to have solved.
 *
 * ── Translucency ───────────────────────────────────────────────────────────
 * `lstar` refuses a colour with alpha < 1, and this rule never invents a
 * backdrop to get around that. A pair where either member is translucent is
 * SKIPPED and reported in `skipped`, so the silence is visible and countable
 * rather than looking like a pass. Compositing would need to know the surface
 * the token is painted on, which the stylesheet does not state.
 *
 * ── The skip is COUNTED, and it also SAYS WHICH KIND OF SILENCE IT IS ──────
 * Translucency is one of four reasons a pair goes unmeasured, and the other
 * three come out of a SINGLE condition — `from === undefined || to ===
 * undefined || kind !== "color"` — that already distinguishes them and used
 * to report them under one string, `not-a-color`. Two of the three were then
 * false: a pair living only in a sibling theme's block (`absent`) has no
 * value in this view to be a colour or not, and a `var()` chain that found
 * nothing (`unresolvable`) is exactly what the unresolved-reference section
 * says about the SAME token three sections down — one report, two
 * contradictory diagnoses. The reason is therefore split on the arms the
 * condition itself evaluates, and an `absent` row carries the sibling scope
 * the pair actually lives in. See {@link SkipReason}.
 */

import { deltaLstar, lstar, type Color } from "../color.js";
import type { ResolvedStylesheet } from "../resolve.js";
import { positionClause, siteFromToken, type Finding, type FindingSite } from "./finding.js";
import { TokenNames, type StatePair } from "./tokens.js";

/** Below this, a step between two fills is not reliably visible. */
export const VISIBLE_STEP_LSTAR = 4;

/**
 * WHY a pair could not be measured. Four values, and the split is the skip
 * branch's OWN condition read at its own `||` boundaries rather than a second
 * classification computed beside it:
 *
 *   - `translucent`   — both members resolve to colours, at least one with
 *                       alpha < 1. `lstar` refuses it and this rule never
 *                       invents a backdrop.
 *   - `not-a-color`   — both members RESOLVE, at least one to a value that is
 *                       not a colour (a length, a duration, a shadow list).
 *                       The only population that string ever described
 *                       truthfully.
 *   - `absent`        — at least one member is not in this theme's view at
 *                       all. `resolved.token` reads the theme's COMPOSED
 *                       table (`:root` flows into every theme), so a miss
 *                       means the name is declared in NEITHER `:root` NOR
 *                       this theme — it lives only in a sibling theme's
 *                       block, which the coverage section treats as ordinary
 *                       reality. Calling that "not a colour" asserted
 *                       something about a value that does not exist here.
 *   - `unresolvable`  — both members are in the view and at least one is
 *                       `kind: "unresolved"` or `"cycle"`: a `var()` chain
 *                       that found nothing, or one that came back around.
 *                       The report already says exactly this about the same
 *                       token in its unresolved-reference / cycle-reference
 *                       sections and in coverage's `N unresolved` segments —
 *                       under the old single string those two sections
 *                       diagnosed one token two contradictory ways.
 *
 * A widening, never a re-labelling: `translucent` and `not-a-color` keep the
 * exact strings and the exact populations they had.
 */
export type SkipReason = "translucent" | "not-a-color" | "absent" | "unresolvable";

/** A pair that could not be measured, and why. */
export interface SkippedPair {
  readonly theme: string;
  readonly base: string;
  readonly state: string;
  readonly reason: SkipReason;
  /**
   * For `reason: "absent"` ONLY — where the missing member(s) actually live:
   * the themes whose own blocks declare them, with each declaration's
   * cascade-winner position (`line 4`, or `tokens.css:4` for a declaration
   * spliced in over an `@import` edge).
   *
   * ABSENT rather than `null` on every other reason, under the codebase's
   * absence-is-a-fact discipline: a row that is not an absence has no sibling
   * scope to name, and a `null` there would invite a reader to treat "no
   * pointer" and "pointer we could not build" as one state. It is also absent
   * on an `absent` row whose members are found in NO theme's block — the
   * derivation says nothing rather than naming a wrong scope.
   */
  readonly declaredIn?: readonly SiblingScope[];
}

/** One place an absent pair member IS declared. */
export interface SiblingScope {
  /** The member this scope declares — `base` or `state`. */
  readonly name: string;
  /** The theme whose own block declares it. */
  readonly theme: string;
  /** Its cascade-winner position there: `line 4`, or `tokens.css:4`. */
  readonly site: FindingSite;
}

export interface ScaleCollapseResult {
  readonly findings: Finding[];
  /** Pairs deliberately not judged. Never silently dropped. */
  readonly skipped: SkippedPair[];
}

/**
 * The themes whose OWN blocks declare `name`, with the position each declares
 * it at — the sibling-scope pointer an `absent` row carries.
 *
 * `origin === "declared"` is the whole test, and it is the same one
 * `theme-partial-token` asks of the same table. For THIS population it is
 * provably unobservable rather than discriminating, and the proof is the
 * reason the pointer can be trusted at all: a `:root` declaration is
 * inherited into every view and an `@theme inline` alias is
 * theme-independent, so either one is found in EVERY theme and a pair
 * carrying it could never have been absent from one. The only way a name is
 * missing from a view is for a named theme's own block to be its only home —
 * so every lookup that succeeds for an absent member already carries
 * `declared`. Relaxing the filter therefore changes no output, which is a
 * fact worth stating rather than a guard worth pretending covers something:
 * it is kept for soundness and for symmetry with the sibling rule, and the
 * PROPERTY it rests on is what `tests/skip-reason.test.ts` pins.
 */
function declaringScopes(
  resolved: ResolvedStylesheet,
  name: string,
): SiblingScope[] {
  const scopes: SiblingScope[] = [];
  for (const theme of resolved.themes) {
    const token = resolved.token(name, theme);
    if (token === undefined || token.origin !== "declared") continue;
    scopes.push({ name, theme, site: siteFromToken(name, token) });
  }
  return scopes;
}

export function scaleCollapseRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): ScaleCollapseResult {
  const findings: Finding[] = [];
  const skipped: SkippedPair[] = [];

  // The alias layer restates the palette under a second set of names; measuring
  // it would report every collapse twice.
  const pairs = names
    .statePairs()
    .filter((p: StatePair) => !names.isAlias(p.base) && !names.isAlias(p.state));

  for (const theme of resolved.themes) {
    for (const { base, state, suffix } of pairs) {
      const from = resolved.token(base, theme);
      const to = resolved.token(state, theme);
      // The three whys the one condition already evaluates, read in the order
      // it evaluates them — absence first (there is no kind to ask about when
      // the token is not in the view), then the kind split. Each arm is the
      // condition's own half, never a twin predicate beside it.
      if (from === undefined || to === undefined) {
        // Where the missing member(s) DO live. `statePairs()` derives from
        // DECLARED names, so each member is declared in some scope — but a
        // scope reachable only through a lookup this pass cannot make (an
        // alias-layer entry, say) would leave the list empty, and an empty
        // list says nothing rather than naming a wrong scope.
        const declaredIn = [
          ...(from === undefined ? declaringScopes(resolved, base) : []),
          ...(to === undefined ? declaringScopes(resolved, state) : []),
        ];
        skipped.push(
          declaredIn.length === 0
            ? { theme, base, state, reason: "absent" }
            : { theme, base, state, reason: "absent", declaredIn },
        );
        continue;
      }
      if (
        from.kind === "unresolved" ||
        from.kind === "cycle" ||
        to.kind === "unresolved" ||
        to.kind === "cycle"
      ) {
        skipped.push({ theme, base, state, reason: "unresolvable" });
        continue;
      }
      if (from.kind !== "color" || to.kind !== "color") {
        skipped.push({ theme, base, state, reason: "not-a-color" });
        continue;
      }
      if (from.translucent || to.translucent) {
        skipped.push({ theme, base, state, reason: "translucent" });
        continue;
      }
      const delta = deltaLstar(from.color as Color, to.color as Color);
      if (Math.abs(delta) >= VISIBLE_STEP_LSTAR) continue;
      // The two declarations the distance was measured BETWEEN, in the order the
      // message names them: base first, then state. Both are the theme's own
      // cascade winners — in winter the pair is measured from winter's
      // declarations, not from the `:root` ones the same names also have.
      const sites: FindingSite[] = [siteFromToken(base, from), siteFromToken(state, to)];
      findings.push({
        rule: "scale-collapse",
        theme,
        tokens: [base, state],
        message:
          `${state} is ΔL* ${Math.abs(delta).toFixed(2)} from ${base} in theme "${theme}" — ` +
          `under the ${VISIBLE_STEP_LSTAR} needed for a visible step, so the ${suffix} ` +
          `state is not distinguishable from the resting one. ` +
          // `sites` reads base-then-state to match the finding's `tokens`, while
          // the sentence above reads state-then-base — so the clause is built
          // from a reordered copy rather than from `sites` itself, and the two
          // orders stay the two orders each is correct in.
          positionClause([sites[1] as FindingSite, sites[0] as FindingSite]),
        sites,
        evidence: {
          state: suffix,
          deltaLstar: Number(delta.toFixed(2)),
          threshold: VISIBLE_STEP_LSTAR,
          baseLstar: Number(lstar(from.color as Color).toFixed(2)),
          stateLstar: Number(lstar(to.color as Color).toFixed(2)),
          baseValue: from.resolvedValue as string,
          stateValue: to.resolvedValue as string,
        },
      });
    }
  }

  return { findings, skipped };
}
