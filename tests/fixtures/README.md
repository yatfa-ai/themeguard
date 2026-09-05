# Test fixtures

## `application.tailwind.css`

A **vendored copy** — not a dependency, not a submodule — of

    app/assets/stylesheets/application.tailwind.css

from the `yatfa-ai/yatfa` repository at commit **`961eef3`** (2385 lines).

It is the calibration target for the resolver and the math core: a real,
eight-month-old stylesheet that happens to contain all three declaration shapes
themeguard's scope names, in one file.

| Shape | Line | Block | Custom-property declarations |
|---|---|---|---|
| `:root` (dark default) | 17 | 17–411 | 73 |
| `[data-theme="winter"]` (light overrides) | 414 | 414–560 | 51 |
| `@theme inline` (Tailwind v4 aliases) | 632 | 632–752 | 64 |
| | | **total** | **188** |

Every name is unique within its block, and all 64 `@theme inline` declarations
are `var()` aliases. The counts are asserted by `tests/census.test.ts`, so
drift in the vendored copy fails a test rather than passing silently.

**themeguard is not a yatfa-specific tool.** This fixture is a calibration
sample, chosen because its defects and its measured ΔL\* comments are
independently verifiable; the package must work on any CSS that declares custom
properties.

### Why this file is worth calibrating against

* It documents its own colour measurements in comments (`"steps the fill
  +6.07 ΔL*"`, `"(step −11.49, label 12.02)"`), which the math core reproduces
  to the hundredth in `tests/math.test.ts` — the stylesheet is its own oracle.
* It contains the two famous value collisions the README cites:
  `--app-border` == `--app-surface-raised` (`#1E293B`, dark) and
  `--app-cta` == `--app-success` (`#22C55E`, dark).
* It contains theme-absence as a deliberate design decision (22 `:root` tokens
  have no winter override, because focus and control geometry are
  theme-independent), `var()` indirection inside a theme block, and translucent
  `rgba()` fills — all three of the wrinkles the resolver must represent
  explicitly.

### Updating it

Re-copy from the yatfa repo and update the commit and the counts above **and**
the baseline constants in `tests/census.test.ts` in the same change, so the
census numbers always name a specific source revision.
