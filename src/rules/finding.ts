/**
 * The shape every rule reports in.
 *
 * One `Finding` is one thing a human should look at. It carries the tokens it
 * is about, the theme it was measured in, and — always — the MEASUREMENT that
 * produced it, so a reader can check the verdict rather than take it. A rule
 * that cannot say what it measured is not reporting a defect, it is asserting
 * one.
 */

/** Which of the three questions a finding answers. */
export type RuleId =
  /** Two token names that must differ hold byte-identical colours. */
  | "collision"
  /** A token is declared and referenced by no `var()` anywhere. */
  | "dead-token"
  /** Two tokens meant to read apart are closer than a visible step in L*. */
  | "scale-collapse";

export interface Finding {
  readonly rule: RuleId;
  /**
   * The theme the finding was measured in, or `null` for a finding that is not
   * theme-specific. A dead token is dead in the STYLESHEET, not in a theme.
   */
  readonly theme: string | null;
  /**
   * The tokens the finding is about, in the order the message reads them.
   * Always at least one.
   */
  readonly tokens: readonly string[];
  /** One line, naming the tokens and the measurement. */
  readonly message: string;
  /**
   * The numbers behind the verdict. Rule-specific by design — a collision has a
   * shared value and no distance, a scale collapse has a distance and no shared
   * value — so callers read the key their rule defines rather than a lowest
   * common denominator that fits neither.
   */
  readonly evidence: Readonly<Record<string, string | number | readonly string[]>>;
}

/** Sort into a stable reading order: rule, then theme, then tokens. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const order: Record<RuleId, number> = {
    collision: 0,
    "dead-token": 1,
    "scale-collapse": 2,
  };
  return [...findings].sort(
    (a, b) =>
      order[a.rule] - order[b.rule] ||
      (a.theme ?? "").localeCompare(b.theme ?? "") ||
      a.tokens.join(",").localeCompare(b.tokens.join(",")),
  );
}
