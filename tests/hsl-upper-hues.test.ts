import { describe, expect, it } from "vitest";
import { fromHsl, parseColor, toHex } from "../src/color.js";

// Expected hexes come from Python's colorsys.hls_to_rgb (an implementation
// independent of src/color.ts), rounded half-up to 0-255.
describe("hsl() in the blue-to-magenta half of the wheel (hue 240-360)", () => {
  it("fromHsl lands a violet (hue 262, the sextant 240-300) on the right channels", () => {
    expect(toHex(fromHsl(262, 0.83, 0.58))).toBe("#7C3BED");
  });

  it("fromHsl lands a magenta-purple at the 300 sextant edge and a pink (hue 330, sextant 300-360) correctly", () => {
    expect(toHex(fromHsl(300, 0.76, 0.38))).toBe("#AB17AB");
    expect(toHex(fromHsl(330, 0.81, 0.6))).toBe("#EC4699");
  });

  it("normalizes a negative and an over-360 hue onto the same wheel", () => {
    expect(toHex(fromHsl(-30, 0.81, 0.6))).toBe("#EC4699");
    expect(toHex(fromHsl(450, 0.7, 0.45))).toBe("#73C322");
  });

  it("parseColor routes hsl() tokens through the same conversion", () => {
    expect(parseColor("hsl(262 83% 58%)")).toEqual(parseColor("#7C3BED"));
    expect(parseColor("hsl(330, 81%, 60%)")).toEqual(parseColor("#EC4699"));
  });
});
