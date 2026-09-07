# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: 0.1.0 — one command, and a library.** `themeguard <file.css>` audits a stylesheet from a
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
  [collision] --app-border and --app-surface-raised both resolve to #1E293B in theme "root". They are separate roles, and theme "winter" declares them apart — so this theme is repainting one with the other.
  [collision] --app-cta and --app-success both resolve to #22C55E in theme "root". They are separate roles, and theme "winter" declares them apart — so this theme is repainting one with the other.
  … 9 more, across both themes

dead-token (2)
  [dead-token] --topbar-height is declared at :root:402 and no var() in this stylesheet references it.
  [dead-token] --transition-slow is declared at :root:407 and no var() in this stylesheet references it.

scale-collapse (2)
  [scale-collapse] --app-accent-ink-hover is ΔL* 3.90 from --app-accent-ink in theme "root" — under the 4 needed for a visible step, so the hover state is not distinguishable from the resting one.
  [scale-collapse] --app-accent-ink-hover is ΔL* 3.45 from --app-accent-ink in theme "winter" — under the 4 needed for a visible step, so the hover state is not distinguishable from the resting one.

family-consistency (7)
  [family-consistency] --app-cta-solid-hover is inherited from :root in theme "winter" (resolving to #4ADE80) while the same theme declares --app-cta, --app-cta-hover — the theme tunes this family, so the member it does not re-declare silently keeps the base value.
  [family-consistency] --app-success is inherited from :root in theme "winter" (resolving to #22C55E) while the same theme declares --app-success-border, --app-success-on-surface, --app-success-soft, --app-success-surface, --app-success-toast-surface — the theme tunes this family, so the member it does not re-declare silently keeps the base value.
  … 5 more

skipped (0)
  nothing skipped — every pair rule 3 derived was measurable.

coverage (2 themes, 73 base tokens)
  root: declares all 73 base tokens, inherits 0.
  winter: declares 51 of 73 base tokens, inherits 22 (8 color / 14 non-color).
    [inherited] --app-success (color)
    [inherited] --app-focus-ring-width (non-color)
    … 20 more — every base token each theme inherits, named

22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency.
```

Three things in that output are deliberate and worth reading.

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

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The audit ran and reported nothing. |
| `1` | The audit ran and reported findings. |
| `2` | The audit did not run — bad usage, or the file could not be read. |

`1` and `2` are kept apart on purpose: in a pipeline or a pre-commit hook the number is all a caller has,
and a real finding must never be confusable with a typo in the path — nor with a clean stylesheet.

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
rather than taken.

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
| `src/parse.ts` | Which blocks declare custom properties, in which of the three shapes, at which line — and every `var()` **use**, from every declaration rather than only the custom-property ones. |
| `src/resolve.ts` | What each property resolves to **per theme**, following `var()` chains. Theme absence, translucency, unresolved references and cycles are each represented explicitly — none of them is an error and none is guessed at. |
| `src/color.ts` | Colour parsing (hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, alpha throughout), WCAG relative luminance, CIE L\*, contrast ratio, source-over compositing. |
| `src/audit.ts` | `audit(resolved)` — the four rules in one pass, returning findings tagged `collision`, `dead-token`, `scale-collapse` or `family-consistency`, plus the per-theme coverage inventory. |
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
