import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import { ROOT_THEME, resolveCss } from "../src/resolve.js";
import { parseStylesheet } from "../src/parse.js";
import { CENSUS, fixtureCss, FIXTURE_PATH } from "./fixture.js";

/**
 * 0.1.20 — THE CYCLE FACT FOR A LOOP WHOSE CLOSING EDGE IS EMBEDDED.
 *
 * `cycle-reference` (0.1.9) judges the resolver's `kind: "cycle"` fact, and the
 * resolver only ever minted it from the WHOLE-VALUE branch: a value that is
 * exactly one `var()` call. So a loop written the way real CSS writes token
 * values — `1px solid var(--c)`, `calc(var(--x) + 2px)`,
 * `color-mix(in srgb, var(--a) 15%, var(--b))` — produced no `cycle` token,
 * and a rule whose entire subject is that fact was STRUCTURALLY silent. The
 * probes in the ticket print "No findings." and exit 0 on three such loops
 * while the coverage inventory lists both members as healthy tokens.
 *
 * The slice is resolver-side and one-directional: where the whole-value branch
 * DECLINES, the compound value's PRIMARY-position `var()` references are read
 * for a back edge onto a name already on the walk, and one found mints the
 * identical fact the whole-value path mints. Every rule file is byte-identical
 * — that is the feature, not a constraint tolerated: the rule's input became
 * complete and the rule did not move.
 *
 * These tests pin three populations:
 *
 *   1. THE GAP CLOSING — the ticket's own U1/U3/U4 probes, each asserted at the
 *      resolver fact AND at the report the user reads.
 *   2. BYTE-IDENTITY NEGATIVES — every whole-value shape (plain loop,
 *      self-loop, fallback-missing, fallback-cycle) and the compound NON-loop.
 *      These hold BY CONSTRUCTION: a whole-value shape never reaches the scan,
 *      and a compound value with no back edge falls through to `classifyValue`
 *      exactly as before.
 *   3. SCAN SCOPE — a back edge that sits only inside a `var()`'s own FALLBACK
 *      segment is NOT a scanned edge, because reading one would truncate
 *      `--a: var(--b, var(--a))` from its real `--a → --b → --a` chain to
 *      `--a → --a`. The scan is therefore narrower than the whole-value walk on
 *      one shape — an UNDECLARED primary whose fallback self-references — and
 *      that residual is pinned rather than implied.
 *
 * 0.1.21 adds the fourth population, the designed one:
 *
 *   4. THE DEPENDENT DECLARATION — a walk that STOPS at a compound value is
 *      re-marked `cycle` when the stopped value's primary-position references
 *      reach a loop in the same theme view, so a tail into a compound loop
 *      and a compound tail into a loop carry the fact the whole-value shapes
 *      always carried. The consult reads the walks' finished results only
 *      (per theme, primary-position edges, no compound value chased); the
 *      healed loop member joins its own group as a rotation — the finding
 *      count never moves.
 *
 * 0.1.22 makes that consult COMPLETE, in the two directions 0.1.21 left open:
 *
 *   5. MEMBERSHIP, NOT THE WALKER'S KIND-CARRYING IDENTITY — 0.1.21 consulted
 *      a snapshot of the tokens the WALK minted `cycle`, so in a
 *      compound-closed loop (where only one member's walk closes it) a
 *      byte-identical tail fired or stayed silent according to which member
 *      it happened to name — a resolver-internal fact invisible in the CSS.
 *      The consult now asks whether the referenced name is a loop MEMBER in
 *      this theme's view, read from the token table (so an undeclared chain
 *      name — rule 5's population — is never a member).
 *   6. THE FIXED POINT — the membership set grows as the pass re-marks, so
 *      the pass repeats until a round re-marks nothing (bounded by the
 *      theme's candidate count, each round reading a snapshot taken at its
 *      start so the outcome is order-independent). A dependent two or more
 *      hops from the loop — 0.1.21's pinned residual — now resolves, and a
 *      dependent consumed through a whole-value walk stops vanishing from
 *      the report. Healthy compound chains that never reach a loop are
 *      untouched, and the remaining residual (a loop whose EVERY member
 *      stops at a compound value mints nothing to propagate from — a gap in
 *      MINTING, not in completing) is pinned rather than implied.
 */

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly stdout: string;
  readonly stderr: string;
}

function run(...args: string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = runCli(args, io);
  return { code, out, err, stdout: out.join("\n"), stderr: err.join("\n") };
}

const tmp = mkdtempSync(join(tmpdir(), "themeguard-compound-cycle-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

describe("U1 — a two-member loop whose closing edge is embedded in a compound value", () => {
  // The ticket's live probe on 0.1.9: "No findings." EXIT=0, and the coverage
  // inventory calls both loop members healthy base tokens.
  const css = [
    ":root {",
    "  --divider: 1px solid var(--divider-color);",
    "  --divider-color: var(--divider);",
    "}",
    ".btn { border: var(--divider); }",
    "",
  ].join("\n");

  it("mints the cycle fact, with the chain the whole-value walk would have carried", () => {
    const r = resolveCss(css);
    const t = r.token("--divider-color", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.resolvedValue).toBeNull();
    expect(t?.missingReference).toBeNull();
    expect(t?.chain).toEqual(["--divider-color", "--divider", "--divider-color"]);
  });

  it("is ONE `theme: null` finding naming the loop, its members and its declaration lines", () => {
    const findings = audit(resolveCss(css)).findings.filter(
      (f) => f.rule === "cycle-reference",
    );
    expect(findings).toHaveLength(1);
    const finding = findings[0]!;
    expect(finding.theme).toBeNull();
    // 0.1.21: both members carry kind "cycle" now, and the representative —
    // the alphabetically first — rotated from `--divider-color` to
    // `--divider`. Same loop set, one finding, printed as written.
    expect(finding.tokens).toEqual(["--divider", "--divider-color"]);
    expect(finding.evidence?.["chain"]).toEqual([
      "--divider",
      "--divider-color",
      "--divider",
    ]);
    expect(finding.evidence?.["loop"]).toEqual(["--divider", "--divider-color"]);
    expect(finding.message).toContain(
      "--divider → --divider-color → --divider is a var() cycle",
    );
    expect(finding.message).toContain("invalid at computed-value time");
    expect(finding.sites?.map((s) => s.line)).toEqual([2, 3]);
  });

  it("the report the user reads flips from `No findings.` to the cycle section, exit 0 → 1", () => {
    const result = run(cssFixture("u1.css", css));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).not.toContain("No findings.");
    expect(result.stdout).toContain("cycle-reference (1)");
    expect(result.stdout).toContain(
      "  [cycle-reference] --divider → --divider-color → --divider is a var() cycle: every property in the loop, and every var() consuming a member, is invalid at computed-value time. Declared at lines 2 and 3.",
    );
  });
});

describe("U3 — the calc-increment idiom is a self-loop", () => {
  // `--pad: calc(var(--pad, 0px) + 2px)`: the `--pad` reference is in PRIMARY
  // position inside a compound value, so it IS a scanned edge — the fallback
  // exclusion below does not reach it. In a browser the declaration is invalid
  // at computed-value time; the `0px` fallback does not rescue it, because a
  // property may not reference itself.
  const css = ":root {\n  --pad: calc(var(--pad, 0px) + 2px);\n}\n";

  it("mints a loop of one", () => {
    const t = resolveCss(css).token("--pad", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.chain).toEqual(["--pad", "--pad"]);
  });

  it("reports one finding and moves the exit code", () => {
    const result = run(cssFixture("u3.css", css));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("cycle-reference (1)");
    expect(result.stdout).toContain("--pad → --pad is a var() cycle");
  });
});

describe("U4 — a theme that closes the compound loop with its OWN declaration", () => {
  // The base view is healthy here (`--divider-color: #cccccc`), so a blanket
  // `theme: null` would be wrong: the defect exists only in dark's view, and
  // that is exactly where the rule's authorship branch puts it.
  const css = [
    ":root {",
    "  --divider: 1px solid var(--divider-color);",
    "  --divider-color: #cccccc;",
    "}",
    '[data-theme="dark"] {',
    "  --divider-color: var(--divider);",
    "}",
    "",
  ].join("\n");

  it("leaves the base view resolved and marks only the dark view cyclic", () => {
    const r = resolveCss(css);
    expect(r.token("--divider-color", ROOT_THEME)?.kind).toBe("color");
    expect(r.token("--divider-color", "dark")?.kind).toBe("cycle");
    expect(r.token("--divider-color", "dark")?.chain).toEqual([
      "--divider-color",
      "--divider",
      "--divider-color",
    ]);
  });

  it("is ONE theme-scoped finding — and the cycle is NAMED, not left to another rule", () => {
    const findings = audit(resolveCss(css)).findings.filter(
      (f) => f.rule === "cycle-reference",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.theme).toBe("dark");
    expect(findings[0]!.message).toContain('is a var() cycle in theme "dark"');
  });

  it("the report names the cycle rather than exiting 1 on a family-consistency proxy alone", () => {
    const result = run(cssFixture("u4.css", css));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("cycle-reference (1)");
    // The representative rotated with 0.1.21: dark's view heals the inherited
    // `--divider` too, and the alphabetically first member is now `--divider`.
    expect(result.stdout).toContain(
      '--divider → --divider-color → --divider is a var() cycle in theme "dark"',
    );
  });
});

describe("the canonical compound shapes all close, and each is ONE finding naming both members", () => {
  // The member whose OWN walk reaches the back edge is the one that mints the
  // fact mid-walk — a compound value is not FOLLOWED, so the walk that closes
  // is the one that started at the whole-value member. Since 0.1.21's
  // completion pass the OTHER member is re-marked after the walks run (its
  // primary reference names a loop member), so both members carry
  // kind "cycle" — still ONE finding: same loop set, one group. The finding's
  // `tokens` was always the loop SET, so both members were named in the one
  // finding before and after; only the kind column changed.
  it.each([
    ["shorthand", "--a: 1px solid var(--b);", "--b: var(--a);", "--b"],
    ["calc", "--a: calc(var(--b) + 2px);", "--b: var(--a);", "--b"],
    ["color-mix", "--a: color-mix(in srgb, var(--b) 15%, #fff);", "--b: var(--a);", "--b"],
    [
      "closing edge itself compound",
      "--a: var(--b);",
      "--b: color-mix(in srgb, var(--a) 50%, #000);",
      "--a",
    ],
  ])("%s", (_name, first, second, _cyclicMember) => {
    const r = resolveCss(`:root { ${first} ${second} }`);
    // 0.1.21's completion pass heals the member asymmetry 0.1.20 shipped:
    // the whole-value member's walk mints the fact, and the compound member —
    // whose own walk stops at its value but whose primary reference names a
    // now-known loop member — is re-marked by the pass. Both members carry
    // kind "cycle"; the finding count is unchanged (same loop set, one group).
    expect(r.tokens.filter((t) => t.kind === "cycle").map((t) => t.name)).toEqual([
      "--a",
      "--b",
    ]);

    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect([...findings[0]!.tokens].sort()).toEqual(["--a", "--b"]);
  });

  it("a back edge in the SECOND var() of one compound value counts too", () => {
    // The scan reads every call's primary argument, not just the first call's.
    const r = resolveCss(`:root { --a: color-mix(in srgb, var(--ok) 15%, var(--a)); --ok: #fff; }`);
    expect(r.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--a"]);
  });

  it("a three-member loop closing on a compound value names all three in the one finding", () => {
    const r = resolveCss(
      `:root { --a: var(--b); --b: var(--c); --c: 1px solid var(--a); }`,
    );
    expect(r.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--b", "--c", "--a"]);
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect([...findings[0]!.tokens].sort()).toEqual(["--a", "--b", "--c"]);
  });

  it("COMPLETION: a tail whose walk ENTERS the loop through a compound value is itself cyclic", () => {
    // `--tail: var(--a)` walks into `--a`, whose value is compound. The walk
    // stops there — a compound value is not followed — so mid-walk `--tail`
    // cannot know `--a` sits in a loop at all: the loop closes on `--b`'s
    // walk, not its own. The completion pass re-marks it once the walks have
    // run: its stopped value's PRIMARY reference (`--b`) is a loop MEMBER in
    // this theme's view, so `--tail` carries the fact the whole-value tail
    // has always carried. Per CSS custom-property semantics both verdicts say the same
    // thing — the declaration is invalid at computed-value time — and the
    // same declaration shape now gets the same verdict whichever way the
    // LOOP's members spell their values.
    const r = resolveCss(
      `:root { --tail: var(--a); --a: 1px solid var(--b); --b: var(--a); }`,
    );
    const t = r.token("--tail", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.resolvedValue).toBeNull();
    expect(t?.missingReference).toBeNull();
    // The stopping walk's path, the referenced cycle name, then its walk up to
    // the first name the tail had already visited — `--a` — so the chain
    // closes there, exactly as the walk would have had the compound value
    // been substitutable.
    expect(t?.chain).toEqual(["--tail", "--a", "--b", "--a"]);

    // Loop-set grouping: the tail's set gains the tail, so it is its OWN
    // finding beside the loop's — cycle-reference's documented two-findings
    // semantics — while the healed `--a` joins the loop's group as a
    // rotation, keeping that group's finding count at one.
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(2);
    const loop = findings.find((f) => !f.tokens.includes("--tail"))!;
    const dependent = findings.find((f) => f.tokens.includes("--tail"))!;
    expect([...loop.tokens].sort()).toEqual(["--a", "--b"]);
    expect(dependent.tokens).toEqual(["--tail", "--a", "--b"]);
    expect(dependent.theme).toBeNull();
    expect(dependent.message).toContain(
      "--tail → --a → --b → --a is a var() cycle",
    );

    // The whole-value tail, for contrast — unchanged by this slice; the walk
    // has always closed it mid-walk.
    const whole = resolveCss(`:root { --a: var(--b); --b: var(--c); --c: var(--b); }`);
    expect(whole.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(whole.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--b", "--c", "--b"]);
  });

  it("COMPLETION: a compound TAIL into a whole-value loop is cyclic too — same verdict, no special case", () => {
    // The mirror shape: the tail's own value is the compound one. Its walk
    // stops at itself, and the primary reference of that stopped value
    // (`--a`) is a loop member — re-marked, chain spelled as the
    // substitution walk would have closed it.
    const r = resolveCss(
      `:root { --pad-accent: calc(var(--a) + 2px); --a: var(--b); --b: var(--a); }`,
    );
    const t = r.token("--pad-accent", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.chain).toEqual(["--pad-accent", "--a", "--b", "--a"]);
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.tokens.includes("--pad-accent"))!.message).toContain(
      "--pad-accent → --a → --b → --a is a var() cycle",
    );
  });

  it("COMPLETION: the healed loop member joins the loop's group as a rotation — one finding, representative rotated", () => {
    // The asymmetry 0.1.20 left behind: `--divider`'s own walk stops at its
    // compound value and classified as literal text while `--divider-color`
    // carried kind "cycle" — two kinds inside one loop. The pass re-marks it
    // (its primary reference names a loop member), its chain closes on the
    // set the loop already had, and the group's deterministic representative —
    // the alphabetically first member — rotates to `--divider`. The dedupe
    // doctrine calls rotations equivalent: same set, one finding.
    const r = resolveCss(
      `:root { --divider: 1px solid var(--divider-color); --divider-color: var(--divider); }`,
    );
    expect(r.token("--divider", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--divider", ROOT_THEME)?.chain).toEqual([
      "--divider",
      "--divider-color",
      "--divider",
    ]);
    expect(r.token("--divider-color", ROOT_THEME)?.chain).toEqual([
      "--divider-color",
      "--divider",
      "--divider-color",
    ]);

    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--divider", "--divider-color"]);
    expect(findings[0]!.message).toContain(
      "--divider → --divider-color → --divider is a var() cycle",
    );
  });

  it("COMPLETION, theme view: a theme that closes the loop sees its inherited member healed there and only there", () => {
    // The walk is per-theme and so is the pass. Root's `--divider-color` is
    // a plain colour, so root's `--divider` stays a healthy non-color; dark
    // re-points it into the loop, so in dark's view `--divider-color` mints
    // the cycle and the inherited `--divider` is re-marked THERE.
    const css = [
      ":root {",
      "  --divider: 1px solid var(--divider-color);",
      "  --divider-color: #cccccc;",
      "}",
      '[data-theme="dark"] {',
      "  --divider-color: var(--divider);",
      "}",
      "",
    ].join("\n");
    const r = resolveCss(css);
    expect(r.token("--divider", ROOT_THEME)?.kind).toBe("non-color");
    expect(r.token("--divider", "dark")?.kind).toBe("cycle");
    expect(r.token("--divider", "dark")?.chain).toEqual([
      "--divider",
      "--divider-color",
      "--divider",
    ]);
  });

  it("COMPLETION: a tail that inherits a root-authored loop is theme-scoped for its OWN half and deduped for the loop's", () => {
    // Root authors the compound loop; dark authors only the tail. Dark's
    // tail group contains a token dark declared, so the rule reports the
    // dependent declaration as dark's own defect; the loop's group holds no
    // dark-declared member, so it stays deduped under root's theme:null
    // finding — a tail behaves exactly like the loop's own members do.
    const css = [
      ":root {",
      "  --divider: 1px solid var(--divider-color);",
      "  --divider-color: var(--divider);",
      "}",
      '[data-theme="dark"] {',
      "  --card-border: var(--divider);",
      "}",
      "",
    ].join("\n");
    const findings = audit(resolveCss(css)).findings.filter(
      (f) => f.rule === "cycle-reference",
    );
    expect(findings).toHaveLength(2);
    const loop = findings.find((f) => f.theme === null)!;
    const dependent = findings.find((f) => f.theme === "dark")!;
    expect([...loop.tokens].sort()).toEqual(["--divider", "--divider-color"]);
    expect(dependent.tokens).toEqual(["--card-border", "--divider", "--divider-color"]);
    expect(dependent.message).toContain('is a var() cycle in theme "dark"');
    // And root's view never saw the tail (it is dark's own name), so the
    // theme:null finding is the loop's alone.
    expect(loop.message).toContain("--divider → --divider-color → --divider is a var() cycle");
  });

  it("COMPLETION: a compound value referencing ANOTHER compound-stopped value two hops from the loop is cyclic too", () => {
    // Was the pinned residual of 0.1.21, whose consult read the WALK's kinds
    // once — one pass, no fixed point — so `--c1` was re-marked (its
    // reference names the loop directly) while `--c2`, whose reference names
    // `--c1`, stayed classified as its literal text. Semantically `--c2` is
    // invalid at computed-value time too: the guarantee-invalid value
    // propagates through substitution however many hops it travels. The pass
    // now iterates to a FIXED POINT over its own re-marks, so the whole
    // dependent tail resolves and each hop is its own finding.
    const r = resolveCss(
      `:root {
         --loop-a: var(--loop-b);
         --loop-b: var(--loop-a);
         --c1: calc(var(--loop-a) + 1px);
         --c2: calc(var(--c1) + 1px);
         --c3: calc(var(--c2) + 1px);
       }`,
    );
    expect(r.token("--c1", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--c2", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--c3", ROOT_THEME)?.kind).toBe("cycle");
    // Each hop's chain carries its own path plus the loop it depends on, and
    // ends on the first revisited name — so the hop it went through is on
    // the chain, and the chain still closes on the LOOP rather than on the
    // hop: the member's walk is read at its completed spelling.
    expect(r.token("--c2", ROOT_THEME)?.chain).toEqual([
      "--c2",
      "--c1",
      "--loop-a",
      "--loop-b",
      "--loop-a",
    ]);
    expect(r.token("--c3", ROOT_THEME)?.chain).toEqual([
      "--c3",
      "--c2",
      "--c1",
      "--loop-a",
      "--loop-b",
      "--loop-a",
    ]);
    // Four distinct loop sets: the loop and one per dependent hop.
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(4);
    expect(findings.find((f) => f.tokens.includes("--c3"))!.message).toContain(
      "--c3 → --c2 → --c1 → --loop-a → --loop-b → --loop-a is a var() cycle",
    );
  });

  it("COMPLETION: the verdict follows the DECLARATION, not which member's walk closed the loop", () => {
    // The walker-blind asymmetry 0.1.21 left behind, and the reason the
    // consult now asks MEMBERSHIP. In a compound-closed loop only
    // `--divider-color`'s walk closes it — `--divider` is re-marked by the
    // pass — so a snapshot taken before the pass ran contained only the one
    // name, and which SPELLING of a byte-identical tail fired was decided by
    // a resolver-internal fact invisible in the CSS.
    const r = resolveCss(
      `:root {
         --divider: 1px solid var(--divider-color);
         --divider-color: var(--divider);
         --tail-walker: 3px solid var(--divider-color);
         --tail-member: 3px solid var(--divider);
       }`,
    );
    expect(r.token("--tail-walker", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--tail-member", ROOT_THEME)?.kind).toBe("cycle");
    // Same shape, each closing on the member it names.
    expect(r.token("--tail-walker", ROOT_THEME)?.chain).toEqual([
      "--tail-walker",
      "--divider-color",
      "--divider",
      "--divider-color",
    ]);
    expect(r.token("--tail-member", ROOT_THEME)?.chain).toEqual([
      "--tail-member",
      "--divider",
      "--divider-color",
      "--divider",
    ]);
    // Three groups: the loop, and one per tail (each tail's set carries the
    // tail, so neither dedupes into the loop's).
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(3);
  });

  it("COMPLETION: a dependent CONSUMED through a whole-value walk is reported too — it no longer vanishes", () => {
    // `--t2` stops at its compound value; `--t1: var(--t2)` walks INTO it and
    // stops there as well (a compound value is not followed), so before the
    // fixed point BOTH stayed literal text and the report carried only the
    // loop's own finding — the dependent pair vanished from the report
    // entirely rather than merely being classified oddly.
    const r = resolveCss(
      `:root {
         --divider: 1px solid var(--divider-color);
         --divider-color: var(--divider);
         --t2: 1px solid var(--divider);
         --t1: var(--t2);
       }`,
    );
    expect(r.token("--t2", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--t1", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--t1", ROOT_THEME)?.chain).toEqual([
      "--t1",
      "--t2",
      "--divider",
      "--divider-color",
      "--divider",
    ]);
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(3);
  });

  it("NO OVER-MARKING: a healthy compound chain that never reaches a loop keeps its literal classification", () => {
    // The fence on the other side of the fixed point: iterating propagates a
    // re-mark only along edges that REACH a loop. A compound chain of any
    // depth over healthy values is untouched, and so is a compound value
    // beside a loop it does not reference.
    const r = resolveCss(
      `:root {
         --loop-a: var(--loop-b);
         --loop-b: var(--loop-a);
         --base: #ffffff;
         --e: 1px solid var(--base);
         --f: calc(var(--e) + 1px);
         --g: calc(var(--f) + 1px);
       }`,
    );
    for (const name of ["--e", "--f", "--g"]) {
      expect(r.token(name, ROOT_THEME)?.kind, name).toBe("non-color");
      expect(r.token(name, ROOT_THEME)?.resolvedValue, name).not.toBeNull();
    }
    expect(r.token("--g", ROOT_THEME)?.chain).toEqual(["--g"]);
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect([...findings[0]!.tokens].sort()).toEqual(["--loop-a", "--loop-b"]);
  });

  it("the fixed point is ORDER-INDEPENDENT: a dependent declared BEFORE the hop it depends on resolves identically", () => {
    // Each round reads a snapshot of the theme's membership taken before any
    // of that round's re-marks land, so a dependent sitting earlier in the
    // token list than the hop it needs is not decided by that position — it
    // simply resolves on the next round.
    const forward = resolveCss(
      `:root { --l1: var(--l2); --l2: var(--l1); --c1: calc(var(--l1) + 1px); --c2: calc(var(--c1) + 1px); }`,
    );
    const reversed = resolveCss(
      `:root { --c2: calc(var(--c1) + 1px); --c1: calc(var(--l1) + 1px); --l1: var(--l2); --l2: var(--l1); }`,
    );
    for (const r of [forward, reversed]) {
      expect(r.token("--c1", ROOT_THEME)?.chain).toEqual(["--c1", "--l1", "--l2", "--l1"]);
      expect(r.token("--c2", ROOT_THEME)?.chain).toEqual([
        "--c2",
        "--c1",
        "--l1",
        "--l2",
        "--l1",
      ]);
    }
  });

  it("MEMBERSHIP is read through the TOKEN table: an undeclared chain name is not a member", () => {
    // A cycle chain can carry a name NOTHING declares — the fallback-missing
    // step of `--a: var(--nope, var(--a))` puts `--nope` on `--a`'s chain.
    // `var(--nope)` falls back to unset/inherit (rule 5's population), so a
    // consult over bare chain NAMES would re-mark its consumers as cyclic.
    // Reading membership through the token table excludes it by
    // construction: an undeclared name has no token to be a member.
    const r = resolveCss(`:root { --a: var(--nope, var(--a)); --d: 1px solid var(--nope); }`);
    expect(r.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--nope", "--a"]);
    expect(r.token("--d", ROOT_THEME)?.kind).toBe("non-color");
    expect(r.token("--d", ROOT_THEME)?.resolvedValue).toBe("1px solid var(--nope)");
  });

  it("COMPLETION, theme view: a transitive dependent is re-marked only in the view whose loop closes", () => {
    // The fixed point is per-theme like the pass it iterates. Root's
    // `--divider-color` is a plain colour, so root's whole dependent tail
    // stays healthy; dark re-points it into the loop, and BOTH hops of the
    // tail are re-marked there and only there.
    const css = [
      ":root {",
      "  --divider: 1px solid var(--divider-color);",
      "  --divider-color: #cccccc;",
      "  --t2: 1px solid var(--divider);",
      "  --t1: var(--t2);",
      "}",
      '[data-theme="dark"] {',
      "  --divider-color: var(--divider);",
      "}",
      "",
    ].join("\n");
    const r = resolveCss(css);
    for (const name of ["--divider", "--t2", "--t1"]) {
      expect(r.token(name, ROOT_THEME)?.kind, name).toBe("non-color");
      expect(r.token(name, "dark")?.kind, name).toBe("cycle");
    }
    expect(r.token("--t1", "dark")?.chain).toEqual([
      "--t1",
      "--t2",
      "--divider",
      "--divider-color",
      "--divider",
    ]);
  });

  it("RESIDUAL, pinned: a loop whose EVERY member stops at a compound value still mints nothing to propagate from", () => {
    // The gap the fixed point does NOT close, because it is a gap in MINTING
    // the loop rather than in completing its dependents: no walk closes
    // `--m1: 1px solid var(--m2); --m2: 1px solid var(--m1)` — each stops at
    // its own compound value with the other name not yet on the walk — so
    // there is no membership for this pass to consult and nothing to
    // propagate. Stated here rather than implied.
    const r = resolveCss(
      `:root { --m1: 1px solid var(--m2); --m2: 1px solid var(--m1); --tail: var(--m1); }`,
    );
    expect(r.token("--m1", ROOT_THEME)?.kind).toBe("non-color");
    expect(r.token("--m2", ROOT_THEME)?.kind).toBe("non-color");
    expect(r.token("--tail", ROOT_THEME)?.kind).toBe("non-color");
    expect(audit(r).countsByRule["cycle-reference"]).toBe(0);
  });
});

describe("SCAN SCOPE — a fallback-only back edge is NOT an edge", () => {
  // The load-bearing constraint. A name inside a var()'s own fallback segment
  // is not a SCANNED edge, because reading one would invent an edge the walk
  // does not take for that value — and on `--a: var(--b, var(--a))` it would
  // close a loop on iteration zero, truncating a real `--a → --b → --a` chain
  // to `--a → --a`.
  //
  // The scan is therefore NARROWER than the whole-value walk, which DOES follow
  // a fallback (and treat its names as edges) when the primary is UNDECLARED.
  // That asymmetry is the residual pinned at the end of this block.
  it("a compound value whose only back edge sits in a fallback segment stays clean", () => {
    const r = resolveCss(`:root { --a: calc(var(--x, var(--a)) + 2px); --x: 3px; }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("non-color");
    expect(t?.resolvedValue).toBe("calc(var(--x, var(--a)) + 2px)");
    expect(t?.chain).toEqual(["--a"]);
    expect(audit(r).countsByRule["cycle-reference"]).toBe(0);
  });

  it("the same exclusion holds when the fallback names a DIFFERENT member of the walk", () => {
    const r = resolveCss(
      `:root { --a: var(--b); --b: 1px solid var(--x, var(--a)); --x: #fff; }`,
    );
    expect(r.tokens.filter((t) => t.kind === "cycle")).toEqual([]);
  });

  it("primary-position references with no back edge stay clean and classify as before", () => {
    const r = resolveCss(
      `:root { --base: #ffffff; --tint: #000000; --mix: color-mix(in srgb, var(--base) 15%, var(--tint)); }`,
    );
    const t = r.token("--mix", ROOT_THEME);
    expect(t?.kind).toBe("non-color");
    expect(t?.resolvedValue).toBe("color-mix(in srgb, var(--base) 15%, var(--tint))");
    expect(t?.chain).toEqual(["--mix"]);
    expect(audit(r).countsByRule["cycle-reference"]).toBe(0);
  });

  it("a value with no var() at all is untouched — the scan finds nothing to read", () => {
    const r = resolveCss(`:root { --a: 1px solid #ccc; }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("non-color");
    expect(t?.resolvedValue).toBe("1px solid #ccc");
    expect(t?.chain).toEqual(["--a"]);
  });

  it("RESIDUAL, pinned: an UNDECLARED primary whose fallback self-references is reported whole-value, not compound", () => {
    // The one shape where the compound scan is NARROWER than the whole-value
    // walk, and the reason it is: that walk follows a fallback — and treats its
    // names as edges — precisely when the primary is UNDECLARED and the browser
    // would therefore substitute that fallback. The compound scan reads primary
    // positions only and does not consult the declaration table, so it reads
    // `--nope`, finds it is not on the walk, and stops.
    //
    // Same CSS defect, reported in one spelling and silent in the other. It is
    // the deliberate v1 edge: resolving it needs the scan to know which
    // primaries are undeclared, which is a design decision, not a line. Pinned
    // here so the next reader finds the limit stated rather than implied.
    const whole = resolveCss(`:root { --a: var(--nope, var(--a)); }`);
    expect(whole.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(whole.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--nope", "--a"]);
    expect(audit(whole).countsByRule["cycle-reference"]).toBe(1);

    const compound = resolveCss(`:root { --a: 1px solid var(--nope, var(--a)); }`);
    expect(compound.token("--a", ROOT_THEME)?.kind).toBe("non-color");
    expect(compound.token("--a", ROOT_THEME)?.chain).toEqual(["--a"]);
    expect(audit(compound).countsByRule["cycle-reference"]).toBe(0);
  });
});

describe("BYTE-IDENTITY — every whole-value shape is handled above the scan and is unchanged", () => {
  // Each of these is handled by the `VAR_ONLY` branch and NEVER reaches the
  // compound scan, so its fact is unchanged by construction rather than by
  // amendment. They are pinned here as the negatives of this slice.
  it("a plain two-member loop keeps its full chain", () => {
    const r = resolveCss(`:root { --a: var(--b); --b: var(--a); }`);
    expect(r.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--b", "--a"]);
    expect(r.token("--b", ROOT_THEME)?.chain).toEqual(["--b", "--a", "--b"]);
  });

  it("a whole-value self-loop is a loop of one", () => {
    const r = resolveCss(`:root { --s: var(--s); }`);
    expect(r.token("--s", ROOT_THEME)?.kind).toBe("cycle");
    expect(r.token("--s", ROOT_THEME)?.chain).toEqual(["--s", "--s"]);
  });

  it("a whole-value fallback into a declared value still resolves through the fallback", () => {
    const r = resolveCss(`:root { --a: var(--nope, #22C55E); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("color");
    expect(t?.resolvedValue).toBe("#22C55E");
    expect(t?.chain).toEqual(["--a", "--nope"]);
  });

  it("a whole-value fallback-MISSING is `unresolved`, never `cycle`", () => {
    const r = resolveCss(`:root { --a: var(--nope); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("unresolved");
    expect(t?.missingReference).toBe("--nope");
    expect(t?.chain).toEqual(["--a", "--nope"]);
  });

  it("the FALLBACK-CYCLE shape keeps the FULL chain — through the whole-value branch", () => {
    // `--a: var(--b, var(--a))` — the value is exactly one var() call, so the
    // whole-value branch takes it, walks to the declared `--b`, and closes on
    // `--a`: the chain is `--a → --b → --a`, with `--b` present. The scan
    // never runs on this value, which is why the chain cannot be truncated to
    // `--a → --a`.
    const r = resolveCss(`:root { --a: var(--b, var(--a)); --b: var(--a); }`);
    const t = r.token("--a", ROOT_THEME);
    expect(t?.kind).toBe("cycle");
    expect(t?.chain).toEqual(["--a", "--b", "--a"]);

    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.tokens).toEqual(["--a", "--b"]);
    expect(findings[0]!.message).toContain("--a → --b → --a is a var() cycle");
  });

  it("a compound NON-loop reports byte-identically — the gap was the cycle fact, never compound values", () => {
    const clean = [
      ":root {",
      "  --surface: #ffffff;",
      "  --accent: #22C55E;",
      "  --edge: 1px solid var(--accent);",
      "  --wash: color-mix(in srgb, var(--accent) 15%, var(--surface));",
      "}",
      ".btn { border: var(--edge); background: var(--wash); }",
      "",
    ].join("\n");
    const result = run(cssFixture("clean.css", clean));
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain("No findings.");
    expect(result.stdout).toContain("cycle-reference (0)");
  });
});

describe("THE PROBE — the ticket's own fixture, both loop shapes plus tails, end to end", () => {
  // The live probe the ticket verified the residual on: same declaration
  // shape (`--x: var(--member)`), two verdicts before this slice — the
  // whole-value loop's tail fired, the compound loop's tail surfaced only
  // under dead-token. After it, both tails carry the designed finding.
  const css = [
    ":root {",
    "  --a: var(--b);",
    "  --b: var(--a);",
    "  --tail-whole: var(--a);",
    "  --divider: 1px solid var(--divider-color);",
    "  --divider-color: var(--divider);",
    "  --card-border: var(--divider);",
    "  --pad-accent: calc(var(--a) + 2px);",
    "}",
    "",
  ].join("\n");

  it("every stopped walk that reaches a loop is kind cycle — both tails and all healed members", () => {
    const r = resolveCss(css);
    for (const name of [
      "--tail-whole",
      "--card-border",
      "--pad-accent",
      "--divider",
    ]) {
      expect(r.token(name, ROOT_THEME)?.kind, name).toBe("cycle");
    }
    expect(r.token("--card-border", ROOT_THEME)?.chain).toEqual([
      "--card-border",
      "--divider",
      "--divider-color",
      "--divider",
    ]);
    expect(r.token("--pad-accent", ROOT_THEME)?.chain).toEqual([
      "--pad-accent",
      "--a",
      "--b",
      "--a",
    ]);
  });

  it("the report prints each dependent walk as its own group beside its loop's, and the exit code is unchanged", () => {
    const result = run(cssFixture("probe.css", css));
    expect(result.code).toBe(EXIT_FINDINGS);
    // Five loop-set groups: the two loops, the two tails, and the compound
    // tail into the whole-value loop. Each tail's set carries the tail, so
    // none dedupes into its loop's finding.
    expect(result.stdout).toContain("cycle-reference (5)");
    expect(result.stdout).toContain(
      "--card-border → --divider → --divider-color → --divider is a var() cycle",
    );
    expect(result.stdout).toContain("--pad-accent → --a → --b → --a is a var() cycle");
    expect(result.stdout).toContain("--tail-whole → --a → --b → --a is a var() cycle");
    expect(result.stdout).toContain("--divider → --divider-color → --divider is a var() cycle");
    expect(result.stdout).toContain("--a → --b → --a is a var() cycle");
    // Dead-token is untouched: it reads the parser's references, not kinds,
    // so the three unreferenced tails it already reported it still reports —
    // the cycle lines appear BESIDE them, never instead of them.
    expect(result.stdout).toContain("3 dead-token");
  });
});

describe("CENSUS PRESERVATION — the calibration fixture keeps its numbers AND its bytes", () => {
  // The calibration measurement this slice was sized against, re-derived at
  // branch time (the ticket requires it after #14 merged): 189 declarations,
  // of which 68 are whole-value var() and 4 are COMPOUND with var(). All four
  // are the `color-mix` toast-surface family, and each points at a plain
  // non-ancestor colour — 0 back edges — so the scan runs on them and finds
  // nothing. Zero new cycle facts, and the report is unchanged.
  const VAR_ONLY_PROBE = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/;

  it("the fixture holds exactly 4 compound-with-var declarations, and they are the toast surfaces", () => {
    const declarations = parseStylesheet(fixtureCss()).scopes.flatMap((s) => s.declarations);
    expect(declarations).toHaveLength(CENSUS.total + 1); // the fixture's own import stub adds one
    const wholeVar = declarations.filter((d) => VAR_ONLY_PROBE.test(d.value));
    const compound = declarations.filter(
      (d) => !VAR_ONLY_PROBE.test(d.value) && d.value.includes("var("),
    );
    expect(wholeVar).toHaveLength(68);
    expect(compound.map((d) => d.name).sort()).toEqual([
      "--app-error-toast-surface",
      "--app-info-toast-surface",
      "--app-success-toast-surface",
      "--app-warning-toast-surface",
    ]);
  });

  it("adds ZERO cycle facts and leaves the 22-finding census exactly where it was", () => {
    const resolved = resolveCss(fixtureCss());
    expect(resolved.tokens.filter((t) => t.kind === "cycle")).toEqual([]);
    const report = audit(resolved);
    expect(report.countsByRule["cycle-reference"]).toBe(0);
    expect(report.findings).toHaveLength(22);
  });

  it("the fixture's printed report keeps its bytes — the summary line is unmoved", () => {
    const result = run(FIXTURE_PATH);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("cycle-reference (0)");
    expect(result.stdout).toContain(
      "22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference, 0 cycle-reference, 0 duplicate-declaration, 0 unresolved-import, 0 theme-partial-token.",
    );
  });
});
