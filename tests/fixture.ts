import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";

/** The vendored calibration stylesheet (yatfa @ 961eef3). See fixtures/README.md. */
export const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/application.tailwind.css", import.meta.url),
);

export function fixtureCss(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

/** Path of the comment-only stub that resolves the vendored sheet's
 *  `@import "./actiontext.css";` edge (see fixtures/README.md). */
export const FIXTURE_STUB_PATH = fileURLToPath(
  new URL("./fixtures/actiontext.css", import.meta.url),
);

/** The stub's text, for tests that copy the fixture OUT of tests/fixtures/:
 *  a faithful copy carries the stub beside it, or the copy's own relative
 *  edge breaks and its census gains an `unresolved-import` finding. */
export function fixtureStubCss(): string {
  return readFileSync(FIXTURE_STUB_PATH, "utf8");
}

/**
 * Hand-counted census baseline for the vendored fixture, reconciled against a
 * machine count of the same file at the same commit.
 *
 * The hand count and the machine count agree exactly, and the `:root` figure has
 * a third, independent cross-check: the themeguard README records this palette's
 * history as "23 → 73 tokens", and 73 is what a comment-aware parse of the
 * `:root` block returns.
 *
 * The reconciliation that matters: a NAIVE line grep of the `:root` block returns
 * 74–75, not 73, because the block's comments quote `--token: value` prose while
 * explaining past palette decisions. Comment-aware parsing is the difference, and
 * the delta is the comment text — not a disagreement about what a declaration is.
 */
export const CENSUS = {
  root: 73,
  winter: 51,
  themeInline: 64,
  total: 188,
  /** `:root` tokens with no `[data-theme="winter"]` override. */
  winterAbsences: 22,
} as const;

/** A writer over one scratch directory: `write(rel, contents)` creates `rel`'s parent directories, writes the file and returns its absolute path. */
export function fixtureWriter(root: string): (rel: string, contents: string) => string {
  return (rel, contents) => {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, "utf8");
    return path;
  };
}

/** A fresh scratch directory under the OS tmpdir, named `themeguard-<label>-…` and removed after the calling file's tests; call it at module scope. */
export function scratchDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `themeguard-${label}-`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
