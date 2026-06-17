// Tests the multi-file IR merging in stage1-parse via the public parseOpm_stage1
// entry point. We don't have access to the internal mergeIRs export, but
// we can drive parseOpm_stage1 with multiple mock filenames and verify that the
// merged result has unioned objects/processes/links.

import { describe, it, expect } from "vitest";
import { parseOpm_stage1 } from "@/opm/pipeline/stages/stage1-parse";

describe("stage1 multi-file merge (mock mode, no API key)", () => {
    it("returns a single IR for one file", async () => {
        const ir = await parseOpm_stage1({ filenames: ["alpha.xml"], filePaths: [], format: "auto" });
        expect(ir.objects).toBeDefined();
        expect(Array.isArray(ir.objects)).toBe(true);
    });

    it("merges objects across multiple files (union by id)", async () => {
        const ir = await parseOpm_stage1({
            filenames: ["alpha.xml", "beta.xml", "gamma.xml"],
            filePaths: [],
            format:    "auto",
        });
        // Mock variants share O1 ids → after merge, that id appears exactly once.
        const ids = (ir.objects ?? []).map((o) => o.id);
        const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect(dups, `duplicate object ids after merge: ${dups.join(",")}`).toEqual([]);
    });

    it("renumbers links sequentially after merge", async () => {
        const ir = await parseOpm_stage1({
            filenames: ["a.xml", "b.xml"],
            filePaths: [],
            format:    "auto",
        });
        const ids = (ir.links ?? []).map((l) => l.id);
        // After merge link ids are L1, L2, L3, ... (sequential, no gaps).
        for (let i = 0; i < ids.length; i++) {
            expect(ids[i]).toBe(`L${i + 1}`);
        }
    });

    it("annotates metadata that the merge happened", async () => {
        const ir = await parseOpm_stage1({
            filenames: ["x.xml", "y.xml"],
            filePaths: [],
            format:    "auto",
        });
        const meta = (ir.metadata ?? {}) as Record<string, unknown>;
        expect(meta.mergedFromFiles).toBe(2);
    });
});
