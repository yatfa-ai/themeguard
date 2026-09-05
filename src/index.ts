/**
 * themeguard — foundation stage.
 *
 * This module exports the RESOLVER and the MATH CORE only. There are no rules,
 * no CLI and no verdicts here: this stage produces the data a later stage will
 * judge.
 */

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
