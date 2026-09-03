# themeguard

> ESLint for your colour variables. Reads the CSS **source**, not the rendered page, and audits how a
> project's colour tokens are *organised* — not whether text passes contrast.

> **Status: name reserved, no code yet.** This repository holds the README, the licence and the npm
> placeholder (`0.0.1`). Nothing is implemented. Do not install it expecting behaviour.

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

## Licence

MIT.

---

<p align="center">
  <a href="https://yatfa.com">
    <img src="assets/built-with-yatfa.png" alt="Built with yatfa — a team of AI agents that plans, builds &amp; ships software." width="100%">
  </a>
</p>
