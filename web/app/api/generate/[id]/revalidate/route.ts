import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getJob, patchJob, updateStage, appendStageLog } from "@/opm/pipeline/infra/jobs";
import { validateGenerated_stage5 } from "@/opm/pipeline/stages/stage5-validate";
import type { CoverageReport, QaReport } from "@/opm/pipeline/infra/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/generate/[id]/revalidate
// Re-runs ONLY Stage 5 (coverage + refinement + QA agent) against the job's
// already-generated code — no re-parse / re-generate. Lets the user re-run the
// acceptance tests + code review (and unblock deploy) without paying for a full
// regeneration. Runs in the background; the client keeps polling GET.
export async function POST(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    if (!job.outputDir)
        return NextResponse.json({ error: "no generated project to validate — generate first" }, { status: 400 });

    // Reuse the IR + spec already captured by the earlier run.
    const opmModel = job.stages.find((s) => s.stage === "parse")?.output;
    const spec     = job.stages.find((s) => s.stage === "semantic")?.output;

    updateStage(id, "validate", { status: "active", startedAt: new Date().toISOString() });
    appendStageLog(id, "validate", "🔁 Re-running validation + QA on the EXISTING generated code (no re-generation)…");

    // Background so the request returns immediately; dashboard polling reflects the result.
    (async () => {
        try {
            const result = await validateGenerated_stage5(null, {
                jobId:     id,
                spec,
                opmModel,
                outputDir: job.outputDir,
            });
            const vr = result as Record<string, unknown>;
            const coverage = (vr["coverage"] ?? vr["coverageReport"]) as CoverageReport | undefined;
            const qa       = vr["qaReview"] as QaReport | undefined;

            updateStage(id, "validate", { status: "done", output: result, finishedAt: new Date().toISOString() });

            const patch: { coverageReport?: CoverageReport; qaReport?: QaReport } = {};
            if (coverage) patch.coverageReport = coverage;
            if (qa)       patch.qaReport       = qa;
            if (Object.keys(patch).length) patchJob(id, patch);

            if (qa) {
                const failed = qa.acceptanceTests.filter((t) => t.status === "fail").length;
                appendStageLog(id, "validate",
                    `🧪 QA re-run: ${qa.acceptanceTests.length - failed}/${qa.acceptanceTests.length} acceptance tests passed — ` +
                    (qa.blocked ? "❌ still blocked" : "✅ ready to deploy"));
            }
        } catch (e) {
            updateStage(id, "validate", {
                status: "error",
                error:  `Re-validation failed: ${(e as Error).message}`,
                finishedAt: new Date().toISOString(),
            });
        }
    })();

    return NextResponse.json({ ok: true });
}
