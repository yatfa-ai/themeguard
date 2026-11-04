import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";

const messageOf = (entry: unknown): string => {
  try {
    parseConfig(JSON.stringify({ suppress: [entry] }), "mem/config.json");
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    return (e as ConfigError).message;
  }
  throw new Error("expected parseConfig to throw");
};

describe("a suppress entry that names no rule", () => {
  it("reads an omitted `rule` key as null, naming the entry and the known rules", () => {
    const message = messageOf({ token: "--x", reason: "r" });
    expect(message).toContain('entry 1 of "suppress": unknown rule null — expected one of collision, ');
    expect(message).not.toContain("undefined");
  });
  it("reads an explicit `rule: null` the same way", () => {
    expect(messageOf({ rule: null, token: "--x", reason: "r" })).toContain(
      'entry 1 of "suppress": unknown rule null — expected one of ',
    );
  });
  it("quotes a present-but-unknown rule as a JSON string (control arm)", () => {
    expect(messageOf({ rule: "typo", token: "--x", reason: "r" })).toContain('unknown rule "typo"');
  });
});
