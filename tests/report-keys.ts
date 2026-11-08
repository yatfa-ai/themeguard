import { expect } from "vitest";

/**
 * The suite's ONE spelling of the `--json` report object's key order — a
 * compatibility surface, since `JSON.stringify` preserves insertion order and
 * consumers read the report positionally. A key added to the report is added
 * here once; every site that pins the order goes through
 * `expectReportKeyOrder`.
 *
 * This array must stay hand-typed. Deriving it from the return literal in
 * `src/audit.ts` would make the pin tautological — it could never fail when
 * the order moved.
 */
const REPORT_KEY_ORDER = [
  "path",
  "findings",
  "countsByRule",
  "suppressed",
  "unmatchedSuppressions",
  "suppressedDisabled",
  "skipped",
  "skippedDisabled",
  "coverage",
  "unreadColors",
];

/** Assert the parsed report carries exactly these keys, in exactly this order. */
export function expectReportKeyOrder(report: object): void {
  expect(Object.keys(report)).toEqual(REPORT_KEY_ORDER);
}
