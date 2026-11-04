import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";

// A block comment with no closing `*/` runs to the end of the file in CSS, so
// everything after its opener is comment text: blankComments (src/parse.ts)
// takes `stop = css.length` for `end === -1`, so no scope or declaration after
// the opener is collected, while earlier line numbers stay true because
// newlines inside the blanked region are preserved.
const tokens = (css: string) =>
  parseStylesheet(css).scopes.flatMap((s) =>
    s.declarations.map((d) => [s.kind, s.theme, d.name, d.line]),
  );

describe("unterminated /* comment", () => {
  it("swallows every declaration and block after the opener", () => {
    const css = [
      ":root { --a: #fff; }",
      "/* the author never closed this",
      '[data-theme="dark"] { --b: #000; }',
      ".card { --c: #111; }",
    ].join("\n");
    expect(tokens(css)).toEqual([["root", null, "--a", 1]]);
  });

  it("keeps the line numbers of what precedes it true", () => {
    const css = "\n\n:root {\n  --a: #fff;\n}\n/* open\n:root { --b: 1; }\n";
    expect(tokens(css)).toEqual([["root", null, "--a", 4]]);
  });

  it("agrees with the closed form when the comment ends before the block (control arm)", () => {
    const css = ":root { --a: #fff; }\n/* closed */\n.card { --c: #111; }";
    expect(tokens(css).map((t) => t[2])).toEqual(["--a", "--c"]);
  });
});
