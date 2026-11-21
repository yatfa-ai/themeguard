import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, HELP, USAGE } from "../src/cli.js";
import { run } from "./run.js";

/** A stylesheet with no findings. */
const CLEAN = ":root { --a: #fff; }\n.x { color: var(--a); }\n";
/** A stylesheet whose one token nothing reads: a dead-token finding. */
const DEAD = ":root { --dead: #fff; }\n";

/** A component whose `<style>` holds a real `--a`/`--b` token collision. */
const COLLIDING = "<template><p class=\"x\">hi</p></template>\n<style>\n:root { --a: #fff; --b: #fff; }\n.x { color: var(--a); background: var(--b); }\n</style>\n";
/** A component with no CSS `<style>` block. */
const NO_STYLE = "<template><p>hi</p></template>\n";
const SCSS_ONLY = "<template><p>hi</p></template>\n<style lang=\"scss\">$a: 1;</style>\n";
const NO_FILES = (dir: string): string =>
  `themeguard: no *.css or component (.vue/.svelte/.astro) files with a CSS <style> block found in ${dir}`;

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "themeguard-dir-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fresh directory holding the given relative-path -> text files. */
function tree(files: Record<string, string>): string {
  const dir = join(root, `t${counter++}`);
  mkdirSync(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return dir;
}

/** The audited paths, in order, read off the `themeguard — <path>` headers. */
function audited(out: readonly string[]): string[] {
  return out.filter((l) => l.startsWith("themeguard — ")).map((l) => l.slice("themeguard — ".length));
}

describe("directory arguments", () => {
  it("names the directory form in USAGE and --help", () => {
    expect(USAGE).toBe("usage: themeguard [--json | --github | --suppress-entries --reason <text>] <file.css|dir> [file.css|dir…]");
    expect(HELP.split("\n")[0]).toBe(USAGE);
    expect(HELP).toMatch(/directory argument/);
  });

  it("expands to the *.css files in sorted order, recursively", () => {
    const dir = tree({
      "b.css": CLEAN,
      "a.css": CLEAN,
      "z/inner.css": CLEAN,
      "m/deep/x.css": CLEAN,
      "notes.txt": "not css",
      "c.scss": ":root { --s: #fff; }",
    });
    const result = run(dir);
    expect(result.code).toBe(EXIT_OK);
    expect(audited(result.out)).toEqual(
      ["a.css", "b.css", "m/deep/x.css", "z/inner.css"].map((r) => join(dir, r)),
    );
  });

  it("prints the same per-file output as naming the files, and aggregates the exit 2 > 1 > 0", () => {
    const dir = tree({ "a.css": CLEAN, "b.css": DEAD });
    const viaDir = run(dir);
    const viaFiles = run(join(dir, "a.css"), join(dir, "b.css"));
    expect(viaDir.code).toBe(EXIT_FINDINGS);
    expect(viaDir.out).toEqual(viaFiles.out);
    expect(viaDir.err).toEqual([]);

    const clean = tree({ "a.css": CLEAN });
    expect(run(clean).code).toBe(EXIT_OK);
  });

  it("emits the same NDJSON per file as for named files", () => {
    const dir = tree({ "a.css": CLEAN, "b.css": DEAD });
    const viaDir = run("--json", dir);
    const viaFiles = run("--json", join(dir, "a.css"), join(dir, "b.css"));
    expect(viaDir.code).toBe(EXIT_FINDINGS);
    expect(viaDir.out).toEqual(viaFiles.out);
    expect(viaDir.out).toHaveLength(2);
    for (const line of viaDir.out) JSON.parse(line);
  });

  it("skips node_modules and dot-directories at any depth", () => {
    const dir = tree({
      "keep.css": CLEAN,
      "node_modules/pkg/dead.css": DEAD,
      ".hidden/dead.css": DEAD,
      "sub/node_modules/dead.css": DEAD,
      "sub/.cache/dead.css": DEAD,
      "sub/ok.css": CLEAN,
    });
    const result = run(dir);
    expect(result.code).toBe(EXIT_OK);
    expect(audited(result.out)).toEqual([join(dir, "keep.css"), join(dir, "sub/ok.css")]);
  });

  it("does not follow symlinked directories (no cycles), but takes a symlinked .css file", () => {
    const dir = tree({ "real/a.css": CLEAN, "real/b.css": DEAD });
    symlinkSync(join(dir, "real"), join(dir, "linkdir"), "dir");
    symlinkSync(dir, join(dir, "real", "loop"), "dir");
    symlinkSync(join(dir, "real", "a.css"), join(dir, "alias.css"));
    const result = run(dir);
    expect(audited(result.out)).toEqual([
      join(dir, "alias.css"),
      join(dir, "real/a.css"),
      join(dir, "real/b.css"),
    ]);
  });

  it("is a usage error, never a green, for a directory with no *.css or CSS component", () => {
    const empty = tree({});
    const onlyOther = tree({ "readme.md": "x", "node_modules/p/x.css": DEAD });
    for (const dir of [empty, onlyOther]) {
      const result = run(dir);
      expect(result.code).toBe(EXIT_ERROR);
      expect(result.out).toEqual([]);
      expect(result.err).toEqual([NO_FILES(dir)]);
    }
  });

  it("an empty directory ends the run before any file is audited", () => {
    const good = tree({ "a.css": CLEAN });
    const empty = tree({});
    const result = run(good, empty);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
  });

  it("folds a partial under its importer instead of auditing it alone", () => {
    const dir = tree({
      "app.css": '@import "./tokens.css";\n.x { color: var(--brand); }\n',
      "tokens.css": ":root { --brand: #fff; }\n",
      "other.css": CLEAN,
    });
    const result = run(dir);
    expect(result.code).toBe(EXIT_OK);
    expect(audited(result.out)).toEqual([join(dir, "app.css"), join(dir, "other.css")]);
    expect(result.err).toEqual([
      "themeguard: 1 file folded into importers (imported by another discovered stylesheet, audited through it)",
    ]);

    // Audited alone, the partial reports exactly the false finding folding avoids.
    expect(run(join(dir, "tokens.css")).code).toBe(EXIT_FINDINGS);
  });

  it("folds transitively imported partials and counts them", () => {
    const dir = tree({
      "app.css": '@import "./mid.css";\n.x { color: var(--brand); }\n',
      "mid.css": '@import "./deep/tokens.css";\n',
      "deep/tokens.css": ":root { --brand: #fff; }\n",
    });
    const result = run(dir);
    expect(result.code).toBe(EXIT_OK);
    expect(audited(result.out)).toEqual([join(dir, "app.css")]);
    expect(result.err[0]).toContain("2 files folded into importers");
  });

  it("folds a partial reached through an intermediary the walk does not discover", () => {
    // `.shared` is skipped by the dot-directory rule, so mid.css is never a candidate.
    const dir = tree({
      "app.css": '@import "./.shared/mid.css";\n.x { color: var(--brand); }\n',
      ".shared/mid.css": '@import "../tokens.css";\n',
      "tokens.css": ":root { --brand: #fff; }\n",
    });
    const result = run(dir);
    expect(audited(result.out)).toEqual([join(dir, "app.css")]);
    expect(result.code).toBe(EXIT_OK);
    expect(result.err[0]).toContain("1 file folded into importers");
  });

  it("folds a partial imported with a parent-relative specifier", () => {
    const dir = tree({
      "tokens.css": ":root { --brand: #fff; }\n",
      "pages/app.css": '@import "../tokens.css";\n.x { color: var(--brand); }\n',
    });
    const result = run(dir);
    expect(audited(result.out)).toEqual([join(dir, "pages/app.css")]);
    expect(result.code).toBe(EXIT_OK);
  });

  it("keeps both files of an import cycle as entries", () => {
    const dir = tree({
      "a.css": '@import "./b.css";\n:root { --a: #fff; }\n.x { color: var(--a); }\n',
      "b.css": '@import "./a.css";\n:root { --b: #fff; }\n.y { color: var(--b); }\n',
    });
    const result = run(dir);
    expect(audited(result.out)).toEqual([join(dir, "a.css"), join(dir, "b.css")]);
    expect(result.err).toEqual([]);
  });

  it("never folds a file named explicitly, and audits it once", () => {
    const dir = tree({
      "app.css": '@import "./tokens.css";\n.x { color: var(--brand); }\n',
      "tokens.css": ":root { --brand: #fff; }\n",
    });
    const result = run(join(dir, "tokens.css"), dir);
    expect(audited(result.out)).toEqual([join(dir, "tokens.css"), join(dir, "app.css")]);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("leaves explicit file arguments byte-for-byte unchanged (no note, no discovery)", () => {
    const dir = tree({ "a.css": CLEAN, "b.css": DEAD });
    const result = run(join(dir, "b.css"), join(dir, "a.css"));
    expect(audited(result.out)).toEqual([join(dir, "b.css"), join(dir, "a.css")]);
    expect(result.err).toEqual([]);
    expect(run(join(dir, "missing.css")).code).toBe(EXIT_ERROR);
  });

  it("handles mixed file and directory arguments in argument order", () => {
    const one = tree({ "z.css": CLEAN });
    const two = tree({ "b.css": CLEAN, "a.css": CLEAN });
    const result = run(join(two, "b.css"), one, two);
    expect(audited(result.out)).toEqual([
      join(two, "b.css"),
      join(one, "z.css"),
      join(two, "a.css"),
    ]);
  });

  describe("component files (.vue/.svelte/.astro)", () => {
    it("audits a component beside a stylesheet, with the component's own lines", () => {
      const dir = tree({ "src/A.vue": COLLIDING, "src/theme.css": CLEAN });
      const result = run(dir);
      expect(result.code).toBe(EXIT_FINDINGS);
      expect(audited(result.out)).toEqual([join(dir, "src/A.vue"), join(dir, "src/theme.css")]);
      expect(result.out.join("\n")).toMatch(/collision \(1\)/);
      expect(result.err).toEqual([]);
    });

    it("audits a components-only directory, all three extensions", () => {
      const dir = tree({ "a.vue": CLEAN.replace(/^/, "<style>") + "</style>", "b.svelte": COLLIDING, "c.astro": COLLIDING });
      const result = run(dir);
      expect(result.code).toBe(EXIT_FINDINGS);
      expect(audited(result.out)).toEqual(["a.vue", "b.svelte", "c.astro"].map((r) => join(dir, r)));
    });

    it("leaves .html and .htm named-only", () => {
      const dir = tree({ "page.html": COLLIDING, "page.htm": COLLIDING, "a.css": CLEAN });
      const result = run(dir);
      expect(result.code).toBe(EXIT_OK);
      expect(audited(result.out)).toEqual([join(dir, "a.css")]);
      expect(result.err).toEqual([]);
    });

    it("exits 2 with the reworded message when no component has a CSS block", () => {
      const dir = tree({ "a.vue": NO_STYLE, "b.svelte": SCSS_ONLY });
      const result = run(dir);
      expect(result.code).toBe(EXIT_ERROR);
      expect(result.out).toEqual([]);
      expect(result.err).toEqual([NO_FILES(dir)]);
    });

    it("skips a style-less component beside a CSS file and counts it once on stderr, then names it", () => {
      const dir = tree({ "a.css": CLEAN, "b.vue": NO_STYLE, "c.vue": SCSS_ONLY, "d.svelte": NO_STYLE });
      const result = run(dir);
      expect(result.code).toBe(EXIT_OK);
      expect(audited(result.out)).toEqual([join(dir, "a.css")]);
      expect(result.err).toEqual([
        'themeguard: 3 components skipped (no CSS <style> block; non-CSS blocks: lang="scss")',
        `  ${join(dir, "c.vue")} [lang="scss"]`,
        `  ${join(dir, "b.vue")} [no <style>]`,
        `  ${join(dir, "d.svelte")} [no <style>]`,
      ]);
    });

    describe("naming the skipped components", () => {
      const LESS_ONLY = "<template><p>hi</p></template>\n<style lang=\"less\">@a: 1;</style>\n";
      const skippedTree = (): string =>
        tree({
          "ok.vue": COLLIDING,
          "S1.vue": SCSS_ONLY,
          "deep/S2.vue": LESS_ONLY,
          "deep/Plain.vue": NO_STYLE,
          "A.svelte": NO_STYLE,
        });

      it("lists each component, preprocessor ones first, each group in path order", () => {
        const dir = skippedTree();
        const result = run(dir);
        expect(result.err).toEqual([
          'themeguard: 4 components skipped (no CSS <style> block; non-CSS blocks: lang="scss", lang="less")',
          `  ${join(dir, "S1.vue")} [lang="scss"]`,
          `  ${join(dir, "deep", "S2.vue")} [lang="less"]`,
          `  ${join(dir, "A.svelte")} [no <style>]`,
          `  ${join(dir, "deep", "Plain.vue")} [no <style>]`,
        ]);
      });

      it("caps the list at 20 and discloses the cut", () => {
        const files: Record<string, string> = { "a.css": CLEAN };
        for (let i = 0; i < 23; i++) files[`c${String(i).padStart(2, "0")}.vue`] = NO_STYLE;
        const dir = tree(files);
        const err = run(dir).err;
        expect(err).toHaveLength(1 + 20 + 1);
        expect(err[1]).toBe(`  ${join(dir, "c00.vue")} [no <style>]`);
        expect(err[20]).toBe(`  ${join(dir, "c19.vue")} [no <style>]`);
        expect(err[21]).toBe("  and 3 more");
        expect(err[0]).toMatch(/^themeguard: 23 components skipped/);
      });

      it("does not cut a list of exactly 20", () => {
        const files: Record<string, string> = { "a.css": CLEAN };
        for (let i = 0; i < 20; i++) files[`c${String(i).padStart(2, "0")}.vue`] = NO_STYLE;
        const err = run(tree(files)).err;
        expect(err).toHaveLength(21);
        expect(err.join("\n")).not.toMatch(/and \d+ more/);
      });

      it("emits a trailing skippedComponents record under --json, uncapped", () => {
        const dir = skippedTree();
        const result = run("--json", dir);
        const lines = result.out.map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(lines.slice(0, -1).every((l) => typeof l.path === "string")).toBe(true);
        expect(lines.at(-1)).toEqual({
          skippedComponents: [
            { path: join(dir, "S1.vue"), kinds: ['lang="scss"'] },
            { path: join(dir, "deep", "S2.vue"), kinds: ['lang="less"'] },
            { path: join(dir, "A.svelte"), kinds: [] },
            { path: join(dir, "deep", "Plain.vue"), kinds: [] },
          ],
        });
        expect(lines.filter((l) => "skippedComponents" in l)).toHaveLength(1);
        expect(lines.filter((l) => "skippedComponents" in l)[0]).not.toHaveProperty("path");

        const many: Record<string, string> = { "a.css": CLEAN };
        for (let i = 0; i < 23; i++) many[`c${String(i).padStart(2, "0")}.vue`] = NO_STYLE;
        const big = JSON.parse(run("--json", tree(many)).out.at(-1) as string) as { skippedComponents: unknown[] };
        expect(big.skippedComponents).toHaveLength(23);
      });

      it("prints no record, and changes no byte, when nothing is skipped", () => {
        const dir = tree({ "a.css": CLEAN, "B.vue": COLLIDING });
        const result = run("--json", dir);
        expect(result.out.join("\n")).not.toMatch(/skippedComponents/);
        expect(result.out.map((l) => JSON.parse(l) as { path?: string }).every((l) => l.path !== undefined)).toBe(true);
        expect(result.err).toEqual([]);
      });

      it("keeps --github prose-only and the exit codes unchanged", () => {
        const dir = tree({ "a.css": CLEAN, "S1.vue": SCSS_ONLY });
        const github = run("--github", dir);
        expect(github.code).toBe(EXIT_OK);
        expect(github.stdout).not.toMatch(/skippedComponents/);
        expect(github.err).toHaveLength(2);
        expect(run("--json", dir).code).toBe(EXIT_OK);
        const dead = tree({ "a.css": DEAD, "S1.vue": SCSS_ONLY });
        expect(run("--json", dead).code).toBe(EXIT_FINDINGS);
      });

      it("does not list a component the user also named explicitly", () => {
        const dir = tree({ "a.css": CLEAN, "B.vue": NO_STYLE, "S1.vue": SCSS_ONLY });
        const result = run("--json", dir, join(dir, "B.vue"));
        expect(result.code).toBe(EXIT_ERROR);
        expect(result.stderr).not.toMatch(/B\.vue \[/);
      });
    });

    it("lets the CSS file decide the exit when a component is skipped", () => {
      const dir = tree({ "a.css": DEAD, "b.vue": SCSS_ONLY });
      expect(run(dir).code).toBe(EXIT_FINDINGS);
    });

    it("folds a partial imported from a component's <style>", () => {
      const dir = tree({
        "tokens.css": ":root { --t: #fff; }\n",
        "A.vue": '<template><p class="x">hi</p></template>\n<style>\n@import "./tokens.css";\n.x { color: var(--t); }\n</style>\n',
      });
      const result = run(dir);
      expect(result.code).toBe(EXIT_OK);
      expect(audited(result.out)).toEqual([join(dir, "A.vue")]);
      expect(result.err).toEqual([
        "themeguard: 1 file folded into importers (imported by another discovered stylesheet, audited through it)",
      ]);
    });

    it("never reads markup as an import edge", () => {
      const dir = tree({
        "tokens.css": ":root { --t: #fff; }\n.y { color: var(--t); }\n",
        "A.vue": '<template><a href="x">@import "./tokens.css";</a></template>\n' + COLLIDING,
      });
      const result = run(dir);
      expect(audited(result.out)).toEqual([join(dir, "A.vue"), join(dir, "tokens.css")]);
      expect(result.err).toEqual([]);
    });

    it("still skips node_modules and dot-directories", () => {
      const dir = tree({
        "a.css": CLEAN,
        "node_modules/p/X.vue": COLLIDING,
        ".cache/Y.svelte": COLLIDING,
      });
      const result = run(dir);
      expect(result.code).toBe(EXIT_OK);
      expect(audited(result.out)).toEqual([join(dir, "a.css")]);
    });

    it("keeps a named style-less component fatal, even when its directory is also given", () => {
      const dir = tree({ "a.css": CLEAN, "B.vue": NO_STYLE });
      const named = run(join(dir, "B.vue"));
      expect(named.code).toBe(EXIT_ERROR);
      const both = run(dir, join(dir, "B.vue"));
      expect(both.code).toBe(EXIT_ERROR);
      expect(both.err.join("\n")).not.toMatch(/skipped/);
    });
  });
});
