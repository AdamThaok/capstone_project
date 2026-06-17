import { describe, it, expect } from "vitest";
import { retrieveChunks, formatChunksForPrompt } from "@/opm/pipeline/opm/rag-retrieve";

const SAMPLE = {
    objects: [
        { id: "o1", name: "Order", states: ["pending", "paid"] },
        { id: "o2", name: "Payment" },
    ],
    processes: [{ id: "p1", name: "Paying" }],
    links: [
        { id: "l1", type: "consumption", from: "o2", to: "p1" },
        { id: "l2", type: "effect",      from: "p1", to: "o1" },
        { id: "l3", type: "agent",       from: "o1", to: "p1" },
    ],
};

describe("retrieveChunks", () => {
    it("always pins high-priority ontology chunks", () => {
        const chunks = retrieveChunks(SAMPLE);
        expect(chunks.some((c) => c.category === "ontology" && c.priority === "high")).toBe(true);
    });

    it("retrieves chunks for each link kind present in the model", () => {
        const concepts = retrieveChunks(SAMPLE).map((c) => c.concept.toLowerCase()).join(" ");
        expect(concepts).toContain("consumption");
        expect(concepts).toContain("effect");
        expect(concepts).toContain("agent");
    });

    it("includes state-related chunks when objects carry states", () => {
        const text = retrieveChunks(SAMPLE).map((c) => `${c.concept} ${c.topic}`.toLowerCase()).join(" ");
        expect(text).toContain("state");
    });

    it("caps the result and produces a citation-bearing prompt block", () => {
        const chunks = retrieveChunks(SAMPLE);
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.length).toBeLessThanOrEqual(28);
        expect(formatChunksForPrompt(chunks)).toMatch(/\[(ONT|PRO|STR|OPL|VAL)-\d+\]/);
    });

    it("returns only pinned ontology chunks for a model with no links/states", () => {
        const chunks = retrieveChunks({
            objects: [{ name: "Thing" }],
            processes: [{ name: "Doing" }],
            links: [],
        });
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.every((c) => c.category === "ontology")).toBe(true);
    });
});
