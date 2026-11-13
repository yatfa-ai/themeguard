/**
 * The one lexer for `/* … *\/` comments in a stylesheet.
 *
 * Two modules need to know where the comments are — the parser blanks them
 * so their prose cannot be read as declarations, and the directive scanner
 * reads their bodies for `themeguard-ignore`. They must agree on what IS a
 * comment, so the walk lives here once; each caller decides only what to do
 * with a span. This module knows nothing of directives or parsing and must
 * not import from either.
 *
 * The reading:
 *
 * - A CSS string (`"…"` or `'…'`) hides comment openers: `content: "/* x *\/"`
 *   holds prose, not a comment. A string closes on the same quote character;
 *   it is NOT ended by a newline.
 * - Inside a string a backslash escapes the next character (two characters
 *   are skipped), so `\"` does not close it.
 * - Outside a string, `/*` opens a comment and the next `*\/` after the
 *   opener closes it (`/*\/` is therefore not a complete comment).
 * - An unterminated comment runs to end of input; the stylesheet is already
 *   broken on its own terms. An unterminated string simply swallows the rest
 *   of the input, so no further comment is found.
 */

/** One comment: offsets into the scanned text. */
export interface CommentSpan {
  /** Offset of the opening `/`. */
  start: number;
  /** Offset just past the comment: past the closing `*\/`, or `css.length` if unterminated. */
  end: number;
  /** Offset where the body stops: at the closing `*\/`, or `css.length` if unterminated. */
  bodyEnd: number;
}

/** Every comment in `css`, in source order. */
export function commentSpans(css: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let i = 0;
  let inString: string | null = null;
  while (i < css.length) {
    const ch = css[i];
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      i += 1;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const end = close === -1 ? css.length : close + 2;
      spans.push({ start: i, end, bodyEnd: close === -1 ? css.length : close });
      i = end;
      continue;
    }
    i += 1;
  }
  return spans;
}
