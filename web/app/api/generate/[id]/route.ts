import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getJob } from "@/opm/pipeline/infra/jobs";

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const job = getJob(id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    // Auto-expire only truly stuck jobs. This is an UPSTREAM cut-off, so it must
    // exceed the sum of stage budgets (parse 5m + generate 10m + validate 5m …);
    // a too-small value wrongly flags a still-running stage as "timed out".
    // Configurable via OPM_JOB_TIMEOUT_MS (default 30 min).
    if (!job.done) {
        const ageMs = Date.now() - new Date(job.createdAt).getTime();
        const JOB_TIMEOUT_MS = Number(process.env.OPM_JOB_TIMEOUT_MS) || 60 * 60 * 1000; // 60 min — must exceed parse+generate+validate budgets
        if (ageMs > JOB_TIMEOUT_MS) {
            const { patchJob, updateStage } = await import("@/opm/pipeline/infra/jobs");
            const activeStage = job.stages.find((s) => s.status === "active" || s.status === "pending");
            if (activeStage) {
                updateStage(id, activeStage.stage, {
                    status: "error",
                    error: "Pipeline timed out — server may have been restarted. Please try again.",
                    finishedAt: new Date().toISOString(),
                });
            }
            patchJob(id, { done: true });
            return NextResponse.json({ ...job, done: true });
        }
    }

    return NextResponse.json(job);
}
