// Stage 4: Full-Stack Code Generation.
//
// Uses a delimiter-based text format instead of JSON to avoid truncation and
// escaping issues. Claude generates the project skeleton, then refines the
// critical files for quality.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    askText as claudeAskText,
    CODEGEN_MODEL as CLAUDE_CODEGEN_MODEL,
    isClaudeConfigured,
} from "@/opm/pipeline/llm/claude";
import { generateTraceabilityMd } from "../opm/traceability";
import { appendStageLog } from "../infra/jobs";

type FileSpec = { path: string; content: string };
type TreeNode = { path: string; lines?: number };

// ── Delimiter format ────────────────────────────────────────────────────────
// Much more reliable than JSON: no escaping, no truncation corruption.
// Format:
//   ===FILE: some/path.ext===
//   <raw file content, any characters allowed>
//   ===END===
const FILE_START = /^===FILE:\s*(.+?)\s*===/;
const FILE_END   = "===END===";

const CODEGEN_INSTRUCTIONS = `
OUTPUT FORMAT (STRICT — use this exact delimiter format, NOT JSON):

===FILE: backend/main.py===
# actual Python code here
===END===
===FILE: backend/models.py===
# actual Python code here
===END===
===FILE: frontend/src/App.tsx===
// actual TypeScript/React code here
===END===
===FILE: docker-compose.yml===
# actual YAML here
===END===
===FILE: README.md===
# Project README
===END===

RULES:
- Use ONLY the ===FILE: path=== ... ===END=== format. No JSON. No markdown blocks.
- Generate 12–18 files covering: FastAPI backend, React frontend, DB models, docker-compose, README.
- Every file must be complete and runnable. No stubs or TODO placeholders.
- Every OPM Object → SQLAlchemy model + Pydantic schema.
- Every OPM Process → FastAPI endpoint with correct HTTP method.
- Every state-change link → transition endpoint with 409 guard.

MANDATORY FILES (must all be present):
1. backend/main.py          — FastAPI app with all routers, CORS, uvicorn entry
2. backend/models.py        — SQLAlchemy models for every OPM Object
3. backend/schemas.py       — Pydantic schemas (request/response)
4. backend/database.py      — SQLAlchemy engine + session
5. backend/requirements.txt — All pip dependencies
6. frontend/package.json    — MUST include scripts: {"dev":"vite","build":"vite build","preview":"vite preview"}
7. frontend/vite.config.ts  — Vite config with proxy to backend port 8000
8. frontend/src/App.tsx     — Main React app with all views
9. frontend/src/main.tsx    — React entry point
10. frontend/index.html     — HTML entry
11. docker-compose.yml      — Services: backend (port 8000), db (postgres)
12. README.md               — MUST include exact commands: "cd frontend && npm install && npm run dev" for frontend, "cd backend && pip install -r requirements.txt && uvicorn main:app --reload" for backend

frontend/package.json MUST look exactly like this (adapt name):
{
  "name": "generated-app",
  "version": "1.0.0",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18", "react-dom": "^18", "axios": "^1" },
  "devDependencies": { "@vitejs/plugin-react": "^4", "vite": "^5", "typescript": "^5", "@types/react": "^18", "@types/react-dom": "^18" }
}
`.trim();

// System Builder Agent (Agent 1) — combined role + OPM constraints, distilled
// from the user's multi-agent prompt and knowledge/11_codegen_agent_prompt.md.
// Prepended to every generation call. (The agent's "Output Format" directive is
// intentionally ignored — Stage 4 uses the delimiter format in CODEGEN_INSTRUCTIONS.)
const OPM_SYSTEM_PROMPT = `
You are the System Builder Agent — a lead full-stack software engineer that turns
an Object-Process Methodology (OPM, ISO 19450) model into clean, modular,
production-ready software. You operate ONLY on OPM semantics — never UML/BPMN/ERD
intuition.

Hard constraints (non-negotiable):
- Map every Object to a data structure / class / entity, and every Process to an
  executable function or service. Build strictly within the schema boundaries —
  add nothing the model does not define (no invented fields, entities, endpoints).
- Every file is COMPLETE and runnable: no placeholders, no "TODO" notes, no stubs.
- Every artifact traces to an OPL sentence / OPM fact; generate nothing that has
  no corresponding model fact, and drop no model fact silently.
- Object -> data structure / entity (NOT automatically a table); Process ->
  function/endpoint whose contract = its pre/postconditions; State -> lifecycle
  status with a transition table.
- If a process carries a computational function/formula (its "computation"
  field), implement that logic EXACTLY in the endpoint — port the given
  code/formula faithfully; do not approximate, simplify, or stub it.
- Enforce state transitions exactly as modelled: a transition changes an object's
  state only from the modelled source state; reject any other source state with
  HTTP 409 Conflict.
- Consumees are destroyed, resultees created, instruments/agents required but
  untouched. Conditions are guards (skip/block per model).
- Emit TRACEABILITY.md mapping each OPL sentence to the artifact(s) implementing it.
`.trim();

const REFINE_INSTRUCTIONS = (files: FileSpec[], processNames: string[]) => `
You are a senior software engineer COMPLETING an auto-generated project. Improve
and complete the following files:
- COMPLETE any file that was truncated / cut off mid-stream — finish it fully.
- Fix bugs, missing imports, and incomplete logic. No stubs, no TODO placeholders.
- Ensure EVERY one of these OPM processes has a fully-implemented backend endpoint,
  each enforcing its state transition (reject a wrong source state with HTTP 409):
${processNames.length ? processNames.map(p => `    • ${p}`).join("\n") : "    (no named processes detected — implement every process endpoint present in the model)"}
- Add proper error handling. Do NOT add new files or change the overall structure.

Use the SAME delimiter format:
===FILE: path/to/file===
<improved content>
===END===

Files to improve:
${files.map(f => `===FILE: ${f.path}===\n${f.content}\n===END===`).join("\n\n")}
`.trim();

// ── Parsing ─────────────────────────────────────────────────────────────────

export function parseDelimitedFiles(text: string): FileSpec[] {
    const files: FileSpec[] = [];
    const lines = text.split("\n");
    let currentPath: string | null = null;
    let contentLines: string[] = [];

    for (const line of lines) {
        const startMatch = line.match(FILE_START);
        if (startMatch) {
            // Save previous file if any
            if (currentPath) {
                files.push({ path: currentPath, content: contentLines.join("\n").trim() });
            }
            currentPath = startMatch[1].trim();
            contentLines = [];
        } else if (line.trim() === FILE_END) {
            if (currentPath) {
                files.push({ path: currentPath, content: contentLines.join("\n").trim() });
                currentPath = null;
                contentLines = [];
            }
        } else if (currentPath !== null) {
            contentLines.push(line);
        }
    }
    // Handle truncated last file (no ===END===)
    if (currentPath && contentLines.length > 5) {
        files.push({ path: currentPath, content: contentLines.join("\n").trim() });
    }
    return files;
}

// ── File helpers ─────────────────────────────────────────────────────────────

async function writeFiles(rootDir: string, files: FileSpec[]) {
    for (const f of files) {
        const rel = f.path.replace(/^[\\/]+/, "");
        if (rel.includes("..")) continue;
        const full = path.join(rootDir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, f.content);
    }
}

function buildTree(files: FileSpec[]): TreeNode[] {
    return files.map(f => ({ path: f.path, lines: f.content.split("\n").length }));
}

function ensureTraceabilityFile(files: FileSpec[], opm: unknown, spec: unknown): FileSpec[] {
    const out = files.filter(f => f.path !== "TRACEABILITY.md");
    out.push({ path: "TRACEABILITY.md", content: generateTraceabilityMd(opm, spec) });
    return out;
}

// ── Critical file detection (for Claude refinement) ──────────────────────────

const CRITICAL_NAMES = ["main", "models", "routes", "app", "schema", "api", "service", "database"];

function isCritical(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    const ext   = path.extname(lower);
    if (![".py", ".ts", ".tsx"].includes(ext)) return false;
    return CRITICAL_NAMES.some(n => lower.includes(n));
}

// ── Truncation-aware generation ──────────────────────────────────────────────
// A single response can overflow the model's output budget and cut off the last
// (largest) file. Detect an unclosed delimiter stream and ask the model to
// continue until complete, so files are never written truncated.

export const isComplete = (text: string): boolean => text.trimEnd().endsWith(FILE_END);

async function generateComplete(
    ask: (p: string) => Promise<string>,
    prompt: string,
    onProgress: (m: string) => void = (m) => console.info(m),
): Promise<string> {
    let full = await ask(prompt);
    for (let i = 0; i < 3 && !isComplete(full); i++) {
        onProgress(`🧩 Output cut off — requesting continuation #${i + 1} to finish all files…`);
        const cont = await ask(
            `${CODEGEN_INSTRUCTIONS}\n\n[CONTINUATION] Your previous output was cut off mid-stream. ` +
            `Continue EXACTLY where it stopped — no preamble, no repetition, do NOT restate earlier files. ` +
            `The tail of what you produced so far:\n${full.slice(-2000)}\n\nContinue now:`,
        );
        full += cont;
    }
    return full;
}

// OPM process names the generated backend must fully implement (fed to refinement).
function extractProcessNames(opm: unknown, spec: unknown): string[] {
    const names = new Set<string>();
    const o = opm as { processes?: { name?: string }[] } | undefined;
    for (const p of o?.processes ?? []) if (p?.name) names.add(p.name);
    const s = spec as { processes?: { name?: string }[]; endpoints?: { name?: string }[] } | undefined;
    for (const p of s?.processes ?? []) if (p?.name) names.add(p.name);
    for (const e of s?.endpoints ?? []) if (e?.name) names.add(e.name);
    return [...names];
}

// ── Model calls ──────────────────────────────────────────────────────────────

async function callClaude(prompt: string, onProgress?: (m: string) => void): Promise<FileSpec[]> {
    const text = await generateComplete(
        (p) => claudeAskText(p, CLAUDE_CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${prompt}\n\n${CODEGEN_INSTRUCTIONS}`,
        onProgress,
    );
    const files = parseDelimitedFiles(text);
    if (files.length < 3) throw new Error(`Claude returned only ${files.length} files`);
    return files;
}

async function generateMock(): Promise<Record<string, unknown>> {
    const mockPath = path.join(process.cwd(), "public", "mock-outputs", "file_tree.json");
    const raw = await fs.readFile(mockPath, "utf-8");
    return JSON.parse(raw);
}

// ── Main export ──────────────────────────────────────────────────────────────

// Create a fresh temp output dir for this job.
async function prepareOutDir(jobId: string): Promise<string> {
    const outDir = path.join(os.tmpdir(), `opm-out-${jobId}`);
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
    return outDir;
}

// Claude pass 2: refine the (up to 6) critical files, merged back over the draft.
async function refineCriticalFiles(
    draftFiles: FileSpec[],
    critical: FileSpec[],
    ctx: { opmModel?: unknown; spec?: unknown },
    log: (m: string) => void,
): Promise<FileSpec[]> {
    if (critical.length === 0) return draftFiles;
    log(`🔵 Pass 2 — Claude refining ${critical.length} critical file(s) (completing endpoints/logic)…`);
    try {
        const processNames = extractProcessNames(ctx.opmModel, ctx.spec);
        const refinedText = await generateComplete(
            (p) => claudeAskText(p, CLAUDE_CODEGEN_MODEL),
            REFINE_INSTRUCTIONS(critical, processNames),
            log,
        );
        const refined = parseDelimitedFiles(refinedText);
        if (refined.length > 0) {
            const refinedMap = new Map(refined.map(f => [f.path, f]));
            log(`✅ Claude refined ${refined.length} file(s).`);
            return draftFiles.map(f => refinedMap.get(f.path) ?? f);
        }
    } catch (e) {
        log(`⚠️ Claude refinement skipped: ${(e as Error).message}`);
    }
    return draftFiles;
}

// Add the traceability file, write everything to disk, and build the result summary.
async function finalizeOutput(
    outDir: string,
    files: FileSpec[],
    ctx: { opmModel?: unknown; spec?: unknown },
    notes: string,
    engine: string,
) {
    const withTrace = ensureTraceabilityFile(files, ctx.opmModel, ctx.spec);
    await writeFiles(outDir, withTrace);
    return {
        root:       path.basename(outDir) + "/",
        totalFiles: withTrace.length,
        totalLines: withTrace.reduce((n, f) => n + f.content.split("\n").length, 0),
        tree:       buildTree(withTrace),
        outputDir:  outDir,
        notes,
        engine,
    };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function generateCode_stage4(
    superPrompt: { prompt: string; retrievedChunks?: number; models?: string[] },
    ctx: { jobId: string; opmModel?: unknown; spec?: unknown },
) {
    const outDir = await prepareOutDir(ctx.jobId);

    // Live progress → dashboard, so a long (complex-model) generation visibly
    // works instead of looking frozen.
    const log = (m: string) => {
        console.info(`[stage4] ${m}`);
        try { if (ctx.jobId) appendStageLog(ctx.jobId, "generate", m); } catch { /* ignore */ }
    };

    // 1. Claude generates the project skeleton, then refines the critical files.
    if (isClaudeConfigured()) {
        try {
            log("⚡ Pass 1 — Claude: generating the project skeleton…");
            const draftFiles = await callClaude(superPrompt.prompt, log);
            log(`✅ Claude draft: ${draftFiles.length} files.`);
            const critical   = draftFiles.filter(f => isCritical(f.path)).slice(0, 6);
            const finalFiles = await refineCriticalFiles(draftFiles, critical, ctx, log);
            return finalizeOutput(outDir, finalFiles, ctx,
                `Claude draft + refinement (${critical.length} files improved)`, "claude");
        } catch (e) {
            console.error("[stage4] Claude generation failed, using mock:", (e as Error).message);
        }
    }

    // 2. Last resort: bundled mock.
    console.warn("[stage4] Claude unavailable, using mock");
    return generateMock();
}
