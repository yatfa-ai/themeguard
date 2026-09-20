# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: 0.1.1 — one command, and a library.** `themeguard <file.css>` audits a stylesheet from a
> terminal, and the same nine rules are importable as functions. The package ships compiled output
> (`dist/`); the calibration fixture and the tests stay in this repository and out of the tarball.

## The nine questions

1. **Value collisions** — two variables that must differ hold byte-identical colours.
   A real one: `--app-border` equalled `--app-surface-raised`, so a panel's 1px border was literally
   invisible. It survived three and a half months and was worked around with a third token rather
   than fixed.
2. **Dead variables** — declared, referenced nowhere.
3. **Ramp collapse across themes** — `--text-muted` and `--text-faint` must stay apart by eye. If they
   converge in one theme, the text hierarchy is gone. Measured in CIE L\* (ΔL\* ≥ 4), **not** in
   contrast ratio: two adjacent surfaces a visibly distinct step apart still sit around 1.2:1.
4. **Family consistency across themes** — when a theme re-declares part of a token family but not all
   of it, the member it skips silently keeps the base theme's value. A dark-tuned green flowing into a
   light theme beside the light theme's own re-tuned siblings is exactly the defect that accumulates
   rather than appears; the finding cites the overridden siblings as the evidence, and the per-theme
   **coverage** inventory behind it is printed as facts — which tokens each theme re-declares, and
   which it inherits, colour and non-colour.
5. **Unresolved references** — a `var()` naming a custom property that **no scope declares**. The
   property resolves to nothing: it falls back to unset or inherited, or to whatever fallback was
   written — so a typo'd name, a fallback pointing at nothing, a declaration built on a name nobody
   wrote and an alias chain into a typo all pass silently today. The finding is one per name, lists
   every use site, and stays factual: no did-you-mean guessing, and `@theme inline` declarations
   count as declaring, so an alias that exists is never reported.
6. **Cycle references** — a `var()` chain that returns to a name already on it. Per CSS
   custom-property semantics every property in the loop — and every `var()` consuming a member — is
   invalid at computed-value time, yet the shape audits green: `dead-token` is silent (the names ARE
   referenced, by each other) and `unresolved-reference` is silent (they ARE declared). The closing
   edge counts wherever it is written: the whole value (`--a: var(--b)`) or **embedded in a compound
   one** (`--divider: 1px solid var(--divider-color)`, `calc(var(--x) + 2px)`,
   `color-mix(in srgb, var(--a) 15%, var(--b))`) — the shapes most real token values are written in.
   The reference read from a compound value is each `var()` call's **primary** argument; a name
   inside a `var()`'s own fallback segment is not a scanned edge, because reading one would close a
   loop on the wrong iteration — `--a: var(--b, var(--a))` would report `--a → --a` and lose the real
   `--a → --b → --a`. A loop whose every member carries a compound value — `--a: 1px solid var(--b);
   --b: 2px solid var(--a)` — stops every walk short of the circuit, so it is minted **names-only**:
   the declared primary-position edges form the loop's graph, its members carry the same
   `cycle` fact and the same finding as any other loop, and a declaration that merely consumes a
   member is reported as its own dependent walk. One residual follows from that constraint and is
   pinned rather than papered
   over: the whole-value walk DOES follow a fallback when the primary is undeclared, so
   `var(--nope, var(--a))` is reported and `1px solid var(--nope, var(--a))` is not. The finding is
   one per loop per author: a loop the base declarations (or the `@theme inline` alias namespace)
   author is reported once for the stylesheet, and a loop a theme's own declarations close is
   reported for that theme — a theme that merely inherits a root-authored loop never re-reports it.
7. **Duplicate declarations** — one name declared **twice in one scope** with differing values. The
   cascade keeps the last declaration and silently discards the rest, so the file the author reads
   says one thing and the browser paints another; until this rule the shape audited green, and the
   report's own coverage inventory even deduped it into one token. The finding is one per source
   block, names the shadowed and the winning site with both values, and is deduped across the two
   scope halves a selector-list prelude (`:root, [data-theme="dark"] { … }`) yields. A cross-scope
   override — `:root` beside `[data-theme="dark"]` — is the theme system working and never fires,
   and a same-value repeat resolves to the identical cascade outcome, so it never fires either.
8. **Unresolved imports** — a **relative `@import` whose target is missing or unreadable**. The
   audit unit is the file's import closure, so a failed edge breaks the audited document's own
   composition — and until this rule the failure was swallowed silently, so `@import "./toens.css";`
   (a one-character path typo) printed `No findings.` and exited 0 while every declaration inside
   the file it names stayed invisible to the audit. Every other tool in the chain notices the
   breakage: postcss-import, vite and webpack error on a missing relative file at build time, and a
   browser fails the request. The finding is one per failed edge, names the specifier exactly as
   written, the resolution outcome (`missing` / `unreadable`) and the statement's own position —
   cited by file when the statement lives in an imported sheet. Bare package specifiers, absolute
   paths and URLs are still not findings (package resolution is a build step, not a source read),
   and an import cycle is still not one either — a browser dedupes an already-applied stylesheet
   the same way, and the closure audits.
9. **Theme-partial tokens** — a custom property declared only inside ONE theme's block is absent from
   every other theme's view, and a declaration chain in such a view that reaches for it ends unresolved:
   the property falls back to unset or inherited. The tool's earlier silence had a precise shape —
   resolution is per-theme, but rule 5 asks a stylesheet-wide question, so a name declared anywhere was
   a lookup hit everywhere. The finding is one per missing name (never per consumer or per theme),
   carries `theme: null`, and names all four halves: the token, the themes that declare it (with their
   declaration sites), the views it never reaches, and the chains that break. **Not detected:** a
   component rule's direct `var()` (`.code-block { background: var(--app-code-bg) }`, no declaration
   chain) mints no unresolved token, so it is out of scope by design — a consumer written *inside* the
   declaring theme's own selector (`[data-theme="dark"] .card { … }`) is correct CSS, and telling the two
   apart needs selector-prefix reasoning the parser deliberately does not do. Reporting correct CSS as a
   defect is worse than this silence, so the chain face — which the resolver itself vouches for — ships,
   and the consumption face is recorded as a residual rather than guessed at.

Defects like these accumulate rather than appear. Over eight months of one growing project's CSS the
palette went 23 → 73 tokens and collisions went 0 → 7. (That figure predates the rule; running
`collision` over the same stylesheet today reports 11 across its two themes — see the table below for
how many candidates that is filtered down from.)

## What themeguard does *not* do

Contrast of text against its background in a rendered page. [axe-core](https://github.com/dequelabs/axe-core)
does that, does it better, and has ten years of edge cases in it. Use axe for the rendered page and
themeguard for the stylesheet; they answer different questions.

## Scope

Any CSS that declares custom properties — `:root`, `[data-theme="…"]`, and Tailwind v4's
`@theme inline` alike. No framework required and no browser required. SCSS `$variables` are compiled
away before themeguard sees anything: point it at the compiled CSS and it works, but the link back to
the source names is lost.

An OS-preference palette is a theme of its own, not a shadow over the base. `@media
(prefers-color-scheme: dark) { :root { … } }` — how GitHub Primer, shadcn and plain-vanilla dark mode
all write it — resolves as a `dark` theme beside `root`, with the same declared/inherited split as any
attribute theme. That is what keeps a defect that exists only in the light palette reachable, and an
attribute theme's inherited values resolving to the real base rather than to the dark block's
overrides: a media-conditioned block does not cascade over `:root`, both are live, selected by the OS
setting. The theme is named for the feature value; a stylesheet that *also* declares
`[data-theme="dark"]` is stating the dark palette twice, by attribute and by OS preference, and the
two land in one `dark` table — last declaration in source order winning, exactly as two
`[data-theme="dark"]` blocks already did. The nested writing works too:
`:root { @media (prefers-color-scheme: dark) { … } }`.

Deliberately not taken: a media prelude whose condition is more than the one feature — a comma list
(an OR of conditions), a second feature (`… and (min-width: …)`), a non-screen type (`print`) — and
`@supports`/`@layer` conditions all keep today's reading, folded into the base. A palette selected by
*part* of a compound condition is not a palette of its own; modelling that honestly needs
condition-aware tables, which this package does not pretend to have.

One file set per audit, one declared composition per file. Reference resolution does not cross files a
human merely *listed together*: `themeguard a.css b.css` audits two independent sheets, because nothing in
the source says how they relate, and a rule that guessed at a relationship would report defects in a
document nobody wrote. What does cross is what the source *declares*: an `@import` edge is composition with
CSS-defined semantics, and along it the audit reads one document — see
[Stylesheets composed with `@import`](#stylesheets-composed-with-import).

## Install

```bash
npm install --save-dev themeguard
```

## Usage

One command, one option — point it at a CSS file.

```bash
npx themeguard path/to/application.css
```

Several stylesheets take one invocation — the positionals repeat:

```bash
npx themeguard web/app.css admin/panel.css
```

Each file is audited **independently** — each through its own import closure — and each prints its own
report under its own `themeguard — <path>` header: the config governing a stylesheet — the nearest
`themeguard.config.json` beside it or above it — governs that stylesheet alone, and one POSITIONAL's
tokens are invisible to the next. Files named together on a command line state
no relationship, and none is invented; the only thing that crosses is what a file's own text declares,
along the `@import` edges
[Stylesheets composed with `@import`](#stylesheets-composed-with-import) covers. The invocation fails
fast on the first file that cannot be audited (unreadable, an unhonourable config beside it or above it, a
malformed directive in it): the reports already printed stand, and the error names the file that
stopped the run. Otherwise the per-file outcomes aggregate into **one exit code for the
invocation**, precedence `2 > 1 > 0` — any file errored, `2`; else any file reported unsuppressed
findings, `1`; else `0`. A pipeline or pre-commit hook gets one invocation and one verdict over a
whole project's stylesheets, instead of N runs and a hand-ORed aggregate that one mistyped path
silently poisons.

### `--json` — the report as data

`--json` is the one option. It replaces the prose on stdout with **NDJSON** — one compact JSON object
per stylesheet, written as that file completes, in argument order:

```bash
npx themeguard --json src/*.css
```

The object is the **same report the library returns**, verbatim, with the audited `path` in front of it:
`findings` (each with its `rule`, `theme`, `tokens`, `message`, `evidence` and — where the rule has a
position to give — its `sites`, each naming a token, a line and the imported file it was spliced from),
`countsByRule`, `suppressed`, `unmatchedSuppressions`, `suppressedDisabled` (the policy's findings
set-aside: `{finding, rule, reason}` rows, the reason the policy's own marker, verbatim — see
[Turning a rule off for the project](#turning-a-rule-off-for-the-project--suppress-rule)), `skipped`
(each row's `reason` one of
`translucent` / `not-a-color` / `absent` / `unresolvable`, and an `absent` row carrying the additive
`declaredIn` pointer — **absent**, never `null`, on every other reason), `skippedDisabled` (the skipped
channel's own policy set-aside, `{skipped, rule, reason}` rows carrying the pair whole — empty, not
absent, wherever no rule is off, exactly like `suppressedDisabled`) and `coverage`. Nothing is
renamed, summarized or dropped. The prose renderer is a lossy projection of that object — sites become
clause text, evidence becomes sentence fragments, scopes become bracket suffixes — so a caller that
wanted *which file, which token, which line* had to scrape sentences shaped for people.

One key is the CLI's own rather than the library's, and it is additive: an `unmatchedSuppressions` row
whose judgement names a live finding in another file of the closure carries `crossFileAim`, `{rule,
site}` — the machine form of the prose's `— matches a live …` clause, so the pointer is read as data
instead of regexed out of a sentence. The key is **absent** (never `null`) on every row without one, the
same absence-is-a-fact discipline `sites` carries. A second such key rides the same discipline:
`themelessAim`, `{rule}` — the machine form of the dead-theme-scope clause, on a row whose `theme` scope
names a rule that reports no theme at all. See
[When a judgement matches nothing](#when-a-judgement-matches-nothing--unmatched-n).

It composes with `jq` the way a per-line stream should:

```bash
themeguard --json src/*.css | jq -c 'select(.findings | length > 0)'
themeguard --json src/*.css | jq -r '.path as $p | .findings[] | "\($p): [\(.rule)] \(.message)"'
```

Three properties a pipeline caller may rely on:

- **The exit codes are unchanged.** The flag adds a channel; it does not move the verdict. Branch on the
  number exactly as today, and parse stdout for the detail behind it.
- **stdout is never mixed.** It is either pure prose or pure NDJSON — usage errors, unreadable files, an
  unhonourable config and a malformed directive stay on **stderr as prose** in both modes — so every line
  of a `--json` run parses without a mode check.
- **Fail-fast keeps the lines already written.** The first file that cannot be audited ends the invocation
  with `2`, and the JSON lines for the files before it are already on stdout — which is why this is NDJSON
  rather than one array, whose closing bracket a fail-fast run never reaches.

The flag is accepted in any position among the paths, and repeating it changes nothing. There is no short
alias. Everything that is not `--json` is a positional, exactly as before — an unknown `--flag` is read as
a path and fails as one — and `themeguard --json` with no stylesheet is the usage error it has always
been, never a silent success.

Run over this repository's own calibration fixture (a real 97 KB Tailwind stylesheet with two themes,
vendored at `tests/fixtures/application.tailwind.css`), it prints:

```
themeguard — tests/fixtures/application.tailwind.css

collision (11)
  [collision] --app-border and --app-surface-raised both resolve to #1E293B in theme "root". They are separate roles, and theme "winter" declares them apart — so this theme is repainting one with the other. Declared at lines 41 and 33.
  [collision] --app-cta and --app-success both resolve to #22C55E in theme "root". They are separate roles, and theme "winter" declares them apart — so this theme is repainting one with the other. Declared at lines 29 and 54.
  … 9 more, across both themes

dead-token (2)
  [dead-token] --topbar-height is declared at :root:402 and no var() in this stylesheet references it.
  [dead-token] --transition-slow is declared at :root:407 and no var() in this stylesheet references it.

scale-collapse (2)
  [scale-collapse] --app-accent-ink-hover is ΔL* 3.90 from --app-accent-ink in theme "root" — under the 4 needed for a visible step, so the hover state is not distinguishable from the resting one. Declared at lines 376 and 375.
  [scale-collapse] --app-accent-ink-hover is ΔL* 3.45 from --app-accent-ink in theme "winter" — under the 4 needed for a visible step, so the hover state is not distinguishable from the resting one. Declared at lines 551 and 550.

family-consistency (7)
  [family-consistency] --app-cta-solid-hover is inherited from :root in theme "winter" (resolving to #4ADE80) while the same theme declares --app-cta, --app-cta-hover — the theme tunes this family, so the member it does not re-declare silently keeps the base value. Declared at line 312.
  [family-consistency] --app-success is inherited from :root in theme "winter" (resolving to #22C55E) while the same theme declares --app-success-border, --app-success-on-surface, --app-success-soft, --app-success-surface, --app-success-toast-surface — the theme tunes this family, so the member it does not re-declare silently keeps the base value. Declared at line 54.
  … 5 more

unresolved-reference (0)

cycle-reference (0)

duplicate-declaration (0)

unresolved-import (0)
theme-partial-token (0)

skipped (0)
  nothing skipped — every pair rule 3 derived was measurable.

suppressed (0)
  nothing suppressed — every finding above is one the report stands behind.

unmatched (0)
  nothing unmatched — every recorded judgement still covers a finding this report carries.

suppressed-disabled (0)
  nothing disabled by policy — every finding above was reported by a rule the project has not turned off.

coverage (2 themes, 73 base tokens)
  root: declares all 73 base tokens, inherits 0.
  winter: declares 51 of 73 base tokens, inherits 22 (8 color / 14 non-color).
    [inherited] --app-success (color)
    [inherited] --app-focus-ring-width (non-color)
    … 20 more — every base token each theme inherits, named

22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.
```

Four things in that output are deliberate and worth reading.

**All nine rule headings print even at zero.** A rule that reports nothing and a rule that did not run
look identical if the heading is omitted, and "nothing here" reads as a pass.

**`skipped` is a section, not a silence — and each row says WHICH silence.** A pair rule 3 could not
measure is *unmeasured*, which is not the same claim as *clean*. Those pairs are counted and named, and
they do **not** change the exit code: they are not findings. Four reasons, split on the arms the skip
branch's own condition already evaluates rather than on a second classification beside it:

| `reason` | What it says |
|---|---|
| `translucent` | Both members are colours, at least one with alpha < 1. A translucent colour has no lightness until it is composited, and themeguard never invents a backdrop. |
| `not-a-color` | Both members **resolve**, at least one to a value that is not a colour — a length, a duration, a shadow list. |
| `absent` | At least one member is not in this theme's view at all: a `:root` declaration flows into every theme, so a miss means the name lives **only in a sibling theme's block**. The row then names that scope and each member's line — `absent — the pair is declared only in theme "winter" (--card-bg at line 10, --card-bg-hover at line 11)`. Under `--json` the same pointer rides an additive `declaredIn` key, **absent** (never `null`) on every other reason. |
| `unresolvable` | Both members are in the view and at least one `var()` chain found nothing, or came back around. The report's own `unresolved-reference` / `cycle-reference` sections — and coverage's `N unresolved` segments — already say what broke; this row now agrees with them instead of contradicting them. |

The last two used to be reported as `not-a-color`, which asserted something about a value the view did
not have. Splitting them changes no count, no finding and no exit code: the rows already existed, and
only the words they say about themselves changed.

**`coverage` is facts, not findings.** Inheriting a token is normal — focus geometry, control sizing and
transitions are theme-independent on purpose — so the inventory never moves the exit code. It is printed
under the same discipline as `skipped` (counted, named, headline even at zero) because a theme that
silently receives a value is a fact a reader needs before the `family-consistency` findings above it make
sense; the findings are the judgement, the inventory is what they are judged against.

**`suppressed` is what you, not the tool, decided.** The section headline prints even at zero, under the
same discipline as `skipped` and `coverage` — an empty `suppressed` section is the visible proof that
nothing was set aside. When a `themeguard.config.json` governs the stylesheet — beside it, or the nearest
one in a directory above (see the next section) — its findings move here with their reasons quoted: out of
the counts and the exit code by declaration, never by silence.

**`unmatched` is what your judgements have to say about this run.** The complement of `suppressed`:
declared entries — config or directive — that no finding matched, named with their reasons so a
judgement that has outlived its defect announces that instead of going silent. It prints even at zero,
and like `skipped` and `coverage` it never moves the exit code. See
[When a judgement matches nothing](#when-a-judgement-matches-nothing--unmatched-n).

**`suppressed-disabled` is what your project policy decided.** The complement of the per-finding ledger:
findings reported by a rule the project turned OFF in the config's `suppress-rule` key. Where
`suppressed` records a judgement about one finding, this section records a judgement about a RULE —
"we have looked at what this rule says about this project and judged it not-a-defect" — which no list of
per-finding entries can say. It prints even at zero, under the same discipline as `skipped`, `coverage`
and `suppressed`: an empty section is the visible proof that no rule is off. Its findings leave the
counts and the exit code and carry the policy's own marker instead of a quoted reason — the policy names
rules, not prose. See
[Turning a rule off for the project](#turning-a-rule-off-for-the-project--suppress-rule).

### Stylesheets composed with `@import`

A stylesheet composed from others — `@import "./tokens.css";` at the top of an application sheet — is ONE
document as far as CSS is concerned, and since 0.1.10 the audit reads it as one. `themeguard` follows the
`@import` edges the entry file's text declares and audits the whole **import closure**: a token declared in
an imported file is declared for the composing sheet's rules, and a token the composing sheet reaches with a
`var()` counts as referenced in the imported file. Without this, each file's audit lied about the other —
the composer reported every imported token as an unresolved reference, and the imported file reported its
own tokens as dead the composer was using.

What is followed, and what is deliberately not:

- **Followed:** relative specifiers — `./tokens.css`, `../shared/props.css` — written either way CSS writes
  them, `@import "./x.css";` or `@import url("./x.css");`, with or without a media suffix. Each target is
  resolved against the directory of the file whose text carries the statement, transitively, and spliced at
  the statement's position: imported rules first, the author's own after, so an importing file's
  re-declaration of an imported name wins exactly as the cascade says — and the resolver reads that merged
  document order, never per-file line numbers, which restart at 1 in every file and would silently hand the
  cascade to whichever block happened to sit deeper in its own file.
- **Skipped, silently, and never a finding:** bare package specifiers (`@import "tailwindcss"` — package
  resolution is a build step, not a source read), absolute paths and URLs. Their silence is deliberate
  and unchanged: the specifier may well resolve at build time, and reporting every bundler-handled
  path as a defect would drown the report in noise.
- **Reported:** a **relative** specifier whose target is missing or unreadable. That failure used to be
  swallowed silently too — so a sheet whose own composition could not load audited green, a
  one-character path typo shipped `No findings.` at exit 0 — while every other tool in the chain
  reports it. Since 0.1.14 the loader records each failed relative edge (with the specifier as
  written, the statement's line, the containing file, and whether the target is `missing` or
  `unreadable`), and rule 8, `unresolved-import`, turns the record into findings that move the exit
  code. An edge broken two hops in is named with its own from-file. This is the boundary of the
  audit's file-graph interest: edges the source declares are judged; files nothing imports are never
  checked.
- **Cycle-proof:** `a.css` importing `b.css` importing `a.css` terminates — a visited set splices each file
  once, however many edges point at it.
- **Cited by file:** a finding whose site lives in an imported file names the file —
  `declared at tokens.css:3` — instead of a bare `selector:line` whose line number would point into whichever
  file the reader had open. The same rule governs every rule's `Declared at …` clause: one finding's
  positions can now sit in two files, so a clause containing any imported position cites each site
  independently (`Declared at tokens.css:3 and line 7.`) rather than pooling bare line numbers that may not
  even share a file. Sites in the entry file render exactly as they always have.
- **Governed by the root's config:** `themeguard.config.json` sits beside the stylesheet you point the
  command at — or at the nearest directory above it holding one — and an unscoped entry matches by rule,
  token and theme — it has no file axis at all — so one judgement written beside the root governs findings
  living anywhere in the closure. A file-scoped entry (0.1.11's `file` field) governs the same span by
  naming it: the stylesheet it names is the ENTRY
  stylesheet, the closure's root, so whatever the invocation audited, the entry covers. `themeguard-ignore` directives are the opposite:
  a judgement written at one site of one file. Since 0.1.19 they are read from EVERY file of the closure —
  each imported file's directives stamped with that file's name — so a directive matches the sites of the
  file it was written in, by line, and never a finding from another file whose line merely coincides. The
  old entry-only fence survives as exact file matching rather than a rule about the entry: an entry-file
  directive still matches only entry-file sites (where an imported finding's line can coincide with it,
  the finding still reports and the directive is named `unmatched`), and an imported file's directive can
  never silence the entry or a sibling — only the file that carries it.

`@import` is the one cross-file relationship that is *declared in source*, which is why it is the one that is
followed: CSS defines the semantics, and the tool invents nothing. The genuinely unknown relationships — a
list of files passed on a command line, a bundler's virtual sheet, a sibling file with no import edge — stay
out of scope: `themeguard` audits one closure per invocation, and rule 5's honesty about what it cannot see
starts at that boundary.

### Suppressing deliberate findings — `themeguard.config.json`

The audit is calibrated to report what it measures, not what it approves of — so a real stylesheet that
documents its own deliberate choices (a hover intentionally a hair off its resting colour, a warning fill
that legitimately equals its border) reports them every run. To agree with the audit *with exceptions*,
put a `themeguard.config.json` **next to the stylesheet** — or in the nearest directory above it that
holds one:

```json
{
  "suppress": [
    { "rule": "scale-collapse", "token": "--app-accent-ink-hover", "reason": "deliberately subtle hover" }
  ]
}
```

Scoped entries — a deliberate collision pair in one theme, and nothing else:

```json
{
  "suppress": [
    {
      "rule": "collision",
      "tokens": ["--app-cta", "--app-success"],
      "theme": "root",
      "reason": "the cta is deliberately the success colour, in the base palette only"
    }
  ]
}
```

A file-scoped entry — a judgement recorded against one stylesheet of a directory that shares one config
(the config may sit in the stylesheet's own directory, or any directory above it — see Discovery below):

```json
{
  "suppress": [
    {
      "rule": "collision",
      "tokens": ["--accent", "--primary"],
      "file": "tokens.css",
      "reason": "brand tokens are identical by design"
    }
  ]
}
```

Each entry names the `rule` that reports the finding, a token dimension, an optional scope, and the
`reason` — which the report quotes back. Matching is against the finding's structured fields (`rule`,
`theme`, `tokens`), never against message prose — plus the stylesheet the entry names, when it names
one, compared against the file being audited. A suppressed finding leaves the per-rule counts and the
exit code, and moves to its own `suppressed (N)` section — counted, named, reason quoted, never silently
dropped, under the same discipline as `skipped`.

**Scope an entry, or it reaches everywhere.** An entry names its token dimension either as the scalar
`token` — any one token the finding carries — or as the `tokens` array — a set the finding must carry in
FULL, which is how a deliberate collision *pair* is recorded as one entry rather than a stroke across
every finding that happens to carry one of its members. An entry may also carry `theme`, narrowing it to
findings measured in that one theme — so a deliberate equality in your base palette never silences the
same question in a `prefers-color-scheme` or `[data-theme=…]` theme, where the equality may be a real
defect. A theme-scoped entry never matches a finding that is not about a theme at all (a dead token is
measured stylesheet-wide) — and since that is true of five of the nine rules by construction, a `theme`
scope on one of them is a scope that can never match anything, which the report now says on the entry's
own line rather than advising retirement; see
[When a judgement matches nothing](#when-a-judgement-matches-nothing--unmatched-n).
And it may carry `file` — the stylesheet the judgement was recorded against,
relative to the config's own directory — narrowing it to findings reported for that ONE stylesheet. This
is what makes a shared-config directory honest: when `styles/` keeps one `themeguard.config.json` beside
`tokens.css` and `buttons.css`, an entry with `"file": "tokens.css"` suppresses the brand collision it
was written about and says nothing about buttons.css's findings — the header's own sentence, "a
suppression is worth exactly the file it was recorded against", true by declaration rather than by
accident of where the config sits. The config's directory is where the spelling is anchored, wherever
discovery found it: with the ledger at `styles/` governing `styles/components/` too, `"file":
"components/card.css"` names card.css relative to `styles/`, and fires on the component file the
judgement was recorded against. That home is also the field's boundary: a config governs its own
directory and below, so a scope naming a file OUTSIDE that subtree can never be honoured — no stylesheet
any run of this config audits sits beyond its reach — and the `unmatched` section says so rather than
offering retirement advice about a file that cannot exist. `file` must be RELATIVE — an absolute path
would make the same config mean different things from different checkouts, so it exits `2` naming the
entry, as would an empty or
non-string one. Omitted keys are the unscoped reading: `token` alone, no `theme`, no `file` — exactly
what one-line configs have always meant. A scoped entry says so in the report, where its finding is
printed:

```
  [suppressed] [collision] --accent and --success both resolve to #ff0000 in theme "root". … — "cta deliberately equals success" [theme: root, tokens: --accent, --success]
```

`rule` and `reason` and one of `token`/`tokens` are required, and a config the package cannot honour — an
unknown rule id, a missing token dimension, `token` AND `tokens` together (two spellings of one
dimension), an empty `tokens` array (which would match every finding), a malformed `theme`, unreadable
JSON — exits `2` naming the offending entry: a config that silently did nothing — or silently did too
much — would leave you believing a finding was marked deliberate when it was reported after all. A
malformed `file` — empty, non-string, or ABSOLUTE — is the same refusal, for the same reason: the field
must mean the same stylesheet from every checkout this config travels through.

**Discovery is nearest-ancestor, deliberately.** The config is found by walking UP from the directory of
the stylesheet you point the command at — that directory first, then each parent, bounded at the
filesystem root — and the FIRST `themeguard.config.json` on that walk governs. Nearest wins, the
`eslint`/`tsconfig`/`.editorconfig` prior, and never the process working directory — so the same command
means the same thing no matter where it is invoked from. The walk is what lets one ledger govern a
SUBTREE: a config at `styles/` reaches `styles/components/` too, so the standard component-library layout
(theme tokens at the root, components one directory down) is one config, not a copy per directory — and a
config beside the stylesheet is still the walk's first hop, so every layout that put it there keeps
byte-identical behaviour, shadowing anything an ancestor might carry. No config anywhere up the tree
means no suppression at all: no existing line of the report changes, the exit codes are unchanged, and
the only difference from a run without the feature is the counted `suppressed` section appended at zero —
with its `unmatched` complement beside it, also at zero.

### Turning a rule off for the project — `suppress-rule`

An entry judges ONE finding. Some judgements are about a RULE — "we have looked at what `dead-token`
says about this project and judged it not-a-defect" — and no ledger of per-finding entries can say that:
the answer is wholesale, and writing it one entry at a time is one entry per finding per regeneration of
every generated sheet the rule fires on. The config's second top-level key is that judgement — an array
of rule ids, each of which stops reporting for every stylesheet this config governs:

```json
{
  "suppress-rule": ["dead-token"]
}
```

A rule named there does not report: its findings leave the per-rule counts (the rule's entry reads `0`
— the key stays, the population moved) and leave the exit code, and are printed instead in the counted
`suppressed-disabled (N)` section, one row per finding under the policy's own marker:

```
suppressed-disabled (2)
  findings reported by a rule the project turned off — its id is named in the "suppress-rule" key of themeguard.config.json. Counted here, named below — out of the counts and the exit code by project policy, never by silence.
  [disabled by policy] [dead-token] --topbar-height is declared at :root:402 and no var() in this stylesheet references it.
  [disabled by policy] [dead-token] --transition-slow is declared at :root:407 and no var() in this stylesheet references it.
```

The rows carry no quoted reason, deliberately: the policy names rules, not prose. Where a `suppressed`
row quotes the reason a human gave for ONE finding, a policy row shows the one judgement the project
made about the RULE — the same for every finding it reported. There are exactly two ways a finding can
leave the counts — a judgement about the finding (`suppress`, or a directive), and a judgement about its
rule (`suppress-rule`) — and the report names which one took it.

The promise covers the rule's WHOLE output, and one rule has two channels: `scale-collapse` is the one
rule that returns findings *and* skipped pairs (every other rule reports findings only), so a disabled
`scale-collapse` stops reporting into `skipped` too. Its skipped pairs move onto the counted
`skippedDisabled` leg in `--json` and print in the skipped section under their own headline — counted,
because a policy making unmeasurable pairs vanish silently would reproduce exactly the
silence-reads-as-a-pass the skipped section exists to prevent:

```
skipped (0)
  nothing kept here — every pair rule 3 derived was set aside below by project policy, not found measurable.
skipped-disabled (1)
  skipped pairs a rule the project turned off in the "suppress-rule" key of themeguard.config.json also reported — counted here, named below, out of this section by project policy and never by a measurement: the pairs are exactly as unmeasured as they were, and the rule is off whole, its findings set aside under suppressed-disabled just as its pairs are set aside here.
  [disabled by policy] [skipped] --scrim-hover against --scrim in theme "root": translucent
```

The row keeps the skipped vocabulary — state, base, theme, the pair's own reason, the sibling-scope
clause — with the policy's marker in front, because WHO removed the pair from the kept list is the fact
the row exists to state. The set-aside prints only when it holds rows — a permanently-printed empty
headline would change every report a config without `suppress-rule` produces — and the kept section's
zero line knows the difference: with a populated set-aside it names where the pairs went, instead of
asserting a measurability the run never established.

The policy composes with the ledger: an entry judges the findings a rule still reports, the policy
decides whether the rule reports at all, and the two answer different questions. A rule whose findings
are all noise TO THIS PROJECT is policy work; a finding inside a live rule you have personally judged is
entry work. Both keys in one config is the ordinary shape:

```json
{
  "suppress": [
    { "rule": "collision", "tokens": ["--accent", "--primary"], "reason": "brand tokens are identical by design" }
  ],
  "suppress-rule": ["dead-token"]
}
```

Validation is the same strict, never-silently-ignored discipline as `suppress`: the key must be an
array, and every element must be a rule id — the SAME list an entry's `rule` field validates against, so
the two spellings of "a rule this package knows" cannot drift apart. An unknown id exits `2` naming the
element (`element 2 of "suppress-rule": unknown rule "no-such-rule" — expected one of …`), because a
policy the tool silently ignored is a user who believes a rule was off while its findings were reported
after all. An empty array is legal and disables nothing, and an absent key is byte-identical to the
one-key config — no existing line of any report changes.

One interaction deserves its name: a `suppress` entry (or a `themeguard-ignore` directive) whose rule
the policy turned off can never match — the policy runs first, and the finding it aims at is no longer
available to claim. Such an entry lands on `unmatched`, where the retirement advice ("the defect was
fixed — retire it") would be FALSE: the rule's output prints in the report's counted policy sections,
and the judgement is one policy decision from working. The report says so instead:

```
unmatched (1)
  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.
  an entry whose rule the project turned OFF in "suppress-rule" is a further case this report CAN tell: a disabled rule reports into the counted policy sections of this report — suppressed-disabled for its findings, skipped-disabled for the pairs it could not measure — and can never match, so this judgement is neither expired nor mis-aimed — it is one policy decision away from working. Re-enable the rule, or retire the entry.
  [unmatched] [dead-token] — "reserved for the print stylesheet" [token: --unused] — [dead-token] is disabled by this project's "suppress-rule" policy, so the judgement can never match while the rule is off: re-enable the rule, or retire the entry.
```

The clause is claimed only where the disabled rule actually REPORTED on this report — into either
counted policy leg: `suppressed-disabled` for its findings, `skipped-disabled` for its skipped pairs. A
rule that is off AND silent on both channels leaves its entries' ordinary advice standing, because there
"the defect was fixed" may be exactly true. The section prints even at zero, and like every counted
section it never moves the exit code — the exit stays the unsuppressed-findings question, and findings the
project's own policy set aside are not findings the report stands behind.

### Marking it at the site — `/* themeguard-ignore … */`

The config records a judgement *next to* the stylesheet; a directive records it *in* the stylesheet, on
the line it is about — which makes it site-precise by construction:

```css
:root {
  /* themeguard-ignore collision --accent --success -- vendor brand: accent is deliberately the success green */
  --accent: #16a34a;
}

--app-cta: #22c55e; /* themeguard-ignore collision --app-cta --app-success -- the cta is the success colour, judged here */
```

The grammar is one comment: the keyword, then the rule id (one of the nine), then optional `--`-prefixed
token names — the same meaning as a config entry's `tokens` set, the finding must carry every name listed
— then a bare `--` separator and a required reason, which the report quotes back. A directive that names
no token is legitimate: there the *site* is the judgement, and every finding of that rule living at the
line is covered.

A directive covers a finding only while the finding still lives at its site — trailing on the judged
declaration's own line, or standalone on the line directly above it, the two placements
`eslint-disable-next-line` and `stylelint-disable-line` established. Refactor the code away from the
annotation and the directive orphans: nothing matches, the finding prints again and moves the exit code.
The miss is self-announcing — exactly like a config entry that matches nothing but whose finding still
exists — and deliberately not a silence. A defect FIXED rather than moved leaves no finding to announce
anything: there the orphaned judgement is named in the report's counted `unmatched (N)` section instead,
still without becoming an error. That is the property the config cannot have: its entries match a
finding's *identity*, so a judgement recorded about one line keeps suppressing after the code moves to
another. Use the config for project-level judgements; use a directive when the judgement belongs to the
file and should travel with it into vendored, regenerated or forked copies — and into every audit that
reaches the file through an `@import`, which since 0.1.19 is where the property actually lives: the
closure is the audit unit, so a vendored file is ordinarily consumed by being imported, and its
judgement is honoured exactly there. The two work together — both
merge into the same `suppressions` section, where a directive's line carries its `[file:line]` source
clause:

```
  [suppressed] [collision] --accent and --success both resolve to #16a34a in theme "root". … — "vendor brand: accent is deliberately the success green" [tokens: --accent, --success] [vendor.css:4]
```

A directive the package cannot honour — an unknown rule id, no rule id at all, a missing or empty reason,
a word in the head that is neither a rule id nor a `--` token name — exits `2` naming the comment's file
and line, in the entry file or in any imported member of its closure (the scan runs over the whole
closure as it loads, so a malformed comment one import edge away is the same hard error, never a silent
ignore), under the config's own never-silently-ignored discipline. In fact the *values* a directive may say are
validated by the config's own parser, so the two mechanisms cannot drift apart on what a suppression may
name. The keyword is recognized only in real comments: the same text inside a CSS string is prose.

### When a judgement matches nothing — `unmatched (N)`

Suppression is a standing ledger of exceptions — entries accumulate, reasons carry sign-off dates, and
nothing ever told you when one had outlived the defect it was written about. An expired entry was
invisible to every surface: nothing matched it, so nothing printed, and a config carrying dead
judgements was byte-indistinguishable from no config at all. The report therefore carries a counted
`unmatched (N)` section — the complement of `suppressed`, in declaration order — naming every declared
entry, config or directive, that no finding matched:

```
unmatched (2)
  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.
  [unmatched] [collision] — "vendor brand, signed off 2026-01-15" [tokens: --page-bg, --page-ink] [app.css:3]
  [unmatched] [scale-collapse] — "reviewed 2025-11-20, kept for the print theme" [token: --page-ink-hover]
```

Each line names the entry's rule, its declared scope (`[token: …]` / `[theme: …]` / `[tokens: …]`), its
`[file:line]` source where it is a directive, and its reason quoted — the same vocabulary a `suppressed`
line uses, because an unmatched entry is an entry like any other, only without a finding behind it. A
`suppressed` line needs no `[token: …]` segment — the finding's own message already names the tokens the
judgement covered — but an unmatched line has no finding to point at, so the token dimension is printed
there instead; without it, two entries differing only in their token would be indistinguishable.

**One unmatched entry the prose can vouch for.** The dichotomy above — expired, or mis-aimed — has a
third reading since `file` scopes exist: an entry carrying a ` [file: …]` clause matched nothing here
because it was recorded against ANOTHER stylesheet, which this config governs too. When the section
holds such an entry, a line beside the prose says exactly that, and names the file the clause names —
the judgement is neither retireable on this report's word nor unaccounted for: the file it aims at is
the one whose report states its fate. One boundary the config itself cannot cross, and the section
states it too: a config governs its own directory and below, so a scope naming a file OUTSIDE that
subtree can never be honoured by any run — for such an entry the report says exactly that, and that
report is the fate-statement: re-aim the entry inside the config's directory, or retire it.

**And one the prose used to be flatly wrong about — a judgement one file move from working.** A
directive governs only the file it is written in (the fence above). So an entry-file
`themeguard-ignore` whose rule and tokens match a collision living in an imported member of the closure
suppresses nothing — correctly — and lands here, where BOTH readings are false: the defect is not fixed
(the finding prints in the same report, above) and the entry did aim at a finding that exists, one
`@import` edge away. A reader following the retirement advice would retire a judgement one file move
from working, with nothing saying where. So the row names the finding and WHERE it sits, and the two
moves that reach it:

```
unmatched (1)
  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.
  an entry naming a live finding in another file is a third case this report CAN tell: its rule and tokens match a finding printed above, whose declaration lives in another file of the import closure. Neither reading above holds for it — the defect is not fixed, and the entry did aim at a finding that exists — so it is one move from working rather than retirable, and its line names where.
  [unmatched] [collision] — "deliberate: brand tracks success" [tokens: --accent, --success] [main.css:4] — matches a live [collision] finding at tokens.css:2; a directive governs only the file it is written in — move it there, or record it in themeguard.config.json to cover the whole closure.
```

It is a DIAGNOSIS and never a suppression: the entry is still unmatched, the finding still prints, the
counts and the exit code do not move, and a directive still never reaches across an `@import` edge. The
clause is claimed only where the FILE is the whole reason nothing matched — no site of the finding lives
in the directive's own file at all. A directive that missed on its LINE while its own file does hold a
site keeps the existing advice, whose clauses are closer to true there (the defect did move, and the
entry is about this file), and so does an entry that matches nothing, and so does every config entry:
a config entry's matching is already closure-wide, so "matched nothing" is honest for it and there is no
move to suggest. [`--json`](#--json--the-report-as-data) carries the same pointer as data, as an additive
`crossFileAim` key on the unmatched row.

**And one more the prose was flatly wrong about — a judgement one KEY DELETION from working.** An
entry's optional `theme` scope narrows it to findings measured in that one theme (the [config
fields](#the-config-file) above). But five of the nine rules report no theme at all: `dead-token`,
`duplicate-declaration`, `theme-partial-token`, `unresolved-import` and `unresolved-reference` each
report `theme: null`, because what they measure is a fact about the STYLESHEET rather than about one
theme's view of it — a token is dead in the stylesheet, not in a theme. So a `theme` scope on one of
those rules is not a near-miss a different file or a different run might satisfy. It is a
**structurally dead scope**: nothing that rule ever reports, anywhere, carries a theme for the scope to
equal. The entry lands here, where BOTH readings are false again — the defect prints above in the same
report, and the entry's rule and tokens DO match it — and a reader following the retirement advice
retires a judgement that works the moment the `theme` key is deleted:

```
unmatched (1)
  declared suppressions no finding matched. Either the defect was fixed and the judgement can be retired, or the entry never aimed at a finding that exists — the report cannot tell which.
  an entry whose [theme: …] scope names a rule measured STYLESHEET-WIDE is a further case this report CAN tell: five of the nine rules report no theme at all, so such a scope matches nothing in this file, in any file of the closure, or in any run of this config. Neither reading above holds for it — the defect is not fixed, and the entry did aim at a finding that exists — so it is one key deletion from working rather than retirable, and its line names which key.
  [unmatched] [dead-token] — "reviewed winter only" [token: --unused-accent] [theme: winter] — [dead-token] findings are measured stylesheet-wide and carry no theme, so the [theme: winter] scope can never match; drop the theme key to aim the judgement.
```

A DIAGNOSIS on exactly the same terms: the matching semantics are untouched, the entry is still
unmatched, the finding still prints, and the counts and the exit code do not move. The clause is claimed
only where the RULE's own stance is theme-less — a scope on a theme-BEARING rule that simply named the
wrong theme keeps the existing advice, which may yet be true of it, since a config shared across a
subtree can aim that entry at a sibling file where the theme exists. It is equally withheld from an
entry that ALSO carries a `file` scope: there the theme would not be the only reason nothing matched —
the scope names a stylesheet this audit is not — so deleting the theme key would aim nothing, and the
promise would repeat the very false advice the clause exists to replace; the `[file: …]` carve-outs are
what speak for such an entry. `cycle-reference` is deliberately
outside the set: it reports `theme: null` for a loop the base declarations author and a real theme for
one a theme's own declarations close, so its scope stays aimable in principle even in a run whose loops
all happen to be base-authored. [`--json`](#--json--the-report-as-data) carries the same diagnosis as
data, as an additive `themelessAim` key on the unmatched row.

**And one the project disabled itself.** The newest way an entry can match nothing is also the one the
report has the most to say about: its rule is named in the config's `suppress-rule` key. The policy runs
BEFORE the entry match — a disabled rule's findings never reach the ledger — so the entry matched
nothing by construction, and BOTH stock readings are false: the defect is not fixed (the finding prints,
in this same report, under `suppressed-disabled`) and the entry did aim at a finding that exists. The
retirement advice would steer its author into deleting a judgement one policy decision from working. So
the row names the truth — a disabled rule cannot match; re-enable the rule, or retire the entry — and
the section states the case beside its prose, exactly as the three cases above do. The clause is
claimed only where the disabled rule actually REPORTED on this report — into either counted policy leg,
`suppressed-disabled` for its findings or `skipped-disabled` for its skipped pairs: a rule that is off
and silent on both leaves its entries' ordinary advice standing, because there the defect may genuinely
be gone. See
[Turning a rule off for the project](#turning-a-rule-off-for-the-project--suppress-rule).

**The section prints even at zero.** An empty section is the proof that every recorded judgement is
still doing work, and a section that vanished at zero would reproduce exactly the silence this exists to
remove:

```
unmatched (0)
  nothing unmatched — every recorded judgement still covers a finding this report carries.
```

**It never moves the exit code.** A stale entry is hygiene, not a defect in the stylesheet — the same
posture `skipped` and `coverage` take. In general the report cannot tell the two causes apart, and its
prose says so rather than pretending to: either the defect was fixed and the entry should be retired, or
the entry never aimed at a finding that exists. The four cases it CAN tell — a `file`-scoped entry
aimed at a sibling, a site-scoped judgement whose finding lives one `@import` edge away, a `theme`
scope on a rule that reports no theme, and a rule the project's own `suppress-rule` policy turned off —
get their own lines beside that prose, and none moves the code
either: the misfiled judgement's finding was already live and already counted, so naming its aim adds a
pointer and nothing else. What it will not do is stay
silent, and what it will never do is
fail your pipeline over a judgement you wrote — the exit stays exactly the question it has always been,
were there unsuppressed findings.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The audit ran and reported nothing. |
| `1` | The audit ran and reported findings. |
| `2` | The audit did not run — bad usage, or the file could not be read. |

`1` and `2` are kept apart on purpose: in a pipeline or a pre-commit hook the number is all a caller has
*to branch on*, and a real finding must never be confusable with a typo in the path — nor with a clean
stylesheet. The number stays exactly that; [`--json`](#--json--the-report-as-data) adds the DATA beside
it, on stdout, without moving the verdict — a caller reads the code for the decision and the NDJSON for
the detail behind it. Diagnostics stay on stderr as prose in both modes, so stdout is never mixed.

Over one invocation naming several stylesheets, these codes **aggregate per invocation** with the
precedence `2 > 1 > 0`: if any file errored, the invocation exits `2` — fail-fast, with the reports the
files before it already printed left standing and the error naming the file that stopped the run; else
if any file reported unsuppressed findings, it exits `1`; else `0`. Each file is still audited on its own
terms — the config governing it, beside it or above it, is its ledger and its report is its own — the
aggregation is the invocation's
one verdict over all of them.

Suppression moves a finding between those codes **by declaration**: what a `themeguard.config.json`
entry — or a `themeguard-ignore` directive in the stylesheet itself — marks deliberate leaves `1`'s
population for `0`'s, and is still printed and counted in the report's `suppressed` section — the exit
is computed over unsuppressed findings only. Code `2` also covers a config that exists but cannot be
honoured, or a directive that cannot be parsed: the offending entry — or the comment's line — is named
on stderr, never silently skipped.

The project's own RULE POLICY moves them the same way, one level up: findings reported by a rule named
in `suppress-rule` leave `1`'s population for `0`'s, printed and counted in `suppressed-disabled` under
the policy's marker — the exit is computed over kept findings only, and the policy's set-aside is a
recorded judgement, not a defect the report stands behind. A malformed policy is the config case above:
exit `2` naming the offending element, never a silently ignored key.

The `unmatched (N)` section is likewise outside the exit: a declared entry that matched nothing is a
stale or mis-aimed *judgement*, not a defect in the stylesheet, so an expired judgement never turns a
green pipeline red.

### As a library

```ts
import { readFileSync } from "node:fs";
import { resolveCss, audit } from "themeguard";

const report = audit(resolveCss(readFileSync("application.css", "utf8")));
for (const finding of report.findings) {
  console.log(`[${finding.rule}] ${finding.message}`);
}
console.log(report.countsByRule); // { collision: 11, "dead-token": 2, "scale-collapse": 2, "family-consistency": 7, "unresolved-reference": 0, "cycle-reference": 0, "duplicate-declaration": 0, "theme-partial-token": 0 }
```

This is the same object [`themeguard --json`](#--json--the-report-as-data) prints, one line per file — so
a CLI consumer and a library consumer read one shape, and moving between them costs nothing.

`resolveCss` audits the TEXT you hand it — no base directory is known, so `@import` statements are
collected but not followed, and the report describes that one file. A caller with a file on disk — the
CLI's own case — loads the import closure instead, and the same audit sees the whole composed document:

```ts
import { loadStylesheet, resolveStylesheet, audit } from "themeguard";

const report = audit(resolveStylesheet(loadStylesheet("application.css")));
```

Types ship with the package. Every finding carries the `evidence` behind it, so a verdict can be checked
rather than taken — and six of the nine rules also carry `sites`, the declaration each measured token
resolved from (`{ name, line }`), which is the same position their message ends with. It cites the
**cascade winner**: `--app-border` is declared twice in the fixture, at `:root`'s line 41 and winter's
line 438, and the root finding cites 41 while the winter one cites 438. `dead-token`,
`unresolved-reference` and `duplicate-declaration` carry no `sites` — they name their positions in
their own messages (`:root:402`; every use site of the dangling name; the shadowed and winning
declaration), positions the merged theme tables cannot supply.

A library caller with the same need as the CLI — findings it has itself judged
deliberate — passes them as the optional second argument, and reads `report.suppressed` under the same
counted-not-silent discipline:

```ts
import { resolveCss, audit } from "themeguard";

const report = audit(resolveCss(css), {
  suppressions: [{ rule: "scale-collapse", token: "--app-accent-ink-hover", reason: "deliberately subtle hover" }],
});
for (const { finding, reason } of report.suppressed) {
  console.log(`[suppressed] [${finding.rule}] ${finding.message} — "${reason}"`);
}
```

The project-level face is a library option too: `disabledRules` names rule ids to turn off whole, and
their findings land on `report.suppressedDisabled` — `{finding, rule, reason}` rows, the reason the
policy's own marker, verbatim — out of `findings` and the counts, under the same counted-not-silent
discipline. The partition covers the report's second output channel too: `scale-collapse`'s skipped
pairs land whole on `report.skippedDisabled` — `{skipped, rule, reason}` rows — instead of printing
beside the kept pairs, so a disabled rule is silent on BOTH channels or neither. A disabled rule is
checked before `suppressions` is consulted, so an entry aimed at a
disabled rule stays on `report.unmatchedSuppressions`, where the report can say why it matched nothing.

The complement is on the report too: `report.unmatchedSuppressions` carries the declared entries that
matched nothing — in declaration order, entries whole — under the same counted-not-silent discipline
the CLI prints as its `unmatched (N)` section. The diagnosis the CLI prints beside those rows is
available to a library caller as well: `crossFileAims(report.unmatchedSuppressions, report.findings,
resolved)` returns one `{rule, site}` (or `undefined`) per entry, aligned BY INDEX — the leg reports
slots, so two structurally identical judgements are two answers. Its sibling
`themelessAims(report.unmatchedSuppressions, report.findings)` returns one `{rule}` (or `undefined`)
per entry on the same index alignment, naming a `theme` scope that can never match because the rule it
names reports no theme at all; it needs no resolved sheet, since the theme-lessness it reads is the
rule's own declared stance (`THEMELESS_RULES`) plus the findings' own `theme: null`. Both read a
FINISHED report and suppress nothing. The suppression matcher's own halves are exported for the same
reason the diagnoses reuse them rather than re-deriving a twin that could drift: `matchesEntryIdentity`,
`findingSiteCoordinates`, `findingLinesIn`, `siteLineCovers` and `closureOrigins`.

Omit the second argument and the report is exactly the nine-rule audit it has always been.

## Development

```bash
npm install
npm test        # vitest
npm run typecheck
npm run build   # tsc -p tsconfig.build.json → dist/
```

The build has its own config on purpose. `tsconfig.json` is the *checking* config — `noEmit: true`, and
it includes `tests/` — so passing `--outDir` to it emits nothing at all, silently. `tsconfig.build.json`
sets `noEmit: false`, `rootDir: "src"` (without it the output nests under `dist/src/` and the manifest's
`bin` path is a lie) and includes `src` only.

The library lives in `src/`, in two stages that are deliberately kept apart — the lower one produces
facts and passes no judgement, the upper one judges those facts and nothing else:

| Module | What it answers |
|---|---|
| `src/parse.ts` | Which blocks declare custom properties, in which of the four shapes — `:root`, `[data-theme=…]`, `@theme inline`, and a `prefers-color-scheme` `:root` block as its own theme — at which line, and every `var()` **use**, from every declaration rather than only the custom-property ones. |
| `src/resolve.ts` | What each property resolves to **per theme**, following `var()` chains — through embedded primary-position references (`1px solid var(--c)`) as well as whole-value ones, re-marking a walk that stopped at a compound value `cycle` when the value it stopped at references a loop MEMBER in that theme's view — iterated to a fixed point, so a dependent several hops out is reached too — and minting, names-only, the loops no walk closes (an all-compound loop never completes a circuit from any seed), so their members carry the same fact and rule 6 judges them beside every other loop. Theme absence, translucency, unresolved references and cycles are each represented explicitly — none of them is an error and none is guessed at. |
| `src/color.ts` | Colour parsing (hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, alpha throughout), WCAG relative luminance, CIE L\*, contrast ratio, source-over compositing. |
| `src/audit.ts` | `audit(resolved)` — the nine rules in one pass, returning findings tagged `collision`, `dead-token`, `scale-collapse`, `family-consistency`, `unresolved-reference`, `cycle-reference`, `duplicate-declaration`, `unresolved-import` or `theme-partial-token`, plus the per-theme coverage inventory. Passing `suppressions` moves caller-declared findings out of `findings` and the counts into a `suppressed` leg, and the entries that matched nothing onto `unmatchedSuppressions`. Passing `disabledRules` moves a whole rule's output out of the report's live legs — findings off `findings` and the counts onto `suppressedDisabled`, and (for `scale-collapse`, the one rule with a second channel) skipped pairs off `skipped` onto `skippedDisabled` — the project-level policy face, checked before the per-entry match, so an entry naming a disabled rule stays unmatched and the report can say why. Also publishes the suppression matcher's own halves — `matchesEntryIdentity`, `findingSiteCoordinates`, `findingLinesIn`, `siteLineCovers`, `closureOrigins` — and the two reads over a FINISHED report that diagnose an unmatched judgement without suppressing anything: `crossFileAims`, which says which site-scoped judgement would govern a live finding one `@import` edge away, and `themelessAims`, which says which `theme`-scoped judgement names a rule that reports no theme at all. |
| `src/config.ts` | `themeguard.config.json` — optional, discovered at or above the stylesheet (nearest ancestor wins; a config beside the stylesheet is the first hop). Parses and validates the `suppress` entries (strictly: an unhonourable config is an error naming the entry, never a silent skip) and the `suppress-rule` policy — an array of rule ids to turn off whole, validated against the same rule-id list the entries' `rule` field names, an unknown id an error naming the element — into the structured declarations `audit()` filters a finished report by. |
| `src/rules/` | One module per question. Each docstring carries its judgement heuristics and, more usefully, what it deliberately does **not** report. `rules/coverage.ts` also carries the coverage inventory itself — the facts rule 4 is measured over, printed by the CLI as an informational section and never an exit code. `rules/finding.ts` carries the shared citation the clauses are built from — `citeSite` for one site and `citeSiteList` for a list, which `positionClause` is now the `Declared at …` frame around, so a sibling clause needing the same file-aware spelling reads it rather than re-deriving it. It also declares `THEMELESS_RULES` — the five rules that report `theme: null` by construction, the stance the unmatched section's dead-theme-scope diagnosis reads rather than inferring from one run's findings. |
| `src/cli.ts` | The command. I/O and presentation over `audit()` — no rule, no heuristic and no judgement of its own. Two renderers over the same report: the default prose, and `--json`'s NDJSON projection, which serializes the report verbatim for a pipeline caller. |

```ts
import { resolveCss, audit } from "themeguard";

for (const finding of audit(resolveCss(css)).findings) {
  console.log(`[${finding.rule}] ${finding.message}`);
}
```

**Every rule is mostly a filter, and that is the actual work.** The raw data holds far more candidates
than there are defects, so a rule that reports its input is a rule that reports noise. Measured against
the calibration fixture:

| Rule | Raw candidates | Reported | What the filtering removes |
|---|---|---|---|
| `collision` | 41 value groups (dark) | 11 across both themes | A token beside its own `@theme inline` alias; two names another theme *re-declares* equal in its own right; two members of one family (`--app-warning` / `--app-warning-border` is deliberate, and the fixture says so). |
| `dead-token` | 66 unreferenced names | 2 | The 64 `@theme inline` aliases, whose consumers are the utility classes Tailwind generates *from* them and so are unreachable to a source read by construction. |
| `scale-collapse` | — | 2 | Pairing is derived from **declared interaction states** (`X` / `X-hover`), not by sorting a family by lightness: that alternative returns 25 findings, including all four twins the fixture documents as deliberate. |
| `family-consistency` | 22 inherited base tokens (winter) | 7 | A finding needs the theme's OWN declarations as evidence: at least one sibling sharing the token's declared family head must be overridden. That drops the other 15 — the 14 wholly-inherited tokens (focus-ring geometry, control heights, topbar height, sidebar widths, radii, transitions, font — a theme inheriting a family whole is a legitimate answer, so no finding and no invented intent) and `--app-solid-label`, whose family head `--app-solid` is never declared, so its prefix neighbours belong to a different family and there is nothing to cite. |
| `unresolved-reference` | 214 `var()` uses naming 72 distinct names | 0 | Nothing to filter on this fixture — all 72 distinct used names are declared somewhere, and the `@theme inline` declarations count as declaring, so the alias namespace is a lookup hit, not a judged population. The rule's four populations (a typo'd use, a dangling fallback, a broken declaration chain, a dangling alias chain) simply do not occur here; the tests pin them on hostile sheets, and pin this 0 as a preservation check. One known false positive is named rather than hidden: an `@property` registration declares no scope (its block carries no `--` declarations), so a name registered there and declared nowhere is reported — with an `initial-value` it resolves at runtime and that finding is a false positive; the standing remedy is a scope declaration or a suppression entry. |
| `cycle-reference` | — | 0 | Nothing to filter on this fixture — no `var()` chain in it returns to a name already on the chain, so there are no candidates at all. Its four compound-with-`var()` declarations (the `color-mix` toast surfaces) all point at plain non-ancestor colours, so the compound back-edge scan reads them and finds nothing — the dependent-declaration pass that re-marks compound-stopped walks reads the same finished results, reaches its fixed point on the first round, and finds nothing to re-mark — and the names-only pass that mints the loops no walk closes walks the fixture's 140 primary-position references (every one landing on a declared name) and closes no loop. The tests pin the rule's populations on hostile sheets (a root loop, a self-loop, a theme-authored loop, a compound loop, the override-heals and inherited-dedupe negatives, a tail into a compound loop, a compound tail into a loop, a dependent several hops out, and the all-compound loops the walk-blind mint now names) and pin this 0 as a preservation check. |
| `duplicate-declaration` | 125 in-scope declarations of the 189 parsed, none repeated in one scope | 0 | Nothing to filter on this fixture — no name is declared twice within one scope, so there are no candidates at all. The tests pin the rule's populations on hostile sheets (a referenced duplicate, a theme-scope duplicate, the selector-list dedupe, the cross-scope-override and same-value-repeat negatives) and pin this 0 as a preservation check. |
| `theme-partial-token` | — | 0 | Nothing to filter on this fixture — no `var()` chain in it fails to resolve in any theme's view, so the rule's population (unresolved-kind tokens whose missing reference IS declared somewhere) is empty at the source. The tests pin the rule's populations on hostile sheets — the flagship one-theme declaration, theme→theme, the `@theme inline` alias chain, the `prefers-color-scheme` conditioned root — alongside the control partitioned to rule 5, the three negative boundaries in both directions, the recorded direct-consumption residual, and this 0 as a preservation check. |

Three properties are worth stating because they are what the tests defend:

* **Silence is never read as intent.** A rule that treats "no evidence of a defect" as "evidence of no
  defect" fails as a *clean report*, which reads as a pass. `collision` takes a pair to be a deliberate
  identity only when another theme **declares** it equal in its own right — not when the other themes
  merely say nothing. The earlier "equal in every theme" form was vacuously true on a single-theme
  stylesheet and reported nothing at all, including on this README's own opening example; the fixture,
  which has two themes that both override that pair, is structurally incapable of catching it, so the
  case is pinned by hand-written stylesheets instead.
* **A translucent colour is never composited against an invented backdrop.** `lstar()` and
  `relativeLuminance()` refuse one and say so; call `over(color, backdrop)` naming the surface it is
  actually painted on. A colour with alpha has no single value without one — measuring it against an
  assumed black once produced a 1.82:1 reading where the truth was 9.25:1.
* **A rule reports what it measured.** Every finding carries the numbers behind it — the shared value, the
  declaration sites, the ΔL\* and both endpoints — so a verdict can be checked rather than taken. A pair
  rule 3 cannot measure is reported as *skipped*, because silence reads exactly like a pass — and the row
  says WHICH silence it is, because "this value is not a colour" and "this name is a sibling theme's"
  are different facts and only one of them is ever true of a given pair.
* **The maths is calibrated against an independent implementation**, and against a real stylesheet that
  records its own measurements in comments: `tests/math.test.ts` reproduces its documented ΔL\* steps
  (`+6.07`, `−11.49`) to the hundredth. See `tests/fixtures/README.md`.

## Licence

MIT.

---

<p align="center">
  <a href="https://yatfa.com">
    <img src="assets/built-with-yatfa.png" alt="Built with yatfa — a team of AI agents that plans, builds &amp; ships software." width="100%">
  </a>
</p>
