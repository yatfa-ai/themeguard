import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, configPathFor, readConfig, readConfigDocument } from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "themeguard-config-gone-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const CONFIG = JSON.stringify({
  suppress: [{ rule: "scale-collapse", token: "--panel-hover", reason: "deliberately subtle" }],
  "suppress-rule": ["dead-token"],
});

describe("readConfigDocument / readConfig — a config deleted between discovery and read is null, not an error", () => {
  it("returns null for the path configPathFor found once the file is gone", () => {
    const configPath = join(tmp, CONFIG_FILENAME);
    writeFileSync(configPath, CONFIG, "utf8");
    // Control: while the file exists the same path reads as a full document.
    expect(configPathFor(join(tmp, "sheet.css"))).toBe(configPath);
    expect(readConfigDocument(configPath)?.suppress).toHaveLength(1);
    expect(readConfigDocument(configPath)?.disabledRules).toEqual(["dead-token"]);
    // Action: the file disappears after discovery returned its path.
    rmSync(configPath);
    expect(readConfigDocument(configPath)).toBeNull();
  });

  it("readConfig projects a missing document as null, never an empty entry list", () => {
    const missing = join(tmp, "second", CONFIG_FILENAME);
    const present = join(tmp, "present.json");
    writeFileSync(present, CONFIG, "utf8");
    // Control: a present config projects to its entries.
    expect(readConfig(present)).toEqual([
      { rule: "scale-collapse", token: "--panel-hover", reason: "deliberately subtle" },
    ]);
    // Action: a path that does not exist.
    expect(readConfig(missing)).toBeNull();
    expect(readConfig(missing)).not.toEqual([]);
  });
});
