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
 *     The silence here is byte-identical to v1 and stays: no bundler, build
 *     step or browser resolves a bare specifier from the source tree, so
 *     recording a failure would report every bundler-handled path as a defect.
 *   - A missing or unreadable RELATIVE target is skipped — but no longer
 *     silently. The failure was swallowed in a bare `catch { continue; }`, so
 *     a stylesheet whose own composition could not load audited green: the
 *     audit unit IS the import closure (since the splice below), and a failed
 *     edge breaks the unit's own composition. Each frame now records its
 *     failed relative edges on the sheet it returns — `UnresolvedImport`,
 *     with the specifier as written, the statement's line, the containing
 *     file's entry-relative origin, and the file-system classification
 *     (`missing` / `unreadable`) — and the eighth rule judges that list. This
 *     is loader bookkeeping, not a new cross-file theory: the tool still
 *     invents nothing, it reads the edge the source declared and reports that
 *     the file it names never loads. Every bundler and every browser notices
 *     this failure; the silence was the outlier. What stays fenced: the audit
 *     judges colour organisation, and the RULE judges the edge the source
 *     wrote — it does not lint the file graph (no existence check of files
 *     nothing imports), and bare/absolute/URL silence is unchanged.
 *   - A repeated edge is skipped: the visited set of resolved paths terminates
 *     cycles (`a` imports `b` imports `a`) and de-duplicates shared imports
 *     (two sheets importing one tokens file splice it once), matching how a
 *     browser de-duplicates a stylesheet already applied. A cycle edge never
 *     reaches the file system, so it is never recorded as a failure either —
 *     a browser dedupes the applied sheet the same way, and the closure
 *     audits.
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
 * One stamp per item, and it names the file the item was WRITTEN in: a file
 * two hops in is stamped by its own edge, never overwritten by an outer
 * edge's target — a citation that names a file but points at someone else's
 * declaration carries false authority, which is worse than a bare number.
 *
 * ── Directives ─────────────────────────────────────────────────────────────
 * The same frames that stamp origins also scan each member's text for
 * `/* themeguard-ignore … *\/` directives, because since 0.1.19 the
 * judgement written IN a file must reach the audit that reads the file over
 * an `@import` — before this, a directive one import edge away was silently
 * discarded, which falsified the one property the feature documents as its
 * reason to exist (the judgement travels with the file into vendored,
 * regenerated or forked copies — and since 0.1.10 the ordinary way a vendored
 * file is consumed is by being imported). Each frame scans its OWN text
 * before following any edge, and stamps its own entries with that frame's
 * `from` — the entry file's entries carry none, exactly as the entry-only
 * scan left them, so matching stays byte-identical for every entry-file
 * judgement. The visited set splices each member once, so each member's text
 * is scanned exactly once and a directive cannot be double-counted; a member
 * the loader never loads (a bare specifier, an absolute path, a URL) has no
 * text here to scan and contributes no directives BY CONSTRUCTION — the
 * standing import fence, not a new rule. The scan lives with the load so a
 * caller of {@link loadStylesheet} gets the closure's judgements in one
 * return: the audit unit is the closure, and now its suppression ledger is
 * too.
 *
 * One stamp per directive, same as the items above: a child's entries arrive
 * already stamped by the frame that scanned them, and the splice re-stamps
 * nothing (the `origin === undefined` guard below is the same belt the
 * scopes and references wear). And an unhonourable directive is NOT a failed
 * edge: the edge-classifying catch below rethrows {@link DirectiveError}
 * untouched, so a malformed comment in any member exits 2 naming ITS file
 * and line — config's never-silently-ignored discipline, one edge wider —
 * instead of wearing an `unresolved-import` finding's clothes.
 *
 * An unreadable ENTRY file throws — that is the caller's error to render (the
 * CLI already turns it into exit 2 with the path named), and swallowing it
 * here would audit nothing and call it a pass.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { DirectiveError, scanIgnoreDirectives, type IgnoreDirective } from "./directives.js";
import {
  parseStylesheet,
  type Scope,
  type Stylesheet,
  type Reference,
  type UnresolvedImport,
} from "./parse.js";

/**
 * Read `entryPath`, follow the `@import` edges its text declares, and return
 * the closure as one {@link Stylesheet} — entry scopes and references in
 * their own order, each followed file's spliced in at its statement, every
 * spliced item carrying its `origin`, every failed RELATIVE edge carried
 * on `unresolvedImports`, and every member's `themeguard-ignore` directives
 * carried on `directives`, each imported member's stamped with its
 * entry-relative origin. Throws {@link DirectiveError} for an unhonourable
 * directive in ANY member — the caller's exit-2, never a silent skip.
 */
export function loadStylesheet(entryPath: string): Stylesheet {
  const entryAbsolute = resolve(entryPath);
  const entryDir = dirname(entryAbsolute);
  // Resolved ABSOLUTE paths, not specifiers: `./x.css` and `../dir/x.css` can
  // name one file, and the guard must not splice it twice — and a cycle must
  // terminate on the FILE, whatever route the statements take to reach it.
  const visited = new Set<string>([entryAbsolute]);

  const load = (filePath: string): Stylesheet => {
    const text = readFileSync(filePath, "utf8");
    const sheet = parseStylesheet(text);
    // Imported content FIRST, the file's own second. Every collected `@import`
    // precedes the first qualified rule (the parser collects nothing later),
    // so browser order — imported rules, then the author's — is exactly this
    // prefix shape, and it is what makes the importing file's own
    // re-declaration of an imported name win: the resolver's root fold takes
    // the LAST declaration in array order.
    const scopes: Scope[] = [];
    const references: Reference[] = [];
    const unresolvedImports: UnresolvedImport[] = [];
    const directives: IgnoreDirective[] = [];
    const fileDir = dirname(filePath);
    // This frame's own entry-relative origin, in the Scope/Reference spelling:
    // absent for the entry file, the normalized relative path for anything
    // spliced in. Failed edges are recorded against the file whose text
    // carries the statement — the same one-stamp-per-item discipline as the
    // origin below, so an edge broken two hops in is named with its own
    // from-file, never with an outer edge's target.
    const from = filePath === entryAbsolute ? undefined : relative(entryDir, filePath);

    // THIS member's own directives, scanned before any edge is followed: the
    // entry file's malformed comment is reported before its imports are even
    // read, the same order the CLI's entry-only scan had before the scan
    // moved in here. The diagnostic spelling keeps the entry's caller-named
    // path (byte-identical to that scan) and names a closure member by its
    // entry-relative origin — the coordinate the report's citations and the
    // entry's own `source` clause use. The origin rides on every entry as
    // the MATCHING half: an entry-file judgement carries none and matches
    // entry sites only, a member's judgement carries its own file and can
    // never reach across an edge — the line-coincidence fence, now exact
    // instead of blanket.
    directives.push(
      ...scanIgnoreDirectives(text, from ?? entryPath, from),
    );

    for (const imp of sheet.imports) {
      // v1 fence, restated: relative specifiers only. `./` and `../` are the
      // two prefixes that say "a file of this project, at a path relative to
      // mine"; anything else is a package (or an absolute path, or a URL) and
      // is skipped, not guessed at — and never reaches the file system, so a
      // failed follow can only ever be a relative edge's.
      if (!imp.specifier.startsWith("./") && !imp.specifier.startsWith("../")) continue;
      const target = resolve(fileDir, imp.specifier);
      if (visited.has(target)) continue; // cycle, or shared import: splice once
      visited.add(target);
      let child: Stylesheet;
      try {
        child = load(target);
      } catch (err) {
        // An unhonourable directive in the child's text is NOT a failed edge:
        // it keeps config's never-silently-ignored contract and propagates as
        // the caller's exit 2, naming the comment's own file and line — it
        // must not be reclassified below as an `unreadable` import and
        // reported as a finding.
        if (err instanceof DirectiveError) throw err;
        // Missing or unreadable RELATIVE import target — recorded, never
        // silent: the closure is the audit unit, and this failed edge breaks
        // its own composition. `missing` is the file system's ENOENT; anything
        // else that threw reading it (a directory, a permission) is
        // `unreadable`. The skip itself is unchanged — this frame's splice
        // simply proceeds without the child — and the eighth rule turns the
        // record into the finding.
        const code =
          (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? "missing" : "unreadable";
        unresolvedImports.push({
          specifier: imp.specifier,
          line: imp.line,
          ...(from !== undefined ? { from } : {}),
          code,
        });
        continue;
      }
      // Normalized relative to the ENTRY file, so every origin in one audit
      // shares one coordinate system: `tokens.css`, `shared/props.css`, from
      // however many hops deep the statement was written.
      const origin = relative(entryDir, target);
      // Stamp ONLY what lacks an origin. `child` is the child's ENTIRE
      // closure — scopes spliced in from the child's OWN imports already
      // carry their correct entry-relative origins, stamped by their own
      // recursive frame, and an unconditional spread would overwrite every
      // deeper one with THIS edge's target, citing any item two or more hops
      // in with the wrong file. `parse` sets no origin and nothing else
      // stamps one, so `origin === undefined` selects exactly the child's
      // own items: one stamp per item, naming the file the item was written
      // in.
      scopes.push(
        ...child.scopes.map((s) => (s.origin === undefined ? { ...s, origin } : s)),
      );
      references.push(
        ...child.references.map((r) => (r.origin === undefined ? { ...r, origin } : r)),
      );
      // The child's own failed edges travel with the child: they are failures
      // of THIS closure too, and merging here keeps the final list in
      // statement order — a child's breakage lands where its edge was
      // written, this frame's own failures where theirs were.
      unresolvedImports.push(...(child.unresolvedImports ?? []));
      // The child's directives travel with the child, under the same
      // one-stamp discipline as the scopes and references above: the map
      // touches only entries still missing an origin. Every frame stamps its
      // own text at scan time, so nothing arrives unstamped today and the
      // map is a pass-through — it is the guard that keeps any future
      // change from re-stamping a deeper frame's directive with THIS edge's
      // target.
      directives.push(
        ...(child.directives ?? []).map((d) =>
          d.origin === undefined ? { ...d, origin } : d,
        ),
      );
    }

    scopes.push(...sheet.scopes);
    references.push(...sheet.references);

    // The entry's OWN import list travels with the sheet: it is what the file
    // declares, even where a statement was skipped — the record of the edges
    // the audit saw and chose not to follow. Beside it, the failed relative
    // follows of the whole closure: the record of the edges the audit tried
    // and could not.
    return {
      scopes,
      references,
      imports: sheet.imports,
      unresolvedImports,
      directives,
    };
  };

  return load(entryAbsolute);
}
