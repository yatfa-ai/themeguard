import { describe, expect, it } from "vitest";
import { parseColor, parseTokenColor, toHex } from "../src/color.js";
import { resolveCss, ROOT_THEME } from "../src/resolve.js";

// CSS Color 4 clamps a negative HSL saturation to 0 at parse time (WPT
// hsl-clamp-negative-saturation.html); saturation above 100% is not clamped.
describe("hsl() with a negative saturation", () => {
  const gray = parseColor("#808080");

  it("clamps to gray in the modern and the legacy comma syntax", () => {
    expect(parseColor("hsl(120 -10% 50%)")).toEqual(gray);
    expect(parseColor("hsl(120, -10%, 50%)")).toEqual(gray);
    expect(parseColor("hsl(120 -100% 50%)")).toEqual(gray);
    expect(parseColor("hsl(0 -100% 50%)")).toEqual(gray);
  });

  it("keeps the alpha channel on hsla()", () => {
    expect(parseColor("hsla(120 -10% 50% / 0.5)")).toEqual(parseColor("rgba(128, 128, 128, 0.5)"));
  });

  it("clamps the bare channel triple too", () => {
    expect(parseTokenColor("120 -10% 50%")).toEqual(gray);
  });

  it("leaves in-range and over-100% saturation unchanged", () => {
    expect(toHex(parseColor("hsl(120 150% 50%)")!)).toBe("#00FF00");
    expect(toHex(parseColor("hsl(0 0% 50%)")!)).toBe("#808080");
    expect(toHex(parseColor("hsl(30 150% 40%)")!)).toBe("#FF6600");
  });

  it("groups a clamped hsl() with the equal hex in one collision", () => {
    const groups = resolveCss(`:root { --gray: #808080; --muted: hsl(120 -10% 50%); }`).collisionGroups(ROOT_THEME);
    expect(groups).toHaveLength(1);
    expect([...(groups[0]?.names ?? [])].sort()).toEqual(["--gray", "--muted"]);
  });
});
