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
// oklch(0.97 0 0), lab(50% 40 59.5 / 0.5), color(srgb 1 0 0) …
const MODERN = /^(oklch|oklab|lab|lch|hwb|color)\(\s*([^)]*)\)$/i;

/**
 * Parse a CSS colour value.
 *
 * Supports `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()`/`rgba()` and
 * `hsl()`/`hsla()` in both the legacy comma syntax and the modern
 * space + `/ alpha` syntax, with alpha throughout. Also reads the modern
 * colour functions — `oklch()`, `oklab()`, `lab()`, `lch()`, `hwb()` and
 * `color(srgb r g b)` — in their space-separated `/ alpha` form only (CSS has no
 * comma form for them), with percentage or number channels, the `none` keyword
 * read as 0, and hue units `deg`/`grad`/`rad`/`turn`; and the CSS named-colour
 * keywords plus `transparent`.
 *
 * Every non-sRGB form is converted with the standard CSS Color Module Level 4
 * matrices, then CLIPPED into sRGB per channel and quantised to 0–255 exactly
 * like the legacy forms. A colour outside the sRGB gamut (a high-chroma
 * `oklch()`, say) therefore clips to the nearest channel value; there is NO
 * gamut mapping, so such a colour can differ from what a wide-gamut display
 * paints.
 *
 * Returns `null` — never a guess — for anything that is not a colour this file
 * can place in sRGB: a length, a duration, a font stack, a box-shadow list, a
 * `color-mix()` or `light-dark()` expression, relative colour syntax
 * (`oklch(from var(--x) l c h)`), a non-sRGB `color()` space, a system colour,
 * `currentColor`. Callers classify those explicitly rather than pretending they
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

  const modern = v.match(MODERN);
  if (modern) return parseModern(modern[1].toLowerCase(), modern[2]);

  const word = v.toLowerCase();
  // hasOwnProperty, not `NAMED[word]`: "constructor" and "toString" are not colours.
  if (Object.prototype.hasOwnProperty.call(NAMED, word)) {
    const n = NAMED[word];
    return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, 1);
  }
  if (word === "transparent") return rgba(0, 0, 0, 0);

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

// ── Modern colour functions ────────────────────────────────────────────────

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** A strict CSS number, or `null`. (`Number()` alone would accept `0x10`, `Infinity`, ``.) */
function strictNumber(raw: string): number | null {
  return NUMBER.test(raw) ? Number(raw) : null;
}

/**
 * One modern-syntax channel: `none` is 0, `N%` is N% of `percentRef`, a bare
 * number is itself.
 */
function channelValue(raw: string, percentRef: number): number | null {
  if (raw.toLowerCase() === "none") return 0;
  if (raw.endsWith("%")) {
    const n = strictNumber(raw.slice(0, -1));
    return n === null ? null : (n / 100) * percentRef;
  }
  return strictNumber(raw);
}

/** A hue in degrees: `none` is 0, a bare number is degrees, units `deg`/`grad`/`rad`/`turn`. */
function hueDegrees(raw: string): number | null {
  const v = raw.toLowerCase();
  if (v === "none") return 0;
  const m = v.match(/^(.*?)(deg|grad|rad|turn)?$/);
  if (!m) return null;
  const n = strictNumber(m[1]);
  if (n === null) return null;
  switch (m[2]) {
    case "grad":
      return n * 0.9;
    case "rad":
      return (n * 180) / Math.PI;
    case "turn":
      return n * 360;
    default:
      return n;
  }
}

/** Split `a b c` or `a b c / alpha` — whitespace only, a comma is not modern syntax. */
function splitModern(
  body: string,
  prefix: string[] = [],
): { parts: string[]; alpha: string | null } | null {
  if (body.includes(",")) return null;
  const slash = body.split("/");
  if (slash.length > 2) return null;
  const parts = slash[0].trim().split(/\s+/).filter((p) => p !== "");
  const alphaRaw =
    slash.length === 2 ? slash[1].trim().split(/\s+/).filter((p) => p !== "") : null;
  if (alphaRaw !== null && alphaRaw.length !== 1) return null;
  if (parts.length !== 3 + prefix.length) return null;
  for (let i = 0; i < prefix.length; i++) if (parts[i].toLowerCase() !== prefix[i]) return null;
  return { parts: parts.slice(prefix.length), alpha: alphaRaw === null ? null : alphaRaw[0] };
}

function parseModernAlpha(raw: string | null): number | null {
  return raw !== null && raw.toLowerCase() === "none" ? 0 : parseAlpha(raw);
}

function parseModern(fn: string, body: string): Color | null {
  const split = splitModern(body, fn === "color" ? ["srgb"] : []);
  if (!split) return null;
  const a = parseModernAlpha(split.alpha);
  if (a === null) return null;
  const [p1, p2, p3] = split.parts;

  // Linear-light sRGB, possibly outside 0–1; encoded and clipped below.
  let linear: [number, number, number];
  switch (fn) {
    case "color": {
      // Already sRGB-encoded: number 0–1 or percentage, no matrix involved.
      const ch = split.parts.map((p) => channelValue(p, 1));
      if (ch.some((n) => n === null)) return null;
      return rgba((ch[0] as number) * 255, (ch[1] as number) * 255, (ch[2] as number) * 255, a);
    }
    case "hwb": {
      const h = hueDegrees(p1);
      const w = channelValue(p2, 100);
      const k = channelValue(p3, 100);
      if (h === null || w === null || k === null) return null;
      const [r, g, b] = hwbToSrgb(h, Math.max(0, w) / 100, Math.max(0, k) / 100);
      return rgba(r * 255, g * 255, b * 255, a);
    }
    case "oklab":
    case "oklch": {
      const L = channelValue(p1, 1);
      if (L === null) return null;
      let ok: [number, number, number];
      if (fn === "oklab") {
        const A = channelValue(p2, 0.4);
        const B = channelValue(p3, 0.4);
        if (A === null || B === null) return null;
        ok = [L, A, B];
      } else {
        const C = channelValue(p2, 0.4);
        const H = hueDegrees(p3);
        if (C === null || H === null) return null;
        ok = [L, ...polar(Math.max(0, C), H)];
      }
      linear = oklabToLinearSrgb(Math.max(0, ok[0]), ok[1], ok[2]);
      break;
    }
    default: {
      // lab / lch (CIE, D50)
      const L = channelValue(p1, 100);
      if (L === null) return null;
      let lab: [number, number, number];
      if (fn === "lab") {
        const A = channelValue(p2, 125);
        const B = channelValue(p3, 125);
        if (A === null || B === null) return null;
        lab = [L, A, B];
      } else {
        const C = channelValue(p2, 150);
        const H = hueDegrees(p3);
        if (C === null || H === null) return null;
        lab = [L, ...polar(Math.max(0, C), H)];
      }
      linear = labToLinearSrgb(Math.max(0, lab[0]), lab[1], lab[2]);
    }
  }
  return rgba(
    encodeSrgb(linear[0]) * 255,
    encodeSrgb(linear[1]) * 255,
    encodeSrgb(linear[2]) * 255,
    a,
  );
}

function polar(chroma: number, hueDeg: number): [number, number] {
  const rad = (hueDeg * Math.PI) / 180;
  return [chroma * Math.cos(rad), chroma * Math.sin(rad)];
}

type Vec3 = readonly [number, number, number];
type Mat3 = readonly [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): [number, number, number] => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// CSS Color Module Level 4 §"Sample code for color conversions" matrices.
const OKLAB_TO_LMS: Mat3 = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ_D65: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const XYZ_D65_TO_LINEAR_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const XYZ_D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const lms = mul(OKLAB_TO_LMS, [L, a, b]);
  return mul(XYZ_D65_TO_LINEAR_SRGB, mul(LMS_TO_XYZ_D65, [lms[0] ** 3, lms[1] ** 3, lms[2] ** 3]));
}

function labToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const eps = 216 / 24389;
  const kappa = 24389 / 27;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = fx ** 3 > eps ? fx ** 3 : (116 * fx - 16) / kappa;
  const y = L > kappa * eps ? fy ** 3 : L / kappa;
  const z = fz ** 3 > eps ? fz ** 3 : (116 * fz - 16) / kappa;
  const d50: Vec3 = [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
  return mul(XYZ_D65_TO_LINEAR_SRGB, mul(XYZ_D50_TO_D65, d50));
}

/** Gamma-encode one linear-light channel, CLIPPING it into 0–1 first (no gamut mapping). */
function encodeSrgb(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** HWB to sRGB (each 0–1), per CSS Color 4: whiteness + blackness ≥ 1 is an achromatic grey. */
function hwbToSrgb(hue: number, w: number, k: number): [number, number, number] {
  if (w + k >= 1) {
    const grey = w / (w + k);
    return [grey, grey, grey];
  }
  const h = (((hue % 360) + 360) % 360) / 30;
  // Pure hue: the CSS Color 4 hslToRgb at saturation 100%, lightness 50%.
  const pure = (n: number): number => {
    const kk = (n + h) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(kk - 3, 9 - kk, 1));
  };
  const scale = 1 - w - k;
  return [pure(0) * scale + w, pure(8) * scale + w, pure(4) * scale + w];
}

/** CSS named-colour keywords (CSS Color 4 §6.1) as 0xRRGGBB. */
const NAMED: Readonly<Record<string, number>> = {
  aliceblue: 0xf0f8ff, antiquewhite: 0xfaebd7, aqua: 0x00ffff, aquamarine: 0x7fffd4,
  azure: 0xf0ffff, beige: 0xf5f5dc, bisque: 0xffe4c4, black: 0x000000, blanchedalmond: 0xffebcd,
  blue: 0x0000ff, blueviolet: 0x8a2be2, brown: 0xa52a2a, burlywood: 0xdeb887,
  cadetblue: 0x5f9ea0, chartreuse: 0x7fff00, chocolate: 0xd2691e, coral: 0xff7f50,
  cornflowerblue: 0x6495ed, cornsilk: 0xfff8dc, crimson: 0xdc143c, cyan: 0x00ffff,
  darkblue: 0x00008b, darkcyan: 0x008b8b, darkgoldenrod: 0xb8860b, darkgray: 0xa9a9a9,
  darkgreen: 0x006400, darkgrey: 0xa9a9a9, darkkhaki: 0xbdb76b, darkmagenta: 0x8b008b,
  darkolivegreen: 0x556b2f, darkorange: 0xff8c00, darkorchid: 0x9932cc, darkred: 0x8b0000,
  darksalmon: 0xe9967a, darkseagreen: 0x8fbc8f, darkslateblue: 0x483d8b, darkslategray: 0x2f4f4f,
  darkslategrey: 0x2f4f4f, darkturquoise: 0x00ced1, darkviolet: 0x9400d3, deeppink: 0xff1493,
  deepskyblue: 0x00bfff, dimgray: 0x696969, dimgrey: 0x696969, dodgerblue: 0x1e90ff,
  firebrick: 0xb22222, floralwhite: 0xfffaf0, forestgreen: 0x228b22, fuchsia: 0xff00ff,
  gainsboro: 0xdcdcdc, ghostwhite: 0xf8f8ff, gold: 0xffd700, goldenrod: 0xdaa520, gray: 0x808080,
  green: 0x008000, greenyellow: 0xadff2f, grey: 0x808080, honeydew: 0xf0fff0, hotpink: 0xff69b4,
  indianred: 0xcd5c5c, indigo: 0x4b0082, ivory: 0xfffff0, khaki: 0xf0e68c, lavender: 0xe6e6fa,
  lavenderblush: 0xfff0f5, lawngreen: 0x7cfc00, lemonchiffon: 0xfffacd, lightblue: 0xadd8e6,
  lightcoral: 0xf08080, lightcyan: 0xe0ffff, lightgoldenrodyellow: 0xfafad2, lightgray: 0xd3d3d3,
  lightgreen: 0x90ee90, lightgrey: 0xd3d3d3, lightpink: 0xffb6c1, lightsalmon: 0xffa07a,
  lightseagreen: 0x20b2aa, lightskyblue: 0x87cefa, lightslategray: 0x778899,
  lightslategrey: 0x778899, lightsteelblue: 0xb0c4de, lightyellow: 0xffffe0, lime: 0x00ff00,
  limegreen: 0x32cd32, linen: 0xfaf0e6, magenta: 0xff00ff, maroon: 0x800000,
  mediumaquamarine: 0x66cdaa, mediumblue: 0x0000cd, mediumorchid: 0xba55d3,
  mediumpurple: 0x9370db, mediumseagreen: 0x3cb371, mediumslateblue: 0x7b68ee,
  mediumspringgreen: 0x00fa9a, mediumturquoise: 0x48d1cc, mediumvioletred: 0xc71585,
  midnightblue: 0x191970, mintcream: 0xf5fffa, mistyrose: 0xffe4e1, moccasin: 0xffe4b5,
  navajowhite: 0xffdead, navy: 0x000080, oldlace: 0xfdf5e6, olive: 0x808000, olivedrab: 0x6b8e23,
  orange: 0xffa500, orangered: 0xff4500, orchid: 0xda70d6, palegoldenrod: 0xeee8aa,
  palegreen: 0x98fb98, paleturquoise: 0xafeeee, palevioletred: 0xdb7093, papayawhip: 0xffefd5,
  peachpuff: 0xffdab9, peru: 0xcd853f, pink: 0xffc0cb, plum: 0xdda0dd, powderblue: 0xb0e0e6,
  purple: 0x800080, rebeccapurple: 0x663399, red: 0xff0000, rosybrown: 0xbc8f8f,
  royalblue: 0x4169e1, saddlebrown: 0x8b4513, salmon: 0xfa8072, sandybrown: 0xf4a460,
  seagreen: 0x2e8b57, seashell: 0xfff5ee, sienna: 0xa0522d, silver: 0xc0c0c0, skyblue: 0x87ceeb,
  slateblue: 0x6a5acd, slategray: 0x708090, slategrey: 0x708090, snow: 0xfffafa,
  springgreen: 0x00ff7f, steelblue: 0x4682b4, tan: 0xd2b48c, teal: 0x008080, thistle: 0xd8bfd8,
  tomato: 0xff6347, turquoise: 0x40e0d0, violet: 0xee82ee, wheat: 0xf5deb3, white: 0xffffff,
  whitesmoke: 0xf5f5f5, yellow: 0xffff00, yellowgreen: 0x9acd32,
};

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
