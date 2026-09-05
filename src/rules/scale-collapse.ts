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
 */

import { deltaLstar, lstar, type Color } from "../color.js";
import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding } from "./finding.js";
import { TokenNames, type StatePair } from "./tokens.js";

/** Below this, a step between two fills is not reliably visible. */
export const VISIBLE_STEP_LSTAR = 4;

/** A pair that could not be measured, and why. */
export interface SkippedPair {
  readonly theme: string;
  readonly base: string;
  readonly state: string;
  readonly reason: "translucent" | "not-a-color";
}

export interface ScaleCollapseResult {
  readonly findings: Finding[];
  /** Pairs deliberately not judged. Never silently dropped. */
  readonly skipped: SkippedPair[];
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
      if (
        from === undefined ||
        to === undefined ||
        from.kind !== "color" ||
        to.kind !== "color"
      ) {
        skipped.push({ theme, base, state, reason: "not-a-color" });
        continue;
      }
      if (from.translucent || to.translucent) {
        skipped.push({ theme, base, state, reason: "translucent" });
        continue;
      }
      const delta = deltaLstar(from.color as Color, to.color as Color);
      if (Math.abs(delta) >= VISIBLE_STEP_LSTAR) continue;
      findings.push({
        rule: "scale-collapse",
        theme,
        tokens: [base, state],
        message:
          `${state} is ΔL* ${Math.abs(delta).toFixed(2)} from ${base} in theme "${theme}" — ` +
          `under the ${VISIBLE_STEP_LSTAR} needed for a visible step, so the ${suffix} ` +
          `state is not distinguishable from the resting one.`,
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
