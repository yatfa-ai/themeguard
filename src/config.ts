/**
 * `themeguard.config.json` — the one way to say "this finding is deliberate".
 *
 * A user who agrees with the audit but disagrees with ONE finding needs a way
 * to record that agreement-with-an-exception, or adoption is
 * fix-everything-or-abandon. The config is OPTIONAL and discovered by walking
 * UP from the stylesheet's directory — the FIRST directory on the way to the
 * filesystem root that holds one governs (nearest wins, the
 * eslint/tsconfig/.editorconfig prior), never the process CWD: a run is
 * `themeguard <file.css>`, so what governs a file is decided by where the file
 * LIVES, independent of wherever the command happens to be invoked from. The
 * walk is what lets one ledger govern a subtree — a config at `styles/`
 * reaches `styles/components/` too, so the standard component-library layout
 * (theme tokens at the root, components one directory down) is ONE config, not
 * a copy per directory. No config anywhere up the tree changes nothing at all.
 *
 * The entries are STRUCTURED — a rule id and a token dimension (a scalar
 * `token`, or a `tokens` set the finding must carry in full), optionally
 * scoped to the `theme` the finding was measured in and to the stylesheet
 * (`file`, relative to this config's own directory) the judgement was
 * recorded against — matched against the finding's own fields, never message
 * scraping. A message is prose for a human; matching on it would couple the
 * config to wording.
 *
 * Validation is strict on purpose, and it is the same discipline as the
 * report's own: a config the tool cannot honour is never silently ignored.
 * A malformed entry — an unknown rule id, a missing token dimension, a
 * malformed `theme`, `tokens` or `file`, a missing reason, an unrecognised
 * key, unreadable JSON — is an ERROR naming the offending entry, because a
 * config that silently did nothing is a user who believes a finding was
 * marked deliberate when it was reported after all. An entry whose shape is
 * valid but which matches no finding is NOT an error: the finding it would
 * have named still prints and still moves the exit code, so the miss is
 * self-announcing.
 *
 * That reasoning is SCOPED to the mis-aimed entry — the finding it missed
 * still exists, so it announces the miss. It does NOT cover the expired
 * entry: a judgement written about a defect that has since been FIXED has no
 * finding left to announce anything, and would be invisible here. That case
 * is what the audit report's counted `unmatchedSuppressions` leg — printed by
 * the CLI as its `unmatched` section — exists for: the entry is named there,
 * in declaration order with its reason quoted, still without becoming an
 * error.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { RuleId } from "./rules/finding.js";

/** The file name, discovered at or above the stylesheet — nearest ancestor wins. */
export const CONFIG_FILENAME = "themeguard.config.json";

/** Every rule id a suppression entry may name. */
const RULE_IDS: readonly RuleId[] = [
  "collision",
  "dead-token",
  "scale-collapse",
  "family-consistency",
  "unresolved-reference",
  "cycle-reference",
  "duplicate-declaration",
  "unresolved-import",
  "theme-partial-token",
];

/**
 * One deliberate finding: the rule that reported it, the token dimension it
 * names — a scalar {@link token}, or the whole set via {@link tokens} — an
 * optional {@link theme} scope, and why.
 */
export interface SuppressionEntry {
  /** The rule id the finding was reported under. */
  readonly rule: RuleId;
  /**
   * A token the finding carries. A finding is suppressed when its rule matches
   * and its `tokens` include this name. Optional: the token dimension is named
   * EITHER by this scalar — any one token the finding carries — OR by the
   * {@link tokens} set, never both. The scalar stays the spelling for
   * single-token findings and for every config written before sets existed.
   */
  readonly token?: string;
  /**
   * The token SET the finding must carry: the finding is suppressed only when
   * every name listed is among its `tokens`. This is what gives a collision
   * PAIR the precision the docstring always promised — an entry on the pair,
   * not a stroke across every finding that happens to carry one member.
   * Optional; must be non-empty when present (an empty set would match every
   * finding and suppress what was never judged).
   */
  readonly tokens?: readonly string[];
  /**
   * The theme the finding was measured in. A scoped entry matches only
   * findings measured in THAT theme, so a deliberate equality in one theme
   * never silences the same question in another. Optional: `undefined` (the
   * key absent) keeps the unscoped, every-theme behaviour. Findings that are
   * not theme-specific — a dead token is measured stylesheet-wide — carry
   * `theme: null` and are never matched by a scoped entry.
   */
  readonly theme?: string;
  /**
   * The stylesheet the judgement was recorded against, relative to the
   * config's own directory. A scoped entry matches only findings reported
   * for THAT stylesheet, which is what makes the config's own doctrine —
   * "a suppression is worth exactly the file it was recorded against" — true
   * by declaration rather than by accident of where the file sits: the
   * standard component-library layout shares ONE config among sibling
   * stylesheets, and without this field a judgement written for one of them
   * silently governed all of them. RELATIVE on purpose (directory
   * independence): an absolute path would make the same config mean
   * different things from different checkouts, so it is a validation error,
   * not a shape. Optional: `undefined` (the key absent) keeps the
   * whole-config reading — the CLI resolves the field against the config's
   * own directory — the home discovery found, which may sit above the
   * stylesheet — before matching, so the same relative spelling means the
   * same file wherever the checkout lives. That home is also this field's
   * boundary: a config governs its own directory and below, so a scope
   * naming a file outside that subtree can never be honoured, and the
   * report says so.
   */
  readonly file?: string;
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
 * The config governing `cssPath`: walk UP from the stylesheet's directory —
 * that directory first, then each parent, bounded at the filesystem root —
 * and return the first `themeguard.config.json` found, or `null` when no
 * directory up the tree holds one. NEAREST wins: a config beside the
 * stylesheet shadows any ancestor's, which is also why every layout the
 * previous discovery understood — the config in the stylesheet's own
 * directory — behaves byte-identically (it is the walk's first hop). This is
 * the ecosystem's strongest default, the eslint/tsconfig/.editorconfig prior.
 *
 * The error contract is the read's own, lifted to the walk: a candidate the
 * walk cannot even STAT — a directory along the way that refuses the lookup,
 * anything other than a clean absence — is an ERROR naming the candidate,
 * never a silent skip. The bound, by contrast, is honest and quiet: the
 * filesystem root is where "nearest ancestor" ends, and reaching it having
 * found nothing is the answer `null`, not a failure.
 */
export function configPathFor(cssPath: string): string | null {
  let dir = dirname(resolve(cssPath));
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    try {
      statSync(candidate);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") {
        throw new ConfigError(
          candidate,
          `could not be read — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const parent = dirname(dir);
      if (parent === dir) return null; // the filesystem root — no config anywhere up the tree
      dir = parent;
      continue;
    }
    return candidate;
  }
}

/**
 * Read and parse the config at a path {@link configPathFor} already found —
 * the half {@link loadConfig} composes with the walk. Separated because the
 * CLI needs the discovery home and the entries from ONE walk, not two: it
 * resolves `file` scopes against the found config's directory, so it asks for
 * the path and the entries as one answer. A file deleted between discovery
 * and read is `null`, the same answer discovery would have given; any other
 * read failure, and any malformed content, throw exactly as in
 * {@link loadConfig} — things the user wrote and must hear about.
 */
export function readConfig(path: string): readonly SuppressionEntry[] | null {
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
 * Discover `themeguard.config.json` the way {@link configPathFor} walks — the
 * stylesheet's directory first, then each parent, bounded at the filesystem
 * root — and return the nearest one's suppression entries, or `null` when no
 * directory up the tree holds a config. Any other failure to read — a config
 * that exists but cannot be read — throws, as does any malformed content:
 * both are things the user wrote and must hear about.
 */
export function loadConfig(cssPath: string): readonly SuppressionEntry[] | null {
  const path = configPathFor(cssPath);
  return path === null ? null : readConfig(path);
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

  const allowed = ["rule", "token", "tokens", "theme", "file", "reason"];
  for (const key of Object.keys(item)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path,
        `${where}: unknown key "${key}" — expected "rule", "token", "tokens", "theme", "file", "reason". A key this package does not know would otherwise do nothing, silently.`,
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

  // The token dimension, in one of two spellings. Carrying both is an error
  // for the same reason an unknown key is: two spellings of one dimension is
  // an ambiguity, and an ambiguity this package honoured would suppress by
  // whichever reading happened to be implemented.
  const rawToken = item["token"];
  const rawTokens = item["tokens"];
  if (rawToken !== undefined && rawTokens !== undefined) {
    throw new ConfigError(
      path,
      `${where}: "token" and "tokens" are two spellings of one dimension — an entry carries one or the other, never both`,
    );
  }

  let token: string | undefined;
  let tokens: readonly string[] | undefined;
  if (rawToken !== undefined) {
    if (typeof rawToken !== "string" || rawToken.length === 0) {
      throw new ConfigError(
        path,
        `${where}: "token" must be a non-empty string naming the token the finding carries, got ${JSON.stringify(rawToken ?? null)}`,
      );
    }
    token = rawToken;
  } else if (rawTokens !== undefined) {
    if (!Array.isArray(rawTokens) || rawTokens.length === 0) {
      // The empty array is rejected outright, not merely typed: under the
      // matcher's "the finding carries every name listed" reading, an empty
      // list is carried by EVERY finding — an entry that would suppress
      // everything while looking like it named nothing.
      throw new ConfigError(
        path,
        `${where}: "tokens" must be a non-empty array of token names — an empty array would match every finding, silently suppressing what was never judged`,
      );
    }
    if (rawTokens.some((t) => typeof t !== "string" || t.length === 0)) {
      throw new ConfigError(
        path,
        `${where}: "tokens" members must each be a non-empty string naming one token the finding carries, got ${JSON.stringify(rawTokens)}`,
      );
    }
    tokens = rawTokens as readonly string[];
  } else {
    // Neither spelling — the same error the scalar-only schema raised, so a
    // pre-`tokens` config validates byte-identically; the sentence now names
    // the array form as the other way to satisfy the requirement.
    throw new ConfigError(
      path,
      `${where}: "token" must be a non-empty string naming the token the finding carries, got null — an entry carries "token" (one name) or "tokens" (the set)`,
    );
  }

  const theme = item["theme"];
  if (theme !== undefined && (typeof theme !== "string" || theme.length === 0)) {
    throw new ConfigError(
      path,
      `${where}: "theme" must be a non-empty string naming the theme the finding was measured in, got ${JSON.stringify(theme ?? null)}`,
    );
  }

  const file = item["file"];
  if (file !== undefined) {
    if (typeof file !== "string" || file.length === 0) {
      throw new ConfigError(
        path,
        `${where}: "file" must be a non-empty string naming the stylesheet the judgement was recorded against, relative to this config's directory, got ${JSON.stringify(file ?? null)}`,
      );
    }
    if (isAbsolute(file)) {
      // Absolute is rejected, not merely resolved: the field's meaning is
      // "the file this judgement is about", and that meaning has to survive
      // the config moving between checkouts. An absolute path would bind the
      // judgement to one machine's directory layout — the same config would
      // suppress on one checkout and report on another.
      throw new ConfigError(
        path,
        `${where}: "file" must be a path relative to this config's directory — an absolute path (${JSON.stringify(file)}) would make the same config mean different things from different checkouts`,
      );
    }
  }

  const reason = item["reason"];
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ConfigError(
      path,
      `${where}: "reason" must be a non-empty string — the report quotes it, and a deliberate finding without a stated why is a suppression waiting to be forgotten`,
    );
  }

  // Only the keys the user wrote are carried — absence IS the unscoped
  // reading the matcher tests for, so an entry is never padded with nulls or
  // empty shapes that a reader (or a future key) could mistake for a scope.
  return {
    rule: rule as RuleId,
    reason,
    ...(token !== undefined ? { token } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(file !== undefined ? { file } : {}),
  };
}
