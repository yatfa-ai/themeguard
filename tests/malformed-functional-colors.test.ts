// parseColor's docblock promises `null` — never a guess — for anything that is
// not a colour. These inputs match the outer rgb()/hsl() pattern but not the
// grammar, so they reach splitComponents/parseAlpha/parseRgb/parseHsl's null
// arms; the resolver feeds the result straight into the rule-3 contrast maths,
// so a colour built from undefined/NaN channels would be measured as a swatch.
import { describe, expect, it } from "vitest";
import { parseColor } from "../src/color.js";

describe("parseColor — malformed functional colours are null, never a guess", () => {
  it("refuses a component list that does not hold exactly three channels", () => {
    for (const v of [
      "rgb(1 2)",
      "rgb(1 2 3 4 5)",
      "rgb()",
      "hsl(1 2)",
      "hsl(0 50% 50% 50% 50%)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("refuses more than one `/` and a slash alpha that is not a single token", () => {
    for (const v of [
      "rgb(1 2 3 / 4 / 5)",
      "hsl(1/2/3)",
      "rgb(1 2 3 / 4 5)",
      "rgb(1 2 3 4 / 5)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("refuses a non-numeric channel", () => {
    for (const v of ["rgb(a b c)", "rgb(1 2 3x)", "rgb(1%, x%, 3%)"]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("refuses a non-numeric alpha, plain or percentage, slash or legacy comma form", () => {
    for (const v of [
      "rgb(1 2 3 / x)",
      "rgb(1 2 3 / x%)",
      "rgb(1, 2, 3, x)",
      "rgb(1, 2, 3, x%)",
      "hsl(0 50% 50% / x)",
      "hsl(0 50% 50% / x%)",
      "hsl(0, 50%, 50%, x)",
    ]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("refuses a non-numeric hue, saturation or lightness", () => {
    for (const v of ["hsl(x 50% 50%)", "hsl(0 abc% 50%)", "hsl(0 50% abc%)"]) {
      expect(parseColor(v), v).toBeNull();
    }
  });

  it("still reads the neighbouring well-formed spellings, so the refusals are not a blanket", () => {
    expect(parseColor("rgb(1 2 3 / 50%)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("rgb(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(parseColor("hsl(0 100% 50% / 50%)")).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });
});
