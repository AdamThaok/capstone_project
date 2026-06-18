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

import { execFileSync, spawnSync } from "node:child_process";
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

// Backend: venv + pip install + `import main`. Catches broken imports / missing
// models. Uses a SQLite DATABASE_URL so the import needs no real database.
function checkBackend(root: string): Failure[] {
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
    const imp = runCmd(venvPy, ["-c", "import main"], { cwd: dir, timeoutMs: 60_000, env: { DATABASE_URL: "sqlite:///./_check.db" } });
    if (!imp.ok) {
        return [{ kind: "build_error", id: "backend: import main", detail: `backend "import main" failed:\n${tail(imp.out)}` }];
    }
    return [];
}

// Tier 3 entry: build both halves on disk, collect failures.
function buildFailures(files: FileSpec[]): Failure[] {
    const root = writeArtifactToTemp(files);
    return [...checkFrontend(root), ...checkBackend(root)];
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

    // Tier 3: build & boot — expensive, env-gated, and only run when the cheap
    // tiers are already clean (no point building structurally-broken code).
    if (process.env.OPM_RUN_BUILD_CHECKS === "1" && failures.length === 0) {
        for (const f of buildFailures(files)) failures.push(f);
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
