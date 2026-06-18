// Agent 2 — the Testing Agent.
//
// It independently evaluates a CodeArtifact and emits a structured TestReport.
// It NEVER generates or fixes code (that is Agent 1's job); keeping detection
// separate from generation is what stops the model "grading its own homework".
//
// This is the SINGLE place testing is defined. It is called from two contexts:
//   - inside the build loop (on the in-memory artifact), and
//   - by Stage 5 (on the files read back from disk) for the dashboard report.
//
// Detection tiers (cheap+real -> expensive):
//   Tier 1  structural : required files present, non-empty, every OPM id covered.
//   Tier 2a formula    : each IR computation must parse as valid JS (new Function);
//                        catches a dropped "*" (e.g. ")100" instead of ")*100").
//   Tier 2b python     : best-effort `py_compile` of generated .py files; skipped
//                        silently if python is not available.
//   Tier 3  build&boot : actually `npm run build` + `pip install` + `import main`;
//                        catches missing deps / broken imports. Off unless
//                        OPM_RUN_BUILD_CHECKS=1 (it's slow and runs the code).
//   Tier 4  acceptance : LLM-judged behaviour tests; skipped if Gemini is absent.

import { execFileSync, spawnSync, spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { runAcceptanceReview } from "./acceptance";
import type { FileSpec, Failure, TestReport, AgentIR } from "./types";
import type { CoverageReport } from "../infra/types";

const REQUIRED_FILES = ["README.md", "TRACEABILITY.md", "docker-compose.yml"];

function normPath(p: string): string {
    return p.replace(/^[\\/]+/, "");
}

function idPattern(id: string): RegExp {
    return new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

// OPM-id coverage: which objects/processes are referenced somewhere in the code.
export function computeCoverageReport(files: FileSpec[], ir: AgentIR): CoverageReport {
    const blob = files.map((f) => f.content).join("\n");
    const seen = (id: string) => idPattern(id).test(blob);

    const objIds  = (ir.objects   ?? []).map((o) => o.id);
    const procIds = (ir.processes ?? []).map((p) => p.id);

    const objMissing  = objIds.filter((id) => !seen(id));
    const procMissing = procIds.filter((id) => !seen(id));

    const objects   = { total: objIds.length,  covered: objIds.length  - objMissing.length,  missing: objMissing };
    const processes = { total: procIds.length, covered: procIds.length - procMissing.length, missing: procMissing };
    const links     = { total: 0, covered: 0, missing: [] as string[] };

    const total   = objects.total + processes.total;
    const covered = objects.covered + processes.covered;
    return {
        total_elements: total,
        covered,
        coverage_pct:   total === 0 ? 100 : Math.round((covered / total) * 100),
        missing:        [...objMissing, ...procMissing],
        objects, processes, links,
    };
}

// Tier 1 (files only): required files present and non-empty. (Coverage is handled
// separately via the CoverageReport, so it can also feed the dashboard.)
function fileFailures(files: FileSpec[]): Failure[] {
    const failures: Failure[] = [];
    const paths = files.map((f) => normPath(f.path));

    for (const req of REQUIRED_FILES) {
        if (!paths.some((p) => p === req || p.endsWith(`/${req}`))) {
            failures.push({ kind: "missing_file", id: req, detail: `required file missing: ${req}` });
        }
    }
    for (const f of files) {
        if (f.content.trim().length === 0) {
            failures.push({ kind: "empty_file", id: f.path, detail: `file is empty: ${f.path}` });
        }
    }
    return failures;
}

// Tier 2a: every IR computation must be syntactically valid code. `new Function`
// only PARSES, so undefined variables are fine — only a real SyntaxError throws.
function formulaFailures(ir: AgentIR): Failure[] {
    const failures: Failure[] = [];
    for (const p of ir.processes ?? []) {
        const code = (p.computation ?? "").trim();
        if (!code) continue;
        try {
            // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
            new Function(code);
        } catch (e) {
            failures.push({
                kind:   "invalid_formula",
                id:     p.id,
                detail: `${p.id} ("${p.name ?? ""}") computation is not valid code: ${(e as Error).message}. ` +
                        `Likely a dropped operator — write ")*100" not ")100", "a*b" not "ab".`,
            });
        }
    }
    return failures;
}

function findPython(): string | null {
    for (const cmd of ["python3", "python"]) {
        try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return cmd; }
        catch { /* not found, try next */ }
    }
    return null;
}

// Tier 2b: best-effort Python syntax check. Skips silently if python is absent.
function pythonSyntaxFailures(files: FileSpec[]): Failure[] {
    const pyFiles = files.filter((f) => f.path.endsWith(".py"));
    if (pyFiles.length === 0) return [];

    const python = findPython();
    if (!python) return []; // environment has no python — this tier is unavailable

    const failures: Failure[] = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opm-pychk-"));
    try {
        for (const f of pyFiles) {
            const tmp = path.join(dir, path.basename(f.path));
            fs.writeFileSync(tmp, f.content);
            try {
                execFileSync(python, ["-m", "py_compile", tmp], { stdio: "pipe" });
            } catch (e) {
                failures.push({
                    kind:   "python_syntax",
                    id:     f.path,
                    detail: `python syntax error in ${f.path}: ${(e as Error).message}`,
                });
            }
        }
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    return failures;
}

// Stable key for a failure set — used by the orchestrator to detect a stall
// (the same failures recurring means the model is stuck).
export function signatureOf(failures: Failure[]): string {
    return failures.map((f) => `${f.kind}:${f.id}`).sort().join("|");
}

// ── Tier 2c: frontend import resolvability + compose closure (deterministic) ──
// Always-on and cheap. The env-gated Tier 3 actually builds, but by default it is
// off — so these two static checks are what stop the exact boot defects that shipped:
// react-router-dom missing from package.json (white screen), main.tsx importing a
// never-emitted ./index.css (the file-lane enforcer dropped it), and docker-compose
// referencing a missing frontend/Dockerfile.

const FE_SRC_RE = /frontend\/.*\.(t|j)sx?$/;
const ASSET_RE  = /\.(svg|png|jpe?g|gif|webp|ico|avif)$/i;
const NODE_BUILTINS = new Set([
    "fs", "path", "os", "url", "http", "https", "crypto", "stream", "util", "events",
    "child_process", "process", "buffer", "querystring", "zlib",
]);

// Every import specifier in a JS/TS source (both `... from '...'` and bare `import '...'`).
function importSpecifiers(content: string): string[] {
    const specs: string[] = [];
    const re = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
        const s = m[1] ?? m[2];
        if (s) specs.push(s);
    }
    return specs;
}

// Package root of a specifier: "react-dom/client" -> "react-dom", "@scope/p/x" -> "@scope/p".
function pkgRoot(spec: string): string {
    const parts = spec.split("/");
    return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// Does a relative import from `fromPath` resolve to some emitted file?
function relativeResolves(spec: string, fromPath: string, have: Set<string>): boolean {
    const stack = normPath(fromPath).split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") stack.pop();
        else stack.push(seg);
    }
    const base = stack.join("/");
    const candidates = [
        base,
        `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.json`, `${base}.css`,
        `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`,
    ];
    return candidates.some((c) => have.has(c));
}

export function frontendResolvabilityFailures(files: FileSpec[]): Failure[] {
    const pkg = files.find((f) => normPath(f.path).endsWith("frontend/package.json"));
    if (!pkg) return []; // no frontend manifest — nothing to resolve against
    let deps = new Set<string>();
    try {
        const j = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        deps = new Set([...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})]);
    } catch {
        return [{ kind: "build_error", id: "frontend: package.json", detail: "frontend/package.json is not valid JSON" }];
    }
    const have = new Set(files.map((f) => normPath(f.path)));
    const out: Failure[] = [];
    const seen = new Set<string>();
    for (const f of files) {
        const p = normPath(f.path);
        if (!FE_SRC_RE.test(p)) continue;
        for (const spec of importSpecifiers(f.content)) {
            if (spec.startsWith(".") || spec.startsWith("/")) {
                if (ASSET_RE.test(spec)) continue; // assets may be handled by the bundler / external
                if (!relativeResolves(spec, p, have)) {
                    const key = `rel:${p}:${spec}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        out.push({ kind: "build_error", id: `frontend: ${spec}`, detail: `${f.path} imports '${spec}' but no emitted file resolves it (e.g. a missing index.css or page).` });
                    }
                }
                continue;
            }
            const root = pkgRoot(spec);
            if (root === "react" || root === "react-dom" || root.startsWith("node:") || NODE_BUILTINS.has(root) || deps.has(root)) continue;
            const key = `dep:${root}`;
            if (!seen.has(key)) {
                seen.add(key);
                out.push({ kind: "build_error", id: `npm install: ${root}`, detail: `frontend imports '${root}' (in ${f.path}) but it is not declared in frontend/package.json dependencies.` });
            }
        }
    }
    return out;
}

// docker-compose may only reference Dockerfiles that are actually emitted.
export function composeClosureFailures(files: FileSpec[]): Failure[] {
    const compose = files.find((f) => { const p = normPath(f.path); return p === "docker-compose.yml" || p.endsWith("/docker-compose.yml"); });
    if (!compose) return [];
    const have = new Set(files.map((f) => normPath(f.path)));
    const out: Failure[] = [];
    const seen = new Set<string>();
    const clean = (s: string) => s.trim().replace(/^['"]|['"]$/g, "").replace(/\/$/, "");
    // Resolve a (context, dockerfile) pair to a repo-root-relative emitted path.
    // dockerfile may itself be root-relative ("backend/Dockerfile") with context "."
    // OR a bare name ("Dockerfile") with context "./backend". Collapse "./" so a
    // "./backend/Dockerfile" reference matches the emitted "backend/Dockerfile"
    // (without this the leading "./" caused false-positive "not emitted" failures).
    const resolve = (ctx: string, df: string): string => {
        const c = clean(ctx);
        const d = clean(df);
        const base = (c && c !== ".") ? `${c}/${d}` : d;
        return normPath(base.replace(/^\.\//, "").replace(/\/\.\//g, "/"));
    };
    const flag = (full: string, why: string) => {
        if (!have.has(full) && !seen.has(full)) { seen.add(full); out.push({ kind: "build_error", id: `compose: ${full}`, detail: why }); }
    };
    let ctx = ".";
    for (const line of compose.content.split("\n")) {
        if (/^\s*build:\s*$/.test(line)) ctx = ".";          // new build block — reset context default
        const cm = line.match(/^\s*context:\s*(\S+)/);
        if (cm) ctx = cm[1];
        const dm = line.match(/^\s*dockerfile:\s*(\S+)/);
        if (dm) {
            const full = resolve(ctx, dm[1]);
            flag(full, `docker-compose.yml references Dockerfile '${full}' that is not emitted.`);
        }
        const bm = line.match(/^\s*build:\s*(\S+)\s*$/);     // shorthand: build: ./frontend
        if (bm) {
            const full = resolve(bm[1], "Dockerfile");
            flag(full, `docker-compose.yml build context '${bm[1].trim()}' has no emitted ${full}.`);
        }
    }
    return out;
}

// A tsconfig must not point (via references / extends) at a file we don't emit —
// a dangling "./tsconfig.node.json" reference fails `vite build` even though every
// compilerOption is valid. Deterministic + always-on, so the loop self-corrects it.
export function tsconfigClosureFailures(files: FileSpec[]): Failure[] {
    const have = new Set(files.map((f) => normPath(f.path)));
    const out: Failure[] = [];
    for (const f of files) {
        const p = normPath(f.path);
        if (!/frontend\/.*tsconfig.*\.json$/.test(p)) continue;
        let j: { references?: { path?: string }[]; extends?: string };
        try { j = JSON.parse(f.content); } catch { continue; } // tsc-validity is checked elsewhere
        const dir = p.split("/").slice(0, -1);
        const resolveRel = (ref: string): string => {
            const stack = [...dir];
            for (const seg of ref.split("/")) { if (seg === "" || seg === ".") continue; if (seg === "..") stack.pop(); else stack.push(seg); }
            let base = stack.join("/");
            if (!/\.json$/.test(base)) base += "/tsconfig.json"; // a dir reference resolves to its tsconfig.json
            return normPath(base);
        };
        const refs: string[] = [];
        for (const r of j.references ?? []) if (r && r.path) refs.push(r.path);
        if (typeof j.extends === "string" && j.extends.startsWith(".")) refs.push(j.extends);
        for (const ref of refs) {
            const full = resolveRel(ref);
            if (!have.has(full)) {
                out.push({ kind: "build_error", id: `tsconfig: ${ref}`, detail: `${f.path} references '${ref}' (-> ${full}) which is not emitted — breaks the frontend build.` });
            }
        }
    }
    return out;
}

// ── Contract-integrity checks (deterministic, always-on) ─────────────────────
// Catch the front<->back contract drift the audit found: a per-class model_config
// that clobbers the camelCase base, inline request models on BaseModel (422 on
// camelCase), and backend routes with no api.ts caller (the process flow left
// unreachable from the UI).

function fileEndingWith(files: FileSpec[], suffix: string): FileSpec | undefined {
    return files.find((f) => normPath(f.path).endsWith(suffix));
}

// schemas.py: once a shared CamelModel base exists, NO other schema may declare its
// own model_config (it silently overrides alias_generator and re-breaks camelCase).
export function schemaCasingIntegrityFailures(files: FileSpec[]): Failure[] {
    const f = fileEndingWith(files, "backend/schemas.py");
    if (!f || !/class\s+CamelModel\b/.test(f.content)) return [];
    const out: Failure[] = [];
    const lines = f.content.split("\n");
    let cur = "";
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^class\s+(\w+)\b/);
        if (m) { cur = m[1]; continue; }
        if (cur && cur !== "CamelModel" && /model_config\s*=/.test(lines[i])) {
            out.push({ kind: "build_error", id: `schemas: ${cur}.model_config`, detail: `backend/schemas.py: class ${cur} (line ${i + 1}) declares its own model_config, overriding the shared CamelModel alias config and re-breaking camelCase. Remove it and inherit CamelModel.` });
        }
    }
    return out;
}

// routers.py: inline process request models must subclass CamelModel, not BaseModel,
// or they 422 on camelCase request bodies.
export function inlineBaseModelFailures(files: FileSpec[]): Failure[] {
    const f = fileEndingWith(files, "backend/routers.py");
    if (!f) return [];
    const out: Failure[] = [];
    f.content.split("\n").forEach((l, i) => {
        const m = l.match(/^class\s+(\w+)\(BaseModel\)/);
        if (m) out.push({ kind: "build_error", id: `routers: ${m[1]}(BaseModel)`, detail: `backend/routers.py: inline request model ${m[1]} (line ${i + 1}) subclasses BaseModel — it 422s on camelCase bodies. Subclass CamelModel (from backend.schemas import CamelModel).` });
    });
    return out;
}

// models.py: each declarative model must use Column(<Type>, ...) for every attribute and
// have a real primary-key Column — catches the malformed "id = String(36)" / no-PK pattern
// statically (otherwise the app only fails at SQLAlchemy mapper init on boot).
const COLUMN_TYPES = "String|Integer|Float|Boolean|Text|DateTime|JSON|Numeric|BigInteger|SmallInteger|Date|Time|LargeBinary";
export function modelColumnFailures(files: FileSpec[]): Failure[] {
    const f = fileEndingWith(files, "backend/models.py");
    if (!f) return [];
    const out: Failure[] = [];
    const lines = f.content.split("\n");
    const bareRe = new RegExp(`^\\s*(\\w+)\\s*=\\s*(${COLUMN_TYPES})\\(`);
    let cur = "";
    const pk: Record<string, boolean> = {};
    const order: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const cm = lines[i].match(/^class\s+(\w+)\(Base\)/);
        if (cm) { cur = cm[1]; if (!(cur in pk)) { pk[cur] = false; order.push(cur); } continue; }
        if (!cur) continue;
        const bare = lines[i].match(bareRe);
        if (bare) {
            out.push({ kind: "build_error", id: `models: ${cur}.${bare[1]} bare type`, detail: `backend/models.py: ${cur}.${bare[1]} (line ${i + 1}) assigns a bare ${bare[2]}(...) instead of Column(${bare[2]}(...)). Wrap every attribute in Column(...); a bare type breaks the SQLAlchemy mapper and the app won't boot.` });
        }
        if (/Column\([^)]*primary_key\s*=\s*True/.test(lines[i])) pk[cur] = true;
    }
    for (const c of order) {
        if (!pk[c]) out.push({ kind: "build_error", id: `models: ${c} no PK`, detail: `backend/models.py: model ${c} has no Column(..., primary_key=True). Every model needs a primary key, e.g. id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4())).` });
    }
    return out;
}

// Normalize a route/url path so backend templates and frontend template-literals compare:
// "/children/{id}" and "/children/${id}" both -> "/children/{}".
function normRoute(p: string): string {
    return p.replace(/\$\{[^}]+\}/g, "{}").replace(/\{[^}]+\}/g, "{}").replace(/\?.*$/, "").replace(/\/+$/, "") || "/";
}

// Every backend route should have a matching api.ts caller, else the endpoint is
// unreachable from the UI (the FTT diagnose/treat process flow was left unwired).
export function apiRouteCoverageFailures(files: FileSpec[]): Failure[] {
    const be = fileEndingWith(files, "backend/routers.py");
    const fe = fileEndingWith(files, "frontend/src/api.ts");
    if (!be || !fe) return [];
    const called = new Set<string>();
    let m: RegExpExecArray | null;
    const cre = /\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
    while ((m = cre.exec(fe.content)) !== null) called.add(`${m[1].toLowerCase()} ${normRoute(m[2])}`);
    const out: Failure[] = [];
    const seen = new Set<string>();
    const rre = /@router\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]+)[`'"]/g;
    while ((m = rre.exec(be.content)) !== null) {
        const key = `${m[1].toLowerCase()} ${normRoute(m[2])}`;
        if (!called.has(key) && !seen.has(key)) {
            seen.add(key);
            out.push({ kind: "build_error", id: `api wrapper: ${m[1].toUpperCase()} ${normRoute(m[2])}`, detail: `backend route ${m[1].toUpperCase()} ${m[2]} has no matching frontend/src/api.ts caller — unreachable from the UI. Add a typed api.ts wrapper (exact method/path/param-location) and wire it into a page.` });
        }
    }
    return out;
}

// ── Tier 3: build & boot (real, expensive — env-gated) ───────────────────────
// Writes the artifact to disk and actually builds it. Catches what the cheap
// tiers can't: missing deps, broken imports, build failures.

const BUILD_ROOT = path.join(os.tmpdir(), "opm-build-check");

type CmdResult = { ok: boolean; out: string };

// Run a command, time-bounded; stdout+stderr merged. shell:true only for npm
// (resolves npm.cmd on Windows); shell:false for direct executables (python).
function runCmd(
    cmd: string,
    args: string[],
    opts: { cwd: string; timeoutMs: number; env?: Record<string, string>; shell?: boolean },
): CmdResult {
    const r = spawnSync(cmd, args, {
        cwd:      opts.cwd,
        timeout:  opts.timeoutMs,
        encoding: "utf-8",
        shell:    opts.shell ?? false,
        env:      { ...process.env, ...(opts.env ?? {}) },
    });
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    return { ok: !r.error && r.status === 0, out };
}

// Last N chars of output — the actual error, for the reflection step.
function tail(s: string, n = 600): string {
    return s.length > n ? "…" + s.slice(-n) : s;
}

// Write the artifact to a REUSED temp dir, so node_modules/.venv from a previous
// iteration survive and installs stay incremental.
function writeArtifactToTemp(files: FileSpec[]): string {
    const wanted = new Set(files.map((f) => f.path.replace(/^[\\/]+/, "")));
    // Prune orphan files left by a PREVIOUS run so a stale file (e.g. a leftover
    // tsconfig.node.json or index.css from another project) can't make the build pass
    // while the CURRENT artifact is missing it. Keep the expensive caches
    // (node_modules / .venv / __pycache__ / dist / .git) so installs stay incremental.
    const skip = (rel: string) => /(^|\/)(node_modules|\.venv|__pycache__|\.git|dist)(\/|$)/.test(rel);
    const prune = (dir: string) => {
        const entries = (() => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } })();
        for (const e of entries) {
            const full = path.join(dir, e.name);
            const rel = path.relative(BUILD_ROOT, full).split(path.sep).join("/");
            if (skip(rel)) continue;
            if (e.isDirectory()) prune(full);
            else if (!wanted.has(rel)) { try { fs.rmSync(full, { force: true }); } catch { /* ignore */ } }
        }
    };
    prune(BUILD_ROOT);
    for (const f of files) {
        const rel = f.path.replace(/^[\\/]+/, "");
        if (rel.includes("..")) continue;
        const full = path.join(BUILD_ROOT, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, f.content);
    }
    return BUILD_ROOT;
}

// Frontend: npm install + npm run build. Catches missing deps (e.g. tailwindcss).
function checkFrontend(root: string): Failure[] {
    const dir = path.join(root, "frontend");
    if (!fs.existsSync(path.join(dir, "package.json"))) return [];

    const install = runCmd("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, timeoutMs: 240_000, shell: true });
    if (!install.ok) {
        return [{ kind: "build_error", id: "frontend: npm install", detail: `frontend "npm install" failed:\n${tail(install.out)}` }];
    }
    const build = runCmd("npm", ["run", "build"], { cwd: dir, timeoutMs: 240_000, shell: true });
    if (!build.ok) {
        return [{ kind: "build_error", id: "frontend: npm run build", detail: `frontend "npm run build" failed:\n${tail(build.out)}` }];
    }
    return [];
}

// Poll an HTTP endpoint until it answers 2xx or the deadline passes.
async function pollUp(url: string, deadlineMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < deadlineMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {
            /* server not accepting connections yet */
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
}

// Actually START the server and hit it. This is the difference between "build" and
// "boot": `import backend.main` runs the module but NEVER triggers the app's
// lifespan startup, so a bad startup (e.g. an init_db() signature mismatch, a
// broken DB wiring) imports fine yet crashes the moment uvicorn boots. We launch
// uvicorn, wait for FastAPI's always-present /openapi.json (served only after the
// lifespan startup succeeds), then tear the process down.
async function bootBackend(root: string, venvPy: string): Promise<Failure[]> {
    const port = 8123;
    const proc = spawn(
        venvPy,
        ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(port)],
        { cwd: root, env: { ...process.env, DATABASE_URL: "sqlite+aiosqlite:///./_boot.db", PORT: String(port) } },
    );
    let logBuf = "";
    proc.stdout?.on("data", (d) => { logBuf += d.toString(); });
    proc.stderr?.on("data", (d) => { logBuf += d.toString(); });

    try {
        const up = await pollUp(`http://127.0.0.1:${port}/openapi.json`, 25_000);
        if (!up) {
            return [{
                kind:   "build_error",
                id:     "backend: boot",
                detail: `backend failed to boot — the server never started serving requests within 25s ` +
                        `(usually a startup/lifespan crash, not an import error):\n${tail(logBuf)}`,
            }];
        }
        return [];
    } finally {
        try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    }
}

// Backend: venv + pip install + `import backend.main` + REAL BOOT. Runs the import
// from the repo ROOT so package-relative imports (`from backend.x import ...`)
// resolve, using an async-compatible SQLite URL.
async function checkBackend(root: string): Promise<Failure[]> {
    const dir = path.join(root, "backend");
    if (!fs.existsSync(path.join(dir, "main.py"))) return [];

    const python = findPython();
    if (!python) return []; // no python — skip this half

    const venvPy = process.platform === "win32"
        ? path.join(dir, ".venv", "Scripts", "python.exe")
        : path.join(dir, ".venv", "bin", "python");

    if (!fs.existsSync(venvPy)) {
        const venv = runCmd(python, ["-m", "venv", ".venv"], { cwd: dir, timeoutMs: 120_000 });
        if (!venv.ok) {
            return [{ kind: "build_error", id: "backend: venv", detail: `backend venv creation failed:\n${tail(venv.out)}` }];
        }
    }
    if (fs.existsSync(path.join(dir, "requirements.txt"))) {
        const pip = runCmd(venvPy, ["-m", "pip", "install", "-q", "-r", "requirements.txt"], { cwd: dir, timeoutMs: 300_000 });
        if (!pip.ok) {
            return [{ kind: "build_error", id: "backend: pip install", detail: `backend "pip install -r requirements.txt" failed:\n${tail(pip.out)}` }];
        }
    }

    // Import check — from the repo root, async SQLite URL so create_async_engine works.
    const imp = runCmd(venvPy, ["-c", "import backend.main"], {
        cwd: root,
        timeoutMs: 60_000,
        env: { DATABASE_URL: "sqlite+aiosqlite:///./_check.db" },
    });
    if (!imp.ok) {
        return [{ kind: "build_error", id: "backend: import main", detail: `backend "import backend.main" failed:\n${tail(imp.out)}` }];
    }

    // Boot check — start the server for real and confirm it serves requests.
    return bootBackend(root, venvPy);
}

// Tier 3 entry: build both halves on disk, collect failures.
async function buildFailures(files: FileSpec[]): Promise<Failure[]> {
    const root = writeArtifactToTemp(files);
    const frontend = checkFrontend(root);
    const backend  = await checkBackend(root);
    return [...frontend, ...backend];
}

// The Testing Agent's single public action: judge a code artifact.
export async function runTests(files: FileSpec[], ir: AgentIR): Promise<TestReport> {
    // Collect failures from each detector tier into one list.
    const failures: Failure[] = [];

    // Tier 1: required files exist and aren't empty.
    for (const f of fileFailures(files)) failures.push(f);

    // Tier 1 (coverage): every OPM object/process id appears somewhere in the code.
    const coverage = computeCoverageReport(files, ir);
    for (const id of coverage.missing) {
        failures.push({ kind: "uncovered_id", id, detail: `OPM id ${id} is not referenced in any generated file` });
    }

    // Tier 2a: every formula parses as valid code (Gemini was getting some forumals wrong so this check is necessary).
    for (const f of formulaFailures(ir)) failures.push(f);

    // Tier 2b: the generated python compiles (if python is available).
    for (const f of pythonSyntaxFailures(files)) failures.push(f);

    // Tier 2c: frontend import resolvability + docker-compose closure (deterministic,
    // always-on, cheap). Catches white-screen boot defects the env-gated build tier would
    // otherwise miss: a bare import absent from package.json, a dangling relative import
    // (e.g. a missing index.css), or a compose file naming a Dockerfile we never emit.
    for (const f of frontendResolvabilityFailures(files)) failures.push(f);
    for (const f of composeClosureFailures(files)) failures.push(f);
    for (const f of tsconfigClosureFailures(files)) failures.push(f);
    // Contract integrity (front<->back): casing base intact, inline models on
    // CamelModel, every route reachable from api.ts.
    for (const f of schemaCasingIntegrityFailures(files)) failures.push(f);
    for (const f of inlineBaseModelFailures(files)) failures.push(f);
    for (const f of apiRouteCoverageFailures(files)) failures.push(f);
    for (const f of modelColumnFailures(files)) failures.push(f);

    // Tier 3: build & boot — expensive, env-gated. Run it once the tiers that
    // actually affect the build are clean. We DELIBERATELY ignore invalid_formula
    // and uncovered_id here: both live in the OPM IR (which the codegen loop treats
    // as immutable, so it can never fix them) and neither stops the app from building
    // or booting. Gating Tier 3 on them once hid a real boot failure (a cross-file
    // import/name mismatch) behind a single malformed IR formula.
    const blocksBuild = failures.filter(
        (f) => f.kind !== "invalid_formula" && f.kind !== "uncovered_id",
    );
    if (process.env.OPM_RUN_BUILD_CHECKS === "1" && blocksBuild.length === 0) {
        for (const f of await buildFailures(files)) failures.push(f);
    }

    // Tier 4: LLM acceptance tests — ADVISORY ONLY. An LLM judges the code fresh
    // each pass, so its verdict is non-deterministic: counting it as a blocking
    // failure makes the loop oscillate (2 -> 3 -> 2...) and never converge, because
    // every "fix" makes the judge flag something else. So we run it for the report
    // (shown on the dashboard) but DO NOT push it into the failures that drive the
    // regenerate loop. The loop converges on the deterministic tiers above; Tier 3
    // build & boot now actually runs once those are clean.
    const review = await runAcceptanceReview(files);

    // It passes only if a DETERMINISTIC detector found nothing.
    const passed = failures.length === 0;
    const signature = signatureOf(failures);

    return { passed, failures, signature, coverage, acceptanceTests: review.acceptanceTests, codeReview: review.codeReview };
}
