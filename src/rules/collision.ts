/**
 * Rule 1 — VALUE COLLISION.
 *
 * Two token names that must differ hold byte-identical colours in one theme.
 * The real one this package was built around: `--app-border` equalled
 * `--app-surface-raised`, so a panel's 1px border was literally invisible for
 * three and a half months.
 *
 * ── The rule is a JUDGEMENT, and the data is not the answer ─────────────────
 * `collisionGroups(theme)` reports every group of tokens sharing a value: 41
 * groups in the calibration fixture's dark theme, of which exactly 2 are
 * defects. Reporting the data would be 39 false positives. Three filters cut
 * it, each one closing a distinct way for tokens to share a value ON PURPOSE:
 *
 *   1. THE ALIAS IS THE TOKEN. `--color-app-cta: var(--app-cta)` resolves to
 *      the same colour by construction — that is what an alias IS. A member
 *      whose `var()` chain passes through another member of its own group is
 *      dropped, so the group is a set of independent tokens before anything is
 *      judged. This is the largest cut and the least interesting one: 36 of
 *      the fixture's 41 dark groups are nothing but a token and its alias.
 *
 *   2. TOKENS THAT MOVE TOGETHER ARE ONE VALUE, WRITTEN TWICE. The fixture
 *      says so itself: "--app-border-focus is deliberately EQUAL to --app-cta:
 *      the kit unifies the focus technique, it does not change the focus
 *      color" (:196). Such a pair holds the same value in EVERY theme. A pair
 *      that agrees everywhere is a deliberate identity — an alias the author
 *      wrote by repetition rather than by `var()`. A pair that agrees HERE and
 *      differs in another theme is a collision in this theme, and the other
 *      theme is the proof that they are meant to be different tokens. Members
 *      are therefore grouped into lockstep classes, and only DISTINCT classes
 *      can collide.
 *
 *   3. A FAMILY'S MEMBERS ARE NOT EACH OTHER'S COLLISIONS. The fixture is
 *      explicit that "`--app-warning` and `--app-warning-border` sharing a
 *      value is deliberate, and `--app-border` sharing one with
 *      `--app-surface-raised` is the famous defect. Telling those apart is
 *      rule 1's job." A semantic tone and its border are one role expressed
 *      twice; two different roles are two different roles. So a finding needs
 *      two distinct FAMILIES (see `TokenNames.head`), not merely two names.
 *
 * ── What the rule deliberately does NOT do ─────────────────────────────────
 * It does not rank, score or guess which member is "wrong". A collision is
 * symmetric and which side should move is a design decision this package has
 * no standing to make. The finding names both roles and the shared value, and
 * stops there.
 *
 * A translucent colour is grouped by its own canonical `rgba()` text, never
 * composited: two `rgba()` fills sharing a value collide for the same reason
 * two hexes do, and no backdrop is invented to compare them (see color.ts).
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding } from "./finding.js";
import { TokenNames } from "./tokens.js";

/** A set of names that hold the same value in every theme. */
interface LockstepClass {
  readonly names: readonly string[];
  /** The member that best names the class: a family head if one is present. */
  readonly representative: string;
}

export function collisionRule(
  resolved: ResolvedStylesheet,
  names: TokenNames = new TokenNames(resolved),
): Finding[] {
  const findings: Finding[] = [];

  const colorValue = (name: string, theme: string): string | null => {
    const token = resolved.token(name, theme);
    return token !== undefined && token.kind === "color" ? token.resolvedValue : null;
  };

  // Two names are in lockstep when EVERY theme gives them the same colour.
  // Non-colour and missing values compare equal only to each other, so a name
  // that is a colour in one theme and a length in another never pairs up.
  const inLockstep = (a: string, b: string): boolean =>
    resolved.themes.every((theme) => colorValue(a, theme) === colorValue(b, theme));

  for (const theme of resolved.themes) {
    for (const group of resolved.collisionGroups(theme)) {
      const members = new Set(group.names);

      // Filter 1 — an alias resolves THROUGH another member of this group.
      const independent = group.names.filter((name) => {
        const token = resolved.token(name, theme);
        if (token === undefined) return false;
        return !token.chain.slice(1).some((link) => members.has(link));
      });
      if (independent.length < 2) continue;

      // Filter 2 — collapse into lockstep classes.
      const classes: string[][] = [];
      for (const name of independent) {
        const existing = classes.find((c) => inLockstep(c[0] as string, name));
        if (existing) existing.push(name);
        else classes.push([name]);
      }

      // Filter 3 — one entry per FAMILY, so a family's own members cannot
      // collide with each other. A class containing its family's head is
      // represented by that head, which is the role a reader recognises.
      const families = new Map<string, LockstepClass>();
      for (const cls of classes) {
        const representative = cls.find((n) => names.isHead(n)) ?? (cls[0] as string);
        const head = names.head(representative);
        if (!families.has(head)) families.set(head, { names: cls, representative });
      }
      if (families.size < 2) continue;

      const entries = [...families.entries()].sort(([a], [b]) => a.localeCompare(b));
      const roles = entries.map(([, cls]) => cls.representative);
      findings.push({
        rule: "collision",
        theme,
        tokens: roles,
        message:
          `${roles.join(" and ")} both resolve to ${group.value} in theme "${theme}". ` +
          `They are separate roles, and they differ in another theme — so this ` +
          `theme is repainting one with the other.`,
        evidence: {
          value: group.value,
          roles,
          /** Every name in the group, aliases included, for traceability. */
          groupMembers: group.names,
          /** The names each colliding role moves in lockstep with. */
          lockstepClasses: entries.map(([, cls]) => cls.names.join(" == ")),
        },
      });
    }
  }

  return findings;
}
