import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_OK } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { resolveCss, resolveStylesheet } from "../src/resolve.js";
import { themeTokenTotals } from "../src/rules/unread-colors.js";
import { FIXTURE_PATH } from "./fixture.js";
import { run } from "./run.js";

/**
 * The two fact inventories — `coverage` and `unread-colors` — see `@property`
 * registrations.
 *
 * A registration with a usable `initial-value` is declared as far as rule 5
 * and the resolver are concerned, but mints no token row; the inventories
 * iterated token rows, so a sheet that declares tokens only through
 * `@property` printed "0 base tokens" and "every colour-valued token was read"
 * beside an `unresolved-reference (0)` that treated the same names as declared.
 * These pin the inventories reading the registration FACT
 * (`ResolvedStylesheet.registeredTokens`) while every row-based population
 * stays exactly as it was.
 */

const dir = mkdtempSync(join(tmpdir(), "themeguard-registered-"));
let n = 0;
const sheet = (css: string, name = `s${n++}.css`): string => {
  const path = join(dir, name);
  writeFileSync(path, css, "utf8");
  return path;
};
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const REG_ONLY = `
@property --brand { syntax: "<color>"; inherits: true; initial-value: #ff0000; }
@property --gap { syntax: "<length>"; inherits: true; initial-value: 8px; }
.btn { color: var(--brand); padding: var(--gap); }
`;

const BANNER = `
@property --banner { syntax: "<color>"; inherits: true; initial-value: light-dark(#000, #fff); }
.b { background: var(--banner); }
`;

describe("a registration-only sheet — the inventories stop contradicting rule 5", () => {
  const resolved = resolveCss(REG_ONLY);

  it("exposes the registrations as facts, sorted, and mints no token rows", () => {
    expect(resolved.registeredTokens.map((r) => [r.name, r.value, r.kind, r.line])).toEqual([
      ["--brand", "#ff0000", "color", 2],
      ["--gap", "8px", "non-color", 3],
    ]);
    expect(resolved.tokens).toEqual([]);
    expect(resolved.tokensFor("root")).toEqual([]);
  });

  it("coverage counts both registered tokens as base tokens, status `registered`", () => {
    const [root] = audit(resolved).coverage;
    expect(root).toMatchObject({ theme: "root", baseTokens: 2, overridden: [], inherited: [] });
    expect(root!.registered).toEqual([
      { name: "--brand", status: "registered", kind: "color" },
      { name: "--gap", status: "registered", kind: "non-color" },
    ]);
  });

  it("the prose headline and rows agree with rule 5", () => {
    const result = run(sheet(REG_ONLY));
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("coverage (1 theme, 2 base tokens)");
    expect(result.stdout).toContain("root: declares 0 of 2 base tokens, inherits 0, registered 2.");
    expect(result.stdout).toContain("    [registered] --brand (color)");
    expect(result.stdout).toContain("    [registered] --gap (non-color)");
    expect(result.stdout).not.toContain("0 base tokens");
    expect(result.stdout).toContain("unresolved-reference (0)");
    expect(result.stdout).toContain("No findings.");
  });

  it("unread-colors names a light-dark initial-value, with a denominator that includes it", () => {
    const r = resolveCss(BANNER + REG_ONLY);
    const rows = audit(r).unreadColors;
    expect(rows).toEqual([
      {
        theme: "root",
        token: "--banner",
        syntax: "light-dark",
        line: 2,
        declaration: "registered",
      },
    ]);
    expect(themeTokenTotals(r)).toEqual([{ theme: "root", total: 3 }]);

    const result = run(sheet(BANNER));
    expect(result.stdout).toContain("unread-colors (1)");
    expect(result.stdout).toContain("  root: 1 of 1 token not read.");
    expect(result.stdout).toContain(
      '    [unread] --banner (light-dark) in theme "root", registered by @property at line 2',
    );
    expect(result.code).toBe(EXIT_OK);
  });

  it("--json carries `registered` on coverage and a `registered` declaration on the unread row", () => {
    const result = run("--json", sheet(BANNER + REG_ONLY));
    const report = JSON.parse(result.stdout.trim());
    expect(report.coverage[0].registered.map((e: { name: string }) => e.name)).toEqual([
      "--banner",
      "--brand",
      "--gap",
    ]);
    expect(report.unreadColors).toEqual([
      { theme: "root", token: "--banner", syntax: "light-dark", line: 2, declaration: "registered" },
    ]);
  });
});

describe("registrations beside declarations", () => {
  const THEMED = `
@property --brand { syntax: "<color>"; inherits: true; initial-value: #ff0000; }
@property --banner { syntax: "<color>"; inherits: true; initial-value: light-dark(#000, #fff); }
:root { --ink: #101010; }
[data-theme="dark"] { --brand: #aa0000; --banner: light-dark(#111, #eee); }
.x { color: var(--brand); background: var(--banner); border-color: var(--ink); }
`;
  const resolved = resolveCss(THEMED);
  const report = audit(resolved);

  it("a theme that declares a registered name takes the ordinary `overridden` path — not double-listed", () => {
    // The assumption the ticket asked to pin: a theme's declaration of a
    // registered name always forms a token row.
    expect(resolved.token("--brand", "dark")?.origin).toBe("declared");
    const dark = report.coverage.find((c) => c.theme === "dark")!;
    expect(dark.baseTokens).toBe(3);
    expect(dark.overridden.map((e) => e.name)).toEqual(["--banner", "--brand"]);
    expect(dark.inherited.map((e) => e.name)).toEqual(["--ink"]);
    expect(dark.registered).toBeUndefined();
    const all = [...dark.overridden, ...dark.inherited, ...(dark.registered ?? [])];
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length);
  });

  it("the theme that declares nothing over a registered name reports `registered`", () => {
    const root = report.coverage.find((c) => c.theme === "root")!;
    expect(root.baseTokens).toBe(3);
    expect(root.overridden.map((e) => e.name)).toEqual(["--ink"]);
    expect(root.registered!.map((e) => e.name)).toEqual(["--banner", "--brand"]);
    const text = run(sheet(THEMED)).stdout;
    expect(text).toContain("root: declares 1 of 3 base tokens, inherits 0, registered 2.");
    expect(text).toContain("dark: declares 2 of 3 base tokens, inherits 1 (1 color / 0 non-color).");
  });

  it("unread-colors lists the registered initial-value only in themes that receive it", () => {
    const rows = report.unreadColors.map((r) => [r.theme, r.token, r.declaration]);
    expect(rows).toEqual([
      ["root", "--banner", "registered"],
      ["dark", "--banner", "declared"],
    ]);
  });

  it("a root declaration of a registered name is one base token, declared — the arms stay unchanged", () => {
    const css = `
@property --brand { syntax: "<color>"; inherits: true; initial-value: #ff0000; }
:root { --brand: #00f; }
[data-theme="dark"] { --other: #111; }
.x { color: var(--brand); }
`;
    const cov = audit(resolveCss(css)).coverage;
    expect(cov.map((c) => [c.theme, c.baseTokens, c.overridden.length, c.inherited.length])).toEqual([
      ["root", 1, 1, 0],
      ["dark", 1, 0, 1],
    ]);
    expect(cov.every((c) => c.registered === undefined)).toBe(true);
    expect(audit(resolveCss(css)).unreadColors).toEqual([]);
  });

  it("mints no row for a registration: the sheet reports no findings, and removing the registrations leaves only the declared base token", () => {
    const plain = THEMED.replace(/@property[^\n]*\n/g, "").replace(
      "var(--brand)",
      "var(--brand, red)",
    );
    const withReg = audit(resolved);
    expect(withReg.findings).toEqual([]);
    expect(Object.values(withReg.countsByRule).every((c) => c === 0)).toBe(true);
    // With the registrations removed the base tokens are the declared ones only.
    expect(audit(resolveCss(plain)).coverage[0]!.baseTokens).toBe(1);
  });
});

describe("registrations that carry no initial value stay absent from both inventories", () => {
  const STAR = `
@property --free { syntax: "*"; inherits: false; }
@property --typed { syntax: "<length>"; inherits: false; }
.x { margin: var(--free); padding: var(--typed); }
`;
  it("coverage and unread-colors report nothing; rule 5 still reports both names", () => {
    const resolved = resolveCss(STAR);
    expect(resolved.registeredTokens).toEqual([]);
    const report = audit(resolved);
    expect(report.coverage).toEqual([{ theme: "root", baseTokens: 0, overridden: [], inherited: [] }]);
    expect("registered" in report.coverage[0]!).toBe(false);
    expect(report.unreadColors).toEqual([]);
    expect(report.countsByRule["unresolved-reference"]).toBe(2);
  });

  it("a later `*` registration withdraws an earlier valid one's value from the inventories", () => {
    const resolved = resolveCss(`${REG_ONLY}\n@property --brand { syntax: "*"; inherits: true; }`);
    expect(resolved.registeredTokens.map((r) => r.name)).toEqual(["--gap"]);
  });
});

describe("an @theme inline alias of a registered name is the alias layer's, not a base token", () => {
  it("is left out of the coverage population exactly as aliases always were", () => {
    const css = `
@property --brand { syntax: "<color>"; inherits: true; initial-value: #ff0000; }
@theme inline { --brand: var(--other); }
:root { --other: #00f; }
.x { color: var(--brand); }
`;
    const cov = audit(resolveCss(css)).coverage[0]!;
    expect(cov.baseTokens).toBe(1);
    expect(cov.registered).toBeUndefined();
  });
});

describe("the import closure", () => {
  it("a registration spliced from an imported file is inventoried, with its file cited", () => {
    writeFileSync(
      join(dir, "props.css"),
      `\n@property --banner { syntax: "<color>"; inherits: true; initial-value: color-mix(in srgb, #fff 50%, #000); }\n`,
      "utf8",
    );
    const main = sheet(`@import "./props.css";\n.x { color: var(--banner); }\n`, "closure-main.css");
    const resolved = resolveStylesheet(loadStylesheet(main));
    expect(resolved.registeredTokens).toEqual([
      expect.objectContaining({ name: "--banner", importOrigin: "props.css", line: 2 }),
    ]);
    expect(audit(resolved).coverage[0]!.registered!.map((e) => e.name)).toEqual(["--banner"]);
    const result = run(main);
    expect(result.stdout).toContain(
      '    [unread] --banner (color-mix) in theme "root", registered by @property at props.css:2',
    );
  });
});

describe("zero-registration sheets are byte-identical", () => {
  it("the calibration fixture has no @property, no registered key, no registered rows", () => {
    const result = run("--json", FIXTURE_PATH);
    expect(result.stdout).not.toContain('"registered"');
    expect(result.stdout).not.toContain("[registered]");
    const prose = run(FIXTURE_PATH).stdout;
    expect(prose).toContain("root: declares all 73 base tokens, inherits 0.");
    expect(prose).not.toContain("registered");
  });

  it("a sheet with declarations and no @property has an empty registeredTokens and unchanged lines", () => {
    const resolved = resolveCss(":root { --a: #111; --b: 4px; } .x { color: var(--a); width: var(--b); }");
    expect(resolved.registeredTokens).toEqual([]);
    expect(audit(resolved).coverage).toEqual([
      { theme: "root", baseTokens: 2, overridden: expect.any(Array), inherited: [] },
    ]);
  });
});
