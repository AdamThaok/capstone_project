import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import { getJob }       from "@/opm/pipeline/infra/jobs";
import fsp              from "node:fs/promises";
import path             from "node:path";
import archiver         from "archiver";
import { PassThrough }  from "node:stream";

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ id: string }> },
) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return new NextResponse("Unauthorized", { status: 401 });

    const { id } = await ctx.params;
    const job = getJob(id);

    if (!job)
        return new NextResponse("Project not found", { status: 404 });

    if (!job.done)
        return new NextResponse("Project is still generating — please wait.", { status: 409 });

    // 1. Try real generated output directory
    if (job.outputDir) {
        try {
            const stat = await fsp.stat(job.outputDir);
            if (stat.isDirectory()) {
                const pass = new PassThrough();
                const zip  = archiver("zip", { zlib: { level: 6 } });
                zip.on("error", (e) => pass.destroy(e));
                zip.pipe(pass);
                zip.directory(job.outputDir, false);
                zip.finalize();

                return new NextResponse(pass as unknown as BodyInit, {
                    headers: {
                        "Content-Type":        "application/zip",
                        "Content-Disposition": `attachment; filename="opm-project-${id.slice(0, 8)}.zip"`,
                    },
                });
            }
        } catch {
            // outputDir missing (server restarted) — fall through
        }
    }

    // 2. Try bundled mock ZIP
    const mockZip = path.join(process.cwd(), "public", "mock-outputs", "generated-project.zip");
    try {
        const buf = await fsp.readFile(mockZip);
        return new NextResponse(buf as unknown as BodyInit, {
            headers: {
                "Content-Type":        "application/zip",
                "Content-Disposition": `attachment; filename="opm-project-${id.slice(0, 8)}.zip"`,
            },
        });
    } catch { /* no mock zip */ }

    // 3. Friendly error — output dir was cleared (server restart)
    return new NextResponse(
        JSON.stringify({
            error: "Generated files no longer available — the server was restarted after generation. Please run the pipeline again.",
            jobId: id,
        }),
        {
            status: 410,
            headers: { "Content-Type": "application/json" },
        },
    );
}
