// Agent 2 — the Testing Agent.
//
// It independently evaluates a CodeArtifact and emits a structured TestReport.
// It NEVER generates or fixes code (that is Agent 1's job); keeping detection
// separate from generation is what stops the model "grading its own homework".
//
// Detection tiers (cheap+real -> expensive):
//   Tier 1  structural : required files present, non-empty, every OPM id covered.
//   Tier 2a formula    : each IR computation must parse as valid JS (new Function).
//                        This is the deterministic check that catches a dropped
//                        "*" operator (e.g. ")100" instead of ")*100").
//   Tier 2b python     : best-effort `py_compile` of generated .py files; skipped
//                        silently if python is not available in the environment.

import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { FileSpec, Failure, TestReport, AgentIR } from "./types";

const REQUIRED_FILES = ["README.md", "TRACEABILITY.md", "docker-compose.yml"];

function normPath(p: string): string {
    return p.replace(/^[\\/]+/, "");
}

// Tier 1: required files present, no empty files, every OPM id referenced somewhere.
function structuralFailures(files: FileSpec[], ir: AgentIR): Failure[] {
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

    const blob = files.map((f) => f.content).join("\n");
    const ids = [
        ...(ir.objects   ?? []).map((o) => o.id),
        ...(ir.processes ?? []).map((p) => p.id),
    ];
    for (const id of ids) {
        const pattern = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (!pattern.test(blob)) {
            failures.push({ kind: "uncovered_id", id, detail: `OPM id ${id} is not referenced in any generated file` });
        }
    }
    return failures;
}

// Tier 2a: every IR computation must be syntactically valid code.
// `new Function(body)` only PARSES the body, so undefined variables are fine —
// only a real SyntaxError (e.g. a missing operator) throws.
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

// Locate a usable python interpreter, or null if none is installed.
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

// The Testing Agent's single public action: judge a code artifact.
export function runTests(files: FileSpec[], ir: AgentIR): TestReport {
    const failures = [
        ...structuralFailures(files, ir),
        ...formulaFailures(ir),
        ...pythonSyntaxFailures(files),
    ];
    return { passed: failures.length === 0, failures, signature: signatureOf(failures) };
}
