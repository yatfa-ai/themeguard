import { expect } from "vitest";
import type { Run } from "./run.js";

/** The one `unmatchedSuppressions` row of a `--json` report; asserts there is exactly one. */
export function soleUnmatchedRow(result: Run): Record<string, unknown> {
  const report = JSON.parse(result.out[0] as string) as {
    unmatchedSuppressions: Record<string, unknown>[];
  };
  expect(report.unmatchedSuppressions).toHaveLength(1);
  return report.unmatchedSuppressions[0] as Record<string, unknown>;
}
