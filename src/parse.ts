/**
 * CSS custom-property parser.
 *
 * Reads the SOURCE — no browser, no framework, no CSSOM. It recognises the
 * three declaration shapes themeguard's scope names:
 *
 *   1. `:root { … }`                  the base scope
 *   2. `[data-theme="winter"] { … }`  a theme override scope
 *   3. `@theme inline { … }`          Tailwind v4's alias namespace
 *
 * A block's prelude is a selector LIST, so it can name more than one of these
 * at once: `:root, [data-theme="dark"] { … }` — the usual way to write "dark is
 * the default theme" — is genuinely both the base scope and the dark scope, and
 * is reported as two scopes over the same declarations.
 *
 * Anything else that declares custom properties (a component class, a
 * `@media` block) is still parsed and reported, under the scope kind `other`,
 * so nothing is silently dropped — but only the three shapes above take part
 * in theme resolution.
 *
 * This file produces DATA and nothing else. It has no opinion about whether a
 * declaration is good.
 */

/** Which of the recognised declaration shapes a block is. */
export type ScopeKind = "root" | "theme" | "theme-inline" | "other";

export interface Declaration {
  /** Custom property name, including the leading `--`. */
  readonly name: string;
  /** Declared value text, trimmed, with comments removed. */
  readonly value: string;
  /** 1-based line of the declaration in the source. */
  readonly line: number;
}

export interface Scope {
  readonly kind: ScopeKind;
  /** The selector or at-rule prelude, normalised to single spaces. */
  readonly selector: string;
  /**
   * The single selector WITHIN {@link selector} that gave this scope its kind.
   *
   * A CSS selector list is *n* selectors and a `Scope` carries one kind, so a
   * block whose prelude is `:root, [data-theme="dark"]` yields TWO scopes over
   * the same declarations — one `root`, one `theme`/`dark` — and this field is
   * what says which half each came from. For a single-selector block it is just
   * {@link selector} again.
   */
  readonly matchedSelector: string;
  /**
   * Theme name for `kind === "theme"` (e.g. `winter` from
   * `[data-theme="winter"]`), otherwise `null`.
   */
  readonly theme: string | null;
  /** 1-based line of the block's opening brace. */
  readonly line: number;
  readonly declarations: readonly Declaration[];
}

export interface Stylesheet {
  readonly scopes: readonly Scope[];
}

const DATA_THEME = /\[\s*data-theme\s*=\s*["']?([^"'\]]+)["']?\s*\]/;

/**
 * Blank out `/* … *\/` comments, preserving every byte position and newline so
 * line numbers stay true. Comment-aware parsing is not optional here: the
 * calibration stylesheet documents its own palette decisions in comments that
 * contain `--token: value` prose, and a naive line grep miscounts because of
 * them.
 */
function blankComments(css: string): string {
  let out = "";
  let i = 0;
  let inString: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (inString) {
      if (ch === "\\") {
        out += css.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let j = i; j < stop; j += 1) out += css[j] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function lineIndex(css: string): number[] {
  // offsets[i] = 1-based line number of character i, built once.
  const lines = new Array<number>(css.length + 1);
  let line = 1;
  for (let i = 0; i < css.length; i += 1) {
    lines[i] = line;
    if (css[i] === "\n") line += 1;
  }
  lines[css.length] = line;
  return lines;
}

/**
 * Split a selector LIST on its top-level commas, respecting `(`, `[` and
 * strings so `:is(a, b)` and `[title="x,y"]` stay in one piece.
 */
function splitSelectorList(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < prelude.length; i += 1) {
    const ch = prelude[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      out.push(prelude.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(prelude.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

/**
 * Remove `:not(…)` arguments before classifying.
 *
 * A negation says what an element is NOT, so the attribute inside it must not
 * decide the scope's kind. `:root:not([data-theme="winter"])` is the base scope
 * — reading `winter` out of it would file dark's declarations under the light
 * theme. This is a deliberate decision, not regex ordering: the dark-default
 * idiom `:root:not([data-theme])` classifies `root` for the same reason.
 */
function stripNegations(selector: string): string {
  let out = selector;
  for (;;) {
    const at = out.search(/:not\s*\(/i);
    if (at === -1) return out;
    let depth = 0;
    let i = out.indexOf("(", at);
    let end = -1;
    for (; i < out.length; i += 1) {
      if (out[i] === "(") depth += 1;
      else if (out[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return out.slice(0, at);
    out = out.slice(0, at) + out.slice(end + 1);
  }
}

/** Classify ONE selector (never a list — see {@link classifySelectors}). */
function classifyOne(selector: string): { kind: ScopeKind; theme: string | null } {
  const raw = selector.trim();
  if (/^@theme\b/i.test(raw)) return { kind: "theme-inline", theme: null };
  const s = stripNegations(raw);
  const themeMatch = s.match(DATA_THEME);
  if (themeMatch) return { kind: "theme", theme: themeMatch[1].trim() };
  if (/^:root\b/.test(s)) return { kind: "root", theme: null };
  return { kind: "other", theme: null };
}

/**
 * Classify a block's PRELUDE into the scopes it opens.
 *
 * A selector list is *n* selectors and a `Scope` carries one kind, so a prelude
 * that names more than one recognised shape opens more than one scope over the
 * same declarations. `:root, [data-theme="dark"] { … }` — the single most
 * common way to write "dark is the default theme" — genuinely IS both the base
 * scope and the dark theme's scope, and reporting only one of them would drop
 * the other half's tokens while throwing nothing.
 *
 * Only when NO selector in the list names a recognised shape does the block
 * collapse to a single `other` scope, so an ordinary rule stays one scope.
 */
function classifySelectors(
  prelude: string,
): { kind: ScopeKind; theme: string | null; matchedSelector: string }[] {
  const selectors = splitSelectorList(prelude);
  const matched: { kind: ScopeKind; theme: string | null; matchedSelector: string }[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    const { kind, theme } = classifyOne(selector);
    if (kind === "other") continue;
    const key = `${kind}\u0000${theme ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push({ kind, theme, matchedSelector: selector });
  }
  if (matched.length > 0) return matched;
  return [{ kind: "other", theme: null, matchedSelector: prelude }];
}

/** Split a block body on top-level `;`, respecting parens and strings. */
function splitDeclarations(body: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      out.push({ text: body.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (start < body.length) out.push({ text: body.slice(start), offset: start });
  return out;
}

function readDeclarations(
  body: string,
  bodyStart: number,
  lines: number[],
): Declaration[] {
  const decls: Declaration[] = [];
  for (const chunk of splitDeclarations(body)) {
    const trimmed = chunk.text.trim();
    if (!trimmed.startsWith("--")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const name = trimmed.slice(0, colon).trim();
    if (!/^--[\w-]+$/.test(name)) continue;
    const leading = chunk.text.length - chunk.text.trimStart().length;
    decls.push({
      name,
      value: trimmed.slice(colon + 1).trim(),
      line: lines[bodyStart + chunk.offset + leading] ?? 1,
    });
  }
  return decls;
}

/**
 * Parse a stylesheet into its custom-property-declaring scopes.
 *
 * Nested at-rules (`@media`, `@supports`, `@layer`) are recursed into, so a
 * `:root` inside a media query is found; `@theme` blocks are NOT recursed into
 * because their body is declarations, not rules.
 */
export function parseStylesheet(source: string): Stylesheet {
  const css = blankComments(source);
  const lines = lineIndex(css);
  const scopes: Scope[] = [];

  const walk = (from: number, to: number): void => {
    let i = from;
    let preludeStart = from;
    let depth = 0;
    let inString: string | null = null;
    let blockStart = -1;
    while (i < to) {
      const ch = css[i];
      if (inString) {
        if (ch === "\\") i += 1;
        else if (ch === inString) inString = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
        i += 1;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) blockStart = i;
        depth += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0 && blockStart !== -1) {
          const selector = css.slice(preludeStart, blockStart).trim().replace(/\s+/g, " ");
          const bodyStart = blockStart + 1;
          const body = css.slice(bodyStart, i);
          const matches = classifySelectors(selector);
          const isNestingAtRule =
            selector.startsWith("@") && matches[0].kind !== "theme-inline";
          if (isNestingAtRule) {
            walk(bodyStart, i);
          } else {
            const declarations = readDeclarations(body, bodyStart, lines);
            if (declarations.length > 0) {
              // One scope per recognised selector in the list: a
              // `:root, [data-theme="dark"]` block IS both scopes.
              for (const { kind, theme, matchedSelector } of matches) {
                scopes.push({
                  kind,
                  selector,
                  matchedSelector,
                  theme,
                  line: lines[blockStart] ?? 1,
                  declarations,
                });
              }
            }
          }
          preludeStart = i + 1;
          blockStart = -1;
        }
        i += 1;
        continue;
      }
      if (depth === 0 && ch === ";") {
        // A statement at-rule (`@import …;`) — nothing to collect.
        preludeStart = i + 1;
      }
      i += 1;
    }
  };

  walk(0, css.length);
  return { scopes };
}
