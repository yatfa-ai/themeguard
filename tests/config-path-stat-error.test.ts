import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, ConfigError, configPathFor } from "../src/config.js";

const tmp = mkdtempSync(join(tmpdir(), "themeguard-config-stat-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("configPathFor — a candidate the walk cannot stat is an error, never a skip", () => {
  it("a stylesheet path whose parent is a FILE (ENOTDIR) throws a ConfigError naming the candidate, instead of walking on to an ancestor's config", () => {
    // An ancestor config exists: a walk that treated every stat failure as
    // "absent" would continue upward and silently adopt it.
    const ancestor = join(tmp, CONFIG_FILENAME);
    writeFileSync(ancestor, JSON.stringify({ suppress: [] }), "utf8");
    // Control: the walk from a sibling directory finds that ancestor.
    const sibling = join(tmp, "sibling");
    mkdirSync(sibling, { recursive: true });
    expect(configPathFor(join(sibling, "sheet.css"))).toBe(ancestor);

    // Action: the stylesheet's "directory" is a regular file, so statting
    // `<file>/themeguard.config.json` fails with ENOTDIR, not ENOENT.
    const notADir = join(tmp, "not-a-dir.css");
    writeFileSync(notADir, "", "utf8");
    const candidate = join(notADir, CONFIG_FILENAME);
    let thrown: unknown;
    try {
      configPathFor(join(notADir, "sheet.css"));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as ConfigError).path).toBe(candidate);
    expect((thrown as ConfigError).message).toContain("could not be read");
    expect((thrown as ConfigError).message).toContain("ENOTDIR");
  });
});
