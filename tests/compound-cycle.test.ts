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
    expect(finding.tokens).toEqual(["--divider-color", "--divider"]);
    expect(finding.evidence?.["chain"]).toEqual([
      "--divider-color",
      "--divider",
      "--divider-color",
    ]);
    expect(finding.message).toContain(
      "--divider-color → --divider → --divider-color is a var() cycle",
    );
    expect(finding.message).toContain("invalid at computed-value time");
    expect(finding.sites?.map((s) => s.line)).toEqual([3, 2]);
  });

  it("the report the user reads flips from `No findings.` to the cycle section, exit 0 → 1", () => {
    const result = run(cssFixture("u1.css", css));
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).not.toContain("No findings.");
    expect(result.stdout).toContain("cycle-reference (1)");
    expect(result.stdout).toContain(
      "  [cycle-reference] --divider-color → --divider → --divider-color is a var() cycle: every property in the loop, and every var() consuming a member, is invalid at computed-value time. Declared at lines 3 and 2.",
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
    expect(result.stdout).toContain(
      "--divider-color → --divider → --divider-color is a var() cycle in theme \"dark\"",
    );
  });
});

describe("the canonical compound shapes all close, and each is ONE finding naming both members", () => {
  // The member that carries `kind: "cycle"` is the one whose OWN walk re-enters
  // the loop, and a compound value is not FOLLOWED — the walk has no
  // substituted value to continue with, the rest of the value being literal
  // text — so the walk that reaches the back edge is the one that STARTED at
  // the whole-value member. That is not a reporting gap: the finding's `tokens`
  // is the loop SET (the unique names in the chain), so both members are named
  // in the one finding either way, which is the shape U1 pins above.
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
  ])("%s", (_name, first, second, cyclicMember) => {
    const r = resolveCss(`:root { ${first} ${second} }`);
    expect(r.tokens.filter((t) => t.kind === "cycle").map((t) => t.name)).toEqual([
      cyclicMember,
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

  it("RESIDUAL, pinned: a tail whose walk ENTERS the loop through a compound value is not itself cyclic", () => {
    // `--tail: var(--a)` walks into `--a`, whose value is compound. The walk
    // stops there — a compound value is not followed — so `--tail` classifies
    // as the literal text it holds and is NOT marked cyclic, where a tail into
    // a WHOLE-VALUE loop is (`--a: var(--b); --b: var(--c); --c: var(--b)`
    // marks `--a` cycle with chain `--a → --b → --c → --b`). This is the
    // deliberate edge of the slice — the back-edge scan mints the loop's own
    // fact, it does not make compound values traversable — and the loop ITSELF
    // is still reported, so the defect is named and only the dependent
    // declaration goes unlisted.
    const r = resolveCss(
      `:root { --tail: var(--a); --a: 1px solid var(--b); --b: var(--a); }`,
    );
    expect(r.token("--tail", ROOT_THEME)?.kind).toBe("non-color");
    expect(r.token("--tail", ROOT_THEME)?.chain).toEqual(["--tail", "--a"]);

    // The loop is reported all the same, naming both of its members.
    const findings = audit(r).findings.filter((f) => f.rule === "cycle-reference");
    expect(findings).toHaveLength(1);
    expect([...findings[0]!.tokens].sort()).toEqual(["--a", "--b"]);

    // The whole-value tail, for contrast — unchanged by this slice.
    const whole = resolveCss(`:root { --a: var(--b); --b: var(--c); --c: var(--b); }`);
    expect(whole.token("--a", ROOT_THEME)?.kind).toBe("cycle");
    expect(whole.token("--a", ROOT_THEME)?.chain).toEqual(["--a", "--b", "--c", "--b"]);
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
