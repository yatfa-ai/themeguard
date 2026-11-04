import { describe, expect, it } from "vitest";
import { DirectiveError, scanIgnoreDirectives } from "../src/directives.js";

/**
 * An unterminated `/* themeguard-ignore …` (no closing comment terminator) is read to end of file
 * as ONE directive: the opener's line, the rest of the file as its text, no second comment
 * scanned. This is the same reading parse.ts's blanker takes for an unterminated comment.
 */
describe("scanIgnoreDirectives — an unterminated comment", () => {
  it("reads a well-formed directive that runs to end of file", () => {
    const css = ":root { --a: #fff; }\n\n/* themeguard-ignore collision --a --b -- vendor brand";
    expect(scanIgnoreDirectives(css, "site.css")).toEqual([
      { rule: "collision", reason: "vendor brand", tokens: ["--a", "--b"], line: 3, source: "site.css:3" },
    ]);
  });

  it("swallows everything after the opener — a later directive-looking comment is body text, not a second directive", () => {
    const css = [
      "/* themeguard-ignore collision --a -- first",
      "/* themeguard-ignore collision --b -- second",
    ].join("\n");
    const found = scanIgnoreDirectives(css, "site.css");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
    expect(found[0]?.reason).toBe("first\n/* themeguard-ignore collision --b -- second");
  });

  it("names the opener's line when the unterminated directive is malformed", () => {
    const css = "a { color: red; }\n\n\n/* themeguard-ignore collision --a";
    expect(() => scanIgnoreDirectives(css, "site.css")).toThrow(DirectiveError);
    expect(() => scanIgnoreDirectives(css, "site.css")).toThrow(/site\.css.*4|4.*site\.css/s);
  });

  it("ignores an unterminated comment that is not a directive", () => {
    expect(scanIgnoreDirectives("/* just a note, never closed", "site.css")).toEqual([]);
  });

  it("agrees with the closed form (control arm)", () => {
    expect(
      scanIgnoreDirectives("/* themeguard-ignore collision --a --b -- vendor brand */", "site.css")[0],
    ).toMatchObject({ rule: "collision", reason: "vendor brand", line: 1 });
  });
});
