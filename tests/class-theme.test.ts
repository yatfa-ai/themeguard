import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { resolveCss } from "../src/resolve.js";

/**
 * Class-based dark/light themes — `.dark`, `html.dark`, `body.dark`,
 * `:root.dark` (Tailwind `darkMode: "class"`, shadcn) — are the `dark` / `light`
 * themes, the same names `[data-theme="dark"]` and the prefers-color-scheme
 * media query use, so every spelling merges into one table.
 */

const ROOT = `
  :root {
    --background: #ffffff;
    --card: #ffffff;
    --foreground: #0a0a0a;
    --muted: #f5f5f5;
    --border: #e5e5e5;
    --primary: #171717;
  }
`;
const DARK_BODY = `
  --background: #0a0a0a;
  --card: #262626;
  --foreground: #fafafa;
  --muted: #262626;
  --border: #262626;
  --primary: #fafafa;
`;
const withSelector = (selector: string) => `${ROOT}\n${selector} {${DARK_BODY}}\n`;

const summarise = (css: string) => {
  const r = audit(resolveCss(css));
  return {
    themes: r.coverage.map((c) => c.theme),
    collisions: r.findings
      .filter((f) => f.rule === "collision")
      .map((f) => `${f.theme}: ${f.tokens.join(" == ")}`)
      .sort(),
  };
};

describe("class-based themes are the dark theme", () => {
  const twin = summarise(withSelector('[data-theme="dark"]'));

  it("the attribute twin reports the dark collision across two themes", () => {
    expect(twin.themes).toEqual(["root", "dark"]);
    expect(twin.collisions.some((c) => c.startsWith("dark: "))).toBe(true);
    expect(twin.collisions.some((c) => c.startsWith("root: "))).toBe(true);
  });

  for (const selector of [".dark", "html.dark", "body.dark", ":root.dark", "html:root.dark"]) {
    it(`${selector} reports the same findings as [data-theme="dark"], labelled dark`, () => {
      expect(summarise(withSelector(selector))).toEqual(twin);
    });
  }

  it("a nested &.dark inside :root is the dark scope too", () => {
    const css = `${ROOT}\n:root { &.dark {${DARK_BODY}} }\n`;
    expect(summarise(css)).toEqual(twin);
  });
});

describe(":root.dark no longer overwrites the root table", () => {
  it("keeps the light palette's own collision reported in root", () => {
    const r = audit(resolveCss(withSelector(":root.dark")));
    const root = r.findings.filter((f) => f.rule === "collision" && f.theme === "root");
    expect(root.map((f) => f.tokens)).toEqual([["--background", "--card"]]);
    expect(r.findings.some((f) => f.rule === "collision" && f.theme === "dark")).toBe(true);
  });

  it("resolves root to the light values, dark to the dark ones", () => {
    const resolved = resolveCss(withSelector(":root.dark"));
    expect(resolved.token("--card", "root")?.resolvedValue).toBe("#ffffff");
    expect(resolved.token("--card", "dark")?.resolvedValue).toBe("#262626");
  });
});

describe(".light is the light theme", () => {
  it("classifies .light, html.light and :root.light as theme light", () => {
    for (const selector of [".light", "html.light", "body.light", ":root.light"]) {
      const r = resolveCss(`${ROOT}\n${selector} { --card: #eeeeee; }\n`);
      expect(r.themes, selector).toEqual(["root", "light"]);
      expect(r.token("--card", "light")?.resolvedValue, selector).toBe("#eeeeee");
      expect(r.token("--card", "root")?.resolvedValue, selector).toBe("#ffffff");
    }
  });

  it("lands in the same table as the light media query, last in source winning", () => {
    const r = resolveCss(
      `${ROOT}\n@media (prefers-color-scheme: light) { :root { --card: #111111; } }\nhtml.light { --card: #eeeeee; }\n`,
    );
    expect(r.themes).toEqual(["root", "light"]);
    expect(r.token("--card", "light")?.resolvedValue).toBe("#eeeeee");
  });
});

describe("what is NOT a class theme", () => {
  const themesOf = (css: string) => resolveCss(`${ROOT}\n${css}\n`).themes;

  it("a descendant of .dark is a component, not the dark scope", () => {
    expect(themesOf(".dark .card { --card: #262626; }")).toEqual(["root"]);
    expect(themesOf("html.dark > body { --card: #262626; }")).toEqual(["root"]);
  });

  it("other class names are not themes", () => {
    for (const selector of [".theme-dark", ".high-contrast", ".darkish", "html.dark-mode"]) {
      expect(themesOf(`${selector} { --card: #262626; }`), selector).toEqual(["root"]);
    }
  });

  it("a second class, an id, or another element type is not a bare theme subject", () => {
    for (const selector of [".dark.card", "div.dark", "#app.dark", ".dark.light", ".dark[data-x]"]) {
      expect(themesOf(`${selector} { --card: #262626; }`), selector).toEqual(["root"]);
    }
  });

  it(":root:not(.dark) stays the base scope", () => {
    const r = resolveCss(`${ROOT}\n:root:not(.dark) { --card: #fafafa; }\n`);
    expect(r.themes).toEqual(["root"]);
    expect(r.token("--card", "root")?.resolvedValue).toBe("#fafafa");
  });

  it(":root:hover stays root", () => {
    expect(themesOf(":root:hover { --card: #fafafa; }")).toEqual(["root"]);
  });

  it("a class inside an attribute value does not classify", () => {
    expect(themesOf('[data-x=".dark"] { --card: #262626; }')).toEqual(["root"]);
  });

  it("an explicit data-theme beside .dark keeps the attribute's name", () => {
    expect(themesOf('.dark[data-theme="winter"] { --card: #262626; }')).toEqual(["root", "winter"]);
  });
});

describe("class, attribute and media spellings are one dark table", () => {
  it("merges .dark with @media (prefers-color-scheme: dark) :root, last in source winning", () => {
    const css = `${ROOT}
      @media (prefers-color-scheme: dark) { :root { --card: #111111; --border: #111111; } }
      .dark { --card: #262626; }
      [data-theme="dark"] { --muted: #333333; }
    `;
    const r = resolveCss(css);
    expect(r.themes).toEqual(["root", "dark"]);
    expect(r.token("--card", "dark")?.resolvedValue).toBe("#262626");
    expect(r.token("--border", "dark")?.resolvedValue).toBe("#111111");
    expect(r.token("--muted", "dark")?.resolvedValue).toBe("#333333");
  });

  it("body.dark is included as a theme subject (product call: same as html.dark)", () => {
    expect(resolveCss(`${ROOT}\nbody.dark { --card: #262626; }`).themes).toEqual(["root", "dark"]);
  });
});
