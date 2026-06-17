import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listJobs } from "@/opm/pipeline/infra/jobs";

export async function GET() {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const uidRaw = jar.get("uid")?.value;
    let userId: string | undefined;
    try { userId = uidRaw ? (JSON.parse(uidRaw) as { id: string }).id : undefined; } catch { /* ignore */ }

    const jobs = listJobs(userId);

    // Return a lightweight summary — no per-stage output payloads.
    const projects = jobs.map((j) => ({
        id:          j.id,
        filenames:   j.filenames ?? [j.filename],
        createdAt:   j.createdAt,
        done:        j.done,
        hasErrors:   j.stages.some((s) => s.status === "error"),
        stagesTotal: j.stages.length,
        stagesDone:  j.stages.filter((s) => s.status === "done").length,
        diagramErrors: j.diagramErrors ?? [],
        coverageReport: j.coverageReport,
    }));

    return NextResponse.json({ projects });
}
