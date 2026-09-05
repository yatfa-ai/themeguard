# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: library only, no CLI yet.** This repository holds the README, the licence, the npm
> placeholder (`0.0.2`) and the library — a CSS custom-property **resolver**, the **colour math core**,
> and the **three rules** that judge their output, with tests. There is no CLI and the package declares
> no entry point or bin, so installing it gets you source, not a command. Do not install it expecting to
> lint anything from a terminal yet.

## The three questions

1. **Value collisions** — two variables that must differ hold byte-identical colours.
   A real one: `--app-border` equalled `--app-surface-raised`, so a panel's 1px border was literally
   invisible. It survived three and a half months and was worked around with a third token rather
   than fixed.
2. **Dead variables** — declared, referenced nowhere.
3. **Ramp collapse across themes** — `--text-muted` and `--text-faint` must stay apart by eye. If they
   converge in one theme, the text hierarchy is gone. Measured in CIE L\* (ΔL\* ≥ 4), **not** in
   contrast ratio: two adjacent surfaces a visibly distinct step apart still sit around 1.2:1.

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

Not yet. When there is something to run:

```bash
npm install --save-dev themeguard
```

## Development

```bash
npm install
npm test        # vitest
npm run typecheck
```

The library lives in `src/`, in two stages that are deliberately kept apart — the lower one produces
facts and passes no judgement, the upper one judges those facts and nothing else:

| Module | What it answers |
|---|---|
| `src/parse.ts` | Which blocks declare custom properties, in which of the three shapes, at which line — and every `var()` **use**, from every declaration rather than only the custom-property ones. |
| `src/resolve.ts` | What each property resolves to **per theme**, following `var()` chains. Theme absence, translucency, unresolved references and cycles are each represented explicitly — none of them is an error and none is guessed at. |
| `src/color.ts` | Colour parsing (hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, alpha throughout), WCAG relative luminance, CIE L\*, contrast ratio, source-over compositing. |
| `src/audit.ts` | `audit(resolved)` — the three rules in one pass, returning findings tagged `collision`, `dead-token` or `scale-collapse`. |
| `src/rules/` | One module per question. Each docstring carries its judgement heuristics and, more usefully, what it deliberately does **not** report. |

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
