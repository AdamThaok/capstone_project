// Stage 4 building blocks: Full-Stack Code Generation.
//
// Uses a delimiter-based text format instead of JSON to avoid truncation and
// escaping issues. These helpers (callClaude, generateComplete, parseDelimitedFiles,
// prepareOutDir, finalizeOutput) are consumed by the two-agent build loop in
// pipeline/agents/: the Code Generation Agent generates with them, and the
// orchestrator writes the converged artifact to disk.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
    askText as claudeAskText,
    CODEGEN_MODEL as CLAUDE_CODEGEN_MODEL,
} from "@/opm/pipeline/llm/claude";
import { generateTraceabilityMd } from "../opm/traceability";
import { runBuildLoop } from "../agents/orchestrator";
import type { AgentIR } from "../agents/types";
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

export const CODEGEN_INSTRUCTIONS = `
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
- Generate 14–22 files covering: FastAPI backend + seed, React frontend (incl. index.css), DB models, docker-compose, Dockerfiles, README.
- Every file must be complete and runnable. No stubs or TODO placeholders.
- Every OPM Object → SQLAlchemy model + Pydantic schema.
- Every OPM Process → FastAPI endpoint with correct HTTP method.
- Every state-change link → transition endpoint with 409 guard.

MANDATORY FILES (must all be present):
1. backend/main.py          — FastAPI app with all routers, CORS, uvicorn entry; on startup run Base.metadata.create_all THEN call seed_db before serving
2. backend/models.py        — SQLAlchemy models for every OPM Object
3. backend/schemas.py       — Pydantic schemas (request/response)
4. backend/database.py      — SQLAlchemy engine + session + an idempotent async seed_db(session) inserting >=2 rows per model and >=1 row per enum value, with the primary demo entity owning one row of EACH value any dropdown filters on
5. backend/requirements.txt — All pip dependencies (include aiosqlite AND asyncpg)
6. frontend/package.json    — scripts {"dev":"vite","build":"vite build","preview":"vite preview"}; dependencies cover EVERY package the frontend imports (react, react-dom, axios, react-router-dom if routing is used)
7. frontend/vite.config.ts  — Vite config with proxy to backend port 8000
8. frontend/src/App.tsx     — Main React app with all views
9. frontend/src/main.tsx    — React entry point (imports ./index.css)
10. frontend/index.html     — HTML entry
11. frontend/src/index.css  — global stylesheet imported by main.tsx; defines every className the components use; NO @tailwind directives unless JSX uses Tailwind utilities
12. docker-compose.yml      — Services: backend (port 8000), db (postgres); may reference ONLY Dockerfiles also emitted
13. frontend/Dockerfile     — node:20-alpine build+preview on the port docker-compose maps
14. README.md               — exact commands run FROM THE PROJECT ROOT: frontend "cd frontend && npm install && npm run dev"; backend "pip install -r backend/requirements.txt && uvicorn backend.main:app --reload"

frontend/package.json: dependencies MUST be the EXACT set of npm packages imported anywhere under frontend/src (every bare/non-relative import specifier) — do NOT ship a hardcoded list. Keep react, react-dom, axios as the baseline and ADD whatever else is imported (e.g. react-router-dom when any page/App.tsx uses routing). Keep scripts exactly { "dev": "vite", "build": "vite build", "preview": "vite preview" }. Keep devDependencies: @vitejs/plugin-react ^4, vite ^5, typescript ^5, @types/react ^18, @types/react-dom ^18 (plus tailwindcss/postcss/autoprefixer if used). Never ship a package.json missing a package a .tsx file imports.
`.trim();

// System Builder Agent — combined role + OPM constraints, distilled from the
// user's multi-agent prompt and knowledge/11_codegen_agent_prompt.md. Prepended
// to every generation call. (The agent's "Output Format" directive is
// intentionally ignored — Stage 4 uses the delimiter format in CODEGEN_INSTRUCTIONS.)
export const OPM_SYSTEM_PROMPT = `
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
- The OPM IR's "computation" field is the SOURCE OF TRUTH for every formula —
  use it verbatim, not any reworded copy that may appear in the super prompt.
  Preserve every arithmetic operator exactly; never drop a "*" (")*100" not
  ")100", "a*b" not "ab"). Port JS expressions faithfully into the target
  language so they remain mathematically identical and runnable.
- Enforce state transitions exactly as modelled: a transition changes an object's
  state only from the modelled source state; reject any other source state with
  HTTP 409 Conflict.
- Consumees are destroyed, resultees created, instruments/agents required but
  untouched. Conditions are guards (skip/block per model).
- Define the SQLAlchemy declarative Base ONCE (in the models module) and import
  that SAME Base everywhere — including wherever metadata.create_all runs. Never
  call declarative_base() in more than one module, or create_all builds an empty
  schema and the app boots with no tables.
- Use ONE import convention across the backend (all package-relative, e.g.
  "from backend.x import ..."), consistent with how the app is launched, so it
  imports cleanly from a single working directory.
- Read DATABASE_URL from the environment and normalize it for the async driver:
  convert BOTH "postgres://" AND a bare "postgresql://" (no "+driver") to
  "postgresql+asyncpg://" before create_async_engine. Hosted Postgres (e.g.
  Railway) hands you "postgresql://...", which the sync dialect can't run async.
- Use database-PORTABLE column types ONLY, so the SAME models run on SQLite (local,
  zero-setup) AND Postgres (deploy). NEVER use dialect-specific types such as
  sqlalchemy.dialects.postgresql.UUID or JSONB. For primary keys use a String
  column storing str(uuid.uuid4()); for JSON use the generic sqlalchemy.JSON.
- Default DATABASE_URL to "sqlite+aiosqlite:///./app.db" when the env var is unset,
  so the app boots locally with no database to install. Include aiosqlite in
  requirements.
- Emit TRACEABILITY.md mapping each OPL sentence to the artifact(s) implementing it.
- LAUNCH MUST MATCH IMPORTS. The backend uses package-relative imports (from backend.x),
  so it runs ONLY from the repo root as "uvicorn backend.main:app". The backend Dockerfile
  MUST set WORKDIR /app, "COPY backend/ ./backend/" (NEVER "COPY backend/ ."), and CMD
  running "python -m uvicorn backend.main:app". NEVER generate "cd backend && uvicorn main:app".
- SCHEMA CONTRACT: request bodies use *Create/*Update schemas; ALL responses use *Response
  schemas. Never use a *Create schema as a response_model; never return a hand-built dict where
  a *Response exists. Define ONE shared base in schemas.py —
  "class CamelModel(BaseModel): model_config = ConfigDict(alias_generator=to_camel,
  populate_by_name=True, from_attributes=True)" (import: from pydantic.alias_generators import
  to_camel) — and have EVERY schema inherit CamelModel (not BaseModel). This makes the JSON API
  camelCase end-to-end so it matches the React frontend's camelCase keys, AND still accepts
  snake_case. Do NOT give a schema a per-class model_config that drops these settings.
- CASING CONTRACT (front<->back): the React frontend uses camelCase JSON keys; the CamelModel
  base makes every request/response camelCase, so the two halves always agree. Frontend payload
  keys and response reads are camelCase.
- Every OPM Process/transition endpoint binds its dedicated typed Pydantic request schema
  (body: <Process>Request) — never a bare dict or .get(); let Pydantic enforce required fields
  (never "if not all([...])", which rejects a legitimate 0). Guard every nullable DB field with
  "if x is None:" before any arithmetic or comparison.
- Define an idempotent seed_db and invoke it on startup after metadata.create_all; the primary
  demo entity must own one row of every value any dropdown filters on, so no required <select>
  renders zero options.
- Every frontend reference/foreign-key field (payload key ending in "_id") renders as a <select>
  populated from that target entity's GLOBAL list endpoint — never a free-text id input, never an
  owner-scoped/discriminator-filtered source that can be empty on a fresh DB.
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

// One-click local launchers, injected DETERMINISTICALLY (like TRACEABILITY.md) so
// every downloaded zip starts with no setup and the commands are always correct.
// They match the generated app's real run contract: the backend launches from the
// repo ROOT as `uvicorn backend.main:app` (package-relative imports) on :8000 — the
// frontend's default VITE_API_BASE_URL — and the frontend is Vite on :5173.
export const START_BAT = `@echo off
REM One-click local launcher (Windows). Backend :8000, frontend :5173.
REM Requires Python 3.11+ and Node 18+ on PATH.
setlocal
cd /d "%~dp0"

echo [1/3] Backend: creating venv + installing dependencies...
if not exist ".venv\\Scripts\\python.exe" python -m venv .venv
call ".venv\\Scripts\\python.exe" -m pip install -r backend\\requirements.txt

echo [2/3] Starting backend on http://localhost:8000 ...
start "backend" cmd /k ".venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000"

echo [3/3] Frontend: installing dependencies + starting on http://localhost:5173 ...
cd frontend
call npm install
start "frontend" cmd /k "npm run dev"

echo.
echo App starting -- backend http://localhost:8000  frontend http://localhost:5173
endlocal
`;

export const START_SH = `#!/usr/bin/env bash
# One-click local launcher (macOS/Linux). Backend :8000, frontend :5173.
set -e
cd "$(dirname "$0")"

echo "[1/3] Backend: creating venv + installing dependencies..."
python3 -m venv .venv 2>/dev/null || python -m venv .venv
./.venv/bin/python -m pip install -r backend/requirements.txt

echo "[2/3] Starting backend on http://localhost:8000 ..."
./.venv/bin/python -m uvicorn backend.main:app --reload --port 8000 &
BACK=$!
trap "kill $BACK 2>/dev/null" EXIT

echo "[3/3] Frontend: installing dependencies + starting on http://localhost:5173 ..."
cd frontend
npm install
npm run dev
`;

// Inject start.bat + start.sh at the project root (overwrites any model-emitted ones).
export function ensureLauncherFiles(files: FileSpec[]): FileSpec[] {
    const out = files.filter((f) => f.path !== "start.bat" && f.path !== "start.sh");
    out.push({ path: "start.bat", content: START_BAT });
    out.push({ path: "start.sh",  content: START_SH });
    return out;
}

// ── Truncation-aware generation ──────────────────────────────────────────────
// A single response can overflow the model's output budget and cut off the last
// (largest) file. Detect an unclosed delimiter stream and ask the model to
// continue until complete, so files are never written truncated.

export const isComplete = (text: string): boolean => text.trimEnd().endsWith(FILE_END);

export async function generateComplete(
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

// ── Model call ───────────────────────────────────────────────────────────────

export async function callClaude(prompt: string, onProgress?: (m: string) => void): Promise<FileSpec[]> {
    const text = await generateComplete(
        (p) => claudeAskText(p, CLAUDE_CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${prompt}\n\n${CODEGEN_INSTRUCTIONS}`,
        onProgress,
    );
    const files = parseDelimitedFiles(text);
    if (files.length < 3) throw new Error(`Claude returned only ${files.length} files`);
    return files;
}

// ── Output dir + finalize ────────────────────────────────────────────────────

// Create a fresh temp output dir for this job.
export async function prepareOutDir(jobId: string): Promise<string> {
    const outDir = path.join(os.tmpdir(), `opm-out-${jobId}`);
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.mkdir(outDir, { recursive: true });
    return outDir;
}

// Add the traceability file, write everything to disk, and build the result summary.
export async function finalizeOutput(
    outDir: string,
    files: FileSpec[],
    ctx: { opmModel?: unknown; spec?: unknown },
    notes: string,
    engine: string,
) {
    const withTrace     = ensureTraceabilityFile(files, ctx.opmModel, ctx.spec);
    const withLaunchers = ensureLauncherFiles(withTrace);
    await writeFiles(outDir, withLaunchers);
    return {
        root:       path.basename(outDir) + "/",
        totalFiles: withLaunchers.length,
        totalLines: withLaunchers.reduce((n, f) => n + f.content.split("\n").length, 0),
        tree:       buildTree(withLaunchers),
        outputDir:  outDir,
        notes,
        engine,
    };
}

// ── Stage 4 entry point ──────────────────────────────────────────────────────

// Build a logger that prints progress to the console AND the job's dashboard.
function makeStageLogger(jobId: string): (message: string) => void {
    return (message: string) => {
        console.info(`[stage4] ${message}`);
        if (!jobId) return;
        try {
            appendStageLog(jobId, "generate", message);
        } catch {
            // ignore dashboard logging errors — they must not stop generation
        }
    };
}

// Runs the two-agent build loop (Code Generation Agent <-> Testing Agent), then
// writes the converged artifact to disk and returns the generate-stage summary
// for the dashboard + download route.
export async function generateCode_stage4(
    superPrompt: { prompt: string; retrievedChunks?: number; models?: string[] },
    ctx: { jobId: string; opmModel?: unknown; spec?: unknown },
) {
    // 1. Set up progress logging for this job.
    const log = makeStageLogger(ctx.jobId);

    // 2. Run the two-agent loop. It returns the finished files (build.artifact),
    //    how it ended (build.outcome), and how many passes it took.
    const opmModel = ctx.opmModel as AgentIR;
    const build = await runBuildLoop(superPrompt.prompt, opmModel, { maxIters: 5, log });

    // 3. Make a fresh output folder on disk for this job.
    const outDir = await prepareOutDir(ctx.jobId);

    // 4. Write the files to disk and return a summary for the dashboard.
    const notes = `agentic loop: ${build.outcome} after ${build.iterations} pass(es)`;
    const sources = { opmModel: ctx.opmModel, spec: ctx.spec };
    return finalizeOutput(outDir, build.artifact, sources, notes, "claude");
}
