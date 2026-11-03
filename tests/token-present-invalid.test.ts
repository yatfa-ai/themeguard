import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const parse = (entry: Record<string, unknown>) =>
  parseConfig(JSON.stringify({ suppress: [{ rule: "dead-token", reason: "r", ...entry }] }), "mem/config.json");

// A PRESENT-but-unusable "token" (not the missing one, which has its own
// message): the scalar spelling must refuse it, naming the entry and echoing
// what was written, exactly as "theme" and "file" already do.
describe('a present but unusable "token" is refused by name', () => {
  it("refuses the empty string and echoes it", () => {
    expect(() => parse({ token: "" })).toThrowError(
      /entry 1 of "suppress": "token" must be a non-empty string naming the token the finding carries, got ""$/,
    );
  });

  it("refuses a non-string and echoes it", () => {
    expect(() => parse({ token: 5 })).toThrowError(
      /entry 1 of "suppress": "token" must be a non-empty string naming the token the finding carries, got 5$/,
    );
  });

  it("accepts a real token (control)", () => {
    expect(() => parse({ token: "--x" })).not.toThrow();
  });
});
