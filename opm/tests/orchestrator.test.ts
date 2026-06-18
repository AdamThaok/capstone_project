import { describe, it, expect } from "vitest";
import { decideHalt } from "@/opm/pipeline/agents/orchestrator";

describe("decideHalt (stopping conditions)", () => {
    it("SUCCESS when all checks pass", () => {
        expect(decideHalt({ passed: true, iter: 0, maxIters: 3, repeated: false })).toBe("SUCCESS");
    });

    it("EXHAUSTED when the iteration budget is spent", () => {
        expect(decideHalt({ passed: false, iter: 3, maxIters: 3, repeated: false })).toBe("EXHAUSTED");
    });

    it("STALLED when a failure set recurs (any prior iteration, not just the last)", () => {
        expect(decideHalt({ passed: false, iter: 2, maxIters: 5, repeated: true })).toBe("STALLED");
    });

    it("RUNNING when failing, under budget, and the failure set is new", () => {
        expect(decideHalt({ passed: false, iter: 1, maxIters: 3, repeated: false })).toBe("RUNNING");
    });

    it("SUCCESS takes priority over an exhausted budget", () => {
        expect(decideHalt({ passed: true, iter: 5, maxIters: 3, repeated: false })).toBe("SUCCESS");
    });

    it("EXHAUSTED takes priority over a stall", () => {
        expect(decideHalt({ passed: false, iter: 3, maxIters: 3, repeated: true })).toBe("EXHAUSTED");
    });
});
