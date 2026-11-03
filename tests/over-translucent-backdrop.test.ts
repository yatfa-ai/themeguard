import { describe, expect, it } from "vitest";
import { over, parseColor, toCss, TranslucentColorError, type Color } from "../src/color.js";

const c = (s: string): Color => {
  const parsed = parseColor(s);
  if (parsed === null) throw new Error(`fixture colour ${s} did not parse`);
  return parsed;
};

describe("over() — a translucent backdrop is refused, never flattened", () => {
  const foreground = c("rgba(34, 197, 94, 0.15)");
  const backdrop = c("rgba(2, 6, 23, 0.5)");

  it("throws TranslucentColorError naming the backdrop and the operation", () => {
    expect(() => over(foreground, backdrop)).toThrow(TranslucentColorError);
    expect(() => over(foreground, backdrop)).toThrow(/Compositing onto a translucent backdrop is undefined/);
    expect(() => over(foreground, backdrop)).toThrow(toCss(backdrop));
    expect(() => over(foreground, backdrop)).toThrow(/will not invent a backdrop/);
  });

  it("still composites onto the same backdrop once it is opaque", () => {
    const opaque = c("#020617");
    expect(over(foreground, opaque).a).toBe(1);
  });
});
