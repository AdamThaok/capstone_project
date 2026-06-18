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
import type { CodeArtifact, FileSpec, TestReport, ReflectionNote, AttemptRecord, AgentIR, Failure } from "./types";

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
        files: ["backend/models.py", "backend/schemas.py", "backend/database.py"],
        instruction:
            "SQLAlchemy models + Pydantic schemas + the DB foundation, as ONE consistent set. " +
            "models.py defines the SINGLE declarative Base. database.py imports THAT same Base and " +
            "defines the async engine, an async session factory named EXACTLY `async_session` (via " +
            "async_sessionmaker — NOT `AsyncSessionLocal` or any other name), and an async get_db() " +
            "dependency — so later layers can do `from backend.database import get_db, async_session`. " +
            "No duplicates, no second declarative_base(). " +
            "database.py MUST ALSO define an idempotent async seed_db(session): at the top SELECT one " +
            "row from the first table and return early if any exists; insert rows respecting FK order " +
            "(parents before children); commit at the end. seed_db inserts at least 2 rows for EVERY ORM " +
            "model in models.py and at least one row for EACH value of every Enum column. CRITICAL for " +
            "dropdowns: pick ONE primary demo entity (the first entity the UI links to) and give it the " +
            "FULL set of related rows every form on it needs — for each distinct value any screen filters " +
            "a <select> on, attach at least one matching row to THAT demo entity (e.g. the demo child owns " +
            "one Diagnosis of EACH DiagnosisType the form selects, including FetalGrowthIndication), not " +
            "one-per-different-entity. Also seed lookup/reference entities so their GLOBAL list endpoint is " +
            "non-empty independent of any parent. " +
            "seed_db MUST be `async def seed_db(session)` taking that AsyncSession (the entry layer calls " +
            "`async with async_session() as s: await seed_db(s)`). The module's PUBLIC names are EXACTLY: " +
            "Base, engine, async_session, get_db, seed_db — later layers import these verbatim, so do not " +
            "rename them. " +
            "CASING CONTRACT: schemas.py MUST define ONE shared base `class CamelModel(BaseModel): " +
            "model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)` " +
            "(import: from pydantic.alias_generators import to_camel) and EVERY Pydantic schema inherits " +
            "CamelModel (never BaseModel directly, never a per-class model_config that omits these). This makes " +
            "the JSON API camelCase end-to-end to match the React frontend, while still accepting snake_case. " +
            "SCALAR TYPES: render each attribute with its modeled primitive type — an integer attribute is " +
            "Integer in models.py and `int` in the schema (NEVER widened to float). ENUMS/STATES: an attribute " +
            "with a fixed value set (e.g. Gender boy/girl, a status) is typed typing.Literal[...] (or a Python " +
            "Enum) in BOTH the Create and Response schema — NEVER bare str — so an invalid value 422s at the " +
            "boundary instead of silently flowing through to produce null/garbage downstream. " +
            "MODELS (SQLAlchemy declarative): EVERY attribute is `Column(<Type>, ...)` — NEVER assign a bare " +
            "type (WRONG: `id = String(36)`), NEVER set attributes on a type (WRONG: `id.primary_key = True`), " +
            "and do NOT write a custom __init__ on a declarative model. EVERY model has a primary key: " +
            "`id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))`. A model without a " +
            "Column(primary_key=True) fails to boot (SQLAlchemy 'could not assemble any primary key columns').",
    },
    {
        name: "API",
        files: ["backend/routers.py"],
        instruction:
            "All FastAPI endpoints in one router module, using ONLY the models + schemas already " +
            "written, and importing get_db from backend.database (already written) for the DB session " +
            "dependency: `session: AsyncSession = Depends(get_db)`. NEVER stub the session " +
            "(no Depends(lambda: None)) — the real get_db already exists. " +
            "For EVERY entity whose id is consumed by another endpoint (any `*_id` request field, including " +
            "process/transition endpoints) OR that any frontend selection field must enumerate, expose a " +
            "GLOBAL list endpoint `@router.get('/<plural>', response_model=List[<Entity>Response])` returning " +
            "ALL rows (select(<Entity>) with no parent filter) — in ADDITION to any parent-nested getter; a " +
            "child-scoped read does NOT satisfy this. When a backend lookup validates a value by a " +
            "discriminator (WHERE type==X with no owner scope), expose a matching unscoped GET /<plural>?type=X. " +
            "SCHEMA CONTRACT (mandatory): request bodies use the *Create/*Update schemas; ALL responses use the " +
            "*Response schemas. Every list endpoint: response_model=List[<Entity>Response]; every GET/{id}: " +
            "response_model=<Entity>Response. NEVER use a *Create/*Update schema as a response_model, NEVER return " +
            "a hand-built dict where a *Response exists — return the ORM object and let FastAPI serialize it. " +
            "Import every *Response you reference. " +
            "PROCESS ENDPOINTS: bind a dedicated typed Pydantic request schema (e.g. `body: DiagnoseAndTreatRequest`) " +
            "— NEVER accept a bare `dict` or read fields via `.get()`. Let Pydantic enforce required fields; do NOT " +
            "re-check presence with `if not all([...])` (it wrongly rejects a legitimate 0/False) — if you must, " +
            "check `is None` per field. " +
            "NULL-SAFETY: any model field declared nullable is None until set; before any arithmetic/comparison " +
            "(<, >, etc.) on such a DB-sourced field, guard `if x is None:` and raise HTTPException(422, " +
            "detail='<field> not set') or skip the rule. " +
            "CRUD SCOPE: for every entity a USER MUST SUPPLY as input to a process (agents, instruments, " +
            "consumee/input objects), emit BOTH POST /<plural> (body=*Create) AND GET /<plural> (list, " +
            "response_model=List[*Response]). Do NOT emit create/update/delete for objects a process YIELDS " +
            "(resultees) — those are produced by their process endpoint only. " +
            "INLINE REQUEST MODELS: every inline process/transition request model in routers.py MUST subclass " +
            "the shared CamelModel (`from backend.schemas import CamelModel`) — NEVER plain BaseModel — so " +
            "process bodies accept camelCase. PARAM LOCATION: a scalar endpoint parameter NOT wrapped in Body() " +
            "and NOT in the path template is a QUERY param — the frontend must send it in the query string, not " +
            "the JSON body. RESULTEE DATAFLOW: when a process computes a result that a LATER process consumes, " +
            "that result MUST be (a) a persisted column on the producing entity model, (b) a field on that " +
            "entity's *Response, and (c) written to the ORM object before commit — NEVER computed into a local " +
            "and discarded. Return the updated entity (or a dedicated response carrying the value) so it is " +
            "visible to the UI and to the next process. GUARD 500s: before any division guard the divisor is " +
            "non-zero; before int(s.split('-')) validate the string shape (422 on malformed, not 500).",
    },
    {
        name: "Backend entry",
        files: ["backend/main.py", "backend/requirements.txt", "backend/Dockerfile"],
        instruction:
            "main.py wires the router(s) + CORS, imports engine/Base from backend.database (already " +
            "written), and creates tables on startup (Base.metadata.create_all). Do NOT redefine the " +
            "engine, Base, or get_db. requirements.txt must list every imported package (include " +
            "aiosqlite AND asyncpg). " +
            "main.py MUST import seed_db from backend.database and, inside the FastAPI lifespan/startup handler, " +
            "call it in a session immediately AFTER Base.metadata.create_all and BEFORE serving " +
            "(async with async_session() as s: await seed_db(s)). " +
            "LAUNCH MUST MATCH IMPORTS: the backend uses package-relative imports (from backend.x), so it runs " +
            "ONLY from the repo root as `uvicorn backend.main:app`. The Dockerfile MUST set WORKDIR /app, " +
            "`COPY backend/ ./backend/` (preserve the package dir — NEVER `COPY backend/ .`), copy requirements " +
            "from ./backend/requirements.txt, and CMD running `python -m uvicorn backend.main:app --host 0.0.0.0 " +
            "--port 8000`. NEVER generate `cd backend && uvicorn main:app`. The EXPOSE/CMD port MUST equal the " +
            "docker-compose.yml port.",
    },
    {
        name: "Frontend",
        files: ["frontend/src/main.tsx", "frontend/src/App.tsx", "frontend/src/api.ts", "frontend/index.html", "frontend/src/index.css"],
        instruction:
            "Plus ONE page component per main entity under frontend/src/pages/. Call EXACTLY the routes already defined above — match every path + field name. " +
            "ROUTING: if you use client-side routing, use react-router-dom for ALL navigation (Router/Routes/Route/Link/useNavigate/useParams). " +
            "SELF-CONTAINED IMPORTS: every relative import in main.tsx/App.tsx/pages MUST be a file you also emit in THIS layer — never import a file you do not generate. main.tsx MUST `import './index.css'` and you MUST emit frontend/src/index.css with real styles (semantic selectors .header/.nav/.container/.card/.table/.loading/.error/.form-group plus base body styles) for the exact className values your components use. Pick ONE styling approach: do NOT emit @tailwind directives unless your JSX uses Tailwind utility classes — keep index.css and JSX in agreement. " +
            "FORM REFERENCE FIELDS (mandatory): any form field whose submitted payload key ends in `_id` (it carries another entity's identifier) MUST render as a <select> bound to options loaded in the page's load effect — NEVER a free-text/paste-the-UUID <input>. In the page's useEffect/Promise.all, fetch the candidate records via the matching api.ts function for EVERY such field and store them in an option-state array; render one <option> per record using its id as value and a human-readable label (name, else id). Do not declare an option-state array or interface you never fetch into. " +
            "DROPDOWN OPTION SOURCE: a reference/foreign-key <select> MUST source its options from the TOP-LEVEL listing endpoint for that target entity (e.g. GET /diagnoses), matching how the backend validates the submitted id — NEVER from an owner/child-scoped or already-filtered endpoint. Do NOT add a client-side .filter() on a discriminator (e.g. d.type==='X') unless you call a dedicated listing endpoint guaranteed to return rows with that value (e.g. GET /diagnoses?type=X). Assume a freshly-seeded DB: any required <select> that could render zero options is a defect — surface a visible 'No options available' empty-state and disable the field instead of a silently empty required dropdown. " +
            "RESPONSE NORMALIZATION: list endpoints may return either an array or a single object; normalize with `Array.isArray(res.data) ? res.data : res.data ? [res.data] : []` before mapping. " +
            "CREATE SURFACES: for every entity that is selected in any form, also emit a Create page (route /<plural>/new) that POSTs a new row via api.ts, add a 'New' link on that entity's list page, register the route in App.tsx, and add a create() method to that entity's api.ts object. Never ship a list page whose only states are a table and an empty-state with no way to add a record. " +
            "CREATE-FORM COMPLETENESS: each Create page MUST collect EVERY required (non-Optional) field of that entity's *Create schema — including foreign-key fields (payload keys ending in _id), which render as a <select> populated from the referenced entity's global list endpoint (never omitted, never a free-text id). A 422 on submit means the form is missing a required field. " +
            "CASING: send request payload keys in camelCase and read response keys in camelCase (the backend's CamelModel base makes the API camelCase). " +
            "NULLABILITY: a TS interface field is `T | null` iff the backend field is Optional/nullable; guard reads of nullable fields (e.g. `{x ?? '-'}`) so a null never renders as 'undefined' or crashes. " +
            "NUMERIC PARSE: parse int fields with parseInt(v, 10) (input step=\"1\" min=\"0\") and float fields with parseFloat(v) (step=\"any\"); for an empty Optional numeric field OMIT the key rather than sending NaN. " +
            "FK LABELS: a reference <select> option label MUST be human-readable — use a descriptive field if one exists, else a COMPOSITE of the row's scalar fields plus a short id slice (e.g. `${c.ageMonths}mo ${c.gender} (${c.id.slice(-6)})`); NEVER render the raw UUID as the only label. " +
            "PROCESS/ACTION WIRING: for EVERY backend endpoint that is not plain entity CRUD (nested /{id}/<action> POST/PUT routes, compute/transition endpoints), emit a typed api.ts wrapper with the EXACT method + path + param-location, AND surface it in the UI — build an orchestration page (e.g. a Child detail / 'Diagnose & Treat' page) with buttons that invoke those actions in the modeled sequence and display their results, registered as a route in App.tsx. EVERY backend route must have a matching api.ts call — a route with no frontend caller is a defect.",
    },
    {
        name: "Config",
        files: [
            "frontend/package.json", "frontend/vite.config.ts", "frontend/tsconfig.json",
            "frontend/postcss.config.js", "frontend/tailwind.config.js", "frontend/Dockerfile",
            "docker-compose.yml", "railway.json", "README.md", "TRACEABILITY.md",
        ],
        instruction:
            "package.json dependencies MUST cover EVERY package imported by the frontend files — never a hardcoded list. Always include react, react-dom, axios; include react-router-dom whenever any page or App.tsx uses routing (useParams/useNavigate/Link/Routes); include tailwindcss/postcss/autoprefixer in devDependencies if used. Keep scripts exactly {\"dev\":\"vite\",\"build\":\"vite build\",\"preview\":\"vite preview\"}. " +
            "frontend/tsconfig.json MUST be a valid Vite+React config that passes `tsc --noEmit`: use ONLY real tsc options (the field is useDefineForClassFields, NOT useDefineForModule); whenever resolveJsonModule is enabled with module:ESNext, set moduleResolution to 'Bundler' (never leave it defaulting to classic); set jsx:'react-jsx'. " +
            "Make tsconfig.json SELF-CONTAINED: do NOT use `references`, project references, or `composite` pointing at a tsconfig.node.json (or ANY file) you do not also emit — keep all options inline in the single tsconfig.json and add vite.config.ts to `include`. A dangling reference to a non-emitted file fails `vite build`. " +
            "docker-compose.yml may reference ONLY Dockerfiles you also emit. Emit frontend/Dockerfile: FROM node:20-alpine, WORKDIR /app, COPY package*.json ./ (context-relative — build context is ./frontend, do NOT prefix with frontend/), RUN npm install, COPY . ., RUN npm run build, CMD running `npm run preview -- --host 0.0.0.0 --port 5173`, EXPOSE 5173. " +
            "Emit railway.json at repo root (two services + one Postgres plugin) — the brief mandates it. " +
            "README.md MUST: (1) include a 'Local Development' section with EXACT commands run from the PROJECT ROOT — backend `uvicorn backend.main:app --reload`, frontend `cd frontend && npm install && npm run dev`; (2) in 'API Endpoints' list ONLY routes that appear in backend/routers.py; (3) in 'Project Structure' list ONLY files emitted by this build. " +
            "TRACEABILITY.md MUST list EVERY OPM id from the brief — every object id (O1..On) and every process id (P1..Pn) — each on a line mapping it to the file that implements it (e.g. `- O4 Child -> backend/models.py`).",
    },
];

// Deterministic safety net: make frontend/package.json declare every npm package the
// emitted frontend code actually imports. The Config layer is *asked* to derive deps
// from imports, but a single miss (e.g. react-router-dom) builds to a white screen.
// So after generation we scan the real imports and union in the ones we know.
const FRONTEND_DEP_VERSIONS: Record<string, string> = {
    "react": "^18",
    "react-dom": "^18",
    "axios": "^1",
    "react-router-dom": "^6",
    "@tanstack/react-query": "^5",
    "zustand": "^4",
    "clsx": "^2",
};

// Bare (non-relative) import roots in a JS/TS source: "react-dom/client" -> "react-dom",
// "@scope/pkg/sub" -> "@scope/pkg". Relative ("./", "/") specifiers are ignored.
function bareImportRoots(content: string): string[] {
    const roots = new Set<string>();
    const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        const spec = m[1] ?? m[2];
        if (!spec || spec.startsWith(".") || spec.startsWith("/")) continue;
        const parts = spec.split("/");
        roots.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
    return [...roots];
}

// Union the frontend's real imports into frontend/package.json dependencies, so the
// manifest never omits a package a .tsx file imports. Only adds packages we have a
// known-good version for; an unknown import is left for the build tier to flag.
function reconcileFrontendDeps(files: FileSpec[], log: Progress): void {
    const pkg = files.find((f) => f.path.endsWith("frontend/package.json"));
    if (!pkg) return;
    let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try { json = JSON.parse(pkg.content); } catch { return; } // malformed — leave for the loop to fix
    const deps = json.dependencies ?? (json.dependencies = {});
    const dev  = json.devDependencies ?? (json.devDependencies = {});

    const imported = new Set<string>();
    for (const f of files) {
        if (/frontend\/.*\.(t|j)sx?$/.test(f.path)) {
            for (const r of bareImportRoots(f.content)) imported.add(r);
        }
    }
    const added: string[] = [];
    for (const root of imported) {
        if (deps[root] || dev[root]) continue;
        const ver = FRONTEND_DEP_VERSIONS[root];
        if (!ver) continue; // unknown package: don't guess a version
        deps[root] = ver;
        added.push(`${root}@${ver}`);
    }
    // Config-file devDeps that aren't `import`ed from .tsx (so the import scan misses
    // them) but ARE required to build: postcss.config.js / tailwind.config.js reference
    // tailwindcss/autoprefixer/postcss, and `@tailwind` in CSS needs tailwindcss. A
    // postcss config naming a plugin not in package.json fails `vite build` outright.
    const FE_DEV_VERSIONS: Record<string, string> = { tailwindcss: "^3", postcss: "^8", autoprefixer: "^10" };
    const cfgText = files
        .filter((f) => /frontend\/(postcss\.config|tailwind\.config)\.[cm]?[jt]s$/.test(f.path) || /frontend\/.*\.css$/.test(f.path))
        .map((f) => f.content)
        .join("\n");
    const usesTailwind = /tailwindcss/.test(cfgText) || /@tailwind\b/.test(cfgText);
    for (const [name, ver] of Object.entries(FE_DEV_VERSIONS)) {
        const needed = name === "tailwindcss" ? usesTailwind : cfgText.includes(name) || usesTailwind;
        if (needed && !dev[name] && !deps[name]) { dev[name] = ver; added.push(`${name}@${ver} (dev)`); }
    }
    if (added.length) {
        pkg.content = JSON.stringify(json, null, 2);
        log(`📦 Dependency reconciler: added ${added.join(", ")} to frontend/package.json.`);
    }
}

// Make frontend/tsconfig.json self-contained: strip any references/extends pointing
// at a file we did NOT emit (a dangling "./tsconfig.node.json" reference breaks
// `vite build`). The model fixes this inconsistently, so enforce it deterministically.
function reconcileTsconfig(files: FileSpec[], log: Progress): void {
    const ts = files.find((f) => f.path.endsWith("frontend/tsconfig.json"));
    if (!ts) return;
    let j: { references?: { path?: string }[]; extends?: string };
    try { j = JSON.parse(ts.content); } catch { return; }
    const have = new Set(files.map((f) => f.path.replace(/^[\\/]+/, "")));
    const resolve = (ref: string) => ("frontend/" + ref.replace(/^\.\//, "").replace(/^\//, "")).replace(/\/\.\//g, "/");
    let changed = false;
    if (Array.isArray(j.references)) {
        const kept = j.references.filter((r) => r && r.path && have.has(resolve(r.path)));
        if (kept.length !== j.references.length) { j.references = kept; changed = true; }
    }
    if (typeof j.extends === "string" && j.extends.startsWith(".") && !have.has(resolve(j.extends))) {
        delete j.extends; changed = true;
    }
    if (changed) {
        ts.content = JSON.stringify(j, null, 2);
        log("🔧 tsconfig reconciler: stripped dangling references/extends (self-contained).");
    }
}

// Deterministic post-generation normalization applied to EVERY produced artifact
// (initial, each reflective fix, and integration repair) so model inconsistencies
// in the manifest/tsconfig can never ship or stall the loop.
function normalizeArtifact(files: FileSpec[], log: Progress): void {
    reconcileFrontendDeps(files, log);
    reconcileTsconfig(files, log);
}

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

    // Deterministic normalization: package.json declares every frontend import, and
    // tsconfig is self-contained (no dangling references) — model-independent.
    normalizeArtifact(written, log);

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

// Action 2: diagnose WHY the tests failed, before touching code. Each past attempt
// is passed in paired with the failures it faced, so the agent sees not just what
// it tried but what that attempt failed to fix — and avoids repeating it.
export async function reflectOnFailures(
    report: TestReport,
    history: AttemptRecord[],
    ir: AgentIR,
): Promise<ReflectionNote> {
    const priorPlans = history.length
        ? history
            .map((h, i) =>
                `Attempt ${i + 1}: faced [${h.failures.join("; ")}] → tried "${h.fixPlan}" → still failed.`)
            .join("\n")
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
    const base = file.path.split("/").pop() ?? file.path;          // "schemas.py"
    const stem = base.replace(/\.[^.]+$/, "");                      // "schemas"
    if (fail.id.includes(file.path) || fail.detail.includes(file.path)) {
        return true;
    }
    if (base.length > 3 && fail.detail.includes(base)) {
        return true;
    }
    // Symbol/import errors often name the module by stem, not path — e.g.
    // "cannot import name 'UserCreate' from 'schemas'". Match on the stem so these
    // scope to the right file instead of falling back to the whole repo. Guarded
    // by length so noisy short stems (main/api/App) don't over-match.
    if (stem.length > 4 && fail.detail.includes(stem)) {
        return true;
    }
    if (fail.kind === "uncovered_id" && ID_HOME_FILES.includes(file.path)) {
        return true;
    }
    return false;
}

// Fallback for a build error that named no specific file (e.g. "backend: pip
// install"): scope to the failing SUBTREE (or the dependency manifest) instead of
// the whole repo. A backend build error re-emits only backend/ files, a frontend
// one only frontend/ — far tighter, so we almost never send the full repo.
function buildErrorTargetsFile(fail: Failure, file: FileSpec): boolean {
    if (fail.kind !== "build_error") {
        return false;
    }
    if (fail.id.includes("pip install")) {
        return file.path.endsWith("requirements.txt");
    }
    if (fail.id.includes("npm install")) {
        return file.path.endsWith("package.json");
    }
    if (fail.id.includes("backend")) {
        return file.path.startsWith("backend/");
    }
    if (fail.id.includes("frontend")) {
        return file.path.startsWith("frontend/");
    }
    return false;
}

function filesImplicatedBy(prevFiles: CodeArtifact, report: TestReport): FileSpec[] {
    const hits = new Set<string>();

    // Pass 1 — precise matching (path / basename / stem / coverage routing).
    // Track which failures pinned at least one file so we know what's unresolved.
    const unmatchedBuildErrors: Failure[] = [];
    for (const fail of report.failures) {
        let matched = false;
        for (const f of prevFiles) {
            if (failurePointsAtFile(fail, f)) {
                hits.add(f.path);
                matched = true;
            }
        }
        if (!matched && fail.kind === "build_error") {
            unmatchedBuildErrors.push(fail);
        }
    }

    // Pass 2 — build errors that pinned nothing precise → scope to their subtree.
    for (const fail of unmatchedBuildErrors) {
        for (const f of prevFiles) {
            if (buildErrorTargetsFile(fail, f)) {
                hits.add(f.path);
            }
        }
    }

    const out: FileSpec[] = [];
    for (const f of prevFiles) {
        if (hits.has(f.path)) {
            out.push(f);
        }
    }
    return out;
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
    const merged = mergeFiles(prevFiles, patches);
    normalizeArtifact(merged, log);
    return merged;
}

// A stronger model for the FINAL whole-repo integration pass — cross-file wiring
// bugs (mismatched signatures, missing exports, a double Base/engine) need a global
// view and more discipline than the per-file repair model.
const INTEGRATION_MODEL = "claude-sonnet-4-6";

// Final safety net before the pipeline ships an app: when the loop is about to
// finalize an artifact that still fails to boot, do ONE whole-repo pass focused
// ONLY on cross-file consistency so the app imports and BOOTS. Business logic and
// features are left untouched. Returns the merged artifact.
export async function integrationRepair(
    files: CodeArtifact,
    report: TestReport,
    ir: AgentIR,
    onProgress?: Progress,
): Promise<CodeArtifact> {
    const prompt = `
The files below were generated layer-by-layer and may have CROSS-FILE
inconsistencies that stop the app from importing or booting — e.g. a function
imported with the wrong signature, a name imported that the defining module does
not export, the SQLAlchemy Base or engine defined in two places, or mismatched
import conventions between modules.

The build/boot test reported these failures:
${report.failures.map((f) => `- ${f.detail}`).join("\n") || "(none captured)"}

Re-emit ONLY the files you must change so the project IMPORTS and BOOTS cleanly.
Rules:
- Fix WIRING/INTEGRATION ONLY. Do NOT add features, change business logic/formulas,
  remove endpoints, or rename public routes or entities.
- Make module contracts agree: a function is called with the exact signature it is
  defined with; every imported name is actually exported by its module.
- Exactly ONE SQLAlchemy declarative Base (in the models module), imported everywhere.
  Exactly ONE async engine + session (in the database module), imported by the rest.
- One import convention across the backend (package-relative, e.g. "from backend.x").

## OPM IR
${JSON.stringify(ir, null, 2)}

## Current files
${files.map((f) => `===FILE: ${f.path}===\n${f.content}\n===END===`).join("\n\n")}
`.trim();

    const text = await generateComplete(
        (p) => claudeAskText(p, INTEGRATION_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${prompt}`,
        onProgress,
    );
    const patches = parseDelimitedFiles(text);
    const merged = mergeFiles(files, patches);
    normalizeArtifact(merged, onProgress ?? (() => { /* no-op */ }));
    return merged;
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Lines that declare an interface another layer must match: classes, functions,
// route decorators, exported TS types. We keep these (the "signatures") and drop
// the bodies, so the next layer sees what exists without resending the codebase.
const SIGNATURE_RE =
    /^\s*(import |class |def |async def |@app\.|@router\.|app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch)|export |interface |type \w+\s*=|function )/;

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
