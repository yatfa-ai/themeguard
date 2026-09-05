/**
 * Theme-keyed resolution of CSS custom properties.
 *
 * Takes the scopes {@link parseStylesheet} produced and answers, for every
 * theme, what each custom property actually resolves to — following `var()`
 * indirections, including Tailwind v4's `@theme inline` alias namespace
 * (`--color-app-cta: var(--app-cta)`).
 *
 * ── This stage produces DATA, never verdicts ────────────────────────────────
 * Nothing here decides that two tokens holding the same colour is a defect, or
 * that an unresolved reference is an error. It reports what is there. The rules
 * that judge this data live in `rules/`, behind {@link audit} — and the split is
 * load-bearing, not tidiness: `collisionGroups` returns 41 groups for this
 * project's own calibration stylesheet, of which 2 are defects. Which is why
 * the data stage must not pretend to know.
 *
 * ── Four things are represented EXPLICITLY rather than papered over ─────────
 *   1. Theme absence   — a token a theme does not override is `inherited`, and
 *                        the absence is listed per theme in `absences`. It is
 *                        normal, not an error: theme-independent tokens (focus
 *                        geometry, control sizing) deliberately have no
 *                        override.
 *   2. Translucency    — a resolved colour with alpha < 1 is reported as
 *                        `translucent: true` and is NEVER composited against an
 *                        invented backdrop. A semi-transparent token has no
 *                        single value without the surface it is painted on.
 *   3. Unresolved refs — a `var()` pointing at a property no scope declares
 *                        resolves to kind `unresolved`, naming the reference.
 *   4. Cycles          — a `var()` chain that returns to a name already on the
 *                        chain resolves to kind `cycle`, carrying the path.
 *                        It never throws and never loops forever.
 */

import { parseColor, isTranslucent, toCss, type Color } from "./color.js";
import { parseStylesheet, type Scope, type Stylesheet } from "./parse.js";

/** The base scope. Every theme falls back to it. */
export const ROOT_THEME = "root";

export type TokenKind =
  /** Resolves to a parseable colour. */
  | "color"
  /** Resolves to a value that is not a colour: a length, a duration, a shadow
   *  list, a font stack, a `color-mix()` expression. */
  | "non-color"
  /** A `var()` chain reached a property no scope declares in this theme. */
  | "unresolved"
  /** A `var()` chain returned to a name already on the chain. */
  | "cycle";

export type TokenOrigin =
  /** Declared in this theme's own scope. */
  | "declared"
  /** Not declared by this theme; the value comes from `:root`. */
  | "inherited"
  /** Declared in an `@theme inline` block (Tailwind v4's alias namespace). */
  | "theme-inline";

export interface ResolvedToken {
  readonly name: string;
  readonly theme: string;
  readonly origin: TokenOrigin;
  /** The value as written, before `var()` substitution. */
  readonly declaredValue: string;
  /** The value after `var()` substitution, or `null` when unresolved/cyclic. */
  readonly resolvedValue: string | null;
  readonly kind: TokenKind;
  /** Present only when `kind === "color"`. */
  readonly color: Color | null;
  /** True only when `kind === "color"` and the colour carries alpha < 1. */
  readonly translucent: boolean;
  /**
   * The `var()` names traversed to reach the resolved value, starting with this
   * token's own name. A direct value gives a chain of length 1.
   */
  readonly chain: readonly string[];
  /** For `kind === "unresolved"`: the custom property that was not found. */
  readonly missingReference: string | null;
  /** 1-based line of the declaration this token resolves from. */
  readonly line: number;
}

export interface ThemeAbsence {
  readonly name: string;
  readonly theme: string;
  /** The value inherited from `:root` in this theme's absence. */
  readonly inheritedValue: string;
}

export interface ValueGroup {
  readonly theme: string;
  /** Canonical colour text shared by every member (`#RRGGBB` or `rgba(...)`). */
  readonly value: string;
  readonly names: readonly string[];
}

export interface ResolvedStylesheet {
  /** `root` first, then every `[data-theme=…]` in source order. */
  readonly themes: readonly string[];
  /** Every token, for every theme. */
  readonly tokens: readonly ResolvedToken[];
  /** Per theme, the `:root` tokens that theme does not override. */
  readonly absences: readonly ThemeAbsence[];
  readonly stylesheet: Stylesheet;
  tokensFor(theme: string): ResolvedToken[];
  token(name: string, theme: string): ResolvedToken | undefined;
  /**
   * Tokens that resolve to the same colour, per theme, grouped by canonical
   * value. Groups of one are omitted. This is DATA, and it is deliberately far
   * wider than the defect set: most groups are a token beside its own
   * `@theme inline` alias, or two names an author keeps equal on purpose.
   * `rules/collision.ts` decides which of these groups matter.
   */
  collisionGroups(theme: string): ValueGroup[];
}

const VAR_ONLY = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/;

interface ScopeTable {
  readonly theme: string;
  readonly declarations: Map<string, { value: string; line: number }>;
}

function tableFor(scopes: readonly Scope[]): Map<string, { value: string; line: number }> {
  const map = new Map<string, { value: string; line: number }>();
  for (const scope of scopes) {
    for (const d of scope.declarations) {
      // Last declaration wins, as the cascade does within one origin.
      map.set(d.name, { value: d.value, line: d.line });
    }
  }
  return map;
}

/** Resolve a parsed stylesheet into per-theme token tables. */
export function resolveStylesheet(sheet: Stylesheet): ResolvedStylesheet {
  const rootScopes = sheet.scopes.filter((s) => s.kind === "root");
  const inlineScopes = sheet.scopes.filter((s) => s.kind === "theme-inline");
  const themeScopes = sheet.scopes.filter((s) => s.kind === "theme");

  const rootTable = tableFor(rootScopes);
  const inlineTable = tableFor(inlineScopes);

  const themeNames: string[] = [ROOT_THEME];
  const themeTables = new Map<string, ScopeTable>();
  themeTables.set(ROOT_THEME, { theme: ROOT_THEME, declarations: rootTable });
  for (const scope of themeScopes) {
    const name = scope.theme as string;
    if (!themeTables.has(name)) {
      themeNames.push(name);
      themeTables.set(name, { theme: name, declarations: new Map() });
    }
    const table = themeTables.get(name) as ScopeTable;
    for (const d of scope.declarations) {
      table.declarations.set(d.name, { value: d.value, line: d.line });
    }
  }

  // Lookup for a theme: its own declarations, then :root, then the
  // `@theme inline` alias namespace (which is theme-independent by design —
  // its values are var() references that recolour when the theme switches).
  const lookup = (
    name: string,
    theme: string,
  ): { value: string; line: number; origin: TokenOrigin } | null => {
    const own = themeTables.get(theme)?.declarations.get(name);
    if (own) return { ...own, origin: "declared" };
    if (theme !== ROOT_THEME) {
      const inherited = rootTable.get(name);
      if (inherited) return { ...inherited, origin: "inherited" };
    }
    const alias = inlineTable.get(name);
    if (alias) return { ...alias, origin: "theme-inline" };
    return null;
  };

  const resolveValue = (
    startName: string,
    startValue: string,
    theme: string,
  ): {
    resolvedValue: string | null;
    kind: TokenKind;
    chain: string[];
    missingReference: string | null;
  } => {
    const chain: string[] = [startName];
    const seen = new Set<string>([startName]);
    let value = startValue;

    for (;;) {
      const m = value.match(VAR_ONLY);
      if (!m) {
        return { resolvedValue: value, kind: classifyValue(value), chain, missingReference: null };
      }
      const referenced = m[1];
      const fallback = m[2]?.trim();
      if (seen.has(referenced)) {
        return {
          resolvedValue: null,
          kind: "cycle",
          chain: [...chain, referenced],
          missingReference: null,
        };
      }
      const next = lookup(referenced, theme);
      if (!next) {
        if (fallback !== undefined && fallback !== "") {
          chain.push(referenced);
          seen.add(referenced);
          value = fallback;
          continue;
        }
        return {
          resolvedValue: null,
          kind: "unresolved",
          chain: [...chain, referenced],
          missingReference: referenced,
        };
      }
      chain.push(referenced);
      seen.add(referenced);
      value = next.value;
    }
  };

  const tokens: ResolvedToken[] = [];
  const absences: ThemeAbsence[] = [];

  for (const theme of themeNames) {
    const names = new Set<string>([
      ...rootTable.keys(),
      ...(themeTables.get(theme)?.declarations.keys() ?? []),
      ...inlineTable.keys(),
    ]);
    for (const name of names) {
      const found = lookup(name, theme);
      if (!found) continue;
      const { resolvedValue, kind, chain, missingReference } = resolveValue(
        name,
        found.value,
        theme,
      );
      const color = kind === "color" ? parseColor(resolvedValue as string) : null;
      tokens.push({
        name,
        theme,
        origin: found.origin,
        declaredValue: found.value,
        resolvedValue,
        kind,
        color,
        translucent: color !== null && isTranslucent(color),
        chain,
        missingReference,
        line: found.line,
      });
      if (found.origin === "inherited") {
        absences.push({ name, theme, inheritedValue: found.value });
      }
    }
  }

  const byTheme = new Map<string, ResolvedToken[]>();
  for (const t of tokens) {
    const list = byTheme.get(t.theme) ?? [];
    list.push(t);
    byTheme.set(t.theme, list);
  }

  return {
    themes: themeNames,
    tokens,
    absences,
    stylesheet: sheet,
    tokensFor(theme) {
      return byTheme.get(theme) ?? [];
    },
    token(name, theme) {
      return (byTheme.get(theme) ?? []).find((t) => t.name === name);
    },
    collisionGroups(theme) {
      const groups = new Map<string, string[]>();
      for (const t of byTheme.get(theme) ?? []) {
        if (t.kind !== "color" || t.color === null) continue;
        const key = toCss(t.color);
        const names = groups.get(key) ?? [];
        names.push(t.name);
        groups.set(key, names);
      }
      return [...groups.entries()]
        .filter(([, names]) => names.length > 1)
        .map(([value, names]) => ({ theme, value, names: [...names].sort() }))
        .sort((a, b) => a.value.localeCompare(b.value));
    },
  };
}

/** Convenience: parse and resolve in one call. */
export function resolveCss(source: string): ResolvedStylesheet {
  return resolveStylesheet(parseStylesheet(source));
}

function classifyValue(value: string): TokenKind {
  return parseColor(value) === null ? "non-color" : "color";
}
