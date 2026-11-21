import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK } from "../src/cli.js";
import { extractStyleBlocks } from "../src/styleblocks.js";
import { run } from "./run.js";

const CSS = ":root{--a:#fff;--b:#fff}\n.x{color:var(--a);background:var(--b)}\n";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "themeguard-style-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function file(name: string, text: string): string {
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
}

describe("extractStyleBlocks", () => {
  it("keeps length and every newline, blanking everything outside CSS bodies", () => {
    const text =
      '<template>\n  <p>hi</p>\n</template>\n<style scoped lang="css">\n.x { color: red }\n</style>\n<script>\nlet a = 1;\n</script>\n';
    const { text: out, css } = extractStyleBlocks(text);
    expect(css).toBe(1);
    expect(out).toHaveLength(text.length);
    expect(out.split("\n").map((l) => l.length)).toEqual(text.split("\n").map((l) => l.length));
    expect(out.indexOf(".x { color: red }")).toBe(text.indexOf(".x { color: red }"));
    expect(out).not.toMatch(/template|script|<p>/);
  });

  it("does not take a commented-out <style> for a stylesheet", () => {
    expect(extractStyleBlocks("<!-- <style>.x{--a:#fff}</style> -->").css).toBe(0);
  });

  it("reports a preprocessor block as skipped, not as CSS", () => {
    const blocks = extractStyleBlocks(
      '<style lang="SCSS">$a: 1;</style><style type="text/less">a{}</style><style>.ok{}</style>',
    );
    expect(blocks.css).toBe(1);
    expect(blocks.skipped).toEqual(['lang="scss"', 'type="text/less"']);
    expect(blocks.text).not.toContain("$a");
  });
});

describe("host files named on the command line", () => {
  it("audits a .vue <style scoped> block as the same CSS file would, at the file's real lines", () => {
    const vue = file("v.vue", `<template>\n  <div class="x"/>\n</template>\n<style scoped>\n${CSS}</style>\n`);
    const result = run(vue);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toMatch(/collision \(1\)/);
    // the tokens sit on file line 5, after the 3 template lines and the tag line.
    expect(result.stdout).toMatch(/Declared at lines 5 and 5/);
    expect(result.stdout).not.toMatch(/No findings/);
  });

  it("audits a .svelte <style> block, with attributes and markup after it", () => {
    const svelte = file(
      "s.svelte",
      `<script>\n  let n = 0;\n</script>\n\n<style lang="css">\n${CSS}</style>\n<p>{n}</p>\n`,
    );
    const result = run(svelte);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toMatch(/collision \(1\)/);
    expect(result.stdout).toMatch(/Declared at lines 6 and 6/);
  });

  it("audits .astro, .html and .htm the same way", () => {
    for (const ext of ["astro", "html", "htm"]) {
      const path = file(`h.${ext}`, `<html><head><style media="screen">\n${CSS}</style></head></html>\n`);
      const result = run(path);
      expect(result.code, ext).toBe(EXIT_FINDINGS);
      expect(result.stdout, ext).toMatch(/collision \(1\)/);
    }
  });

  it("exits 2 for a file whose only style block is a preprocessor", () => {
    const path = file(
      "scss.vue",
      '<template><p/></template>\n<style lang="scss">$a: #fff;\n:root { --a: #fff; }</style>\n',
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toMatch(/skipped a <style lang="scss"> block/);
    expect(result.stderr).toMatch(/no CSS <style> block in .*scss\.vue/);
    expect(result.stdout).not.toMatch(/No findings/);
  });

  it("says so on stderr but still audits the CSS block beside a preprocessor block", () => {
    const path = file("mixed.vue", `<style lang="less">@a: 1;</style>\n<style>\n${CSS}</style>\n`);
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stderr).toMatch(/skipped a <style lang="less"> block/);
  });

  it("exits 2 with a named diagnostic for a host file with no <style> block", () => {
    const path = file("plain.vue", "<template><p>hi</p></template>\n");
    const result = run(path);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toMatch(/no <style> block in .*plain\.vue/);
    expect(result.stdout).not.toMatch(/No findings/);
  });

  it("follows an @import inside a <style> block relative to the host file", () => {
    file("tokens.css", ":root{--a:#fff;--b:#fff}\n");
    const path = file(
      "imp.vue",
      '<template/>\n<style>\n@import "./tokens.css";\n.x{color:var(--a);background:var(--b)}\n</style>\n',
    );
    const result = run(path);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toMatch(/collision \(1\)/);
    expect(result.stdout).toMatch(/tokens\.css:1/);
  });

  it("leaves a .css file's output untouched (regression pin)", () => {
    const css = file("plain.css", CSS);
    const result = run(css);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toMatch(/collision \(1\)/);
    expect(result.stdout).toMatch(/Declared at lines 1 and 1/);
    const clean = file("clean.css", ":root{--a:#fff}\n.x{color:var(--a)}\n");
    expect(run(clean).code).toBe(EXIT_OK);
  });
});
