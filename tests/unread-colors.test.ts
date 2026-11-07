import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_OK, formatReport } from "../src/cli.js";
import { resolveCss } from "../src/resolve.js";
import { themeTokenTotals, unreadColorSyntax } from "../src/rules/unread-colors.js";
import { run } from "./run.js";

/**
 * The `unread-colors` section — the omission made visible.
 *
 * A token whose value is colour syntax the parser does not evaluate is
 * classified `non-color` and sits outside collision, scale-collapse and
 * contrast. These pin that the report SAYS so: counted, named, printed even at
 * zero, present (empty, not absent) in `--json`, and never an exit code.
 */

const NINE_TOKENS = `
:root {
  --bg: light-dark(#fff, #000);
  --fg: light-dark(#000, #fff);
  --card: color-mix(in srgb, #fff 90%, #000);
  --muted: color-mix(in srgb, #fff 90%, #000);
  --border: #ccc;
  --line: #ccc;
  --accent: oklch(from var(--border) l c h);
  --sh: color(display-p3 1 0 0);
  --cc: currentColor;
}
body { background: var(--bg); color: var(--fg); }
.a { background: var(--card); border-color: var(--muted); }
.b { border-color: var(--border); outline-color: var(--line); }
.c { color: var(--accent); fill: var(--sh); stroke: var(--cc); }
`;

// Created at module load, not in a hook: describe bodies below call `run(...)`
// during collection, before any `beforeAll` has run.
const dir = mkdtempSync(join(tmpdir(), "themeguard-unread-"));
let n = 0;
const sheet = (css: string, name = `s${n++}.css`): string => {
  const path = join(dir, name);
  writeFileSync(path, css, "utf8");
  return path;
};

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("unreadColorSyntax — which syntax kept a token out", () => {
  it.each([
    ["light-dark(#fff, #000)", "light-dark"],
    ["LIGHT-DARK(var(--a), var(--b))", "light-dark"],
    ["color-mix(in srgb, #fff 90%, #000)", "color-mix"],
    ["oklch(from var(--x) l c h)", "relative-color"],
    ["rgb(from #123456 r g b / 50%)", "relative-color"],
    ["color(display-p3 1 0 0)", "color(display-p3)"],
    ["color(rec2020 0.1 0.2 0.3)", "color(rec2020)"],
    ["currentColor", "currentColor"],
    ["CURRENTCOLOR", "currentColor"],
    ["Canvas", "system-color"],
    ["ButtonText", "system-color"],
  ])("%s → %s", (value, syntax) => {
    expect(unreadColorSyntax(value)).toBe(syntax);
  });

  it.each([
    "16px",
    "200ms ease-in",
    '"Inter", system-ui, sans-serif',
    "0 1px 2px rgba(0, 0, 0, 0.2)",
    "0 0 0 2px color-mix(in srgb, red 50%, blue)",
    "1px solid currentColor",
    "calc(var(--x) + 2px)",
    "color(srgb 1 0 0)",
    "not-a-colour",
  ])("%s is not listed", (value) => {
    expect(unreadColorSyntax(value)).toBeNull();
  });
});

describe("the nine-token stylesheet — exactly the seven syntax-matching tokens", () => {
  const path = sheet(NINE_TOKENS);
  const result = run(path);

  it("lists bg, fg, card, muted, accent, sh and cc — and neither hex token", () => {
    const rows = audit(resolveCss(NINE_TOKENS)).unreadColors;
    expect(rows.map((r) => [r.token, r.syntax])).toEqual([
      ["--accent", "relative-color"],
      ["--bg", "light-dark"],
      ["--card", "color-mix"],
      ["--cc", "currentColor"],
      ["--fg", "light-dark"],
      ["--muted", "color-mix"],
      ["--sh", "color(display-p3)"],
    ]);
  });

  it("prints a counted section with a per-theme headline and a row per token", () => {
    expect(result.stdout).toContain("unread-colors (7)");
    expect(result.stdout).toContain("  root: 7 of 9 tokens not read.");
    expect(result.stdout).toContain(
      '    [unread] --bg (light-dark) in theme "root", declared at line 3',
    );
    expect(result.stdout).toContain(
      '    [unread] --sh (color(display-p3)) in theme "root", declared at line 10',
    );
    expect(result.out.filter((l) => l.startsWith("    [unread] "))).toHaveLength(7);
  });

  it("never moves the exit code, and the hex pair is the only collision", () => {
    expect(result.stdout).toContain("collision (1)");
    const clean = run(sheet(":root { --a: light-dark(#fff, #000); }\nbody { color: var(--a); }"));
    expect(clean.code).toBe(EXIT_OK);
    expect(clean.stdout).toContain("unread-colors (1)");
  });

  it("sits after coverage and before the summary line", () => {
    const at = result.out.findIndex((l) => l.startsWith("unread-colors ("));
    expect(at).toBeGreaterThan(result.out.findIndex((l) => l.startsWith("coverage (")));
    expect(at).toBeLessThan(result.out.findIndex((l) => /^\d+ findings?:|^No findings/.test(l)));
  });

  it("--json carries {theme, token, syntax, line} per row, appended last", () => {
    const report = JSON.parse(run("--json", path).out[0] as string) as {
      unreadColors: Record<string, unknown>[];
    };
    expect(Object.keys(report).at(-1)).toBe("unreadColors");
    expect(report.unreadColors).toHaveLength(7);
    expect(report.unreadColors.find((r) => r.token === "--bg")).toEqual({
      theme: "root",
      token: "--bg",
      syntax: "light-dark",
      line: 3,
      declaration: "declared",
    });
  });
});

describe("what stays out", () => {
  it("a hex-only sheet prints the zero line and an empty array", () => {
    const path = sheet(
      ":root { --a: #fff; --b: #101010; --gap: 8px; --font: Inter, sans-serif; --sh: 0 1px 2px rgba(0,0,0,.2); --t: 200ms; }\nbody { color: var(--b); background: var(--a); gap: var(--gap); font-family: var(--font); box-shadow: var(--sh); transition: var(--t); }",
    );
    const text = run(path);
    expect(text.stdout).toContain("unread-colors (0)");
    expect(text.stdout).toContain(
      "nothing left out — every colour-valued token was read by the colour rules.",
    );
    const json = JSON.parse(run("--json", path).out[0] as string) as { unreadColors: unknown };
    expect(json.unreadColors).toEqual([]);
  });

  it("does not list a length or a font stack beside a listed token", () => {
    const rows = audit(
      resolveCss(":root { --gap: 8px; --font: Inter, sans-serif; --bg: light-dark(#fff, #000); }"),
    ).unreadColors;
    expect(rows.map((r) => r.token)).toEqual(["--bg"]);
  });
});

describe("themes, aliases and imports", () => {
  it("lists a token a theme merely inherits under that theme, saying so", () => {
    const css = `
:root { --bg: light-dark(#fff, #000); --ink: #101010; }
[data-theme="dark"] { --ink: #f0f0f0; }
body { background: var(--bg); color: var(--ink); }
`;
    const rows = audit(resolveCss(css)).unreadColors;
    expect(rows.map((r) => [r.theme, r.token, r.declaration])).toEqual([
      ["root", "--bg", "declared"],
      ["dark", "--bg", "inherited"],
    ]);
    const text = run(sheet(css)).stdout;
    expect(text).toContain("unread-colors (2)");
    expect(text).toContain("  dark: 1 of 2 token");
    expect(text).toContain(
      '    [unread] --bg (light-dark) in theme "dark", inherited from :root, declared at line 2',
    );
  });

  it("lists a token that resolves through var() to unread syntax", () => {
    const rows = audit(
      resolveCss(":root { --base: color-mix(in srgb, red, blue); --alias: var(--base); }"),
    ).unreadColors;
    expect(rows.map((r) => [r.token, r.syntax])).toEqual([
      ["--alias", "color-mix"],
      ["--base", "color-mix"],
    ]);
  });

  it("cites an @import origin by file", () => {
    sheet(":root {\n  --bg: light-dark(#fff, #000);\n}\n", "imported-tokens.css");
    const path = sheet('@import "./imported-tokens.css";\nbody { background: var(--bg); }\n');
    const text = run(path).stdout;
    expect(text).toContain("unread-colors (1)");
    expect(text).toContain(
      '    [unread] --bg (light-dark) in theme "root", declared at imported-tokens.css:2',
    );
    const json = JSON.parse(run("--json", path).out[0] as string) as {
      unreadColors: { importOrigin?: string; line: number }[];
    };
    expect(json.unreadColors[0]).toMatchObject({ importOrigin: "imported-tokens.css", line: 2 });
  });
});

describe("unread-colors branch pins", () => {
  it("a whole-value call followed by more value is not listed", () => {
    expect(unreadColorSyntax("color-mix(in srgb, red, blue) 10%")).toBeNull();
    expect(unreadColorSyntax("light-dark(#fff, #000) !important")).toBeNull();
  });

  it.each(["hsl", "hsla", "hwb", "lab", "lch", "oklab"])(
    "%s(from ...) is relative-color",
    (f) => {
      expect(unreadColorSyntax(`${f}(from var(--x) h s l)`)).toBe("relative-color");
    },
  );

  it("names an @theme inline declaration and the singular token noun", () => {
    const css = "@theme inline { --bg: light-dark(#fff, #000); }\nbody{background:var(--bg)}";
    const r = resolveCss(css);
    const out = formatReport("x.css", audit(r), [], [], [], css, themeTokenTotals(r));
    expect(out).toContain(
      '    [unread] --bg (light-dark) in theme "root", declared in @theme inline at line 1',
    );
    expect(out).toContain("  root: 1 of 1 token not read.");
  });
});
