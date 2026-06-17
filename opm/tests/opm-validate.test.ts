import { describe, it, expect } from "vitest";
import { validateOpmModel } from "@/opm/pipeline/opm/opm-validate";

describe("validateOpmModel", () => {
    it("accepts a clean object→process model with no errors", () => {
        const { errors } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order", states: ["pending"] }],
            processes: [{ id: "p1", name: "Paying" }],
            links:     [{ id: "l1", type: "consumption", from: "o1", to: "p1" }],
        });
        expect(errors).toEqual([]);
    });

    it("warns (advisory, non-blocking) on a procedural link between two objects (E202)", () => {
        const { errors, warnings } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order" }, { id: "o2", name: "Payment" }],
            processes: [{ id: "p1", name: "Paying" }],
            links:     [{ id: "bad", type: "consumption", from: "o1", to: "o2" }],
        });
        expect(warnings.some((w) => w.includes("E202"))).toBe(true);
        expect(errors).toEqual([]); // advisory — must not block generation
    });

    it("warns (advisory, non-blocking) on structural aggregation mixing object and process (E204)", () => {
        const { errors, warnings } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order" }],
            processes: [{ id: "p1", name: "Paying" }],
            links:     [{ id: "bad", type: "aggregation", from: "o1", to: "p1" }],
        });
        expect(warnings.some((w) => w.includes("E204"))).toBe(true);
        expect(errors).toEqual([]); // advisory — must not block generation
    });

    it("allows exhibition to cross object↔process (no error)", () => {
        const { errors } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order" }],
            processes: [{ id: "p1", name: "Paying" }],
            links:     [{ id: "ok", type: "exhibition", from: "p1", to: "o1" }],
        });
        expect(errors).toEqual([]);
    });

    it("blocks a model with zero processes (ERR-FUNC-001)", () => {
        const { errors } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order" }],
            processes: [],
            links:     [],
        });
        expect(errors.some((e) => e.includes("ERR-FUNC-001"))).toBe(true);
    });

    it("does not block on unresolved link endpoints", () => {
        const { errors } = validateOpmModel({
            objects:   [{ id: "o1", name: "Order" }],
            processes: [{ id: "p1", name: "Paying" }],
            links:     [{ id: "x", type: "consumption", from: "ghost1", to: "ghost2" }],
        });
        expect(errors).toEqual([]);
    });
});
