import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { EXIT_ERROR } from "../src/cli.js";
import { run } from "./run.js";

// A chmod-000 directory does not fail when the suite runs as root, so the
// walker's failure is injected: readdirSync throws EACCES for one directory.
const denied = vi.hoisted(() => ({ path: "" }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: ((path: unknown, ...rest: unknown[]) => {
      if (typeof path === "string" && path === denied.path) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${path}'`), {
          code: "EACCES",
        });
      }
      return (actual.readdirSync as (...a: unknown[]) => unknown)(path, ...rest);
    }) as typeof actual.readdirSync,
  };
});

const root = mkdtempSync(join(tmpdir(), "themeguard-unreadable-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("unreadable directory during discovery", () => {
  it("exits 2 with a cannot-read diagnostic, never the findings code, and audits nothing", () => {
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "a.css"), ":root { --a: #fff; }\n.x { color: var(--a); }\n");
    writeFileSync(join(root, "sub", "b.css"), ":root { --b: #fff; }\n");
    denied.path = join(root, "sub");

    const result = run(root);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.out).toEqual([]);
    expect(result.err).toEqual([
      `themeguard: cannot read ${root}: EACCES: permission denied, scandir '${join(root, "sub")}'`,
    ]);
  });
});
