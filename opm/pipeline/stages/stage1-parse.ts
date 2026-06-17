// Stage 1: OPM Analysis & Parsing.
//
// Multi-file aware (book §4.3 Stage 1 Hierarchical views: SD, SD1, SD2...):
// each uploaded file is parsed independently into a partial OPM IR; partial
// IRs are then MERGED into a single canonical IR. Object/process/link IDs
// are deduplicated by id (last-write-wins on conflict, but states arrays
// are unioned). This matches OPM semantics where SD1 zooms in on a node
// from SD and shares the same id.
//
// Real impl (when GOOGLE_API_KEY set): Gemini reads each uploaded file's
// bytes and extracts a partial IR.
// Fallback: picks a mock variant per filename hash.

import fs from "node:fs/promises";
import path from "node:path";
import { askMultimodalJson, askJson, isGeminiConfigured } from "@/opm/pipeline/llm/gemini";
import { getFileArrays } from "../infra/files";

const VARIANTS = [
    "opm_model.json",
    "opm_model_simple.json",
    "opm_model_complex.json",
];

function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

const IR_SCHEMA_PROMPT = `
You are an OPM (Object-Process Methodology, ISO 19450:2015) parser.
Extract the canonical Intermediate Representation from the attached OPM diagram file.

Emit JSON exactly in this shape (no extras):

{
  "metadata": { "standard": "ISO 19450:2015", "parser": "Gemini" },
  "diagrams":  [ { "id": "SD",  "name": "System Diagram", "level": 0 } ],
  "objects":   [ { "id": "O1", "name": "...", "kind": "informatical", "states": [] } ],
  "processes": [ { "id": "P1", "name": "...", "diagram": "SD", "computation": "...(optional: exact code/formula if the source lists one)" } ],
  "links":     [ { "id": "L1", "type": "agent|instrument|consumption|result|effect|condition|invocation|event|aggregation|exhibition|generalization|instantiation|state-change", "from": "...", "to": "...", "via": "...(optional, for state-change)" } ]
}

Rules:
- Use O1..On for object IDs, P1..Pn for processes, L1..Ln for links.
- For state-change, write from/to as "ObjectName.StateName".
- States live inside their owning object's "states" array as strings.
- If the diagram hierarchy is unclear, use a single "SD" diagram.
- If this image is a zoom-in view, set the diagram id to SD1 / SD2 / ... and
  reuse the SAME object/process IDs that the parent SD uses; do not renumber.
- OPCLOUD / textual exports (e.g. a PDF "model report"): the "DIAGRAMS & OPL"
  sentences and the "ELEMENTS DICTIONARY" + "Relations" sections are the
  AUTHORITATIVE source — trust them over the rendered diagram images. Merge every
  SD found in the document into ONE IR (an object/process shared across SDs keeps
  a single id).
- Map the Relations sections to link "type": Agent→agent, Instrument→instrument,
  Result→result, Consumption→consumption, "changes X from a to b"→effect,
  Invocation→invocation, Aggregation→aggregation, Exhibition→exhibition,
  Generalization→generalization, Instantiation→instantiation, Tagged→tagged.
  "Source Name → Target(s) Name" gives from → to.
- Capture object states AND their values (e.g. "16-week Mass {Mft} is 100") in
  the owning object's "states" array.
- If a process lists a "Process Computational Function", copy that code/formula
  VERBATIM into the process's "computation" field — it is the exact logic the
  generated app must implement.
`.trim();

type OpmObject  = { id: string; name?: string; kind?: string; states?: string[] };
type OpmProcess = { id: string; name?: string; diagram?: string; computation?: string };
type OpmLink    = { id: string; type?: string; from?: string; to?: string; via?: string };
type OpmDiagram = { id: string; name?: string; level?: number; parent?: string };
type OpmModel   = {
    metadata?:  Record<string, unknown>;
    diagrams?:  OpmDiagram[];
    objects?:   OpmObject[];
    processes?: OpmProcess[];
    links?:     OpmLink[];
    [k: string]: unknown;
};

const MAX_PARSE_ATTEMPTS = 3; // 1 initial + up to 2 retries (transient slowness/errors)

async function parseSingleWithGemini(
    filePath: string,
    filename: string,
    format:   string,
    budgetMs: number,
    onProgress?: (msg: string) => void,
): Promise<OpmModel> {
    const bytes = await fs.readFile(filePath);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";

    // A single vision/text model call, bounded by `perCallMs`.
    async function callOnce(perCallMs: number): Promise<OpmModel> {
        // PDF (e.g. OPCloud model-report export): Gemini reads it natively as a
        // document — it sees the OPL text + Elements Dictionary AND the diagrams.
        if (ext === "pdf") {
            return askMultimodalJson<OpmModel>(IR_SCHEMA_PROMPT,
                { mime: "application/pdf", base64: bytes.toString("base64") }, undefined, perCallMs);
        }
        if (["png", "jpg", "jpeg"].includes(ext)) {
            const mime = ext === "png" ? "image/png" : "image/jpeg";
            return askMultimodalJson<OpmModel>(IR_SCHEMA_PROMPT,
                { mime, base64: bytes.toString("base64") }, undefined, perCallMs);
        }
        const text = bytes.toString("utf-8");
        const MAX = 60_000;
        const snippet = text.length > MAX ? text.slice(0, MAX) + "\n<!-- truncated -->" : text;
        return askJson<OpmModel>(
            `${IR_SCHEMA_PROMPT}\n\nInput file (${ext || format}):\n\n${snippet}`,
            undefined, perCallMs,
        );
    }

    // Retry-with-backoff bounded by the overall parse budget. Each attempt's
    // per-call timeout = the budget still remaining, so retries can't run past
    // the stage ceiling.
    const start = Date.now();
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt++) {
        const remaining = budgetMs - (Date.now() - start);
        if (remaining < 15_000) break; // not enough budget left for another attempt
        onProgress?.(`🧠 Parsing "${filename}" — attempt ${attempt}/${MAX_PARSE_ATTEMPTS} ` +
            `(budget ${Math.round(budgetMs / 1000)}s, ${Math.round(remaining / 1000)}s left)…`);
        try {
            const m = await callOnce(remaining);
            onProgress?.(`✅ Parsed "${filename}" in ${Math.round((Date.now() - start) / 1000)}s (attempt ${attempt}).`);
            return m;
        } catch (e) {
            lastErr = e;
            onProgress?.(`⚠️ Parse attempt ${attempt}/${MAX_PARSE_ATTEMPTS} for "${filename}" failed ` +
                `after ${Math.round((Date.now() - start) / 1000)}s: ${(e as Error).message}`);
            if (attempt < MAX_PARSE_ATTEMPTS) {
                const backoff = 1500 * attempt; // 1.5s, 3s
                onProgress?.(`⏳ Retrying "${filename}" in ${backoff / 1000}s…`);
                await new Promise((r) => setTimeout(r, backoff));
            }
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`parse failed for ${filename}`);
}

async function parseSingleMock(filename: string, format: string): Promise<OpmModel> {
    const variant = VARIANTS[hash(filename) % VARIANTS.length];
    const base = path.join(process.cwd(), "public", "mock-outputs");
    for (const candidate of [variant, "opm_model.json"]) {
        try {
            const raw = await fs.readFile(path.join(base, candidate), "utf-8");
            const parsed = JSON.parse(raw);
            parsed.metadata = {
                ...(parsed.metadata ?? {}),
                sourceFilename: filename,
                sourceFormat:   format,
                mockVariant:    candidate,
            };
            return parsed;
        } catch {
            continue;
        }
    }
    throw new Error("stage1-parse: no mock output found");
}

async function parseSingle(
    filename: string,
    format:   string,
    filePath: string | undefined,
    budgetMs: number,
    onProgress?: (msg: string) => void,
): Promise<OpmModel> {
    if (isGeminiConfigured() && filePath) {
        try {
            const m = await parseSingleWithGemini(filePath, filename, format, budgetMs, onProgress);
            m.metadata = {
                ...(m.metadata ?? {}),
                sourceFilename: filename,
                sourceFormat:   format,
                engine:         "gemini",
            };
            return m;
        } catch (e) {
            onProgress?.(`❌ Gemini parse exhausted for "${filename}" after ${MAX_PARSE_ATTEMPTS} attempt(s) — using mock fallback. (${(e as Error).message})`);
            console.error(`[stage1] Gemini parse failed for ${filename}, using mock:`, (e as Error).message);
            return parseSingleMock(filename, format);
        }
    }
    return parseSingleMock(filename, format);
}

// Merge N partial IRs into one canonical IR.
// Strategy:
//   - diagrams: dedup by id (later occurrence wins on conflict)
//   - objects:  dedup by id; union of states; first non-empty name wins
//   - processes: dedup by id; first non-empty name/diagram wins
//   - links:    dedup by (type, from, to, via) tuple — id is reassigned in
//               sequence to keep them unique across files
function mergeIRs(parts: OpmModel[]): OpmModel {
    const diagrams  = new Map<string, OpmDiagram>();
    const objects   = new Map<string, OpmObject>();
    const processes = new Map<string, OpmProcess>();
    const linkKey   = (l: OpmLink) => `${l.type ?? ""}|${l.from ?? ""}|${l.to ?? ""}|${l.via ?? ""}`;
    const links     = new Map<string, OpmLink>();

    for (const p of parts) {
        for (const d of p.diagrams ?? []) {
            diagrams.set(d.id, { ...diagrams.get(d.id), ...d });
        }
        for (const o of p.objects ?? []) {
            const prev = objects.get(o.id);
            const states = Array.from(new Set([...(prev?.states ?? []), ...(o.states ?? [])]));
            objects.set(o.id, {
                id:    o.id,
                name:  prev?.name || o.name,
                kind:  prev?.kind || o.kind,
                states,
            });
        }
        for (const proc of p.processes ?? []) {
            const prev = processes.get(proc.id);
            processes.set(proc.id, {
                id:          proc.id,
                name:        prev?.name        || proc.name,
                diagram:     prev?.diagram     || proc.diagram,
                computation: prev?.computation || proc.computation,
            });
        }
        for (const l of p.links ?? []) {
            const k = linkKey(l);
            if (!links.has(k)) links.set(k, l);
        }
    }

    // Reassign link IDs in sequence so the output is deterministic regardless
    // of upload order.
    const linksArr = Array.from(links.values()).map((l, i) => ({ ...l, id: `L${i + 1}` }));

    return {
        metadata: {
            standard: "ISO 19450:2015",
            parser:   "Hybrid Visual-Semantic v0.2 (multi-file merge)",
            mergedFromFiles: parts.length,
            mergedAt: new Date().toISOString(),
        },
        diagrams:  Array.from(diagrams.values()),
        objects:   Array.from(objects.values()),
        processes: Array.from(processes.values()),
        links:     linksArr,
    };
}

// Overall parse budget (per file). Configurable so complex diagrams / large
// PDFs aren't cut off. Default 5 min; the runner uses the same env var for its
// stage-level timeout so the two layers agree.
export const PARSE_TIMEOUT_MS = Number(process.env.OPM_PARSE_TIMEOUT_MS) || 300_000;

export async function parseOpm_stage1(input: {
    // Multi-file mode (preferred):
    filenames?: string[];
    filePaths?: string[];
    // Legacy single-file mode (back-compat for tests / older callers):
    filename?:  string;
    filePath?:  string;
    format:     string;
    // Live progress callback (wired by the runner to the dashboard stage log).
    onProgress?: (msg: string) => void;
    // Overall per-file parse budget; defaults to PARSE_TIMEOUT_MS.
    timeoutMs?:  number;
}): Promise<OpmModel> {
    const { filenames, filePaths } = getFileArrays(input);

    if (filenames.length === 0) {
        throw new Error("stage1-parse: no files provided");
    }

    const budgetMs   = input.timeoutMs ?? PARSE_TIMEOUT_MS;
    const onProgress = input.onProgress;

    // Parse every file in parallel — each gets its own LLM call + retry budget.
    const partials = await Promise.all(
        filenames.map((name, i) => parseSingle(name, input.format, filePaths[i], budgetMs, onProgress)),
    );

    if (partials.length === 1) return partials[0];
    return mergeIRs(partials);
}
