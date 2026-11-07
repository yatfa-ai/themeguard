/**
 * Unread colours — the fact inventory of colour-valued tokens the colour rules
 * do not read.
 *
 * The resolver classifies a value `non-color` whenever {@link parseColor}
 * returns null, and that one bit discards WHY. Most `non-color` tokens really
 * are not colours (lengths, durations, font stacks, shadows), but a modern
 * stylesheet also writes colours in syntax the parser documents it does not
 * evaluate — `light-dark()`, `color-mix()`, relative colour syntax
 * (`oklch(from var(--x) l c h)`), `color()` in a space other than `srgb`,
 * `currentColor` and the system-colour keywords. Such a token is silently
 * absent from collision, scale-collapse and the contrast measurements, and
 * without this inventory the report reads as a complete audit.
 *
 * This is DATA, never a judgement, under the `skipped` / `coverage` precedent:
 * counted, named, printed even at zero, and carrying no exit-code weight. It
 * only makes the omission visible; evaluating `color-mix()` of literal colours
 * is a separate (parser) concern and this inventory stays correct if that ever
 * lands, because it is read off the resolver's own `kind` fact — a token the
 * parser learns to read becomes `color` and drops out of the list.
 *
 * ── What is deliberately NOT listed ─────────────────────────────────────────
 * Only a value that IS the colour-valued syntax. A function is matched only
 * when one call spans the whole value, and `currentColor` / a system-colour
 * keyword only when it is the whole value, so `0 1px 2px color-mix(...)` (a
 * shadow), `1px solid currentColor` (a border shorthand) and every length,
 * duration or font stack stay out: the list is the tokens whose colour the
 * colour rules would have judged had they understood the syntax.
 */

import { type ResolvedStylesheet, type TokenOrigin } from "../resolve.js";

/** One `non-color` token whose value is colour-valued syntax the parser does not read. */
export interface UnreadColor {
  readonly theme: string;
  readonly token: string;
  /**
   * The syntax that kept the token out: `light-dark`, `color-mix`,
   * `relative-color`, `color(<space>)`, `currentColor` or `system-color`.
   */
  readonly syntax: string;
  /** 1-based line of the declaration the token resolves from. */
  readonly line: number;
  /** How this theme comes by the token. */
  readonly declaration: TokenOrigin;
  /** The imported file the declaration was spliced from; absent for the entry file. */
  readonly importOrigin?: string;
}

/** Per theme, how many tokens the theme holds — the headline's denominator. */
export interface UnreadColorTotals {
  readonly theme: string;
  readonly total: number;
}

/** Functions that accept the `from <colour>` relative-colour form. */
const RELATIVE_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color",
]);

/** CSS Color 4 system-colour keywords (lower-cased). */
const SYSTEM_COLORS = new Set([
  "accentcolor", "accentcolortext", "activetext", "buttonborder", "buttonface",
  "buttontext", "canvas", "canvastext", "field", "fieldtext", "graytext",
  "highlight", "highlighttext", "linktext", "mark", "marktext", "selecteditem",
  "selecteditemtext", "visitedtext",
]);

/**
 * The name and body of a value that is exactly ONE function call, else null.
 * `light-dark(a, b)` qualifies; `0 0 2px color-mix(...)` and
 * `color-mix(...) 10%` do not.
 */
function wholeCall(value: string): { name: string; body: string } | null {
  const m = value.match(/^([a-zA-Z][\w-]*)\(/);
  if (m === null) return null;
  let depth = 0;
  for (let i = m[1].length; i < value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return i === value.length - 1
          ? { name: m[1].toLowerCase(), body: value.slice(m[1].length + 1, i) }
          : null;
      }
    }
  }
  return null;
}

/**
 * The colour-valued syntax a value uses that the parser is documented not to
 * read, or null when the value is not one (a length, a font stack, anything
 * else). Callers only ask about values the resolver already classed `non-color`.
 */
export function unreadColorSyntax(value: string): string | null {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower === "currentcolor") return "currentColor";
  if (SYSTEM_COLORS.has(lower)) return "system-color";
  const call = wholeCall(v);
  if (call === null) return null;
  if (call.name === "light-dark") return "light-dark";
  if (call.name === "color-mix") return "color-mix";
  const body = call.body.trim();
  if (RELATIVE_FUNCTIONS.has(call.name) && /^from(?:\s|$)/i.test(body)) {
    return "relative-color";
  }
  if (call.name === "color") {
    const space = body.match(/^(--?[a-z][\w-]*|[a-z][\w-]*)/i)?.[1]?.toLowerCase();
    if (space !== undefined && space !== "srgb") return `color(${space})`;
  }
  return null;
}

/**
 * Every `non-color` token, in every theme, whose value is colour-valued syntax
 * the colour rules do not read. Themes in the resolver's order, tokens by name
 * within a theme. A token a theme inherits from `:root` is listed under that
 * theme too: the theme receives it, and the colour rules did not read it there
 * either.
 */
export function unreadColorsReport(resolved: ResolvedStylesheet): readonly UnreadColor[] {
  const rows: UnreadColor[] = [];
  for (const theme of resolved.themes) {
    const tokens = [...resolved.tokensFor(theme)].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const token of tokens) {
      if (token.kind !== "non-color" || token.resolvedValue === null) continue;
      const syntax = unreadColorSyntax(token.resolvedValue);
      if (syntax === null) continue;
      rows.push({
        theme,
        token: token.name,
        syntax,
        line: token.line,
        declaration: token.origin,
        ...(token.importOrigin !== undefined ? { importOrigin: token.importOrigin } : {}),
      });
    }
  }
  return rows;
}

/** Each theme's token total, for the report's per-theme headline. */
export function themeTokenTotals(resolved: ResolvedStylesheet): readonly UnreadColorTotals[] {
  return resolved.themes.map((theme) => ({
    theme,
    total: resolved.tokensFor(theme).length,
  }));
}

