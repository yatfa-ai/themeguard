/**
 * themeguard — the resolver, the maths, and the seven rules.
 *
 * Two stages, kept apart on purpose:
 *
 *   - `parse.ts` / `resolve.ts` / `color.ts` produce DATA. They report what a
 *     stylesheet contains and what each token resolves to per theme, and pass
 *     no judgement: nothing there decides that two tokens holding one colour is
 *     a defect, or that an unreferenced token is dead.
 *   - `audit.ts` and `rules/` JUDGE that data, as pure functions over
 *     `resolveStylesheet`'s output. {@link audit} is the entry point and
 *     answers all seven of the README's questions in one pass, returning
 *     findings tagged `collision`, `dead-token`, `scale-collapse`,
 *     `family-consistency`, `unresolved-reference`, `cycle-reference` or
 *     `duplicate-declaration`, plus the per-theme coverage inventory the fourth
 *     rule is measured over.
 *
 * ```ts
 * import { resolveCss, audit } from "themeguard";
 *
 * for (const finding of audit(resolveCss(css)).findings) {
 *   console.log(`[${finding.rule}] ${finding.message}`);
 * }
 * ```
 *
 * `resolveCss` audits TEXT — no base directory is known, so `@import`
 * statements are collected but not followed. A caller with a FILE — the usual
 * case, and the CLI's — loads the file's import closure instead, and the same
 * audit sees the one document CSS says the sheet is:
 *
 * ```ts
 * import { loadStylesheet, resolveStylesheet, audit } from "themeguard";
 *
 * const report = audit(resolveStylesheet(loadStylesheet("application.css")));
 * ```
 *
 * The same seven rules are also a command: `themeguard <file.css>` (see
 * `cli.ts`), which is I/O and presentation over exactly this `audit()` call and
 * adds no judgement of its own.
 */

export {
  audit,
  type AuditReport,
  type AuditOptions,
  type SuppressedFinding,
  type SiteScopedSuppressionEntry,
} from "./audit.js";

export type { SuppressionEntry } from "./config.js";

export {
  sortFindings,
  positionClause,
  siteFromToken,
  type Finding,
  type FindingSite,
  type RuleId,
} from "./rules/finding.js";

export { collisionRule } from "./rules/collision.js";
export { deadTokenRule } from "./rules/dead-token.js";
export { unresolvedReferenceRule } from "./rules/unresolved-reference.js";
export { cycleReferenceRule } from "./rules/cycle-reference.js";
export { duplicateDeclarationRule } from "./rules/duplicate-declaration.js";
export {
  scaleCollapseRule,
  VISIBLE_STEP_LSTAR,
  type ScaleCollapseResult,
  type SkippedPair,
} from "./rules/scale-collapse.js";
export {
  coverageReport,
  familyConsistencyRule,
  type CoverageEntry,
  type CoverageStatus,
  type ThemeCoverage,
} from "./rules/coverage.js";
export {
  TokenNames,
  STATE_SUFFIXES,
  type StatePair,
  type StateSuffix,
} from "./rules/tokens.js";

export {
  parseColor,
  fromHsl,
  rgba,
  over,
  relativeLuminance,
  lstar,
  deltaLstar,
  contrastRatio,
  isTranslucent,
  toHex,
  toCss,
  TranslucentColorError,
  type Color,
} from "./color.js";

export {
  parseStylesheet,
  type Declaration,
  type Reference,
  type Scope,
  type ScopeKind,
  type Stylesheet,
  type StylesheetImport,
} from "./parse.js";

export { loadStylesheet } from "./load.js";

export {
  resolveCss,
  resolveStylesheet,
  ROOT_THEME,
  type ResolvedStylesheet,
  type ResolvedToken,
  type ThemeAbsence,
  type TokenKind,
  type TokenOrigin,
  type ValueGroup,
} from "./resolve.js";
