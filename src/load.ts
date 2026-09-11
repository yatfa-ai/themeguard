/**
 * Load a stylesheet AND its `@import` closure as one audit unit.
 *
 * CSS's composition unit is the import closure; the audit's unit was one FILE,
 * and rule 5 (`unresolved-reference`) turned that mismatch from a silent
 * limitation into a false-positive producer. On the standard layout — tokens in
 * a base file, components in other sheets, one composing file importing them —
 * the composing file reported every imported token as an unresolved reference,
 * and each imported file reported its own tokens as dead that the composing
 * sheet's `var()`s reach through the very edge this module follows. Each file's
 * audit lied about the other, and the standing remedy — suppressing the name —
 * was worse than the defect: it blinded the tool to that exact name forever,
 * so when the import LATER genuinely drops the token, the now-real broken
 * reference stays silent.
 *
 * Following the edge is the honest fix, because unlike every other cross-file
 * relationship, composition by `@import` is DECLARED IN SOURCE. The tool
 * invents nothing: CSS defines the semantics — an `@import` splices the target
 * into the sheet at the statement's position, so the imported declarations
 * apply and the imported names are declared — and this module reads that
 * declaration and merges the two files exactly as a browser would. What stays
 * deliberately OUT of scope is every cross-file relationship nobody declared:
 * a CLI argument set (the files' relationship is unknown), a bundler's virtual
 * sheet, a sibling file with no import edge. Those are fenced as before; this
 * module only follows what the source states.
 *
 * ── What is followed, and what is skipped ──────────────────────────────────
 * Only RELATIVE specifiers are followed — `./x.css`, `../shared/x.css`, in
 * either the quoted or the `url()` spelling — resolved against the directory
 * of the file whose text carries the statement. Everything else is skipped,
 * and each skip is a decision:
 *
 *   - A bare specifier (`@import "tailwindcss"`, `@import
 *     "xterm/css/xterm.css"`) names a PACKAGE, and package resolution needs
 *     `node_modules` walking and an exports-map reading that a source-read
 *     audit does not pretend to have. Skipped — the specifier may well resolve
 *     at build time, and guessing at it could follow a file nothing applies.
 *   - A missing or unreadable target is skipped SILENTLY: an
 *     import-resolution failure is not a finding. The audit judges colour
 *     organisation, not the integrity of the file graph, and a rule for
 *     missing files would report every bundler-handled path as a defect.
 *   - A repeated edge is skipped: the visited set of resolved paths terminates
 *     cycles (`a` imports `b` imports `a`) and de-duplicates shared imports
 *     (two sheets importing one tokens file splice it once), matching how a
 *     browser de-duplicates a stylesheet already applied.
 *
 * A media suffix does not stop a follow (`@import url("./x.css") screen;` is
 * followed like any other) — consistent with the parser's unconditional
 * `@media` treatment everywhere else.
 *
 * ── Splice order, and why it is a prefix ───────────────────────────────────
 * Imported scopes and references are spliced in statement order BEFORE the
 * importing file's own, and the origin of every spliced item records which
 * file it came from. The prefix shape follows from CSS's own legality rule:
 * an `@import` is only live before the first qualified rule, so every honored
 * statement precedes the importing file's rules and browser order — imported
 * rules first, author's rules after — is exactly what the merged array says.
 * That order is what makes the importing file's own re-declaration of an
 * imported name win, which is the cascade's answer.
 *
 * ── Origin ─────────────────────────────────────────────────────────────────
 * Each spliced `Scope` and `Reference` carries `origin`: the target's path
 * relative to the ENTRY file, normalized (`tokens.css`, `shared/props.css`).
 * Rules render it in place of `selector:line` for such sites —
 * `declared at tokens.css:2` — because a bare line number would point the
 * reader into the wrong file. Entry-file sites carry no origin and render
 * byte-identically to before, so no existing report changes unless an import
 * was actually followed.
 *
 * An unreadable ENTRY file throws — that is the caller's error to render (the
 * CLI already turns it into exit 2 with the path named), and swallowing it
 * here would audit nothing and call it a pass.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseStylesheet, type Scope, type Stylesheet, type Reference } from "./parse.js";

/**
 * Read `entryPath`, follow the `@import` edges its text declares, and return
 * the closure as one {@link Stylesheet} — entry scopes and references in
 * their own order, each followed file's spliced in at its statement, every
 * spliced item carrying its `origin`.
 */
export function loadStylesheet(entryPath: string): Stylesheet {
  const entryAbsolute = resolve(entryPath);
  const entryDir = dirname(entryAbsolute);
  // Resolved ABSOLUTE paths, not specifiers: `./x.css` and `../dir/x.css` can
  // name one file, and the guard must not splice it twice — and a cycle must
  // terminate on the FILE, whatever route the statements take to reach it.
  const visited = new Set<string>([entryAbsolute]);

  const load = (filePath: string): Stylesheet => {
    const sheet = parseStylesheet(readFileSync(filePath, "utf8"));
    // Imported content FIRST, the file's own second. Every collected `@import`
    // precedes the first qualified rule (the parser collects nothing later),
    // so browser order — imported rules, then the author's — is exactly this
    // prefix shape, and it is what makes the importing file's own
    // re-declaration of an imported name win: the resolver's root fold takes
    // the LAST declaration in array order.
    const scopes: Scope[] = [];
    const references: Reference[] = [];
    const fileDir = dirname(filePath);

    for (const imp of sheet.imports) {
      // v1 fence, restated: relative specifiers only. `./` and `../` are the
      // two prefixes that say "a file of this project, at a path relative to
      // mine"; anything else is a package (or an absolute path, or a URL) and
      // is skipped, not guessed at.
      if (!imp.specifier.startsWith("./") && !imp.specifier.startsWith("../")) continue;
      const target = resolve(fileDir, imp.specifier);
      if (visited.has(target)) continue; // cycle, or shared import: splice once
      visited.add(target);
      let child: Stylesheet;
      try {
        child = load(target);
      } catch {
        // Missing or unreadable import target — NOT a finding. Skip silently:
        // the audit judges colour organisation, not file-graph integrity.
        continue;
      }
      // Normalized relative to the ENTRY file, so every origin in one audit
      // shares one coordinate system: `tokens.css`, `shared/props.css`, from
      // however many hops deep the statement was written.
      const origin = relative(entryDir, target);
      scopes.push(...child.scopes.map((s) => ({ ...s, origin })));
      references.push(...child.references.map((r) => ({ ...r, origin })));
    }

    scopes.push(...sheet.scopes);
    references.push(...sheet.references);

    // The entry's OWN import list travels with the sheet: it is what the file
    // declares, even where a statement was skipped — the record of the edges
    // the audit saw and chose not to follow.
    return { scopes, references, imports: sheet.imports };
  };

  return load(entryAbsolute);
}
