"use client";

/**
 * QaReviewCard — renders the Agent 2 (Testing & QA) report: exactly 10
 * acceptance tests + 5 prioritized code-review points. When the report is
 * blocking, shows why deployment is disabled.
 */

import type { QaReport } from "@/opm/pipeline/infra/types";

const CATEGORY_COLOR: Record<string, string> = {
    security:      "var(--red)",
    architecture:  "var(--accent)",
    performance:   "var(--yellow)",
    "error handling": "var(--accent-2)",
    readability:   "var(--text-2)",
};

export default function QaReviewCard({ report }: { report: QaReport }) {
    const { acceptanceTests, codeReview, blocked, blockingReasons } = report;
    if (acceptanceTests.length === 0 && codeReview.length === 0) return null;

    const failed = acceptanceTests.filter((t) => t.status === "fail").length;
    const passed = acceptanceTests.length - failed;

    return (
        <div style={{
            marginTop: "1.5rem",
            background: "var(--surface)",
            border: `1px solid ${blocked ? "var(--red)" : "var(--border)"}`,
            borderRadius: "var(--radius)",
            padding: "1.25rem",
            display: "flex",
            flexDirection: "column",
            gap: ".9rem",
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <h3 style={{ margin: 0 }}>QA Review <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: ".8rem" }}>(Agent 2)</span></h3>
                <span style={{ fontSize: ".8rem", color: failed === 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                    {passed}/{acceptanceTests.length} acceptance tests passed
                </span>
            </div>

            {blocked && (
                <div className="error" style={{ flexDirection: "column", alignItems: "flex-start", gap: ".3rem" }}>
                    <div style={{ fontWeight: 700 }}>🚫 Deployment blocked by QA</div>
                    {blockingReasons.map((r, i) => (
                        <div key={i} style={{ fontSize: ".8rem" }}>• {r}</div>
                    ))}
                    <div style={{ fontSize: ".78rem", color: "var(--text-2)", marginTop: ".2rem" }}>
                        Fix the issues (or adjust the OPM model) and re-run the pipeline to unblock deploy.
                    </div>
                </div>
            )}

            {/* Acceptance tests */}
            {acceptanceTests.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: ".35rem" }}>
                    <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)" }}>
                        Acceptance tests
                    </div>
                    {acceptanceTests.map((t, i) => (
                        <div key={i} style={{ display: "flex", gap: ".5rem", alignItems: "baseline", fontSize: ".82rem" }}>
                            <span style={{
                                color: t.status === "pass" ? "var(--green)" : "var(--red)",
                                fontWeight: 700, minWidth: "1.1rem",
                            }}>
                                {t.status === "pass" ? "✓" : "✗"}
                            </span>
                            <div>
                                <span style={{ color: "var(--text)" }}>{t.objective}</span>
                                <span style={{ color: "var(--text-3)" }}> — expected: {t.expected}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Code review */}
            {codeReview.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: ".5rem" }}>
                    <div style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)" }}>
                        Top {codeReview.length} review points
                    </div>
                    {codeReview.map((p, i) => (
                        <div key={i} style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            padding: ".6rem .75rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: ".2rem",
                        }}>
                            <div style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{
                                    fontSize: ".68rem", fontWeight: 700, padding: ".1rem .5rem",
                                    borderRadius: "99px",
                                    color: CATEGORY_COLOR[(p.category ?? "").toLowerCase()] ?? "var(--text-2)",
                                    border: `1px solid ${CATEGORY_COLOR[(p.category ?? "").toLowerCase()] ?? "var(--border)"}`,
                                }}>{p.category}</span>
                                <code style={{ fontSize: ".75rem", color: "var(--accent)" }}>{p.file}</code>
                            </div>
                            <div style={{ fontSize: ".82rem", color: "var(--text)" }}>{p.problem}</div>
                            <div style={{ fontSize: ".8rem", color: "var(--text-2)" }}>💡 {p.suggestion}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
