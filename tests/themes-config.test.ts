import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { parseConfigDocument, type ConfigDocument } from "../src/config.js";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { loadStylesheet } from "../src/load.js";
import { parseStylesheet, unrecognisedClassTheme, unrecognisedClassThemes } from "../src/parse.js";
import { resolveStylesheet } from "../src/resolve.js";
import { FIXTURE_PATH, fixtureCss } from "./fixture.js";

/**
 * The `themes` configuration key — naming additional class themes.
 *
 * The built-in recognition spells four channels (`.dark`/`.light` on bare/
 * html/body/:root, `[data-theme=…]`, `[data-bs-theme=…]`, prefers-color-scheme)
 * and a palette written in any other class is half-read: its declarations
 * never reach a theme table (or, under a `:root`-prefixed spelling, fold
 * last-wins into the base). Three pieces pin here: the parser turns a
 * configured class name into a theme of its own, the config validates the key
 * with the house discipline, and the loader refuses — exit 2, the fix spelled
 * out — exactly when a sheet DECLARES a palette variant nothing spells and no
 * configuration names one. A themeless sheet never refuses.
 */

const ROOT = `
  :root {
    --line: #e5e5e5;
    --surface: #ffffff;
    --raised: #ffffff;
    --bg: #fafafa;
  }
`;
/** The gap fixture: a real rule-1 collision planted in the dark palette. */
const THEME_DARK = `
  .theme-dark {
    --line: #121212;
    --surface: #121212;
    --raised: #121212;
    --bg: #0a0a0a;
  }
`;

const parse = (css: string, themes?: string[]) =>
  parseStylesheet(css, themes === undefined ? undefined : { themes });

const scopesOf = (css: string, themes?: string[]) =>
  parse(css, themes).scopes.map((s) => ({ kind: s.kind, theme: s.theme }));

const themesOf = (css: string, themes?: string[]) => parse(css, themes).themes;

/** Collision findings only: the rule the recognition gap silences. */
const collisionsOf = (path: string, themes?: string[]) =>
  audit(resolveStylesheet(loadStylesheet(path, themes === undefined ? undefined : { themes })))
    .findings.filter((f) => f.rule === "collision")
    .map((f) => `${f.theme}: ${[...f.tokens].sort().join(" == ")}`)
    .sort();

describe("parse — a configured class name is a theme of its own", () => {
  it("without the key, .theme-dark stays an unrecognised scope and the inventory stays empty", () => {
    expect(scopesOf(`${ROOT}${THEME_DARK}`)).toEqual([
      { kind: "root", theme: null },
      { kind: "other", theme: null },
    ]);
    expect(themesOf(`${ROOT}${THEME_DARK}`)).toBeUndefined();
  });

  it('with {"themes": ["theme-dark"]}, .theme-dark is the "theme-dark" theme', () => {
    expect(scopesOf(`${ROOT}${THEME_DARK}`, ["theme-dark"])).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "theme-dark" },
    ]);
    expect(themesOf(`${ROOT}${THEME_DARK}`, ["theme-dark"])).toEqual(["theme-dark"]);
  });

  it("the theme name is the class as spelled: html/body/:root subjects, one entry each", () => {
    for (const selector of [".theme-dark", "html.theme-dark", "body.theme-dark", ":root.theme-dark"]) {
      expect(scopesOf(`:root { --a: #fff; }\n${selector} { --a: #000; }`, ["theme-dark"])).toEqual([
        { kind: "root", theme: null },
        { kind: "theme", theme: "theme-dark" },
      ]);
    }
  });

  it(":root.theme-dark is no longer folded into the base scope", () => {
    // The pre-key harm: `classifyOne` fell through to the base test and the
    // dark values became the ROOT values. With the name configured the class
    // arm wins, exactly as it does for `:root.dark`.
    const css = `:root { --a: #ffffff; }\n:root.theme-dark { --a: #0a0a0a; }`;
    expect(scopesOf(css, ["theme-dark"])).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "theme-dark" },
    ]);
  });

  it("naming a class the sheet never writes mints nothing", () => {
    expect(scopesOf(`${ROOT}\n.card { --btn-bg: #00f; }`, ["theme-dark"])).toEqual([
      { kind: "root", theme: null },
      { kind: "other", theme: null },
    ]);
    expect(themesOf(`${ROOT}`, ["theme-dark"])).toBeUndefined();
  });

  it("the shape rules carry over unchanged: descendant, second class, suffix, case", () => {
    const configured = ["theme-dark"];
    expect(scopesOf(`.theme-dark .card { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
    expect(scopesOf(`.theme-dark.card { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
    expect(scopesOf(`.theme-darkish { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
    expect(scopesOf(`div.theme-dark { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
    // Class names are case-sensitive, exactly as the built-in pair is.
    expect(scopesOf(`.Theme-Dark { --a: #000; }`, configured)).toEqual([
      { kind: "other", theme: null },
    ]);
  });

  it("several configured names are several themes; the built-in pair needs no entry", () => {
    const css = `:root { --a: #fff; }
      .theme-dark { --a: #000; }
      .high-contrast { --a: #111; }
      .dark { --a: #222; }`;
    expect(scopesOf(css, ["theme-dark", "high-contrast"])).toEqual([
      { kind: "root", theme: null },
      { kind: "theme", theme: "theme-dark" },
      { kind: "theme", theme: "high-contrast" },
      { kind: "theme", theme: "dark" },
    ]);
    expect(themesOf(css, ["theme-dark", "high-contrast"])).toEqual([
      "theme-dark",
      "high-contrast",
      "dark",
    ]);
  });

  it("the inventory also carries a colour-scheme theme, recognised with no entry", () => {
    expect(
      themesOf(`:root { --a: #fff; }\n@media (prefers-color-scheme: dark) { :root { --a: #000; } }`),
    ).toEqual(["dark"]);
  });
});

describe("resolve — the configured theme's palette is audited like any theme", () => {
  it("the dark palette resolves per-theme and the planted collision reports", () => {
    const css = `:root { --line: #e5e5e5; --surface: #ffffff; --raised: #ffffff; }
      .theme-dark { --line: #121212; --surface: #121212; --raised: #121212; }`;
    const r = resolveStylesheet(parseStylesheet(css, { themes: ["theme-dark"] }));
    expect(r.themes).toEqual(["root", "theme-dark"]);
    expect(r.token("--line", "theme-dark")?.resolvedValue).toBe("#121212");
    expect(r.token("--line", "root")?.resolvedValue).toBe("#e5e5e5");
    const collisions = audit(r)
      .findings.filter((f) => f.rule === "collision")
      .map((f) => `${f.theme}: ${[...f.tokens].sort().join(" == ")}`)
      .sort();
    // The equality is witnessed apart in root (--line #e5e5e5 vs the others),
    // so the dark restatement is a defect, not a deliberate pair.
    expect(collisions).toContain("theme-dark: --line == --raised");
  });
});

describe("unrecognisedClassTheme — the loader's detection half", () => {
  it("a bare class re-tuning the base palette is the candidate, named", () => {
    expect(unrecognisedClassTheme(parseStylesheet(`${ROOT}${THEME_DARK}`).scopes)).toBe(
      "theme-dark",
    );
  });

  it("a :root-prefixed spelling is the candidate — its fold is the harm", () => {
    expect(
      unrecognisedClassTheme(
        parseStylesheet(`:root { --a: #fff; }\n:root.theme-dark { --a: #000; }`).scopes,
      ),
    ).toBe("theme-dark");
  });

  it("a component declaring fresh names is not a palette variant", () => {
    expect(
      unrecognisedClassTheme(
        parseStylesheet(`:root { --x: #fff; }\n.btn { --btn-bg: #00f; color: var(--x); }`).scopes,
      ),
    ).toBeNull();
  });

  it("a truly themeless sheet never names a candidate", () => {
    expect(unrecognisedClassTheme(parseStylesheet(`:root { --x: #fff; }`).scopes)).toBeNull();
    expect(unrecognisedClassTheme(parseStylesheet(``).scopes)).toBeNull();
  });

  it("a recognised theme never hides behind the detection", () => {
    expect(
      unrecognisedClassTheme(
        parseStylesheet(`:root { --a: #fff; }\n.dark { --a: #000; }`).scopes,
      ),
    ).toBeNull();
    expect(
      unrecognisedClassTheme(
        parseStylesheet(`:root { --a: #fff; }\n[data-theme="winter"] { --a: #000; }`).scopes,
      ),
    ).toBeNull();
  });

  it("a component overriding one or two root tokens is not a palette variant", () => {
    // The ordinary component-override idiom: a themeless sheet has these.
    const base = `:root { --radius: 4px; --bg: #fff; --fg: #111; }\n`;
    expect(unrecognisedClassTheme(parseStylesheet(`${base}.card-compact { --radius: 2px; }`).scopes)).toBeNull();
    expect(
      unrecognisedClassTheme(parseStylesheet(`${base}.btn-danger { --bg: #f00; --fg: #fff; }`).scopes),
    ).toBeNull();
    expect(unrecognisedClassTheme(parseStylesheet(`${base}:root.compact { --radius: 2px; }`).scopes)).toBeNull();
  });

  it("a variant restating the palette still names a candidate, bare or :root-prefixed", () => {
    const base = `:root { --radius: 4px; --bg: #fff; --fg: #111; }\n`;
    const dark = `{ --radius: 4px; --bg: #000; --fg: #eee; }`;
    expect(unrecognisedClassTheme(parseStylesheet(`${base}.high-contrast ${dark}`).scopes)).toBe("high-contrast");
    expect(unrecognisedClassTheme(parseStylesheet(`${base}:root.theme-dark ${dark}`).scopes)).toBe("theme-dark");
  });

  it("a bare class without base-palette overlap stays silent", () => {
    // A dark palette of entirely fresh names, no :root to tune: still
    // unrecognised, but not the palette-variant shape the refusal targets.
    expect(
      unrecognisedClassTheme(
        parseStylesheet(`.theme-dark { --dark-only: #000; }`).scopes,
      ),
    ).toBeNull();
  });
});

describe("unrecognisedClassThemes — every qualifying name", () => {
  const base = `:root { --radius: 4px; --bg: #fff; --fg: #111; }\n`;
  const variant = (sel: string) => `${sel} { --radius: 4px; --bg: #000; --fg: #eee; }\n`;

  it("lists all unnamed palettes in scope order, deduplicated", () => {
    const css = `${base}${variant(".high-contrast")}${variant(".sepia")}${variant("html.sepia")}`;
    expect(unrecognisedClassThemes(parseStylesheet(css).scopes)).toEqual(["high-contrast", "sepia"]);
    expect(unrecognisedClassTheme(parseStylesheet(css).scopes)).toBe("high-contrast");
  });

  it("names a palette beside a recognised theme, and skips configured and built-in classes", () => {
    const css = `${base}${variant('[data-theme="dark"]')}${variant(".high-contrast")}${variant(".dark")}${variant(".sepia")}`;
    expect(unrecognisedClassThemes(parseStylesheet(css).scopes)).toEqual(["high-contrast", "sepia"]);
    expect(
      unrecognisedClassThemes(parseStylesheet(css, { themes: ["sepia"] }).scopes),
    ).toEqual(["high-contrast"]);
    expect(
      unrecognisedClassThemes(parseStylesheet(css, { themes: ["sepia", "high-contrast"] }).scopes),
    ).toEqual([]);
  });

  it("is empty for a themeless or component-only sheet", () => {
    expect(unrecognisedClassThemes(parseStylesheet(base).scopes)).toEqual([]);
    expect(
      unrecognisedClassThemes(parseStylesheet(`${base}.btn-danger { --bg: #f00; }`).scopes),
    ).toEqual([]);
  });
});

describe("parseConfigDocument — the themes key validates with the house discipline", () => {
  it("reads the names verbatim; duplicates are harmless", () => {
    expect(parseConfigDocument('{"themes": ["theme-dark"]}', "mem/config.json")).toEqual({
      suppress: [],
      disabledRules: [],
      themes: ["theme-dark"],
    });
    expect(parseConfigDocument('{"themes": ["a", "a"]}', "mem/config.json")).toEqual({
      suppress: [],
      disabledRules: [],
      themes: ["a", "a"],
    });
  });

  it("an absent key and an empty array are the same empty recognition", () => {
    for (const raw of ["{}", '{"themes": []}']) {
      expect(parseConfigDocument(raw, "mem/config.json")).toEqual({
        suppress: [],
        disabledRules: [],
        themes: [],
      });
    }
  });

  it("a non-array key refuses, naming the key", () => {
    expect(() =>
      parseConfigDocument('{"themes": "theme-dark"}', "mem/config.json"),
    ).toThrowError(/"themes" must be an array of theme names, got "theme-dark"/);
  });

  it("a non-string element refuses, naming the element and what was written", () => {
    expect(() => parseConfigDocument('{"themes": [42]}', "mem/config.json")).toThrowError(
      /element 1 of "themes": must be a non-empty theme name — the class name the theme stands for, not a selector — got 42/,
    );
  });

  it("an empty or whitespace-only element refuses, naming the element", () => {
    expect(() => parseConfigDocument('{"themes": ["a", ""]}', "mem/config.json")).toThrowError(
      /element 2 of "themes": must be a non-empty theme name/,
    );
    expect(() => parseConfigDocument('{"themes": ["  "]}', "mem/config.json")).toThrowError(
      /element 1 of "themes": must be a non-empty theme name/,
    );
  });

  it("a selector-valued element is accepted as a name and simply never matches", () => {
    // The value is a theme NAME (the class the theme stands for), never a
    // selector — a spelling that cannot be one class is an honest no-op at
    // parse time, not an error: the key adds recognition, it never mints.
    const doc: ConfigDocument = parseConfigDocument('{"themes": [".theme-dark"]}', "mem/config.json");
    expect(doc.themes).toEqual([".theme-dark"]);
    expect(scopesOf(`${ROOT}${THEME_DARK}`, [...doc.themes])).toEqual([
      { kind: "root", theme: null },
      { kind: "other", theme: null },
    ]);
  });

  it("an unknown key still refuses, naming all three keys it knows", () => {
    expect(() => parseConfigDocument('{"theme": ["dark"]}', "mem/config.json")).toThrowError(
      /unknown key "theme" — expected "suppress", "suppress-rule" or "themes"/,
    );
  });
});

describe("load — the refusal and the recognition", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "themeguard-themes-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (name: string, text: string): string => {
    const path = join(dir, name);
    writeFileSync(path, text, "utf8");
    return path;
  };

  it("a sheet declaring an unrecognised palette variant refuses with the fix spelled out", () => {
    const path = write("gap.css", `${ROOT}${THEME_DARK}`);
    let err: unknown;
    try {
      loadStylesheet(path);
    } catch (e) {
      err = e;
    }
    expect((err as Error).name).toBe("ConfigError");
    expect((err as Error).message).toMatch(/theme block themeguard cannot recognise: \.theme-dark/);
    expect((err as Error).message).toMatch(/\{"themes": \["theme-dark"\]\}/);
    // The refusal's path is the candidate beside the stylesheet — where
    // creating the config fixes the audit.
    expect((err as Error).message).toContain(join(dir, "themeguard.config.json"));
  });

  it("the config's themes ride the load: the same sheet then audits in two themes", () => {
    const path = write("gap.css", `${ROOT}${THEME_DARK}`);
    const configured = collisionsOf(path, ["theme-dark"]);
    expect(configured).toContain("theme-dark: --line == --raised");
    // The byte-identical sheet written in .dark needs no entry — the built-in
    // pair — and reports the same collision under the built-in name.
    const dark = write("dark.css", `${ROOT}${THEME_DARK.replace(/\.theme-dark/g, ".dark")}`);
    expect(collisionsOf(dark)).toEqual(
      configured.map((c) => c.replace("theme-dark", "dark")),
    );
  });

  it("a config naming no themes still refuses; one naming themes never does", () => {
    const path = write("gap.css", `${ROOT}${THEME_DARK}`);
    const governing = write("themeguard.config.json", '{"themes": []}');
    expect(() => loadStylesheet(path)).toThrowError(/theme block themeguard cannot recognise/);
    // A config that exists but names no themes refuses too — and cites the
    // config the caller handed it (the loader reads no config of its own).
    let err: unknown;
    try {
      loadStylesheet(path, { configPath: governing });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toContain(governing);
    // Naming the class turns its refusal off; naming a DIFFERENT class does
    // not — the refusal is per unnamed palette, not "nothing is named".
    expect(() => loadStylesheet(path, { themes: ["theme-dark"] })).not.toThrow();
    expect(() => loadStylesheet(path, { themes: ["high-contrast"] })).toThrowError(
      /cannot recognise: \.theme-dark/,
    );
    rmSync(governing);
  });

  it("a themeless sheet and a component sheet audit with no config at all", () => {
    const themeless = write("themeless.css", `:root { --x: #ffffff; }`);
    expect(() => loadStylesheet(themeless)).not.toThrow();
    // No theme named anywhere: the inventory is ABSENT, not an empty list.
    expect(loadStylesheet(themeless).themes).toBeUndefined();
    const component = write(
      "component.css",
      `:root { --x: #ffffff; }\n.btn { --btn-bg: #0000ff; color: var(--x); }`,
    );
    expect(() => loadStylesheet(component)).not.toThrow();
    expect(loadStylesheet(component).themes).toBeUndefined();
  });

  it("a themeless sheet with a component overriding a root token loads and audits as before", () => {
    const css = `:root { --radius: 4px; --bg: #fff; --fg: #111; }\n.btn { background: var(--bg); color: var(--fg); }\n.card-compact { --radius: 2px; }`;
    const path = write("override.css", css);
    expect(() => loadStylesheet(path)).not.toThrow();
    expect(loadStylesheet(path).themes).toBeUndefined();
    const via = (themes?: string[]) =>
      JSON.stringify(
        audit(resolveStylesheet(loadStylesheet(path, themes === undefined ? undefined : { themes }))).findings,
      );
    // Byte-identical to the unconfigured run, and to a parse with no options.
    expect(via(["theme-dark"])).toBe(via());
    expect(JSON.stringify(audit(resolveStylesheet(parseStylesheet(css))).findings)).toBe(via());
  });

  const HC = `
  .high-contrast {
    --line: #000000;
    --surface: #000000;
    --raised: #000000;
    --bg: #000000;
  }
`;
  const DATA_DARK = `[data-theme="dark"] { --line: #333333; --surface: #222222; --raised: #2a2a2a; --bg: #111111; }\n`;

  it("a recognised theme plus an unnamed palette class refuses, naming the class", () => {
    const path = write("mixed.css", `${ROOT}${DATA_DARK}${HC}`);
    let err: unknown;
    try {
      loadStylesheet(path);
    } catch (e) {
      err = e;
    }
    expect((err as Error).name).toBe("ConfigError");
    expect((err as Error).message).toMatch(/cannot recognise: \.high-contrast/);
    expect((err as Error).message).toMatch(/\{"themes": \["high-contrast"\]\}/);
    // Naming it audits, with the third theme counted.
    expect(loadStylesheet(path, { themes: ["high-contrast"] }).themes).toEqual([
      "dark",
      "high-contrast",
    ]);
  });

  it("a partial themes list refuses naming the unnamed class and keeps the configured one", () => {
    const sheet = `${ROOT}${THEME_DARK}${HC}`;
    const path = write("partial.css", sheet);
    let err: unknown;
    try {
      loadStylesheet(path, { themes: ["theme-dark"] });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/cannot recognise: \.high-contrast \(/);
    expect((err as Error).message).not.toMatch(/cannot recognise: [^(]*\.theme-dark/);
    expect((err as Error).message).toMatch(/\{"themes": \["theme-dark", "high-contrast"\]\}/);
    expect(loadStylesheet(path, { themes: ["theme-dark", "high-contrast"] }).themes).toEqual([
      "theme-dark",
      "high-contrast",
    ]);
  });

  it("several unnamed palettes are all named in one refusal", () => {
    const sepia = HC.replace(".high-contrast", ".sepia");
    const path = write("several.css", `${ROOT}${DATA_DARK}${HC}${sepia}`);
    expect(() => loadStylesheet(path)).toThrowError(
      /cannot recognise: \.high-contrast, \.sepia \(.*\{"themes": \["high-contrast", "sepia"\]\}/,
    );
  });

  it("a recognised theme plus a small component override still audits", () => {
    const path = write(
      "mixed-component.css",
      `${ROOT}${DATA_DARK}.btn-danger { --bg: #f00; --line: #a00; }\n.btn-danger:hover { --bg: #c00; }`,
    );
    expect(() => loadStylesheet(path)).not.toThrow();
    expect(loadStylesheet(path).themes).toEqual(["dark"]);
  });

  it("recognition anywhere in the closure counts; themes merge across members", () => {
    const tokens = write("tokens.css", `[data-theme="dark"] { --line: #333333; }`);
    const entry = write(
      "entry.css",
      `@import "./tokens.css";\n:root { --x: #fff; }\n.theme-dark { --x: #000; --y: #000; }`,
    );
    // The closure DOES spell a theme (dark, from the imported file), so the
    // refusal does not fire — and the entry's inventory carries the member's
    // theme. The unrecognised class stays unrecognised: naming it in the
    // config is the user's next move, not the tool's guess.
    const sheet = loadStylesheet(entry);
    expect(sheet.themes).toEqual(["dark"]);
    expect(tokens.length).toBeGreaterThan(0);
  });
});

describe("cli — exit codes and diagnostics", () => {
  let cliDir: string;

  beforeAll(() => {
    cliDir = join(mkdtempSync(join(tmpdir(), "themeguard-themes-cli-")), "run");
    mkdirSync(cliDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(join(cliDir, ".."), { recursive: true, force: true });
  });

  const run = (
    ...args: string[]
  ): { code: number; out: string[]; err: string[] } => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
    return { code: runCli(args, io), out, err };
  };

  it("without the key: exit 2, prose on stderr, nothing on stdout", () => {
    const path = join(cliDir, "gap.css");
    writeFileSync(path, `${ROOT}${THEME_DARK}`, "utf8");
    const { code, out, err } = run(path);
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(/theme block themeguard cannot recognise: \.theme-dark/);
    expect(err.join("\n")).toMatch(/name the class themes in themeguard\.config\.json/);
  });

  it('with {"themes": ["theme-dark"]}: the audit runs and the collision moves the exit code', () => {
    const path = join(cliDir, "gap.css");
    writeFileSync(path, `${ROOT}${THEME_DARK}`, "utf8");
    writeFileSync(join(cliDir, "themeguard.config.json"), '{"themes": ["theme-dark"]}', "utf8");
    const { code, out, err } = run(path);
    expect(code).toBe(EXIT_FINDINGS);
    expect(err).toEqual([]);
    expect(out.join("\n")).toMatch(/coverage \(2 themes, 4 base tokens\)/);
    expect(out.join("\n")).toMatch(/in theme "theme-dark"/);
    rmSync(join(cliDir, "themeguard.config.json"));
  });

  it("a config naming themes covers the run: a sheet using a DIFFERENT unrecognised name does not refuse", () => {
    const path = join(cliDir, "other.css");
    writeFileSync(path, `:root { --x: #ffffff; }\n.high-contrast { --x: #000000; --y: #000000; }`, "utf8");
    writeFileSync(join(cliDir, "themeguard.config.json"), '{"themes": ["theme-dark"]}', "utf8");
    // The arm fires only when the governing config names NO themes; a config
    // that names some never refuses, whatever the sheet spells.
    const { code, err } = run(path);
    expect(code).not.toBe(EXIT_ERROR);
    expect(err).toEqual([]);
    rmSync(join(cliDir, "themeguard.config.json"));
    rmSync(path);
  });

  it("the key adds recognition and nothing else: a sheet using none is byte-identical", () => {    const path = join(cliDir, "plain.css");
    writeFileSync(path, `:root { --x: #ffffff; }\n.btn { --btn-bg: #0000ff; }`, "utf8");
    const without = run(path);
    writeFileSync(join(cliDir, "themeguard.config.json"), '{"themes": ["theme-dark"]}', "utf8");
    const withKey = run(path);
    rmSync(join(cliDir, "themeguard.config.json"));
    expect(withKey.code).toBe(without.code);
    expect(withKey.out).toEqual(without.out);
    expect(withKey.err).toEqual(without.err);
    expect(withKey.code).toBe(EXIT_FINDINGS); // the sheet's own dead token, not the key's doing
  });

  it("--json keeps diagnostics on stderr in both modes", () => {
    const path = join(cliDir, "gap.css");
    writeFileSync(path, `${ROOT}${THEME_DARK}`, "utf8");
    const { code, out, err } = run("--json", path);
    expect(code).toBe(EXIT_ERROR);
    expect(out).toEqual([]);
    expect(err.join("\n")).toMatch(/theme block themeguard cannot recognise/);
  });

  it("a clean audit exits 0", () => {
    const path = join(cliDir, "clean.css");
    writeFileSync(path, `:root { --x: #ffffff; color: var(--x); }`, "utf8");
    expect(run(path).code).toBe(EXIT_OK);
  });
});

describe("existing sheets do not move", () => {
  it("the calibration fixture audits exactly as before — no refusal, same findings", () => {
    // The vendored fixture spells [data-theme="winter"], so the refusal cannot
    // fire; its census is pinned elsewhere and re-checked here through the
    // loader path the CLI takes.
    const sheet = loadStylesheet(FIXTURE_PATH);
    expect(sheet.themes).toEqual(["winter"]);
    const findings = audit(resolveStylesheet(sheet)).findings;
    expect(findings.length).toBe(22);
  });
});
