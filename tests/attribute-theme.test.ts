import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConfigDocument } from "../src/config.js";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import {
  parseStylesheet,
  unrecognisedAttributeTheme,
  unrecognisedAttributeThemes,
  unrecognisedClassThemes,
} from "../src/parse.js";
import { resolveStylesheet } from "../src/resolve.js";
import { scaleCollapseRule } from "../src/rules/scale-collapse.js";

/**
 * The `themeAttributes` configuration key — naming additional ATTRIBUTE
 * themes (`[data-md-color-scheme=slate]`, `[data-mantine-color-scheme=dark]`,
 * `[data-color-mode=dark]`), the sibling of the class `themes` key.
 *
 * Without the key such a palette is half-read: a bare `[attr=v]` block is
 * dropped from every theme table, and `:root[attr=v]` folds last-wins into
 * the base. Three pieces pin here: the parser turns a configured attribute
 * into a theme named for its VALUE, the config validates the key, and the
 * loader refuses — exit 2 — a palette variant under an attribute nothing
 * names, at the same bar the class refusal uses.
 */

const LIGHT = `
  :root {
    --brand: #336699;
    --brand-hover: #2a5580;
    --surface: #ffffff;
    --text: #111111;
  }
  .x { color: var(--brand); background: var(--brand-hover); }
`;
/** The planted dark-only defect: --brand-hover == --brand. */
const DARK_BODY = `{ --brand: #6699cc; --brand-hover: #6699cc; --surface: #101010; --text: #eeeeee; }`;
const sheet = (selector: string) => `${LIGHT}\n${selector} ${DARK_BODY}\n`;

const scopesOf = (css: string, themeAttributes?: string[]) =>
  parseStylesheet(css, { themeAttributes }).scopes.map((s) => ({ kind: s.kind, theme: s.theme }));

const collapsesOf = (css: string, themeAttributes?: string[]) => {
  const resolved = resolveStylesheet(parseStylesheet(css, { themeAttributes }));
  return scaleCollapseRule(resolved).findings.map((f) => f.theme);
};

describe("parse — a configured attribute is a theme named for its value", () => {
  const SLATE = '[data-md-color-scheme="slate"]';

  it("without the key the attribute is unrecognised: the palette is silently dropped", () => {
    expect(scopesOf(sheet(SLATE))).toEqual([
      { kind: "root", theme: null },
      { kind: "other", theme: null },
    ]);
    expect(collapsesOf(sheet(SLATE))).toEqual([]);
  });

  it("with the key, bare [attr=v] is the theme `slate` and the dark collapse is found in it", () => {
    expect(scopesOf(sheet(SLATE), ["data-md-color-scheme"])).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "slate" },
    ]);
    expect(collapsesOf(sheet(SLATE), ["data-md-color-scheme"])).toEqual(["slate"]);
  });

  it("quoted, single-quoted, unquoted and spaced values all name the theme", () => {
    for (const selector of [
      "[data-md-color-scheme=slate]",
      "[data-md-color-scheme='slate']",
      '[ data-md-color-scheme = "slate" ]',
    ]) {
      expect(scopesOf(sheet(selector), ["data-md-color-scheme"])[1]).toEqual({
        kind: "theme",
        theme: "slate",
      });
    }
  });

  it(":root[attr=v] is the theme, not the base — and no longer overwrites the light palette", () => {
    const css = sheet(':root[data-color-mode="dark"]');
    expect(scopesOf(css)).toEqual([
      { kind: "root", theme: null },
      { kind: "root", theme: null },
    ]);
    expect(scopesOf(css, ["data-color-mode"])).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "dark" },
    ]);
    const resolved = resolveStylesheet(parseStylesheet(css, { themeAttributes: ["data-color-mode"] }));
    expect(resolved.token("--surface", "root")?.resolvedValue).toBe("#ffffff");
    expect(resolved.token("--surface", "dark")?.resolvedValue).toBe("#101010");
    // The finding is labelled with the dark theme, not mislabelled `root`.
    expect(collapsesOf(css, ["data-color-mode"])).toEqual(["dark"]);
  });

  it("a compound subject behaves as [data-theme] does", () => {
    const configured = ["data-mantine-color-scheme"];
    const attr = scopesOf(`.navbar[data-mantine-color-scheme=dark] { --a: #000; }`, configured);
    const builtin = scopesOf(`.navbar[data-theme=dark] { --a: #000; }`);
    expect(attr).toEqual(builtin);
    expect(attr).toEqual([{ kind: "theme", theme: "dark" }]);
    // A descendant keeps its component subject.
    expect(
      scopesOf(`[data-mantine-color-scheme=dark] .btn { --a: #000; }`, configured),
    ).toEqual([{ kind: "other", theme: null }]);
    // A negation never names the subject.
    expect(
      scopesOf(`:root:not([data-mantine-color-scheme]) { --a: #000; }`, configured),
    ).toEqual([{ kind: "root", theme: null }]);
  });

  it("the built-in names still work, and a different attribute stays unrecognised", () => {
    const configured = ["data-md-color-scheme"];
    expect(scopesOf(`[data-theme=dark] { --a: #000; }`, configured)).toEqual([
      { kind: "theme", theme: "dark" },
    ]);
    expect(scopesOf(`[data-bs-theme=dark] { --a: #000; }`, configured)).toEqual([
      { kind: "theme", theme: "dark" },
    ]);
    expect(scopesOf(`[data-mode=dark] { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
    // A configured name is exact: a suffixed attribute is another attribute.
    expect(scopesOf(`[data-md-color-scheme-x=dark] { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
  });

  it("an attribute name with regex metacharacters never widens the match", () => {
    expect(scopesOf(`[data-xmd=dark] { --a: #000; }`, ["data-.md"])).toEqual([
      { kind: "other", theme: null },
    ]);
  });

  it("naming an attribute the sheet never writes mints nothing", () => {
    expect(parseStylesheet(LIGHT, { themeAttributes: ["data-md-color-scheme"] }).themes).toBeUndefined();
  });
});

describe("positive control — the same axis with only the light :root", () => {
  it("reports no scale-collapse, configured or not", () => {
    expect(collapsesOf(LIGHT)).toEqual([]);
    expect(collapsesOf(LIGHT, ["data-md-color-scheme"])).toEqual([]);
  });
});

describe("unrecognisedAttributeThemes — the loader's detection half", () => {
  const base = `:root { --radius: 4px; --bg: #fff; --fg: #111; }\n`;
  const variant = (sel: string) => `${sel} { --radius: 4px; --bg: #000; --fg: #eee; }\n`;
  const names = (css: string, themeAttributes?: string[]) =>
    unrecognisedAttributeThemes(parseStylesheet(css, { themeAttributes }).scopes);

  it("a bare attribute restating the palette is named, with the attribute not the value", () => {
    expect(names(`${base}${variant("[data-md-color-scheme=slate]")}`)).toEqual([
      "data-md-color-scheme",
    ]);
    expect(
      unrecognisedAttributeTheme(parseStylesheet(`${base}${variant("html[data-x=dark]")}`).scopes),
    ).toBe("data-x");
  });

  it(":root[attr=v] restating the palette is named — its fold into the base is the harm", () => {
    expect(names(`${base}${variant(":root[data-color-mode=dark]")}`)).toEqual(["data-color-mode"]);
  });

  it("lists every unnamed attribute once, in scope order; configured and built-in ones are skipped", () => {
    const css = `${base}${variant("[data-a=x]")}${variant("[data-a=y]")}${variant("[data-b=x]")}${variant("[data-theme=dark]")}${variant("[data-c=x]")}`;
    expect(names(css)).toEqual(["data-a", "data-b", "data-c"]);
    expect(names(css, ["data-b"])).toEqual(["data-a", "data-c"]);
    expect(names(css, ["data-a", "data-b", "data-c"])).toEqual([]);
  });

  it("a small component override never qualifies", () => {
    expect(names(`${base}[data-size=lg] { --radius: 8px; }`)).toEqual([]);
    expect(names(`${base}:root[data-density=compact] { --radius: 2px; }`)).toEqual([]);
    // Bare attribute: half the base but under the absolute floor of three.
    const small = `:root { --a: 1; --b: 2; }\n[data-x=y] { --a: 3; --b: 4; }`;
    expect(names(small)).toEqual([]);
    // Fresh names only: no overlap with the base.
    expect(names(`${base}[data-x=y] { --fresh-1: 1; --fresh-2: 2; --fresh-3: 3; }`)).toEqual([]);
  });

  it("body and case-folded html/body subjects name the candidate, like the class twin", () => {
    for (const sel of ["body[data-x=dark]", "HTML[data-x=dark]", "BODY[data-x=dark]", "Html[data-x=dark]"]) {
      expect(names(`${base}${variant(sel)}`), sel).toEqual(["data-x"]);
    }
    // Contrast arm: an element that is not html/body is still not a theme subject.
    expect(names(`${base}${variant("section[data-x=dark]")}`)).toEqual([]);
  });

  it("stays silent for shapes outside the single-attribute subject", () => {
    expect(names(`${base}${variant("[data-a=x][data-b=y]")}`)).toEqual([]);
    expect(names(`${base}${variant("[data-a=x] .card")}`)).toEqual([]);
    expect(names(`${base}${variant("div[data-a=x]")}`)).toEqual([]);
    expect(names(`${base}${variant("[data-a]")}`)).toEqual([]);
  });

  it("themeless sheets and recognised themes never name a candidate", () => {
    expect(names(base)).toEqual([]);
    expect(names(``)).toEqual([]);
    expect(names(`${base}${variant("[data-theme=dark]")}`)).toEqual([]);
  });

  it("an attribute candidate is not measured against, and does not inflate, the class refusal's base", () => {
    // Both palettes qualify against the one real base palette.
    const css = `${base}${variant(":root[data-color-mode=dark]")}${variant(".high-contrast")}`;
    const scopes = parseStylesheet(css).scopes;
    expect(unrecognisedAttributeThemes(scopes)).toEqual(["data-color-mode"]);
    expect(unrecognisedClassThemes(scopes)).toEqual(["high-contrast"]);
  });
});

describe("parseConfigDocument — themeAttributes validates with the house discipline", () => {
  const parseDoc = (raw: string) => parseConfigDocument(raw, "mem/config.json");

  it("reads the names verbatim; the key is optional", () => {
    expect(parseDoc('{"themeAttributes": ["data-md-color-scheme", "data-color-mode"]}')).toEqual({
      suppress: [],
      disabledRules: [],
      themes: [],
      themeAttributes: ["data-md-color-scheme", "data-color-mode"],
    });
    for (const raw of ["{}", '{"themeAttributes": []}']) {
      expect(parseDoc(raw).themeAttributes).toEqual([]);
    }
  });

  it("a non-array key refuses, naming the key", () => {
    expect(() => parseDoc('{"themeAttributes": "data-md-color-scheme"}')).toThrowError(
      /"themeAttributes" must be an array of attribute names, got "data-md-color-scheme"/,
    );
  });

  it("a non-string or empty element refuses, naming the element", () => {
    expect(() => parseDoc('{"themeAttributes": [42]}')).toThrowError(
      /element 1 of "themeAttributes": must be an attribute name .* got 42/,
    );
    expect(() => parseDoc('{"themeAttributes": ["data-a", ""]}')).toThrowError(
      /element 2 of "themeAttributes": must be an attribute name .* got ""/,
    );
  });

  it("a selector-looking element refuses, naming it", () => {
    for (const bad of ["[data-md-color-scheme]", "[data-md-color-scheme=slate]", ".dark", "a b", "data-x=y", "1abc", ":root"]) {
      expect(() => parseDoc(JSON.stringify({ themeAttributes: [bad] }))).toThrowError(
        new RegExp(`element 1 of "themeAttributes": must be an attribute name`),
      );
    }
  });

  it("names the key among the keys it knows", () => {
    expect(() => parseDoc('{"themeAttribute": []}')).toThrowError(/or "themeAttributes"/);
  });
});

describe("load — the refusal and the recognition", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "themeguard-attr-themes-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const write = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text, "utf8");
    return path;
  };
  const errorOf = (fn: () => unknown): Error => {
    try {
      fn();
    } catch (e) {
      return e as Error;
    }
    throw new Error("expected a throw");
  };

  it("an unnamed bare attribute palette refuses, naming the attribute and the key", () => {
    const path = write("bare.css", sheet('[data-md-color-scheme="slate"]'));
    const err = errorOf(() => loadStylesheet(path));
    expect(err.name).toBe("ConfigError");
    expect(err.message).toMatch(/theme block themeguard cannot recognise: \[data-md-color-scheme=…\]/);
    expect(err.message).toMatch(/\{"themeAttributes": \["data-md-color-scheme"\]\}/);
    expect(err.message).toContain(join(dir, "themeguard.config.json"));
  });

  it("an unnamed :root[attr=v] palette refuses too", () => {
    const path = write("root.css", sheet(':root[data-color-mode="dark"]'));
    expect(errorOf(() => loadStylesheet(path)).message).toMatch(
      /cannot recognise: \[data-color-mode=…\].*\{"themeAttributes": \["data-color-mode"\]\}/,
    );
  });

  it("naming the attribute turns the refusal off and audits the theme; a different name does not", () => {
    const path = write("named.css", sheet('[data-md-color-scheme="slate"]'));
    expect(loadStylesheet(path, { themeAttributes: ["data-md-color-scheme"] }).themes).toEqual(["slate"]);
    expect(() => loadStylesheet(path, { themeAttributes: ["data-other"] })).toThrowError(
      /cannot recognise: \[data-md-color-scheme=…\]/,
    );
  });

  it("a partial list keeps the configured name in the suggested fix", () => {
    const css = `${LIGHT}[data-a=x] ${DARK_BODY}\n[data-b=x] ${DARK_BODY}\n`;
    const path = write("partial.css", css);
    const err = errorOf(() => loadStylesheet(path, { themeAttributes: ["data-a"] }));
    expect(err.message).toMatch(/cannot recognise: \[data-b=…\]/);
    expect(err.message).toMatch(/\{"themeAttributes": \["data-a", "data-b"\]\}/);
  });

  it("a sheet with unnamed attribute AND class palettes gets one refusal naming both keys", () => {
    const css = `${sheet("[data-a=x]")}.high-contrast ${DARK_BODY}\n`;
    const path = write("both.css", css);
    const err = errorOf(() => loadStylesheet(path));
    expect(err.message).toMatch(/\{"themeAttributes": \["data-a"\]\}/);
    expect(err.message).toMatch(/class themes \.high-contrast.*"themes": \["high-contrast"\]/);
  });

  it("a small component override and a themeless sheet never refuse", () => {
    const path = write(
      "component.css",
      `:root { --pad: 4px; --bg: #fff; --fg: #111; }\n[data-size=lg] { --pad: 8px; }\n:root[data-density=compact] { --pad: 2px; }`,
    );
    expect(() => loadStylesheet(path)).not.toThrow();
    expect(loadStylesheet(path).themes).toBeUndefined();
    expect(() => loadStylesheet(write("light.css", LIGHT))).not.toThrow();
  });

  it("a recognised attribute (data-theme) never refuses", () => {
    expect(() => loadStylesheet(write("builtin.css", sheet('[data-theme="dark"]')))).not.toThrow();
  });
});

describe("the CLI — exit 2 without the key, the audited finding with it", () => {
  let cliDir: string;
  beforeAll(() => {
    cliDir = mkdtempSync(join(tmpdir(), "themeguard-attr-cli-"));
    mkdirSync(cliDir, { recursive: true });
  });
  afterAll(() => {
    rmSync(cliDir, { recursive: true, force: true });
  });
  const run = (...args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
    return { code: runCli(args, io), out, err };
  };

  it("an unnamed attribute palette exits 2 with the fix on stderr", () => {
    const path = join(cliDir, "slate.css");
    writeFileSync(path, sheet("[data-md-color-scheme=slate]"), "utf8");
    const { code, out, err } = run(path);
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(/name the attribute themes in themeguard\.config\.json/);
  });

  it("with the key the dark theme is audited: 2 themes, the finding names `slate`", () => {
    const path = join(cliDir, "slate.css");
    writeFileSync(path, sheet("[data-md-color-scheme=slate]"), "utf8");
    const config = join(cliDir, "themeguard.config.json");
    writeFileSync(config, '{"themeAttributes": ["data-md-color-scheme"]}', "utf8");
    const { code, out, err } = run(path);
    rmSync(config);
    expect(code).toBe(EXIT_FINDINGS);
    expect(err).toEqual([]);
    expect(out.join("\n")).toMatch(/coverage \(2 themes/);
    expect(out.join("\n")).toMatch(/in theme "slate"/);
  });

  it("a malformed key is exit 2 naming the element", () => {
    const path = join(cliDir, "light.css");
    writeFileSync(path, ":root { --x: #ffffff; color: var(--x); }", "utf8");
    const config = join(cliDir, "themeguard.config.json");
    writeFileSync(config, '{"themeAttributes": ["[data-x]"]}', "utf8");
    const { code, err } = run(path);
    rmSync(config);
    expect(code).toBe(EXIT_ERROR);
    expect(err.join("\n")).toMatch(/element 1 of "themeAttributes"/);
  });

  it("a clean light-only sheet exits 0", () => {
    const path = join(cliDir, "clean.css");
    writeFileSync(path, ":root { --x: #ffffff; color: var(--x); }", "utf8");
    expect(run(path).code).toBe(EXIT_OK);
  });
});
