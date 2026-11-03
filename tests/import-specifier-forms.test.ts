import { describe, expect, it } from "vitest";
import { parseStylesheet } from "../src/parse.js";

// The specifier an @import prelude names (importSpecifierOf, src/parse.ts):
// quotes or a url() wrapper stripped, any media suffix dropped, padding
// trimmed, and a prelude that names no URL collecting NOTHING — inventing a
// specifier for a prelude the source did not clearly write would be a guess
// printed as data. A single-quoted `@import './a.css';` is extremely common
// real CSS; if that spelling stopped being collected, the imported file would
// silently drop out of the audit unit and nothing else in the suite would
// notice, so each spelling here is pinned against `sheet.imports` — the same
// list the loader follows.
const importsOf = (css: string) => parseStylesheet(`${css}\n.x { color: red; }`).imports;

describe("the specifier an @import names", () => {
  it("collects the single-quoted spelling, bare and inside url('…')", () => {
    expect(importsOf("@import './single.css';\n@import url('./single-url.css');")).toEqual([
      { specifier: "./single.css", line: 1 },
      { specifier: "./single-url.css", line: 2 },
    ]);
  });

  it("trims padding around the specifier in all five spellings", () => {
    expect(
      importsOf(
        [
          '@import "  ./a.css  ";',
          "@import '  ./b.css  ';",
          '@import url("  ./c.css  ");',
          "@import url('  ./d.css  ');",
          "@import url(  ./e.css  );",
        ].join("\n"),
      ),
    ).toEqual([
      { specifier: "./a.css", line: 1 },
      { specifier: "./b.css", line: 2 },
      { specifier: "./c.css", line: 3 },
      { specifier: "./d.css", line: 4 },
      { specifier: "./e.css", line: 5 },
    ]);
  });

  it("reads the keyword and the url() wrapper case-insensitively", () => {
    expect(importsOf('@IMPORT URL("./Upper.css");')).toEqual([
      { specifier: "./Upper.css", line: 1 },
    ]);
  });

  it("collects nothing for a prelude naming no URL, and keeps walking", () => {
    const noUrlSpellings = [
      '@import "";',
      "@import '';",
      '@import "   ";',
      "@import url();",
      '@import url("");',
      "@import url('');",
      "@import url(   );",
      "@import;",
      "@import   ;",
      "@import bare-word.css;",
    ];
    const css = noUrlSpellings
      .map((spelling, k) => `${spelling}\n@import "./after-${k + 1}.css";`)
      .join("\n\n");
    // The real import beside each dead spelling probes BOTH directions: an
    // extra row means a spelling wrongly yielded an entry, a missing row
    // means it ended the walk instead of yielding nothing and moving on.
    expect(importsOf(css)).toEqual(
      noUrlSpellings.map((_, k) => ({ specifier: `./after-${k + 1}.css`, line: 3 * k + 2 })),
    );
  });
});
