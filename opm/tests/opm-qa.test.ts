import { describe, it, expect } from "vitest";
import { computeQaBlocking } from "@/opm/pipeline/stages/stage5-validate";

const t = (status: "pass" | "fail") => ({ objective: "obj", input: "in", expected: "exp", status });
const rev = (category: string) => ({ category, file: "f.py", context: "ctx", problem: "prob", suggestion: "fix" });

describe("computeQaBlocking", () => {
    it("does not block when all tests pass and no security findings", () => {
        const r = computeQaBlocking({
            acceptanceTests: [t("pass"), t("pass")],
            codeReview:      [rev("Architecture"), rev("Performance")],
        });
        expect(r.blocked).toBe(false);
        expect(r.blockingReasons).toEqual([]);
    });

    it("blocks when any acceptance test fails", () => {
        const r = computeQaBlocking({
            acceptanceTests: [t("pass"), t("fail")],
            codeReview:      [rev("Readability")],
        });
        expect(r.blocked).toBe(true);
        expect(r.blockingReasons.some((x) => /acceptance test/i.test(x))).toBe(true);
    });

    it("does NOT block on a security review point (advisory only)", () => {
        const r = computeQaBlocking({
            acceptanceTests: [t("pass")],
            codeReview:      [rev("Security")],
        });
        expect(r.blocked).toBe(false);
        expect(r.blockingReasons).toEqual([]);
    });

    it("treats ALL review categories as advisory when tests pass (no block)", () => {
        const r = computeQaBlocking({
            acceptanceTests: [t("pass")],
            codeReview:      [rev("Security"), rev("Performance"), rev("Error Handling"), rev("Readability")],
        });
        expect(r.blocked).toBe(false);
    });
});
