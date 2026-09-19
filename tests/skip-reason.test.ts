import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { formatReport, runCli, type CliIo } from "../src/cli.js";
import { resolveCss } from "../src/resolve.js";
import { scaleCollapseRule, type SkippedPair } from "../src/rules/scale-collapse.js";

/**
 * THE SKIPPED ROW'S REASON, SPLIT ON THE SKIP BRANCH'S OWN ARMS (0.1.25).
 *
 * `SkippedPair.reason` was a two-value union while the skip branch's single
 * condition —
 *
 *   from === undefined || to === undefined || from.kind !== "color" || to.kind !== "color"
 *
 * — already distinguished THREE whys and reported them all as `not-a-color`.
 * Two of the three were false statements about the stylesheet:
 *
 *   1. ABSENT. A pair declared only inside one theme's block is not in
 *      another theme's view at all. `resolved.token(name, theme)` reads the
 *      theme's COMPOSED table (`:root` flows into every view), so a miss
 *      means the name is declared in NEITHER `:root` NOR this theme — it is a
 *      sibling theme's token, which the report's own coverage section treats
 *      as ordinary reality one block away. There is no value in this view to
 *      be a colour or not, so the old row asserted something about nothing.
 *
 *   2. UNRESOLVABLE. `--u: var(--missing-token)` resolves to kind
 *      `"unresolved"`, and the SAME report's unresolved-reference section
 *      prints the real why (`--missing-token … no scope in this stylesheet
 *      declares it`). One token, two sections, contradictory diagnoses.
 *
 *   3. NOT-A-COLOUR. A length, a duration, a shadow list. The only population
 *      the string ever described truthfully — and the one whose bytes are
 *      UNCHANGED here, pinned by `rules.test.ts`'s `--gap`/`--gap-hover` arm
 *      and re-pinned below.
 *
 * The split is that condition read at its own `||` boundaries — the same
 * "reuse the matcher's own halves, never a twin" discipline 0.1.24 used — so
 * a fourth arm cannot appear in the report without appearing in the branch.
 *
 * Diagnosis, never suppression: no matching semantics move, `skipped` stays
 * outside the exit code, and the counts are the counts they always were.
 */

const tmp = mkdtempSync(join(tmpdir(), "themeguard-skip-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function fixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

function run(...args: string[]): { code: number; stdout: string } {
  const out: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: () => {} };
  const code = runCli(args, io);
  return { code, stdout: out.join("\n") };
}

function reasonOf(skipped: readonly SkippedPair[], base: string, theme: string): string | undefined {
  return skipped.find((s) => s.base === base && s.theme === theme)?.reason;
}

/**
 * The ticket's own probe stylesheet, carrying all three arms at once so they
 * are told apart rather than merely produced: a winter-local pair (absent
 * from `root` and from `summer`), an unresolved chain, and a pair of lengths.
 */
const THREE_ARMS_CSS = `:root {
  --gap: 4px;
  --gap-hover: 8px;
  --u: var(--missing-token);
  --u-hover: #123456;
  --panel: #0F172A;
  --panel-hover: #101A2C;
}
[data-theme="winter"] {
  --card-bg: #FFFFFF;
  --card-bg-hover: #FEFEFE;
}
[data-theme="summer"] {
  --panel: #222222;
}
.x { background: var(--gap) var(--u) var(--card-bg) var(--panel); }
.y { background: var(--gap-hover) var(--u-hover) var(--card-bg-hover) var(--panel-hover); }
`;

describe("rule 3 — the skip reason names WHICH silence it is", () => {
  const result = scaleCollapseRule(resolveCss(THREE_ARMS_CSS));

  it("calls a pair that lives only in a sibling theme ABSENT, not a non-colour", () => {
    // REVERT PROBE — collapse the absent arm back into the kind test and this
    // reads `not-a-color`, which claims `--card-bg` resolves to a non-colour
    // in `root`. It resolves to nothing there: the name is winter's.
    expect(reasonOf(result.skipped, "--card-bg", "root")).toBe("absent");
    expect(reasonOf(result.skipped, "--card-bg", "summer")).toBe("absent");
  });

  it("calls a pair whose chain found nothing UNRESOLVABLE, in the report's own vocabulary", () => {
    // The word the coverage section already prints for this token
    // (`N unresolved`) and the unresolved-reference section already explains.
    // Before the split, one report diagnosed `--u` two contradictory ways.
    for (const theme of ["root", "winter", "summer"]) {
      expect(reasonOf(result.skipped, "--u", theme)).toBe("unresolvable");
    }
  });

  it("keeps NOT-A-COLOR for the only population it ever described truthfully", () => {
    for (const theme of ["root", "winter", "summer"]) {
      expect(reasonOf(result.skipped, "--gap", theme)).toBe("not-a-color");
    }
  });

  it("still judges every measurable pair in the same stylesheet", () => {
    // The split touches the skip branch alone. The winter-local pair that is
    // ABSENT from root and summer is MEASURED in winter — the same pair, two
    // reasons and a finding across three views, which is exactly why the
    // reason is computed per theme rather than per pair.
    expect(result.findings.map((f) => `${f.theme}:${f.tokens.join()}`)).toEqual([
      "root:--panel,--panel-hover",
      "winter:--card-bg,--card-bg-hover",
      "winter:--panel,--panel-hover",
      "summer:--panel,--panel-hover",
    ]);
  });

  it("keeps the per-theme row-per-theme model — 8 rows for 3 pairs across 3 themes", () => {
    // Not this slice: a pair is skipped once PER THEME because the reason can
    // legitimately differ per view (`--card-bg` is absent in root and summer,
    // and measurable in winter). Pinned so the split is read as a reason
    // change and never as a de-duplication.
    expect(result.skipped).toHaveLength(8);
  });
});

describe("rule 3 — an ABSENT row names the scope the pair actually lives in", () => {
  const result = scaleCollapseRule(resolveCss(THREE_ARMS_CSS));
  const absent = result.skipped.find((s) => s.base === "--card-bg" && s.theme === "root");

  it("carries the declaring theme and each member's position", () => {
    expect(absent?.declaredIn).toEqual([
      { name: "--card-bg", theme: "winter", site: { name: "--card-bg", line: 10 } },
      { name: "--card-bg-hover", theme: "winter", site: { name: "--card-bg-hover", line: 11 } },
    ]);
  });

  it("omits the pointer entirely on every other reason — absence is a fact, never a null", () => {
    // The codebase's absence-is-a-fact discipline: a row that is not an
    // absence has no sibling scope to name, and a `null` there would invite a
    // reader to treat "no pointer" and "a pointer we could not build" as one
    // state.
    for (const row of result.skipped.filter((s) => s.reason !== "absent")) {
      expect("declaredIn" in row).toBe(false);
    }
  });

  it("names only the MISSING member when the other one resolves", () => {
    // `--side` is a root token present in every view; only its state is
    // theme-local, so the pointer speaks about `--side-hover` alone rather
    // than about a "pair" one half of which is right here.
    const css = `:root { --side: #FFFFFF; }
[data-theme="winter"] { --side-hover: #FEFEFE; }
[data-theme="summer"] { --side-hover: #EEEEEE; }
.x { background: var(--side) var(--side-hover); }
`;
    const row = scaleCollapseRule(resolveCss(css)).skipped.find((s) => s.theme === "root");
    expect(row?.reason).toBe("absent");
    expect(row?.declaredIn?.map((s) => `${s.name}@${s.theme}:${s.site.line}`)).toEqual([
      "--side-hover@winter:2",
      "--side-hover@summer:3",
    ]);
  });

  it("reads a media-query theme's block the same way a [data-theme] block is read", () => {
    // The scope vocabulary is the resolver's, not a selector match: a
    // `prefers-color-scheme` view is a theme like any other, so a pair living
    // only there is an absence with a nameable home.
    const css = `@media (prefers-color-scheme: dark) {
  :root { --mq: #101010; --mq-hover: #111111; }
}
:root { --keep: #FFFFFF; }
.x { background: var(--mq) var(--mq-hover) var(--keep); }
`;
    const row = scaleCollapseRule(resolveCss(css)).skipped.find((s) => s.theme === "root");
    expect(row?.reason).toBe("absent");
    expect(row?.declaredIn?.every((s) => s.theme === "dark")).toBe(true);
  });

  it("can only ever point at a theme's OWN block — the property the pointer rests on", () => {
    // Why an absent member's home is always a named theme's own block, and
    // never `:root` or the alias layer: both of those flow into EVERY view,
    // so a name carrying either is found everywhere and could not have been
    // absent from the view that skipped it. This pins the resolver property
    // directly, because the `origin === "declared"` filter the pointer runs
    // is unobservable on this population — relaxing it changes no output —
    // and a test asserting the filter would be asserting nothing.
    const sheet = resolveCss(
      `@theme inline { --al: var(--r); }\n:root { --r: #101010; }\n[data-theme="w"] { --tl: #202020; }\n`,
    );
    const origins = (name: string) =>
      sheet.themes.map((t) => sheet.token(name, t)?.origin ?? "ABSENT");
    // Found in every view — so never an absent member.
    expect(origins("--r")).toEqual(["declared", "inherited"]);
    expect(origins("--al")).toEqual(["theme-inline", "theme-inline"]);
    // The only shape that IS absent somewhere, and it is `declared` where found.
    expect(origins("--tl")).toEqual(["ABSENT", "declared"]);
  });

  it("names nothing rather than a wrong scope when no declaring block is found", () => {
    // The defensive arm, driven through the RENDERER rather than asserted on
    // a literal: `statePairs()` derives from declared names so the rule is
    // not expected to produce this, and if it ever does the row must say
    // only `absent` — no pointer, and certainly not a guessed scope.
    const base = audit(resolveCss(`:root { --keep: #FFFFFF; }\n.x { color: var(--keep); }\n`));
    const synthesized = {
      ...base,
      skipped: [{ theme: "root", base: "--x", state: "--x-hover", reason: "absent" } as SkippedPair],
    };
    const rendered = formatReport("synth.css", synthesized).join("\n");
    expect(rendered).toContain('[skipped] --x-hover against --x in theme "root": absent');
    expect(rendered).not.toContain("declared only");
  });
});

describe("rule 3 — a var() LOOP is unresolvable, not a non-colour", () => {
  it("reads kind cycle into the same arm kind unresolved lands in", () => {
    // A chain that came back around and a chain that found nothing are both
    // "this view has no value here", and both are diagnosed by their own
    // rule's section elsewhere in the report. Collapsing either into
    // `not-a-color` asserts a value exists and is the wrong sort.
    const css = `:root {
  --a: var(--b);
  --b: var(--a);
  --a-hover: #123456;
  --keep: #101010;
}
.x { background: var(--a) var(--a-hover) var(--keep); }
`;
    const result = scaleCollapseRule(resolveCss(css));
    expect(reasonOf(result.skipped, "--a", "root")).toBe("unresolvable");
  });
});

describe("the CLI renders each skip reason, and the absent row's pointer", () => {
  const path = fixture("three-arms.css", THREE_ARMS_CSS);
  const result = run(path);

  it("prints the absent row with the sibling scope and each member's line", () => {
    // REVERT PROBE — drop `siblingScopeClause` and this row says only that a
    // pair could not be measured in `root`, which reads exactly like "these
    // names are broken" for tokens that are perfectly healthy one block away.
    expect(result.stdout).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "root": absent — ' +
        'the pair is declared only in theme "winter" ' +
        "(--card-bg at line 10, --card-bg-hover at line 11)",
    );
  });

  it("prints the unresolvable row, agreeing with the unresolved-reference section above it", () => {
    expect(result.stdout).toContain(
      '[skipped] --u-hover against --u in theme "root": unresolvable',
    );
    // The same report, the same token, and now the two sections say the same
    // thing — this is the contradiction the split exists to remove.
    expect(result.stdout).toContain(
      "--missing-token is used at",
    );
  });

  it("prints the honest not-a-color row with its original bytes", () => {
    expect(result.stdout).toContain(
      '[skipped] --gap-hover against --gap in theme "root": not-a-color',
    );
  });

  it("does not move the exit code — skipped is still outside the verdict", () => {
    // The run exits 1 for its scale-collapse findings, and it would exit 1
    // with or without any of these rows: a skip is not a finding, before the
    // split or after it.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("skipped (8)");
  });

  it("cites by FILE when the declaring scope arrived over an @import edge", () => {
    // Line numbers are per-file and restart at 1 in every imported sheet, so
    // a bare `line 2` would point the reader into whichever file they had
    // open. The pointer goes through the same citation the finding clauses
    // use, so the closure spelling cannot drift from theirs.
    writeFileSync(
      join(tmp, "tokens.css"),
      `[data-theme="winter"] {\n  --card-bg: #FFFFFF;\n  --card-bg-hover: #FEFEFE;\n}\n`,
      "utf8",
    );
    const main = fixture(
      "main.css",
      `@import "./tokens.css";\n:root { --page: #101010; }\n.x { background: var(--page) var(--card-bg) var(--card-bg-hover); }\n`,
    );
    expect(run(main).stdout).toContain(
      '[skipped] --card-bg-hover against --card-bg in theme "root": absent — ' +
        'the pair is declared only in theme "winter" ' +
        "(--card-bg at tokens.css:2, --card-bg-hover at tokens.css:3)",
    );
  });
});

describe("--json carries the widened reason and the pointer additively", () => {
  const report = audit(resolveCss(THREE_ARMS_CSS));

  it("serializes the new reason values as plain strings — no shape change", () => {
    expect([...new Set(report.skipped.map((s) => s.reason))].sort()).toEqual([
      "absent",
      "not-a-color",
      "unresolvable",
    ]);
  });

  it("round-trips the pointer through JSON, and only on the absent rows", () => {
    const rows = JSON.parse(JSON.stringify(report.skipped)) as SkippedPair[];
    for (const row of rows) {
      expect("declaredIn" in row).toBe(row.reason === "absent");
    }
  });
});
