/**
 * Theme-keyed resolution of CSS custom properties.
 *
 * Takes the scopes {@link parseStylesheet} produced and answers, for every
 * theme, what each custom property actually resolves to — following `var()`
 * indirections, including Tailwind v4's `@theme inline` alias namespace
 * (`--color-app-cta: var(--app-cta)`).
 *
 * Chains are followed through EMBEDDED references too, not only through values
 * that are exactly one `var()` call: `1px solid var(--c)` and
 * `calc(var(--x) + 2px)` are the ordinary shapes real stylesheets are written
 * in, and a chain that closes on one of them is a cycle whichever way the
 * value is spelled. For a compound value v1 mints the CYCLE fact only — a
 * MISSING embedded name stays rule 5's (`unresolved-reference`), judged at use
 * level from the references the parser already collects, because minting
 * `unresolved` for the declaration too would report one defect twice. The
 * edges read from a compound value are PRIMARY-position references — the first
 * argument of each `var()` call — never a name inside a `var()`'s own fallback
 * segment. Reading one would invent an edge the walk does not take on the
 * ordinary shape: `--a: var(--b, var(--a))` mentions `--a` in its own fallback,
 * so a scan that read it would close a loop on iteration zero and report
 * `--a → --a`, losing the real `--a → --b → --a`.
 *
 * That constraint makes the compound scan NARROWER than the whole-value walk on
 * exactly one shape, and the difference is a stated v1 residual rather than a
 * parallel: the whole-value walk DOES descend into a fallback — and does treat
 * the names in it as edges — when the primary is UNDECLARED and the browser
 * would therefore substitute that fallback. So `--a: var(--nope, var(--a))` is
 * `cycle` (chain `--a → --nope → --a`) while `1px solid var(--nope, var(--a))`
 * is not: the compound scan reads `--nope` and stops, because deciding that a
 * fallback segment is the live one requires knowing which primaries are
 * undeclared, which the scan deliberately does not do in v1. Both shapes are
 * pinned in `tests/compound-cycle.test.ts`.
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
 *                        It never throws and never loops forever. The closing
 *                        edge counts whether it is the whole value
 *                        (`--a: var(--b)`) or embedded in a compound one
 *                        (`--a: 1px solid var(--b)`), in primary position
 *                        either way.
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
  /**
   * The imported file the winning declaration was spliced from — same
   * spelling as {@link Scope.origin}: the target's path relative to the
   * audit's ENTRY file. Set only when that declaration arrived over an
   * `@import` edge, and absent on an entry-file declaration, which is what
   * keeps every root-only report byte-identical. Rules cite it next to
   * {@link line} (`tokens.css:2`) because line numbers are per-file and a
   * bare one would point the reader into whichever file they had open.
   *
   * Named `importOrigin` because `origin` is taken: {@link origin} is the
   * declared/inherited/theme-inline discriminator, a different axis.
   */
  readonly importOrigin?: string;
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
  /**
   * `root` first, then every other theme in source order — `[data-theme=…]`
   * scopes named by their attribute value, and `prefers-color-scheme` `:root`
   * scopes named by their feature value (`dark`, `winter`, `light`, …).
   */
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

/** The primary argument of a `var()` call: the name, before any `,fallback`. */
const VAR_PRIMARY = /^\s*(--[\w-]+)/;

/**
 * Every PRIMARY-position custom property a value references.
 *
 * `VAR_ONLY` answers the whole-value question — is this value exactly one
 * `var()` call — and returns nothing at all for `1px solid var(--c)` or
 * `calc(var(--x) + 2px)`, which is how the majority of real token values are
 * written. This reads the same edges out of a compound value: for each `var()`
 * call, the first argument, and nothing else.
 *
 * "Nothing else" is the load-bearing half. Each call's own parentheses are
 * SKIPPED once its primary name is taken, so a reference living inside a
 * `var()`'s FALLBACK segment (`var(--c, var(--a))`) is never collected. Reading
 * one would invent an edge the resolution walk does not take for that value:
 * `--a: var(--b, var(--a))` mentions `--a` in its own fallback, so an
 * unconstrained scan would close a loop on iteration zero and report
 * `--a → --a`, losing `--b` and contradicting the walk that actually runs.
 *
 * This is NARROWER than the whole-value walk, not identical to it. That walk
 * does follow a fallback — and does treat its names as edges — in the one case
 * where the browser would substitute it: when the primary is UNDECLARED
 * (`VAR_ONLY` captures the primary, then sets `value = fallback` if `lookup`
 * misses). Telling that case apart requires knowing which primaries are
 * declared, which this scan deliberately does not do, so
 * `1px solid var(--nope, var(--a))` stays unflagged where the whole-value
 * `var(--nope, var(--a))` is `cycle`. Pinned as a residual in
 * `tests/compound-cycle.test.ts`.
 */
function primaryReferences(value: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < value.length; ) {
    const at = value.indexOf("var(", i);
    if (at === -1) break;
    const open = at + 4;
    const primary = value.slice(open).match(VAR_PRIMARY);
    if (primary) names.push(primary[1]);
    // Walk to this call's own closing paren, so its fallback segment — the
    // only place a nested `var()` can sit — is passed over rather than read.
    let depth = 1;
    let j = open;
    while (j < value.length && depth > 0) {
      const ch = value[j];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
    }
    i = j > open ? j : open;
  }
  return names;
}

interface ScopeTable {
  readonly theme: string;
  readonly declarations: Map<string, { value: string; line: number; from?: string }>;
}

function tableFor(
  scopes: readonly Scope[],
): Map<string, { value: string; line: number; from?: string }> {
  const map = new Map<string, { value: string; line: number; from?: string }>();
  for (const scope of scopes) {
    for (const d of scope.declarations) {
      // Last declaration wins, as the cascade does within one origin. The fold
      // is only sound for UNconditional scopes, which is all this function is
      // ever handed: a `prefers-color-scheme` `:root` block does not cascade
      // over the base — both blocks are live, selected by the OS setting — so
      // resolveStylesheet builds each conditioned scope into its own theme and
      // never lets it reach here. Scopes arrive in DOCUMENT order — the
      // loader's splice guarantees it across files — so "last" is the
      // browser's winner, whichever file it was written in, and the winner's
      // `from` travels with it for the rules' citations.
      map.set(d.name, { value: d.value, line: d.line, from: scope.origin });
    }
  }
  return map;
}

/** Resolve a parsed stylesheet into per-theme token tables. */
export function resolveStylesheet(sheet: Stylesheet): ResolvedStylesheet {
  const rootScopes = sheet.scopes.filter((s) => s.kind === "root");
  const inlineScopes = sheet.scopes.filter((s) => s.kind === "theme-inline");
  const themeScopes = sheet.scopes.filter((s) => s.kind === "theme");

  // A `prefers-color-scheme` `:root` block is NOT a cascade over the base:
  // the base block and the conditioned block are both live, selected by the
  // OS setting, and folding the conditioned values in here would overwrite
  // the light palette with the dark one — hiding every light-only defect and
  // feeding dark values to every attribute theme's inheritance. So the
  // conditioned root scopes are lifted OUT of the base table and become
  // themes of their own, named for the feature value (`dark`, `light`). The
  // UNconditional scopes build the base table every theme — the scheme themes
  // included — inherits through, which is the whole point: inheritance reads
  // the real base, never a conditioned overwrite.
  const baseScopes = rootScopes.filter((s) => !s.colorScheme);
  const schemeScopes = rootScopes.filter((s) => s.colorScheme);

  const rootTable = tableFor(baseScopes);
  const inlineTable = tableFor(inlineScopes);

  const themeNames: string[] = [ROOT_THEME];
  const themeTables = new Map<string, ScopeTable>();
  themeTables.set(ROOT_THEME, { theme: ROOT_THEME, declarations: rootTable });

  // Attribute themes and colour-scheme themes are one population: an author
  // who writes BOTH `[data-theme="dark"]` and a dark media block is stating
  // the dark palette twice, by attribute and by OS setting, so the two land
  // in one `dark` table — last declaration in source order winning, exactly
  // as two `[data-theme="dark"]` blocks already did. The stable sort keeps
  // `themes` "root first, then every theme in source order" across both kinds.
  //
  // "Source order" means DOCUMENT order of the merged sheet, never the bare
  // `line` number. Since the audit's unit became the import closure, scopes
  // arrive from many files and every file's lines restart at 1, so a line
  // sort would silently REORDER the splice: an imported theme block sitting
  // at line 10 would override the importing file's own line-2 restatement of
  // the same theme — the exact inverse of how a browser resolves it, and a
  // defect factory in both directions (a collapse reported where none exists,
  // a real one passed over because the imported file's healthier pair was
  // read instead). `sheet.scopes` IS document order — the loader splices
  // imported scopes at their statements, ahead of the importing file's own —
  // so the sort keys on that array position: for a single file it gives the
  // same order the line sort gave, byte for byte, and across a closure it
  // gives the browser's.
  const documentIndex = new Map(sheet.scopes.map((s, i) => [s, i] as const));
  const overrides = [...themeScopes, ...schemeScopes].sort(
    (a, b) => (documentIndex.get(a) ?? 0) - (documentIndex.get(b) ?? 0),
  );
  for (const scope of overrides) {
    const name =
      scope.kind === "root" ? (scope.colorScheme as string) : (scope.theme as string);
    if (!themeTables.has(name)) {
      themeNames.push(name);
      themeTables.set(name, { theme: name, declarations: new Map() });
    }
    const table = themeTables.get(name) as ScopeTable;
    for (const d of scope.declarations) {
      table.declarations.set(d.name, {
        value: d.value,
        line: d.line,
        from: scope.origin,
      });
    }
  }
  // Lookup for a theme: its own declarations, then :root, then the
  // `@theme inline` alias namespace (which is theme-independent by design —
  // its values are var() references that recolour when the theme switches).
  // `:root` here is the UNconditional base table: a colour-scheme block's
  // values are a theme of their own, never the fallback another theme reads
  // through.
  const lookup = (
    name: string,
    theme: string,
  ): { value: string; line: number; from?: string; origin: TokenOrigin } | null => {
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
        // The COMPOUND branch. The whole-value walk above declined, so this
        // value is not exactly one `var()` call — `1px solid var(--c)`,
        // `calc(var(--x) + 2px)`, `color-mix(in srgb, var(--a) 15%, var(--b))`.
        // A chain that closes here is the same defect a whole-value loop is:
        // per CSS custom-property semantics every property in the loop is
        // invalid at computed-value time however the value is spelled. So the
        // embedded PRIMARY-position references are read for a back edge, and
        // one that lands on a name already on the walk mints the identical
        // fact the whole-value branch mints — same kind, same null value, same
        // `[...chain, name]` shape.
        //
        // Only the back edge is minted. A compound value is not FOLLOWED (the
        // walk has no substituted value to continue with — the rest of the
        // value is literal text), and an embedded name nothing declares stays
        // rule 5's at use level rather than becoming a second `unresolved`
        // fact about this declaration. Every whole-value shape — plain loop,
        // self-loop, fallback-missing, fallback-cycle — is handled above and
        // never reaches here, so their facts are unchanged by construction.
        //
        // The not-followed half has one visible consequence, pinned in the
        // tests as a residual: a TAIL declaration whose walk enters a loop
        // THROUGH a compound value (`--tail: var(--a)` where `--a` closes a
        // compound loop) stops at that value and classifies as its literal
        // text, where a tail into a whole-value loop is itself marked `cycle`.
        // The loop's own fact is minted either way, so the defect is reported;
        // only the dependent declaration goes unlisted.
        for (const name of primaryReferences(value)) {
          if (seen.has(name)) {
            return {
              resolvedValue: null,
              kind: "cycle",
              chain: [...chain, name],
              missingReference: null,
            };
          }
        }
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
        ...(found.from !== undefined ? { importOrigin: found.from } : {}),
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
