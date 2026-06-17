"use client";

/**
 * DeployPanel — shows deployment status and lets the user trigger/re-trigger
 * cloud deployment for a completed pipeline job.
 *
 * States:
 *   SETUP      — no tokens configured; shows setup guide
 *   IDLE       — tokens ok, project ready, not yet deployed
 *   DEPLOYING  — deploy in progress (spinner + live log)
 *   LIVE       — deployed successfully; shows prominent URL card
 *   ERROR      — deploy failed; shows error + retry button
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
type DeployStatus = "pending" | "active" | "done" | "error";

type DeployOutput = {
    skipped?:  boolean;
    reason?:   string;
    github?:   { owner: string; repo: string; html_url: string; commitSha: string; files: number };
    railway?:  { projectId: string; railwayUrl: string; backendUrl?: string; frontendUrl?: string };
};

type Props = {
    jobId:      string;
    /** True once Stage 5 validation is done and files are on disk */
    pipelineDone: boolean;
};

// ---------------------------------------------------------------------------
export default function DeployPanel({ jobId, pipelineDone }: Props) {
    const [status,       setStatus]       = useState<DeployStatus>("pending");
    const [output,       setOutput]       = useState<DeployOutput | null>(null);
    const [error,        setError]        = useState<string | null>(null);
    const [tokensOk,     setTokensOk]     = useState(false);
    const [deploying,    setDeploying]    = useState(false);
    const [copied,       setCopied]       = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ---- fetch current deploy state from the server ----
    const refresh = useCallback(async () => {
        try {
            const r = await fetch(`/api/deploy/${jobId}`);
            if (!r.ok) return;
            const d = await r.json();
            setStatus(d.status);
            setOutput(d.output);
            setError(d.error);
            setTokensOk(d.tokensPresent);
            if (d.status === "done" || d.status === "error") {
                setDeploying(false);
                if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            }
        } catch { /* ignore */ }
    }, [jobId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // ---- trigger deploy ----
    async function deploy() {
        setDeploying(true);
        setError(null);
        await fetch(`/api/deploy/${jobId}`, { method: "POST" });
        // Start polling every 2 s until done/error.
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(refresh, 2000);
    }

    // ---- copy URL to clipboard ----
    function copyUrl(url: string) {
        navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }

    // ---- cleanup ----
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const liveUrl  = output?.railway?.frontendUrl;
    const apiUrl   = output?.railway?.backendUrl;
    const ghUrl    = output?.github?.html_url;
    const railwayDashboard = output?.railway?.railwayUrl;
    const isDone   = status === "done" && !output?.skipped && liveUrl;

    // =========================================================================
    // LIVE — deployed successfully
    // =========================================================================
    if (isDone) {
        return (
            <div className="deploy-card deploy-live">
                <div className="deploy-live-badge">🚀 Your app is live!</div>
                <div className="deploy-live-url">
                    <a href={liveUrl} target="_blank" rel="noreferrer">{liveUrl}</a>
                    <button className="deploy-copy-btn" onClick={() => copyUrl(liveUrl)}>
                        {copied ? "✓ Copied" : "Copy"}
                    </button>
                </div>
                <a className="deploy-open-btn primary" href={liveUrl} target="_blank" rel="noreferrer">
                    Open App ↗
                </a>

                {/* iframe preview */}
                <div className="deploy-preview-wrap">
                    <div className="deploy-preview-label">Live preview</div>
                    <iframe
                        src={liveUrl}
                        className="deploy-preview-frame"
                        title="Live app preview"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                    />
                </div>

                {/* Secondary links */}
                <div className="deploy-links">
                    {apiUrl && (
                        <a href={apiUrl + "/docs"} target="_blank" rel="noreferrer" className="deploy-link">
                            📄 API Docs (FastAPI Swagger)
                        </a>
                    )}
                    {ghUrl && (
                        <a href={ghUrl} target="_blank" rel="noreferrer" className="deploy-link">
                            ⬡ Source on GitHub
                        </a>
                    )}
                    {railwayDashboard && (
                        <a href={railwayDashboard} target="_blank" rel="noreferrer" className="deploy-link">
                            🚂 Railway dashboard
                        </a>
                    )}
                </div>

                {output?.github && (
                    <div className="deploy-meta">
                        {output.github.files} files pushed · commit{" "}
                        <code>{output.github.commitSha.slice(0, 7)}</code>
                    </div>
                )}
            </div>
        );
    }

    // =========================================================================
    // DEPLOYING — in progress
    // =========================================================================
    if (status === "active" || deploying) {
        return (
            <div className="deploy-card deploy-running">
                <div className="deploy-running-header">
                    <div className="deploy-spinner" />
                    <span>Deploying your app…</span>
                </div>
                <div className="deploy-steps">
                    {[
                        "Creating GitHub repository",
                        "Pushing generated files",
                        "Creating Railway project",
                        "Provisioning PostgreSQL",
                        "Starting backend service",
                        "Starting frontend service",
                        "Generating public domains",
                    ].map((step, i) => (
                        <div key={i} className="deploy-step">
                            <div className="deploy-step-dot" />
                            <span>{step}</span>
                        </div>
                    ))}
                </div>
                <p className="hint">This takes about 1–3 minutes. You can leave this page and come back.</p>
            </div>
        );
    }

    // =========================================================================
    // ERROR — deploy failed
    // =========================================================================
    if (status === "error") {
        return (
            <div className="deploy-card deploy-error">
                <div className="deploy-error-header">❌ Deployment failed</div>
                {error && <pre className="deploy-error-msg">{error}</pre>}
                {pipelineDone && tokensOk && (
                    <button className="primary" style={{ marginTop: ".75rem" }} onClick={deploy}>
                        Retry Deployment
                    </button>
                )}
                {!tokensOk && <SetupGuide />}
            </div>
        );
    }

    // =========================================================================
    // SKIPPED — tokens not configured
    // =========================================================================
    if (!tokensOk || (status === "done" && output?.skipped)) {
        return (
            <div className="deploy-card">
                <div className="deploy-setup-header">
                    <span className="deploy-setup-icon">☁️</span>
                    <div>
                        <div className="deploy-setup-title">Deploy to the internet</div>
                        <div className="deploy-setup-sub">Connect GitHub and Railway above to publish your app live</div>
                    </div>
                </div>
                <SetupGuide />
                {pipelineDone && tokensOk && (
                    <button className="primary" style={{ marginTop: "1rem" }} onClick={deploy}>
                        Deploy Now
                    </button>
                )}
            </div>
        );
    }

    // =========================================================================
    // IDLE — tokens ok, pipeline done, not yet deployed
    // =========================================================================
    if (pipelineDone && tokensOk) {
        return (
            <div className="deploy-card deploy-idle">
                <div className="deploy-idle-header">
                    <span style={{ fontSize: "2rem" }}>🚀</span>
                    <div>
                        <div className="deploy-setup-title">Ready to deploy</div>
                        <div className="deploy-setup-sub">
                            Push to GitHub and go live on Railway with one click
                        </div>
                    </div>
                </div>
                <button className="primary" style={{ marginTop: "1rem" }} onClick={deploy}>
                    Deploy to Cloud
                </button>
            </div>
        );
    }

    // =========================================================================
    // WAITING — pipeline not finished yet
    // =========================================================================
    return (
        <div className="deploy-card deploy-waiting">
            <span style={{ fontSize: "1.5rem" }}>⏳</span>
            <p className="hint" style={{ margin: 0 }}>
                Deployment will be available once code generation completes.
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SetupGuide — step-by-step token configuration instructions
// ---------------------------------------------------------------------------
function SetupGuide() {
    return (
        <div className="deploy-guide">
            <div className="deploy-guide-title">Connect your accounts (one-time)</div>

            <div className="deploy-guide-step">
                <div className="deploy-guide-num">1</div>
                <div>
                    <strong>GitHub</strong>
                    <p>
                        Click <em>Connect GitHub</em> in the <strong>Connections</strong> panel at the top of
                        the page and authorize the app. Your generated repo is created in your own account.
                    </p>
                </div>
            </div>

            <div className="deploy-guide-step">
                <div className="deploy-guide-num">2</div>
                <div>
                    <strong>Railway</strong>
                    <p>
                        Create a token at{" "}
                        <a href="https://railway.app/account/tokens" target="_blank" rel="noreferrer">
                            railway.app/account/tokens
                        </a>{" "}
                        and paste it into the <strong>Connections</strong> panel.
                    </p>
                </div>
            </div>

            <div className="deploy-guide-step">
                <div className="deploy-guide-num">3</div>
                <div>
                    <strong>Deploy</strong>
                    <p>Once both show “connected”, this panel turns into a one-click Deploy button.</p>
                </div>
            </div>
        </div>
    );
}
