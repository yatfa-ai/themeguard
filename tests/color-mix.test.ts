// color-mix(in srgb | srgb-linear, A [N%], B [M%]) is evaluated, not left unread.
//
// Reference values are independent of src/color.ts: the four toast surfaces are
// the hexes the calibration stylesheet's OWN comment hand-computed (application
// .tailwind.css, "-> #123132 / #2A1C2D / #322B25 / #162749"), and the rest are
// byte arithmetic done here from the CSS Color 5 rules (premultiplied alpha,
// percentage normalisation). oklab/lab are deliberately NOT evaluated in v1 —
// there is no independently computed reference to calibrate a mix against.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseColor, toCss, toHex } from "../src/color.js";
import { resolveCss, ROOT_THEME } from "../src/resolve.js";

const hexOf = (v: string): string => {
  const c = parseColor(v);
  if (c === null) throw new Error(`${v} did not parse`);
  return toHex(c);
};
const cssOf = (v: string): string | null => {
  const c = parseColor(v);
  return c === null ? null : toCss(c);
};

describe("parseColor — color-mix() of literal colours", () => {
  it("mixes srgb by the written percentages", () => {
    expect(hexOf("color-mix(in srgb, #fff 90%, #000)")).toBe("#E6E6E6"); // 229.5 → 230
    expect(hexOf("color-mix(in srgb, red 25%, blue 75%)")).toBe("#4000BF"); // 63.75 → 64, 191.25 → 191
  });

  it("defaults both-omitted to 50/50 and one-omitted to 100 minus the other", () => {
    expect(hexOf("color-mix(in srgb, #000, #fff)")).toBe("#808080"); // 127.5 → 128
    expect(hexOf("color-mix(in srgb, #fff 30%, #000)")).toBe(hexOf("color-mix(in srgb, #fff 30%, #000 70%)"));
    expect(hexOf("color-mix(in srgb, #fff, #000 30%)")).toBe(hexOf("color-mix(in srgb, #fff 70%, #000 30%)"));
  });

  it("accepts the percentage before or after the colour, and any case", () => {
    expect(hexOf("COLOR-MIX(IN SRGB, 90% #fff, #000)")).toBe("#E6E6E6");
    expect(hexOf("color-mix(in srgb,#fff 90%,#000)")).toBe("#E6E6E6");
    expect(hexOf("color-mix(in srgb, rgb(255 255 255) 90%, #000)")).toBe("#E6E6E6");
  });

  it("scales a sum above 100 and multiplies alpha by a sum below 100", () => {
    expect(cssOf("color-mix(in srgb, red 80%, blue 80%)")).toBe("#800080"); // 50/50, opaque
    // 20% + 30% = 50% → weights 0.4/0.6, alpha 0.5
    expect(cssOf("color-mix(in srgb, red 20%, blue 30%)")).toBe("rgba(102, 0, 153, 0.5)");
    expect(cssOf("color-mix(in srgb, red 0%, blue 0%)")).toBeNull();
  });

  it("interpolates premultiplied: a transparent operand fades the mix without darkening it", () => {
    expect(cssOf("color-mix(in srgb, red, transparent)")).toBe("rgba(255, 0, 0, 0.5)");
    expect(cssOf("color-mix(in srgb, rgba(0, 0, 255, 0.5) 50%, red 50%)")).toBe(
      // alpha 0.75; blue weight 0.25/0.75, red 0.5/0.75
      "rgba(170, 0, 85, 0.75)",
    );
    expect(cssOf("color-mix(in srgb, transparent, transparent)")).toBe("rgba(0, 0, 0, 0)");
  });

  it("mixes srgb-linear in linear light", () => {
    const encode = (l: number) => Math.round(255 * (1.055 * l ** (1 / 2.4) - 0.055));
    const half = encode(0.5);
    const hex = half.toString(16).toUpperCase().padStart(2, "0");
    expect(hexOf("color-mix(in srgb-linear, #000, #fff)")).toBe(`#${hex}${hex}${hex}`);
    // an identical pair is a fixed point in either space
    expect(hexOf("color-mix(in srgb-linear, #123456, #123456)")).toBe("#123456");
  });

  it("reads nested color-mix() and any operand parseColor already reads", () => {
    expect(hexOf("color-mix(in srgb, color-mix(in srgb, #fff, #000) 50%, #000)")).toBe("#404040");
    expect(hexOf("color-mix(in srgb, white 50%, hsl(0 0% 0%))")).toBe("#808080");
    expect(hexOf("color-mix(in srgb, oklch(1 0 0), black)")).toBe("#808080");
  });

  it.each([
    ["polar space", "color-mix(in oklch, red, blue)"],
    ["hsl", "color-mix(in hsl, red, blue)"],
    ["hue method", "color-mix(in srgb longer hue, red, blue)"],
    ["oklab (no reference in v1)", "color-mix(in oklab, red, blue)"],
    ["lab (no reference in v1)", "color-mix(in lab, red, blue)"],
    ["xyz", "color-mix(in xyz, red, blue)"],
    ["currentColor operand", "color-mix(in srgb, currentColor 25%, transparent)"],
    ["system colour operand", "color-mix(in srgb, Canvas, red)"],
    ["light-dark operand", "color-mix(in srgb, light-dark(#fff, #000), red)"],
    ["var operand", "color-mix(in srgb, var(--a), red)"],
    ["calc operand", "color-mix(in srgb, red calc(10% + 5%), blue)"],
    ["negative percentage", "color-mix(in srgb, red -10%, blue)"],
    ["percentage over 100", "color-mix(in srgb, red 120%, blue)"],
    ["one item", "color-mix(in srgb, red)"],
    ["three items", "color-mix(in srgb, red, blue, green)"],
    ["no space", "color-mix(red, blue)"],
    ["trailing text", "color-mix(in srgb, red, blue) 10%"],
    ["unbalanced", "color-mix(in srgb, rgb(1 2 3, blue)"],
  ])("declines %s with null — never a guess", (_label, value) => {
    expect(parseColor(value), value).toBeNull();
  });
});

describe("the resolver substitutes var() operands per theme", () => {
  it("evaluates the calibration fixture's four toast surfaces to the stylesheet's own hand values", () => {
    const r = resolveCss(
      readFileSync(new URL("./fixtures/application.tailwind.css", import.meta.url), "utf8"),
    );
    const hexes = ["success", "error", "warning", "info"].map((n) => {
      const t = r.token(`--app-${n}-toast-surface`, ROOT_THEME);
      expect(t?.kind).toBe("color");
      return toHex(t?.color as NonNullable<typeof t>["color"] & object);
    });
    expect(hexes).toEqual(["#123132", "#2A1C2D", "#322B25", "#162749"]);
    // The alias namespace reaches them too.
    expect(r.token("--color-app-success-toast-surface", ROOT_THEME)?.kind).toBe("color");
    // …and winter, which overrides them to plain hexes, is unchanged.
    expect(r.token("--app-success-toast-surface", "winter")?.resolvedValue).toBe("#dcfce7");
  });

  it("keeps declaredValue as written and makes resolvedValue the substituted text", () => {
    const r = resolveCss(
      ":root { --base: #ffffff; --tint: #000000; --mix: color-mix(in srgb, var(--base) 15%, var(--tint)); }",
    );
    const t = r.token("--mix", ROOT_THEME);
    expect(t?.kind).toBe("color");
    expect(t?.declaredValue).toBe("color-mix(in srgb, var(--base) 15%, var(--tint))");
    expect(t?.resolvedValue).toBe("color-mix(in srgb, #ffffff 15%, #000000)");
    expect(toHex(t?.color as never)).toBe("#262626");
    expect(t?.chain).toEqual(["--mix"]);
  });

  it("follows a var() chain to the operand and through an alias of the mix", () => {
    const r = resolveCss(
      ":root { --a: #ffffff; --b: var(--a); --mix: color-mix(in srgb, var(--b), #000); --alias: var(--mix); }",
    );
    expect(toHex(r.token("--alias", ROOT_THEME)?.color as never)).toBe("#808080");
  });

  it("evaluates a nested color-mix whose operand is a var()", () => {
    const r = resolveCss(
      ":root { --w: #ffffff; --m: color-mix(in srgb, color-mix(in srgb, var(--w), #000) 50%, #000); }",
    );
    expect(toHex(r.token("--m", ROOT_THEME)?.color as never)).toBe("#404040");
  });

  it("evaluates the SAME declaration differently in each theme's view", () => {
    const r = resolveCss(`
:root { --surface: #000000; --accent: #ffffff; --wash: color-mix(in srgb, var(--accent) 20%, var(--surface)); }
[data-theme="light"] { --surface: #ffffff; --accent: #000000; }
`);
    expect(toHex(r.token("--wash", ROOT_THEME)?.color as never)).toBe("#333333");
    const light = r.token("--wash", "light");
    expect(light?.origin).toBe("inherited");
    expect(toHex(light?.color as never)).toBe("#CCCCCC");
  });

  it("flags a translucent mix as translucent, uncomposited", () => {
    const r = resolveCss(":root { --c: #ff0000; --t: color-mix(in srgb, var(--c), transparent); }");
    const t = r.token("--t", ROOT_THEME);
    expect(t?.kind).toBe("color");
    expect(t?.translucent).toBe(true);
    expect(t?.resolvedValue).toBe("color-mix(in srgb, #ff0000, transparent)");
  });

  it("does not mistake two operands that share a base for a loop", () => {
    const r = resolveCss(
      ":root { --base: #ffffff; --x: var(--base); --y: var(--base); --m: color-mix(in srgb, var(--x), var(--y)); }",
    );
    expect(r.token("--m", ROOT_THEME)?.kind).toBe("color");
  });

  describe("every decline arm leaves the token unread, as before", () => {
    const decline = (css: string, name: string, kind: string) => {
      const r = resolveCss(css);
      const t = r.token(name, ROOT_THEME);
      expect(t?.kind).toBe(kind);
      expect(t?.color ?? null).toBeNull();
      return r;
    };

    it("polar space, even with resolvable operands", () => {
      const r = decline(
        ":root { --a: #fff; --m: color-mix(in oklch, var(--a), #000); }",
        "--m",
        "non-color",
      );
      expect(r.token("--m", ROOT_THEME)?.resolvedValue).toBe("color-mix(in oklch, var(--a), #000)");
      expect(audit(r).unreadColors.map((u) => u.token)).toEqual(["--m"]);
    });

    it("currentColor operand", () => {
      const r = decline(
        ":root { --a: #fff; --m: color-mix(in srgb, var(--a) 25%, currentColor); }",
        "--m",
        "non-color",
      );
      expect(audit(r).unreadColors.map((u) => u.token)).toEqual(["--m"]);
    });

    it("unresolved var operand — rule 5 still reports it", () => {
      const r = decline(":root { --m: color-mix(in srgb, var(--nope), #000); }\n.x { color: var(--m); }", "--m", "non-color");
      expect(audit(r).countsByRule["unresolved-reference"]).toBe(1);
    });

    it("an operand that resolves to a non-colour", () => {
      decline(":root { --len: 4px; --m: color-mix(in srgb, var(--len), #000); }", "--m", "non-color");
    });

    it("loop operand — never evaluated, rule 6 reports it as before", () => {
      const r = resolveCss(
        ":root { --a: color-mix(in srgb, var(--b) 15%, #fff); --b: var(--a); --c: color-mix(in srgb, var(--b), #000); }",
      );
      expect(r.token("--a", ROOT_THEME)?.kind).toBe("cycle");
      expect(r.token("--b", ROOT_THEME)?.kind).toBe("cycle");
      expect(r.token("--c", ROOT_THEME)?.kind).not.toBe("color");
      expect(audit(r).countsByRule["cycle-reference"]).toBeGreaterThan(0);
    });

    it("an indirect loop through the mix itself", () => {
      const r = resolveCss(
        ":root { --a: color-mix(in srgb, var(--b), #000); --b: color-mix(in srgb, var(--a), #fff); }",
      );
      expect(r.tokens.some((t) => t.kind === "color")).toBe(false);
    });
  });
});

describe("evaluated mixes enter the colour rules", () => {
  it("reports color-mix(in srgb,#fff 90%,#000) as a collision with its #e6e6e6 hex twin", () => {
    const css = `
:root { --app-border: color-mix(in srgb,#fff 90%,#000); --app-line: #e6e6e6; }
[data-theme="dark"] { --app-border: #333333; --app-line: #444444; }
`;
    const report = audit(resolveCss(css));
    const hits = report.findings.filter(
      (f) => f.rule === "collision" && f.tokens.includes("--app-border") && f.tokens.includes("--app-line"),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.theme).toBe("root");
    expect(report.unreadColors).toEqual([]);
  });

  it("reports two byte-identical color-mix tokens as a collision", () => {
    const css = `
:root { --app-border: color-mix(in srgb,#fff 90%,#000); --app-line: color-mix(in srgb,#fff 90%,#000); }
[data-theme="dark"] { --app-border: #333333; --app-line: #444444; }
`;
    const hits = audit(resolveCss(css)).findings.filter((f) => f.rule === "collision");
    expect(hits.map((f) => f.tokens)).toEqual([["--app-border", "--app-line"]]);
  });
});
