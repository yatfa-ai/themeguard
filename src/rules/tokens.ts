/**
 * The naming facts the rules read a stylesheet's STRUCTURE from.
 *
 * A design-token stylesheet encodes structure in its names — `--app-surface`,
 * `--app-surface-raised` and `--app-surface-hover` are one role and two
 * variants of it — and every one of the three rules needs that structure to
 * avoid reporting a family's own internal arrangement as a defect.
 *
 * Nothing here parses names for their own sake. A prefix is only ever treated
 * as a family head when the stylesheet ITSELF declares that shorter name, so
 * the structure is read out of the declarations rather than guessed from a
 * vocabulary themeguard invented. `--app-neutral-on-surface` has no family in
 * this fixture because `--app-neutral` is not declared, and that is the correct
 * answer rather than a gap.
 */

import type { ResolvedStylesheet } from "../resolve.js";

/**
 * Suffixes that name an INTERACTION STATE of the token they are attached to.
 *
 * Used only to pair `X` with `X-hover` when BOTH are declared — the suffix
 * never classifies a token on its own, so a token named `--brand-active` with
 * no `--brand` beside it is not treated as anything's state.
 */
export const STATE_SUFFIXES = [
  "hover",
  "active",
  "pressed",
  "focus",
  "disabled",
  "selected",
  "visited",
] as const;

export type StateSuffix = (typeof STATE_SUFFIXES)[number];

export interface StatePair {
  /** The resting token. */
  readonly base: string;
  /** The token naming a state of it. */
  readonly state: string;
  readonly suffix: StateSuffix;
}

export class TokenNames {
  /** Every custom property the stylesheet declares, in any scope. */
  readonly declared: ReadonlySet<string>;
  /**
   * The names declared in an `@theme inline` block.
   *
   * Tailwind v4's alias namespace is a BUILD-TIME API, not a palette: each
   * entry is a `var()` pointing at a palette token, and it is consumed by
   * generated utility classes that do not exist in this stylesheet. It is
   * therefore a REFERENCE LAYER — it proves the tokens it points at are used —
   * and never a judged population of its own. Judging it reports the whole
   * namespace as dead (64 of the fixture's 66 naive dead tokens) and reports
   * every alias as a collision with the token it aliases.
   */
  readonly aliasLayer: ReadonlySet<string>;

  private readonly heads = new Map<string, string>();

  constructor(resolved: ResolvedStylesheet) {
    const declared = new Set<string>();
    const alias = new Set<string>();
    for (const scope of resolved.stylesheet.scopes) {
      for (const d of scope.declarations) {
        declared.add(d.name);
        if (scope.kind === "theme-inline") alias.add(d.name);
      }
    }
    this.declared = declared;
    this.aliasLayer = alias;
  }

  /** True for a name in the `@theme inline` alias namespace. */
  isAlias(name: string): boolean {
    return this.aliasLayer.has(name);
  }

  /**
   * The head of the family `name` belongs to: the shortest declared name it is
   * a hyphen-segment extension of, found transitively.
   *
   * `--app-surface-raised` → `--app-surface`, because that name is declared.
   * `--app-warning-border` → `--app-warning`, which is why the fixture's
   * deliberate semantic↔`-border` twins are one family and not a collision.
   * A name with no declared proper prefix is its own head.
   */
  head(name: string): string {
    const cached = this.heads.get(name);
    if (cached !== undefined) return cached;
    // Guard against a cycle through a malformed name set before recursing.
    this.heads.set(name, name);
    const bare = name.replace(/^--/, "");
    const parts = bare.split("-");
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const candidate = `--${parts.slice(0, i).join("-")}`;
      if (candidate !== name && this.declared.has(candidate)) {
        const resolvedHead = this.head(candidate);
        this.heads.set(name, resolvedHead);
        return resolvedHead;
      }
    }
    return name;
  }

  /** True when `name` IS its family's head rather than a variant of one. */
  isHead(name: string): boolean {
    return this.head(name) === name;
  }

  /**
   * Every `X` / `X-<state>` pair where BOTH names are declared, sorted by base
   * then state. This is the pairing rule 3 measures across — see
   * `scale-collapse.ts` for why it is derived this way and not by sorting a
   * ladder by lightness.
   */
  statePairs(): StatePair[] {
    const pairs: StatePair[] = [];
    for (const name of [...this.declared].sort()) {
      for (const suffix of STATE_SUFFIXES) {
        if (!name.endsWith(`-${suffix}`)) continue;
        const base = name.slice(0, -(suffix.length + 1));
        if (this.declared.has(base)) pairs.push({ base, state: name, suffix });
      }
    }
    return pairs;
  }
}
