import { describe, expect, it } from "vitest";
import { resolveCss } from "../src/resolve.js";
import { deadTokenRule } from "../src/rules/dead-token.js";

describe("dead-token: a name in the @theme inline alias namespace is never judged dead", () => {
  it("skips a name declared in :root AND as an @theme inline alias when nothing var()-references it", () => {
    const css = `
:root {
  --color-accent: #FF0000;
  --lonely: #00AA00;
}
@theme inline {
  --color-accent: var(--accent);
}
`;
    const findings = deadTokenRule(resolveCss(css));
    expect(findings.map((f) => f.tokens)).toEqual([["--lonely"]]);
  });

  it("control: the same :root name without the alias declaration IS dead", () => {
    const css = `
:root {
  --color-accent: #FF0000;
  --lonely: #00AA00;
}
`;
    const findings = deadTokenRule(resolveCss(css));
    expect(findings.map((f) => f.tokens)).toEqual([["--color-accent"], ["--lonely"]]);
  });
});
