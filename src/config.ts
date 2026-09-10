/**
 * `themeguard.config.json` — the one way to say "this finding is deliberate".
 *
 * A user who agrees with the audit but disagrees with ONE finding needs a way
 * to record that agreement-with-an-exception, or adoption is
 * fix-everything-or-abandon. The config is OPTIONAL and discovered NEXT TO THE
 * STYLESHEET (not the process CWD): a run is `themeguard <file.css>`, so the
 * config that governs a file is the one beside it — deterministic for the
 * "point it at a file" usage, and independent of wherever the command happens
 * to be invoked from. An absent file changes nothing at all.
 *
 * The entries are STRUCTURED — a rule id and a token name, matched against the
 * finding's own `rule` and `tokens` fields — never message scraping. A message
 * is prose for a human; matching on it would couple the config to wording.
 *
 * Validation is strict on purpose, and it is the same discipline as the
 * report's own: a config the tool cannot honour is never silently ignored.
 * A malformed entry — an unknown rule id, a missing token, a missing reason,
 * an unrecognised key, unreadable JSON — is an ERROR naming the offending
 * entry, because a config that silently did nothing is a user who believes a
 * finding was marked deliberate when it was reported after all. An entry whose
 * shape is valid but which matches no finding is NOT an error: the finding it
 * would have named still prints and still moves the exit code, so the miss is
 * self-announcing.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuleId } from "./rules/finding.js";

/** The file name, discovered beside the stylesheet. */
export const CONFIG_FILENAME = "themeguard.config.json";

/** Every rule id a suppression entry may name. */
const RULE_IDS: readonly RuleId[] = [
  "collision",
  "dead-token",
  "scale-collapse",
  "family-consistency",
];

/** One deliberate finding: the rule that reported it, a token it names, and why. */
export interface SuppressionEntry {
  /** The rule id the finding was reported under. */
  readonly rule: RuleId;
  /**
   * A token the finding carries. A finding is suppressed when its rule matches
   * and its `tokens` include this name — one token per entry, so a deliberate
   * pair is recorded token by token.
   */
  readonly token: string;
  /** Why this finding is deliberate — printed verbatim in the report. */
  readonly reason: string;
}

/** A config this package cannot honour — always the user's own file. */
export class ConfigError extends Error {
  /** The path of the config that failed. */
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`invalid ${CONFIG_FILENAME} at ${path} — ${detail}`);
    this.name = "ConfigError";
    this.path = path;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read `themeguard.config.json` from the directory of `cssPath` and return its
 * suppression entries, or `null` when there is no config file. Any other
 * failure to read — a config that exists but cannot be read — throws, as does
 * any malformed content: both are things the user wrote and must hear about.
 */
export function loadConfig(cssPath: string): readonly SuppressionEntry[] | null {
  const path = join(dirname(cssPath), CONFIG_FILENAME);

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw new ConfigError(
      path,
      `could not be read — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return parseConfig(raw, path);
}

/**
 * Parse and validate config text into entries. Pure — the file read lives in
 * {@link loadConfig} — so the validation rules are testable as data.
 */
export function parseConfig(raw: string, path: string): readonly SuppressionEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      path,
      `not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isObject(parsed)) {
    throw new ConfigError(path, `expected a JSON object with a "suppress" key`);
  }

  const allowed = ["suppress"];
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path,
        `unknown key "${key}" — expected "suppress". A key this package does not know would otherwise do nothing, silently.`,
      );
    }
  }

  if (parsed["suppress"] === undefined) return [];

  const list = parsed["suppress"];
  if (!Array.isArray(list)) {
    throw new ConfigError(
      path,
      `"suppress" must be an array of entries, got ${JSON.stringify(list)}`,
    );
  }

  return list.map((item, index) => parseEntry(item, index, path));
}

function parseEntry(item: unknown, index: number, path: string): SuppressionEntry {
  const where = `entry ${index + 1} of "suppress"`;
  if (!isObject(item)) {
    throw new ConfigError(path, `${where} must be an object, got ${JSON.stringify(item)}`);
  }

  const allowed = ["rule", "token", "reason"];
  for (const key of Object.keys(item)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path,
        `${where}: unknown key "${key}" — expected "rule", "token", "reason". A key this package does not know would otherwise do nothing, silently.`,
      );
    }
  }

  const rule = item["rule"];
  if (typeof rule !== "string" || !RULE_IDS.includes(rule as RuleId)) {
    throw new ConfigError(
      path,
      `${where}: unknown rule ${JSON.stringify(rule ?? null)} — expected one of ${RULE_IDS.join(", ")}`,
    );
  }

  const token = item["token"];
  if (typeof token !== "string" || token.length === 0) {
    throw new ConfigError(
      path,
      `${where}: "token" must be a non-empty string naming the token the finding carries, got ${JSON.stringify(token ?? null)}`,
    );
  }

  const reason = item["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ConfigError(
      path,
      `${where}: "reason" must be a non-empty string — the report quotes it, and a deliberate finding without a stated why is a suppression waiting to be forgotten`,
    );
  }

  return { rule: rule as RuleId, token, reason };
}
