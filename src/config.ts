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
 *
 * ── The policy axis: `suppress-rule` ──────────────────────────────────────
 * An entry judges ONE finding. Some judgements are about a RULE — "we have
 * looked at what `dead-token` says about THIS PROJECT and judged it
 * not-a-defect" — and no ledger of per-finding entries can say that: the
 * answer is wholesale, and writing it one entry at a time is one entry per
 * regeneration of every generated sheet the rule fires on. The optional
 * top-level `suppress-rule` key is that judgement: an array of rule ids, each
 * of which stops reporting into the findings and the counts for every
 * stylesheet this config governs, its findings moving instead to the report's
 * counted `suppressedDisabled` leg — printed by the CLI as its
 * `suppressed-disabled` section — under the same counted-not-silent
 * discipline as every other set-aside population. The key is the POLICY, not
 * a bigger entry: it names rules and nothing else, so it carries no reason
 * prose and no scope — a rule is on or off for the project, and the report
 * says which findings the policy took out. Validation is the same strict
 * discipline as `suppress`: the key must be an array, and every element must
 * be a rule id this package knows (the same {@link RULE_IDS} list an entry's
 * `rule` field validates against) — an unknown id is an ERROR naming the
 * element, because a policy the tool silently ignored is a user who believes
 * a rule was off when its findings were reported after all. An empty array is
 * legal and disables nothing; an absent key is byte-identical to the
 * one-key config this file has always parsed.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { RuleId } from "./rules/finding.js";

/** The file name, discovered at or above the stylesheet — nearest ancestor wins. */
export const CONFIG_FILENAME = "themeguard.config.json";

/**
 * Every rule id a suppression entry may name — and every rule id the
 * `suppress-rule` policy may turn off. ONE list is the single source of truth
 * for both spellings of "a rule this package knows", so a rule the entries
 * accept and a rule the policy accepts can never disagree.
 */
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
 * The whole document a config file declares: the suppression entries under
 * `suppress`, and the project-level rule policy under `suppress-rule`. ONE
 * read hands back both halves because the CLI needs them from one walk —
 * the entries to merge into the suppression list, the policy to hand the
 * audit alongside them — and a second read of the same file would be a
 * second place to disagree about what the file says.
 */
export interface ConfigDocument {
  /** The per-finding judgements, exactly as {@link parseConfig} returns them. */
  readonly suppress: readonly SuppressionEntry[];
  /**
   * The rule ids the project policy turned off — the `suppress-rule` key,
   * validated against the same rule-id list an entry's `rule` field names.
   * Empty when the key is absent or an empty array; the audit treats it as
   * the set of rules whose findings never reach the findings or the counts.
   */
  readonly disabledRules: readonly RuleId[];
}

/**
 * Read and parse the config at a path {@link configPathFor} already found —
 * the half {@link loadConfig} composes with the walk. Separated because the
 * CLI needs the discovery home and the document from ONE walk, not two: it
 * resolves `file` scopes against the found config's directory, so it asks for
 * the path and the whole document as one answer. A file deleted between
 * discovery and read is `null`, the same answer discovery would have given;
 * any other read failure, and any malformed content, throw exactly as in
 * {@link loadConfig} — things the user wrote and must hear about.
 */
export function readConfigDocument(path: string): ConfigDocument | null {
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

  return parseConfigDocument(raw, path);
}

/**
 * The config's suppression entries alone — the read the directive scanner and
 * entries-only callers use, projected from {@link readConfigDocument} so both
 * spellings parse the file exactly once, through the same validator, with the
 * same error contract. A file deleted between discovery and read is `null`,
 * the same answer discovery would have given.
 */
export function readConfig(path: string): readonly SuppressionEntry[] | null {
  return readConfigDocument(path)?.suppress ?? null;
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
 * Parse and validate config text into the whole document — both top-level
 * keys, each with the strict never-silently-ignored discipline. Pure — the
 * file read lives in {@link loadConfig} / {@link readConfigDocument} — so the
 * validation rules are testable as data.
 *
 * `suppress` validates exactly as it always has ({@link parseEntry}, per
 * entry). `suppress-rule` is the policy half: the key must be an array, and
 * every element must be one of the {@link RULE_IDS} — the SAME list an
 * entry's `rule` field validates against, so the two spellings of "a rule
 * this package knows" cannot drift apart. An unknown element is an ERROR
 * naming it, reusing the entry sentence's shape: a policy the tool silently
 * ignored is a user who believes a rule was off while its findings were
 * reported after all. An empty array is legal and disables nothing; a
 * duplicated id is harmless (the audit reads the policy as a set) and is not
 * an error, because it changes no meaning. Neither key is required: `{}` is
 * the config that governs nothing, byte-identical to no config at all.
 */
export function parseConfigDocument(raw: string, path: string): ConfigDocument {
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

  const allowed = ["suppress", "suppress-rule"];
  for (const key of Object.keys(parsed)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path,
        `unknown key "${key}" — expected "suppress" or "suppress-rule". A key this package does not know would otherwise do nothing, silently.`,
      );
    }
  }

  const suppress =
    parsed["suppress"] === undefined ? [] : parseSuppressList(parsed["suppress"], path);
  const disabledRules =
    parsed["suppress-rule"] === undefined
      ? []
      : parseDisabledRules(parsed["suppress-rule"], path);

  return { suppress, disabledRules };
}

/**
 * The config's suppression entries alone — the view the directive scanner
 * round-trips through (its rule-id validation is THIS file's, unexported, and
 * this function is its door) and entries-only callers use. The full document
 * parser is {@link parseConfigDocument}; this is its `suppress` half, with an
 * unchanged signature so every config written before the policy key existed
 * parses byte-identically.
 */
export function parseConfig(raw: string, path: string): readonly SuppressionEntry[] {
  return parseConfigDocument(raw, path).suppress;
}

/** `suppress`, with the array-shape gate it has always had. */
function parseSuppressList(value: unknown, path: string): readonly SuppressionEntry[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(
      path,
      `"suppress" must be an array of entries, got ${JSON.stringify(value)}`,
    );
  }
  return value.map((item, index) => parseEntry(item, index, path));
}

/**
 * `suppress-rule`, with the same shape gate and the same unknown-id sentence
 * the entries validate their `rule` field with: the canonical list is
 * {@link RULE_IDS}, and an element outside it exits 2 naming the element —
 * never a silent no-op policy.
 */
function parseDisabledRules(value: unknown, path: string): readonly RuleId[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(
      path,
      `"suppress-rule" must be an array of rule ids, got ${JSON.stringify(value)}`,
    );
  }
  return value.map((element, index) => {
    if (typeof element !== "string" || !RULE_IDS.includes(element as RuleId)) {
      throw new ConfigError(
        path,
        `element ${index + 1} of "suppress-rule": unknown rule ${JSON.stringify(
          element ?? null,
        )} — expected one of ${RULE_IDS.join(", ")}`,
      );
    }
    return element as RuleId;
  });
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
