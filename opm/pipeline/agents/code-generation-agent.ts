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
} from "@/opm/pipeline/stages/stage4-codegen";
import {
    askText as claudeAskText,
    askJson as claudeAskJson,
    CODEGEN_MODEL,
} from "@/opm/pipeline/llm/claude";
import type { CodeArtifact, FileSpec, TestReport, ReflectionNote, AgentIR } from "./types";

type Progress = (msg: string) => void;

// One generation layer = a small, explicit set of files in dependency order.
type Layer = { name: string; files: string[]; instruction: string };

// What every layer call needs to stay consistent with the layers before it.
type LayerContext = { superPrompt: string; written: FileSpec[] };

// Just the output format — NOT the "generate all 12 mandatory files" mandate,
// which would make every layer regenerate the whole app.
const DELIMITER_FORMAT = `
OUTPUT FORMAT — use EXACTLY this, no JSON, no markdown fences:
===FILE: path/to/file===
<full file content>
===END===
`.trim();

// Dependency order: each layer writes only ITS files, and is handed the
// interfaces of the ones before it — so the data shapes are defined ONCE and
// never re-invented (no dual ORM, no front/back drift). `files` is the exact,
// short list each layer may emit; the Frontend layer also adds one page per
// entity (it can't be fully enumerated up front).
const LAYERS: Layer[] = [
    {
        name: "Data",
        files: ["backend/models.py", "backend/schemas.py"],
        instruction: "SQLAlchemy models + Pydantic schemas — ONE consistent set, no duplicates.",
    },
    {
        name: "API",
        files: ["backend/routers.py"],
        instruction: "All FastAPI endpoints in one router module, using ONLY the models + schemas already written.",
    },
    {
        name: "Backend entry",
        files: ["backend/main.py", "backend/database.py", "backend/requirements.txt", "backend/Dockerfile"],
        instruction: "Wire the router(s), CORS, and create tables on startup. requirements.txt must list every imported package.",
    },
    {
        name: "Frontend",
        files: ["frontend/src/main.tsx", "frontend/src/App.tsx", "frontend/src/api.ts", "frontend/index.html"],
        instruction: "Plus ONE page component per main entity under frontend/src/pages/. Call EXACTLY the routes already defined above — match every path + field name.",
    },
    {
        name: "Config",
        files: [
            "frontend/package.json", "frontend/vite.config.ts", "frontend/tsconfig.json",
            "frontend/postcss.config.js", "frontend/tailwind.config.js",
            "docker-compose.yml", "README.md", "TRACEABILITY.md",
        ],
        instruction:
            "package.json MUST declare every dependency the frontend imports (react, axios, AND tailwindcss/postcss/autoprefixer if used). " +
            "TRACEABILITY.md MUST list EVERY OPM id from the brief — every object id (O1..On) and every process id (P1..Pn) — each on a line mapping it to the file that implements it (e.g. `- O4 Child -> backend/models.py`).",
    },
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

// Is this file one the layer is actually allowed to emit? The prompt ASKS the
// model to stay in its lane, but the model often ignores that and dumps the whole
// app (e.g. 37 files when the API layer should emit one router). Those extras are
// what drive chunk-to-chunk drift, so we enforce the lane deterministically instead
// of trusting the instruction.
function isAllowedInLayer(layer: Layer, filePath: string): boolean {
    if (layer.files.includes(filePath)) {
        return true;
    }
    // The Frontend layer also owns one page component per entity. Those can't be
    // listed up front, so allow anything under its pages/ directory.
    if (layer.name === "Frontend" && filePath.startsWith("frontend/src/pages/")) {
        return true;
    }
    return false;
}

// Generate ONE layer: assemble its prompt, call Claude, parse the files, then drop
// anything the model emitted outside this layer's lane.
async function generateLayer(layer: Layer, ctx: LayerContext, log: Progress): Promise<FileSpec[]> {
    const text = await generateComplete(
        (p) => claudeAskText(p, CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${buildLayerPrompt(layer, ctx)}\n\n${DELIMITER_FORMAT}`,
        log,
    );
    const parsed = parseDelimitedFiles(text);

    const kept: FileSpec[] = [];
    let dropped = 0;
    for (const f of parsed) {
        if (isAllowedInLayer(layer, f.path)) {
            kept.push(f);
        } else {
            dropped++;
        }
    }
    if (dropped > 0) {
        log(`✂️ ${layer.name}: dropped ${dropped} out-of-lane file(s) the model emitted (kept ${kept.length}).`);
    }
    return kept;
}

// Assemble a single layer's prompt: the EXACT files for this layer + the brief
// + the interfaces already written. The explicit file list is what stops the
// model from regenerating the whole app each layer.
function buildLayerPrompt(layer: Layer, ctx: LayerContext): string {
    const already = ctx.written.length
        ? `## Files already written (match these EXACTLY — do not redefine them)\n${summarizeInterfaces(ctx.written)}`
        : "## Files already written\n(none — this is the first layer)";

    // Order matters: the brief is CONTEXT (first), and the hard file constraint
    // is LAST so it's the final, highest-recency instruction the model reads.
    return [
        `## Build brief (CONTEXT ONLY — describes the whole app)\n${ctx.superPrompt}`,
        already,
        `You are writing ONE layer of this app: ${layer.name}. ${layer.instruction}`,
        `OUTPUT ONLY THESE FILES — nothing else. Do NOT regenerate earlier files. ` +
        `IGNORE any other files the brief mentions (README, docker-compose, other entities, etc.) — ` +
        `OTHER LAYERS handle those. Emit exactly:\n${layer.files.map((f) => `- ${f}`).join("\n")}` +
        `\n(plus, for the Frontend layer only, one page component per entity under frontend/src/pages/).`,
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

// Which already-written files does this failure set point at? We count a file as
// implicated whenever its path shows up in a failure's id or detail text. This
// lets us re-emit ONLY those files instead of the whole repo.
//
// Note: uncovered_id failures name an OPM id (O*/P*), not a path, so they match
// nothing here on purpose — a missing id has no single home file, so those fall
// back to the unscoped prompt below.
// Files where OPM ids are supposed to be implemented. A coverage gap ("id O3 is
// not referenced in any file") has no single home, so we route it to this bounded
// set instead of falling back to the whole repo.
const ID_HOME_FILES = ["backend/models.py", "backend/routers.py", "TRACEABILITY.md"];

// Does this failure point at this file? Three ways: the failure text contains the
// full path, contains just the basename (build errors often print "App.tsx", not
// the full path), or it's a coverage gap and this is an id-home file.
function failurePointsAtFile(fail: { kind: string; id: string; detail: string }, file: FileSpec): boolean {
    const base = file.path.split("/").pop() ?? file.path;
    if (fail.id.includes(file.path) || fail.detail.includes(file.path)) {
        return true;
    }
    if (base.length > 3 && fail.detail.includes(base)) {
        return true;
    }
    if (fail.kind === "uncovered_id" && ID_HOME_FILES.includes(file.path)) {
        return true;
    }
    return false;
}

function filesImplicatedBy(prevFiles: CodeArtifact, report: TestReport): FileSpec[] {
    const hits: FileSpec[] = [];
    for (const f of prevFiles) {
        let mentioned = false;
        for (const fail of report.failures) {
            if (failurePointsAtFile(fail, f)) {
                mentioned = true;
            }
        }
        if (mentioned) {
            hits.push(f);
        }
    }
    return hits;
}

// Scoped fix prompt: re-emit ONLY the implicated files (full bodies), and show
// the rest of the repo as signatures only. The model keeps interfaces intact
// without reprinting — and re-cutting-off on — the whole codebase. This is what
// stops a one-line fix from triggering several continuations.
function buildScopedFixPrompt(
    prevFiles: CodeArtifact,
    targets: FileSpec[],
    note: ReflectionNote,
    report: TestReport,
    ir: AgentIR,
): string {
    const targetPaths = targets.map((f) => f.path);
    const others: FileSpec[] = [];
    for (const f of prevFiles) {
        if (!targetPaths.includes(f.path)) {
            others.push(f);
        }
    }

    const targetBlocks = targets
        .map((f) => `===FILE: ${f.path}===\n${f.content}\n===END===`)
        .join("\n\n");
    const targetList = targetPaths.map((p) => `- ${p}`).join("\n");

    return `
You previously generated a project. The Testing Agent found these failures:
${report.failures.map((f) => `- ${f.detail}`).join("\n")}

Diagnosis: ${note.diagnosis}
Fix plan:  ${note.fixPlan}

Re-emit ONLY these ${targets.length} file(s) — and NOTHING else — each as a
COMPLETE file, using the delimiter format:
${targetList}

===FILE: path/to/file===
<corrected content>
===END===

Rules:
- Re-emit ONLY the files listed above. Do NOT output any other file.
- Use the OPM IR "computation" fields VERBATIM for any formula; preserve every "*".
- Do not introduce new features or remove files; only fix what failed.

## OPM IR
${JSON.stringify(ir, null, 2)}

## Files you must fix (re-emit these, complete)
${targetBlocks}

## Rest of the repo (signatures only — DO NOT re-emit, just stay compatible)
${summarizeInterfaces(others)}
`.trim();
}

// Unscoped fallback: no failure named a specific file (e.g. a coverage gap), so
// hand over the whole repo and let the model decide what to change.
function buildFullFixPrompt(
    prevFiles: CodeArtifact,
    note: ReflectionNote,
    report: TestReport,
    ir: AgentIR,
): string {
    return `
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
}

// Action 3: emit corrected files guided by the reflection, then merge them over
// the previous artifact (patched files win; untouched files are kept).
//
// We scope the prompt to just the files the failures point at, so a small fix
// re-emits a few files instead of the whole repo (fewer continuations, less drift).
export async function regenerateFromReflection(
    prevFiles: CodeArtifact,
    note: ReflectionNote,
    report: TestReport,
    ir: AgentIR,
    onProgress?: Progress,
): Promise<CodeArtifact> {
    const log = onProgress ?? (() => { /* no-op */ });

    const targets = filesImplicatedBy(prevFiles, report);
    let prompt = "";
    if (targets.length > 0) {
        log(`🎯 Scoped fix: re-emitting ${targets.length} implicated file(s).`);
        prompt = buildScopedFixPrompt(prevFiles, targets, note, report, ir);
    } else {
        log("🌐 Unscoped fix: no single file implicated — sending the full repo.");
        prompt = buildFullFixPrompt(prevFiles, note, report, ir);
    }

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
