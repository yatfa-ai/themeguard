import { describe, expect, it } from "vitest";
import { findingSiteCoordinates } from "../src/audit.js";
import type { Finding } from "../src/rules/finding.js";

const finding = (evidence: Finding["evidence"]): Finding => ({
  rule: "dead-token",
  theme: null,
  tokens: ["--x"],
  message: "m",
  evidence,
});
const origins: ReadonlySet<string> = new Set(["tokens.css"]);

describe("findingSiteCoordinates on a finding with no readable position", () => {
  it("returns no coordinates when the evidence names neither declaredIn nor usedIn", () => {
    expect(findingSiteCoordinates(finding({}), origins)).toEqual([]);
  });
  it("returns no coordinates when declaredIn is a lone string rather than a list", () => {
    expect(findingSiteCoordinates(finding({ declaredIn: ":root:4" }), origins)).toEqual([]);
  });
  it("skips a citation that carries no trailing :line and still reads the ones after it", () => {
    expect(
      findingSiteCoordinates(finding({ declaredIn: [":root", "tokens.css:7", ":root:4"] }), origins),
    ).toEqual([{ line: 7, origin: "tokens.css" }, { line: 4 }]);
  });
  it("ignores a non-numeric line suffix", () => {
    expect(findingSiteCoordinates(finding({ declaredIn: [":root:x", "a:4b"] }), origins)).toEqual([]);
  });
  it("reads the same citations from usedIn when declaredIn is absent (control arm)", () => {
    expect(findingSiteCoordinates(finding({ usedIn: [":root:9"] }), origins)).toEqual([{ line: 9 }]);
  });
});
