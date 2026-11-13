import { describe, expect, it } from "vitest";
import { audit } from "../src/audit.js";
import { resolveCss } from "../src/resolve.js";
import { collisionRule } from "../src/rules/collision.js";
import { surfaceCandidates } from "../src/rules/tokens.js";
import { fixtureCss } from "./fixture.js";

const only = (css: string) => collisionRule(resolveCss(css));
const named = (css: string) => only(css).map((f) => `${f.theme} ${f.tokens.join(" == ")}`);

describe("collision — a surface and its own foreground (paired roles)", () => {
  // The d.css shape from the ticket: dark-only equality on two shadcn pairs.
  it("reports a dark-only equality of --primary / --primary-foreground and --card / --card-foreground", () => {
    const found = named(
      `:root { --primary:#2563eb; --primary-foreground:#fff; --card:#fff; --card-foreground:#111; }
       .dark { --primary:#3b82f6; --primary-foreground:#3b82f6; --card:#111; --card-foreground:#111; }
       .btn { background:var(--primary); color:var(--primary-foreground); }
       .c { background:var(--card); color:var(--card-foreground); }`,
    );
    expect(found).toContain("dark --primary == --primary-foreground");
    expect(found).toContain("dark --card == --card-foreground");
  });

  it("reports a root-only (single-theme) equality, whether or not the family head is declared", () => {
    expect(named(`:root { --primary:#2563eb; --primary-foreground:#2563eb; }`)).toEqual([
      "root --primary == --primary-foreground",
    ]);
    expect(
      named(`:root { --accent-surface:#2563eb; --accent-on-surface:#2563eb; }`),
    ).toEqual(["root --accent-on-surface == --accent-surface"]);
  });

  it("states the consequence and carries sites and corroboration", () => {
    const [f] = only(`:root { --primary:#2563eb;\n --primary-foreground:#2563eb; }`);
    expect(f?.message).toContain("painted in its own surface colour");
    expect(f?.evidence.corroboration).toBe("unwitnessed");
    expect(f?.evidence.pairedRole).toBe("--primary / --primary-foreground");
    expect(f?.sites?.map((s) => s.name)).toEqual(["--primary", "--primary-foreground"]);
  });

  it("is still reported when another theme restates the equality (lockstep does not exempt it)", () => {
    const found = named(
      `:root { --primary:#2563eb; --primary-foreground:#2563eb; }
       .dark { --primary:#3b82f6; --primary-foreground:#3b82f6; }`,
    );
    expect(found).toEqual(["root --primary == --primary-foreground", "dark --primary == --primary-foreground"]);
  });

  it("reports an inherited pair once, in the theme that declares it", () => {
    expect(
      named(
        `:root { --primary:#2563eb; --primary-foreground:#2563eb; --ink:#fff; }
         .dark { --ink:#000; }`,
      ),
    ).toEqual(["root --primary == --primary-foreground"]);
  });

  it("covers each foreground suffix and the --on-X prefix form", () => {
    for (const suffix of ["foreground", "fg", "text", "ink", "label", "contrast"]) {
      expect(named(`:root { --s:#123456; --s-${suffix}:#123456; }`)).toEqual([
        `root --s == --s-${suffix}`,
      ]);
    }
    // Two undeclared-head families: the generic path names it (sorted by head), once.
    expect(named(`:root { --primary:#123456; --on-primary:#123456; }`)).toEqual([
      "root --on-primary == --primary",
    ]);
    // Restated in another theme (lockstep) the generic path stays silent; the paired-role test does not.
    expect(
      named(
        `:root { --primary:#123456; --on-primary:#123456; }
         .dark { --primary:#abcdef; --on-primary:#abcdef; }`,
      ),
    ).toEqual(["root --primary == --on-primary", "dark --primary == --on-primary"]);
  });

  it("does not double-report a pair the generic path already names", () => {
    // Undeclared head: --accent-surface / --accent-on-surface are two families.
    expect(named(`:root { --accent-surface:#ff0000; --accent-on-surface:#ff0000; }`)).toHaveLength(1);
  });

  it("negative: a tone and its border sharing a value stays unreported", () => {
    expect(named(`:root { --warning:#f59e0b; --warning-border:#f59e0b; }`)).toEqual([]);
  });

  it("negative: different values, or a foreground-looking name with no surface declared, stay silent", () => {
    expect(named(`:root { --primary:#2563eb; --primary-foreground:#fff; }`)).toEqual([]);
    expect(named(`:root { --card-foreground:#111; --other:#222; }`)).toEqual([]);
  });

  it("alias negative: a foreground beside its own var() alias of the surface stays unreported", () => {
    expect(
      named(`:root { --primary:#2563eb; --primary-foreground: var(--primary); }`),
    ).toEqual([]);
  });

  it("is suppressible through the same rule id", () => {
    const css = `:root { --primary:#2563eb; --primary-foreground:#2563eb; }`;
    const r = audit(resolveCss(css), {
      suppressions: [{ rule: "collision", tokens: ["--primary", "--primary-foreground"], reason: "deliberate" }],
    });
    expect(r.countsByRule.collision).toBe(0);
    expect(r.suppressed).toHaveLength(1);
  });

  it("leaves the vendored fixture's 22-finding census unchanged", () => {
    const r = audit(resolveCss(fixtureCss()));
    expect(r.findings).toHaveLength(22);
    expect(r.countsByRule.collision).toBe(11);
  });

  it("surfaceCandidates proposes surfaces from spelling alone", () => {
    expect(surfaceCandidates("--card-fg")).toEqual(["--card"]);
    expect(surfaceCandidates("--md-sys-color-on-primary").sort()).toEqual([
      "--md-sys-color-primary",
    ]);
    expect(surfaceCandidates("--primary")).toEqual([]);
  });
});
