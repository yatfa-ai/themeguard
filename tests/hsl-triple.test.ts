import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseColor, parseHslTriple, toCss } from "../src/color.js";
import { resolveCss } from "../src/resolve.js";
import { unreadColorSyntax } from "../src/rules/unread-colors.js";
import { FIXTURE_PATH } from "./fixture.js";
import { run } from "./run.js";

/**
 * Bare HSL channel triples — the shadcn/ui / Tailwind v3 convention
 * (`--background: 222 47% 11%`, consumed as `hsl(var(--background))`).
 * `<hue> <pct> <pct>` is read as the `hsl()` of the same channels; a bare
 * three-number triple is ambiguous, so it is not read but is named.
 */

const dir = mkdtempSync(join(tmpdir(), "themeguard-hsl-triple-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function sheet(name: string, css: string): string {
  const path = join(dir, name);
  writeFileSync(path, css);
  return path;
}

const TRIPLE = `
@layer base {
  :root { --background: 0 0% 100%; --foreground: 222 47% 11%; }
  .dark { --background: 222 47% 11%; --foreground: 222 47% 11%; }
  body { background: hsl(var(--background)); color: hsl(var(--foreground)); }
}
`;
const FUNCTIONAL = `
@layer base {
  :root { --background: hsl(0 0% 100%); --foreground: hsl(222 47% 11%); }
  .dark { --background: hsl(222 47% 11%); --foreground: hsl(222 47% 11%); }
  body { background: var(--background); color: var(--foreground); }
}
`;

describe("bare HSL channel triple as a colour", () => {
  it("reads the same colour as hsl() of the same channels", () => {
    for (const [triple, fn] of [
      ["222 47% 11%", "hsl(222 47% 11%)"],
      ["222deg 47% 11%", "hsl(222deg 47% 11%)"],
      ["0.5turn 50% 50%", "hsl(0.5turn 50% 50%)"],
      ["200grad 50% 50%", "hsl(200grad 50% 50%)"],
      ["3.14159rad 50% 50%", "hsl(3.14159rad 50% 50%)"],
      ["222 47% 11% / 0.5", "hsl(222 47% 11% / 0.5)"],
      ["222 47% 11% / 40%", "hsl(222 47% 11% / 40%)"],
    ] as const) {
      const a = parseHslTriple(triple);
      const b = parseColor(fn);
      expect(a, triple).not.toBeNull();
      expect(toCss(a!), triple).toBe(toCss(b!));
    }
    expect(toCss(parseHslTriple("222 47% 11%")!).toUpperCase()).toBe("#0F1729");
  });

  it("reads hsl() hue units grad/rad/turn too, like the modern colour functions", () => {
    expect(toCss(parseColor("hsl(0.5turn 100% 50%)")!)).toBe(toCss(parseColor("hsl(180 100% 50%)")!));
  });

  it("is not a colour in parseColor itself, and rejects non-triples", () => {
    expect(parseColor("222 47% 11%")).toBeNull();
    for (const v of ["222 47 11", "222 47% 11", "222% 47% 11%", "47% 11%", "222 47% 11% 5%", "1px 47% 11%", "222 47% 11% /", ""]) {
      expect(parseHslTriple(v), v).toBeNull();
    }
  });

  it("collides on a shadcn-shaped two-theme sheet exactly like its hsl() twin", () => {
    const a = run(sheet("triple.css", TRIPLE));
    const b = run(sheet("functional.css", FUNCTIONAL));
    expect(a.code).toBe(1);
    expect(b.code).toBe(1);
    expect(a.stdout).toContain(
      '--background and --foreground both resolve to #0F1729 in theme "dark"',
    );
    const finding = (r: { out: string[] }) => r.out.find((l) => l.startsWith("  [collision]"));
    expect(finding(a)).toBe(finding(b));
    expect(a.stdout).toContain("unread-colors (0)");
  });

  it("keeps declaredValue as written and the --json shape unchanged", () => {
    const resolved = resolveCss(TRIPLE);
    const tok = resolved.tokensFor("dark").find((t) => t.name === "--foreground")!;
    expect(tok.kind).toBe("color");
    expect(tok.declaredValue).toBe("222 47% 11%");
    const json = JSON.parse(run("--json", sheet("triple2.css", TRIPLE)).stdout);
    expect(Object.keys(json)).toEqual(
      Object.keys(JSON.parse(run("--json", sheet("functional2.css", FUNCTIONAL)).stdout)),
    );
  });

  it("enters family-consistency / contrast through the same path as hsl()", () => {
    const css = (fg: string, bg: string) =>
      `:root { --fg: ${fg}; --bg: ${bg}; } body { color: var(--fg); background: var(--bg); }`;
    const a = audit(resolveCss(css("0 0% 60%", "0 0% 100%")));
    const b = audit(resolveCss(css("hsl(0 0% 60%)", "hsl(0 0% 100%)")));
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });
});

describe("bare R G B triple stays unread but is named", () => {
  it("names a three-number value as channel-triple", () => {
    for (const v of ["255 255 255", "15 23 42", "15 23 42 / 0.5", "0.5 0.5 0.5"]) {
      expect(unreadColorSyntax(v), v).toBe("channel-triple");
    }
    for (const v of ["1px 2px 3px", "10 20", "1 2 3 4", "222 47% 11%", "red", "0"]) {
      expect(unreadColorSyntax(v), v).not.toBe("channel-triple");
    }
  });

  it("lists a Tailwind v3 rgb-channel palette under unread-colors and moves no exit code", () => {
    const css = `:root { --x: 255 255 255; --y: 15 23 42; }
body { background: rgb(var(--x) / 1); color: rgb(var(--y) / 1); }`;
    const result = run(sheet("rgbtriple.css", css));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("unread-colors (2)");
    expect(result.stdout).toContain("--x (channel-triple)");
    expect(result.stdout).toContain("--y (channel-triple)");
    const rows = audit(resolveCss(css)).unreadColors;
    expect(rows.map((r) => r.syntax)).toEqual(["channel-triple", "channel-triple"]);
  });

  it("reads a number-hue triple and leaves a three-number list unread in one sheet", () => {
    const css = `:root { --a: 222 47% 11%; --b: 222 47 11; } body { color: var(--a); background: var(--b); }`;
    const resolved = resolveCss(css);
    const kinds = Object.fromEntries(resolved.tokensFor("root").map((t) => [t.name, t.kind]));
    expect(kinds).toEqual({ "--a": "color", "--b": "non-color" });
    expect(audit(resolved).unreadColors.map((r) => r.token)).toEqual(["--b"]);
  });
});

describe("calibration fixture", () => {
  it("still reports its 22 findings with nothing newly left out", () => {
    const result = run(FIXTURE_PATH);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/\n22 findings: /);
    expect(result.stdout).toContain("unread-colors (0)");
  });
});
