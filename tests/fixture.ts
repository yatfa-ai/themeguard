import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The vendored calibration stylesheet (yatfa @ 961eef3). See fixtures/README.md. */
export const FIXTURE_PATH = fileURLToPath(
  new URL("./fixtures/application.tailwind.css", import.meta.url),
);

export function fixtureCss(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
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
