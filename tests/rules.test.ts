import { describe, expect, it } from "vitest";
import { lstar, type Color } from "../src/color.js";
import { audit } from "../src/audit.js";
import { resolveCss, type ResolvedStylesheet } from "../src/resolve.js";
import { collisionRule } from "../src/rules/collision.js";
import { deadTokenRule } from "../src/rules/dead-token.js";
import { scaleCollapseRule, VISIBLE_STEP_LSTAR } from "../src/rules/scale-collapse.js";
import { TokenNames } from "../src/rules/tokens.js";
import { fixtureCss } from "./fixture.js";

const resolved: ResolvedStylesheet = resolveCss(fixtureCss());
const report = audit(resolved);
const tokensOf = (rule: string) =>
  report.findings.filter((f) => f.rule === rule).map((f) => f.tokens.join(" == "));

/**
 * FIXTURE CENSUS — the same discipline as `census.test.ts`: every count over the
 * vendored stylesheet is pinned exactly, so drift in the fixture or a widening
 * of a rule fails a test rather than passing silently.
 */
describe("rule 1 — value collision, over the vendored fixture", () => {
  const collisions = report.findings.filter((f) => f.rule === "collision");

  /**
   * ── RECONCILIATION WITH THE TICKET'S FIGURE, recorded rather than papered over
   *
   * YATFA-7215 asks for "exactly the two known dark-theme collisions". This rule
   * reports SIX in dark and eleven across both themes, and the two famous ones
   * are among them. The gap is a SCOPE difference, not a disagreement about what
   * a collision is, and three independent readings say the smaller figure is the
   * count of CITED EXAMPLES rather than a census:
   *
   *   1. The ticket enumerates five dark groups and calls that "the raw
   *      collision data". `collisionGroups("root")` actually returns 41. The
   *      other 36 are a token sitting with its own `@theme inline` alias, which
   *      this rule collapses (filter 1) — so the ticket's five is already a
   *      hand-picked subset, and "two of five" is the judgement it is really
   *      describing. That reading is pinned exactly, below.
   *   2. The package's own README says this palette's "collisions went 0 → 7",
   *      which contradicts two as a total as plainly as this rule does.
   *   3. Every extra is a genuine instance of the stated definition — distinct
   *      roles, distinct families, holding one value here and different values
   *      in the other theme — and each is named below so the claim is checkable
   *      rather than asserted.
   *
   * Pinning six would have meant narrowing the rule until the fixture produced a
   * number, which is the opposite of calibrating against it.
   */
  it("reports exactly the two DEFECT groups among the five the ticket enumerates", () => {
    // This is the ticket's real test, and the discrimination the fixture asks
    // for: "--app-warning and --app-warning-border sharing a value is
    // deliberate, and --app-border sharing one with --app-surface-raised is the
    // famous defect. Telling those apart is rule 1's job."
    const enumerated = ["#1E293B", "#22C55E", "#F59E0B", "#EF4444", "#3B82F6"];
    const reported = collisions
      .filter((f) => f.theme === "root" && enumerated.includes(f.evidence.value as string))
      .map((f) => `${f.evidence.value as string} ${f.tokens.join(" == ")}`);
    expect(reported.sort()).toEqual([
      "#1E293B --app-border == --app-surface-raised",
      "#22C55E --app-cta == --app-success",
    ]);
  });

  it("names the two famous instances the README and the fixture README both cite", () => {
    expect(tokensOf("collision")).toContain("--app-border == --app-surface-raised");
    expect(tokensOf("collision")).toContain("--app-cta == --app-success");
  });

  it("finds 6 collisions in dark and 5 in winter — the full census, each one named", () => {
    const named = collisions.map((f) => `${f.theme} ${f.evidence.value as string} ${f.tokens.join(" == ")}`);
    expect(named.sort()).toEqual([
      // The two famous ones.
      "root #1E293B --app-border == --app-surface-raised",
      "root #22C55E --app-cta == --app-success",
      // A page background doubling as the label colour printed ON solid fills.
      "root #020617 --app-background == --app-solid-label",
      // The CTA's solid-hover equal to the success on-surface ink; they differ
      // in winter (#4ADE80 vs #15803D), so they are not one value.
      "root #4ADE80 --app-cta-solid-hover == --app-success-on-surface",
      // The brand colour equal to the surface it is painted on.
      "root #0F172A --app-primary == --app-surface",
      // Documented as DELIBERATE in the fixture (:20-27 — "#29364D is the value
      // this theme already uses for --app-surface-active, so the two surface-step
      // tones stay coherent"). Reported anyway, and honestly: the justification
      // is prose in a comment, carrying no machine-readable signal, and the two
      // are separate roles that diverge in winter. A rule that stayed silent here
      // could only do so by recognising this one stylesheet's comments.
      "root #29364D --app-secondary == --app-surface-active",
      "winter #15803D --app-cta-hover == --app-success-on-surface",
      "winter #475569 --app-neutral-on-surface == --app-text-secondary",
      "winter #CBD5E1 --app-panel-border == --app-secondary",
      "winter #E2E8F0 --app-border == --app-primary == --app-surface-active",
      "winter #F1F5F9 --app-neutral-surface == --app-surface-raised",
    ].sort());
    expect(report.countsByRule.collision).toBe(11);
  });

  // REVERT PROBE — delete filter 3 (the family check) in collision.ts and this
  // fails: all four semantic↔`-border` twins are reported, which is success
  // criterion 3's protected region.
  it("reports ZERO findings for the deliberate semantic↔-border twins", () => {
    for (const tone of ["warning", "error", "info", "success"]) {
      const twin = collisions.filter(
        (f) => f.tokens.includes(`--app-${tone}`) && f.tokens.includes(`--app-${tone}-border`),
      );
      expect(twin).toEqual([]);
    }
  });

  // REVERT PROBE — delete filter 1 (alias collapse) in collision.ts and the
  // `an alias is not a collision with what it aliases` test below fails.
  //
  // ⚠️ MEASURED, and narrower than it looks: over THIS fixture filter 1 changes
  // no count at all, because every one of its 64 aliases is also in lockstep
  // with its target (the alias is theme-independent and its target's value is
  // the only thing that moves), so filter 2 already removes each one. The two
  // filters overlap almost completely here. Filter 1 is still load-bearing —
  // filter 2 cannot cover an alias whose value DIVERGES in some theme — but the
  // fixture contains no such alias, so that case is exercised by a hand-written
  // stylesheet rather than claimed of this one.
  it("never reports an @theme inline alias as colliding with the token it aliases", () => {
    const names = new TokenNames(resolved);
    for (const f of collisions) {
      expect(f.tokens.some((t) => names.isAlias(t))).toBe(false);
    }
  });

  it("does not report an alias as a collision even when it is NOT in lockstep", () => {
    // The case filter 1 exists for, and the one the fixture cannot show. Here
    // `--panel` is WRITTEN as `var(--brand)` in `:root` and overridden with an
    // independent value in `night`, so the two are not in lockstep and filter 2
    // keeps them — but in `:root` `--panel` IS `--brand`, resolved through it,
    // and reporting a name as colliding with the token it is defined as is
    // reporting that a thing equals itself.
    const aliased = collisionRule(
      resolveCss(
        `:root { --brand: #3366CC; --panel: var(--brand); }
         [data-theme="night"] { --brand: #99BBFF; --panel: #223344; }
         .x { color: var(--brand); background: var(--panel); }`,
      ),
    );
    expect(aliased).toEqual([]);
  });

  // REVERT PROBE — delete filter 2 (lockstep classes) and this fails:
  // --app-border-focus is reported against --app-cta, which the fixture calls
  // deliberate at :196 ("the kit unifies the focus technique, it does not change
  // the focus color") and which holds in BOTH themes.
  it("does not report a pair that holds the same value in EVERY theme", () => {
    const focus = collisions.filter(
      (f) => f.tokens.includes("--app-border-focus") && f.tokens.includes("--app-cta"),
    );
    expect(focus).toEqual([]);
    // The lockstep class is still reported as evidence, so the relationship is
    // visible rather than hidden by the filter.
    const cta = collisions.find((f) => f.tokens.join() === "--app-cta,--app-success");
    expect(cta?.evidence.lockstepClasses).toContain(
      "--app-border-focus == --app-cta == --app-success-border",
    );
  });

  it("carries the shared value and the group's full membership as evidence", () => {
    const border = collisions.find(
      (f) => f.tokens.join() === "--app-border,--app-surface-raised",
    );
    expect(border?.theme).toBe("root");
    expect(border?.evidence.value).toBe("#1E293B");
    expect(border?.evidence.groupMembers).toEqual([
      "--app-border",
      "--app-surface-raised",
      "--color-app-border",
      "--color-app-surface-raised",
    ]);
    expect(border?.message).toContain("#1E293B");
  });
});

describe("rule 2 — dead token, over the vendored fixture", () => {
  it("reports EXACTLY the two genuinely dead tokens", () => {
    expect(tokensOf("dead-token")).toEqual(["--topbar-height", "--transition-slow"]);
    expect(report.countsByRule["dead-token"]).toBe(2);
  });

  // REVERT PROBE — stop excluding the `theme-inline` scope from the judged
  // population in dead-token.ts and this fails: the census becomes 66, because
  // all 64 aliases are declared and referenced by nothing IN THIS FILE (their
  // consumers are the utility classes Tailwind generates from them).
  it("does not report the 64 @theme inline aliases, whose consumers are generated", () => {
    const naive = new Set<string>();
    const referenced = new Set(resolved.stylesheet.references.map((r) => r.name));
    for (const scope of resolved.stylesheet.scopes) {
      for (const d of scope.declarations) if (!referenced.has(d.name)) naive.add(d.name);
    }
    // The unfiltered question really does return 66 — the rule is the filtering.
    expect(naive.size).toBe(66);
    expect(report.countsByRule["dead-token"]).toBe(2);
  });

  // REVERT PROBE — collect references from custom-property values only (i.e.
  // drop the non-custom-property half of `readReferences`) and this fails:
  // these four are used ONLY by ordinary properties, so the census becomes 9.
  it("counts a use by an ORDINARY property, not only by another token", () => {
    const dead = new Set(tokensOf("dead-token"));
    for (const [name, property] of [
      ["--font-family", "font-family"],
      ["--sidebar-width", "width"],
      ["--app-focus-ring-width", "outline"],
      ["--app-focus-ring-offset", "outline-offset"],
    ] as const) {
      expect(dead.has(name)).toBe(false);
      expect(
        resolved.stylesheet.references.some((r) => r.name === name && r.property === property),
      ).toBe(true);
    }
  });

  it("reports a dead token once, with every declaration site, and no theme", () => {
    const topbar = report.findings.find((f) => f.tokens.join() === "--topbar-height");
    expect(topbar?.theme).toBeNull();
    expect(topbar?.evidence.declaredIn).toEqual([":root:402"]);
    expect(topbar?.evidence.referenceCount).toBe(0);
  });

  it("reports ZERO findings for the 22 theme-independent :root tokens", () => {
    // Criterion 3's protected region: a token with no winter override is a
    // documented design decision, and 20 of the 22 are referenced somewhere.
    const absences = resolved.absences.filter((a) => a.theme === "winter");
    expect(absences).toHaveLength(22);
    const dead = new Set(tokensOf("dead-token"));
    const flagged = absences.filter((a) => dead.has(a.name)).map((a) => a.name);
    // The only two that ARE flagged are flagged for being unreferenced, which is
    // a different fact about them — and both are genuinely dead.
    expect(flagged.sort()).toEqual(["--topbar-height", "--transition-slow"]);
  });
});

describe("rule 3 — scale collapse, over the vendored fixture", () => {
  it("reports EXACTLY the one collapsed state pair, in both themes", () => {
    expect(tokensOf("scale-collapse")).toEqual([
      "--app-accent-ink == --app-accent-ink-hover",
      "--app-accent-ink == --app-accent-ink-hover",
    ]);
    expect(report.countsByRule["scale-collapse"]).toBe(2);
    const [dark, winter] = report.findings.filter((f) => f.rule === "scale-collapse");
    expect(dark.theme).toBe("root");
    expect(dark.evidence.deltaLstar).toBe(3.9);
    expect(winter.theme).toBe("winter");
    expect(winter.evidence.deltaLstar).toBe(3.45);
  });

  it("measures the pair the FIXTURE ITSELF measured, to the hundredth", () => {
    // The stylesheet is its own oracle: ":346 dL* +3.90 here" for dark, and
    // ":534 dL* +3.45" for winter. Reproducing those exactly is what says the
    // rule is measuring the thing the author measured.
    const dark = report.findings.find(
      (f) => f.rule === "scale-collapse" && f.theme === "root",
    );
    expect(dark?.evidence.deltaLstar).toBe(3.9);
    expect(dark?.evidence.baseLstar).toBe(66.32);
    expect(dark?.evidence.stateLstar).toBe(70.23);
  });

  // REVERT PROBE — derive pairs by sorting a family by L* and pairing
  // neighbours (the alternative the module docstring rejects) and this fails:
  // that derivation manufactures --app-surface-hover ↔ --app-surface-raised at
  // ΔL* 2.18, which the fixture explicitly denies is a pair (:129-148).
  it("does not pair two tokens that are never painted against each other", () => {
    const surfaces = report.findings.filter(
      (f) =>
        f.rule === "scale-collapse" &&
        f.tokens.includes("--app-surface-hover") &&
        f.tokens.includes("--app-surface-raised"),
    );
    expect(surfaces).toEqual([]);
  });

  it("measures the REJECTED derivation, so the choice is evidence and not preference", () => {
    // Sorted-by-L* adjacency within a family, run over the same fixture. This
    // is not a hypothetical: it is the alternative the ticket names, computed
    // here so the docstring's two objections are checkable numbers rather than
    // an argument. It returns 25 findings to state pairing's 2, and among them
    // are ALL FOUR of the deliberate semantic↔`-border` twins that success
    // criterion 3 protects — so adopting it would fail this suite elsewhere.
    const names = new TokenNames(resolved);
    const sortedAdjacency: string[] = [];
    for (const theme of resolved.themes) {
      const families = new Map<string, string[]>();
      for (const t of resolved.tokensFor(theme)) {
        if (t.kind !== "color" || t.translucent || names.isAlias(t.name)) continue;
        const head = names.head(t.name);
        families.set(head, [...(families.get(head) ?? []), t.name]);
      }
      for (const members of families.values()) {
        if (members.length < 2) continue;
        const ladder = members
          .map((name) => ({ name, l: lstar(resolved.token(name, theme)?.color as Color) }))
          .sort((a, b) => a.l - b.l);
        for (let i = 1; i < ladder.length; i += 1) {
          if (ladder[i].l - ladder[i - 1].l < VISIBLE_STEP_LSTAR) {
            sortedAdjacency.push(`${theme} ${ladder[i - 1].name}~${ladder[i].name}`);
          }
        }
      }
    }
    expect(sortedAdjacency).toHaveLength(25);
    // Objection 1 — it manufactures the pair the fixture denies (:129-148).
    expect(sortedAdjacency).toContain("root --app-surface-hover~--app-surface-raised");
    // Objection 2 — it fires on every deliberate semantic↔`-border` twin.
    for (const tone of ["success", "warning", "error", "info"]) {
      expect(sortedAdjacency).toContain(`root --app-${tone}~--app-${tone}-border`);
    }
    // State pairing reaches none of them.
    expect(report.countsByRule["scale-collapse"]).toBe(2);
  });

  it("reports ZERO findings for the fixture's documented healthy steps", () => {
    // Criterion 3's third protected region — the ≥4 steps the fixture records:
    // +6.25 (surface→hover), +6.07 (raised→active, via secondary) and −11.49.
    const collapsed = new Set(
      report.findings.filter((f) => f.rule === "scale-collapse").map((f) => f.tokens.join()),
    );
    for (const pair of [
      "--app-surface,--app-surface-hover",
      "--app-surface,--app-surface-active",
      "--app-cta,--app-cta-hover",
      "--app-error,--app-error-hover",
      "--app-warning,--app-warning-hover",
      "--app-border,--app-border-hover",
    ]) {
      expect(collapsed.has(pair)).toBe(false);
    }
  });

  it("judges 10 state pairs per theme and skips none of the fixture's", () => {
    const names = new TokenNames(resolved);
    const pairs = names.statePairs().filter((p) => !names.isAlias(p.base) && !names.isAlias(p.state));
    expect(pairs).toHaveLength(10);
    // No fixture pair is translucent or non-colour, so nothing is skipped here —
    // asserted rather than assumed, since a silent skip reads exactly like a pass.
    expect(report.skipped).toEqual([]);
  });
});

describe("rule 3 — translucency is never composited against an invented backdrop", () => {
  // The package rule, enforced at the rule layer rather than only in color.ts:
  // `lstar` THROWS on alpha < 1, so a rule that did not skip would crash rather
  // than mis-measure — and one that composited would be inventing a backdrop.
  const css = `:root {
    --scrim: rgba(2, 6, 23, 0.72);
    --scrim-hover: rgba(2, 6, 23, 0.80);
    --panel: #0F172A;
    --panel-hover: #101A2C;
    --gap: 4px;
    --gap-hover: 8px;
  }`;
  const sheet = resolveCss(css);
  const result = scaleCollapseRule(sheet);

  it("skips a translucent pair and SAYS it skipped it", () => {
    expect(result.skipped).toContainEqual({
      theme: "root",
      base: "--scrim",
      state: "--scrim-hover",
      reason: "translucent",
    });
  });

  it("skips a non-colour pair for a different, named reason", () => {
    expect(result.skipped).toContainEqual({
      theme: "root",
      base: "--gap",
      state: "--gap-hover",
      reason: "not-a-color",
    });
  });

  it("still judges the opaque pair in the same stylesheet", () => {
    expect(result.findings.map((f) => f.tokens.join())).toEqual(["--panel,--panel-hover"]);
    expect(result.findings[0].evidence.threshold).toBe(VISIBLE_STEP_LSTAR);
  });
});

describe("the rules are yatfa-agnostic — a hand-written stylesheet, no --app- prefix", () => {
  // themeguard is not a yatfa-specific tool. Nothing in the three rules may key
  // off this fixture's vocabulary; the structure is read from the declarations.
  const css = `
    :root {
      --brand: #3366CC;
      --brand-hover: #3568CE;
      --panel: #3366CC;
      --unused: #ABCDEF;
      --ink: #111111;
    }
    [data-theme="night"] { --brand: #99BBFF; --panel: #223344; --ink: #EEEEEE; }
    .btn { background: var(--brand); color: var(--ink); }
    .btn:hover { background: var(--brand-hover); }
    .panel { background: var(--panel); }
  `;
  const result = audit(resolveCss(css));

  it("finds the collision between two roles that diverge in the other theme", () => {
    const collisions = result.findings.filter((f) => f.rule === "collision");
    expect(collisions.map((f) => f.tokens.join(" == "))).toEqual(["--brand == --panel"]);
    expect(collisions[0].theme).toBe("root");
  });

  it("finds the dead token, and does not call a referenced one dead", () => {
    expect(result.findings.filter((f) => f.rule === "dead-token").map((f) => f.tokens[0])).toEqual([
      "--unused",
    ]);
  });

  it("finds the collapsed state pair by the same naming convention", () => {
    const scale = result.findings.filter((f) => f.rule === "scale-collapse");
    expect(scale.map((f) => f.tokens.join(" == "))).toEqual(["--brand == --brand-hover"]);
    expect(Math.abs(scale[0].evidence.deltaLstar as number)).toBeLessThan(4);
  });

  it("says nothing about a numeric ladder, which declares no pairing", () => {
    // The stated limit of the state-pair derivation, asserted rather than
    // promised: silence here is honest, and a sorted-adjacency rule would give a
    // confident answer with nothing behind it.
    const ladder = audit(
      resolveCss(":root { --gray-100: #F1F1F1; --gray-200: #EFEFEF; --x: var(--gray-100) }"),
    );
    expect(ladder.countsByRule["scale-collapse"]).toBe(0);
  });
});

describe("the audit entry point", () => {
  it("reports every rule id, including the ones with no findings", () => {
    const empty = audit(resolveCss(":root { --a: #FFFFFF; --b: var(--a); }"));
    expect(Object.keys(empty.countsByRule).sort()).toEqual([
      "collision",
      "dead-token",
      "scale-collapse",
    ]);
    expect(empty.countsByRule.collision).toBe(0);
  });

  it("totals its per-rule counts exactly", () => {
    const total = Object.values(report.countsByRule).reduce((a, b) => a + b, 0);
    expect(report.findings).toHaveLength(total);
    expect(total).toBe(15);
  });

  it("sorts findings into a stable rule → theme → tokens order", () => {
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toEqual([...rules].sort((a, b) => {
      const order = { collision: 0, "dead-token": 1, "scale-collapse": 2 } as const;
      return order[a] - order[b];
    }));
  });

  it("gives every finding a message naming its own tokens", () => {
    for (const f of report.findings) {
      expect(f.tokens.length).toBeGreaterThan(0);
      for (const token of f.tokens) expect(f.message).toContain(token);
    }
  });

  it("is a pure function — running it twice gives an identical report", () => {
    expect(JSON.stringify(audit(resolveCss(fixtureCss())))).toBe(JSON.stringify(report));
  });

  it("runs each rule independently of the others", () => {
    const names = new TokenNames(resolved);
    expect(collisionRule(resolved, names)).toHaveLength(11);
    expect(deadTokenRule(resolved, names)).toHaveLength(2);
    expect(scaleCollapseRule(resolved, names).findings).toHaveLength(2);
  });
});
