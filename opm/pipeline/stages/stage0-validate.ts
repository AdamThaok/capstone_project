// Stage 0: Validate Input Format & Check Completeness.
//
// Now multi-file aware (book §4.3 Stage 1 Hierarchical views): the user may
// upload SD + SD1 + SD2 ... as separate files. Stage 0 validates EACH file;
// the whole job aborts only if at least one file is invalid.

import fs from "node:fs/promises";
import { getFileArrays } from "../infra/files";

const SUPPORTED = ["xml", "json", "opx", "png", "jpg", "jpeg", "pdf", "image", "auto"];

type FileCheck = {
    filename:       string;
    detectedFormat: string;
    size:           number;
    valid:          boolean;
    error:          string | null;
};

async function checkOne(
    filename: string,
    format:   string,
    filePath: string | undefined,
): Promise<FileCheck> {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const fmt = format.toLowerCase();
    const extOk = SUPPORTED.includes(fmt) || SUPPORTED.includes(ext);

    let size = 0;
    let nonEmpty = false;
    if (filePath) {
        try {
            const st = await fs.stat(filePath);
            size = st.size;
            nonEmpty = size > 0;
        } catch {
            nonEmpty = false;
        }
    } else {
        nonEmpty = true; // no path given (legacy), trust caller
    }

    const ok = extOk && nonEmpty;
    return {
        filename,
        detectedFormat: ext || fmt,
        size,
        valid: ok,
        error: ok
            ? null
            : !extOk
                ? `Unsupported format: ${ext || fmt}. Expected XML/JSON/OPX/PNG/JPG/PDF.`
                : "Uploaded file is empty.",
    };
}

export async function validateInput_stage0(input: {
    // Multi-file mode: pass arrays.
    filenames?: string[];
    filePaths?: string[];
    // Legacy single-file mode (still used by tests and back-compat callers).
    filename?:  string;
    filePath?:  string;
    format:     string;
}) {
    const { filenames, filePaths } = getFileArrays(input);

    if (filenames.length === 0) {
        return {
            valid: false,
            files: [],
            checks: [
                { name: "extension supported", status: "fail" },
                { name: "non-empty",           status: "fail" },
                { name: "schema probe",        status: "skip" },
            ],
            error: "No files were provided.",
        };
    }

    const files: FileCheck[] = await Promise.all(
        filenames.map((name, i) => checkOne(name, input.format, filePaths[i])),
    );

    const allValid     = files.every((f) => f.valid);
    const firstFailure = files.find((f) => !f.valid);

    return {
        valid:  allValid,
        fileCount: files.length,
        files,
        checks: [
            { name: "extension supported", status: files.every((f) => !f.error?.startsWith("Unsupported")) ? "pass" : "fail" },
            { name: "non-empty",           status: files.every((f) => !f.error?.startsWith("Uploaded"))    ? "pass" : "fail" },
            { name: "schema probe",        status: "pass (mock)" },
        ],
        error: allValid
            ? null
            : `${firstFailure?.filename ?? "input"}: ${firstFailure?.error ?? "invalid"}`,
    };
}
