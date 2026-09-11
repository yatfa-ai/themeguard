# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: 0.1.1 — one command, and a library.** `themeguard <file.css>` audits a stylesheet from a
> terminal, and the same four rules are importable as functions. The package ships compiled output
> (`dist/`); the calibration fixture and the tests stay in this repository and out of the tarball.

## The four questions

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

## Install

```bash
npm install --save-dev themeguard
```

## Usage

One command, zero options — point it at a CSS file.

```bash
npx themeguard path/to/application.css
```

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

skipped (0)
  nothing skipped — every pair rule 3 derived was measurable.

suppressed (0)
  nothing suppressed — every finding above is one the report stands behind.

coverage (2 themes, 73 base tokens)
  root: declares all 73 base tokens, inherits 0.
  winter: declares 51 of 73 base tokens, inherits 22 (8 color / 14 non-color).
    [inherited] --app-success (color)
    [inherited] --app-focus-ring-width (non-color)
    … 20 more — every base token each theme inherits, named

22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency.
```

Four things in that output are deliberate and worth reading.

**All four rule headings print even at zero.** A rule that reports nothing and a rule that did not run
look identical if the heading is omitted, and "nothing here" reads as a pass.

**`skipped` is a section, not a silence.** A pair rule 3 could not measure — a translucent member has no
lightness until it is composited, and themeguard never invents a backdrop — is *unmeasured*, which is not
the same claim as *clean*. Those pairs are counted and named, and they do **not** change the exit code:
they are not findings.

**`coverage` is facts, not findings.** Inheriting a token is normal — focus geometry, control sizing and
transitions are theme-independent on purpose — so the inventory never moves the exit code. It is printed
under the same discipline as `skipped` (counted, named, headline even at zero) because a theme that
silently receives a value is a fact a reader needs before the `family-consistency` findings above it make
sense; the findings are the judgement, the inventory is what they are judged against.

**`suppressed` is what you, not the tool, decided.** The section headline prints even at zero, under the
same discipline as `skipped` and `coverage` — an empty `suppressed` section is the visible proof that
nothing was set aside. When a `themeguard.config.json` sits beside the stylesheet (see the next section),
its findings move here with their reasons quoted: out of the counts and the exit code by declaration,
never by silence.

### Suppressing deliberate findings — `themeguard.config.json`

The audit is calibrated to report what it measures, not what it approves of — so a real stylesheet that
documents its own deliberate choices (a hover intentionally a hair off its resting colour, a warning fill
that legitimately equals its border) reports them every run. To agree with the audit *with exceptions*,
put a `themeguard.config.json` **next to the stylesheet**:

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

Each entry names the `rule` that reports the finding, a token dimension, an optional scope, and the
`reason` — which the report quotes back. Matching is against the finding's structured fields (`rule`,
`theme`, `tokens`), never against message prose. A suppressed finding leaves the per-rule counts and the
exit code, and moves to its own `suppressed (N)` section — counted, named, reason quoted, never silently
dropped, under the same discipline as `skipped`.

**Scope an entry, or it reaches everywhere.** An entry names its token dimension either as the scalar
`token` — any one token the finding carries — or as the `tokens` array — a set the finding must carry in
FULL, which is how a deliberate collision *pair* is recorded as one entry rather than a stroke across
every finding that happens to carry one of its members. An entry may also carry `theme`, narrowing it to
findings measured in that one theme — so a deliberate equality in your base palette never silences the
same question in a `prefers-color-scheme` or `[data-theme=…]` theme, where the equality may be a real
defect. A theme-scoped entry never matches a finding that is not about a theme at all (a dead token is
measured stylesheet-wide). Omitted keys are the unscoped reading: `token` alone, no `theme` — exactly
what one-line configs have always meant. A scoped entry says so in the report, where its finding is
printed:

```
  [suppressed] [collision] --accent and --success both resolve to #ff0000 in theme "root". … — "cta deliberately equals success" [theme: root, tokens: --accent, --success]
```

`rule` and `reason` and one of `token`/`tokens` are required, and a config the package cannot honour — an
unknown rule id, a missing token dimension, `token` AND `tokens` together (two spellings of one
dimension), an empty `tokens` array (which would match every finding), a malformed `theme`, unreadable
JSON — exits `2` naming the offending entry: a config that silently did nothing — or silently did too
much — would leave you believing a finding was marked deliberate when it was reported after all.

**Discovery is stylesheet-adjacent, deliberately.** The config is read from the directory of the
stylesheet you point the command at — not from the process working directory — so the same command means
the same thing no matter where it is invoked from, and a project can keep one config beside its built CSS
(or one per stylesheet directory) instead of relying on wherever the shell happens to be standing. No
config file beside the stylesheet means no suppression at all: no existing line of the report changes,
the exit codes are unchanged, and the only difference from a run without the feature is the counted
`suppressed` section appended at zero.

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

The grammar is one comment: the keyword, then the rule id (one of the four), then optional `--`-prefixed
token names — the same meaning as a config entry's `tokens` set, the finding must carry every name listed
— then a bare `--` separator and a required reason, which the report quotes back. A directive that names
no token is legitimate: there the *site* is the judgement, and every finding of that rule living at the
line is covered.

A directive covers a finding only while the finding still lives at its site — trailing on the judged
declaration's own line, or standalone on the line directly above it, the two placements
`eslint-disable-next-line` and `stylelint-disable-line` established. Refactor the code away from the
annotation and the directive orphans: nothing matches, the finding prints again and moves the exit code.
The miss is self-announcing — exactly like a config entry that matches nothing — and deliberately not a
silence. That is the property the config cannot have: its entries match a finding's *identity*, so a
judgement recorded about one line keeps suppressing after the code moves to another. Use the config for
project-level judgements; use a directive when the judgement belongs to the file and should travel with
it into vendored, regenerated or forked copies. The two work together — both merge into the same
`suppressions` section, where a directive's line carries its `[file:line]` source clause:

```
  [suppressed] [collision] --accent and --success both resolve to #16a34a in theme "root". … — "vendor brand: accent is deliberately the success green" [tokens: --accent, --success] [vendor.css:4]
```

A directive the package cannot honour — an unknown rule id, no rule id at all, a missing or empty reason,
a word in the head that is neither a rule id nor a `--` token name — exits `2` naming the comment's line,
under the config's own never-silently-ignored discipline. In fact the *values* a directive may say are
validated by the config's own parser, so the two mechanisms cannot drift apart on what a suppression may
name. The keyword is recognized only in real comments: the same text inside a CSS string is prose.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The audit ran and reported nothing. |
| `1` | The audit ran and reported findings. |
| `2` | The audit did not run — bad usage, or the file could not be read. |

`1` and `2` are kept apart on purpose: in a pipeline or a pre-commit hook the number is all a caller has,
and a real finding must never be confusable with a typo in the path — nor with a clean stylesheet.

Suppression moves a finding between those codes **by declaration**: what a `themeguard.config.json`
entry — or a `themeguard-ignore` directive in the stylesheet itself — marks deliberate leaves `1`'s
population for `0`'s, and is still printed and counted in the report's `suppressed` section — the exit
is computed over unsuppressed findings only. Code `2` also covers a config that exists but cannot be
honoured, or a directive that cannot be parsed: the offending entry — or the comment's line — is named
on stderr, never silently skipped.

### As a library

```ts
import { readFileSync } from "node:fs";
import { resolveCss, audit } from "themeguard";

const report = audit(resolveCss(readFileSync("application.css", "utf8")));
for (const finding of report.findings) {
  console.log(`[${finding.rule}] ${finding.message}`);
}
console.log(report.countsByRule); // { collision: 11, "dead-token": 2, "scale-collapse": 2, "family-consistency": 7 }
```

Types ship with the package. Every finding carries the `evidence` behind it, so a verdict can be checked
rather than taken — and three of the four rules also carry `sites`, the declaration each measured token
resolved from (`{ name, line }`), which is the same position their message ends with. It cites the
**cascade winner**: `--app-border` is declared twice in the fixture, at `:root`'s line 41 and winter's
line 438, and the root finding cites 41 while the winter one cites 438. `dead-token` carries no `sites` —
it already names `:root:402` in its own message, with a selector the merged theme tables cannot supply.

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

Omit the second argument and the report is exactly the four-rule audit it has always been.

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
| `src/resolve.ts` | What each property resolves to **per theme**, following `var()` chains. Theme absence, translucency, unresolved references and cycles are each represented explicitly — none of them is an error and none is guessed at. |
| `src/color.ts` | Colour parsing (hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, alpha throughout), WCAG relative luminance, CIE L\*, contrast ratio, source-over compositing. |
| `src/audit.ts` | `audit(resolved)` — the four rules in one pass, returning findings tagged `collision`, `dead-token`, `scale-collapse` or `family-consistency`, plus the per-theme coverage inventory. Passing `suppressions` moves caller-declared findings out of `findings` and the counts into a `suppressed` leg. |
| `src/config.ts` | `themeguard.config.json` — optional, discovered beside the stylesheet. Parses and validates the `suppress` entries (strictly: an unhonourable config is an error naming the entry, never a silent skip) into the structured declarations `audit()` filters a finished report by. |
| `src/rules/` | One module per question. Each docstring carries its judgement heuristics and, more usefully, what it deliberately does **not** report. `rules/coverage.ts` also carries the coverage inventory itself — the facts rule 4 is measured over, printed by the CLI as an informational section and never an exit code. |
| `src/cli.ts` | The command. I/O and presentation over `audit()` — no rule, no heuristic and no judgement of its own. |

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
  rule 3 cannot measure (a translucent member has no lightness until it is composited) is reported as
  *skipped*, because silence reads exactly like a pass.
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
