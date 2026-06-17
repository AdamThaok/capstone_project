// Disk-backed job store.
// Survives dev-server restarts (Next HMR) and serverless cold starts.
// Each job lives at <tmp>/opm-jobs/<id>.json. Pipeline writes every time
// updateStage/patchJob runs so the dashboard keeps polling the current state.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { JobState, StageResult } from "./types";

const STORE_DIR = path.join(os.tmpdir(), "opm-jobs");

function ensureDir() {
    try { fs.mkdirSync(STORE_DIR, { recursive: true }); } catch { /* exists */ }
}

function jobPath(id: string) { return path.join(STORE_DIR, `${id}.json`); }

function writeJob(job: JobState) {
    ensureDir();
    const target = jobPath(job.id);
    // Write to a temp file then atomically rename. The pipeline rewrites the
    // job file very frequently; a plain writeFileSync is not atomic, so a
    // concurrent reader (the dashboard polling getJob) could catch a partial
    // file, fail JSON.parse, and get a spurious 404 that kills polling.
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(job, null, 2), "utf-8");
        fs.renameSync(tmp, target);
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        throw e;
    }
}

export function createJob(input: {
    filenames:   string[];   // multi-file upload (SD, SD1, SD2... zoom levels)
    filePaths:   string[];
    format:      string;
    targetStack: string;
    userId?:     string;
}): JobState {
    if (input.filenames.length === 0 || input.filePaths.length === 0) {
        throw new Error("createJob: at least one file is required");
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const job: JobState = {
        id,
        filenames:   input.filenames,
        filePaths:   input.filePaths,
        // Back-compat: legacy callers may still read .filename / .filePath.
        filename:    input.filenames[0],
        filePath:    input.filePaths[0],
        format:      input.format,
        targetStack: input.targetStack,
        userId:      input.userId,
        createdAt:   now,
        stages: [
            { stage: "validate_input", status: "pending", startedAt: now },
            { stage: "parse",          status: "pending", startedAt: now },
            { stage: "rag",            status: "pending", startedAt: now },
            { stage: "semantic",       status: "pending", startedAt: now },
            { stage: "generate",       status: "pending", startedAt: now },
            { stage: "validate",       status: "pending", startedAt: now },
            { stage: "deploy",         status: "pending", startedAt: now },
        ],
        done: false,
    };
    writeJob(job);
    return job;
}

export function getJob(id: string): JobState | undefined {
    try {
        const raw = fs.readFileSync(jobPath(id), "utf-8");
        return JSON.parse(raw) as JobState;
    } catch {
        return undefined;
    }
}

export function patchJob(id: string, patch: Partial<JobState>) {
    const j = getJob(id);
    if (!j) return;
    Object.assign(j, patch);
    writeJob(j);
}

export function listJobs(userId?: string): JobState[] {
    ensureDir();
    try {
        return fs
            .readdirSync(STORE_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(STORE_DIR, f), "utf-8")) as JobState;
                } catch {
                    return null;
                }
            })
            .filter((j): j is JobState => j !== null)
            .filter((j) => !userId || j.userId === userId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
        return [];
    }
}

/** Append a real-time log message to a stage (shown live in the dashboard). */
export function appendStageLog(id: string, stage: StageResult["stage"], message: string) {
    const job = getJob(id);
    if (!job) return;
    const idx = job.stages.findIndex((s) => s.stage === stage);
    if (idx < 0) return;
    const existing = job.stages[idx].log ?? [];
    job.stages[idx] = { ...job.stages[idx], log: [...existing, `[${new Date().toLocaleTimeString()}] ${message}`] };
    writeJob(job);
}

export function updateStage(
    id: string,
    stage: StageResult["stage"],
    patch: Partial<StageResult>,
) {
    const job = getJob(id);
    if (!job) return;
    const idx = job.stages.findIndex((s) => s.stage === stage);
    if (idx < 0) return;
    job.stages[idx] = { ...job.stages[idx], ...patch };

    const allDone  = job.stages.every((s) => s.status === "done");
    const anyError = job.stages.some((s)  => s.status === "error");
    if (allDone || anyError) job.done = true;

    writeJob(job);
}
