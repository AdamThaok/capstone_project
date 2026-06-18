// Agent 1 — the Code Generation Agent.
//
// It WRITES and FIXES code; it never judges its own output (that is Agent 2).
// Three actions, matching the Agents-as-Loops spec:
//   generateInitialCode      — first-pass solution from the super prompt.
//   reflectOnFailures         — diagnose root cause + minimal fix plan (no code yet).
//   regenerateFromReflection  — emit corrected files guided by the reflection.
//
// reflectOnFailures reasons over Agent 2's TestReport — it does not make the
// pass/fail call itself; it only acts on the verdict it was handed.

import {
    callClaude,
    generateComplete,
    parseDelimitedFiles,
    OPM_SYSTEM_PROMPT,
    CODEGEN_INSTRUCTIONS,
} from "@/opm/pipeline/stages/stage4-codegen";
import {
    askText as claudeAskText,
    askJson as claudeAskJson,
    CODEGEN_MODEL,
} from "@/opm/pipeline/llm/claude";
import type { CodeArtifact, FileSpec, TestReport, ReflectionNote, AgentIR } from "./types";

type Progress = (msg: string) => void;

// One generation layer = a coherent group of files in dependency order.
type Layer = { name: string; instruction: string };

// What every layer call needs to stay consistent with the layers before it.
type LayerContext = { superPrompt: string; written: FileSpec[] };

// Dependency order: each layer is handed the interfaces of the ones before it,
// so the data shapes are defined ONCE and never re-invented (no dual ORM, no
// front/back drift). The route signatures the API layer emits become the
// contract the Frontend layer must match.
const LAYERS: Layer[] = [
    { name: "Data",          instruction: "Write the database models + request/response schemas — ONE consistent set, no duplicates." },
    { name: "API",           instruction: "Write the routers/endpoints, using ONLY the models + schemas already written above." },
    { name: "Backend entry", instruction: "Write the app entry (wire all routers, CORS, create tables on startup), the DB setup, and requirements/deps." },
    { name: "Frontend",      instruction: "Write the API client + pages that call EXACTLY the routes already defined above (match every path + field name)." },
    { name: "Config",        instruction: "Write package.json (DECLARE every dependency you import, e.g. tailwindcss), build config, index.html, README, and .env.example." },
];

// Action 1: first-pass generation — built LAYER BY LAYER (not one giant stream),
// so each file is generated knowing the interfaces of the files already written.
export async function generateInitialCode(
    superPrompt: string,
    onProgress?: Progress,
): Promise<CodeArtifact> {
    const log = onProgress ?? (() => { /* no-op */ });
    const written: FileSpec[] = [];

    for (const layer of LAYERS) {
        log(`🧱 Generating layer: ${layer.name}…`);
        let files: FileSpec[] = [];
        try {
            files = await generateLayer(layer, { superPrompt, written }, log);
        } catch (e) {
            log(`⚠️ Layer "${layer.name}" failed (${(e as Error).message}) — continuing.`);
        }
        for (const f of files) {
            const i = written.findIndex((w) => w.path === f.path);
            if (i >= 0) written[i] = f; else written.push(f);
        }
        log(`✅ ${layer.name}: ${files.length} file(s) (total ${written.length}).`);
    }

    // Safety net: if the layered pass produced too little, fall back to one-shot.
    if (written.length < 3) {
        log("↩️ Layered output too small — falling back to single-pass generation.");
        return callClaude(superPrompt, onProgress);
    }
    return written;
}

// Generate ONE layer: assemble its prompt, call Claude, parse the files.
async function generateLayer(layer: Layer, ctx: LayerContext, log: Progress): Promise<FileSpec[]> {
    const text = await generateComplete(
        (p) => claudeAskText(p, CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${buildLayerPrompt(layer, ctx)}\n\n${CODEGEN_INSTRUCTIONS}`,
        log,
    );
    return parseDelimitedFiles(text);
}

// Assemble a single layer's prompt: layer goal + the brief + what already exists.
function buildLayerPrompt(layer: Layer, ctx: LayerContext): string {
    const already = ctx.written.length
        ? `## Files already written (match these EXACTLY — do not redefine them)\n${summarizeInterfaces(ctx.written)}`
        : "## Files already written\n(none — this is the first layer)";

    return [
        `You are generating ONE layer of the app: ${layer.name}.`,
        layer.instruction,
        "Output ONLY the files for THIS layer, in the delimiter format. Do NOT regenerate earlier files.",
        already,
        `## Build brief\n${ctx.superPrompt}`,
    ].join("\n\n");
}

// Action 2: diagnose WHY the tests failed, before touching code. Past fix plans
// are passed in so the agent does not repeat an approach that already failed.
export async function reflectOnFailures(
    report: TestReport,
    history: ReflectionNote[],
    ir: AgentIR,
): Promise<ReflectionNote> {
    const priorPlans = history.length
        ? history.map((h, i) => `Attempt ${i + 1}: "${h.fixPlan}"`).join("\n")
        : "(none yet)";

    const prompt = `
You are the Code Generation Agent reflecting on why your generated project failed
its automated checks. Diagnose the SINGLE root cause, then give a minimal fix plan.

Failures reported by the Testing Agent:
${report.failures.map((f) => `- ${f.detail}`).join("\n")}

Previous fix attempts (do NOT repeat any plan listed here):
${priorPlans}

The OPM IR's "computation" fields are the source of truth for formulas — preserve
every operator (write ")*100" not ")100").

Respond with STRICT JSON only: { "diagnosis": "...", "fixPlan": "..." }
`.trim();

    try {
        const r = await claudeAskJson<ReflectionNote>(prompt);
        return { diagnosis: r?.diagnosis ?? "", fixPlan: r?.fixPlan ?? "" };
    } catch {
        // Fallback: ask for text and parse loosely, so a JSON hiccup doesn't stall the loop.
        const text = await claudeAskText(prompt);
        return parseReflectionLoose(text);
    }
}

// Action 3: emit corrected files guided by the reflection, then merge them over
// the previous artifact (patched files win; untouched files are kept).
export async function regenerateFromReflection(
    prevFiles: CodeArtifact,
    note: ReflectionNote,
    report: TestReport,
    ir: AgentIR,
    onProgress?: Progress,
): Promise<CodeArtifact> {
    const prompt = `
You previously generated a project. The Testing Agent found these failures:
${report.failures.map((f) => `- ${f.detail}`).join("\n")}

Diagnosis: ${note.diagnosis}
Fix plan:  ${note.fixPlan}

Re-emit ONLY the files that must change to implement the fix, using the delimiter
format:
===FILE: path/to/file===
<corrected content>
===END===

Rules:
- Use the OPM IR "computation" fields VERBATIM for any formula; preserve every "*".
- Do not introduce new features or remove files; only fix what failed.

## OPM IR
${JSON.stringify(ir, null, 2)}

## Current files
${prevFiles.map((f) => `===FILE: ${f.path}===\n${f.content}\n===END===`).join("\n\n")}
`.trim();

    const text = await generateComplete(
        (p) => claudeAskText(p, CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${prompt}`,
        onProgress,
    );
    const patches = parseDelimitedFiles(text);
    return mergeFiles(prevFiles, patches);
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Lines that declare an interface another layer must match: classes, functions,
// route decorators, exported TS types. We keep these (the "signatures") and drop
// the bodies, so the next layer sees what exists without resending the codebase.
const SIGNATURE_RE =
    /^\s*(class |def |async def |@app\.|@router\.|app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch)|export |interface |type \w+\s*=|function )/;

function signatureLines(file: FileSpec): string {
    const keep: string[] = [];
    for (const line of file.content.split("\n")) {
        if (SIGNATURE_RE.test(line)) keep.push(line.trim());
    }
    return keep.slice(0, 40).join("\n");
}

// Compact digest of already-written files: path + signature lines only (no bodies).
export function summarizeInterfaces(written: FileSpec[]): string {
    const blocks: string[] = [];
    for (const f of written) {
        const sig = signatureLines(f);
        blocks.push(`=== ${f.path} ===\n${sig || "(no notable signatures)"}`);
    }
    return blocks.join("\n\n");
}

function mergeFiles(base: CodeArtifact, patches: FileSpec[]): CodeArtifact {
    const byPath = new Map(base.map((f) => [f.path, f]));
    for (const p of patches) byPath.set(p.path, p);
    return [...byPath.values()];
}

function parseReflectionLoose(text: string): ReflectionNote {
    try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
            const obj = JSON.parse(text.slice(start, end + 1));
            return { diagnosis: obj.diagnosis ?? "", fixPlan: obj.fixPlan ?? text.trim() };
        }
    } catch { /* fall through */ }
    return { diagnosis: "", fixPlan: text.trim() };
}
