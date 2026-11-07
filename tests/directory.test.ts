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
    expect(USAGE).toBe("usage: themeguard [--json] <file.css|dir> [file.css|dir…]");
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

  it("is a usage error, never a green, for a directory with no *.css", () => {
    const empty = tree({});
    const onlyOther = tree({ "readme.md": "x", "node_modules/p/x.css": DEAD });
    for (const dir of [empty, onlyOther]) {
      const result = run(dir);
      expect(result.code).toBe(EXIT_ERROR);
      expect(result.out).toEqual([]);
      expect(result.err).toEqual([`themeguard: no *.css files found in ${dir}`]);
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
});
