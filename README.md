# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: foundation only, nothing runnable yet.** This repository holds the README, the licence, the
> npm placeholder (`0.0.2`) and the first stage of the library — a CSS custom-property **resolver** and the
> **colour math core**, with tests. There is no rule, no CLI and no entry point: installing it gets you
> source, not behaviour. Do not install it expecting to lint anything.

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
palette went 23 → 73 tokens and collisions went 0 → 7.

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

The library lives in `src/` and is, at this stage, **data only** — it produces the facts a rule would
judge and passes no judgement itself:

| Module | What it answers |
|---|---|
| `src/parse.ts` | Which blocks declare custom properties, in which of the three shapes, at which line. |
| `src/resolve.ts` | What each property resolves to **per theme**, following `var()` chains. Theme absence, translucency, unresolved references and cycles are each represented explicitly — none of them is an error and none is guessed at. |
| `src/color.ts` | Colour parsing (hex 3/4/6/8, `rgb()`/`rgba()`, `hsl()`/`hsla()`, alpha throughout), WCAG relative luminance, CIE L\*, contrast ratio, source-over compositing. |

Two properties are worth stating because they are what the tests defend:

* **A translucent colour is never composited against an invented backdrop.** `lstar()` and
  `relativeLuminance()` refuse one and say so; call `over(color, backdrop)` naming the surface it is
  actually painted on. A colour with alpha has no single value without one — measuring it against an
  assumed black once produced a 1.82:1 reading where the truth was 9.25:1.
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
