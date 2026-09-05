/**
 * themeguard — the resolver, the maths, and the three rules.
 *
 * Two stages, kept apart on purpose:
 *
 *   - `parse.ts` / `resolve.ts` / `color.ts` produce DATA. They report what a
 *     stylesheet contains and what each token resolves to per theme, and pass
 *     no judgement: nothing there decides that two tokens holding one colour is
 *     a defect, or that an unreferenced token is dead.
 *   - `audit.ts` and `rules/` JUDGE that data, as pure functions over
 *     `resolveStylesheet`'s output. {@link audit} is the entry point and
 *     answers all three of the README's questions in one pass, returning
 *     findings tagged `collision`, `dead-token` or `scale-collapse`.
 *
 * ```ts
 * import { resolveCss, audit } from "themeguard";
 *
 * for (const finding of audit(resolveCss(css)).findings) {
 *   console.log(`[${finding.rule}] ${finding.message}`);
 * }
 * ```
 *
 * There is still no CLI and no entry point in the package manifest: this is a
 * library of functions, and running it from a terminal is a later stage.
 */

export {
  audit,
  type AuditReport,
} from "./audit.js";

export {
  sortFindings,
  type Finding,
  type RuleId,
} from "./rules/finding.js";

export { collisionRule } from "./rules/collision.js";
export { deadTokenRule } from "./rules/dead-token.js";
export {
  scaleCollapseRule,
  VISIBLE_STEP_LSTAR,
  type ScaleCollapseResult,
  type SkippedPair,
} from "./rules/scale-collapse.js";
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
} from "./parse.js";

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
