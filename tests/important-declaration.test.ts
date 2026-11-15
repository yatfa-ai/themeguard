import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCss } from "../src/resolve.js";
import { scratchDir } from "./fixture.js";
import { run } from "./run.js";

/**
 * A trailing `!important` on a custom property is a priority flag, not part of
 * the value: it is stripped when reading the declaration so the token is still
 * read as a colour.
 */

const dir = scratchDir("important");

function sheet(name: string, css: string): string {
  const path = join(dir, name);
  writeFileSync(path, css);
  return path;
}

function dark(border: string, surface: string, muted: string): string {
  return `:root { --border:#dddddd; --surface:#f5f5f5; --text:#111111; --text-muted:#555555; }
[data-theme=dark] { --border:${border}; --surface:${surface}; --text:#eeeeee; --text-muted:${muted}; }
.a{color:var(--text);background:var(--surface);border-color:var(--border)} .b{color:var(--text-muted)}`;
}

const TWIN = dark("#333333", "#333333", "#eeeeee");
const COLLISION = '--border and --surface both resolve to #333333 in theme "dark"';
const finding = (r: { out: string[] }) => r.out.find((l) => l.startsWith("  [collision]"));

describe("!important on a custom property", () => {
  const twin = run(sheet("twin.css", TWIN));

  it("the suffix-free twin reports the collision", () => {
    expect(twin.code).toBe(1);
    expect(twin.stdout).toContain(COLLISION);
  });

  it("reports the same collision with !important on one member, both, and spelling variants", () => {
    const variants: [string, string, string][] = [
      ["#333333 !important", "#333333", "#eeeeee"],
      ["#333333", "#333333 !important", "#eeeeee !important"],
      ["#333333 !important", "#333333 !important", "#eeeeee !important"],
      ["#333333 ! important", "#333333", "#eeeeee"],
      ["#333333 !IMPORTANT", "#333333", "#eeeeee !IMPORTANT"],
      ["#333333!important", "#333333", "#eeeeee"],
    ];
    variants.forEach((v, i) => {
      const r = run(sheet(`v${i}.css`, dark(...v)));
      expect(r.code, v.join("|")).toBe(1);
      expect(r.stdout, v.join("|")).toContain(COLLISION);
      expect(finding(r), v.join("|")).toBe(finding(twin));
    });
  });

  it("reports it for the base scope too", () => {
    const css = (flag: string) =>
      `:root { --a:#333333${flag}; --b:#333333; } body { color: var(--a); background: var(--b); }`;
    const a = run(sheet("base-flag.css", css(" !important")));
    const b = run(sheet("base-plain.css", css("")));
    expect(a.code).toBe(1);
    expect(finding(a)).toBeDefined();
    expect(finding(a)).toBe(finding(b));
  });

  it("resolves an !important colour token as a colour with no suffix in its value", () => {
    const tok = resolveCss(dark("#333333 !important", "#333333", "#eeeeee"))
      .tokensFor("dark")
      .find((t) => t.name === "--border")!;
    expect(tok.kind).toBe("color");
    expect(tok.declaredValue).toBe("#333333");
  });

  it("still resolves an alias chain through an !important declaration", () => {
    const css = (flag: string) =>
      `:root { --b:#333333; --a:var(--b)${flag}; } body { color: var(--a); }`;
    const a = resolveCss(css(" !important")).tokensFor("root").find((t) => t.name === "--a")!;
    const b = resolveCss(css("")).tokensFor("root").find((t) => t.name === "--a")!;
    expect(a.kind).toBe("color");
    expect(a.resolvedValue).toBe(b.resolvedValue);
    expect(a.declaredValue).toBe(b.declaredValue);
  });
});
