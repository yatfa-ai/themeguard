import { describe, expect, it } from "vitest";
import { lstar, type Color } from "../src/color.js";
import { audit } from "../src/audit.js";
import { resolveCss, type ResolvedStylesheet } from "../src/resolve.js";
import {
  coverageReport,
  familyConsistencyRule,
} from "../src/rules/coverage.js";
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
  // the focus color") and which BOTH themes declare equal in their own right.
  it("does not report a pair a second theme independently re-declares equal", () => {
    // Both names are `declared` (not inherited) in winter as well as root, and
    // equal in both — the author restating the equality, which is filter 2's
    // positive evidence of intent.
    for (const t of ["root", "winter"]) {
      for (const n of ["--app-border-focus", "--app-cta"]) {
        expect(resolved.token(n, t)?.origin).toBe("declared");
      }
    }
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

  // Every one of the fixture's 11 findings has real cross-theme proof: the
  // other theme resolves the roles apart. That is why the ticket's premise —
  // "they differ in another theme" — held for this stylesheet and why the
  // vacuous-truth defect could hide behind it. Pinned so a finding that is
  // reported WITHOUT that proof shows up as a change in this fixture rather
  // than blending into the count.
  it("has cross-theme proof for every collision it reports here", () => {
    expect(collisions.map((f) => f.evidence.corroboration)).toEqual(
      collisions.map((f) => (f.theme === "root" ? 'divergent in "winter"' : 'divergent in "root"')),
    );
    expect(collisions).toHaveLength(11);
  });

  it("carries the shared value and the group's full membership as evidence", () => {    const border = collisions.find(
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

/**
 * ── THE CASE THE CALIBRATION FIXTURE STRUCTURALLY CANNOT REACH ───────────────
 *
 * Everything above is measured against one stylesheet with two themes that both
 * override the famous pair. A suite pinned entirely to that fixture proves the
 * rule agrees with that fixture — not that the rule is correct — and filter 2
 * is exactly where the difference bites: its evidence of deliberateness is a
 * SECOND THEME saying something, and a stylesheet where no second theme says
 * anything is invisible to every assertion above.
 *
 * These are hand-written for that reason. Each one is a stylesheet the fixture
 * cannot be, and the first is this package's own headline example.
 */
describe("rule 1 — where the other themes say nothing (hand-written)", () => {
  const only = (css: string) => collisionRule(resolveCss(css));

  // REGRESSION — this returned ZERO findings until the corroboration fix.
  // `themes.every(...)` over a one-element array is vacuously true, so every
  // pair read as deliberate, every group collapsed to one lockstep class, and
  // the rule went silent on the defect the package was built around. It failed
  // as a CLEAN REPORT, which reads as a pass.
  it("reports the README's own defect on a :root-only stylesheet", () => {
    const findings = only(
      `:root { --app-surface-raised: #1E293B; --app-border: #1E293B; }
       .panel { background: var(--app-surface-raised); border: 1px solid var(--app-border); }`,
    );
    expect(findings.map((f) => f.tokens.join(" == "))).toEqual([
      "--app-border == --app-surface-raised",
    ]);
    expect(findings[0]?.evidence.corroboration).toBe("unwitnessed");
    // The message must not claim a divergence that was never observed.
    expect(findings[0]?.message).toContain("no other theme declares them apart");
  });

  // The general form of the same defect, and the reason the fix is not just a
  // `themes.length > 1` guard: the pair is declared ONCE in `:root` and
  // inherited by every theme, so it never diverges no matter how many themes
  // exist. Counting themes would still call this deliberate.
  it("reports a pair declared once in :root when a second theme only inherits it", () => {
    const findings = only(
      `:root { --app-surface-raised: #1E293B; --app-border: #1E293B; --ink: #FFF; }
       [data-theme="light"] { --ink: #000; }
       .panel { background: var(--app-surface-raised); border: 1px solid var(--app-border); color: var(--ink); }`,
    );
    // Reported ONCE, in the theme that DECLARES the pair — not once per theme
    // that inherits it. `light` carries the same colliding group (the resolver
    // reports it there too), but root declaring both names equal is
    // corroboration as far as `light` is concerned, so the inherited copy
    // collapses. One defect, written in one place, reported in that place.
    expect(findings.map((f) => `${f.theme} ${f.tokens.join(" == ")}`)).toEqual([
      "root --app-border == --app-surface-raised",
    ]);
    expect(resolveCss(
      `:root { --app-surface-raised: #1E293B; --app-border: #1E293B; --ink: #FFF; }
       [data-theme="light"] { --ink: #000; }
       .panel { background: var(--app-surface-raised); border: 1px solid var(--app-border); color: var(--ink); }`,
    ).collisionGroups("light")).toHaveLength(1);
    // Inheriting a value is `:root` being read again, not a second statement
    // about the pair, so there is still nothing corroborating the equality.
    expect(findings[0]?.evidence.corroboration).toBe("unwitnessed");
  });

  // The other side of the same predicate: filter 2 must still hold when the
  // evidence genuinely exists, or the fix would simply be "report everything".
  it("stays silent when a second theme DECLARES the pair equal again", () => {
    expect(
      only(
        `:root { --focus: #22C55E; --cta: #22C55E; }
         [data-theme="w"] { --focus: #16A34A; --cta: #16A34A; }
         .x { outline: var(--focus); background: var(--cta); }`,
      ),
    ).toEqual([]);
  });

  it("reports, and says so, when a second theme declares the pair apart", () => {
    const findings = only(
      `:root { --focus: #22C55E; --cta: #22C55E; }
       [data-theme="w"] { --focus: #16A34A; --cta: #DD0000; }
       .x { outline: var(--focus); background: var(--cta); }`,
    );
    expect(findings.map((f) => `${f.theme} ${f.tokens.join(" == ")}`)).toEqual([
      "root --cta == --focus",
    ]);
    expect(findings[0]?.evidence.corroboration).toBe('divergent in "w"');
    expect(findings[0]?.message).toContain('theme "w" declares them apart');
  });

  // The cost of choosing this direction, stated rather than hidden: a pair that
  // really is deliberate but is only ever written once is reported. That is the
  // deliberate trade — a false positive a reader can dismiss, in exchange for
  // not going silent on the defect class the package exists to find — and it is
  // pinned here so a future change that flips the trade fails a test.
  it("ACCEPTED FALSE POSITIVE: a deliberate identity written only once is reported", () => {
    const findings = only(
      `:root { --focus: #22C55E; --cta: #22C55E; }
       .x { outline: var(--focus); background: var(--cta); }`,
    );
    expect(findings.map((f) => f.tokens.join(" == "))).toEqual(["--cta == --focus"]);
    expect(findings[0]?.evidence.corroboration).toBe("unwitnessed");
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

/**
 * Rule 4 — FAMILY CONSISTENCY, over the vendored fixture. The fixture's winter
 * theme inherits 22 of the 73 base tokens; exactly 7 of them sit in families
 * winter itself tunes, and those — and only those — are findings. The same
 * stylesheet is also the home of the edge the predicate exists for:
 * `--app-solid-label`, inherited, whose prefix neighbours are overridden but
 * whose family head (`--app-solid`) is never declared.
 */
describe("rule 4 — family consistency, over the vendored fixture", () => {
  const family = report.findings.filter((f) => f.rule === "family-consistency");

  it("reports EXACTLY the seven mixed-family tokens, in winter, and no others", () => {
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`).sort()).toEqual([
      "winter --app-cta-solid-hover",
      "winter --app-error",
      "winter --app-error-solid-hover",
      "winter --app-info",
      "winter --app-success",
      "winter --app-warning",
      "winter --app-warning-solid-hover",
    ]);
    expect(report.countsByRule["family-consistency"]).toBe(7);
  });

  it("cites every overridden member of the family, and carries both readings of the value", () => {
    const success = family.find((f) => f.tokens[0] === "--app-success");
    expect(success?.theme).toBe("winter");
    expect(success?.evidence.familyHead).toBe("--app-success");
    expect(success?.evidence.overriddenSiblings).toEqual([
      "--app-success-border",
      "--app-success-on-surface",
      "--app-success-soft",
      "--app-success-surface",
      "--app-success-toast-surface",
    ]);
    // What :root writes and what winter receives — the same here, both carried,
    // because they need not be (a var() at :root resolves per theme).
    expect(success?.evidence.inheritedValue).toBe("#22C55E");
    expect(success?.evidence.resolvedValue).toBe("#22C55E");
    // The message names the token, the value and the evidence.
    expect(success?.message).toContain("--app-success");
    expect(success?.message).toContain("#22C55E");
    expect(success?.message).toContain("--app-success-border");
  });

  it("derives a transitively-headed member's family through its declared parent", () => {
    // --app-cta-solid-hover's shortest declared prefix is --app-cta-solid, whose
    // own head is --app-cta — so the family is cta's, not solid's, and the
    // siblings are the cta tokens winter declares. The inherited member is
    // never cited as its own sibling.
    const cta = family.find((f) => f.tokens[0] === "--app-cta-solid-hover");
    expect(cta?.evidence.familyHead).toBe("--app-cta");
    expect(cta?.evidence.overriddenSiblings).toEqual(["--app-cta", "--app-cta-hover"]);
  });

  it("does NOT report --app-solid-label — its family head --app-solid is undeclared", () => {
    // THE EDGE THE PREDICATE EXISTS FOR. --app-solid-label is inherited by
    // winter, but the stylesheet never declares --app-solid (or any other
    // member of an --app-solid family), so the label is its own head and the
    // correct answer is the listing, not a finding: the declarations say
    // nothing about a family there. (The sharper trap — an OVERRIDDEN prefix
    // neighbour in a family whose head is undeclared — is the hand-written
    // --ink-label case below; the live stylesheet this fixture calibrates for
    // contains exactly that shape.) The correct finding set is 7, not 8.
    expect(resolved.token("--app-solid-label", "winter")?.origin).toBe("inherited");
    const names = new TokenNames(resolved);
    expect(names.head("--app-solid-label")).toBe("--app-solid-label");
    // No sibling EXISTS: the only --app-solid* name the stylesheet declares is
    // the label itself (its alias aside).
    const solidNames = [...names.declared].filter((n) => n.startsWith("--app-solid"));
    expect(solidNames).toEqual(["--app-solid-label"]);
    expect(family.some((f) => f.tokens.includes("--app-solid-label"))).toBe(false);
  });

  // REVERT PROBE — drop the sibling requirement (report every inherited token,
  // or report on a shared prefix alone) and this fails: the theme-independent
  // layout vocabulary becomes 14 findings the stylesheet never asked for.
  it("reports ZERO findings for the wholly-inherited families — listing, not judgement", () => {
    const wholly = [
      "--app-focus-ring-width",
      "--app-focus-ring-offset",
      "--app-control-h-sm",
      "--app-control-h-md",
      "--app-control-h-lg",
      "--app-radius-control",
      "--app-radius-pill",
      "--sidebar-width",
      "--sidebar-collapsed-width",
      "--topbar-height",
      "--transition-fast",
      "--transition-normal",
      "--transition-slow",
      "--font-family",
    ];
    for (const name of wholly) {
      expect(resolved.absences.some((a) => a.theme === "winter" && a.name === name)).toBe(true);
      expect(family.some((f) => f.tokens.includes(name))).toBe(false);
    }
    // 7 findings + 14 wholly-inherited + 1 undeclared-head = the 22 absences,
    // so the census closes without a gap.
    expect(wholly).toHaveLength(14);
  });

  it("never cites an @theme inline alias as evidence", () => {
    const names = new TokenNames(resolved);
    for (const f of family) {
      for (const sibling of f.evidence.overriddenSiblings as readonly string[]) {
        expect(names.isAlias(sibling)).toBe(false);
      }
    }
  });
});

/**
 * ── THE SHAPES THE FIXTURE CANNOT ISOLATE ────────────────────────────────────
 *
 * The fixture's 22 absences happen to hold every interesting case, but they
 * arrive tangled together. These hand-written stylesheets hold one case each,
 * so the predicate's parts can fail one at a time rather than blending into a
 * count — the same discipline rule 1's hand-written suite follows.
 */
describe("rule 4 — where the fixture cannot reach it (hand-written)", () => {
  // REVERT PROBE — make the predicate "inherited" simpliciter and this fails:
  // four findings for a theme that says nothing about anything.
  it("reports NOTHING when a theme inherits a family whole — the listing is the answer", () => {
    const css = `
      :root {
        --ctl: #101010;
        --ctl-sm: 32px;
        --ctl-lg: 48px;
        --radius-control: 8px;
      }
      [data-theme="night"] { --ink: #EEEEEE; }
      .box { height: var(--ctl-sm); border-radius: var(--radius-control); }
    `;
    const sheet = audit(resolveCss(css));
    expect(sheet.countsByRule["family-consistency"]).toBe(0);
    // The facts stay on the record: night inherits every base token, and
    // coverage names each one.
    const night = sheet.coverage.find((t) => t.theme === "night");
    expect(night?.overridden).toEqual([]);
    expect(night?.inherited.map((e) => e.name)).toEqual([
      "--ctl",
      "--ctl-lg",
      "--ctl-sm",
      "--radius-control",
    ]);
  });

  it("reports the mixed shape on a plain vocabulary, citing the siblings", () => {
    const css = `
      :root {
        --brand: #3366CC;
        --brand-soft: rgba(51, 102, 204, 0.15);
        --brand-border: #99BBFF;
        --brand-hover: #3568CE;
      }
      [data-theme="night"] {
        --brand-soft: rgba(153, 187, 255, 0.12);
        --brand-border: #223344;
        --brand-hover: #4477DD;
      }
      .btn { background: var(--brand); border: 1px solid var(--brand-border); }
      .btn:hover { background: var(--brand-hover); }
    `;
    const resolved = resolveCss(css);
    const sheet = audit(resolved);
    // The whole family tuned EXCEPT the base: night really does receive root's
    // #3366CC for --brand while every sibling moved.
    expect(resolved.token("--brand", "night")?.resolvedValue).toBe("#3366CC");
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --brand"]);
    expect(family[0]?.evidence.familyHead).toBe("--brand");
    expect(family[0]?.evidence.overriddenSiblings).toEqual([
      "--brand-border",
      "--brand-hover",
      "--brand-soft",
    ]);
    expect(family[0]?.evidence.inheritedValue).toBe("#3366CC");
  });

  it("does NOT fire across an undeclared family head — and proves the stylesheet CAN fire", () => {
    // --ink-label is inherited by night; --ink-hover is overridden by night and
    // shares a prefix. But --ink is never declared, so each is its own head —
    // different families, no evidence, no finding. The --tone family in the
    // same stylesheet IS mixed, so the empty result for --ink-label is a
    // discrimination and not a stylesheet the rule never fires on.
    const css = `
      :root {
        --ink-label: #020617;
        --ink-hover: #101010;
        --tone: #22C55E;
        --tone-border: #16A34A;
      }
      [data-theme="night"] { --ink-hover: #EEEEEE; --tone-border: #86EFAC; }
      .x { color: var(--ink-label); border: 1px solid var(--tone-border); }
      .x:hover { background: var(--ink-hover); }
    `;
    const sheet = audit(resolveCss(css));
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --tone"]);
  });

  it("is per-theme: the theme that tunes the family is the theme that answers", () => {
    const css = `
      :root { --tone: #22C55E; --tone-border: #16A34A; --flat: #101010; }
      [data-theme="night"] { --tone-border: #86EFAC; }
      [data-theme="dusk"] { --unrelated: #FFFFFF; }
      .x { background: var(--tone); border: 1px solid var(--tone-border); color: var(--flat); }
    `;
    const sheet = audit(resolveCss(css));
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    // night tunes the tone family → its inherited --tone is a finding.
    // dusk declares nothing of the family → the same inheritance there is
    // silence, not a defect. root inherits nothing, ever.
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --tone"]);
  });

  it("stays theme-local: a sibling override is evidence only in the theme that wrote it", () => {
    // The converse shape — root declares the whole family, night inherits the
    // base while tuning a sibling. The base and any third theme that inherits
    // everything see no evidence. Pinned because a theme-agnostic
    // implementation would report --flat wherever it is inherited.
    const css = `
      :root { --flat: #101010; --flat-soft: #202020; }
      [data-theme="night"] { --flat-soft: #303030; }
      .x { background: var(--flat); }
    `;
    const sheet = audit(resolveCss(css));
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --flat"]);
  });

  it("treats a declared intermediate as a family member, and its child as the same family", () => {
    // head() is transitive through declared heads: --brand-extra-child's
    // shortest declared prefix is --brand-extra, whose own head is --brand —
    // one family, three members. night tunes only the child, so BOTH silent
    // members it inherits are findings, each citing the same evidence. Pinned
    // because a non-transitive head would report --brand-extra alone and miss
    // --brand, which sits at the top of the same declared chain.
    const css = `
      :root {
        --brand: #3366CC;
        --brand-extra: #99BBFF;
        --brand-extra-child: #AACCEE;
      }
      [data-theme="night"] { --brand-extra-child: #223344; }
      .x { background: var(--brand); color: var(--brand-extra-child); }
    `;
    const resolved = resolveCss(css);
    const names = new TokenNames(resolved);
    // The derivation really routes the child through the declared intermediate
    // to the chain's head.
    expect(names.head("--brand-extra-child")).toBe("--brand");
    expect(resolved.token("--brand", "night")?.origin).toBe("inherited");
    const sheet = audit(resolved);
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`).sort()).toEqual([
      "night --brand",
      "night --brand-extra",
    ]);
    for (const f of family) {
      expect(f.evidence.overriddenSiblings).toEqual(["--brand-extra-child"]);
    }
  });

  it("omits resolvedValue from evidence when the inherited member's chain does not resolve", () => {
    // THE NO-VALUE SHAPE. --tone's :root declaration is var(--brand-green),
    // declared nowhere, so night's copy of --tone resolves to nothing and
    // `resolvedValue` is null — but `Finding["evidence"]` is typed
    // `string | number | readonly string[]`, and a null is no string. The
    // finding is a declaration-PRESENCE fact and fires exactly as it would
    // for a resolving member; its evidence OMITS the key rather than casting
    // the null through it, `kind` names the no-value state, and the message
    // says the chain does not resolve instead of printing "null".
    // REVERT PROBE — restore `token.resolvedValue as string` and the
    // in-contract assertions below fail on this stylesheet.
    const css = `
      :root { --tone: var(--brand-green); --tone-border: #16A34A; }
      [data-theme="night"] { --tone-border: #86EFAC; }
      .x { background: var(--tone); border: 1px solid var(--tone-border); }
    `;
    const sheet = audit(resolveCss(css));
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    // The family IS tuned — night overrides --tone-border — so the presence
    // fact stands; only the value courtesy is absent.
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --tone"]);
    const evidence = family[0]?.evidence as Record<string, unknown>;
    expect(evidence.familyHead).toBe("--tone");
    expect(evidence.inheritedValue).toBe("var(--brand-green)");
    expect(evidence.kind).toBe("unresolved");
    expect("resolvedValue" in evidence).toBe(false);
    expect(evidence.resolvedValue).toBeUndefined();
    expect(family[0]?.message).not.toContain("null");
    expect(family[0]?.message).toContain("does not resolve");
    // The siblings — the actual evidence — are untouched by the value's state.
    expect(evidence.overriddenSiblings).toEqual(["--tone-border"]);
    // And EVERY evidence value on this sheet sits inside the declared
    // Finding["evidence"] contract — the assertion the cast used to violate.
    for (const finding of sheet.findings) {
      for (const value of Object.values(finding.evidence)) {
        expect(
          typeof value === "string" || typeof value === "number" || Array.isArray(value),
        ).toBe(true);
      }
    }
  });

  it("treats a cyclic chain the same way — the other no-value kind", () => {
    // A cycle resolves to null exactly as an unresolved chain does, so the
    // evidence contract holds identically: no key, kind named, no "null" in
    // the message. Pinned because a fix keyed on `kind === "unresolved"`
    // alone would re-leak through `cycle`.
    const css = `
      :root { --a: var(--b); --b: var(--a); --a-border: #16A34A; }
      [data-theme="night"] { --a-border: #86EFAC; }
      .x { background: var(--a); border: 1px solid var(--a-border); }
    `;
    const sheet = audit(resolveCss(css));
    const family = sheet.findings.filter((f) => f.rule === "family-consistency");
    expect(family.map((f) => `${f.theme} ${f.tokens[0]}`)).toEqual(["night --a"]);
    const evidence = family[0]?.evidence as Record<string, unknown>;
    expect(evidence.kind).toBe("cycle");
    expect("resolvedValue" in evidence).toBe(false);
    expect(family[0]?.message).not.toContain("null");
    expect(family[0]?.message).toContain("does not resolve");
  });
});

/**
 * The coverage inventory — the facts rule 4 is measured over. A listing, never
 * a judgement: these tests pin the SHAPE (partition, split, per-theme kind) and
 * the fixture's numbers, not any verdict about inheritance.
 */
describe("coverageReport — the inventory rule 4 is measured over", () => {
  it("partitions every base token per theme, exactly once", () => {
    const [root, winter] = coverageReport(resolved);
    expect(root?.theme).toBe("root");
    expect(root?.baseTokens).toBe(73);
    expect(root?.overridden).toHaveLength(73);
    expect(root?.inherited).toEqual([]); // the base theme inherits nothing
    expect(winter?.baseTokens).toBe(73);
    expect(winter?.overridden).toHaveLength(51);
    expect(winter?.inherited).toHaveLength(22);
    const names = [...(winter?.overridden ?? []), ...(winter?.inherited ?? [])].map((e) => e.name);
    expect(names).toHaveLength(73);
    expect(new Set(names).size).toBe(73);
  });

  it("splits winter's inherited set 8 colour / 14 non-colour, and names the eight", () => {
    const winter = coverageReport(resolved).find((t) => t.theme === "winter");
    const colors = winter?.inherited.filter((e) => e.kind === "color") ?? [];
    const nonColors = winter?.inherited.filter((e) => e.kind === "non-color") ?? [];
    expect(colors).toHaveLength(8);
    expect(nonColors).toHaveLength(14);
    expect(colors.map((e) => e.name)).toEqual([
      "--app-cta-solid-hover",
      "--app-error",
      "--app-error-solid-hover",
      "--app-info",
      "--app-solid-label",
      "--app-success",
      "--app-warning",
      "--app-warning-solid-hover",
    ]);
  });

  it("lists inherited members without judging them — --app-solid-label included", () => {
    // The token gets NO finding (undeclared head) and MUST still appear in the
    // listing: coverage is the inventory of what winter receives, and it
    // receives this.
    const winter = coverageReport(resolved).find((t) => t.theme === "winter");
    expect(winter?.inherited.find((e) => e.name === "--app-solid-label")).toEqual({
      name: "--app-solid-label",
      status: "inherited",
      kind: "color",
    });
  });

  it("carries the kind the THEME resolves to, not the base's", () => {
    // --ink is a var() at :root pointing at a token only `day` declares: a
    // colour there, unresolved in root. Coverage reports what each theme
    // receives, so the same name carries different kinds in the two rows.
    const sheet = resolveCss(`
      :root { --ink: var(--accent); }
      [data-theme="day"] { --accent: #3366CC; }
      .x { color: var(--ink); }
    `);
    const [root, day] = coverageReport(sheet);
    expect(root?.overridden.find((e) => e.name === "--ink")?.kind).toBe("unresolved");
    expect(day?.inherited.find((e) => e.name === "--ink")?.kind).toBe("color");
  });

  it("is a pure function of the resolved stylesheet", () => {
    expect(JSON.stringify(coverageReport(resolved))).toBe(
      JSON.stringify(coverageReport(resolved)),
    );
  });
});

describe("the rules are yatfa-agnostic — a hand-written stylesheet, no --app- prefix", () => {
  // themeguard is not a yatfa-specific tool. Nothing in the four rules may key
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
      "family-consistency",
      "scale-collapse",
    ]);
    expect(empty.countsByRule.collision).toBe(0);
    expect(empty.countsByRule["family-consistency"]).toBe(0);
  });

  it("totals its per-rule counts exactly", () => {
    const total = Object.values(report.countsByRule).reduce((a, b) => a + b, 0);
    expect(report.findings).toHaveLength(total);
    expect(total).toBe(22);
  });

  it("sorts findings into a stable rule → theme → tokens order", () => {
    const rules = report.findings.map((f) => f.rule);
    expect(rules).toEqual([...rules].sort((a, b) => {
      const order = {
        collision: 0,
        "dead-token": 1,
        "scale-collapse": 2,
        "family-consistency": 3,
      } as const;
      return order[a] - order[b];
    }));
  });

  it("gives every finding a message naming its own tokens", () => {
    for (const f of report.findings) {
      expect(f.tokens.length).toBeGreaterThan(0);
      for (const token of f.tokens) expect(f.message).toContain(token);
    }
  });

  it("keeps every evidence value inside the declared Finding[\"evidence\"] contract", () => {
    // The contract is `Record<string, string | number | readonly string[]>` —
    // a rule that casts a null through it ships a runtime null to every
    // consumer reading the declared type, exactly the defect the
    // `family-consistency` rule's first draft had on an unresolved chain. The
    // corpus here is the fixture's 22 findings; the no-value shapes themselves
    // are pinned on hand-written stylesheets in rule 4's hand-written suite.
    for (const f of report.findings) {
      for (const [key, value] of Object.entries(f.evidence)) {
        expect(
          typeof value === "string" || typeof value === "number" || Array.isArray(value),
          `${f.rule}/${f.tokens.join(",")} evidence.${key} is ${JSON.stringify(value)}`,
        ).toBe(true);
      }
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
    expect(familyConsistencyRule(resolved, names)).toHaveLength(7);
  });
});
