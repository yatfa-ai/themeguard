// parseColor reads the modern colour syntaxes (oklch/oklab/lab/lch/hwb/color(srgb))
// and the CSS named colours. Before this, every such value classified as
// "non-color", so a stylesheet written in oklch() audited `No findings.` while
// its hex twin reported the collisions — silently, with nothing in the report
// saying tokens had been left out.
//
// Reference values are independent of src/color.ts: the identities are the
// well-known shadcn/Tailwind v4 greys, and the non-grey colours were converted
// with culori (a separate CSS Color 4 implementation) and cross-checked against
// the CSS Color 4 spec's own red/blue/lime coordinates (oklch 0.628 0.2577 29.23
// is sRGB red, oklch 0.452 0.3132 264.05 is blue, lab 54.2905 80.8049 69.891 is
// red, lab 87.82 -79.27 80.99 is lime).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseColor, toHex } from "../src/color.js";
import { resolveCss, ROOT_THEME } from "../src/resolve.js";
import { run } from "./run.js";

const hexOf = (v: string): string => {
  const c = parseColor(v);
  if (c === null) throw new Error(`${v} did not parse`);
  return toHex(c);
};

describe("oklch() / oklab()", () => {
  it("lands the achromatic identities on the exact greys", () => {
    expect(hexOf("oklch(1 0 0)")).toBe("#FFFFFF");
    expect(hexOf("oklch(0 0 0)")).toBe("#000000");
    expect(hexOf("oklch(0.145 0 0)")).toBe("#0A0A0A");
    expect(hexOf("oklch(0.97 0 0)")).toBe("#F5F5F5");
    expect(hexOf("oklch(0.922 0 0)")).toBe("#E5E5E5");
    expect(hexOf("oklch(0.269 0 0)")).toBe("#262626");
    expect(parseColor("oklch(1 0 0)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it("agrees with the CSS Color 4 coordinates of sRGB red and blue", () => {
    expect(hexOf("oklch(0.628 0.2577 29.23)")).toBe("#FF0000");
    expect(hexOf("oklch(0.452 0.3132 264.05)")).toBe("#0000FF");
  });

  it("converts chromatic colours to their hex twins", () => {
    expect(hexOf("oklch(0.5 0.3 120)")).toBe("#547200");
    expect(hexOf("oklab(0.6 -0.1 0.1)")).toBe("#599233");
    expect(hexOf("oklab(0.5 0.1 -0.1)")).toBe("#81459A");
  });

  it("reads percentage channels (L: 100% = 1, chroma and a/b: 100% = 0.4)", () => {
    expect(parseColor("oklch(97% 0 0)")).toEqual(parseColor("oklch(0.97 0 0)"));
    expect(parseColor("oklch(50% 75% 120)")).toEqual(parseColor("oklch(0.5 0.3 120)"));
    expect(parseColor("oklab(60% -25% 25%)")).toEqual(parseColor("oklab(0.6 -0.1 0.1)"));
  });

  it("reads every hue unit as the same angle", () => {
    const deg = parseColor("oklch(0.6 0.1 90)");
    expect(deg).not.toBeNull();
    expect(parseColor("oklch(0.6 0.1 90deg)")).toEqual(deg);
    expect(parseColor("oklch(0.6 0.1 0.25turn)")).toEqual(deg);
    expect(parseColor("oklch(0.6 0.1 100grad)")).toEqual(deg);
    expect(parseColor("oklch(0.6 0.1 1.5707963267948966rad)")).toEqual(deg);
    expect(hexOf("oklch(0.6 0.1 0.25turn)")).toBe("#977D30");
  });

  it("normalizes a negative and an over-360 hue onto the same wheel", () => {
    expect(parseColor("oklch(0.6 0.1 -90)")).toEqual(parseColor("oklch(0.6 0.1 270)"));
    expect(parseColor("oklch(0.6 0.1 450)")).toEqual(parseColor("oklch(0.6 0.1 90)"));
  });

  it("reads `none` as 0 in any channel and in alpha", () => {
    expect(parseColor("oklch(0.5 none none)")).toEqual(parseColor("oklch(0.5 0 0)"));
    expect(parseColor("oklch(none 0 0)")).toEqual(parseColor("oklch(0 0 0)"));
    expect(parseColor("oklch(1 0 0 / none)")).toEqual({ r: 255, g: 255, b: 255, a: 0 });
    expect(parseColor("oklab(0.6 none 0.1)")).toEqual(parseColor("oklab(0.6 0 0.1)"));
  });

  it("reads alpha as a number or a percentage", () => {
    expect(parseColor("oklch(1 0 0 / 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor("oklch(1 0 0 / 50%)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor("oklab(0.145 0 0/0.25)")?.a).toBe(0.25);
  });

  it("clips an out-of-gamut colour per channel instead of gamut-mapping it", () => {
    // Linear sRGB red is about -0.32 here: it clips to 0, and green/blue keep
    // their own values — no chroma reduction to pull the colour into gamut.
    expect(parseColor("oklch(0.7 0.15 200)")).toEqual({ r: 0, g: 185, b: 195, a: 1 });
    expect(hexOf("oklch(0.7 0.15 200)")).toBe("#00B9C3");
    // Far above white / below black: still just clipped.
    expect(hexOf("oklch(2 0 0)")).toBe("#FFFFFF");
    expect(hexOf("oklch(-1 0 0)")).toBe("#000000");
  });

  it("is case-insensitive about the function name and `none`", () => {
    expect(parseColor("OKLCH(1 0 0)")).toEqual(parseColor("oklch(1 0 0)"));
    expect(parseColor("  oklch( 0.97  0  0 )  ")).toEqual(parseColor("oklch(0.97 0 0)"));
    expect(parseColor("oklch(0.5 NONE 0)")).toEqual(parseColor("oklch(0.5 0 0)"));
  });
});

describe("lab() / lch()", () => {
  it("agrees with the CSS Color 4 coordinates of sRGB red and lime", () => {
    expect(hexOf("lab(54.2905 80.8049 69.891)")).toBe("#FF0000");
    expect(hexOf("lab(87.82 -79.27 80.99)")).toBe("#00FF00");
  });

  it("lands the achromatic axis on white, black and a mid grey", () => {
    expect(hexOf("lab(100 0 0)")).toBe("#FFFFFF");
    expect(hexOf("lab(0 0 0)")).toBe("#000000");
    expect(hexOf("lch(100 0 0)")).toBe("#FFFFFF");
  });

  it("converts chromatic colours to their hex twins", () => {
    expect(hexOf("lab(60 30 -40)")).toBe("#A97FD8");
    expect(hexOf("lch(60 50 200)")).toBe("#00A6AD");
  });

  it("reads percentage channels (L: 100% = 100, a/b: 100% = 125, chroma: 100% = 150)", () => {
    expect(parseColor("lab(60% 24% -32%)")).toEqual(parseColor("lab(60 30 -40)"));
    expect(parseColor("lch(60% 33.333333333333336% 200)")).toEqual(parseColor("lch(60 50 200)"));
  });

  it("reads hue units, `none` and alpha on lch()", () => {
    expect(parseColor("lch(60 50 0.5555555555555556turn)")).toEqual(parseColor("lch(60 50 200)"));
    expect(parseColor("lch(60 none none)")).toEqual(parseColor("lch(60 0 0)"));
    expect(parseColor("lab(54.2905 80.8049 69.891 / 40%)")).toEqual({ r: 255, g: 0, b: 0, a: 0.4 });
  });
});

describe("hwb()", () => {
  it("converts to the hex twin", () => {
    expect(hexOf("hwb(0 0% 0%)")).toBe("#FF0000");
    expect(hexOf("hwb(120 0% 50%)")).toBe("#008000");
    expect(hexOf("hwb(210 20% 40%)")).toBe("#336699");
    expect(hexOf("hwb(0 100% 0%)")).toBe("#FFFFFF");
    expect(hexOf("hwb(0 0% 100%)")).toBe("#000000");
  });

  it("makes whiteness + blackness >= 100% a grey in the ratio w / (w + b)", () => {
    expect(hexOf("hwb(0 60% 60%)")).toBe("#808080");
  });

  it("reads bare numbers as percentages, hue units, `none` and alpha", () => {
    expect(parseColor("hwb(210 20 40)")).toEqual(parseColor("hwb(210 20% 40%)"));
    expect(parseColor("hwb(0.5turn 20% 40%)")).toEqual(parseColor("hwb(180 20% 40%)"));
    expect(parseColor("hwb(none none none)")).toEqual(parseColor("hwb(0 0% 0%)"));
    expect(parseColor("hwb(0 100% 0% / 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });
});

describe("color(srgb …)", () => {
  it("reads number and percentage channels in 0–1", () => {
    expect(parseColor("color(srgb 1 1 1)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("color(srgb 1 0 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("color(srgb 100% 0% 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(hexOf("color(srgb 0.2 0.4 0.6)")).toBe("#336699");
  });

  it("reads alpha and `none`, and clips out-of-range channels", () => {
    expect(parseColor("color(srgb 1 1 1 / 0.5)")).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
    expect(parseColor("color(srgb 1 none 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("color(srgb 2 -1 0.5)")).toEqual({ r: 255, g: 0, b: 128, a: 1 });
  });

  it("refuses every colour space but srgb rather than guessing", () => {
    for (const v of [
      "color(display-p3 1 0 0)",
      "color(srgb-linear 1 1 1)",
      "color(rec2020 1 0 0)",
      "color(xyz 0.9 1 1.1)",
      "color(1 1 1)",
      "color(srgb 1 1)",
      "color(srgb 1 1 1 1)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });
});

describe("named colours and transparent", () => {
  it("parses the CSS keywords case-insensitively", () => {
    expect(hexOf("white")).toBe("#FFFFFF");
    expect(hexOf("White")).toBe("#FFFFFF");
    expect(hexOf("black")).toBe("#000000");
    expect(hexOf("rebeccapurple")).toBe("#663399");
    expect(hexOf("CornflowerBlue")).toBe("#6495ED");
    expect(hexOf("whitesmoke")).toBe("#F5F5F5");
    expect(parseColor("red")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses `transparent` as fully transparent black", () => {
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("does not treat other keywords, or Object.prototype names, as colours", () => {
    for (const v of [
      "currentcolor",
      "currentColor",
      "inherit",
      "initial",
      "none",
      "auto",
      "canvas",
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "red blue",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });
});

describe("what stays null — never a guess", () => {
  it("refuses malformed modern functional colours", () => {
    for (const v of [
      "oklch()",
      "oklch(1 0)",
      "oklch(1 0 0 0 0)",
      "oklch(1, 0, 0)",
      "oklch(1 0 0 / 1 / 1)",
      "oklch(1 0 0 / 1 2)",
      "oklch(a b c)",
      "oklch(1 0 0x10)",
      "oklch(1 0 Infinity)",
      "oklch(1 0 90furlongs)",
      "oklch(1 0 0 / x)",
      "oklab(1 0)",
      "lab(1 2 3 4 5)",
      "lch(50 20 abc)",
      "hwb(0 x% 0%)",
      "hwb(0, 0%, 0%)",
      "hwb(0 0%)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("keeps relative colour syntax, color-mix() and light-dark() outside the boundary", () => {
    for (const v of [
      "oklch(from var(--brand) l c h)",
      "oklch(from #fff calc(l - 0.1) c h)",
      "color-mix(in oklch, red 40%, blue)",
      "light-dark(white, black)",
      "color(from red srgb r g b)",
      "oklch(var(--l) 0 0)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });
});

describe("the resolver and the CLI see modern-syntax tokens", () => {
  const MIXED = `
:root {
  --a: white;
  --b: #fff;
  --c: rgb(255 255 255);
  --d: color(srgb 1 1 1);
  --e: hwb(0 100% 0%);
  --f: lab(100 0 0);
  --g: oklch(1 0 0);
}
`;

  it("classifies a modern-syntax token as a colour, not a non-colour", () => {
    const sheet = resolveCss(MIXED);
    for (const token of sheet.tokens.filter((t) => t.theme === ROOT_THEME)) {
      expect(token.kind, token.name).toBe("color");
    }
  });

  it("groups all seven spellings of white into ONE collision", () => {
    const groups = resolveCss(MIXED).collisionGroups(ROOT_THEME);
    expect(groups).toHaveLength(1);
    expect(groups[0].value).toBe("#FFFFFF");
    expect(groups[0].names).toEqual(["--a", "--b", "--c", "--d", "--e", "--f", "--g"]);
  });

  it("reports a named-colour collision against a hex twin", () => {
    const groups = resolveCss(":root { --surface: whitesmoke; --muted: #F5F5F5; }").collisionGroups(
      ROOT_THEME,
    );
    expect(groups).toEqual([
      { theme: ROOT_THEME, value: "#F5F5F5", names: ["--muted", "--surface"] },
    ]);
  });

  const tmp = mkdtempSync(join(tmpdir(), "themeguard-modern-colors-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  // The shadcn / Tailwind v4 default palette, once in oklch() and once in hex.
  const SHEET = (v: { white: string; grey: string; border: string; ink: string }): string => `
:root {
  --background: ${v.white};
  --card: ${v.white};
  --accent: ${v.grey};
  --muted: ${v.grey};
  --border: ${v.border};
  --input: ${v.border};
  --foreground: ${v.ink};
}
body { background: var(--background); color: var(--foreground); border-color: var(--border); }
.a { background: var(--card); }
.b { background: var(--accent); }
.c { background: var(--muted); }
.d { border-color: var(--input); }
`;

  function audited(css: string, name: string) {
    const path = join(tmp, name);
    writeFileSync(path, css, "utf8");
    const result = run("--json", path);
    const report = JSON.parse(result.stdout) as {
      findings: { rule: string; tokens: string[]; evidence: { value: string } }[];
    };
    return { code: result.code, findings: report.findings };
  }

  it("an oklch() stylesheet and its hex twin give the same findings and exit code", () => {
    const oklch = audited(
      SHEET({
        white: "oklch(1 0 0)",
        grey: "oklch(0.97 0 0)",
        border: "oklch(0.922 0 0)",
        ink: "oklch(0.145 0 0)",
      }),
      "oklch.css",
    );
    const twin = audited(
      SHEET({ white: "#FFFFFF", grey: "#F5F5F5", border: "#E5E5E5", ink: "#0A0A0A" }),
      "hex.css",
    );
    expect(twin.findings.map((f) => f.rule)).toEqual(["collision", "collision", "collision"]);
    expect(oklch.findings).toEqual(twin.findings);
    expect(oklch.code).toBe(twin.code);
    expect(oklch.code).not.toBe(0);
    expect(oklch.findings.map((f) => f.evidence.value).sort()).toEqual([
      "#E5E5E5",
      "#F5F5F5",
      "#FFFFFF",
    ]);
  });
});
