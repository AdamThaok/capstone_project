"use client";

/**
 * ChatBot.tsx — OPM Conversational Assistant Widget.
 *
 * A floating chat panel in the bottom-right corner of the dashboard.
 * Two modes:
 *   - GENERAL: answers questions about OPM concepts and rules.
 *   - ERROR GUIDE: when diagramErrors is non-empty, automatically displays
 *     the errors and guides the user to fix them.  The pipeline is blocked
 *     until the user uploads a corrected diagram.
 *
 * Props:
 *   diagramErrors   string[]  — errors from the current pipeline job.
 *                               Pass [] when the diagram is OK.
 *   jobId           string    — current job id (used as conversation_id).
 */

import { useEffect, useRef, useState } from "react";

type ChatTurn = { role: "user" | "assistant"; content: string };

type CoverageBreakdown = { total: number; covered: number; missing: string[] };
type CoverageReport = {
    total_elements: number; covered: number; coverage_pct: number; missing: string[];
    objects: CoverageBreakdown; processes: CoverageBreakdown; links: CoverageBreakdown;
};

type ChatBotProps = {
    diagramErrors?:   string[];   // BLOCKING errors — pipeline stopped
    diagramWarnings?: string[];   // Advisory style warnings — pipeline continues
    jobId?: string;
    coverageReport?: CoverageReport;
};

export default function ChatBot({ diagramErrors = [], diagramWarnings = [], jobId, coverageReport }: ChatBotProps) {
    const [open,    setOpen]    = useState(false);
    const [input,   setInput]   = useState("");
    const [history, setHistory] = useState<ChatTurn[]>([]);
    const [loading, setLoading] = useState(false);
    const [mode,    setMode]    = useState<"general" | "error_guide">("general");
    const [blocked, setBlocked] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const prevErrorCount = useRef(0);

    // Auto-open and show error summary when new diagram errors appear.
    useEffect(() => {
        if (diagramErrors.length > 0 && diagramErrors.length !== prevErrorCount.current) {
            prevErrorCount.current = diagramErrors.length;
            setOpen(true);
            setMode("error_guide");
            setBlocked(true);
            // Add an automatic error-guide message from the assistant.
            const errorMsg = buildErrorMessage(diagramErrors);
            setHistory((h) => {
                // Avoid duplicate error messages.
                const last = h[h.length - 1];
                if (last?.role === "assistant" && last.content.startsWith("⚠️")) return h;
                return [...h, { role: "assistant", content: errorMsg }];
            });
        }
        if (diagramErrors.length === 0 && prevErrorCount.current > 0) {
            prevErrorCount.current = 0;
            setMode("general");
            setBlocked(false);
        }
    }, [diagramErrors]);

    // Scroll to bottom on new messages.
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [history, open]);

    async function sendMessage() {
        if (!input.trim() || loading) return;
        const userMsg = input.trim();
        setInput("");
        const newHistory: ChatTurn[] = [...history, { role: "user", content: userMsg }];
        setHistory(newHistory);
        setLoading(true);

        try {
            const res = await fetch("/api/chat", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message:         userMsg,
                    history:         history.slice(-20),
                    diagram_errors:  diagramErrors,
                    conversation_id: jobId ?? "default",
                    coverage_report: coverageReport ?? null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setHistory([...newHistory, { role: "assistant", content: data.reply ?? "" }]);
                setMode(data.mode ?? "general");
                setBlocked(data.pipeline_blocked ?? false);
            } else {
                setHistory([...newHistory, {
                    role: "assistant",
                    content: "שגיאה בתקשורת עם השרת. נסה שוב.",
                }]);
            }
        } catch {
            setHistory([...newHistory, {
                role: "assistant",
                content: "לא ניתן לתקשר עם העוזר כעת.",
            }]);
        } finally {
            setLoading(false);
        }
    }

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    }

    const hasErrors = diagramErrors.length > 0;

    return (
        <>
            {/* ── Floating toggle button ───────────────────────────────── */}
            <button
                onClick={() => setOpen((o) => !o)}
                style={{
                    position:     "fixed",
                    bottom:       "1.5rem",
                    right:        "1.5rem",
                    zIndex:       1000,
                    width:        "3.2rem",
                    height:       "3.2rem",
                    borderRadius: "50%",
                    border:       "none",
                    background:   hasErrors ? "#e53e3e" : "#4f8ef7",
                    color:        "#fff",
                    fontSize:     "1.4rem",
                    cursor:       "pointer",
                    boxShadow:    "0 4px 12px rgba(0,0,0,0.4)",
                    display:      "flex",
                    alignItems:   "center",
                    justifyContent: "center",
                    transition:   "background 0.2s",
                }}
                title={hasErrors ? `${diagramErrors.length} שגיאות בדיאגרמה` : "עוזר OPM"}
                aria-label="Open OPM assistant"
            >
                {hasErrors ? "⚠️" : "💬"}
                {hasErrors && (
                    <span style={{
                        position:     "absolute",
                        top:          "-4px",
                        right:        "-4px",
                        background:   "#fff",
                        color:        "#e53e3e",
                        borderRadius: "50%",
                        fontSize:     "0.65rem",
                        fontWeight:   700,
                        width:        "1.1rem",
                        height:       "1.1rem",
                        display:      "flex",
                        alignItems:   "center",
                        justifyContent: "center",
                        border:       "1.5px solid #e53e3e",
                    }}>
                        {diagramErrors.length}
                    </span>
                )}
            </button>

            {/* ── Chat panel ───────────────────────────────────────────── */}
            {open && (
                <div style={{
                    position:      "fixed",
                    bottom:        "5.5rem",
                    right:         "1.5rem",
                    zIndex:        1000,
                    width:         "min(420px, calc(100vw - 2rem))",
                    maxHeight:     "520px",
                    display:       "flex",
                    flexDirection: "column",
                    borderRadius:  "12px",
                    overflow:      "hidden",
                    boxShadow:     "0 8px 32px rgba(0,0,0,0.55)",
                    background:    "#1a1d24",
                    border:        hasErrors ? "1.5px solid #e53e3e" : "1.5px solid #2d3447",
                    fontFamily:    "inherit",
                }}>
                    {/* Header */}
                    <div style={{
                        background:  hasErrors ? "#c53030" : "#1e3a6e",
                        padding:     "0.7rem 1rem",
                        display:     "flex",
                        alignItems:  "center",
                        gap:         "0.5rem",
                    }}>
                        <span style={{ fontSize: "1.1rem" }}>
                            {hasErrors ? "⚠️" : "🤖"}
                        </span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fff" }}>
                                {hasErrors ? "מדריך תיקון שגיאות OPM" : "עוזר OPM"}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: "#a0aec0" }}>
                                {hasErrors
                                    ? `${diagramErrors.length} שגיאות — הצינור מושהה`
                                    : "ISO 19450 · שאל אותי כל שאלה"}
                            </div>
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            style={{
                                background: "transparent",
                                border: "none",
                                color: "#a0aec0",
                                cursor: "pointer",
                                fontSize: "1.1rem",
                                lineHeight: 1,
                                padding: "0 0.2rem",
                            }}
                            aria-label="Close chat"
                        >×</button>
                    </div>

                    {/* Pipeline blocked banner */}
                    {blocked && (
                        <div style={{
                            background: "#744210",
                            color:      "#fef3c7",
                            padding:    "0.45rem 1rem",
                            fontSize:   "0.78rem",
                            fontWeight: 600,
                            textAlign:  "center",
                            borderBottom: "1px solid #92400e",
                        }}>
                            🚫 הצינור מושהה — תקן את הדיאגרמה והעלה מחדש
                        </div>
                    )}

                    {/* Messages */}
                    <div style={{
                        flex:       1,
                        overflowY:  "auto",
                        padding:    "0.75rem",
                        display:    "flex",
                        flexDirection: "column",
                        gap:        "0.5rem",
                    }}>
                        {history.length === 0 && (
                            <div style={{
                                color:     "#718096",
                                fontSize:  "0.82rem",
                                textAlign: "center",
                                padding:   "1.5rem 0.5rem",
                            }}>
                                {hasErrors
                                    ? "יש שגיאות בדיאגרמה שלך. לחץ על הכפתור למטה כדי לראות אותן."
                                    : "שאל אותי על OPM, ISO 19450, קישורים, מצבים, ועוד."}
                            </div>
                        )}

                        {history.map((turn, i) => (
                            <div
                                key={i}
                                style={{
                                    alignSelf:    turn.role === "user" ? "flex-end" : "flex-start",
                                    maxWidth:     "90%",
                                    background:   turn.role === "user" ? "#2d4a8a" : "#2a2d3a",
                                    color:        "#e2e8f0",
                                    borderRadius: turn.role === "user"
                                        ? "12px 12px 2px 12px"
                                        : "12px 12px 12px 2px",
                                    padding:      "0.55rem 0.8rem",
                                    fontSize:     "0.83rem",
                                    lineHeight:   1.55,
                                    whiteSpace:   "pre-wrap",
                                    wordBreak:    "break-word",
                                    border:       turn.role === "assistant" && hasErrors && i === history.length - 1
                                        ? "1px solid #e53e3e44"
                                        : "none",
                                }}
                            >
                                {turn.content}
                            </div>
                        ))}

                        {loading && (
                            <div style={{
                                alignSelf:  "flex-start",
                                color:      "#718096",
                                fontSize:   "0.8rem",
                                padding:    "0.4rem 0.6rem",
                                fontStyle:  "italic",
                            }}>
                                מחשב...
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    {/* Error quick-show button */}
                    {hasErrors && history.length === 0 && (
                        <div style={{ padding: "0 0.75rem 0.5rem" }}>
                            <button
                                onClick={() => {
                                    setHistory([{
                                        role: "assistant",
                                        content: buildErrorMessage(diagramErrors),
                                    }]);
                                }}
                                style={{
                                    width:        "100%",
                                    padding:      "0.5rem",
                                    background:   "#c53030",
                                    color:        "#fff",
                                    border:       "none",
                                    borderRadius: "6px",
                                    cursor:       "pointer",
                                    fontSize:     "0.83rem",
                                    fontWeight:   600,
                                }}
                            >
                                הצג את כל השגיאות ({diagramErrors.length})
                            </button>
                        </div>
                    )}

                    {/* Input */}
                    <div style={{
                        padding:     "0.6rem 0.75rem",
                        borderTop:   "1px solid #2d3447",
                        display:     "flex",
                        gap:         "0.4rem",
                        background:  "#141720",
                    }}>
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            placeholder={hasErrors
                                ? "שאל שאלה על השגיאות..."
                                : "שאל שאלה על OPM... (Enter לשליחה)"}
                            rows={2}
                            disabled={loading}
                            style={{
                                flex:        1,
                                background:  "#1e2130",
                                border:      "1px solid #2d3447",
                                borderRadius: "6px",
                                color:       "#e2e8f0",
                                padding:     "0.4rem 0.6rem",
                                fontSize:    "0.83rem",
                                resize:      "none",
                                outline:     "none",
                                fontFamily:  "inherit",
                            }}
                        />
                        <button
                            onClick={sendMessage}
                            disabled={!input.trim() || loading}
                            style={{
                                background:   input.trim() && !loading ? "#4f8ef7" : "#2d3447",
                                color:        "#fff",
                                border:       "none",
                                borderRadius: "6px",
                                padding:      "0 0.7rem",
                                cursor:       input.trim() && !loading ? "pointer" : "not-allowed",
                                fontSize:     "1rem",
                                transition:   "background 0.15s",
                                minWidth:     "2.2rem",
                            }}
                            aria-label="Send"
                        >
                            ➤
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Helper: builds the automatic error-guide message
// ---------------------------------------------------------------------------
function buildErrorMessage(errors: string[]): string {
    const lines: string[] = [
        "⚠️ **הדיאגרמה שלך מכילה שגיאות — הצינור מושהה.**\n",
        "לא ניתן להמשיך לייצור הקוד עד שכל השגיאות יתוקנו על ידך.\n",
        "**השגיאות שנמצאו:**\n",
    ];
    errors.forEach((err, i) => lines.push(`${i + 1}. ${err}`));
    lines.push(
        "\n**מה לעשות:**",
        "1. פתח את הדיאגרמה שלך ב-OPCloud (או בכלי הציור שלך).",
        "2. תקן כל שגיאה (ראה רשימה מעלה).",
        "3. העלה מחדש את הדיאגרמה המתוקנת.",
        "\nהצינור יחדש את ריצתו אוטומטית לאחר שהדיאגרמה תעבור אימות מלא.",
    );
    return lines.join("\n");
}
