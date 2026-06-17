import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createJob } from "@/opm/pipeline/infra/jobs";
import { runPipeline } from "@/opm/pipeline/stages/runner";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES        = 12;                // SD + up to 11 zoom-in views

// Book §4.2: Zero-Touch Generation. Both the input format and the target tech
// stack are inferred / fixed by the system, never selected by the user.
// Format is auto-detected from the file extension by stage 0 / stage 1.
// Target stack is fixed by the pipeline (book §7.C, §4.3 Stage 4).
const FIXED_FORMAT       = "auto";
const FIXED_TARGET_STACK = "react-fastapi-postgres";

// Run on the Node runtime (pipeline uses fs / long-lived work) and allow a long
// upstream budget so a slow model call isn't cut off by the platform. On Vercel
// this caps the serverless function (Pro: up to 300s); under `next dev` it's
// unbounded. NOTE: the pipeline runs in the background after this route returns,
// so this mainly matters for the request that kicks it off.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const form = await req.formData();
    // Multi-file upload (book §4.3 Stage 1: hierarchical SD/SD1/SD2 views).
    // The client sends each diagram under the "files" key; we also accept the
    // legacy single-file "file" key for back-compat.
    const filesRaw: File[] = [
        ...(form.getAll("files") as File[]),
        ...(form.has("file") ? [form.get("file") as File] : []),
    ].filter((f): f is File => !!f && typeof f.size === "number");

    if (filesRaw.length === 0) {
        return NextResponse.json({ error: "no files uploaded" }, { status: 400 });
    }
    if (filesRaw.length > MAX_FILES) {
        return NextResponse.json(
            { error: `too many files (max ${MAX_FILES})` },
            { status: 413 },
        );
    }
    for (const f of filesRaw) {
        if (f.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: `file "${f.name}" too large (max ${MAX_UPLOAD_BYTES} bytes)` },
                { status: 413 },
            );
        }
    }

    // Persist every upload under one job directory so the parser can open them.
    const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), "opm-job-"));
    const filenames: string[] = [];
    const filePaths: string[] = [];
    for (const f of filesRaw) {
        const safeName = f.name.replace(/[^\w.\-]+/g, "_");
        const filePath = path.join(jobDir, safeName);
        const bytes    = Buffer.from(await f.arrayBuffer());
        await fs.writeFile(filePath, bytes);
        filenames.push(f.name);
        filePaths.push(filePath);
    }

    const uidRaw = jar.get("uid")?.value;
    let userId: string | undefined;
    try { userId = uidRaw ? (JSON.parse(uidRaw) as { id: string }).id : undefined; } catch { /* ignore */ }

    const job = createJob({
        filenames,
        filePaths,
        format:      FIXED_FORMAT,
        targetStack: FIXED_TARGET_STACK,
        userId,
    });

    runPipeline(job.id).catch((err) => console.error("pipeline error:", err));

    return NextResponse.json({ jobId: job.id, filesAccepted: filenames.length });
}
