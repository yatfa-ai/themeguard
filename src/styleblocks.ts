/**
 * Style-block extraction for component and markup files.
 *
 * A `.vue` / `.svelte` / `.astro` / `.html` / `.htm` file is not CSS: its
 * stylesheet lives inside `<style>` elements, and parsing the whole file as
 * CSS folds the surrounding markup into a selector prelude, recognises no
 * scope, collects no token and reports a silent green. {@link extractStyleBlocks}
 * turns such a file into ordinary CSS TEXT of the SAME LENGTH — everything
 * outside the CSS `<style>` bodies replaced by spaces, every newline (and
 * carriage return) kept — so every line and column a finding cites matches the
 * file the author opens. The rest of the pipeline sees plain CSS.
 *
 * A style block whose preprocessor is not CSS (`lang="scss|sass|less|stylus|styl"`,
 * or a `type` other than `text/css`) is not parsed — evaluating it is out of
 * scope — and is counted in `skipped` so the caller can say so instead of
 * auditing it as CSS.
 */

import { extname } from "node:path";

/** Extensions whose `<style>` blocks are audited when the file is named. */
export const HOST_EXTENSIONS: readonly string[] = [".vue", ".svelte", ".astro", ".html", ".htm"];

/** The `lang` values that name a preprocessor, not CSS. */
const NON_CSS_LANGS = new Set(["scss", "sass", "less", "stylus", "styl"]);

export interface StyleBlocks {
  /** Same length as the input; CSS block bodies kept, everything else blanked. */
  readonly text: string;
  /** Count of `<style>` blocks whose body was kept as CSS. */
  readonly css: number;
  /** The `lang`/`type` spellings of blocks left unparsed because they are not CSS. */
  readonly skipped: readonly string[];
}

/** Whether `path` names a host file whose `<style>` blocks must be extracted. */
export function isHostFile(path: string): boolean {
  return HOST_EXTENSIONS.includes(extname(path).toLowerCase());
}

/** The value of attribute `name` in a start tag's attribute text, or `undefined`. */
function attribute(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  if (m === null) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** Blank every character except line terminators. */
function blank(s: string): string {
  return s.replace(/[^\r\n]/g, " ");
}

/**
 * Extract the CSS `<style>` bodies of a host file's text. HTML comments are
 * skipped whole (a commented-out `<style>` is not a stylesheet), a `<style>`
 * tag may carry attributes (`scoped`, `lang`, `media`, `is:global`), and the
 * body runs to the first `</style>`, as HTML defines raw text.
 */
export function extractStyleBlocks(text: string): StyleBlocks {
  const token = /<!--[\s\S]*?(?:-->|$)|<style\b((?:"[^"]*"|'[^']*'|[^>"'])*)>([\s\S]*?)(?:<\/style\s*>|$)/gi;
  let out = "";
  let cursor = 0;
  let css = 0;
  const skipped: string[] = [];
  for (let m = token.exec(text); m !== null; m = token.exec(text)) {
    if (m[0].startsWith("<!--")) continue;
    const attrs = m[1] ?? "";
    const body = m[2] ?? "";
    const bodyStart = m.index + "<style".length + attrs.length + 1;
    const lang = attribute(attrs, "lang")?.trim().toLowerCase();
    const type = attribute(attrs, "type")?.trim().toLowerCase();
    const nonCss =
      (lang !== undefined && NON_CSS_LANGS.has(lang)) ||
      (type !== undefined && type !== "" && type !== "text/css");
    out += blank(text.slice(cursor, bodyStart));
    if (nonCss) {
      skipped.push(lang !== undefined && NON_CSS_LANGS.has(lang) ? `lang="${lang}"` : `type="${type}"`);
      out += blank(body);
    } else {
      css++;
      out += body;
    }
    cursor = bodyStart + body.length;
  }
  out += blank(text.slice(cursor));
  return { text: out, css, skipped };
}
