import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT_ERROR, EXIT_FINDINGS, EXIT_OK, runCli, type CliIo } from "../src/cli.js";
import {
  CONFIG_FILENAME,
  ConfigError,
  loadConfig,
  parseConfig,
} from "../src/config.js";
import { audit } from "../src/audit.js";
import { resolveCss } from "../src/resolve.js";
import { FIXTURE_PATH, fixtureCss } from "./fixture.js";

/**
 * `themeguard.config.json` — the suppression slice.
 *
 * Three layers, tested at the layer that owns the behaviour:
 *
 *   - `parseConfig` is PURE, so every validation rule is a data-in,
 *     error-out assertion — including the rule that an unhonourable entry is
 *     an ERROR naming the entry, never a silent skip.
 *   - `loadConfig` owns the discovery rule: the config is read from the
 *     directory of the STYLESHEET, not from the process CWD. That choice is
 *     what makes the feature testable through the existing tmp-fixture pattern
 *     (the harness writes fixtures into a mkdtemp dir while the process stays
 *     at the repo root) and deterministic for the `themeguard <file.css>`
 *     usage — the config that governs a file is the one beside it.
 *   - `runCli` and the built `dist/cli.js` own the report and the exit codes:
 *     suppressed findings move to their own counted section, the counts and
 *     the total line shrink to the unsuppressed, and the exit computes over
 *     unsuppressed only — so a fully-suppressed stylesheet finally exits 0.
 *
 * The census repeated here is the one `rules.test.ts` and `cli.test.ts` pin
 * (11 / 2 / 2 / 7 = 22). Suppressing the two scale-collapse findings must land
 * on 11 / 2 / 0 / 7 = 20 — the findings move, they do not vanish.
 */

const repo = fileURLToPath(new URL("..", import.meta.url));

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

/**
 * A stylesheet with exactly ONE finding — a hover 2.43 L* from its resting
 * value — and nothing else: both tokens are referenced (no dead token), the
 * values differ (no collision), and there is one theme (no family finding).
 * It is the stylesheet that proves the exit contract: suppress its one finding
 * and the run exits 0.
 */
const ONE_FINDING_CSS = `
:root {
  --panel: #202020;
  --panel-hover: #252525;
}

.panel { background: var(--panel); }
.panel:hover { background: var(--panel-hover); }
`;

const tmp = mkdtempSync(join(tmpdir(), "themeguard-config-"));

function writeConfig(dir: string, json: string): string {
  const path = join(dir, CONFIG_FILENAME);
  writeFileSync(path, json, "utf8");
  return path;
}

function cssFixture(name: string, css: string): string {
  const path = join(tmp, name);
  writeFileSync(path, css, "utf8");
  return path;
}

/** The vendored fixture, copied out beside the repo — so a config can sit next to a copy of it without touching `tests/fixtures/` (whose census every other suite pins). */
const FIXTURE_COPY = cssFixture("fixture-copy.css", fixtureCss());
const ONE_FINDING_PATH = cssFixture("one-finding.css", ONE_FINDING_CSS);

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("parseConfig — what the package can honour", () => {
  it("reads entries from the documented shape", () => {
    expect(
      parseConfig(
        JSON.stringify({
          suppress: [
            {
              rule: "scale-collapse",
              token: "--app-accent-ink-hover",
              reason: "deliberately subtle hover",
            },
          ],
        }),
        "mem/config.json",
      ),
    ).toEqual([
      {
        rule: "scale-collapse",
        token: "--app-accent-ink-hover",
        reason: "deliberately subtle hover",
      },
    ]);
  });

  it("accepts an empty suppress list, and a config with no suppress key", () => {
    expect(parseConfig('{"suppress": []}', "mem/config.json")).toEqual([]);
    expect(parseConfig("{}", "mem/config.json")).toEqual([]);
  });

  it("rejects an unknown rule id, naming the entry and the known rules", () => {
    const error = (() => {
      try {
        parseConfig(
          JSON.stringify({
            suppress: [{ rule: "scale-colapse", token: "--x", reason: "r" }],
          }),
          "mem/config.json",
        );
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error("expected parseConfig to throw");
    })();
    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain("entry 1 of \"suppress\"");
    expect(error.message).toContain('"scale-colapse"');
    expect(error.message).toContain("collision, dead-token, scale-collapse, family-consistency, unresolved-reference");
  });

  it("rejects a missing token, naming the entry", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "token" must be a non-empty string/);
  });

  it("rejects a missing reason — a suppression without a why cannot be quoted back", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", token: "--x" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "reason" must be a non-empty string/);
  });

  it("rejects an unknown TOP-LEVEL key — a typo like 'rules' would otherwise suppress nothing, silently", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ rules: [{ rule: "dead-token", token: "--x", reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/unknown key "rules" — expected "suppress"/);
  });

  it("rejects an unknown key inside an entry, naming the entry", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          suppress: [{ rule: "dead-token", toke: "--x", reason: "r" }],
        }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": unknown key "toke"/);
  });

  it("rejects unreadable JSON, with the syntax error", () => {
    expect(() => parseConfig("{ suppress: ", "mem/config.json")).toThrowError(
      /not valid JSON/,
    );
  });

  it("rejects a non-object config and a non-array suppress", () => {
    expect(() => parseConfig("[]", "mem/config.json")).toThrowError(
      /expected a JSON object with a "suppress" key/,
    );
    expect(() => parseConfig('{"suppress": true}', "mem/config.json")).toThrowError(
      /"suppress" must be an array/,
    );
  });

  it("rejects a non-object entry, naming its position", () => {
    expect(() => parseConfig('{"suppress": ["--x"]}', "mem/config.json")).toThrowError(
      /entry 1 of "suppress" must be an object/,
    );
  });

  it("reads the scoped shape: theme, and the tokens array form", () => {
    expect(
      parseConfig(
        JSON.stringify({
          suppress: [
            {
              rule: "collision",
              tokens: ["--app-cta", "--app-success"],
              theme: "root",
              reason: "cta deliberately equals success",
            },
            { rule: "dead-token", token: "--x", theme: "winter", reason: "kept for a theme" },
          ],
        }),
        "mem/config.json",
      ),
    ).toEqual([
      {
        rule: "collision",
        tokens: ["--app-cta", "--app-success"],
        theme: "root",
        reason: "cta deliberately equals success",
      },
      { rule: "dead-token", token: "--x", theme: "winter", reason: "kept for a theme" },
    ]);
  });

  it("rejects a malformed theme — non-string and empty string, naming the entry", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", token: "--x", theme: 5, reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "theme" must be a non-empty string/);
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", token: "--x", theme: "", reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "theme" must be a non-empty string/);
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", token: "--x", theme: null, reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "theme" must be a non-empty string/);
  });

  it("rejects a non-array tokens — a bare string is the scalar spelling, not a set of one", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", tokens: "--x", reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "tokens" must be a non-empty array/);
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", tokens: 7, reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "tokens" must be a non-empty array/);
  });

  it("rejects an EMPTY tokens array — under the every-name reading it would match every finding and suppress what was never judged", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", tokens: [], reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(
      /entry 1 of "suppress": "tokens" must be a non-empty array of token names — an empty array would match every finding/,
    );
  });

  it("rejects a non-string or empty tokens MEMBER, naming the entry", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "collision", tokens: ["--a", 5], reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "tokens" members must each be a non-empty string/);
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "collision", tokens: ["--a", ""], reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(/entry 1 of "suppress": "tokens" members must each be a non-empty string/);
  });

  it("rejects token AND tokens together — two spellings of one dimension is an ambiguity, named like every other refusal", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({
          suppress: [{ rule: "collision", token: "--a", tokens: ["--b"], reason: "r" }],
        }),
        "mem/config.json",
      ),
    ).toThrowError(
      /entry 1 of "suppress": "token" and "tokens" are two spellings of one dimension/,
    );
  });

  it("an entry with NEITHER token nor tokens keeps the scalar spelling's error, and now names the array form as the other way to satisfy it", () => {
    expect(() =>
      parseConfig(
        JSON.stringify({ suppress: [{ rule: "dead-token", reason: "r" }] }),
        "mem/config.json",
      ),
    ).toThrowError(
      /entry 1 of "suppress": "token" must be a non-empty string.*an entry carries "token" \(one name\) or "tokens" \(the set\)/s,
    );
  });
});

describe("loadConfig — discovery is stylesheet-adjacent, not CWD-adjacent", () => {
  it("returns null when the stylesheet's directory has no config", () => {
    // The tmp dir's other fixtures deliberately have no config beside them.
    expect(loadConfig(ONE_FINDING_PATH)).toBeNull();
  });

  it("reads the config from the stylesheet's directory — the process CWD (the repo root) has none, and that is not consulted", () => {
    const dir = join(tmp, "discovery");
    mkdirSync(dir);
    const cssPath = join(dir, "sheet.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(dir, JSON.stringify({ suppress: [] }));
    // If lookup were CWD-based this would find nothing (the repo root has no
    // themeguard.config.json); stylesheet-adjacent lookup finds the empty one.
    expect(loadConfig(cssPath)).toEqual([]);
  });

  it("errors when the config exists but cannot be read — never a silent skip", () => {
    const dir = join(tmp, "unreadable");
    mkdirSync(join(dir, CONFIG_FILENAME), { recursive: true }); // a DIRECTORY named like the config
    const cssPath = join(dir, "sheet.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    try {
      loadConfig(cssPath);
      throw new Error("expected loadConfig to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toContain("could not be read");
    }
  });
});

describe("audit(resolved, { suppressions }) — the additive second parameter", () => {
  const resolved = resolveCss(ONE_FINDING_CSS);
  const PLAIN = { rule: "scale-collapse", token: "--panel-hover", reason: "deliberately subtle" } as const;

  it("leaves the one-arg report untouched — suppressed is empty, findings are all of them", () => {
    const report = audit(resolved);
    expect(report.findings).toHaveLength(1);
    expect(report.suppressed).toEqual([]);
    expect(report.countsByRule["scale-collapse"]).toBe(1);
  });

  it("moves the matching finding to `suppressed` with the reason, and the counts shrink to the unsuppressed", () => {
    const report = audit(resolved, { suppressions: [PLAIN] });
    expect(report.findings).toHaveLength(0);
    expect(report.countsByRule["scale-collapse"]).toBe(0);
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.rule).toBe("scale-collapse");
    expect(report.suppressed[0]?.finding.tokens).toContain("--panel-hover");
    // The measurement travels with the finding — a suppressed verdict can
    // still be checked rather than taken.
    expect(report.suppressed[0]?.finding.evidence["deltaLstar"]).toBeDefined();
    expect(report.suppressed[0]?.reason).toBe("deliberately subtle");
  });

  it("suppresses on ANY token the finding carries, and not on a wrong rule or a wrong token", () => {
    // The finding's tokens are [--panel-hover, --panel]; either name matches.
    expect(audit(resolved, { suppressions: [{ ...PLAIN, token: "--panel" }] }).suppressed).toHaveLength(1);
    // Right token, wrong rule — no match.
    expect(audit(resolved, { suppressions: [{ ...PLAIN, rule: "collision" }] }).findings).toHaveLength(1);
    // Right rule, token the finding does not carry — no match.
    expect(
      audit(resolved, { suppressions: [{ ...PLAIN, token: "--app-accent-ink-hover" }] }).findings,
    ).toHaveLength(1);
  });

  it("suppresses a finding once even when two entries match it, and the first entry supplies the reason", () => {
    const report = audit(resolved, {
      suppressions: [PLAIN, { ...PLAIN, reason: "second opinion" }],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.reason).toBe("deliberately subtle");
  });

  it("keeps the census pinned over the vendored fixture, one-arg — the resolver and rules are untouched", () => {
    const report = audit(resolveCss(fixtureCss()));
    expect(report.countsByRule).toEqual({
      collision: 11,
      "dead-token": 2,
      "scale-collapse": 2,
      "family-consistency": 7,
      "unresolved-reference": 0,
    });
    expect(report.suppressed).toEqual([]);
  });
});

/**
 * Two themes, one deliberate collision and one accidental one — the shape the
 * scoping fields exist for. Root holds `--accent` equal to `--success` (the
 * deliberate pair; winter shows the two roles apart); winter holds `--danger`
 * equal to `--success` (accidental; nothing witnesses it as intended). The
 * sheet produces EXACTLY two findings, both `collision`, so every assertion
 * below is over a fully known report.
 */
const TWO_THEME_CSS = `
:root {
  --accent: #ff0000;
  --success: #ff0000;
}

[data-theme="winter"] {
  --accent: #00ff00;
  --success: #0000ff;
  --danger: #0000ff;
}

.a { color: var(--accent); }
.s { color: var(--success); }
.d { border-color: var(--danger); }
`;

/** One stylesheet-wide dead token: a finding with `theme: null`, the case a theme-scoped entry must NOT touch. */
const DEAD_TOKEN_CSS = `
:root {
  --used: #101010;
  --unused: #202020;
}
.x { color: var(--used); }
`;

describe("audit(resolved, { suppressions }) — the scope dimensions", () => {
  const resolved = resolveCss(TWO_THEME_CSS);

  it("reports exactly the two collisions the fixture was built to hold, with their themes and token pairs", () => {
    expect(resolved.themes).toEqual(["root", "winter"]);
    expect(audit(resolved).countsByRule).toEqual({
      collision: 2,
      "dead-token": 0,
      "scale-collapse": 0,
      "family-consistency": 0,
      "unresolved-reference": 0,
    });
    expect(audit(resolved).findings.map((f) => [f.theme, f.tokens])).toEqual([
      ["root", ["--accent", "--success"]],
      ["winter", ["--danger", "--success"]],
    ]);
  });

  it("a theme-scoped entry suppresses only ITS theme's finding — the other theme's finding still reports", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", token: "--success", theme: "root", reason: "root: cta deliberately equals success" },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.theme).toBe("root");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.theme).toBe("winter");
    expect(report.findings[0]?.tokens).toEqual(["--danger", "--success"]);
    expect(report.countsByRule.collision).toBe(1);
  });

  it("an unscoped entry matches every theme — exactly today's behaviour, pinned so the field stays opt-in", () => {
    const report = audit(resolved, {
      suppressions: [{ rule: "collision", token: "--success", reason: "fleet-wide on purpose" }],
    });
    expect(report.suppressed).toHaveLength(2);
    expect(report.findings).toHaveLength(0);
  });

  it("a tokens-pair entry matches only findings carrying ALL the named tokens — findings with other partners stay live", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", tokens: ["--accent", "--success"], theme: "root", reason: "the deliberate pair, as one entry" },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
    expect(report.suppressed[0]?.finding.tokens).toEqual(["--accent", "--success"]);
    // Winter's pair [--danger, --success] carries --success but not --accent:
    // one shared member is not the judged pair.
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.tokens).toEqual(["--danger", "--success"]);
  });

  it("a tokens entry is order-insensitive over the finding's set — the SET is matched, not the message order", () => {
    const report = audit(resolved, {
      suppressions: [
        { rule: "collision", tokens: ["--success", "--accent"], theme: "root", reason: "same pair, reversed" },
      ],
    });
    expect(report.suppressed).toHaveLength(1);
  });

  it("a theme-scoped entry does NOT match a theme-less finding — dead-token carries theme: null, and null never equals a name", () => {
    const deadResolved = resolveCss(DEAD_TOKEN_CSS);
    const scoped = audit(deadResolved, {
      suppressions: [{ rule: "dead-token", token: "--unused", theme: "root", reason: "scoped" }],
    });
    expect(scoped.findings).toHaveLength(1);
    expect(scoped.findings[0]?.theme).toBeNull();
    expect(scoped.suppressed).toHaveLength(0);
    // The unscoped spelling still reaches it — the scoping is opt-in.
    const unscoped = audit(deadResolved, {
      suppressions: [{ rule: "dead-token", token: "--unused", reason: "unscoped" }],
    });
    expect(unscoped.findings).toHaveLength(0);
    expect(unscoped.suppressed).toHaveLength(1);
  });

  it("carries the MATCHED entry on the suppressed leg, so a reader can see the scope the judgement declared", () => {
    const entry = { rule: "collision", tokens: ["--accent", "--success"], theme: "root", reason: "why" } as const;
    const report = audit(resolved, { suppressions: [entry] });
    expect(report.suppressed[0]?.entry).toEqual(entry);
    // And an unscoped entry carries itself — absence of scope is legible.
    const bare = { rule: "collision", token: "--success", reason: "why" } as const;
    expect(audit(resolved, { suppressions: [bare] }).suppressed[0]?.entry).toEqual(bare);
  });
});

describe("themeguard <file.css> with themeguard.config.json beside the stylesheet", () => {
  it("absent config: the full census, exit 1, and the suppressed section headlines at zero", () => {
    const result = run(FIXTURE_COPY);
    expect(result.stdout).toContain("collision (11)");
    expect(result.stdout).toContain("scale-collapse (2)");
    expect(result.stdout).toContain("22 findings: 11 collision, 2 dead-token, 2 scale-collapse, 7 family-consistency, 0 unresolved-reference.");
    // Counted-not-silent, even at zero — the visible proof nothing was set aside.
    expect(result.stdout).toContain("suppressed (0)");
    expect(result.stdout).toContain(
      "nothing suppressed — every finding above is one the report stands behind.",
    );
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("suppressing the fixture's two deliberate hovers: scale-collapse (0), a named suppressed section with quoted reasons, and 20 findings on the total line", () => {
    const dir = join(tmp, "suppress-hover");
    mkdirSync(dir);
    const cssPath = join(dir, "fixture.css");
    writeFileSync(cssPath, fixtureCss(), "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          {
            rule: "scale-collapse",
            token: "--app-accent-ink-hover",
            reason: "deliberately subtle hover, reviewed in the calibration pass",
          },
        ],
      }),
    );
    const result = run(cssPath);
    expect(result.stdout).toContain("scale-collapse (0)");
    expect(result.stdout).toContain("suppressed (2)");
    // Both moved findings are named, under their rule, with the reason quoted.
    const suppressedLines = result.out.filter((l) => l.startsWith("  [suppressed] [scale-collapse]"));
    expect(suppressedLines).toHaveLength(2);
    for (const line of suppressedLines) {
      expect(line).toContain("--app-accent-ink-hover");
      expect(line).toContain('"deliberately subtle hover, reviewed in the calibration pass"');
    }
    // The counts and the total reflect the UNSUPPRESSED population only.
    expect(result.stdout).toContain(
      "20 findings: 11 collision, 2 dead-token, 0 scale-collapse, 7 family-consistency, 0 unresolved-reference.",
    );
    // Findings remain → exit 1; suppression is not a blanket clean bill.
    expect(result.code).toBe(EXIT_FINDINGS);
    // And nothing was dropped silently: 20 reported + 2 suppressed = the pinned 22.
    expect(
      result.out.filter((l) => /^ {2}\[(collision|dead-token|scale-collapse|family-consistency|unresolved-reference)\]/.test(l)),
    ).toHaveLength(20);
  });

  it("suppressing the ONLY finding flips the exit to 0 — the point of the config", () => {
    const dir = join(tmp, "suppress-all");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          { rule: "scale-collapse", token: "--panel-hover", reason: "checked by eye; intentional" },
        ],
      }),
    );
    const result = run(cssPath);
    expect(result.stdout).toContain("No findings.");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain('  [suppressed] [scale-collapse] --panel-hover is ΔL* 2.43 from --panel in theme "root"');
    expect(result.stdout).toContain('"checked by eye; intentional"');
    expect(result.code).toBe(EXIT_OK);
  });

  it("a valid entry that matches nothing is not an error — the finding it missed is still reported, and still moves the exit", () => {
    const dir = join(tmp, "unmatched");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          { rule: "scale-collapse", token: "--token-that-exists-nowhere", reason: "stale entry" },
        ],
      }),
    );
    const result = run(cssPath);
    expect(result.code).toBe(EXIT_FINDINGS);
    expect(result.stdout).toContain("scale-collapse (1)");
    expect(result.stdout).toContain("suppressed (0)");
  });

  it("an unknown rule id exits 2 naming the entry, and prints no report", () => {
    const dir = join(tmp, "bad-rule");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [{ rule: "scale-colapse", token: "--panel-hover", reason: "typo" }],
      }),
    );
    const result = run(cssPath);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("invalid themeguard.config.json");
    expect(result.stderr).toContain('entry 1 of "suppress"');
    expect(result.stderr).toContain('"scale-colapse"');
    expect(result.out).toEqual([]);
  });

  it("unreadable JSON exits 2 naming the file", () => {
    const dir = join(tmp, "bad-json");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(dir, "{ suppress: ");
    const result = run(cssPath);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain("invalid themeguard.config.json");
    expect(result.stderr).toContain("not valid JSON");
    expect(result.out).toEqual([]);
  });

  it("a missing token exits 2 naming the entry — same contract as the other malformed shapes", () => {
    const dir = join(tmp, "bad-token");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(dir, JSON.stringify({ suppress: [{ rule: "scale-collapse", reason: "no token" }] }));
    const result = run(cssPath);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain('entry 1 of "suppress": "token" must be a non-empty string');
    expect(result.out).toEqual([]);
  });

  it("a stylesheet-adjacent config governs the file regardless of where the process runs — and a directory without one is untouched", () => {
    // The suppressed run above (suppress-hover) and the bare fixture copy run
    // (FIXTURE_COPY) read the SAME stylesheet content; only the config sitting
    // BESIDE one copy differs. The process CWD is the repo root in both runs,
    // which has no config at all — so a CWD lookup could not have produced the
    // suppression, and a missing config demonstrably changes nothing.
    const bare = run(FIXTURE_COPY);
    expect(bare.stdout).toContain("22 findings");
    expect(bare.stdout).toContain("suppressed (0)");
  });

  it("a theme-scoped entry suppresses only its theme's finding: the other theme's finding still reports and the exit stays 1", () => {
    const dir = join(tmp, "scoped-theme");
    mkdirSync(dir);
    const cssPath = join(dir, "two-theme.css");
    writeFileSync(cssPath, TWO_THEME_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          { rule: "collision", token: "--success", theme: "root", reason: "root: cta deliberately equals success" },
        ],
      }),
    );
    const result = run(cssPath);
    // Root's finding moved; winter's accidental one did not.
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.stdout).toContain("1 finding: 1 collision, 0 dead-token, 0 scale-collapse, 0 family-consistency, 0 unresolved-reference.");
    expect(result.out.some((l) => l.startsWith("  [collision] --danger and --success"))).toBe(true);
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("the SAME config without the theme suppresses BOTH findings — the fleet-wide stroke scoped entries exist to narrow, kept as the back-compat pin", () => {
    const dir = join(tmp, "unscoped-fleet");
    mkdirSync(dir);
    const cssPath = join(dir, "two-theme.css");
    writeFileSync(cssPath, TWO_THEME_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [{ rule: "collision", token: "--success", reason: "deliberate in every theme" }],
      }),
    );
    const result = run(cssPath);
    expect(result.stdout).toContain("collision (0)");
    expect(result.stdout).toContain("suppressed (2)");
    expect(result.stdout).toContain("No findings.");
    expect(result.code).toBe(EXIT_OK);
  });

  it("a tokens-pair entry matches the pair and leaves findings with other partners live", () => {
    const dir = join(tmp, "scoped-tokens");
    mkdirSync(dir);
    const cssPath = join(dir, "two-theme.css");
    writeFileSync(cssPath, TWO_THEME_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          {
            rule: "collision",
            tokens: ["--accent", "--success"],
            theme: "root",
            reason: "root: cta deliberately equals success",
          },
        ],
      }),
    );
    const result = run(cssPath);
    expect(result.stdout).toContain("collision (1)");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.code).toBe(EXIT_FINDINGS);
  });

  it("a scoped entry says so where its finding is printed: [theme: …] and [tokens: …] after the reason; an unscoped line is byte-identical to before", () => {
    const dir = join(tmp, "scope-disclosure");
    mkdirSync(dir);
    const cssPath = join(dir, "two-theme.css");
    writeFileSync(cssPath, TWO_THEME_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [
          {
            rule: "collision",
            tokens: ["--accent", "--success"],
            theme: "root",
            reason: "root: cta deliberately equals success",
          },
          { rule: "collision", tokens: ["--danger", "--success"], reason: "winter pair, whole" },
        ],
      }),
    );
    const result = run(cssPath);
    const lines = result.out.filter((l) => l.startsWith("  [suppressed] [collision]"));
    expect(lines).toHaveLength(2);
    // Both scope segments, in one bracket, theme first.
    expect(lines[0]).toContain(
      `— "root: cta deliberately equals success" [theme: root, tokens: --accent, --success]`,
    );
    // The tokens-only spelling, with no theme segment and no empty bracket.
    expect(lines[1]).toMatch(/— "winter pair, whole" \[tokens: --danger, --success\]$/);
    // An entry with no scope at all keeps today's exact line shape: the reason
    // is the last thing on the line, nothing appended.
    const bareDir = join(tmp, "scope-disclosure-bare");
    mkdirSync(bareDir);
    writeFileSync(join(bareDir, "two-theme.css"), TWO_THEME_CSS, "utf8");
    writeConfig(
      bareDir,
      JSON.stringify({
        suppress: [{ rule: "collision", token: "--success", reason: "unscoped, as always" }],
      }),
    );
    const bare = run(join(bareDir, "two-theme.css"));
    for (const line of bare.out.filter((l) => l.startsWith("  [suppressed] [collision]"))) {
      expect(line).toMatch(/— "unscoped, as always"$/);
      expect(line).not.toContain("[theme:");
      expect(line).not.toContain("[tokens:");
    }
  });
});

describe("node dist/cli.js — the built artifact honours the config too", () => {
  const cli = join(repo, "dist", "cli.js");

  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: repo, stdio: "pipe" });
  }, 120_000);

  function spawn(...args: string[]): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [cli, ...args], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("suppresses beside the built binary: one finding moved, exit flips 1 → 0", () => {
    const dir = join(tmp, "built");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    // Absent config, through the built file: the finding stands, exit 1.
    expect(spawn(cssPath).code).toBe(EXIT_FINDINGS);
    writeConfig(
      dir,
      JSON.stringify({
        suppress: [{ rule: "scale-collapse", token: "--panel-hover", reason: "checked by eye; intentional" }],
      }),
    );
    const result = spawn(cssPath);
    expect(result.stdout).toContain("No findings.");
    expect(result.stdout).toContain("suppressed (1)");
    expect(result.code).toBe(EXIT_OK);
  }, 120_000);

  it("a malformed config is exit 2 through the built file, naming the entry", () => {
    const dir = join(tmp, "built-bad");
    mkdirSync(dir);
    const cssPath = join(dir, "one-finding.css");
    writeFileSync(cssPath, ONE_FINDING_CSS, "utf8");
    writeConfig(
      dir,
      JSON.stringify({ suppress: [{ rule: "no-such-rule", token: "--panel-hover", reason: "r" }] }),
    );
    const result = spawn(cssPath);
    expect(result.code).toBe(EXIT_ERROR);
    expect(result.stderr).toContain('entry 1 of "suppress"');
    expect(result.stderr).toContain('"no-such-rule"');
  }, 120_000);

  it("the installed surface is unchanged in shape: dist ships the config module", () => {
    // config.ts compiles into dist/ alongside cli.js and index.js; the
    // tarball's `files` is dist/ wholesale, so the export map needs no change.
    expect(readFileSync(cli, "utf8")).toContain("suppressed");
  });
});
