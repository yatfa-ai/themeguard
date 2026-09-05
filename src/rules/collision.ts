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
 *      color" (:196). Such a pair is written out equal AGAIN in the other
 *      theme: an author who restates an equality every time they restate the
 *      palette is asserting it, and that repetition is the deliberateness.
 *      Members are therefore grouped into lockstep classes, and only DISTINCT
 *      classes can collide.
 *
 *      ⚠️ THE FILTER NEEDS POSITIVE EVIDENCE, AND SILENCE IS NOT EVIDENCE.
 *      This filter was first written as "the pair agrees in EVERY theme",
 *      which is the same test only when the other themes actually SAY
 *      something about the pair. Where they say nothing it inverts: on a
 *      single-theme stylesheet `Array.every` over one theme is vacuously
 *      true, so every pair became deliberate and the rule reported nothing at
 *      all — including on this package's own headline example, a `:root`-only
 *      sheet where `--app-border` equals `--app-surface-raised`. The general
 *      form is worse: a pair declared ONCE in `:root` and inherited everywhere
 *      never diverges however many themes exist, so it was unreportable by
 *      construction. Both were silent false negatives that read as a clean
 *      pass, and neither was reachable by the calibration fixture, whose two
 *      themes both override the famous pair.
 *
 *      So the predicate asks for the repetition directly: some OTHER theme
 *      DECLARES both names itself and still gives them one value. A theme that
 *      inherits a name has not restated anything, and a stylesheet with no
 *      other theme has nowhere to have restated it — in both cases the
 *      equality is unwitnessed, and an unwitnessed equality is reported. The
 *      cost of that direction is a false positive on a genuinely deliberate
 *      pair that is only ever written once; the cost of the other direction
 *      was missing the defect the package exists to find. Every finding
 *      carries `corroboration` saying which case it is, so a reader can see
 *      the difference the rule is drawing rather than infer it.
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

  // A theme SPEAKS about a name when it declares the name itself. An inherited
  // value is `:root` being read again, not a second author statement about it,
  // so it corroborates nothing.
  const declaresItself = (name: string, theme: string): boolean =>
    resolved.token(name, theme)?.origin === "declared";

  // Two names are in lockstep when some OTHER theme declares BOTH of them and
  // still gives them the same colour — the author restating the equality, which
  // is the only positive evidence a stylesheet offers that it is deliberate.
  // Non-colour and missing values compare equal only to each other, so a name
  // that is a colour in one theme and a length in another never pairs up.
  //
  // Deliberately NOT "they agree in every theme": that reads silence as assent,
  // and returns no findings at all on a single-theme sheet. See filter 2 above.
  const inLockstep = (a: string, b: string, here: string): boolean =>
    resolved.themes.some(
      (theme) =>
        theme !== here &&
        declaresItself(a, theme) &&
        declaresItself(b, theme) &&
        colorValue(a, theme) === colorValue(b, theme),
    );

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
        const existing = classes.find((c) => inLockstep(c[0] as string, name, theme));
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

      // Does another theme SHOW these roles apart, or is this theme simply the
      // only place either of them is written? The finding is the same either
      // way — the roles hold one value here and they are separate roles — but
      // the reader is owed the difference, because the first case carries the
      // author's own proof that they are meant to differ and the second does
      // not.
      //
      // Note the asymmetry with `inLockstep` above, which is deliberate. An
      // EQUALITY only counts as intended when a theme restates it, so that
      // predicate demands both names be declared there. A DIVERGENCE needs no
      // such care: two roles resolving apart in some theme is proof they can
      // differ, whether the theme redeclared both or moved just one and let the
      // other inherit — which is exactly how `--app-cta` parts from
      // `--app-success` in the fixture's winter.
      //
      // Never inferred from theme COUNT: a two-theme sheet whose second theme
      // inherits both names witnesses exactly as little as a sheet with no
      // second theme at all.
      const witness = resolved.themes.find(
        (other) =>
          other !== theme && new Set(roles.map((role) => colorValue(role, other))).size > 1,
      );
      findings.push({
        rule: "collision",
        theme,
        tokens: roles,
        message:
          `${roles.join(" and ")} both resolve to ${group.value} in theme "${theme}". ` +
          (witness !== undefined
            ? `They are separate roles, and theme "${witness}" declares them apart — ` +
              `so this theme is repainting one with the other.`
            : `They are separate roles, and no other theme declares them apart, so ` +
              `nothing here shows the equality is intended.`),
        evidence: {
          value: group.value,
          roles,
          /**
           * Why this pair was not taken to be a deliberate identity.
           * `divergent`: another theme declares the roles apart, which is the
           * author's own evidence they must differ. `unwitnessed`: no other
           * theme declares both, so there is no evidence either way and the
           * equality is reported rather than assumed intentional.
           */
          corroboration: witness !== undefined ? `divergent in "${witness}"` : "unwitnessed",
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
