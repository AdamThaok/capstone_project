import { describe, it, expect } from "vitest";
import { parseDelimitedFiles, isComplete } from "@/opm/pipeline/stages/stage4-codegen";

describe("isComplete (truncation detection)", () => {
    it("is true when the stream ends with the file-end marker", () => {
        expect(isComplete("===FILE: a.py===\nx = 1\n===END===")).toBe(true);
        expect(isComplete("===FILE: a.py===\nx = 1\n===END===\n   ")).toBe(true);
    });
    it("is false when the last file is cut off mid-content", () => {
        expect(isComplete("===FILE: a.py===\nx = 1\ndef handler():")).toBe(false);
    });
});

describe("parseDelimitedFiles", () => {
    it("parses multiple complete files", () => {
        const text =
            "===FILE: backend/main.py===\nprint(\"hi\")\n===END===\n" +
            "===FILE: frontend/App.tsx===\nexport default 1\n===END===";
        const files = parseDelimitedFiles(text);
        expect(files.map(f => f.path)).toEqual(["backend/main.py", "frontend/App.tsx"]);
        expect(files[0].content).toBe('print("hi")');
        expect(files[1].content).toBe("export default 1");
    });

    it("reassembles a truncated stream concatenated with its continuation", () => {
        // First response cut off mid-file (no ===END===); continuation finishes it.
        const chunk1 = "===FILE: backend/main.py===\nl1\nl2\nl3\nl4\nl5\nl6"; // truncated
        const chunk2 = "\nl7\n===END===\n===FILE: b.py===\nb1\n===END===";    // continuation
        expect(isComplete(chunk1)).toBe(false);

        const files = parseDelimitedFiles(chunk1 + chunk2);
        expect(files.map(f => f.path)).toEqual(["backend/main.py", "b.py"]);
        expect(files[0].content).toContain("l1");
        expect(files[0].content).toContain("l7");
        expect(files[1].content).toBe("b1");
    });
});
