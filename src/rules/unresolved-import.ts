/**
 * Rule 8 — UNRESOLVED IMPORT.
 *
 * A RELATIVE `@import` edge the loader could not follow: the file the
 * specifier names is missing or unreadable. Until this rule the follow's
 * failure was swallowed in a bare `catch { continue; }` in
 * {@link ../load.loadStylesheet}, so a stylesheet whose own composition could
 * not load audited **green** — `@import "./toens.css";` with a one-character
 * path typo printed `No findings.` and exited 0, and the tool that exists
 * precisely to judge the document said nothing about the breakage every other
 * tool in the chain reports: postcss-import/vite/webpack error on a missing
 * relative file at build time, and a browser fails the request.
 *
 * ── The fact was already travelling; only its outcome was discarded ────────
 * The audit unit is the `@import` closure (0.1.10), and the loader now records
 * every failed RELATIVE edge on the sheet it returns —
 * `Stylesheet.unresolvedImports`, accumulated across ALL frames, so an edge
 * broken two hops in is named with its own from-file. `resolveStylesheet`
 * passes the sheet through untouched, so this rule reads the list and emits
 * one finding per entry. Zero parser or resolver changes: the rule's whole
 * subject is the loader's bookkeeping.
 *
 * ── One finding per failed edge ────────────────────────────────────────────
 * The entry carries the specifier AS WRITTEN, the statement's line, the
 * containing file's entry-relative origin (`from`, absent for the entry file —
 * the Scope/Reference convention) and the file-system classification
 * (`missing` / `unreadable`), and the message names all four: what was written,
 * what the resolution found, and the consequence — the file never loads, so
 * every declaration inside it is invisible to this audit. The finding's `sites`
 * carries the import statement's own position, built with the same
 * origin-or-bare shape every rule's sites use, so a non-entry frame's
 * statement is cited BY FILE (`Declared at mid.css:2.`) and the audit's
 * directive fence holds unchanged: an entry-file `themeguard-ignore` cannot
 * silence a finding whose statement lives in another file, whose line number
 * merely coincides.
 *
 * The specifier occupies the finding's token dimension, so a config entry or a
 * `themeguard-ignore` directive can target the rule by rule id alone, or name
 * the specifier to aim at one edge: `{ rule: "unresolved-import", token:
 * "./toens.css" }`.
 *
 * ── `theme: null` — dead-token's stance ────────────────────────────────────
 * A failed edge is a fact about the FILE GRAPH the source declares, not about
 * any theme's view of it: the same edge is broken in every theme's document,
 * so one finding carries the whole fact.
 *
 * ── What an unresolved import is NOT ───────────────────────────────────────
 * Not a bare package specifier. `@import "tailwindcss"` skips at the loader's
 * relative-only gate and never reaches the file system — the specifier may
 * well resolve at build time, and reporting every bundler-handled path as a
 * defect would drown the rule in noise. The silence there is v1's fence,
 * byte-identical.
 * Not an absolute path or a URL, for the same reason.
 * Not a cycle and not a shared repeat. The visited set terminates `a` importing
 * `b` importing `a` and splices each file once BEFORE the file system is
 * consulted, so neither can produce an entry — and that is browser-matched: a
 * browser dedupes an already-applied stylesheet the same way, and the closure
 * audits. A file two edges point at is spliced once and, if it loads, no
 * finding; if it is missing, ONE finding for the first attempted edge — the
 * follow is attempted once, because the failure is a fact about the FILE, not
 * about each edge that names it.
 * Not a lint of the file graph. The rule judges the edges the SOURCE declared,
 * never files nothing imports; existence is checked only where a statement
 * asked for it.
 */

import type { ResolvedStylesheet } from "../resolve.js";
import type { Finding, FindingSite } from "./finding.js";
import { positionClause } from "./finding.js";

export function unresolvedImportRule(resolved: ResolvedStylesheet): Finding[] {
  const unresolved = resolved.stylesheet.unresolvedImports ?? [];
  const findings: Finding[] = [];
  for (const edge of unresolved) {
    // The statement's own position, in the origin-or-bare convention every
    // rule's sites share: the import statement is declared in the file `from`
    // names, at `line` within it — cited by file for a non-entry frame, bare
    // for the entry file, exactly as `positionClause` renders either.
    const site: FindingSite =
      edge.from === undefined
        ? { name: edge.specifier, line: edge.line }
        : { name: edge.specifier, line: edge.line, origin: edge.from };
    const outcome =
      edge.code === "missing"
        ? "no file exists at the path it names"
        : "the path it names exists but could not be read";
    findings.push({
      rule: "unresolved-import",
      theme: null,
      tokens: [edge.specifier],
      message:
        `@import "${edge.specifier}" — ${outcome}. The import never loads, ` +
        `so every declaration inside it is invisible to this audit. ` +
        `${positionClause([site])}`,
      evidence: {
        specifier: edge.specifier,
        code: edge.code,
        line: edge.line,
        ...(edge.from !== undefined ? { from: edge.from } : {}),
      },
      sites: [site],
    });
  }
  return findings;
}
