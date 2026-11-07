/**
 * Directory arguments: expand a positional that names a directory into the
 * stylesheets under it.
 *
 * Why the CLI does this itself: auditing a project's stylesheets from CI or a
 * pre-commit hook otherwise depends on shell glob expansion, which cmd.exe and
 * PowerShell do not perform and which quoted CI globs deliver literally.
 *
 * Rules (the README states the same):
 *   - `*.css` only, recursively, in sorted order (plain code-unit comparison
 *     of the joined paths, so the order never depends on the locale).
 *   - `node_modules` and dot-directories are skipped.
 *   - Symlinked DIRECTORIES are not followed, which rules out cycles. A
 *     symlink to a `*.css` FILE is discovered like the file it points at.
 *   - A discovered file that another discovered file imports (directly or
 *     through the closure) is a PARTIAL: its findings already arrive through
 *     the importer's closure, and auditing it alone reports the false
 *     dead-token / unresolved-reference findings the closure exists to
 *     prevent. Partials are folded into their importers and not audited as
 *     entries of their own. Files named explicitly on the command line are
 *     never folded. Two files that import each other (a cycle) are peers:
 *     neither is folded.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseStylesheet } from "./parse.js";

/** Whether `path` is a directory (following symlinks, as `readFileSync` would). */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every `*.css` file under `dir`, recursively, as `dir`-prefixed paths, sorted.
 * Throws the underlying fs error when a directory cannot be read; the CLI
 * turns that into a `cannot read` diagnostic and exit 2.
 */
export function discoverCss(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(path);
      } else if (entry.name.endsWith(".css")) {
        if (entry.isFile()) found.push(path);
        else if (entry.isSymbolicLink() && isRegularFile(path)) found.push(path);
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The files `file` imports through relative specifiers, resolved; none when unreadable. */
function relativeImports(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const dir = dirname(file);
  return parseStylesheet(text)
    .imports.filter((i) => i.specifier.startsWith("./") || i.specifier.startsWith("../"))
    .map((i) => resolve(dir, i.specifier));
}

/**
 * The subset of `candidates` that is NOT imported by another candidate, in the
 * candidates' own order, and how many were folded away. Reachability follows
 * the import edges through any file (a partial may be reached via an
 * undiscovered intermediary), reading each file at most once.
 */
export function foldPartials(candidates: readonly string[]): {
  readonly entries: string[];
  readonly folded: number;
} {
  const edges = new Map<string, string[]>();
  const edgesOf = (file: string): string[] => {
    let e = edges.get(file);
    if (e === undefined) {
      e = relativeImports(file);
      edges.set(file, e);
    }
    return e;
  };
  const reach = (from: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [...edgesOf(from)];
    while (stack.length > 0) {
      const next = stack.pop() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...edgesOf(next));
    }
    return seen;
  };

  const absolute = candidates.map((c) => resolve(c));
  const reaches = absolute.map(reach);
  const entries: string[] = [];
  let folded = 0;
  candidates.forEach((candidate, i) => {
    const me = absolute[i] as string;
    const isPartial = absolute.some(
      (other, j) =>
        j !== i &&
        other !== me &&
        (reaches[j] as Set<string>).has(me) &&
        !(reaches[i] as Set<string>).has(other),
    );
    if (isPartial) folded += 1;
    else entries.push(candidate);
  });
  return { entries, folded };
}
