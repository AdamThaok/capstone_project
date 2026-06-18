import { describe, it, expect } from "vitest";
import { runTests, signatureOf } from "@/opm/pipeline/agents/testing-agent";
import type { FileSpec, AgentIR } from "@/opm/pipeline/agents/types";

// A minimal artifact that satisfies the structural tier for ids O1 + P1.
const FILES: FileSpec[] = [
    { path: "README.md",          content: "# App\nimplements O1 and P1" },
    { path: "TRACEABILITY.md",    content: "O1 -> models.py; P1 -> main.py" },
    { path: "docker-compose.yml", content: "services:\n  # O1 P1" },
];

const irWith = (computation: string): AgentIR => ({
    objects:   [{ id: "O1", name: "Order" }],
    processes: [{ id: "P1", name: "Calc", computation }],
});

// Gemini is not configured in tests, so Tier 4 (acceptance) is skipped and the
// report is fully deterministic.
describe("testing-agent formula detector", () => {
    it("flags a computation with a dropped '*' operator", async () => {
        const report = await runTests(FILES, irWith("return (Mft/Math.pow(Lft,3))100;"));
        expect(report.passed).toBe(false);
        expect(report.failures.some((f) => f.kind === "invalid_formula" && f.id === "P1")).toBe(true);
    });

    it("accepts the same computation once the '*' is present", async () => {
        const report = await runTests(FILES, irWith("return (Mft/Math.pow(Lft,3))*100;"));
        expect(report.failures.some((f) => f.kind === "invalid_formula")).toBe(false);
    });

    it("accepts multi-statement computations (undefined vars are fine — parse only)", async () => {
        const report = await runTests(FILES, irWith("let w = period1Weight*pc1; return w;"));
        expect(report.failures.some((f) => f.kind === "invalid_formula")).toBe(false);
    });
});

describe("testing-agent structural detector", () => {
    it("flags an uncovered OPM id", async () => {
        const ir: AgentIR = { objects: [{ id: "O9" }], processes: [] };
        const report = await runTests(FILES, ir); // O9 not present anywhere
        expect(report.failures.some((f) => f.kind === "uncovered_id" && f.id === "O9")).toBe(true);
    });

    it("flags a missing required file", async () => {
        const partial: FileSpec[] = [{ path: "README.md", content: "O1 P1" }];
        const report = await runTests(partial, irWith("return 1;"));
        expect(report.failures.some((f) => f.kind === "missing_file")).toBe(true);
    });

    it("reports coverage for the dashboard", async () => {
        const report = await runTests(FILES, irWith("return 1;"));
        expect(report.coverage.total_elements).toBe(2); // O1 + P1
        expect(report.coverage.coverage_pct).toBe(100);
    });
});

describe("signatureOf", () => {
    it("is order-independent (stable for stall detection)", () => {
        const a = signatureOf([{ kind: "uncovered_id", id: "P1", detail: "" }, { kind: "missing_file", id: "README.md", detail: "" }]);
        const b = signatureOf([{ kind: "missing_file", id: "README.md", detail: "" }, { kind: "uncovered_id", id: "P1", detail: "" }]);
        expect(a).toBe(b);
    });
});
