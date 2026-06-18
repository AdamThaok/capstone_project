import { describe, it, expect } from "vitest";
import { decideHalt } from "@/opm/pipeline/agents/orchestrator";

describe("decideHalt (stopping conditions)", () => {
    it("SUCCESS when all checks pass", () => {
        expect(decideHalt({ passed: true, iter: 0, maxIters: 3, signature: "", lastSignature: "" })).toBe("SUCCESS");
    });

    it("EXHAUSTED when the iteration budget is spent", () => {
        expect(decideHalt({ passed: false, iter: 3, maxIters: 3, signature: "a", lastSignature: "b" })).toBe("EXHAUSTED");
    });

    it("STALLED when the same failures recur", () => {
        expect(decideHalt({ passed: false, iter: 1, maxIters: 3, signature: "x|y", lastSignature: "x|y" })).toBe("STALLED");
    });

    it("RUNNING when failing, under budget, and making progress", () => {
        expect(decideHalt({ passed: false, iter: 1, maxIters: 3, signature: "x", lastSignature: "y" })).toBe("RUNNING");
    });

    it("does not call an empty signature a stall on the first pass", () => {
        expect(decideHalt({ passed: false, iter: 0, maxIters: 3, signature: "", lastSignature: "" })).toBe("RUNNING");
    });

    it("SUCCESS takes priority over an exhausted budget", () => {
        expect(decideHalt({ passed: true, iter: 5, maxIters: 3, signature: "", lastSignature: "" })).toBe("SUCCESS");
    });
});
