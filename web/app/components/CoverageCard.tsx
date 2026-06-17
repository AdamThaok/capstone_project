"use client";

/**
 * CoverageCard.tsx
 *
 * Shows OPM-to-code coverage for the current job:
 *   • Overall % with a circular progress ring
 *   • Per-type bars: Objects / Processes / Links
 *   • Timeline of snapshots (before / after fix)
 *   • Collapsible list of missing elements
 */

import React, { useState } from "react";
import type { CoverageReport, CoverageSnapshot } from "@/opm/pipeline/infra/types";

// ─── helpers ────────────────────────────────────────────────────────────────

function pct(covered: number, total: number): number {
    if (total === 0) return 100;
    return Math.round((covered / total) * 100);
}

function colorForPct(p: number): string {
    if (p >= 100) return "#22c55e"; // green-500
    if (p >= 80)  return "#eab308"; // yellow-500
    return "#ef4444";               // red-500
}

// ─── Circular progress ring ─────────────────────────────────────────────────

function Ring({ value, size = 88 }: { value: number; size?: number }) {
    const r = (size - 10) / 2;
    const circ = 2 * Math.PI * r;
    const fill = circ * (value / 100);
    const color = colorForPct(value);
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* track */}
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke="#e5e7eb" strokeWidth={8} />
            {/* fill — rotate so arc starts at top */}
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={color} strokeWidth={8}
                strokeDasharray={`${fill} ${circ}`}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                style={{ transition: "stroke-dasharray 0.6s ease" }}
            />
            <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
                fontSize={size * 0.22} fontWeight="700" fill={color}>
                {value}%
            </text>
        </svg>
    );
}

// ─── Single type bar ─────────────────────────────────────────────────────────

function TypeBar({
    label, covered, total,
}: { label: string; covered: number; total: number }) {
    const p = pct(covered, total);
    const color = colorForPct(p);
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between",
                fontSize: 13, marginBottom: 3 }}>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ color }}>{covered}/{total} ({p}%)</span>
            </div>
            <div style={{ background: "#e5e7eb", borderRadius: 6, height: 8 }}>
                <div style={{
                    width: `${p}%`, height: 8, borderRadius: 6,
                    background: color,
                    transition: "width 0.6s ease",
                }} />
            </div>
        </div>
    );
}

// ─── Timeline spark ──────────────────────────────────────────────────────────

function Timeline({ history }: { history: CoverageSnapshot[] }) {
    if (history.length < 2) return null;
    return (
        <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#6b7280",
                textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
                שינוי לאורך זמן
            </p>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 48 }}>
                {history.map((s, i) => {
                    const h = Math.max(6, Math.round((s.coverage_pct / 100) * 48));
                    const color = colorForPct(s.coverage_pct);
                    return (
                        <div key={i} style={{ flex: 1, display: "flex",
                            flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <span style={{ fontSize: 10, color, fontWeight: 600 }}>
                                {Math.round(s.coverage_pct)}%
                            </span>
                            <div style={{ width: "100%", height: h,
                                background: color, borderRadius: 3,
                                transition: "height 0.4s ease" }} />
                            <span style={{ fontSize: 9, color: "#9ca3af",
                                textAlign: "center", maxWidth: 40,
                                overflow: "hidden", textOverflow: "ellipsis",
                                whiteSpace: "nowrap" }}>
                                {s.label}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Missing elements list ────────────────────────────────────────────────────

function MissingList({ missing }: { missing: string[] }) {
    const [open, setOpen] = useState(false);
    if (missing.length === 0) return null;
    return (
        <div style={{ marginTop: 14 }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: 13, color: "#ef4444", fontWeight: 600,
                    padding: 0, display: "flex", alignItems: "center", gap: 4,
                }}
            >
                <span>{open ? "▾" : "▸"}</span>
                {missing.length} אלמנטים חסרים בקוד
            </button>
            {open && (
                <div style={{
                    marginTop: 6, padding: "8px 12px",
                    background: "#fef2f2", borderRadius: 8,
                    border: "1px solid #fecaca",
                    maxHeight: 160, overflowY: "auto",
                }}>
                    {missing.map(id => (
                        <div key={id} style={{
                            fontSize: 12, color: "#b91c1c", fontFamily: "monospace",
                            padding: "2px 0", borderBottom: "1px solid #fee2e2",
                        }}>
                            {id}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface CoverageCardProps {
    coverageReport?: CoverageReport;
    coverageHistory?: CoverageSnapshot[];
}

export default function CoverageCard({
    coverageReport,
    coverageHistory = [],
}: CoverageCardProps) {
    // Don't render until we have real data
    if (!coverageReport) {
        return (
            <div style={{
                background: "#f9fafb", borderRadius: 12,
                border: "1px dashed #d1d5db",
                padding: "20px 24px",
                color: "#9ca3af", fontSize: 14, textAlign: "center",
            }}>
                Coverage יחושב לאחר Stage 5 (Validation)
            </div>
        );
    }

    const { coverage_pct, covered, total_elements, missing, objects, processes, links } = coverageReport;
    const overall = Math.round(coverage_pct);
    const statusLabel =
        overall === 100 ? "✅ כיסוי מלא" :
        overall >= 80   ? "⚠️ כיסוי חלקי" :
                          "❌ כיסוי נמוך";
    const statusColor =
        overall === 100 ? "#15803d" :
        overall >= 80   ? "#b45309" :
                          "#b91c1c";

    return (
        <div style={{
            background: "#ffffff",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            padding: "20px 24px",
            fontFamily: "system-ui, sans-serif",
        }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between",
                alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
                    📊 Coverage דיאגרמה
                </h3>
                <span style={{
                    fontSize: 12, fontWeight: 600, color: statusColor,
                    background: overall === 100 ? "#dcfce7" : overall >= 80 ? "#fef3c7" : "#fee2e2",
                    padding: "2px 10px", borderRadius: 20,
                }}>
                    {statusLabel}
                </span>
            </div>

            {/* Ring + summary */}
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 16 }}>
                <Ring value={overall} size={88} />
                <div>
                    <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827" }}>
                        {covered}
                        <span style={{ fontSize: 14, fontWeight: 500, color: "#6b7280" }}>
                            {" "}/ {total_elements} אלמנטים
                        </span>
                    </p>
                    <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>
                        {total_elements - covered} אלמנטים לא מכוסים
                    </p>
                </div>
            </div>

            {/* Per-type bars */}
            <div style={{
                background: "#f9fafb", borderRadius: 10, padding: "14px 16px", marginBottom: 4,
            }}>
                <TypeBar label="Objects"   covered={objects.covered}   total={objects.total}   />
                <TypeBar label="Processes" covered={processes.covered} total={processes.total} />
                <TypeBar label="Links"     covered={links.covered}     total={links.total}     />
            </div>

            {/* Timeline */}
            <Timeline history={coverageHistory} />

            {/* Missing list */}
            <MissingList missing={missing} />
        </div>
    );
}
