import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { validateInput_stage0 } from "@/opm/pipeline/stages/stage0-validate";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let tmpDir: string;
let goodFile: string;
let emptyFile: string;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opm-validate-test-"));
    goodFile  = path.join(tmpDir, "diagram.xml");
    emptyFile = path.join(tmpDir, "empty.xml");
    await fs.writeFile(goodFile, "<opm></opm>");
    await fs.writeFile(emptyFile, "");
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("validateInput_stage0", () => {
    it("accepts a non-empty xml file", async () => {
        const r = await validateInput_stage0({ filename: "diagram.xml", format: "auto", filePath: goodFile });
        expect(r.valid).toBe(true);
    });

    it("rejects an empty file", async () => {
        const r = await validateInput_stage0({ filename: "empty.xml", format: "auto", filePath: emptyFile });
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/empty/i);
    });

    it("rejects unsupported extension", async () => {
        const r = await validateInput_stage0({ filename: "diagram.exe", format: "exe" });
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/unsupported/i);
    });

    it("accepts every documented OPM input format", async () => {
        const formats = ["xml", "json", "opx", "png", "jpg", "jpeg"];
        for (const f of formats) {
            const file = path.join(tmpDir, `t.${f}`);
            await fs.writeFile(file, "x");
            const r = await validateInput_stage0({ filename: `t.${f}`, format: "auto", filePath: file });
            expect(r.valid, `format ${f} should be accepted`).toBe(true);
        }
    });

    // Multi-file mode: book §4.3 Stage 1 hierarchical SD/SD1/SD2 zoom-ins.
    it("accepts a list of valid files", async () => {
        const sd  = path.join(tmpDir, "SD.xml");
        const sd1 = path.join(tmpDir, "SD1.png");
        await fs.writeFile(sd,  "<opm></opm>");
        await fs.writeFile(sd1, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header bytes
        const r = await validateInput_stage0({
            filenames: ["SD.xml", "SD1.png"],
            filePaths: [sd, sd1],
            format:    "auto",
        });
        expect(r.valid).toBe(true);
        expect(r.fileCount).toBe(2);
    });

    it("fails the whole job if ANY uploaded file is invalid", async () => {
        const sd    = path.join(tmpDir, "SD2.xml");
        const empty = path.join(tmpDir, "empty2.xml");
        await fs.writeFile(sd,    "<opm></opm>");
        await fs.writeFile(empty, "");
        const r = await validateInput_stage0({
            filenames: ["SD2.xml", "empty2.xml"],
            filePaths: [sd, empty],
            format:    "auto",
        });
        expect(r.valid).toBe(false);
        expect(r.error).toMatch(/empty/i);
    });
});
