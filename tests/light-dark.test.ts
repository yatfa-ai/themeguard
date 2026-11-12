// `light-dark(A, B)` is evaluated per theme view, not left unread.
//
// The reproduction pair is the defect this fixes: the same two-role palette
// written once in `light-dark()` and once in hex + a `prefers-color-scheme`
// dark block must reach the SAME verdict. Before this, the hex twin exited 1
// with `collision (1)` in theme "dark" while the light-dark twin exited 0 with
// `unread-colors (2)` — same defect, opposite verdicts, because the resolver
// classified the whole `light-dark()` value non-colour and no colour rule
// judged it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { lightDarkParts } from "../src/color.js";
import { EXIT_FINDINGS, EXIT_OK } from "../src/cli.js";
import { IMPLICIT_DARK_THEME, ROOT_THEME, resolveCss } from "../src/resolve.js";
import { run } from "./run.js";

// Created at module load, not in a hook: describe bodies below call `run(...)`
// during collection, before any `beforeAll` has run.
const dir = mkdtempSync(join(tmpdir(), "themeguard-light-dark-"));
let n = 0;
const sheet = (css: string, name = `s${n++}.css`): string => {
  const path = join(dir, name);
  writeFileSync(path, css, "utf8");
  return path;
};

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The hex twin: the dark palette spelled as a `prefers-color-scheme` block. */
const REPRO_HEX = `
:root { --success:#16a34a; --info:#2563eb; }
@media (prefers-color-scheme: dark) { :root { --success:#22c55e; --info:#22c55e; } }
.a{color:var(--success);border-color:var(--info)}
`;

/** The light-dark twin: the same palette, one token, two arms. */
const REPRO_LD = `
:root { --success: light-dark(#16a34a, #22c55e);
  --info:    light-dark(#2563eb, #22c55e); }
.a{color:var(--success);border-color:var(--info)}
`;

describe("the arm a theme view paints", () => {
  it("dark views take B, every other view A — declaredValue stays as written", () => {
    const r = resolveCss(":root { --x: light-dark(#ffffff, #000000); }");
    expect(r.implicitThemes).toEqual([IMPLICIT_DARK_THEME]);
    const root = r.token("--x", ROOT_THEME)!;
    expect(root.declaredValue).toBe("light-dark(#ffffff, #000000)");
    expect(root.resolvedValue).toBe("#ffffff");
    expect(root.kind).toBe("color");
    const dark = r.token("--x", IMPLICIT_DARK_THEME)!;
    expect(dark.declaredValue).toBe("light-dark(#ffffff, #000000)");
    expect(dark.resolvedValue).toBe("#000000");
    expect(dark.kind).toBe("color");
  });

  it.each([
    ["media block", '@media (prefers-color-scheme: dark) { :root { --y: #111; } }', "dark"],
    ["class theme", ".dark { --y: #111; }", "dark"],
    ["attribute theme", '[data-theme="dark"] { --y: #111; }', "dark"],
    // Attribute values keep their written case as the theme NAME, and the
    // name is the only colour-scheme signal this package has — "Dark" says
    // dark the same way "dark" does.
    ["attribute theme, capitalised", '[data-theme="Dark"] { --y: #111; }', "Dark"],
  ])("a dark theme declared as a %s takes the dark arm and suppresses the implicit view", (_label, themeCss, themeName) => {
    const css = `:root { --x: light-dark(#fff, #000); }\n${themeCss}\n.z { color: var(--x); background: var(--y); }`;
    const r = resolveCss(css);
    // Declaring a dark theme by any spelling is the author speaking for the
    // dark view themselves: no implicit view is minted beside it.
    expect(r.implicitThemes).toEqual([]);
    expect(r.themes).toEqual([ROOT_THEME, themeName]);
    expect(r.token("--x", themeName)!.resolvedValue).toBe("#000");
    expect(r.token("--x", ROOT_THEME)!.resolvedValue).toBe("#fff");
  });

  it("a light theme is a light view: arm A — and the implicit dark view still exists", () => {
    const r = resolveCss(
      ":root { --x: light-dark(#fff, #000); }\n@media (prefers-color-scheme: light) { :root { --y: #222; } }",
    );
    expect(r.themes).toEqual([ROOT_THEME, "light", IMPLICIT_DARK_THEME]);
    expect(r.token("--x", "light")!.resolvedValue).toBe("#fff");
    expect(r.token("--x", IMPLICIT_DARK_THEME)!.resolvedValue).toBe("#000");
  });

  it("a var() arm resolves through the walk, in the theme's own view", () => {
    const r = resolveCss(":root { --base: #123456; --x: light-dark(red, var(--base)); }");
    expect(r.token("--x", ROOT_THEME)!.resolvedValue).toBe("red");
    expect(r.token("--x", IMPLICIT_DARK_THEME)!.resolvedValue).toBe("#123456");
  });

  it("a nested color-mix() arm resolves the same way color-mix() does", () => {
    const r = resolveCss(":root { --x: light-dark(red, color-mix(in srgb, #fff 50%, #000)); }");
    expect(r.token("--x", ROOT_THEME)!.resolvedValue).toBe("red");
    expect(r.token("--x", IMPLICIT_DARK_THEME)!.resolvedValue).toBe(
      "color-mix(in srgb, #fff 50%, #000)",
    );
    expect(r.token("--x", IMPLICIT_DARK_THEME)!.kind).toBe("color");
  });

  it.each([
    ["an unresolved var() arm", "light-dark(red, var(--nope))"],
    ["a non-sRGB arm", "light-dark(red, color(display-p3 1 0 0))"],
  ])("%s leaves the token as written and unread in the view whose arm it is", (_label, value) => {
    const r = resolveCss(`:root { --x: ${value}; }`);
    const root = r.token("--x", ROOT_THEME)!;
    expect(root.kind).toBe("color");
    expect(root.resolvedValue).toBe("red");
    const dark = r.token("--x", IMPLICIT_DARK_THEME)!;
    // The chosen arm does not resolve here: the token keeps its bytes and
    // unread-colors names it — it is never a colour the view does not paint.
    expect(dark.kind).toBe("non-color");
    expect(dark.resolvedValue).toBe(value);
    const report = audit(r);
    expect(
      report.unreadColors.map((u) => [u.theme, u.token, u.syntax]),
    ).toEqual([[IMPLICIT_DARK_THEME, "--x", "light-dark"]]);
  });

  it("a loop closed through a dark arm is the dark view's cycle, not the light view's", () => {
    const r = resolveCss(
      ":root { --a: light-dark(red, var(--b)); --b: var(--c); --c: var(--b); }",
    );
    // The light arm is a literal colour: root judges it a colour and never
    // walks the dark arm.
    expect(r.token("--a", ROOT_THEME)!.kind).toBe("color");
    // The dark arm closes a loop: the arm walk returns `cycle` and the
    // completion pass re-marks the token, the same as a color-mix() operand
    // loop.
    const dark = r.token("--a", IMPLICIT_DARK_THEME)!;
    expect(dark.kind).toBe("cycle");
    expect(dark.chain).toEqual(["--a", "--b", "--c", "--b"]);
  });
});

describe("the reproduction pair reaches one verdict", () => {
  it("the hex twin exits 1 with the dark collision", () => {
    const result = run(sheet(REPRO_HEX));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain('both resolve to #22C55E in theme "dark"');
  });

  it("the light-dark twin now exits 1 too — same collision, same dark view", () => {
    const result = run(sheet(REPRO_LD));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain('both resolve to #22C55E in theme "dark"');
    // Both arms are readable everywhere, so nothing is left unread.
    expect(result.stdout).toContain("unread-colors (0)");
    // The finding's theme is the resolver-minted view; coverage says so.
    expect(result.stdout).toContain("coverage (2 themes, 2 base tokens)");
    expect(result.stdout).toContain("dark (implicit): declares 0 of 2 base tokens, inherits 2");
  });
});

describe("the implicit dark view", () => {
  it("exists only when the base palette writes a whole-value light-dark()", () => {
    // Byte stability for every sheet that never speaks light-dark: no theme
    // is minted, resolved output is unchanged.
    expect(resolveCss(":root { --x: red; }").themes).toEqual([ROOT_THEME]);
    expect(resolveCss(":root { --x: red; }").implicitThemes).toEqual([]);
    // Embedded in a compound value is out of scope: unread, and it triggers
    // nothing.
    const embedded = resolveCss(":root { --x: 0 0 2px light-dark(#fff, #000); }");
    expect(embedded.themes).toEqual([ROOT_THEME]);
    expect(embedded.token("--x", ROOT_THEME)!.kind).toBe("non-color");
    // A light-dark() declared only inside a NAMED theme's block is invisible
    // to the implicit view (which is :root plus the alias layer) and cannot
    // mint it.
    const themedOnly = resolveCss(
      ":root { --y: #222; }\n[data-theme=winter] { --x: light-dark(#fff, #000); }",
    );
    expect(themedOnly.themes).toEqual([ROOT_THEME, "winter"]);
  });

  it("every token in it is inherited from :root, and coverage marks the row implicit", () => {
    const r = resolveCss(REPRO_LD);
    for (const token of r.tokensFor(IMPLICIT_DARK_THEME)) {
      expect(token.origin).toBe("inherited");
    }
    const report = audit(r);
    const dark = report.coverage.find((c) => c.theme === IMPLICIT_DARK_THEME)!;
    expect(dark.implicit).toBe(true);
    expect(dark.overridden).toEqual([]);
    expect(dark.inherited.map((e) => e.name)).toEqual(["--info", "--success"]);
    // The declared theme's row carries no flag at all — absent, never false.
    expect("implicit" in report.coverage[0]!).toBe(false);
  });

  it("the alias layer resolves per view in it", () => {
    const r = resolveCss(
      ":root { --brand: light-dark(#fff, #000); }\n@theme inline { --color-brand: var(--brand); }",
    );
    expect(r.token("--color-brand", IMPLICIT_DARK_THEME)!.resolvedValue).toBe("#000");
    expect(r.token("--color-brand", ROOT_THEME)!.resolvedValue).toBe("#fff");
  });

  it("a theme-only name stays rule 9's fact, now naming the implicit view too", () => {
    const css = `
:root { --x: var(--winter-only); --brand: light-dark(#fff, #000); }
[data-theme=winter] { --winter-only: #333; }
.z { color: var(--x); }
`;
    const report = audit(resolveCss(css));
    expect(report.countsByRule["theme-partial-token"]).toBe(1);
    // One finding per missing NAME, and the views it lists now include the
    // implicit dark view — the OS-dark user is a view that lacks the name,
    // exactly as the root view is. (--brand is a dead token here — nothing
    // references it — so the finding is looked up by rule, not by position.)
    const partial = report.findings.find((f) => f.rule === "theme-partial-token")!;
    expect(partial.message).toContain('"root"');
    expect(partial.message).toContain('"dark"');
    expect(partial.message).toContain('"winter"');
  });

  it("a theme-scoped suppression aims at the implicit view by its name", () => {
    const resolved = resolveCss(REPRO_LD);
    const entry = {
      rule: "collision" as const,
      tokens: ["--info", "--success"],
      theme: IMPLICIT_DARK_THEME,
      reason: "judged: the dark arms are deliberately equal",
    };
    const suppressed = audit(resolved, { suppressions: [entry] });
    expect(suppressed.findings).toHaveLength(0);
    expect(suppressed.suppressed[0]!.reason).toBe(entry.reason);
    // A scope naming ANOTHER theme leaves the finding live, and the entry
    // unmatched — the ordinary scoped-entry behaviour, unchanged.
    const otherTheme = audit(resolved, {
      suppressions: [{ ...entry, theme: "root" }],
    });
    expect(otherTheme.findings).toHaveLength(1);
    expect(otherTheme.unmatchedSuppressions).toHaveLength(1);
  });

  it("the prose marks the view, and --json carries implicit: true on the row", () => {
    const path = sheet(REPRO_LD);
    const text = run(path).stdout;
    expect(text).toContain(
      "  dark is a view the resolver minted itself: no dark theme is declared, so it models the OS-dark reading of the base palette — every token inherited from :root, light-dark() taking its dark arm.",
    );
    expect(text).toContain("dark (implicit):");
    // A declared dark theme never gains the explainer or the label.
    const declared = run(sheet(REPRO_HEX)).stdout;
    expect(declared).not.toContain("(implicit)");
    expect(declared).not.toContain("minted itself");

    const report = JSON.parse(run("--json", path).out[0] as string) as {
      coverage: Record<string, unknown>[];
    };
    expect(report.coverage.map((c) => [c.theme, c.implicit ?? false])).toEqual([
      ["root", false],
      ["dark", true],
    ]);
  });
});

describe("a value that is not exactly one two-argument light-dark() call", () => {
  const malformed = [
    "light-dark(#fff)",
    "light-dark(#fff, #000, #111)",
    "light-dark(, #000)",
    "light-dark(#fff, )",
    "light-dark(#fff, #000) calc(1px)",
    "light-dark(#fff, (#000)",
  ];

  it("parses a well-formed call: trims, opens case-insensitively, splits only at depth 1", () => {
    expect(lightDarkParts("  LIGHT-DARK( #fff ,  rgb(0, 0, 0) )  ")).toEqual({
      light: "#fff",
      dark: "rgb(0, 0, 0)",
    });
  });

  it.each(malformed)("lightDarkParts refuses %s", (value) => {
    expect(lightDarkParts(value)).toBeNull();
  });

  it.each(malformed)("%s stays unread and mints no implicit dark view", (value) => {
    const r = resolveCss(`:root { --x: ${value}; }`);
    expect(r.themes).toEqual([ROOT_THEME]);
    expect(r.implicitThemes).toEqual([]);
    const token = r.token("--x", ROOT_THEME)!;
    expect(token.kind).toBe("non-color");
    expect(token.resolvedValue).toBe(token.declaredValue);
  });
});
