import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deltaLstar,
  fromHsl,
  isTranslucent,
  lstar,
  over,
  parseColor,
  relativeLuminance,
  rgba,
  toCss,
  toHex,
  TranslucentColorError,
  type Color,
} from "../src/color.js";

const hex = (h: string): Color => {
  const c = parseColor(h);
  if (c === null) throw new Error(`fixture colour ${h} did not parse`);
  return c;
};

describe("colour parsing", () => {
  it("parses every hex length CSS allows, with alpha", () => {
    expect(parseColor("#1E293B")).toEqual({ r: 30, g: 41, b: 59, a: 1 });
    expect(parseColor("#1e293b")).toEqual({ r: 30, g: 41, b: 59, a: 1 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#abcd")).toEqual({ r: 170, g: 187, b: 204, a: 221 / 255 });
    expect(parseColor("#22C55E26")).toEqual({ r: 34, g: 197, b: 94, a: 0x26 / 255 });
  });

  it("rejects the hex lengths CSS does not allow", () => {
    expect(parseColor("#12345")).toBeNull();
    expect(parseColor("#1234567")).toBeNull();
    expect(parseColor("#xyzxyz")).toBeNull();
  });

  it("parses rgb()/rgba() in both the legacy and the modern syntax", () => {
    expect(parseColor("rgb(30, 41, 59)")).toEqual({ r: 30, g: 41, b: 59, a: 1 });
    expect(parseColor("rgba(34, 197, 94, 0.15)")).toEqual({ r: 34, g: 197, b: 94, a: 0.15 });
    expect(parseColor("rgb(34 197 94 / 15%)")).toEqual({ r: 34, g: 197, b: 94, a: 0.15 });
    expect(parseColor("rgb(100%, 0%, 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("parses hsl()/hsla() in both syntaxes", () => {
    expect(parseColor("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseColor("hsl(120 100% 25%)")).toEqual({ r: 0, g: 128, b: 0, a: 1 });
    expect(parseColor("hsla(210, 50%, 50%, 0.5)")?.a).toBe(0.5);
    expect(parseColor("hsl(210deg 50% 50% / 50%)")?.a).toBe(0.5);
  });

  it("returns null — never a guess — for values that are not colours", () => {
    for (const v of [
      "2px",
      "150ms",
      "9999px",
      "'Plus Jakarta Sans', system-ui, sans-serif",
      "0 1px 3px 0 rgba(0, 0, 0, 0.45), 0 1px 2px -1px rgba(0, 0, 0, 0.35)",
      "color-mix(in srgb, var(--app-success) 15%, var(--app-surface))",
      "var(--app-cta)",
      "",
      null,
      undefined,
    ]) {
      expect(parseColor(v as string)).toBeNull();
    }
  });

  it("round-trips through a canonical CSS identity that ignores the written form", () => {
    expect(toCss(hex("#1e293b"))).toBe("#1E293B");
    expect(toCss(hex("rgb(30, 41, 59)"))).toBe("#1E293B");
    expect(toHex(hex("rgba(34, 197, 94, 0.15)"))).toBe("#22C55E");
    expect(toCss(hex("rgba(34, 197, 94, 0.15)"))).toBe("rgba(34, 197, 94, 0.15)");
  });
});

/**
 * Success criterion 2 — MATH.
 *
 * The stylesheet documents its own measurements in comments. A correct CIE L*
 * implementation reproduces them TO THE HUNDREDTH; the fixture is its own oracle.
 */
describe("ΔL* reproduction anchors from the stylesheet's own comments", () => {
  it('reproduces ":root --app-secondary steps the fill +6.07 ΔL*" (fixture :23-28)', () => {
    // #1E293B was the old --app-secondary (and is --app-surface-raised); #29364D
    // is the value it was raised to.
    const step = deltaLstar(hex("#1E293B"), hex("#29364D"));
    expect(Number(step.toFixed(2))).toBe(6.07);
  });

  it('reproduces winter --app-secondary "(step −11.49, label 12.02)" (fixture :24-25)', () => {
    // Winter's --app-secondary #CBD5E1 against its --app-surface-raised #F1F5F9,
    // and the --app-text #0F172A label sitting on it.
    const step = deltaLstar(hex("#F1F5F9"), hex("#CBD5E1"));
    expect(Number(step.toFixed(2))).toBe(-11.49);
    const label = contrastRatio(hex("#0F172A"), hex("#CBD5E1"));
    expect(Number(label.toFixed(2))).toBe(12.02);
  });

  it('reproduces the bonus anchor at fixture :156 — "--app-surface-active L* 22.46 = +6.07 over --app-surface-raised (L* 16.39)"', () => {
    expect(Number(lstar(hex("#1E293B")).toFixed(2))).toBe(16.39);
    expect(Number(lstar(hex("#29364D")).toFixed(2))).toBe(22.46);
    expect(Number(deltaLstar(hex("#1E293B"), hex("#29364D")).toFixed(2))).toBe(6.07);
  });

  it('reproduces the hover anchor at fixture :155 — "--app-surface-hover L* 14.21 +6.25 over --app-surface (L* 7.96)"', () => {
    expect(Number(lstar(hex("#0F172A")).toFixed(2))).toBe(7.96);
    expect(Number(lstar(hex("#1A2438")).toFixed(2))).toBe(14.21);
    expect(Number(deltaLstar(hex("#0F172A"), hex("#1A2438")).toFixed(2))).toBe(6.25);
  });

  it('reproduces the label ratios the comments quote — 11.61 on --app-secondary, 4.82 hint-on-hover', () => {
    expect(Number(contrastRatio(hex("#F8FAFC"), hex("#29364D")).toFixed(2))).toBe(11.61);
    expect(Number(contrastRatio(hex("#8091A6"), hex("#1A2438")).toFixed(2))).toBe(4.82);
  });
});

/**
 * Cross-check against the Ruby oracle `DesignKit::Color`
 * (yatfa @ 961eef3, app/services/design_kit/color.rb).
 *
 * These figures were produced by RUNNING that Ruby — they are not this
 * implementation's own output rounded and pasted back. Each row is
 * `ruby -e 'DesignKit::Color.parse(hex).relative_luminance / .lstar'`, printed to
 * four decimals. Agreement to four decimals across a sampled token set — both
 * themes, the full lightness range — is the evidence that the TS math core and
 * the Ruby reference are the same function.
 */
describe("agreement with the DesignKit::Color Ruby oracle on a sampled token set", () => {
  const ORACLE: ReadonlyArray<[token: string, hexValue: string, y: number, l: number]> = [
    ["--app-primary", "#0F172A", 0.0088, 7.9627],
    ["--app-secondary", "#29364D", 0.0365, 22.4633],
    ["--app-cta", "#22C55E", 0.4108, 70.2325],
    ["--app-background", "#020617", 0.0021, 1.8519],
    ["--app-surface-raised", "#1E293B", 0.0218, 16.3933],
    ["--app-text", "#F8FAFC", 0.9536, 98.1758],
    ["--app-text-secondary", "#94A3B8", 0.3595, 66.4825],
    ["--app-text-muted", "#8091A6", 0.2759, 59.5194],
    ["--app-border-light", "#334155", 0.0514, 27.1307],
    ["--app-surface-hover", "#1A2438", 0.0177, 14.213],
    ["--app-warning", "#F59E0B", 0.4389, 72.1552],
    ["--app-error", "#EF4444", 0.229, 54.9716],
    ["--app-info", "#3B82F6", 0.2355, 55.6333],
    ["--app-border-hover", "#7A889D", 0.2418, 56.2678],
    ["--app-border-strong", "#8D9BB0", 0.3224, 63.5407],
    ["--app-neutral-border", "#64748B", 0.1706, 48.3408],
    ["winter --app-primary", "#E2E8F0", 0.8017, 91.7625],
    ["winter --app-secondary", "#CBD5E1", 0.6572, 84.854],
    ["winter --app-surface", "#FFFFFF", 1.0, 100.0],
    ["winter --app-surface-raised", "#F1F5F9", 0.9085, 96.3462],
    ["winter --app-text-muted", "#596779", 0.132, 43.0702],
    ["winter --app-cta", "#16A34A", 0.2686, 58.8439],
  ];

  it.each(ORACLE)("%s (%s) agrees with the Ruby oracle to four decimals", (_t, h, y, l) => {
    expect(Number(relativeLuminance(hex(h)).toFixed(4))).toBe(y);
    expect(Number(lstar(hex(h)).toFixed(4))).toBe(l);
  });

  it("agrees with the oracle's source-over compositing", () => {
    // ruby: Color.parse('rgba(34, 197, 94, 0.15)').over(Color.parse('#020617')).hex
    expect(toHex(over(hex("rgba(34, 197, 94, 0.15)"), hex("#020617")))).toBe("#072322");
    // ruby: Color.parse('rgba(2, 6, 23, 0.72)').over(Color.parse('#F8FAFC')).hex
    expect(toHex(over(hex("rgba(2, 6, 23, 0.72)"), hex("#F8FAFC")))).toBe("#474A57");
  });

  it("agrees with the oracle's quantized from_hsl", () => {
    // ruby: Color.from_hsl(210, 0.5, 0.5).hex
    expect(toHex(fromHsl(210, 0.5, 0.5))).toBe("#4080BF");
  });
});

describe("translucency is explicit, never composited against an invented backdrop", () => {
  const translucent = hex("rgba(34, 197, 94, 0.15)");

  it("flags a colour with alpha < 1", () => {
    expect(isTranslucent(translucent)).toBe(true);
    expect(isTranslucent(hex("#22C55E"))).toBe(false);
  });

  it("REFUSES to measure a translucent colour rather than quoting a fiction", () => {
    // The roadmap's own lesson: a semi-transparent token measured with no
    // backdrop read 1.82:1 where the truth against its real surface was 9.25:1.
    expect(() => lstar(translucent)).toThrow(TranslucentColorError);
    expect(() => relativeLuminance(translucent)).toThrow(TranslucentColorError);
    expect(() => contrastRatio(translucent, hex("#020617"))).toThrow(TranslucentColorError);
    expect(() => lstar(translucent)).toThrow(/will not invent a backdrop/);
  });

  it("measures it once a backdrop is NAMED", () => {
    const composited = over(translucent, hex("#020617"));
    expect(isTranslucent(composited)).toBe(false);
    expect(() => lstar(composited)).not.toThrow();
    expect(toHex(composited)).toBe("#072322");
  });

  it("leaves an opaque colour untouched by over()", () => {
    const opaque = hex("#22C55E");
    expect(over(opaque, hex("#020617"))).toEqual(opaque);
  });
});

describe("WCAG relative luminance and contrast", () => {
  it("puts pure white at 1 and pure black at 0", () => {
    expect(relativeLuminance(rgba(255, 255, 255))).toBeCloseTo(1, 10);
    expect(relativeLuminance(rgba(0, 0, 0))).toBe(0);
  });

  it("gives the canonical 21:1 for black on white, and 1:1 for a colour on itself", () => {
    expect(contrastRatio(rgba(0, 0, 0), rgba(255, 255, 255))).toBeCloseTo(21, 10);
    expect(contrastRatio(hex("#22C55E"), hex("#22C55E"))).toBe(1);
  });

  it("is symmetric", () => {
    const a = hex("#F8FAFC");
    const b = hex("#29364D");
    expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
  });

  it("uses the linear branch below the sRGB knee", () => {
    // 0.03928 * 255 ≈ 10.02, so channel 10 is below the knee: 10/255/12.92.
    expect(relativeLuminance(rgba(10, 10, 10))).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it("uses the 903.3*Y branch of L* for very dark colours", () => {
    // Y(#010101) sits below the 0.008856 knee.
    const c = hex("#010101");
    expect(lstar(c)).toBeCloseTo(903.3 * relativeLuminance(c), 12);
  });
});
