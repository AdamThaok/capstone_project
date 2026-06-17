import { describe, it, expect } from "vitest";
import { generateTraceabilityMd } from "@/opm/pipeline/opm/traceability";

describe("generateTraceabilityMd", () => {
    const opm = {
        objects: [
            { id: "O1", name: "Customer", states: [] },
            { id: "O2", name: "Order",    states: ["Pending", "Paid"] },
        ],
        processes: [
            { id: "P1", name: "Place Order" },
            { id: "P3", name: "Process Payment" },
        ],
        links: [
            { id: "L1", type: "agent",        from: "O1", to: "P1" },
            { id: "L5", type: "state-change", from: "O2.Pending", to: "O2.Paid", via: "P3" },
        ],
    };
    const spec = {
        domainModel: { entities: [
            { name: "Customer", source: "O1" },
            { name: "Order",    source: "O2" },
        ] },
        api: { endpoints: [
            { method: "POST", path: "/orders",          source: "P1", op: "create" },
            { method: "POST", path: "/orders/:id/pay",  source: "P3", op: "transition", transition: "Pending->Paid" },
        ] },
    };

    it("includes every OPM object id", () => {
        const md = generateTraceabilityMd(opm, spec);
        expect(md).toContain("`O1`");
        expect(md).toContain("`O2`");
    });

    it("includes every OPM process id and its endpoint", () => {
        const md = generateTraceabilityMd(opm, spec);
        expect(md).toContain("`P1`");
        expect(md).toContain("`P3`");
        expect(md).toContain("POST /orders");
        expect(md).toContain("Pending->Paid");
    });

    it("renders state-bearing object states as a table row", () => {
        const md = generateTraceabilityMd(opm, spec);
        expect(md).toContain("`Pending`");
        expect(md).toContain("`Paid`");
    });

    it("renders every link with its software construct hint", () => {
        const md = generateTraceabilityMd(opm, spec);
        expect(md).toContain("`L1`");
        expect(md).toContain("`L5`");
        expect(md).toContain("transition endpoint");
    });

    it("never throws on empty input", () => {
        expect(() => generateTraceabilityMd({}, {})).not.toThrow();
    });
});
