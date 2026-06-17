"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/web/auth/useCurrentUser";
import type { CoverageReport } from "@/opm/pipeline/infra/types";

type ProjectSummary = {
    id: string;
    filenames: string[];
    createdAt: string;
    done: boolean;
    hasErrors: boolean;
    stagesTotal: number;
    stagesDone: number;
    diagramErrors: string[];
    coverageReport?: CoverageReport;
};

function projectStatus(p: ProjectSummary): "running" | "done" | "error" | "pending" {
    if (!p.done && p.stagesDone > 0) return "running";
    if (p.done && p.hasErrors)       return "error";
    if (p.done && !p.hasErrors)      return "done";
    return "pending";
}

function StatusBadge({ status }: { status: ReturnType<typeof projectStatus> }) {
    const map: Record<string, { label: string; cls: string }> = {
        running: { label: "Running",  cls: "badge-running" },
        done:    { label: "Done",     cls: "badge-done"    },
        error:   { label: "Error",    cls: "badge-error"   },
        pending: { label: "Pending",  cls: "badge-pending" },
    };
    const { label, cls } = map[status];
    return <span className={`proj-badge ${cls}`}>{label}</span>;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
        <div className="proj-progress-track">
            <div className="proj-progress-fill" style={{ width: `${pct}%` }} />
        </div>
    );
}

function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
           " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function ProjectsClient() {
    const router = useRouter();
    const currentUser = useCurrentUser();
    const [projects, setProjects]   = useState<ProjectSummary[]>([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState<string | null>(null);

    async function fetchProjects() {
        const res = await fetch("/api/projects");
        if (!res.ok) { setError("Failed to load projects"); setLoading(false); return; }
        const { projects: list } = await res.json();
        setProjects(list);
        setLoading(false);
    }

    useEffect(() => {
        fetchProjects();
        // Poll every 3s so running projects update without a manual refresh.
        const interval = setInterval(fetchProjects, 3000);
        return () => clearInterval(interval);
    }, []);

    async function logout() {
        await fetch("/api/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
    }

    return (
        <div className="shell">
            <header className="topbar">
                <div className="brand">OPM<span>→</span>Code</div>
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
                <div className="proj-header">
                    <div>
                        <h2 style={{ margin: 0 }}>My Projects</h2>
                        <p className="lead" style={{ marginBottom: 0 }}>
                            Each project is a full-stack app generated from an OPM diagram.
                        </p>
                    </div>
                    <button className="primary proj-new-btn" onClick={() => router.push("/dashboard")}>
                        + New Project
                    </button>
                </div>

                {loading && (
                    <div className="proj-empty">
                        <div className="proj-spinner" />
                        <p>Loading projects…</p>
                    </div>
                )}

                {!loading && error && (
                    <div className="error">{error}</div>
                )}

                {!loading && !error && projects.length === 0 && (
                    <div className="proj-empty">
                        <div className="proj-empty-icon">📂</div>
                        <h3>No projects yet</h3>
                        <p className="lead">Upload an OPM diagram to generate your first application.</p>
                        <button className="primary" style={{ width: "auto", padding: "0.75rem 2rem" }}
                            onClick={() => router.push("/dashboard")}>
                            Start your first project
                        </button>
                    </div>
                )}

                {!loading && !error && projects.length > 0 && (
                    <div className="proj-grid">
                        {projects.map((p) => {
                            const status = projectStatus(p);
                            const mainFile = p.filenames[0] ?? "Untitled";
                            const extraFiles = p.filenames.length - 1;
                            const coverage = p.coverageReport?.coverage_pct;

                            return (
                                <div key={p.id} className="proj-card">
                                    <div className="proj-card-top">
                                        <div className="proj-icon">
                                            {status === "done"    ? "✅" :
                                             status === "error"   ? "❌" :
                                             status === "running" ? "⚙️" : "⏳"}
                                        </div>
                                        <div className="proj-meta">
                                            <div className="proj-name" title={p.filenames.join(", ")}>
                                                {mainFile}
                                                {extraFiles > 0 && (
                                                    <span className="proj-extra-files"> +{extraFiles} file{extraFiles > 1 ? "s" : ""}</span>
                                                )}
                                            </div>
                                            <div className="proj-date">{formatDate(p.createdAt)}</div>
                                        </div>
                                        <StatusBadge status={status} />
                                    </div>

                                    <div className="proj-card-mid">
                                        <div className="proj-progress-label">
                                            <span>Pipeline progress</span>
                                            <span>{p.stagesDone}/{p.stagesTotal} stages</span>
                                        </div>
                                        <ProgressBar done={p.stagesDone} total={p.stagesTotal} />
                                    </div>

                                    {coverage !== undefined && (
                                        <div className="proj-coverage">
                                            <span>OPM coverage</span>
                                            <span className={coverage >= 80 ? "cov-good" : coverage >= 50 ? "cov-mid" : "cov-low"}>
                                                {coverage.toFixed(1)}%
                                            </span>
                                        </div>
                                    )}

                                    {p.diagramErrors.length > 0 && (
                                        <div className="proj-diagram-err">
                                            ⚠️ {p.diagramErrors.length} diagram error{p.diagramErrors.length > 1 ? "s" : ""}
                                        </div>
                                    )}

                                    <div className="proj-card-actions">
                                        <button
                                            className="primary"
                                            style={{ flex: 1, fontSize: ".85rem", padding: ".6rem" }}
                                            onClick={() => router.push(`/dashboard?job=${p.id}`)}
                                        >
                                            Open
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
