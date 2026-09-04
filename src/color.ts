/**
 * Colour math core.
 *
 * Everything here is arithmetic on colours: parsing the value shapes CSS
 * actually uses, WCAG 2.1 relative luminance, and CIE L*. There are no
 * verdicts in this file — nothing decides whether a colour is "wrong".
 *
 * The formulas are deliberately identical to the Ruby reference implementation
 * this package was calibrated against, `app/services/design_kit/color.rb` in
 * the yatfa repo (commit 961eef3). Methods are cited BY NAME rather than by
 * line range: a range is wrong the moment a line is added above it, and a
 * reader following a stale one lands in the wrong function.
 *
 *   - relative luminance : DesignKit::Color#relative_luminance  (sRGB 0.03928
 *                          knee, /12.92, ((s+0.055)/1.055)^2.4,
 *                          0.2126/0.7152/0.0722)
 *   - CIE L*             : DesignKit::Color#lstar  (L* = 116*Y^(1/3) - 16
 *                          above the 0.008856 knee, else 903.3*Y)
 *   - contrast ratio     : DesignKit::Color#contrast_with  ((hi+0.05)/(lo+0.05))
 *   - source-over        : DesignKit::Color#over
 *
 * See tests/math.test.ts for the sampled cross-check against that oracle.
 *
 * ── Translucency is never composited implicitly ──────────────────────────────
 * A colour with alpha < 1 has no luminance of its own. `relativeLuminance`,
 * `lstar` and `contrastRatio` therefore REFUSE a translucent colour rather than
 * quietly compositing it against an invented backdrop. Call `over(backdrop)`
 * first, naming the surface it is actually painted on.
 */

/** An sRGB colour with a straight (non-premultiplied) alpha channel. */
export interface Color {
  /** 0–255, integer. */
  readonly r: number;
  /** 0–255, integer. */
  readonly g: number;
  /** 0–255, integer. */
  readonly b: number;
  /** 0–1. Exactly 1 means opaque. */
  readonly a: number;
}

const clampChannel = (n: number): number => Math.min(255, Math.max(0, Math.round(n)));
const clampAlpha = (n: number): number => Math.min(1, Math.max(0, n));

export function rgba(r: number, g: number, b: number, a = 1): Color {
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b), a: clampAlpha(a) };
}

export function isTranslucent(c: Color): boolean {
  return c.a < 1;
}

/** Uppercase `#RRGGBB`. Alpha is dropped — use {@link toCss} to keep it. */
export function toHex(c: Color): string {
  const h = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * Canonical CSS text: `#RRGGBB` when opaque, `rgba(r, g, b, a)` when not.
 * This is the identity used when grouping colours by value, so a token written
 * `#1e293b` and one written `rgb(30, 41, 59)` are recognised as the same fill.
 */
export function toCss(c: Color): string {
  return isTranslucent(c) ? `rgba(${c.r}, ${c.g}, ${c.b}, ${trimNumber(c.a)})` : toHex(c);
}

function trimNumber(n: number): string {
  return String(Number(n.toFixed(6)));
}

// ── Parsing ────────────────────────────────────────────────────────────────

const HEX = /^#([0-9a-fA-F]{3,8})$/;
// rgb(1 2 3 / 40%) and rgba(1, 2, 3, 0.4) alike; percentages allowed per channel.
const RGB = /^rgba?\(\s*([^)]*)\)$/i;
const HSL = /^hsla?\(\s*([^)]*)\)$/i;

/**
 * Parse a CSS colour value.
 *
 * Supports `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()`/`rgba()` and
 * `hsl()`/`hsla()` in both the legacy comma syntax and the modern
 * space + `/ alpha` syntax, with alpha throughout.
 *
 * Returns `null` — never a guess — for anything that is not a colour: a length,
 * a duration, a font stack, a box-shadow list, a `color-mix()` expression, a
 * named colour. Callers classify those explicitly rather than pretending they
 * have a swatch.
 */
export function parseColor(value: string | null | undefined): Color | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (v === "") return null;

  const hex = v.match(HEX);
  if (hex) return parseHex(hex[1]);

  const rgb = v.match(RGB);
  if (rgb) return parseRgb(rgb[1]);

  const hsl = v.match(HSL);
  if (hsl) return parseHsl(hsl[1]);

  return null;
}

function parseHex(digits: string): Color | null {
  const d = digits.toLowerCase();
  const pair = (s: string) => parseInt(s, 16);
  switch (d.length) {
    case 3:
      return rgba(pair(d[0] + d[0]), pair(d[1] + d[1]), pair(d[2] + d[2]), 1);
    case 4:
      return rgba(
        pair(d[0] + d[0]),
        pair(d[1] + d[1]),
        pair(d[2] + d[2]),
        pair(d[3] + d[3]) / 255,
      );
    case 6:
      return rgba(pair(d.slice(0, 2)), pair(d.slice(2, 4)), pair(d.slice(4, 6)), 1);
    case 8:
      return rgba(
        pair(d.slice(0, 2)),
        pair(d.slice(2, 4)),
        pair(d.slice(4, 6)),
        pair(d.slice(6, 8)) / 255,
      );
    default:
      // 5 and 7 digits are not valid CSS hex colours.
      return null;
  }
}

/** Split `1, 2, 3, 0.4` or `1 2 3 / 40%` into components plus optional alpha. */
function splitComponents(body: string): { parts: string[]; alpha: string | null } | null {
  const slash = body.split("/");
  if (slash.length > 2) return null;
  const head = slash[0].trim();
  const alpha = slash.length === 2 ? slash[1].trim() : null;
  const parts = head.split(/[\s,]+/).filter((p) => p !== "");
  if (alpha === null && parts.length === 4) {
    // legacy rgba(r, g, b, a)
    return { parts: parts.slice(0, 3), alpha: parts[3] };
  }
  if (parts.length !== 3) return null;
  return { parts, alpha };
}

function parseAlpha(raw: string | null): number | null {
  if (raw === null) return 1;
  if (raw.endsWith("%")) {
    const n = Number(raw.slice(0, -1));
    return Number.isFinite(n) ? clampAlpha(n / 100) : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? clampAlpha(n) : null;
}

function parseRgb(body: string): Color | null {
  const split = splitComponents(body);
  if (!split) return null;
  const channels = split.parts.map((p) =>
    p.endsWith("%") ? (Number(p.slice(0, -1)) / 100) * 255 : Number(p),
  );
  if (channels.some((n) => !Number.isFinite(n))) return null;
  const a = parseAlpha(split.alpha);
  if (a === null) return null;
  return rgba(channels[0], channels[1], channels[2], a);
}

function parseHsl(body: string): Color | null {
  const split = splitComponents(body);
  if (!split) return null;
  const [rawH, rawS, rawL] = split.parts;
  const h = Number(rawH.replace(/deg$/i, ""));
  const s = Number(rawS.replace(/%$/, "")) / 100;
  const l = Number(rawL.replace(/%$/, "")) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  const a = parseAlpha(split.alpha);
  if (a === null) return null;
  const c = fromHsl(h, s, l);
  return rgba(c.r, c.g, c.b, a);
}

/**
 * HSL to quantized sRGB, matching `DesignKit::Color.from_hsl` (yatfa @ 961eef3):
 * channels are rounded to 0–255 HERE, so any L* measured on the result is a
 * measurement of the colour that will actually be shipped.
 */
export function fromHsl(h: number, s: number, l: number): Color {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgba((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255, 1);
}

// ── Measurement ────────────────────────────────────────────────────────────

export class TranslucentColorError extends Error {
  constructor(c: Color, operation: string) {
    super(
      `${operation} is undefined for the translucent colour ${toCss(c)}: a colour with alpha ` +
        `< 1 has no luminance until it is composited. Call over(color, backdrop) with the ` +
        `surface it is actually painted on — themeguard will not invent a backdrop.`,
    );
    this.name = "TranslucentColorError";
  }
}

/** Source-over composite onto an opaque backdrop. Mirrors `DesignKit::Color#over` (yatfa @ 961eef3). */
export function over(color: Color, backdrop: Color): Color {
  if (!isTranslucent(color)) return color;
  if (isTranslucent(backdrop)) {
    throw new TranslucentColorError(backdrop, "Compositing onto a translucent backdrop");
  }
  const mix = (c: number, b: number) => c * color.a + b * (1 - color.a);
  return rgba(mix(color.r, backdrop.r), mix(color.g, backdrop.g), mix(color.b, backdrop.b), 1);
}

/** WCAG 2.1 relative luminance. Mirrors `DesignKit::Color#relative_luminance` (yatfa @ 961eef3). */
export function relativeLuminance(c: Color): number {
  if (isTranslucent(c)) throw new TranslucentColorError(c, "Relative luminance");
  const lin = [c.r, c.g, c.b].map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/**
 * CIE L* (D65). Mirrors `DesignKit::Color#lstar` (yatfa @ 961eef3).
 *
 * This is the right instrument for surface-against-surface steps, where a WCAG
 * ratio is the wrong one: two adjacent fills a whole visible step apart still
 * measure around 1.2:1.
 */
export function lstar(c: Color): number {
  const y = relativeLuminance(c);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** Signed CIE L* step from `from` to `to` — positive means `to` is lighter. */
export function deltaLstar(from: Color, to: Color): number {
  return lstar(to) - lstar(from);
}

/** WCAG 2.1 contrast ratio. Mirrors `DesignKit::Color#contrast_with` (yatfa @ 961eef3). Both must be opaque. */
export function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}
