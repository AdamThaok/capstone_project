import { describe, it, expect } from "vitest";

// Mirrors the word-boundary regex used in stage5-validate.ts coverageCheck.
// Centralised here so a future refactor can share the helper.
function makeIdPattern(id: string): RegExp {
    return new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

describe("OPM id word-boundary regex", () => {
    it("matches the id as a standalone token", () => {
        expect(makeIdPattern("P1").test("// covers P1 here")).toBe(true);
        expect(makeIdPattern("O3").test("entity O3")).toBe(true);
    });

    it("does NOT match an id embedded inside a longer identifier", () => {
        // The legacy includes() check would have wrongly matched these.
        expect(makeIdPattern("P1").test("API1")).toBe(false);
        expect(makeIdPattern("P1").test("OP12")).toBe(false);
        expect(makeIdPattern("O3").test("TODO3")).toBe(false);
        expect(makeIdPattern("O3").test("NO3")).toBe(false);
    });

    it("matches across line breaks and punctuation", () => {
        expect(makeIdPattern("P1").test("function foo() {\n  // P1\n}")).toBe(true);
        expect(makeIdPattern("P1").test("traceability:P1.")).toBe(true);
    });

    it("escapes regex special characters in the id", () => {
        // Hypothetical id containing a dot — must not be treated as wildcard.
        const re = makeIdPattern("P.1");
        expect(re.test("P.1")).toBe(true);
        expect(re.test("Px1")).toBe(false);
    });
});
