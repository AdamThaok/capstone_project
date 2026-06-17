"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/web/auth/useCurrentUser";
import ChatBot from "@/app/components/ChatBot";
import CoverageCard from "@/app/components/CoverageCard";
import DeployPanel from "@/app/components/DeployPanel";
import ConnectionsPanel from "@/app/components/ConnectionsPanel";
import QaReviewCard from "@/app/components/QaReviewCard";
import type { CoverageReport, CoverageSnapshot, QaReport } from "@/opm/pipeline/infra/types";

type StageStatus = "pending" | "active" | "done" | "error";
type StageId =
    | "validate_input"
    | "parse"
    | "rag"
    | "semantic"
    | "generate"
    | "validate"
    | "deploy";

type StageResult = {
    stage: StageId;
    status: StageStatus;
    startedAt: string;
    finishedAt?: string;
    output?: unknown;
    error?: string;
    log?: string[];
};

type JobState = {
    id: string;
    filenames: string[];        // multi-file (book §4.3 SD/SD1/SD2 zoom levels)
    filename: string;           // back-compat: first file
    format: string;
    targetStack: string;
    createdAt: string;
    stages: StageResult[];
    done: boolean;
    // diagramErrors   — blocking violations (pipeline stopped, user must re-upload).
    // diagramWarnings — advisory style/naming issues (pipeline continues).
    diagramErrors?:   string[];
    diagramWarnings?: string[];
    // Coverage data — populated after Stage 5 validation completes.
    coverageReport?: CoverageReport;
    coverageHistory?: CoverageSnapshot[];
    // QA Agent report (Stage 5) — drives the QA card + deploy gate.
    qaReport?: QaReport;
    // Final summary report — populated after pipeline finishes.
    summary?: {
        completedAt: string;
        filesGenerated: number;
        linesOfCode: number;
        opmElements: { objects: number | string; processes: number | string; links: number | string };
        coverage: string;
        modelsUsed: string[];
        warnings: number;
        stack: string;
    };
};

const MAX_FILES = 12;

// Labels mirror the 5-stage pipeline from the capstone book §4.3.
// The implementation forks parse + rag for performance (book Stage 3 RAG
// retrieval is started in parallel with Stage 1 parsing) and folds the
// Stage 3 super-prompt composition into the Stage 4 codegen call.
// "deploy" is a bonus stage not in the book.
const STAGE_LABELS: Record<StageId, string> = {
    validate_input: "0. Input Validation",
    parse:          "1. OPM Parsing (Hybrid Visual-Semantic)",
    rag:            "3a. RAG: ISO 19450 Rules Retrieval",
    semantic:       "2. Semantic Interpretation & System Spec",
    generate:       "3-4. Super Prompt + Multi-Model Code Generation",
    validate:       "5. Automated Validation & Refinement",
    deploy:         "Bonus: Cloud Deployment",
};

type Mapping = { opmId: string; artifact: string };

function useElapsedSeconds(startedAt: string | undefined, active: boolean) {
    const [secs, setSecs] = useState(0);
    useEffect(() => {
        if (!active || !startedAt) { setSecs(0); return; }
        const tick = () => setSecs(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [active, startedAt]);
    return secs;
}

export default function DashboardClient({ initialJobId }: { initialJobId?: string }) {
    const router = useRouter();
    const currentUser = useCurrentUser();
    const fileInput = useRef<HTMLInputElement>(null);
    // Multi-file upload: book §4.3 Stage 1 supports SD/SD1/SD2... zoom levels.
    // Users can drop or pick multiple OPD images / OPCloud exports at once;
    // each is parsed independently and merged into one canonical IR.
    const [files, setFiles] = useState<File[]>([]);
    // Book §4.2: Zero-Touch Generation — no user inputs beyond the OPM file(s).
    // Format is auto-detected from file extension; target stack is fixed by the
    // pipeline (React + FastAPI + PostgreSQL). Both are set server-side.
    const [dragging, setDragging] = useState(false);
    const [job, setJob] = useState<JobState | null>(null);
    const [expanded, setExpanded] = useState<StageId | null>(null);

    // Load an existing job when opened from the projects page (?job=id).
    useEffect(() => {
        if (!initialJobId) return;
        let cancelled = false;
        const poll = async () => {
            const r = await fetch(`/api/generate/${initialJobId}`);
            if (!r.ok || cancelled) return;
            const state: JobState = await r.json();
            setJob(state);
            if (!state.done) setTimeout(poll, 2000);
        };
        poll();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialJobId]);

    async function logout() {
        await fetch("/api/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    function addFiles(incoming: FileList | File[]) {
        const arr = Array.from(incoming);
        if (arr.length === 0) return;
        // Append while de-duping by (name + size) and capping at MAX_FILES.
        setFiles((prev) => {
            const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
            const next = [...prev];
            for (const f of arr) {
                const key = `${f.name}|${f.size}`;
                if (seen.has(key)) continue;
                if (next.length >= MAX_FILES) break;
                next.push(f);
                seen.add(key);
            }
            return next;
        });
    }

    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
    }

    function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files?.length) addFiles(e.target.files);
        // Allow re-picking the same file later by clearing the native input value.
        if (fileInput.current) fileInput.current.value = "";
    }

    function removeFile(idx: number) {
        setFiles((prev) => prev.filter((_, i) => i !== idx));
    }

    async function startPipeline() {
        if (files.length === 0) return;
        const body = new FormData();
        // Zero-Touch: only the files are sent; server fixes format and stack.
        for (const f of files) body.append("files", f);
        const res = await fetch("/api/generate", { method: "POST", body });
        if (!res.ok) {
            const msg = await res.text().catch(() => "");
            alert(`❌ Could not start generation (${res.status}). ${msg}`);
            return;
        }
        const { jobId } = await res.json();

        // Poll until done. The job file is rewritten constantly during the run,
        // so tolerate a few transient read failures instead of giving up at once.
        let fails = 0;
        const poll = async () => {
            try {
                const r = await fetch(`/api/generate/${jobId}`);
                if (!r.ok) { if (++fails <= 5) setTimeout(poll, 2000); return; }
                fails = 0;
                const state: JobState = await r.json();
                setJob(state);
                if (!state.done) setTimeout(poll, 2000);
            } catch {
                if (++fails <= 5) setTimeout(poll, 2000);
            }
        };
        poll();
    }

    function reset() {
        setFiles([]);
        setJob(null);
        setExpanded(null);
        if (fileInput.current) fileInput.current.value = "";
    }

    // Re-run ONLY Stage 5 (validation + QA) against the already-generated code —
    // no parse/semantic/generate. Lets the user re-run the acceptance tests and
    // unblock deploy without paying for a full regeneration.
    async function rerunQa() {
        if (!job) return;
        const id = job.id;
        await fetch(`/api/generate/${id}/revalidate`, { method: "POST" }).catch(() => {});
        let ticks = 0;
        const poll = async () => {
            ticks++;
            try {
                const r = await fetch(`/api/generate/${id}`);
                if (r.ok) {
                    const s: JobState = await r.json();
                    setJob(s);
                    const v = s.stages.find((x) => x.stage === "validate");
                    const finished = v?.log?.some((l) => l.includes("QA re-run:")) || v?.status === "error";
                    if (finished) return;
                }
            } catch { /* transient — keep polling */ }
            if (ticks < 60) setTimeout(poll, 3000);
        };
        setTimeout(poll, 1500);
    }

    async function downloadProject() {
        if (!job?.done) return;
        const res = await fetch(`/api/generate/${job.id}/download`);
        if (res.ok) {
            // Trigger browser download
            const blob = await res.blob();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement("a");
            a.href     = url;
            a.download = `opm-project-${job.id.slice(0, 8)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } else if (res.status === 410) {
            const data = await res.json().catch(() => ({}));
            alert("⚠️ " + (data.error ?? "Files expired — please run the pipeline again."));
        } else {
            alert(`Download failed (${res.status}) — please try running the pipeline again.`);
        }
    }

    const running = !!job && !job.done;
    const generateStage = job?.stages.find((s) => s.stage === "generate");
    const generateActive = generateStage?.status === "active";
    const generateElapsed = useElapsedSeconds(generateStage?.startedAt, generateActive);
    const GENERATE_EST = 90; // estimated seconds with Gemini Flash

    return (
        <div className="shell">
            <header className="topbar">
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <button className="ghost" style={{ fontSize: ".8rem", padding: ".35rem .75rem" }}
                        onClick={() => router.push("/projects")}>
                        ← Projects
                    </button>
                    <div className="brand">OPM<span>→</span>Code</div>
                </div>
                <div className="user">
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <span style={{ color: "#ededed", fontWeight: 500 }}>{currentUser.name}</span>
                        {currentUser.email && (
                            <span style={{ fontSize: ".72rem", color: "#555" }}>{currentUser.email}</span>
                        )}
                    </div>
                    <button className="ghost" onClick={logout}>Log out</button>
                </div>
            </header>

            <main className="main">
                <h2>Generate full-stack app from OPM diagram</h2>
                <p className="lead">
                    Upload one or more Object-Process Methodology diagrams (e.g. SD, SD1, SD2 zoom levels).
                    The AI agent parses each, merges them into a single canonical model, and generates
                    a complete runnable application.
                </p>

                <ConnectionsPanel />

                <div className="grid">
                    <div className="panel">
                        <h3>1. Upload OPM Model</h3>
                        <p className="hint">ISO 19450 compliant. Multiple files allowed (up to {MAX_FILES}).</p>

                        <label
                            className={`drop ${dragging ? "hover" : ""}`}
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={onDrop}
                        >
                            <input
                                ref={fileInput}
                                type="file"
                                accept=".xml,.json,.opx,.png,.jpg,.jpeg,.pdf"
                                multiple
                                onChange={onPick}
                            />
                            <div className="icon">⬆</div>
                            <div className="label">
                                {files.length > 0 ? "Add more files" : "Drop OPM file(s) here or click to browse"}
                            </div>
                            <div className="formats">XML · JSON · OPX · PNG · JPG · PDF (OPCloud export) · multi-file (SD, SD1, SD2…)</div>
                        </label>

                        {files.length > 0 && (
                            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                                {files.map((f, i) => (
                                    <div key={`${f.name}-${i}`} className="filebadge">
                                        <span className="name">{f.name}</span>
                                        <span className="size">{(f.size / 1024).toFixed(1)} KB</span>
                                        {!running && (
                                            <button
                                                onClick={() => removeFile(i)}
                                                style={{
                                                    marginLeft: "auto",
                                                    background: "transparent",
                                                    border: "none",
                                                    color: "#ff8a8a",
                                                    cursor: "pointer",
                                                    fontSize: "1rem",
                                                    lineHeight: 1,
                                                }}
                                                title="Remove from upload"
                                                aria-label={`Remove ${f.name}`}
                                            >×</button>
                                        )}
                                    </div>
                                ))}
                                <div className="hint">
                                    {files.length} file{files.length === 1 ? "" : "s"} selected
                                    {files.length >= MAX_FILES ? " (limit reached)" : ""}
                                </div>
                            </div>
                        )}

                        <div style={{ height: "1rem" }} />

                        <div className="hint" style={{ marginBottom: "0.75rem" }}>
                            Auto-detect from file extension · Generated stack: React + FastAPI + PostgreSQL
                        </div>

                        <div className="actions">
                            <button className="primary" disabled={files.length === 0 || running} onClick={startPipeline}>
                                {running ? "Generating..." : "Generate Application"}
                            </button>
                            {(files.length > 0 || job) && !running && (
                                <button className="ghost" onClick={reset}>Reset</button>
                            )}
                        </div>
                    </div>

                    <div className="panel">
                        <h3>2. Generation Pipeline</h3>
                        <p className="hint">AI Agent stages per project specification.</p>
                        <div className="stages">
                            {(job?.stages ?? placeholderStages()).map((s) => {
                                const isExpandable = s.status === "done" && !!s.output;
                                const extra = stageExtra(s);
                                const hasLog = (s.log?.length ?? 0) > 0;
                                const isActive = s.status === "active";
                                return (
                                    <div key={s.stage} style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                        <div
                                            className={`stage ${s.status}`}
                                            style={{ cursor: (isExpandable || hasLog) ? "pointer" : "default" }}
                                            onClick={() => (isExpandable || hasLog) && setExpanded(expanded === s.stage ? null : s.stage)}
                                            title={s.error ?? ""}
                                        >
                                            <div className="dot" />
                                            <div className="label">{STAGE_LABELS[s.stage]}</div>
                                            <div className="status">{extra ?? s.status}</div>
                                        </div>

                                        {/* Live log — show when active OR expanded */}
                                        {(isActive || expanded === s.stage) && hasLog && (
                                            <div style={{
                                                marginLeft: "1.5rem",
                                                marginTop: ".25rem",
                                                marginBottom: ".25rem",
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: ".2rem",
                                            }}>
                                                {s.log!.map((line, i) => (
                                                    <div key={i} style={{
                                                        fontSize: ".75rem",
                                                        color: line.includes("✅") ? "var(--green)" : line.includes("❌") ? "var(--red)" : "var(--text-2)",
                                                        fontFamily: "var(--font-mono)",
                                                        padding: ".1rem 0",
                                                    }}>
                                                        {line}
                                                    </div>
                                                ))}
                                                {isActive && (
                                                    <div style={{ fontSize: ".72rem", color: "var(--primary)", fontStyle: "italic" }}>
                                                        ● running...
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* ── Code Generation Progress Banner ── */}
                        {generateActive && (
                            <div style={{
                                marginTop: "1rem",
                                background: "rgba(99,102,241,0.08)",
                                border: "1px solid rgba(99,102,241,0.3)",
                                borderRadius: "10px",
                                padding: "1rem 1.25rem",
                                display: "flex",
                                flexDirection: "column",
                                gap: ".6rem",
                            }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <div style={{ fontWeight: 600, color: "var(--accent)", fontSize: ".9rem" }}>
                                        🤖 Claude is generating your full-stack project...
                                    </div>
                                    <div style={{ fontFamily: "var(--font-mono)", fontSize: ".85rem", color: "var(--text-2)" }}>
                                        {Math.floor(generateElapsed / 60)}:{String(generateElapsed % 60).padStart(2, "0")} / ~3:00
                                    </div>
                                </div>
                                <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: "99px", height: "6px", overflow: "hidden" }}>
                                    <div style={{
                                        height: "100%",
                                        width: `${Math.min(100, (generateElapsed / GENERATE_EST) * 100)}%`,
                                        background: "var(--primary-grad)",
                                        borderRadius: "99px",
                                        transition: "width 1s linear",
                                        boxShadow: "0 0 8px rgba(99,102,241,0.6)",
                                    }} />
                                </div>
                                <div style={{ fontSize: ".78rem", color: "var(--text-2)" }}>
                                    ⚠️ <strong>Please do not stop the server.</strong> Code generation takes 1–2 minutes with Gemini Flash. The pipeline is active.
                                </div>
                            </div>
                        )}

                        {/* Diagram warnings — non-blocking, shown as advisory banner */}
                        {job?.diagramWarnings && job.diagramWarnings.length > 0 && (
                            <details style={{ marginTop: "1rem" }}>
                                <summary style={{
                                    cursor: "pointer", color: "#facc15", fontSize: ".85rem",
                                    padding: ".5rem .75rem",
                                    background: "#1a1500", border: "1px solid #3a2e00",
                                    borderRadius: "8px", listStyle: "none",
                                }}>
                                    ⚠️ {job.diagramWarnings.length} ISO 19450 style warning{job.diagramWarnings.length > 1 ? "s" : ""} — הצינור ממשיך רגיל
                                </summary>
                                <div style={{
                                    marginTop: ".4rem", background: "#110e00",
                                    border: "1px solid #3a2e00", borderRadius: "8px",
                                    padding: ".75rem", display: "flex", flexDirection: "column", gap: ".4rem",
                                }}>
                                    {job.diagramWarnings.map((w, i) => (
                                        <div key={i} style={{ fontSize: ".78rem", color: "#d4b800" }}>{w}</div>
                                    ))}
                                </div>
                            </details>
                        )}

                        {job?.done && job.stages.some((s) => s.status === "error") && (
                            <div className="error" style={{ marginTop: "1rem" }}>
                                Pipeline halted: {
                                    job.stages.find((s) => s.status === "error")?.error
                                    ?? "input validation failed"
                                }
                            </div>
                        )}

                        {/* Coverage card — visible once Stage 5 (validate) starts */}
                        {job && job.stages.some((s) => s.stage === "validate" && (s.status === "done" || s.status === "error")) && (
                            <>
                                <div style={{ height: "1.5rem" }} />
                                <CoverageCard
                                    coverageReport={job.coverageReport}
                                    coverageHistory={job.coverageHistory}
                                />
                            </>
                        )}

                        {/* QA Review (Agent 2) — 10 acceptance tests + 5 review points */}
                        {job?.qaReport && (
                            <>
                                <QaReviewCard report={job.qaReport} />
                                <button
                                    className="ghost"
                                    onClick={rerunQa}
                                    style={{ marginTop: ".75rem", fontSize: ".85rem" }}
                                    title="Re-run validation + QA on the existing generated code (no re-generation)"
                                >
                                    🔁 Re-run QA tests (no re-generation)
                                </button>
                            </>
                        )}

                        {/* Deploy panel — visible once pipeline finishes (or any time we have a job) */}
                        {job && (
                            <>
                                <div style={{ height: "1.5rem" }} />
                                <h3>Cloud Deployment</h3>
                                <DeployPanel
                                    jobId={job.id}
                                    pipelineDone={
                                        job.done &&
                                        job.stages
                                            .filter((s) => s.stage !== "deploy")
                                            .every((s) => s.status === "done") &&
                                        !job.qaReport?.blocked
                                    }
                                />
                            </>
                        )}

                        {/* ── Final Summary Report ── */}
                        {job?.done && job.summary && job.stages.every((s) => s.status === "done") && (
                            <>
                                <div style={{ height: "1.5rem" }} />
                                <div style={{
                                    background: "rgba(52,211,153,0.05)",
                                    border: "1px solid rgba(52,211,153,0.25)",
                                    borderRadius: "12px",
                                    padding: "1.25rem",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: ".75rem",
                                }}>
                                    <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--green)", display: "flex", alignItems: "center", gap: ".5rem" }}>
                                        ✅ Generation Complete — Summary Report
                                    </div>
                                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".6rem" }}>
                                        {[
                                            ["📁 Files Generated", `${job.summary.filesGenerated} files`],
                                            ["📝 Lines of Code",   `${job.summary.linesOfCode.toLocaleString()} lines`],
                                            ["📊 Coverage",        job.summary.coverage],
                                            ["⚠️ Warnings",        `${job.summary.warnings} ISO 19450 style issue${job.summary.warnings !== 1 ? "s" : ""}`],
                                            ["🔷 OPM Objects",     String(job.summary.opmElements.objects)],
                                            ["⚙️ OPM Processes",   String(job.summary.opmElements.processes)],
                                            ["🔗 OPM Links",       String(job.summary.opmElements.links)],
                                            ["🏗️ Stack",           job.summary.stack],
                                        ].map(([label, value]) => (
                                            <div key={label} style={{ display: "flex", flexDirection: "column", gap: ".15rem" }}>
                                                <span style={{ fontSize: ".72rem", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</span>
                                                <span style={{ fontSize: ".88rem", color: "var(--text)", fontWeight: 600 }}>{value}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}>
                                        <span style={{ fontSize: ".72rem", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em" }}>🤖 AI Models Used</span>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
                                            {job.summary.modelsUsed.map((m) => (
                                                <span key={m} style={{
                                                    fontSize: ".75rem", padding: ".2rem .6rem",
                                                    background: "rgba(99,102,241,0.12)",
                                                    border: "1px solid rgba(99,102,241,0.25)",
                                                    borderRadius: "99px", color: "var(--accent)",
                                                }}>{m}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: ".75rem", color: "var(--text-3)" }}>
                                        Completed at {new Date(job.summary.completedAt).toLocaleString()}
                                    </div>
                                </div>
                            </>
                        )}

                        {job?.done && job.stages.every((s) => s.status === "done") && (
                            <>
                                <div style={{ height: "1.5rem" }} />
                                <h3>Traceability Report</h3>
                                <p className="hint">OPM elements → generated code artifacts.</p>
                                <div>
                                    {extractTrace(job).map((t, i) => (
                                        <div key={i} className="trace-row">
                                            <span className="from">{t.opmId}</span>
                                            <span className="arrow">→</span>
                                            <span className="to">{t.artifact}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Visual graph (book §7.D — Mermaid.js for traceability). */}
                                <TraceabilityGraph mappings={extractTrace(job)} />

                                <div style={{ height: "1rem" }} />
                                <button className="primary" onClick={downloadProject}>
                                    Download Project (ZIP)
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </main>

            {/* OPM Chatbot — always visible; enters error-guide mode when diagram has blocking errors */}
            <ChatBot
                diagramErrors={job?.diagramErrors ?? []}
                diagramWarnings={job?.diagramWarnings ?? []}
                jobId={job?.id}
                coverageReport={job?.coverageReport}
            />
        </div>
    );
}

function extractTrace(job: JobState): Mapping[] {
    const v = job.stages.find((s) => s.stage === "validate");
    if (!v || v.status !== "done" || !v.output) return [];
    const out = v.output as Record<string, unknown>;
    const cov = out.coverageVerification as Record<string, unknown> | undefined;
    const map = cov?.mapping as Mapping[] | undefined;
    return Array.isArray(map) ? map : [];
}

function stageExtra(s: StageResult): string | null {
    if (s.status !== "done" || !s.output) return null;
    const o = s.output as Record<string, unknown>;
    if (s.stage === "validate") {
        const iters = (o.metadata as Record<string, unknown> | undefined)?.iterations;
        if (typeof iters === "number") return `done · ${iters} refinement iter${iters === 1 ? "" : "s"}`;
    }
    if (s.stage === "rag") {
        const chunks = o.retrievedChunks;
        if (typeof chunks === "number") return `done · ${chunks} RAG chunks`;
    }
    if (s.stage === "generate") {
        const total = o.totalFiles;
        if (typeof total === "number") return `done · ${total} files`;
    }
    if (s.stage === "deploy") {
        if ((o as { skipped?: boolean }).skipped) return "skipped";
        const railway = (o as { railway?: { frontendUrl?: string } }).railway;
        if (railway?.frontendUrl) return "live";
    }
    return null;
}

function placeholderStages(): StageResult[] {
    const now = new Date().toISOString();
    return (Object.keys(STAGE_LABELS) as StageId[]).map((id) => ({
        stage: id,
        status: "pending" as StageStatus,
        startedAt: now,
    }));
}

function formatOutput(out: unknown): string {
    if (typeof out === "string") return out;
    try {
        return JSON.stringify(out, null, 2);
    } catch {
        return String(out);
    }
}

// Mermaid is loaded lazily on the client only — it's not SSR-safe and would
// otherwise pull a large bundle into the initial page payload.
function TraceabilityGraph({ mappings }: { mappings: Mapping[] }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current || mappings.length === 0) return;

        let cancelled = false;
        (async () => {
            const mermaid = (await import("mermaid")).default;
            mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose" });

            const nodes = mappings.map((m, i) => {
                // Sanitise artifact paths for mermaid node ids.
                const artifactId = `art${i}`;
                const opmId = m.opmId;
                const artifactLabel = m.artifact.replace(/"/g, "'");
                return [
                    `${opmId}["${opmId}"]`,
                    `${artifactId}["${artifactLabel}"]`,
                    `${opmId} --> ${artifactId}`,
                ].join("\n");
            });

            const graph = `flowchart LR\n${nodes.join("\n")}`;
            try {
                const { svg } = await mermaid.render("trace-graph", graph);
                if (!cancelled && ref.current) ref.current.innerHTML = svg;
            } catch {
                if (!cancelled && ref.current)
                    ref.current.innerHTML = "<p style='color:#888'>Graph unavailable</p>";
            }
        })();
        return () => { cancelled = true; };
    }, [mappings]);

    if (mappings.length === 0) return null;
    return (
        <div ref={ref}
            style={{ marginTop: "1rem", overflowX: "auto", background: "#0d1117",
                borderRadius: 8, padding: "1rem" }} />
    );
}
