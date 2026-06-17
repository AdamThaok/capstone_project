import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import { getJob, patchJob, updateStage } from "@/opm/pipeline/infra/jobs";
import { deployToCloud_stage6 }                 from "@/opm/pipeline/stages/stage6-deploy";
import { getToken }                      from "@/web/auth/oauth-tokens";
import { userIdFromCookie }              from "@/web/auth/session";

// GET /api/deploy/[jobId]  — returns the current deploy stage output for the job
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { jobId } = await params;
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    // "Tokens present" now means *this user* has connected both providers.
    const userId = userIdFromCookie(jar.get("uid")?.value);
    let tokensPresent = false;
    if (userId) {
        try {
            const [gh, rw] = await Promise.all([getToken(userId, "github"), getToken(userId, "railway")]);
            tokensPresent = !!gh && !!rw;
        } catch { /* supabase unavailable → treat as not connected */ }
    }

    const deployStage = job.stages.find((s) => s.stage === "deploy");
    return NextResponse.json({
        status:        deployStage?.status ?? "pending",
        output:        deployStage?.output ?? null,
        error:         deployStage?.error  ?? null,
        tokensPresent,
    });
}

// POST /api/deploy/[jobId]  — (re-)trigger cloud deployment for a completed job
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ jobId: string }> },
) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const userId = userIdFromCookie(jar.get("uid")?.value);

    const { jobId } = await params;
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    // Must have a generated output dir to deploy.
    if (!job.outputDir) {
        return NextResponse.json(
            { error: "No generated project found. Run the full pipeline first." },
            { status: 400 },
        );
    }

    // QA gate (Agent 2): a blocking QA review forbids deployment.
    if (job.qaReport?.blocked) {
        return NextResponse.json(
            {
                error: "QA review blocked deployment — resolve the failing acceptance tests / security findings and regenerate.",
                blockingReasons: job.qaReport.blockingReasons,
            },
            { status: 400 },
        );
    }

    // Mark stage as active immediately so UI shows spinner.
    updateStage(jobId, "deploy", { status: "active", startedAt: new Date().toISOString() });

    // Run in background — client polls GET to see progress.
    (async () => {
        try {
            const result = await deployToCloud_stage6({
                jobId,
                filename:  job.filename,
                outputDir: job.outputDir,
                userId,
            });
            updateStage(jobId, "deploy", {
                status:     "done",
                finishedAt: new Date().toISOString(),
                output:     result,
            });
            // Persist live URLs on the job for easy retrieval.
            if (result.railway?.frontendUrl || result.railway?.backendUrl) {
                patchJob(jobId, {
                    deployedFrontendUrl: result.railway.frontendUrl,
                    deployedBackendUrl:  result.railway.backendUrl,
                    deployedGithubUrl:   result.github?.html_url,
                });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            updateStage(jobId, "deploy", {
                status:     "error",
                finishedAt: new Date().toISOString(),
                error:      msg,
            });
        }
    })();

    return NextResponse.json({ started: true });
}
