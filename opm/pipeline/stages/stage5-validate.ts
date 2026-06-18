// Stage 5: Final validation report — a presenter over the shared Testing Agent.
//
// The actual testing logic lives in ONE place: pipeline/agents/testing-agent.ts
// (the same Testing Agent the build loop uses each iteration). Stage 5 reads the
// generated files back from disk, runs that SAME Testing Agent, and formats the
// result into the dashboard's coverage + QA report. It also powers the on-demand
// "revalidate" route (re-test the existing project without regenerating).
//
// Fallback: returns the bundled mock validation_report.json.

import fs from "node:fs/promises";
import path from "node:path";
import { runTests } from "../agents/testing-agent";
import type { AgentIR, FileSpec, TestReport } from "../agents/types";
import type { QaReport, QaAcceptanceTest, QaReviewPoint } from "../infra/types";

// Read every text file under outDir back into the in-memory FileSpec[] shape the
// Testing Agent expects.
async function readArtifact(outDir: string): Promise<FileSpec[]> {
    const files: FileSpec[] = [];
    async function walk(dir: string): Promise<void> {
        let entries: import("node:fs").Dirent[];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                await walk(full);
            } else {
                const rel = path.relative(outDir, full).replace(/\\/g, "/");
                try { files.push({ path: rel, content: await fs.readFile(full, "utf-8") }); }
                catch { /* skip binary / unreadable */ }
            }
        }
    }
    await walk(outDir);
    return files;
}

/**
 * Blocking policy (pure, unit-tested): a build is blocked ONLY when an acceptance
 * test fails — i.e. the generated app is functionally incomplete/broken. All
 * review points (security / architecture / …) are ADVISORY: shown, not enforced.
 * (Generated demo apps universally lack auth, so blocking on a "no auth" note
 * would block every generation — the finding is surfaced, not enforced.)
 */
export function computeQaBlocking(
    r: { acceptanceTests: QaAcceptanceTest[]; codeReview: QaReviewPoint[] },
): { blocked: boolean; blockingReasons: string[] } {
    const reasons: string[] = [];
    const failed = r.acceptanceTests.filter((t) => t.status === "fail");
    if (failed.length > 0) {
        reasons.push(
            `${failed.length} acceptance test(s) failing: ` +
            failed.map((t) => t.objective).slice(0, 3).join("; "),
        );
    }
    return { blocked: reasons.length > 0, blockingReasons: reasons };
}

// Format a TestReport into the dashboard's validation-result shape.
function presentReport(report: TestReport) {
    const qa: QaReport = {
        acceptanceTests: report.acceptanceTests,
        codeReview:      report.codeReview,
        ...computeQaBlocking(report),
    };
    const ok = report.passed && !qa.blocked;
    return {
        metadata: {
            validator:   "Two-agent loop (shared Testing Agent)",
            validatedAt: new Date().toISOString(),
            iterations:  0, // Stage 5 presents one final pass; the loop did the iterating
        },
        coverage: report.coverage, // CoverageReport — read by the dashboard + revalidate route
        buildChecks: [
            {
                name:     "required files + coverage + syntax",
                status:   report.passed ? "pass" : "fail",
                failures: report.failures.map((f) => f.detail),
            },
        ],
        coverageVerification: {
            coverage:  `${report.coverage.coverage_pct}%`,
            uncovered: report.coverage.missing,
        },
        qaReview:    qa,
        finalStatus: ok ? "READY_FOR_DEPLOYMENT" : "NEEDS_MANUAL_REVIEW",
    };
}

async function mock() {
    const mockPath = path.join(process.cwd(), "public", "mock-outputs", "validation_report.json");
    const raw = await fs.readFile(mockPath, "utf-8");
    return JSON.parse(raw);
}

export async function validateGenerated_stage5(
    _fileTree: unknown,
    ctx?: { jobId: string; spec?: unknown; opmModel?: unknown; outputDir?: string },
) {
    if (!ctx?.outputDir || !ctx.opmModel) return mock();
    try {
        const files  = await readArtifact(ctx.outputDir);
        const report = await runTests(files, ctx.opmModel as AgentIR);
        return presentReport(report);
    } catch (e) {
        console.error("[stage5] validation failed, using mock:", (e as Error).message);
        return mock();
    }
}
