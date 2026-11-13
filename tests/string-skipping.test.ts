import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";

// Pins the CSS string rules shared by the top-level splitters (one
// `outsideStrings` generator in src/parse.ts) through the public API.
describe("quoted strings hide separators from the top-level splitters", () => {
  // Fails if the backslash arm of `outsideStrings` is deleted: the `\"` would
  // close the string and the comma inside it would split the selector list.
  it("keeps an escaped quote inside an attribute value in one selector", () => {
    const css = '[title="a\\",b"][data-theme="dark"], :root { --x: red; }';
    const scopes = parseStylesheet(css).scopes;
    expect(scopes.map((s) => s.kind).sort()).toEqual(["root", "theme"]);
    expect(scopes.find((s) => s.kind === "theme")?.theme).toBe("dark");
  });

  // Fails if the single-quote opener or the backslash arm is deleted: the `;`
  // inside either string would end the declaration.
  it("does not end a declaration at a semicolon inside a string", () => {
    const css = ":root { --y: 'a;b'; --z: \"c\\\";d\"; }";
    const scope = parseStylesheet(css).scopes[0];
    expect(scope?.declarations.map((d) => `${d.name}=${d.value}`)).toEqual([
      "--y='a;b'",
      '--z="c\\";d"',
    ]);
  });
});
