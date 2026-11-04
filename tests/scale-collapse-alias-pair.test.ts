import { describe, expect, it } from "vitest";
import { resolveCss } from "../src/resolve.js";
import { scaleCollapseRule } from "../src/rules/scale-collapse.js";

describe("scaleCollapseRule — a pair with ONE @theme inline member is not measured", () => {
  const css = `:root { --palette: #336699; --brand-hover: #336699; }
@theme inline { --brand: var(--palette); }
.x { color: var(--brand); background: var(--brand-hover); }`;

  it("reports neither a finding nor a skipped row for the mixed pair", () => {
    const result = scaleCollapseRule(resolveCss(css));
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("measures the same pair once both members are palette tokens (control)", () => {
    const control = `:root { --brand: #336699; --brand-hover: #336699; }
.x { color: var(--brand); background: var(--brand-hover); }`;
    const result = scaleCollapseRule(resolveCss(control));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.tokens).toEqual(["--brand", "--brand-hover"]);
  });

  it("drops the mirrored case: alias on the state side, palette base", () => {
    const mirrored = `:root { --palette: #336699; --brand: #336699; }
@theme inline { --brand-hover: var(--palette); }
.x { color: var(--brand); background: var(--brand-hover); }`;
    const result = scaleCollapseRule(resolveCss(mirrored));
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});
