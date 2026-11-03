import { describe, expect, it } from "vitest";
import { themePartialTokenRule } from "../src/rules/theme-partial-token.js";
import { resolveCss } from "../src/resolve.js";

describe("rule 9 — three-item lists in the message", () => {
  it("names three declaring themes, three missing views and three consumers with commas and a final 'and'", () => {
    const css = `
:root {
  --a-panel: var(--code-bg);
  --b-card: var(--code-bg);
  --c-chip: var(--code-bg);
}
[data-theme="mono"] {
  --m: #000000;
}
[data-theme="plain"] {
  --p: #111111;
}
[data-theme="dark"] {
  --code-bg: #020617;
}
[data-theme="winter"] {
  --code-bg: #F1F5F9;
}
[data-theme="sepia"] {
  --code-bg: #F4ECD8;
}
`;
    const findings = themePartialTokenRule(resolveCss(css));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toBe(
      '--code-bg is declared only in themes "dark", "winter" and "sepia" but never reaches ' +
      'themes "root", "mono" and "plain" — there, --a-panel, --b-card and --c-chip\'s var() chains ' +
      'resolve through it and find nothing, so the property falls back to unset/inherit. ' +
      'Declared in themes "dark", "winter" and "sepia" at lines 14, 17 and 20.',
    );
  });
});
