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

// Action 1: first-pass generation from the super prompt (today's Stage 4).
export async function generateInitialCode(
    superPrompt: string,
    onProgress?: Progress,
): Promise<CodeArtifact> {
    return callClaude(superPrompt, onProgress);
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
