import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, type CliIo } from "../src/cli.js";

export interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly stdout: string;
  readonly stderr: string;
}

export function run(...args: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, out, err, stdout: out.join("\n"), stderr: err.join("\n") };
}

/** The one `[unmatched]` row of a report, or `undefined` when there is none. */
export function unmatchedRow(result: Run): string | undefined {
  return result.out.find((l) => l.startsWith("  [unmatched] "));
}

/** The repository root — the working directory the built-artifact suites spawn from. */
export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The compiled CLI entry the built-artifact suites execute. */
export const BUILT_CLI = join(REPO_ROOT, "dist", "cli.js");

/** `npm run build` into `dist/` — the `beforeAll` of every built-artifact suite. */
export function buildCli(): void {
  execFileSync("npm", ["run", "build"], { cwd: REPO_ROOT, stdio: "pipe" });
}

/** Run `node dist/cli.js <args>` as a child process; a non-zero exit is returned, not thrown. */
export function spawnBuilt(...args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [BUILT_CLI, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}
