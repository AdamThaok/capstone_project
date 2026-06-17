"use client";

/**
 * ConnectionsPanel — lets each user connect their own GitHub (OAuth) and
 * Railway (pasted API token) accounts. Generated apps deploy to *their*
 * accounts. Deployment stays gated until both are connected.
 */

import { useCallback, useEffect, useState } from "react";

type Connections = { github: boolean; githubLogin?: string; railway: boolean };

const rowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "1rem",
    padding: ".75rem .9rem",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
};

const primaryBtn: React.CSSProperties = {
    padding: ".5rem 1rem",
    background: "var(--primary-grad)",
    color: "#fff",
    border: "none",
    borderRadius: "var(--radius-sm)",
    fontWeight: 600,
    fontSize: ".85rem",
    fontFamily: "var(--font)",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    whiteSpace: "nowrap",
};

const inputStyle: React.CSSProperties = {
    background: "var(--bg-2)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: ".5rem .6rem",
    color: "var(--text)",
    fontSize: ".82rem",
    width: "210px",
    fontFamily: "var(--font-mono)",
};

export default function ConnectionsPanel() {
    const [conn,         setConn]         = useState<Connections | null>(null);
    const [railwayToken, setRailwayToken] = useState("");
    const [savingRailway, setSavingRailway] = useState(false);
    const [busy,         setBusy]         = useState<"github" | "railway" | null>(null);
    const [notice,       setNotice]       = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const r = await fetch("/api/auth/connections");
            if (r.ok) setConn((await r.json()) as Connections);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Surface the result of the GitHub OAuth redirect, then clean the URL.
    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get("connect");
        if (!code) return;
        if (code === "github_error")        setNotice("GitHub connection failed — please try again.");
        else if (code === "github_unconfigured") setNotice("GitHub OAuth isn't configured on the server.");
        window.history.replaceState(null, "", window.location.pathname);
    }, []);

    async function saveRailway() {
        const token = railwayToken.trim();
        if (!token) return;
        setSavingRailway(true);
        try {
            const r = await fetch("/api/auth/railway", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ token }),
            });
            if (r.ok) { setRailwayToken(""); await refresh(); }
        } finally {
            setSavingRailway(false);
        }
    }

    async function disconnect(provider: "github" | "railway") {
        setBusy(provider);
        try {
            await fetch(`/api/auth/disconnect?provider=${provider}`, { method: "DELETE" });
            await refresh();
        } finally {
            setBusy(null);
        }
    }

    const bothConnected = !!conn?.github && !!conn?.railway;

    return (
        <div className="panel" style={{ marginBottom: "1.5rem" }}>
            <h3>Connections</h3>
            <p className="hint">
                Connect your own GitHub and Railway accounts — generated apps deploy to{" "}
                <strong>your</strong> accounts. Both are required before you can deploy.
            </p>

            {notice && (
                <div className="error" style={{ marginTop: ".5rem" }}>{notice}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: ".6rem", marginTop: ".9rem" }}>
                {/* ── GitHub ── */}
                <div style={rowStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                        <span style={{ fontSize: "1.25rem" }}>⬡</span>
                        <div>
                            <div style={{ fontWeight: 600, color: "var(--text)" }}>GitHub</div>
                            <div style={{ fontSize: ".78rem", color: conn?.github ? "var(--green)" : "var(--text-2)" }}>
                                {conn?.github ? `Connected as @${conn.githubLogin ?? "unknown"}` : "Not connected"}
                            </div>
                        </div>
                    </div>
                    {conn?.github ? (
                        <button className="ghost" disabled={busy === "github"} onClick={() => disconnect("github")}>
                            {busy === "github" ? "…" : "Disconnect"}
                        </button>
                    ) : (
                        <a href="/api/auth/github" style={primaryBtn}>Connect GitHub</a>
                    )}
                </div>

                {/* ── Railway ── */}
                <div style={rowStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                        <span style={{ fontSize: "1.25rem" }}>🚂</span>
                        <div>
                            <div style={{ fontWeight: 600, color: "var(--text)" }}>Railway</div>
                            <div style={{ fontSize: ".78rem", color: conn?.railway ? "var(--green)" : "var(--text-2)" }}>
                                {conn?.railway ? "Railway connected" : "Not connected"}
                            </div>
                        </div>
                    </div>
                    {conn?.railway ? (
                        <button className="ghost" disabled={busy === "railway"} onClick={() => disconnect("railway")}>
                            {busy === "railway" ? "…" : "Disconnect"}
                        </button>
                    ) : (
                        <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
                            <input
                                type="password"
                                placeholder="Paste Railway API token"
                                value={railwayToken}
                                onChange={(e) => setRailwayToken(e.target.value)}
                                style={inputStyle}
                            />
                            <button
                                onClick={saveRailway}
                                disabled={!railwayToken.trim() || savingRailway}
                                style={{
                                    ...primaryBtn,
                                    opacity: (!railwayToken.trim() || savingRailway) ? 0.45 : 1,
                                    cursor:  (!railwayToken.trim() || savingRailway) ? "not-allowed" : "pointer",
                                }}
                            >
                                {savingRailway ? "Saving…" : "Save"}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {!conn?.railway && (
                <p className="hint" style={{ marginTop: ".6rem" }}>
                    Generate a token at{" "}
                    <a href="https://railway.app/account/tokens" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                        railway.app/account/tokens
                    </a>
                </p>
            )}

            {conn && !bothConnected && (
                <p className="hint" style={{ marginTop: ".5rem", color: "var(--yellow)" }}>
                    Connect both providers to enable cloud deployment.
                </p>
            )}
        </div>
    );
}
