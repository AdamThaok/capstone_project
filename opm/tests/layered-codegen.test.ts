import { describe, it, expect } from "vitest";
import { summarizeInterfaces } from "@/opm/pipeline/agents/code-generation-agent";
import type { FileSpec } from "@/opm/pipeline/agents/types";

describe("summarizeInterfaces", () => {
    it("keeps signature lines and drops the bodies", () => {
        const files: FileSpec[] = [
            {
                path: "backend/models.py",
                content: [
                    "class Child(Base):",
                    "    __tablename__ = 'children'",
                    "    id = Column(Integer, primary_key=True)",
                    "    name = Column(String)",
                ].join("\n"),
            },
            {
                path: "backend/routers.py",
                content: [
                    "@router.post('/children')",
                    "def create_child(payload):",
                    "    return do_stuff(payload)   # body should be dropped",
                ].join("\n"),
            },
        ];

        const digest = summarizeInterfaces(files);

        // Keeps the interface-defining lines...
        expect(digest).toContain("class Child(Base):");
        expect(digest).toContain("@router.post('/children')");
        expect(digest).toContain("def create_child(payload):");
        // ...and the file headers...
        expect(digest).toContain("=== backend/models.py ===");
        // ...but drops the bodies / inner assignments.
        expect(digest).not.toContain("__tablename__");
        expect(digest).not.toContain("do_stuff");
    });

    it("notes files with no signatures instead of erroring", () => {
        const files: FileSpec[] = [{ path: "README.md", content: "# Hello\nsome prose" }];
        expect(summarizeInterfaces(files)).toContain("(no notable signatures)");
    });
});
