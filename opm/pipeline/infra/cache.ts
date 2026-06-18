// Prep cache — stages 1-3 (parse -> spec -> super-prompt) are DETERMINISTIC for
// a given input, so we cache their combined output keyed by a hash of the
// uploaded files. On a repeat run with the same file(s) we skip straight to
// Stage 4 (codegen), saving ~3 minutes + the Gemini calls every iteration.
//
// Stage 4 (codegen) is NOT cached — it's the slow, non-deterministic part you're
// usually iterating on.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

// BUMP this whenever you change a Stage 1-3 prompt (IR_SCHEMA_PROMPT, SPEC_PROMPT,
// or the Stage 3 super-prompt) so old cached results are invalidated.
const CACHE_VERSION = "v1";

const CACHE_DIR = path.join(os.tmpdir(), "opm-cache");

export type PrepCache = {
    opmModel:    unknown;
    spec:        unknown;
    superPrompt: { prompt: string; retrievedChunks?: number; models?: string[] };
};

function ensureDir() {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* exists */ }
}

// Key = hash of (cache version + format + every uploaded file's bytes).
export function computeCacheKey(filePaths: string[], format: string): string {
    const h = crypto.createHash("sha256");
    h.update(CACHE_VERSION);
    h.update(format);
    for (const p of filePaths) {
        try { h.update(fs.readFileSync(p)); }
        catch { h.update(p); }
    }
    return h.digest("hex").slice(0, 32);
}

export function readPrepCache(key: string): PrepCache | null {
    try {
        const raw = fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), "utf-8");
        return JSON.parse(raw) as PrepCache;
    } catch {
        return null;
    }
}

export function writePrepCache(key: string, data: PrepCache): void {
    ensureDir();
    try {
        fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data), "utf-8");
    } catch { /* best effort */ }
}

// Delete every cached entry. Returns how many were removed.
export function clearPrepCache(): number {
    ensureDir();
    let n = 0;
    try {
        for (const f of fs.readdirSync(CACHE_DIR)) {
            if (f.endsWith(".json")) {
                fs.rmSync(path.join(CACHE_DIR, f), { force: true });
                n++;
            }
        }
    } catch { /* ignore */ }
    return n;
}
