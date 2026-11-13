/**
 * CSS custom-property parser.
 *
 * Reads the SOURCE — no browser, no framework, no CSSOM. It recognises the
 * four declaration shapes themeguard's scope names:
 *
 *   1. `:root { … }`                  the base scope
 *   2. `[data-theme="winter"] { … }`  a theme override scope
 *   3. `@theme inline { … }`          Tailwind v4's alias namespace
 *   4. `@media (prefers-color-scheme: dark) { :root { … } }`
 *                                     an OS-preference palette — its own
 *                                     theme beside the base, never folded
 *                                     into it; the condition travels on the
 *                                     scope ({@link Scope.colorScheme})
 *
 * A fifth spelling of the dark/light scopes is the class form — `.dark`,
 * `html.dark`, `body.dark`, `:root.dark` (and `.light`) — read as the `dark` /
 * `light` theme; see {@link classThemeOf}. Class names beyond that pair are
 * themes only when a caller configures them ({@link ParseOptions.themes} —
 * `themeguard.config.json`'s `themes` key); see {@link unrecognisedClassTheme}
 * for the loader's half of that story. Likewise attribute names beyond
 * `data-theme` / `data-bs-theme` are theme attributes only when configured
 * ({@link ParseOptions.themeAttributes}, the `themeAttributes` key); see
 * {@link unrecognisedAttributeThemes}.
 *
 * A block's prelude is a selector LIST, so it can name more than one of these
 * at once: `:root, [data-theme="dark"] { … }` — the usual way to write "dark is
 * the default theme" — is genuinely both the base scope and the dark scope, and
 * is reported as two scopes over the same declarations.
 *
 * Anything else that declares custom properties (a component class, a `@media`
 * block conditioning on anything but one colour-scheme feature) is still parsed
 * and reported — under the scope kind `other`, or as a `root` scope when the
 * block is a `:root` — so nothing is silently dropped. Only the four shapes
 * above take part in theme resolution, and the fourth as its OWN theme: the old
 * reading folded a conditioned `:root` into the base table, overwriting the
 * light palette with the dark one. A `:root` under a media condition this file
 * does not model (a comma query list, a second feature, a non-screen type) still
 * folds into the base — a stated limit, not a silent one; see
 * {@link colorSchemeOf}.
 *
 * A block BODY is parsed depth-aware, because since CSS Nesting a body is
 * declarations AND nested rules, and a nested rule's declarations belong to a
 * DIFFERENT subject. Read flat, a `;` written inside a nested rule ends one of
 * the ENCLOSING block's declarations — so the nested value is filed under the
 * enclosing scope, and the nested rule's leftover prelude then absorbs the
 * declaration after its closing brace, dropping it outright. Both failures are
 * silent, and together they can report an ABSENCE that the stylesheet
 * contradicts. So a nested region is taken out of its enclosing block by
 * {@link blankNestedBlocks} and walked separately, its prelude resolved against
 * the parent by {@link resolveNestedSelector} and then classified by exactly the
 * same subject rule a top-level selector gets — `&[data-theme="winter"]` inside
 * `:root` IS the winter scope, and `.card` inside `:root` is `other`, which is
 * what their flat equivalents already resolve to. Nesting is a way of WRITING a
 * selector, never a different selector.
 *
 * A selector names a scope only when it IS that scope, never when it merely
 * CONTAINS one. `[data-theme="winter"] .code-block` is a component inside the
 * winter theme, not the winter theme, and its declarations belong to `other` —
 * merging them into winter's table would report a token narrowed to one subtree
 * as that theme's value everywhere. `html:has([data-theme="winter"])` merely
 * contains one too, by a different route: a functional pseudo-class's argument
 * names some other element, so it cannot classify the subject either. Conversely
 * `:is(:root, [data-theme="dark"])` IS both scopes, so the functional
 * pseudo-classes that only group selectors are looked through.
 * See {@link classifyOne}.
 *
 * This file produces DATA and nothing else. It has no opinion about whether a
 * declaration is good.
 *
 * Alongside the scopes it collects every `var()` USE, from EVERY declaration
 * rather than only from the custom-property ones — see {@link Reference}. A
 * token can be used by an ordinary property in a block that declares no custom
 * property at all, which produces no `Scope`; reading uses out of declaration
 * values alone therefore reports such a token as referenced by nothing, which
 * is a false statement about the stylesheet rather than a judgement call.
 */

import { commentSpans } from "./comments.js";
import type { IgnoreDirective } from "./directives.js";

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
  /**
   * The `prefers-color-scheme` value of the nearest enclosing conditional
   * at-rule, on the root scopes that condition applies to — `dark` or `light`.
   * Absent when no such at-rule encloses the block, and set on `kind ===
   * "root"` scopes only: a conditioned `:root` is NOT a cascade over the base
   * (both blocks are live, selected by the OS setting), so the resolver reads
   * this field and builds each value its own theme beside the base instead of
   * folding the conditioned declarations into it.
   *
   * Deliberately NOT recognised: any media prelude whose condition is more
   * than the one feature — a comma query list (an OR of conditions), a second
   * feature (`… and (min-width: …)`), or a non-screen media type — and no
   * other at-rule (`@supports`, `@layer`) conditions a palette. Those keep the
   * unconditional reading: today's behaviour, stated as a limit rather than a
   * silent guess. See {@link colorSchemeOf}.
   */
  readonly colorScheme?: "dark" | "light";
  /**
   * The imported file this scope was spliced from — the target's path relative
   * to the audit's ENTRY file, normalized (`tokens.css`, `shared/props.css`) —
   * set by {@link loadStylesheet} on everything it follows an `@import` edge
   * to, and ABSENT on a scope read from the entry file itself. The absence is
   * load-bearing: every site string a rule renders (`selector:line`) keys on
   * it, so root-file output stays byte-identical whether or not any import was
   * followed.
   */
  readonly origin?: string;
  /** 1-based line of the block's opening brace. */
  readonly line: number;
  readonly declarations: readonly Declaration[];
}

/**
 * One `var(--name)` USE, anywhere in the stylesheet.
 *
 * Kept separately from {@link Scope} because a use and a declaration live in
 * different places: `--sidebar-width` is declared in `:root` and used by
 * `width: var(--sidebar-width)` on a component class that declares no custom
 * property at all, so the block carrying the use produces no `Scope`.
 *
 * Collecting only the uses written in custom-property VALUES — which is all a
 * scope's declarations can tell you — makes exactly those uses invisible, and
 * over this project's own calibration fixture that is the difference between 9
 * apparently-unreferenced tokens and the 2 that are genuinely unreferenced:
 * `--font-family`, `--sidebar-width` and `--app-focus-ring-width` are each
 * used, and used only by an ordinary property.
 *
 * This is still DATA. Nothing here decides that an unreferenced token is a
 * defect, and the uses are reported whether or not anything declares the name.
 */
export interface Reference {
  /** The custom property being referenced, including the leading `--`. */
  readonly name: string;
  /**
   * The property whose value contains the `var()` — `width`, `color`, or
   * another custom property's name when one token is defined in terms of
   * another.
   */
  readonly property: string;
  /** The full declared value text the `var()` was read from. */
  readonly value: string;
  /** The selector or at-rule prelude of the block containing the use. */
  readonly selector: string;
  /**
   * The kinds {@link parseStylesheet} classified that block's prelude as. A
   * list because a prelude is a selector list: `:root, [data-theme="dark"]` is
   * genuinely two scopes, and a use written there belongs to both.
   */
  readonly kinds: readonly ScopeKind[];
  /** 1-based line of the declaration the use was written in. */
  readonly line: number;
  /**
   * The imported file this use was spliced from — same contract as
   * {@link Scope.origin}: set by {@link loadStylesheet} on references that
   * arrived over an `@import` edge, absent on the entry file's own.
   */
  readonly origin?: string;
}

/**
 * One honored `@import` statement: where it points, and where it was written.
 *
 * COLLECTED, never followed — following is {@link loadStylesheet}'s job. The
 * parser has the position information (an `@import` is only live before the
 * first qualified rule) and no file system; the loader has the file system and
 * no position information. Each does its half.
 */
export interface StylesheetImport {
  /**
   * The URL exactly as written — quotes or a `url(…)` wrapper stripped, any
   * media query after it dropped, no resolution attempted. `./tokens.css`,
   * `tailwindcss`, `xterm/css/xterm.css` are all collected as written; telling
   * a relative edge from a package specifier is the LOADER's decision, and
   * needs the raw text.
   */
  readonly specifier: string;
  /** 1-based line of the `@import` statement. */
  readonly line: number;
}

/**
 * A RELATIVE `@import` edge the loader FAILED to follow, as recorded by
 * {@link loadStylesheet} — the follow's outcome, never silently discarded.
 *
 * Only relative specifiers (`./x.css`, `../shared/x.css`) can arrive here:
 * bare package specifiers, absolute paths and URLs are skipped by the loader's
 * standing fence and never reach the file system, so they are never recorded.
 * One entry per failed EDGE, in the order the statements were attempted — an
 * edge broken two hops in is recorded by the frame whose text carries it, with
 * {@link from} naming that file.
 */
export interface UnresolvedImport {
  /** The specifier exactly as written — quotes or a `url(…)` wrapper stripped, no resolution attempted. */
  readonly specifier: string;
  /** 1-based line of the `@import` statement, in the file named by {@link from}. */
  readonly line: number;
  /**
   * The file whose text carries the statement, relative to the audit's entry
   * file — the same spelling Scope/Reference `origin` writes. Absent when that
   * file is the entry itself.
   */
  readonly from?: string;
  /**
   * Why the follow failed: `"missing"` — nothing exists at the path the
   * specifier names (the file system's ENOENT) — or `"unreadable"` — the path
   * exists but could not be read (a directory, a permission). The distinction
   * is the reader's first diagnostic: a missing file is a typo or an uncommitted
   * file; an unreadable one is the right path with the wrong thing in it.
   */
  readonly code: "missing" | "unreadable";
}

/**
 * An `@property --name { … }` registration, as written — the CSS Properties
 * and Values API's way of giving a custom property a type and, optionally, an
 * initial value. Collected where {@link parseStylesheet} finds the block: top
 * level, or nested in `@layer` / `@media` / `@supports`.
 *
 * A registration is NOT a scope: its body carries `syntax:` / `inherits:` /
 * `initial-value:` descriptors, not `--` declarations, so it contributes no
 * {@link Scope} and no token row. What it contributes is one fact the rules
 * need — a registered property WITH an initial value always resolves — read
 * through {@link registeredInitialValues}, which also applies CSS's own
 * validity rule. Every field here is the descriptor as written (quotes stripped
 * from `syntax`), so a malformed registration is recorded faithfully and
 * judged in one place.
 */
export interface Registration {
  /** The registered custom property, e.g. `--brand`. */
  readonly name: string;
  /** 1-based line of the `@property` prelude. */
  readonly line: number;
  /** The `syntax` descriptor with its quotes stripped (`<color>`, `*`), if written and non-empty. */
  readonly syntax?: string;
  /** The `inherits` descriptor (`true` / `false`), if written. */
  readonly inherits?: string;
  /** The `initial-value` descriptor, if written and non-empty. */
  readonly initialValue?: string;
  /**
   * The imported file the block was spliced from — same spelling as
   * {@link Scope.origin}. Absent on an entry-file registration.
   */
  readonly origin?: string;
}

/** A name's effective initial value, as {@link registeredInitialValues} reads it. */
export interface RegisteredInitial {
  readonly value: string;
  readonly line: number;
  readonly origin?: string;
}

/**
 * The names a stylesheet's `@property` registrations give a usable initial
 * value, each with that value — the lookup the resolver and rule 5 share.
 *
 * Applies CSS's validity rule, conservatively: a registration with no `syntax`
 * is invalid and ignored (a browser drops the whole rule); a non-`*` syntax
 * with no `initial-value` is invalid and ignored; a `*` registration with no
 * initial value is VALID but gives the property none — it is
 * guaranteed-invalid until something declares it, so it overrides an earlier
 * valid registration's initial value rather than adding to it. Registrations
 * are read in array (document) order and the last valid one wins, as in CSS.
 * Not modelled: checking that the initial value actually parses against the
 * syntax — any non-empty value counts.
 */
export function registeredInitialValues(
  registrations: readonly Registration[] | undefined,
): ReadonlyMap<string, RegisteredInitial> {
  const out = new Map<string, RegisteredInitial>();
  for (const r of registrations ?? []) {
    if (r.syntax === undefined) continue;
    if (r.initialValue === undefined) {
      if (r.syntax === "*") out.delete(r.name);
      continue;
    }
    out.set(r.name, {
      value: r.initialValue,
      line: r.line,
      ...(r.origin !== undefined ? { origin: r.origin } : {}),
    });
  }
  return out;
}

export interface Stylesheet {
  readonly scopes: readonly Scope[];
  /** Every `var()` use in the stylesheet, in source order. */
  readonly references: readonly Reference[];
  /**
   * Every `@property` registration, in source order (see {@link Registration}).
   * Absent when the sheet has none, so a sheet without `@property` is
   * byte-identical to what it was before registrations were read.
   */
  readonly registrations?: readonly Registration[];
  /**
   * The `@import` statements in the CSS-legal position — top level, before the
   * first qualified rule — in source order. A later `@import` is dead text by
   * CSS's own rules (every browser ignores it) and is not collected, so this
   * list is exactly what a loader is entitled to follow. Most is not all:
   * a collected import may still name a bare package specifier or a file that
   * does not exist, both of which {@link loadStylesheet} skips — and since the
   * eighth rule a failed RELATIVE follow is recorded on
   * {@link unresolvedImports} rather than discarded, so the skip is a routing
   * decision, never a silence.
   */
  readonly imports: readonly StylesheetImport[];
  /**
   * The RELATIVE edges of this closure that FAILED to follow, when the sheet
   * was loaded by {@link loadStylesheet} — the loader's bookkeeping of every
   * broken composition edge, so a stylesheet whose own closure cannot load
   * reports the breakage instead of auditing green. Absent on the text-only
   * path (`parseStylesheet`/`resolveCss` never set it — there is no file
   * system to consult), and empty when every relative edge followed.
   */
  readonly unresolvedImports?: readonly UnresolvedImport[];
  /**
   * The `themeguard-ignore` directives scanned from this closure's text, when
   * the sheet was loaded by {@link loadStylesheet} — every member's in-source
   * judgement, each stamped with its own file's entry-relative `origin`
   * (absent for the entry file's own, which is how matching tells an
   * entry-file judgement from an imported one). Absent on the text-only path
   * (`parseStylesheet`/`resolveCss` never set it — there is no file to read
   * the comments from). The GRAMMAR is `directives.ts`'s, not the parser's:
   * this field carries what the loader collected, nothing more.
   */
  readonly directives?: readonly IgnoreDirective[];
  /**
   * Every theme NAME the sheet's own scopes recognise, in first-appearance
   * (document) order: the attribute/media values, the built-in `.dark` /
   * `.light` classes, and any class name a caller configured through
   * {@link ParseOptions.themes}. Absent when the sheet names no theme, so a
   * themeless sheet is byte-identical to what it was before themes were
   * read. An INVENTORY, not an input: nothing in the resolver or the rules
   * consumes it — recognition itself is decided by {@link classifyOne} — but
   * a loader composing the closure needs the names to answer one question
   * the rules cannot ask for themselves: does this sheet spell any theme at
   * all? A sheet whose dark palette lives in a class name outside the
   * recognised set reports no `themes` at all, which is how
   * {@link loadStylesheet} tells a half-read palette from a themeless sheet
   * (see {@link unrecognisedClassTheme} for the matching half).
   */
  readonly themes?: readonly string[];
}

/**
 * Optional input to {@link parseStylesheet}: the class theme NAMES a caller's
 * own convention stands for. Each entry is the class name — `.theme-dark` is
 * configured as `"theme-dark"`, never `".theme-dark"` and never a selector —
 * and each configured name becomes a theme of its own, on exactly the subjects
 * the built-in `.dark`/`.light` pair accepts. Absent (or empty) is the
 * byte-identical behaviour the parser has always had: the built-in pair only.
 */
export interface ParseOptions {
  /** Class names (without the dot) that name a theme in the caller's convention. */
  readonly themes?: readonly string[];
  /**
   * Attribute names (`data-md-color-scheme`, never `[data-md-color-scheme]`
   * and never a selector) that name a theme BY VALUE in the caller's
   * convention, beside the built-in `data-theme` / `data-bs-theme`: the theme
   * is the attribute's value (`slate`, `dark`), on exactly the subjects the
   * built-ins accept. Absent (or empty) is the byte-identical behaviour: the
   * built-in pair only.
   */
  readonly themeAttributes?: readonly string[];
}

/** What the parser recognises as a theme: the configured class names and the attribute-theme matcher. */
interface Recognition {
  readonly classes: readonly string[];
  readonly attributeTheme: RegExp;
}

/**
 * The attribute selector that names a theme by its VALUE. Two built-in
 * attribute names: `data-theme` (the common convention) and `data-bs-theme`
 * (Bootstrap 5.3 colour modes), plus any name a caller configured
 * ({@link ParseOptions.themeAttributes}: `data-md-color-scheme`,
 * `data-mantine-color-scheme`, …). All go through the one rule, so a compound
 * subject (`.navbar[data-bs-theme=dark]`) behaves exactly as `[data-theme]`
 * does. Any other attribute name (`data-mode`, `data-color-scheme`, …) is not a
 * theme. Quoted and unquoted values are both read.
 */
function attributeThemePattern(configured: readonly string[]): RegExp {
  const names = ["data-(?:bs-)?theme", ...configured.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))];
  return new RegExp(`\\[\\s*(?:${names.join("|")})\\s*=\\s*["']?([^"'\\]]+)["']?\\s*\\]`);
}

/**
 * Blank out `/* … *\/` comments, preserving every byte position and newline so
 * line numbers stay true. Comment-aware parsing is not optional here: the
 * calibration stylesheet documents its own palette decisions in comments that
 * contain `--token: value` prose, and a naive line grep miscounts because of
 * them.
 */
function blankComments(css: string): string {
  let out = "";
  let from = 0;
  for (const { start, end } of commentSpans(css)) {
    out += css.slice(from, start);
    for (let j = start; j < end; j += 1) out += css[j] === "\n" ? "\n" : " ";
    from = end;
  }
  return out + css.slice(from);
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
 * Split `s` on every TOP-LEVEL character for which `isSeparator` holds —
 * outside every paren, bracket and quoted string — then trim the pieces and
 * drop the empty ones.
 */
function splitTopLevel(s: string, isSeparator: (ch: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i] as string;
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0 && isSeparator(ch)) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((piece) => piece.trim()).filter((piece) => piece.length > 0);
}

/**
 * Split a selector LIST on its top-level commas, respecting `(`, `[` and
 * strings so `:is(a, b)` and `[title="x,y"]` stay in one piece.
 */
function splitSelectorList(prelude: string): string[] {
  return splitTopLevel(prelude, (ch) => ch === ",");
}

/**
 * Index of the `)` that closes the `(` at `open`, counting parens only, or -1
 * when the list never closes.
 */
function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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
    const end = closingParen(out, out.indexOf("(", at));
    if (end === -1) return out.slice(0, at);
    out = out.slice(0, at) + out.slice(end + 1);
  }
}

/**
 * Split a single selector on its TOP-LEVEL combinators — descendant (space),
 * `>`, `+` and `~` — respecting parens, brackets and strings.
 *
 * The pieces are compound selectors; the LAST one is the selector's subject
 * (the element the rule actually applies to). More than one piece therefore
 * means the selector is not a scope but something INSIDE one.
 */
function splitCombinators(selector: string): string[] {
  return splitTopLevel(selector, (ch) => ch === " " || ch === ">" || ch === "+" || ch === "~");
}

/**
 * Index of the first match of `re` at nesting depth 0 — outside every paren,
 * bracket and quoted string — or `-1`.
 *
 * `re` is tested against the SUFFIX starting at each candidate index, so it must
 * be anchored with `^`. Depth-awareness is the whole point: a plain
 * `String#search` finds a pseudo-class at ANY nesting depth, which is not the
 * same question as "is this pseudo-class on the subject compound?".
 */
function findTopLevel(s: string, re: RegExp): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (depth === 0 && re.test(s.slice(i))) return i;
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
  }
  return -1;
}

/**
 * Pull the argument lists out of every TOP-LEVEL `:is(…)` / `:where(…)` in a
 * compound, returning the compound with those blocks removed plus the arguments
 * as selectors in their own right.
 *
 * These two pseudo-classes only GROUP selectors — `:is(:root, [data-theme="dark"])`
 * matches exactly what `:root, [data-theme="dark"]` matches — so a scope written
 * inside one is genuinely that scope, and must be looked through the same way
 * {@link stripNegations} looks past `:not(…)`. (`:where()` is the zero-specificity
 * form of the same thing, which is precisely why generated stylesheets reach for
 * it.) The arguments are classified as full selectors, so a combinator inside one
 * still disqualifies it.
 *
 * "Top-level" is enforced by {@link findTopLevel} and is load-bearing, not a
 * tidiness note. A depth-blind search also matches a grouping pseudo-class nested
 * INSIDE a containment one — `html:has(:is([data-theme="winter"]))` — and hoisting
 * that argument out promotes it to a scope before {@link stripFunctionalArgs} can
 * see the `:has()` that renders it irrelevant. That is the containment defect
 * arriving by a second route: an element that merely CONTAINS the winter root
 * would claim winter's global table. `:has(:is(a, b))` is exactly how a
 * multi-theme detector is written, so this is a shape real stylesheets take, and
 * wrapping a list in `:is()` must not change a classification the bare list gets
 * right. A grouping pseudo-class nested inside ANOTHER grouping pseudo-class is
 * unaffected: its parent's argument is recursed back through {@link classifyOne},
 * where the inner one is itself top-level.
 */
function extractMatchesAny(compound: string): { rest: string; args: string[] } {
  let rest = compound;
  const args: string[] = [];
  for (;;) {
    const at = findTopLevel(rest, /^:(?:is|where|matches|-webkit-any|-moz-any)\s*\(/i);
    if (at === -1) return { rest, args };
    const open = rest.indexOf("(", at);
    const end = closingParen(rest, open);
    if (end === -1) {
      args.push(...splitSelectorList(rest.slice(open + 1)));
      return { rest: rest.slice(0, at), args };
    }
    args.push(...splitSelectorList(rest.slice(open + 1, end)));
    rest = rest.slice(0, at) + rest.slice(end + 1);
  }
}

/**
 * Remove the ARGUMENTS of every remaining functional pseudo-class/element.
 *
 * Called AFTER {@link stripNegations} and {@link extractMatchesAny} have taken
 * the three pseudo-classes whose arguments genuinely bear on the scope — `:not()`
 * (a negation, so its contents must not classify) and `:is()`/`:where()` (pure
 * grouping, so their contents ARE scopes in their own right). Everything left is
 * a functional pseudo that describes a RELATIONSHIP or a POSITION, and its
 * argument names some OTHER element — never the subject.
 *
 * `html:has([data-theme="winter"])` merely CONTAINS the winter root; it is not
 * it. Reading `winter` out of that argument files a base-scope block under the
 * winter theme, corrupting that theme's values and erasing genuine absences —
 * the same silent-wrong-data defect the combinator check closes for
 * `[data-theme="winter"] .code-block`, arriving by a different route.
 *
 * This strips by SHAPE rather than by name, so `:has()`, `:host-context()`,
 * `::slotted()`, `:nth-child(… of …)` and any functional pseudo invented next
 * year are all handled by construction — the two that provably ARE the scope are
 * excepted above, and nothing else needs enumerating. A non-functional pseudo
 * (`:root:hover`) carries no arguments and is untouched.
 */
function stripFunctionalArgs(compound: string): string {
  let out = compound;
  for (;;) {
    const at = out.search(/::?[\w-]+\s*\(/);
    if (at === -1) return out;
    const end = closingParen(out, out.indexOf("(", at));
    // An unclosed argument list runs to the end of the selector: drop the rest.
    if (end === -1) return out.slice(0, at);
    out = out.slice(0, at) + out.slice(end + 1);
  }
}

/** Blank quoted string contents so a literal `:root` in an attribute value cannot classify. */
function blankStrings(s: string): string {
  return s.replace(/(["'])(?:\\.|(?!\1).)*\1?/g, (m) => m[0] + " ".repeat(Math.max(0, m.length - 2)) + m[0]);
}

/**
 * The theme a class-based colour-scheme compound names, or `null`.
 *
 * `.dark` / `.light` on an otherwise bare, `html`, `body` or `:root` subject —
 * `.dark`, `html.dark`, `body.dark`, `:root.dark` — is the dark/light scope, the
 * way Tailwind's `darkMode: "class"` and shadcn write it. The theme names are
 * the ones `[data-theme="dark"]` and the colour-scheme media query already use,
 * so every spelling lands in one table.
 *
 * Deliberately narrow: only these two class names, and only on those subjects —
 * plus any name a caller configured (see {@link ParseOptions.themes}): a user
 * whose system spells the dark palette `.theme-dark` names it in
 * `themeguard.config.json` (`"themes": ["theme-dark"]`) and the class becomes a
 * theme of its own, named `theme-dark`, on the same subjects and under the same
 * rules as `.dark`. Any other class (`.high-contrast`), any second class
 * (`.dark.card`), an id, or any other element type (`div.dark`) is not a theme
 * and returns `null`; so does a compound naming both `.dark` and `.light`.
 * Class names are case-sensitive (the element names are not — pinned), so
 * `.Dark` is not a theme even under a configured `"dark"`.
 * Pseudo-classes (`:hover`) are ignored, exactly as `:root:hover` stays `root`.
 * A descendant (`.dark .card`) never reaches here: its subject is `.card`.
 * `rest` has negations and functional arguments already removed and string
 * contents blanked.
 */
function classThemeOf(rest: string, configured: readonly string[]): string | null {
  const bare = rest.replace(/::?[\w-]+/g, "");
  const m = bare.match(/^(?:[hH][tT][mM][lL]|[bB][oO][dD][yY])?\.([\w-]+)$/);
  if (!m) return null;
  const name = m[1] as string;
  // The built-in pair, then the caller's — membership is exact, so a
  // configured name matches case-sensitively just as `dark` does, and a name
  // with characters a single class cannot spell (`my.theme`) simply never
  // matches: the key adds recognition, it never mints a theme.
  return name === "dark" || name === "light" || configured.includes(name) ? name : null;
}

/**
 * The class name of the FIRST scope in `scopes` that names a class theme the
 * built-in recognition does not spell, or `null`.
 *
 * This is the loader's half of the `themes` configuration story: when a
 * stylesheet declares a palette variant under a class name outside the
 * recognised set — `.theme-dark`, `.high-contrast` — and no configuration
 * names that class, the audit runs on a half-read sheet and
 * {@link loadStylesheet} refuses with the fix spelled out. Reading it back
 * off the scopes (rather than re-scanning source text) means the detection
 * sees exactly what classification saw, across the whole import closure a
 * loader hands it, and answers which class to name in the config.
 *
 * A scope "names a class theme" when its subject is one class on a bare,
 * `html`, `body` or `:root` subject — the exact shape {@link classThemeOf}
 * accepts, read here with the same preprocessing `classifyOne` applies
 * (negations and functional arguments stripped, string contents blanked) so
 * `:root:not(.dark)` and `.dark .card` never read as candidates. Such a scope
 * is only a CANDIDATE when it re-tunes the sheet's own base palette, because
 * the ordinary component-override idiom (`.btn-danger { --accent: … }`,
 * `.card-compact { --radius: … }`) has the same shape and lives in plenty of
 * sheets with no themes at all — the refusal must never fire on those. Two
 * kinds of scope qualify, each with its own harm:
 *
 *   - a `root`-kind scope (`:root.theme-dark`) that re-declares at least half
 *     of the base palette's names: `classifyOne` fell through to the base
 *     test, so the dark palette overwrites the light one;
 *   - an `other`-kind scope (`.theme-dark`, `html.high-contrast`) that
 *     re-declares at least half of the base palette's names AND at least
 *     {@link PALETTE_VARIANT_MIN_OVERLAP} of them. A component overrides a
 *     name or two; a palette variant restates the palette. Its declarations
 *     never reach any theme table.
 *
 * A scope declaring only fresh names, or overriding a token or two, is a
 * component, not a palette variant, and never qualifies. The bar errs toward
 * silence: a variant too small to clear it audits as it always has.
 */
export function unrecognisedClassTheme(scopes: readonly Scope[]): string | null {
  return unrecognisedClassThemes(scopes)[0] ?? null;
}

/**
 * EVERY class name {@link unrecognisedClassTheme} would name, in scope order,
 * deduplicated; `[]` when none qualifies. The loader's refusal reads this
 * form so a sheet declaring several unnamed palettes (`.high-contrast`,
 * `.sepia`) is told about all of them at once. Same qualifying bar, same
 * preprocessing: a class already classified as a theme scope (`.dark`, or a
 * configured name) has kind `theme` and is never a candidate.
 */
export function unrecognisedClassThemes(scopes: readonly Scope[]): string[] {
  return unrecognisedPaletteThemes(scopes, classThemeSubject);
}

/**
 * The shared qualifying loop behind {@link unrecognisedClassThemes} and
 * {@link unrecognisedAttributeThemes}: the subject names, in scope order and
 * deduplicated, of the `root`/`other` scopes `subjectOf` reads a name from that
 * restate at least half the base palette (and, for bare/html/body spellings,
 * at least {@link PALETTE_VARIANT_MIN_OVERLAP} of it).
 */
function unrecognisedPaletteThemes(
  scopes: readonly Scope[],
  subjectOf: (selector: string) => string | null,
): string[] {
  const found: string[] = [];
  const rootNames = basePaletteNames(scopes);
  for (const scope of scopes) {
    if (scope.kind !== "root" && scope.kind !== "other") continue;
    const name = subjectOf(scope.matchedSelector);
    if (name === null) continue;
    const overlap = new Set(scope.declarations.map((d) => d.name).filter((n) => rootNames.has(n)));
    if (overlap.size === 0 || overlap.size * 2 < rootNames.size) continue;
    // A `:root`-prefixed spelling is theme-shaped enough to need no floor
    // beyond "restates half the palette"; a bare/html/body class, which is
    // also the component idiom, additionally needs the absolute floor.
    if (
      (scope.kind === "root" || overlap.size >= PALETTE_VARIANT_MIN_OVERLAP) &&
      !found.includes(name)
    )
      found.push(name);
  }
  return found;
}

/**
 * The names the BASE palette declares: the `root`-kind scopes that are not
 * themselves a class- or attribute-spelled candidate, so `:root.theme-dark`
 * and `:root[data-md-color-scheme=slate]` are never measured against
 * themselves (nor inflate the palette the other kind is measured against).
 */
function basePaletteNames(scopes: readonly Scope[]): Set<string> {
  const names = new Set<string>();
  for (const scope of scopes) {
    if (scope.kind !== "root") continue;
    if (classThemeSubject(scope.matchedSelector) !== null) continue;
    if (attributeThemeSubject(scope.matchedSelector) !== null) continue;
    for (const d of scope.declarations) names.add(d.name);
  }
  return names;
}

/** Fewest base-palette names a bare class must re-declare to read as a palette variant. */
const PALETTE_VARIANT_MIN_OVERLAP = 3;

/**
 * The attribute NAME of the first scope in `scopes` that names an attribute
 * theme the recognised set does not spell, or `null` — the attribute twin of
 * {@link unrecognisedClassTheme}.
 */
export function unrecognisedAttributeTheme(scopes: readonly Scope[]): string | null {
  return unrecognisedAttributeThemes(scopes)[0] ?? null;
}

/**
 * EVERY attribute name {@link unrecognisedAttributeTheme} would name, in scope
 * order, deduplicated; `[]` when none qualifies. The loader's refusal for the
 * palette written under an attribute nothing spells (`[data-md-color-scheme=
 * slate]`, `[data-mantine-color-scheme=dark]`, `:root[data-color-mode=dark]`)
 * and no configuration names ({@link ParseOptions.themeAttributes}).
 *
 * A scope "names an attribute theme" when its subject is one `[attr=value]`
 * on a bare, `html`, `body` or `:root` subject, read with the same
 * preprocessing {@link classifyOne} applies. The bar is the class bar, for the
 * same reason (`[data-size=lg] { --pad: … }` is a component, not a palette):
 *
 *   - a `root`-kind scope (`:root[attr=v]`) that re-declares at least half of
 *     the base palette's names — its values would overwrite the base;
 *   - an `other`-kind scope (`[attr=v]`, `html[attr=v]`) that re-declares at
 *     least half of them AND at least {@link PALETTE_VARIANT_MIN_OVERLAP}.
 *
 * Attributes the parser recognises (the built-ins and the configured names)
 * classify as `theme` scopes and are never candidates. The bar errs toward
 * silence: a smaller variant audits as it always has.
 */
export function unrecognisedAttributeThemes(scopes: readonly Scope[]): string[] {
  return unrecognisedPaletteThemes(scopes, attributeThemeSubject);
}

/**
 * The attribute name a selector's subject names as an ATTRIBUTE THEME
 * candidate, or `null`: exactly one `[name=value]` on a bare, `html`, `body`
 * or `:root` subject (pseudo-classes ignored), after the SAME preprocessing
 * {@link classThemeSubject} runs. The name check is the caller's: recognised
 * names never reach it as `root`/`other` scopes, since they classify as themes.
 */
function attributeThemeSubject(selector: string): string | null {
  const raw = selector.trim();
  const compounds = splitCombinators(raw);
  if (compounds.length !== 1) return null;
  const subject = stripNegations(compounds[0]);
  const { rest: grouped } = extractMatchesAny(subject);
  const rest = blankStrings(stripFunctionalArgs(grouped));
  const attributes = rest.match(/\[[^\]]*\]/g) ?? [];
  if (attributes.length !== 1) return null;
  const m = (attributes[0] as string).match(/^\[\s*([\w-]+)\s*=\s*["']?[^"'\]]+["']?\s*\]$/);
  if (!m) return null;
  const remainder = rest.replace(attributes[0] as string, "").replace(/::?[\w-]+/g, "");
  return /^(?:[hH][tT][mM][lL]|[bB][oO][dD][yY])?$/.test(remainder) ? (m[1] as string) : null;
}

/**
 * The single class a selector's subject names as a CLASS THEME candidate, or
 * `null` when the subject is not that shape. Runs the SAME preprocessing
 * {@link classifyOne} runs — combinator split, negation and functional-
 * argument stripping, string blanking — then reads the one-class-on-
 * bare/html/body/:root shape {@link classThemeOf} reads, WITHOUT the name
 * check: the built-in pair and any configured name are both recognised
 * themes, and this function's caller judges the name.
 */
function classThemeSubject(selector: string): string | null {
  const raw = selector.trim();
  const compounds = splitCombinators(raw);
  if (compounds.length !== 1) return null;
  const subject = stripNegations(compounds[0]);
  const { rest: grouped } = extractMatchesAny(subject);
  const rest = stripFunctionalArgs(grouped);
  const bare = blankStrings(rest).replace(/::?[\w-]+/g, "");
  const m = bare.match(/^(?:[hH][tT][mM][lL]|[bB][oO][dD][yY])?\.([\w-]+)$/);
  return m ? (m[1] as string) : null;
}

/**
 * Classify ONE selector (never a list — see {@link classifySelectors}) into the
 * scopes it opens. Usually none or one; `:is(:root, [data-theme="dark"])` opens two.
 *
 * Classification is on the selector's SUBJECT, not on "does this string contain
 * a recognised token anywhere". A selector with a combinator has a subject that
 * is something else — `[data-theme="winter"] .code-block` is a component inside
 * the winter theme — so it is `other`, and its declarations stay out of winter's
 * table. A functional pseudo-class's ARGUMENT is likewise not the subject:
 * `html:has([data-theme="winter"])` is an element that CONTAINS the winter root,
 * not the winter root, so it is `other` too. Within the subject compound itself
 * the token may sit anywhere, which is what makes `html:root`,
 * `:root:not([data-theme])` and `:root:hover` classify `root`.
 */
function classifyOne(
  selector: string,
  recognition: Recognition,
): { kind: Exclude<ScopeKind, "other">; theme: string | null; matched: string }[] {
  const raw = selector.trim();
  if (/^@theme\b/i.test(raw)) return [{ kind: "theme-inline", theme: null, matched: raw }];

  const compounds = splitCombinators(raw);
  // A combinator means the subject is not the scope but something within it.
  if (compounds.length !== 1) return [];

  const subject = stripNegations(compounds[0]);
  const { rest: grouped, args } = extractMatchesAny(subject);
  // Whatever functional pseudo-classes remain describe a relationship or a
  // position; their arguments name some other element, never the subject.
  const rest = stripFunctionalArgs(grouped);

  const found: { kind: Exclude<ScopeKind, "other">; theme: string | null; matched: string }[] = [];
  const themeMatch = rest.match(recognition.attributeTheme);
  const classTheme = classThemeOf(blankStrings(rest), recognition.classes);
  if (themeMatch) found.push({ kind: "theme", theme: themeMatch[1].trim(), matched: raw });
  // BEFORE the `:root` test: `:root.dark` is the dark scope, not the base.
  else if (classTheme) found.push({ kind: "theme", theme: classTheme, matched: raw });
  else if (/:root\b/.test(blankStrings(rest)))
    found.push({ kind: "root", theme: null, matched: raw });

  for (const arg of args)
    found.push(...classifyOne(arg, recognition).map((f) => ({ ...f, matched: arg })));
  return found;
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
  recognition: Recognition,
): { kind: ScopeKind; theme: string | null; matchedSelector: string }[] {
  const selectors = splitSelectorList(prelude);
  const matched: { kind: ScopeKind; theme: string | null; matchedSelector: string }[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    for (const { kind, theme, matched: matchedSelector } of classifyOne(selector, recognition)) {
      const key = `${kind}\u0000${theme ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matched.push({ kind, theme, matchedSelector });
    }
  }
  if (matched.length > 0) return matched;
  return [{ kind: "other", theme: null, matchedSelector: prelude }];
}

/**
 * Blank every NESTED `{ … }` region of a block body, preserving byte positions
 * and newlines, and writing `;` in place of each nested block's closing brace.
 *
 * Since CSS Nesting a block body is declarations AND nested rules, and a nested
 * rule's declarations belong to a DIFFERENT subject. Left in place they do two
 * kinds of damage, both silent: a `;` written inside the nested block ends one
 * of THIS block's declarations, so the nested value is filed under the enclosing
 * scope; and the nested rule's leftover prelude then absorbs the declaration
 * that follows its closing brace, dropping it outright. The substituted `;` is
 * what stops that absorption — the prelude becomes a chunk of its own, which
 * {@link readDeclarations} discards because it does not start with `--`.
 *
 * Byte positions are preserved for the same reason {@link blankComments}
 * preserves them: the declaration line numbers are read off the ORIGINAL offsets.
 * Strings are tracked the same way {@link blankComments} tracks them too —
 * UNCONDITIONALLY, at every depth. A brace written inside a string is text, not
 * structure, and this scan spends its whole working life at depth > 0, so a
 * depth-gated string scan would be blind exactly where it matters.
 *
 * This only takes the nested region OUT of the enclosing block. It does not
 * discard it — {@link parseStylesheet} walks the same region separately and
 * reports its declarations under their own subject.
 */
function blankNestedBlocks(body: string): string {
  let out = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (inString) {
      out += depth > 0 && ch !== "\n" ? " " : ch;
      if (ch === "\\") {
        const next = body[i + 1];
        if (next !== undefined) out += depth > 0 && next !== "\n" ? " " : next;
        i += 1;
      } else if (ch === inString) inString = null;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      out += " ";
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      // A separator, so the nested rule's prelude cannot swallow what follows.
      out += depth === 0 ? ";" : " ";
      continue;
    }
    // Unconditionally, at EVERY depth — as every other string-tracking loop in
    // this file does. Gating this on `depth === 0` would make the scan
    // string-blind inside the very region it exists to blank, where the depth
    // is never 0 by construction: a brace written inside a string there would
    // be counted as structure and desync the depth.
    if (ch === '"' || ch === "'") inString = ch;
    out += depth > 0 && ch !== "\n" ? " " : ch;
  }
  return out;
}

/** Index of the first top-level `&`, or -1. */
function findAmpersand(selector: string): number {
  return findTopLevel(selector, /^&/);
}

/**
 * Resolve a NESTED rule's prelude against its parent, so it can be classified
 * as the ordinary selector it stands for.
 *
 * CSS Nesting gives `&` the parent's meaning, and a nested selector that never
 * writes `&` is an implicit DESCENDANT of the parent. Both are rewritten here
 * into a flat selector, which {@link classifySelectors} then judges by exactly
 * the same subject rule it applies to a top-level one — no second classifier,
 * and no new notion of what a scope is.
 *
 * Two substitutions, and both are deliberately conservative:
 *
 *   - `&` becomes the parent selector when the parent is a single compound, so
 *     `&[data-theme="winter"]` inside `:root` resolves to
 *     `:root[data-theme="winter"]` — the winter scope, which is what it is.
 *     `&:hover` inside `:root` resolves to `:root:hover`, classified `root`,
 *     agreeing with the flat form.
 *   - `&` becomes `*` when the parent is a LIST or carries a combinator. `&`
 *     formally means `:is(parent)` there, and substituting that literally would
 *     hand every scope in the parent list to the child: `&[data-theme="winter"]`
 *     under `:root, [data-theme="dark"]` would claim `root` and `dark` as well
 *     as `winter`. `*` keeps whatever the child itself names and claims nothing
 *     it inherited — under-claiming, which for a data stage is the safe
 *     direction, since an unclaimed block lands in `other` rather than
 *     corrupting a theme's table.
 *
 * An implicit descendant is written `* <selector>`, which carries a combinator,
 * so {@link classifyOne} rejects it as a subject — `.card` inside `:root` is a
 * component within the base scope, not the base scope, exactly as the flat
 * `:root .card` is.
 */
function resolveNestedSelector(prelude: string, parent: string): string {
  const parentSelectors = splitSelectorList(parent);
  const parentIsCompound =
    parentSelectors.length === 1 && splitCombinators(parentSelectors[0] as string).length === 1;
  const target = parentIsCompound ? (parentSelectors[0] as string) : "*";

  return splitSelectorList(prelude)
    .map((selector) => {
      if (findAmpersand(selector) === -1) return `* ${selector}`;
      let out = selector;
      for (;;) {
        const at = findAmpersand(out);
        if (at === -1) return out;
        out = out.slice(0, at) + target + out.slice(at + 1);
      }
    })
    .join(", ");
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

/**
 * Split a block body into `property: value` pairs with true line numbers.
 *
 * Shared by {@link readDeclarations} and {@link readReferences} so the two read
 * the SAME chunks: a use and a declaration are the same syntax seen from two
 * sides, and letting them disagree about where one declaration ends would let a
 * token look unreferenced because its use fell in a chunk only one of them saw.
 */
function readPairs(
  rawBody: string,
  bodyStart: number,
  lines: number[],
): { property: string; value: string; line: number }[] {
  // A nested rule's declarations have a different subject: take them out of
  // this block, so they neither land here nor eat the declaration after them.
  const body = blankNestedBlocks(rawBody);
  const out: { property: string; value: string; line: number }[] = [];
  for (const chunk of splitDeclarations(body)) {
    const trimmed = chunk.text.trim();
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const leading = chunk.text.length - chunk.text.trimStart().length;
    out.push({
      property: trimmed.slice(0, colon).trim(),
      value: trimmed.slice(colon + 1).trim(),
      line: lines[bodyStart + chunk.offset + leading] ?? 1,
    });
  }
  return out;
}

function readDeclarations(
  rawBody: string,
  bodyStart: number,
  lines: number[],
): Declaration[] {
  return readPairs(rawBody, bodyStart, lines)
    .filter((p) => /^--[\w-]+$/.test(p.property))
    .map(({ property, value, line }) => ({ name: property, value, line }));
}

const VAR_USE = /var\(\s*(--[\w-]+)/g;

/**
 * Every `var()` use written in a block body, from EVERY declaration — not only
 * from the custom-property ones.
 *
 * That distinction is the whole reason this function exists. A token can be
 * used by an ordinary property in a block that declares no custom property at
 * all (`.app-sidebar { width: var(--sidebar-width); }`), which produces no
 * `Scope` and therefore leaves no trace in the declaration data. Reading uses
 * only out of custom-property values reports such a token as referenced by
 * nothing, which is a false statement about the stylesheet rather than a
 * judgement call.
 *
 * Fallbacks count as uses: in `var(--a, var(--b))` both `--a` and `--b` are
 * named by the author, and `--b` is genuinely reachable.
 */
function readReferences(
  rawBody: string,
  bodyStart: number,
  lines: number[],
  selector: string,
  kinds: readonly ScopeKind[],
): Reference[] {
  const out: Reference[] = [];
  for (const { property, value, line } of readPairs(rawBody, bodyStart, lines)) {
    for (const m of value.matchAll(VAR_USE)) {
      out.push({ name: m[1] as string, property, value, selector, kinds, line });
    }
  }
  return out;
}

/** `(prefers-color-scheme: dark|light)`, whitespace- and case-insensitive. */
const COLOR_SCHEME_FEATURE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/i;

/**
 * What a media PRELUDE may still name once its one colour-scheme feature is
 * removed: the at-rule itself, the `only`/`and` connectives, and the media
 * types a colour scheme can actually apply to. `print` and `speech` fail this
 * and keep the unconditional reading — a palette conditioned on print is not
 * the OS palette.
 */
const MEDIA_SCHEME_PRELUDE = /^(?:@media|only|screen|all|and|\s)+$/i;

/**
 * The `prefers-color-scheme` value an at-rule prelude conditions a palette on,
 * or `null` when it does not condition on exactly one.
 *
 * "Exactly one" is the whole rule, and each rejection is a decision rather
 * than an oversight. A comma query list (`@media (prefers-color-scheme: dark),
 * print`) is an OR — the block is live in dark AND in print, and no single
 * value names that. A second feature (`… and (min-width: 40rem)`) narrows the
 * condition to part of the dark population, and the palette of a fraction is
 * not the palette. A media type other than `screen`/`all` (`print`, `speech`)
 * is the same narrowing by another door. `@supports` and `@layer` condition on
 * capability and cascade order, never on the OS setting. All of these keep
 * today's unconditional reading — folded into the base table — which is a
 * stated limit rather than a silent guess: the README's Scope section names
 * it, and this function is the only door through which a condition reaches a
 * {@link Scope}.
 *
 * `only screen and (prefers-color-scheme: dark)` passes: `only` and `screen`
 * change specificity and medium, not which palette is selected.
 */
function colorSchemeOf(prelude: string): "dark" | "light" | null {
  if (!/^@media\b/i.test(prelude)) return null;
  // An OR of queries names no single palette.
  if (findTopLevel(prelude, /^,/) !== -1) return null;
  const groups = prelude.match(/\([^()]*\)/g) ?? [];
  if (groups.length !== 1) return null;
  const feature = groups[0] as string;
  const m = feature.match(COLOR_SCHEME_FEATURE);
  if (!m) return null;
  if (!MEDIA_SCHEME_PRELUDE.test(prelude.replace(feature, " "))) return null;
  return m[1]?.toLowerCase() as "dark" | "light";
}

/**
 * Parse a stylesheet into its custom-property-declaring scopes.
 *
 * Nested at-rules (`@media`, `@supports`, `@layer`) are recursed into, so a
 * `:root` inside a media query is found — and a `:root` inside a
 * `prefers-color-scheme` media query additionally carries that condition on
 * its scope ({@link Scope.colorScheme}), in BOTH writings: flat
 * (`@media … { :root { … } }`) and nested (`:root { @media … { … } }`).
 * `@theme` blocks are NOT recursed into because their body is declarations,
 * not rules. A block BODY is parsed depth-aware, because since CSS Nesting a
 * body is declarations AND nested rules. A nested rule's declarations belong to a
 * DIFFERENT subject, so they are taken out of the enclosing block by
 * {@link blankNestedBlocks} and then walked separately: their prelude is
 * resolved against the parent by {@link resolveNestedSelector} and classified by
 * exactly the same subject rule a top-level selector gets. So
 * `&[data-theme="winter"]` written inside `:root` is reported as the winter
 * scope, and `.card` written inside `:root` is reported as `other` — the same
 * two answers their flat equivalents get. Nothing is silently dropped, and
 * nothing is filed under a subject that did not declare it.
 */
export function parseStylesheet(source: string, options?: ParseOptions): Stylesheet {
  const recognition: Recognition = {
    classes: options?.themes ?? [],
    attributeTheme: attributeThemePattern(options?.themeAttributes ?? []),
  };
  const css = blankComments(source);
  const lines = lineIndex(css);
  const scopes: Scope[] = [];
  const references: Reference[] = [];
  const registrations: Registration[] = [];
  // `@import` preludes, collected where CSS makes them live. `sawQualifiedRule`
  // ends the legal region: the first top-level `selector { … }` block is the
  // point past which every browser ignores an `@import`, so collecting one
  // there would invite the loader to follow dead text. At-rules with bodies
  // (`@media …`) do not end the region — only a qualified rule does — and
  // neither does a statement at-rule like `@charset`; this tracks CSS's own
  // line, not a guess about style.
  const imports: StylesheetImport[] = [];
  let sawQualifiedRule = false;

  const walk = (from: number, to: number, parent: string | null, scheme: "dark" | "light" | null, topLevel = false): void => {
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
          const rawSelector = css.slice(preludeStart, blockStart).trim().replace(/\s+/g, " ");
          // Inside a parent rule this prelude is a NESTED selector: `&` carries
          // the parent's meaning and a bare selector is an implicit descendant.
          // Resolved here so one classifier judges every selector.
          const selector =
            parent !== null && !rawSelector.startsWith("@")
              ? resolveNestedSelector(rawSelector, parent)
              : rawSelector;
          const bodyStart = blockStart + 1;
          const body = css.slice(bodyStart, i);
          const matches = classifySelectors(selector, recognition);
          const isNestingAtRule =
            selector.startsWith("@") && matches[0].kind !== "theme-inline";
          if (isNestingAtRule) {
            // `@property --name { … }` registers a custom property; its body
            // is descriptors, not declarations, so it yields a registration
            // and no scope. Only where CSS allows it: not inside a style rule.
            if (parent === null) {
              const rawPrelude = css.slice(preludeStart, blockStart);
              const lead = rawPrelude.length - rawPrelude.trimStart().length;
              const reg = readRegistration(
                rawSelector,
                body,
                bodyStart,
                lines,
                lines[preludeStart + lead] ?? 1,
              );
              if (reg !== null) registrations.push(reg);
            }
            // An at-rule is transparent to nesting: its children still resolve
            // against the at-rule's own parent, not against the at-rule. NOT
            // transparent to palette context: a colour-scheme media query is
            // the one at-rule whose condition selects a palette, so the value
            // it names is carried onto the root scopes below and inherited by
            // everything nested inside, the nearest condition winning.
            const ownScheme = colorSchemeOf(rawSelector);
            walk(bodyStart, i, parent, ownScheme ?? scheme);
            // Declarations written DIRECTLY in a nested at-rule body belong to
            // the parent rule's subject, conditionally — `:root { @media print
            // { --p: … } }` declares `--p` on `:root`. Reported under that
            // parent, which is the same answer the flat `@media print { :root {
            // --p: … } }` already gets; dropping them would be the silent loss
            // this file's header promises against.
            if (parent !== null) {
              const conditional = readDeclarations(body, bodyStart, lines);
              const parentMatches = classifySelectors(parent, recognition);
              references.push(
                ...readReferences(
                  body,
                  bodyStart,
                  lines,
                  parent,
                  parentMatches.map((m) => m.kind),
                ),
              );
              if (conditional.length > 0) {
                for (const { kind, theme, matchedSelector } of parentMatches) {
                  scopes.push({
                    kind,
                    selector: parent,
                    matchedSelector,
                    theme,
                    // The condition these declarations are live under is THIS
                    // at-rule — and only this at-rule: an enclosing
                    // non-scheme condition (say `print` wrapping the
                    // colour-scheme one) is not modelled, so carrying the
                    // outer context here would claim more than is known. Only
                    // a root scope carries it; only the resolver's root fold
                    // ever read it.
                    ...(kind === "root" && ownScheme ? { colorScheme: ownScheme } : {}),
                    line: lines[blockStart] ?? 1,
                    declarations: conditional,
                  });
                }
              }
            }
          } else {
            // A qualified rule (`selector { … }`). At the top level its
            // closing is the boundary past which `@import` is dead text, so
            // the collector above stops collecting from here on.
            if (topLevel) sawQualifiedRule = true;
            const declarations = readDeclarations(body, bodyStart, lines);
            references.push(
              ...readReferences(
                body,
                bodyStart,
                lines,
                selector,
                matches.map((m) => m.kind),
              ),
            );
            if (declarations.length > 0) {
              // One scope per recognised selector in the list: a
              // `:root, [data-theme="dark"]` block IS both scopes.
              for (const { kind, theme, matchedSelector } of matches) {
                scopes.push({
                  kind,
                  selector,
                  matchedSelector,
                  theme,
                  // The palette context this block is live under — non-null
                  // only inside a colour-scheme media query, and attached to
                  // the root kind only, which is the kind whose fold the
                  // resolver must not perform.
                  ...(kind === "root" && scheme ? { colorScheme: scheme } : {}),
                  line: lines[blockStart] ?? 1,
                  declarations,
                });
              }
            }
            // Then the nested rules this body contains, under their own subject.
            walk(bodyStart, i, selector, scheme);
          }
          preludeStart = i + 1;
          blockStart = -1;
        }
        i += 1;
        continue;
      }
      if (depth === 0 && ch === ";") {
        // A statement at-rule. `@import` is the one whose prelude carries DATA
        // — the URL this file is composed from — so it is collected rather
        // than discarded, but only where CSS makes it live (see the
        // `sawQualifiedRule` note above; nested walks are never top level, so
        // an `@import` inside a block is never collected either). Every other
        // statement at-rule (`@charset`, a `@layer` statement) is still
        // nothing to collect.
        if (topLevel && !sawQualifiedRule) {
          // The region since the previous statement starts with whatever
          // whitespace separated them, so the @import test runs on the
          // TRIMMED prelude — and `lead` is what dates the statement to its
          // own line, not the blank line before it (the same
          // leading-whitespace skip `readPairs` uses to date a declaration).
          const prelude = css.slice(preludeStart, i);
          const trimmed = prelude.trimStart();
          if (/^@import\b/i.test(trimmed)) {
            const specifier = importSpecifierOf(trimmed);
            if (specifier !== null) {
              const lead = prelude.length - trimmed.length;
              imports.push({ specifier, line: lines[preludeStart + lead] ?? 1 });
            }
          }
        }
        preludeStart = i + 1;
      }
      i += 1;
    }
  };

  walk(0, css.length, null, null, true);
  // The recognised-theme inventory: the resolver's own theme-name derivation
  // (attribute themes and the `.dark`/`.light`/configured class pair) plus the
  // colour-scheme themes the media query names, read off the scopes the walk
  // pushed. An inventory for the loader — see {@link Stylesheet.themes}.
  const themeNames: string[] = [];
  const seenThemeNames = new Set<string>();
  for (const scope of scopes) {
    const name =
      scope.kind === "theme"
        ? scope.theme
        : scope.kind === "root"
          ? (scope.colorScheme ?? null)
          : null;
    if (name === null || seenThemeNames.has(name)) continue;
    seenThemeNames.add(name);
    themeNames.push(name);
  }
  return {
    scopes,
    references,
    imports,
    ...(registrations.length > 0 ? { registrations } : {}),
    ...(themeNames.length > 0 ? { themes: themeNames } : {}),
  };
}

const PROPERTY_PRELUDE = /^@property\s+(--[\w-]+)$/i;

/**
 * The registration an `@property` prelude and body describe, or `null` when the
 * prelude is not a well-formed `@property --name`. Descriptor names are
 * case-insensitive; a descriptor written twice keeps the last, as a browser's
 * declaration list does. Empty `syntax` / `initial-value` are treated as not
 * written.
 */
function readRegistration(
  prelude: string,
  body: string,
  bodyStart: number,
  lines: number[],
  line: number,
): Registration | null {
  const m = prelude.match(PROPERTY_PRELUDE);
  if (!m) return null;
  const descriptors = new Map<string, string>();
  for (const p of readPairs(body, bodyStart, lines)) {
    descriptors.set(p.property.toLowerCase(), p.value);
  }
  const syntaxRaw = descriptors.get("syntax")?.trim().replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  const initial = descriptors.get("initial-value")?.trim();
  const inherits = descriptors.get("inherits")?.trim();
  return {
    name: m[1] as string,
    line,
    ...(syntaxRaw ? { syntax: syntaxRaw } : {}),
    ...(inherits ? { inherits } : {}),
    ...(initial ? { initialValue: initial } : {}),
  };
}

/**
 * The URL an `@import` prelude names — quotes or a `url(…)` wrapper stripped,
 * any media query after it dropped — or `null` when the prelude names no plain
 * URL.
 *
 * Both spellings extract, with or without a media suffix:
 * `@import "./tokens.css";` and `@import url("./tokens.css");` yield
 * `./tokens.css`; `@import "tailwindcss" screen;` yields `tailwindcss` — which
 * the LOADER, not this function, decides what to do with. An empty URL, a
 * prelude that is not an import at all, and a `url()` carrying neither a plain
 * nor a quoted token all return `null` and collect nothing: inventing a
 * specifier for a prelude the source did not clearly write would be a guess
 * printed as data.
 */
function importSpecifierOf(prelude: string): string | null {
  const rest = prelude.replace(/^@import\b/i, "").trim();
  if (rest === "") return null;
  const urlForm = rest.match(/^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)/i);
  if (urlForm) {
    const spec = (urlForm[1] ?? urlForm[2] ?? urlForm[3] ?? "").trim();
    return spec === "" ? null : spec;
  }
  const quoted = rest.match(/^"([^"]*)"/) ?? rest.match(/^'([^']*)'/);
  const spec = (quoted?.[1] ?? "").trim();
  return spec === "" ? null : spec;
}
