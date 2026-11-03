import { describe, expect, it } from "vitest";
import { scanIgnoreDirectives } from "../src/directives.js";

const DIRECTIVE = "/* themeguard-ignore dead-token --x -- prose, not a directive */";

describe("scanIgnoreDirectives — a backslash escape inside a CSS string", () => {
  it("keeps an escaped quote inside the string, so a directive-shaped comment after it is still prose", () => {
    const css = `.x { content: "say \\"${DIRECTIVE}\\" now"; }`;
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([]);
  });

  it("ends the string at a quote that follows an ESCAPED backslash, so a real directive after it is read", () => {
    const css = [
      `.x { content: "a\\\\"; }`,
      "/* themeguard-ignore dead-token --x -- kept on purpose */",
    ].join("\n");
    expect(scanIgnoreDirectives(css, "vendor.css")).toEqual([
      { rule: "dead-token", tokens: ["--x"], reason: "kept on purpose", line: 2, source: "vendor.css:2" },
    ]);
  });
});
