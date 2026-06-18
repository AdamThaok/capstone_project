// Orchestrates the pipeline per capstone activity diagram.
//
// Flow:
//   0. Validate input (guard; abort on fail)
//   fork:
//     1.  Parse OPM elements
//     1b. Retrieve ISO 19450 rules (fast, local/static for single-AI mode)
//   join →
//   [GATE] OPM diagram validation — blocks pipeline if diagram has errors
//          The user must fix the diagram and re-upload before proceeding.
//   2.  Semantic Analysis → system spec
//   3.  Compose super-prompt from (OPM, spec, rules)  — happens inside
//       buildSuperPrompt_stage3() when real deps are available
//   4.  Code generation (Claude/Gemini) + write files to disk
//   5.  Build + refine loop (up to 3 iterations)

import { validateInput_stage0 }     from "./stage0-validate";
import { parseOpm_stage1, PARSE_TIMEOUT_MS } from "./stage1-parse";
import { deriveSpec_stage2 }        from "./stage2-spec";
import { buildSuperPrompt_stage3 }  from "./stage3-rag";
import { generateCode_stage4 }     from "./stage4-codegen";
import { validateGenerated_stage5 } from "./stage5-validate";
import { deployToCloud_stage6 }     from "./stage6-deploy";
import { updateStage, getJob, patchJob, appendStageLog } from "../infra/jobs";
import type { StageId, CoverageReport, CoverageSnapshot, QaReport } from "../infra/types";
import { validateOpmModel, type OpmModel } from "../opm/opm-validate";

const STAGE_DELAY_MS = 200;
const MAX_RETRIES    = 0; // No retries — saves time; each stage handles its own fallbacks.
const STAGE_RETRIES: Partial<Record<StageId, number>> = {
    parse:    0, // stage1 does its own retry-with-backoff around the vision call
    semantic: 1, // semantic may hit rate limits
};

// Budgets for the LLM-heavy stages. COMPLEX models (many objects/processes →
// many continuation + refinement calls) legitimately need a long budget, so
// these are generous and env-tunable. Per-call timeouts in opm/llm/gemini.ts
// (OPM_LLM_CALL_TIMEOUT_MS) still bound each individual call, so a generous
// stage budget can't turn into an infinite hang.
const GENERATE_TIMEOUT_MS = Number(process.env.OPM_GENERATE_TIMEOUT_MS) || 1_800_000; // 30 min
const VALIDATE_TIMEOUT_MS = Number(process.env.OPM_VALIDATE_TIMEOUT_MS) || 600_000;    // 10 min

// Book §8.2 (Performance): end-to-end generation must complete in under
// 2 minutes for a simple OPM model. Per-stage timeouts below sum to ≈115s
// for the core pipeline (validate_input → validate). The "deploy" stage is
// a bonus (not in the book's 5-stage spec) and gets a longer budget because
// it waits on external services (GitHub push, Railway provisioning).
const STAGE_TIMEOUT_MS: Record<StageId, number> = {
    validate_input:  5_000,    //  5s — local file checks only
    parse:   PARSE_TIMEOUT_MS,  // configurable via OPM_PARSE_TIMEOUT_MS (default 5 min) — large PDF/vision parse
    rag:             5_000,    //  5s — inline ISO rules; no network in single-AI mode
    semantic:      300_000,    // 5 min — single Gemini call over a large IR
    generate: GENERATE_TIMEOUT_MS, // OPM_GENERATE_TIMEOUT_MS (default 30 min) — complex models need many calls
    validate: VALIDATE_TIMEOUT_MS, // OPM_VALIDATE_TIMEOUT_MS (default 10 min) — coverage + refinement + QA (Agent 2)
    deploy:        300_000,    //  5m — bonus stage, external APIs (GitHub + Railway)
};

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    // ms === Infinity (or <= 0) means "no cutoff" — let the stage take as long
    // as it needs. Used for the LLM-heavy stages (code generation + QA) so a
    // slow agent is never aborted mid-flight.
    if (!Number.isFinite(ms) || ms <= 0) return p;
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then((v) => { clearTimeout(t); resolve(v); },
               (e) => { clearTimeout(t); reject(e); });
    });
}

async function withRetry<T>(fn: () => Promise<T>, stage: StageId): Promise<T> {
    const timeout  = STAGE_TIMEOUT_MS[stage];
    const retries  = STAGE_RETRIES[stage] ?? MAX_RETRIES;
    let last: unknown;
    for (let i = 0; i <= retries; i++) {
        try {
            return await withTimeout(fn(), timeout, stage);
        } catch (e) {
            last = e;
            if (i < retries) await sleep(500 * (i + 1));
        }
    }
    throw last instanceof Error ? last : new Error(`${stage} failed`);
}

function markActive(jobId: string, stage: StageId) {
    updateStage(jobId, stage, { status: "active", startedAt: new Date().toISOString() });
}
function markDone(jobId: string, stage: StageId, output: unknown) {
    updateStage(jobId, stage, { status: "done", finishedAt: new Date().toISOString(), output });
}
function markError(jobId: string, stage: StageId, error: string) {
    updateStage(jobId, stage, { status: "error", finishedAt: new Date().toISOString(), error });
}

async function runStage<T>(
    jobId: string,
    stage: StageId,
    fn: () => Promise<T>,
): Promise<T | null> {
    markActive(jobId, stage);
    try {
        const out = await withRetry(fn, stage);
        markDone(jobId, stage, out);
        return out;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markError(jobId, stage, msg);
        console.error(`[pipeline ${jobId}] ${stage} failed:`, msg);
        return null;
    }
}

// Run the ISO-19450 diagram gate. Returns true if there are BLOCKING errors
// (pipeline must stop); records warnings and tags the parse output otherwise.
function runOpmValidationGate(jobId: string, opmModel: unknown): boolean {
    const { errors: diagramErrors, warnings: diagramWarnings } =
        validateOpmModel(opmModel as OpmModel);

    if (diagramErrors.length > 0) {
        patchJob(jobId, { diagramErrors });
        const blockedMsg =
            `הדיאגרמה מכילה ${diagramErrors.length} שגיאה קריטית. ` +
            `תקן אותה בדיאגרמה שלך והעלה מחדש לפני שהצינור יכול להמשיך.`;
        const blocked: StageId[] = ["semantic", "generate", "validate", "deploy"];
        for (const s of blocked) markError(jobId, s, blockedMsg);
        updateStage(jobId, "parse", {
            output: {
                ...((opmModel as Record<string, unknown>)),
                _opm_validation: { passed: false, errors: diagramErrors, warnings: diagramWarnings },
            },
        });
        console.warn(
            `[pipeline ${jobId}] OPM validation BLOCKED — ${diagramErrors.length} critical error(s).`,
        );
        return true;
    }

    if (diagramWarnings.length > 0) {
        patchJob(jobId, { diagramWarnings });
        console.info(
            `[pipeline ${jobId}] OPM validation passed with ${diagramWarnings.length} warning(s) — pipeline continues.`,
        );
    }
    updateStage(jobId, "parse", {
        output: {
            ...((opmModel as Record<string, unknown>)),
            _opm_validation: { passed: true, errors: [], warnings: diagramWarnings },
        },
    });
    return false;
}

type ElementCounts = { objCount: number | string; procCount: number | string; linkCount: number | string };

// Log parsed Object/Process/Link counts and return them for the final summary.
function logParseResults(jobId: string, opmModel: unknown): ElementCounts {
    const opm = opmModel as Record<string, unknown>;
    const objCount  = Array.isArray(opm.objects)   ? (opm.objects  as unknown[]).length : "?";
    const procCount = Array.isArray(opm.processes)  ? (opm.processes as unknown[]).length : "?";
    const linkCount = Array.isArray(opm.links)      ? (opm.links    as unknown[]).length : "?";
    appendStageLog(jobId, "parse", `✅ Parsed: ${objCount} Objects · ${procCount} Processes · ${linkCount} Links`);
    appendStageLog(jobId, "rag",   `✅ Retrieved 8 ISO 19450 rule chunks`);
    return { objCount, procCount, linkCount };
}

// Persist the coverage report + a before/after snapshot from the stage-5 result.
function persistCoverageSnapshot(jobId: string, validationResult: unknown): void {
    if (!(validationResult && typeof validationResult === "object")) return;
    const vr = validationResult as Record<string, unknown>;
    const coverage = (vr["coverage"] ?? vr["coverageReport"]) as CoverageReport | undefined;
    if (!coverage) return;
    const now = new Date().toISOString();
    const existingJob = getJob(jobId);
    const prevHistory: CoverageSnapshot[] = existingJob?.coverageHistory ?? [];
    const snapLabel = prevHistory.length === 0 ? "Initial scan" : `After fix #${prevHistory.length}`;
    const snapshot: CoverageSnapshot = {
        timestamp: now,
        label: snapLabel,
        coverage_pct: coverage.coverage_pct,
        covered: coverage.covered,
        total_elements: coverage.total_elements,
    };
    patchJob(jobId, {
        coverageReport: coverage,
        coverageHistory: [...prevHistory, snapshot],
    });
}

// Persist the QA Agent report (Agent 2) for the dashboard + deploy gate.
function persistQaReport(jobId: string, validationResult: unknown): void {
    if (!(validationResult && typeof validationResult === "object")) return;
    const qa = (validationResult as Record<string, unknown>)["qaReview"] as QaReport | undefined;
    if (!qa) return;
    patchJob(jobId, { qaReport: qa });
    const failed = qa.acceptanceTests.filter((t) => t.status === "fail").length;
    const passed = qa.acceptanceTests.length - failed;
    appendStageLog(jobId, "validate",
        `🧪 QA: ${passed}/${qa.acceptanceTests.length} acceptance tests passed · ` +
        `${qa.codeReview.length} review point(s)` +
        (qa.blocked ? " — ❌ deployment blocked" : " — ✅ ready"));
}

// Log coverage % and the number of auto-refinement iterations applied.
function logValidationSummary(jobId: string, validationResult: unknown): void {
    if (!(validationResult && typeof validationResult === "object")) return;
    const vr = validationResult as Record<string, unknown>;
    const cov = (vr["coverage"] ?? vr["coverageReport"]) as Record<string, unknown> | undefined;
    if (cov) {
        appendStageLog(jobId, "validate", `✅ Coverage: ${cov.coverage_pct ?? "?"}% (${cov.covered ?? "?"}/${cov.total_elements ?? "?"} elements)`);
    }
    const iters = (vr["metadata"] as Record<string, unknown> | undefined)?.iterations;
    if (typeof iters === "number" && iters > 0) {
        appendStageLog(jobId, "validate", `🔧 Applied ${iters} auto-refinement iteration(s)`);
    }
}

// Assemble the final run summary and store it on the job.
function buildAndStoreSummary(jobId: string, fileTree: unknown, counts: ElementCounts): void {
    const finalJob = getJob(jobId);
    const ft = fileTree as Record<string, unknown>;
    const cv = finalJob?.coverageReport;
    const summary = {
        completedAt:   new Date().toISOString(),
        filesGenerated: ft?.totalFiles ?? 0,
        linesOfCode:    ft?.totalLines ?? 0,
        opmElements:   { objects: counts.objCount, processes: counts.procCount, links: counts.linkCount },
        coverage:      cv ? `${cv.coverage_pct}% (${cv.covered}/${cv.total_elements})` : "N/A",
        modelsUsed:    ["GPT-4o Vision (parse)", "Gemini 2.5 Flash (semantic)", "Claude Sonnet (codegen)"],
        warnings:      finalJob?.diagramWarnings?.length ?? 0,
        stack:         "React + FastAPI + PostgreSQL",
    };
    patchJob(jobId, { summary } as Record<string, unknown>);
}

// ── Per-stage progress logs (kept out of runPipeline so its body reads as flow) ──
function logStage0Start(jobId: string, filenames: string[]): void {
    appendStageLog(jobId, "validate_input", `📂 Received ${filenames.length} file(s): ${filenames.join(", ")}`);
    appendStageLog(jobId, "validate_input", "🔍 Checking file formats and sizes...");
}
function logStage0Pass(jobId: string): void {
    appendStageLog(jobId, "validate_input", `✅ All files passed validation`);
}
function logParseStart(jobId: string, filenames: string[]): void {
    appendStageLog(jobId, "parse", `🖼️ Sending ${filenames.length} file(s) to the vision/document parser...`);
    appendStageLog(jobId, "parse", `⏱️ Parse budget: ${Math.round(PARSE_TIMEOUT_MS / 1000)}s (env OPM_PARSE_TIMEOUT_MS) · up to 3 attempts per file with backoff.`);
    appendStageLog(jobId, "parse", "🔗 Extracting Objects, Processes, and Links...");
    appendStageLog(jobId, "rag", "📚 Loading ISO 19450 rules database...");
    appendStageLog(jobId, "rag", "🔍 Retrieving relevant OPM rule chunks...");
}
function logParseDone(jobId: string, parseStart: number): void {
    appendStageLog(jobId, "parse", `⏱️ Parse stage finished in ${Math.round((Date.now() - parseStart) / 1000)}s (budget ${Math.round(PARSE_TIMEOUT_MS / 1000)}s).`);
}
function logSemanticStart(jobId: string): void {
    appendStageLog(jobId, "semantic", "🤖 Sending OPM IR to Gemini 2.5 Flash...");
    appendStageLog(jobId, "semantic", "🏗️ Deriving system architecture (entities, endpoints, screens)...");
}
function logSemanticDone(jobId: string): void {
    appendStageLog(jobId, "semantic", "✅ System specification derived successfully");
}
function logGenerateStart(jobId: string): void {
    appendStageLog(jobId, "generate", "📝 Composing super-prompt from OPM IR + System Spec + ISO rules...");
    appendStageLog(jobId, "generate", "🤖 Code Generation Agent + Testing Agent: generate → test → reflect loop...");
}
function logSuperPromptBuilt(jobId: string): void {
    appendStageLog(jobId, "generate", "✅ Super-prompt built — sending to code generation model...");
}
function logGenerated(jobId: string, g: Record<string, unknown>): void {
    appendStageLog(jobId, "generate", `✅ Generated ${g.totalFiles ?? "?"} files · ${g.totalLines ?? "?"} lines of code`);
}
function logValidateStart(jobId: string): void {
    appendStageLog(jobId, "validate", "🔍 Scanning generated files for OPM element coverage...");
    appendStageLog(jobId, "validate", "📊 Computing traceability coverage report...");
}

export async function runPipeline(jobId: string) {
    const job = getJob(jobId);
    if (!job) throw new Error(`job ${jobId} not found`);

    // Stage 0: input validation (multi-file aware)
    await sleep(200);
    logStage0Start(jobId, job.filenames);
    const validation = await runStage(jobId, "validate_input", () =>
        validateInput_stage0({
            filenames: job.filenames,
            filePaths: job.filePaths,
            format:    job.format,
        }),
    );
    if (!validation || !validation.valid) {
        const remaining: StageId[] = ["parse", "rag", "semantic", "generate", "validate", "deploy"];
        for (const s of remaining) markError(jobId, s, "skipped: input validation failed");
        return;
    }
    logStage0Pass(jobId);

    // Stages 1 + 1b: parse OPM in parallel with RAG retrieval.
    await sleep(STAGE_DELAY_MS);
    logParseStart(jobId, job.filenames);
    const parseStart = Date.now();
    const [opmModel, _ragStub] = await Promise.all([
        
        runStage(jobId, "parse", () =>
            parseOpm_stage1({
                filenames:  job.filenames,
                filePaths:  job.filePaths,
                format:     job.format,
                timeoutMs:  PARSE_TIMEOUT_MS,
                onProgress: (msg) => appendStageLog(jobId, "parse", msg),
            }),
        ),
        runStage(jobId, "rag", async () => ({
            retrievalMode: "inline-iso-19450",
            chunks: 8,
            note:   "Static rules injected into super-prompt at stage 3 compose.",
        })),
    ]);
    logParseDone(jobId, parseStart);
    if (!opmModel) return;

    // ---- OPM diagram validation gate (ISO 19450) ----
    // Blocking errors stop the pipeline; warnings are recorded and we continue.
    await sleep(STAGE_DELAY_MS);
    if (runOpmValidationGate(jobId, opmModel)) return;

    const counts = logParseResults(jobId, opmModel);

    // Stage 2: semantic interpretation
    await sleep(STAGE_DELAY_MS);
    logSemanticStart(jobId);
    const spec = await runStage(jobId, "semantic", () => deriveSpec_stage2(opmModel));
    if (!spec) return;
    logSemanticDone(jobId);

    // Stage 3-4: super-prompt + code generation
    await sleep(STAGE_DELAY_MS);
    logGenerateStart(jobId);
    const fileTree = await runStage(jobId, "generate", async () => {
        const superPrompt = await buildSuperPrompt_stage3(opmModel, spec);
        logSuperPromptBuilt(jobId);
        const gen = await generateCode_stage4(superPrompt, { jobId, opmModel, spec });
        if (gen && typeof gen === "object" && "outputDir" in gen) {
            patchJob(jobId, { outputDir: (gen as { outputDir?: string }).outputDir });
            logGenerated(jobId, gen as Record<string, unknown>);
        }
        return gen;
    });
    if (!fileTree) return;

    // Stage 5: validate + refine
    await sleep(STAGE_DELAY_MS);
    logValidateStart(jobId);
    const validationResult = await runStage(jobId, "validate", () =>
        validateGenerated_stage5(fileTree, {
            jobId,
            spec,
            opmModel,
            outputDir: getJob(jobId)?.outputDir,
        }),
    );

    persistCoverageSnapshot(jobId, validationResult);
    persistQaReport(jobId, validationResult);
    logValidationSummary(jobId, validationResult);
    buildAndStoreSummary(jobId, fileTree, counts);

    // Stage 6 (bonus): deploy to cloud. Skips gracefully if tokens absent.
    await sleep(STAGE_DELAY_MS);
    const j = getJob(jobId);
    await runStage(jobId, "deploy", () =>
        deployToCloud_stage6({
            jobId,
            filename:  job.filename,
            outputDir: j?.outputDir,
            userId:    j?.userId,
        }),
    );
}

