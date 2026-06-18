// The Orchestrator — the outer loop that drives the two agents.
//
//   generate -> test -> (halt?) -> reflect -> regenerate -> ...
//
// It is the ONLY component that holds both agents' outputs, and the ONLY place
// the loop can terminate. Termination is a pure function (decideHalt) so it is
// provable and unit-testable.

import { runTests } from "./testing-agent";
import {
    generateInitialCode,
    reflectOnFailures,
    regenerateFromReflection,
    integrationRepair,
} from "./code-generation-agent";
import type { CodeArtifact, TestReport, ReflectionNote, AttemptRecord, AgentIR } from "./types";

export type Outcome = "SUCCESS" | "EXHAUSTED" | "STALLED" | "RUNNING";

// Pure stopping-condition decision (no I/O) — the heart of the loop, unit-tested.
//   SUCCESS   : the Testing Agent reports no failures.
//   EXHAUSTED : the iteration budget is spent.
//   STALLED   : this failure set has been seen before (the model is going in
//               circles). `repeated` is computed by the loop against the SET of
//               all prior signatures, so it catches A→B→A oscillation, not just
//               an immediate A→A repeat.
//   RUNNING   : keep going.
export function decideHalt(state: {
    passed:   boolean;
    iter:     number;
    maxIters: number;
    repeated: boolean;
}): Outcome {
    if (state.passed) return "SUCCESS";
    if (state.iter >= state.maxIters) return "EXHAUSTED";
    if (state.repeated) return "STALLED";
    return "RUNNING";
}

export type LedgerEntry = {
    iteration: number;
    passed:    boolean;
    failures:  string[];
    diagnosis?: string;
    fixPlan?:   string;
};

export type BuildResult = {
    artifact:   CodeArtifact;
    report:     TestReport;
    outcome:    Exclude<Outcome, "RUNNING">;
    iterations: number;
    ledger:     LedgerEntry[];
};

// The two-agent build loop. Drives the generate->test->reflect->regenerate
// cycle until a stopping condition. Wrapped by generateCode_stage4 (the Stage 4
// entry point in pipeline/stages/stage4-codegen.ts), which writes to disk.
export async function runBuildLoop(
    superPrompt: string,
    ir: AgentIR,
    opts?: { maxIters?: number; log?: (m: string) => void },
): Promise<BuildResult> {
    const maxIters = opts?.maxIters ?? 3;
    const log = opts?.log ?? (() => { /* no-op */ });

    const ledger:  LedgerEntry[]  = [];
    const history: AttemptRecord[] = [];

    const emptyCoverage = {
        total_elements: 0, covered: 0, coverage_pct: 0, missing: [],
        objects:   { total: 0, covered: 0, missing: [] },
        processes: { total: 0, covered: 0, missing: [] },
        links:     { total: 0, covered: 0, missing: [] },
    };

    let iter = 0;
    // Every failure signature we've seen, so a recurring set (even non-consecutive)
    // is detected as a stall instead of looping until the budget is exhausted.
    const seenSignatures = new Set<string>();
    let reflection: ReflectionNote = { diagnosis: "", fixPlan: "" };
    let artifact: CodeArtifact = [];
    let report: TestReport = { passed: false, failures: [], signature: "", coverage: emptyCoverage, acceptanceTests: [], codeReview: [] };

    while (true) {
        // ACT — generate (first pass) or regenerate (guided by the last reflection).
        if (iter === 0) {
            log("⚡ Code Generation Agent: generating the initial project…");
            artifact = await generateInitialCode(superPrompt, log);
        } else {
            log(`🔧 Code Generation Agent: regenerating (attempt ${iter})…`);
            artifact = await regenerateFromReflection(artifact, reflection, report, ir, log);
        }

        // OBSERVE — the Testing Agent judges the artifact.
        report = await runTests(artifact, ir);
        log(`🔎 Testing Agent: ${report.passed ? "all checks passed" : `${report.failures.length} failure(s)`}.`);

        ledger.push({
            iteration: iter,
            passed:    report.passed,
            failures:  report.failures.map((f) => f.detail),
            diagnosis: reflection.diagnosis || undefined,
            fixPlan:   reflection.fixPlan   || undefined,
        });

        // HALT? — pure decision. `repeated` = have we already seen this exact
        // failure set on an earlier iteration?
        const repeated = report.signature !== "" && seenSignatures.has(report.signature);
        let outcome = decideHalt({ passed: report.passed, iter, maxIters, repeated });
        if (outcome !== "RUNNING") {
            log(`🛑 Build loop halted: ${outcome} after ${iter + 1} pass(es).`);

            // Final safety net: never finalize a non-booting app without one
            // whole-repo integration-repair pass (stronger model) + re-test. This is
            // what keeps the DOWNLOADED project boot-ready, not just "generated".
            if (outcome !== "SUCCESS" && report.failures.length > 0) {
                log("🩺 App still failing — running a final whole-repo integration repair…");
                const repaired = await integrationRepair(artifact, report, ir, log);
                const recheck = await runTests(repaired, ir);
                if (recheck.failures.length < report.failures.length) {
                    log(`🩺 Integration repair: ${report.failures.length} → ${recheck.failures.length} failure(s).`);
                    artifact = repaired;
                    report   = recheck;
                    if (recheck.passed) outcome = "SUCCESS";
                } else {
                    log("🩺 Integration repair did not improve the result — keeping prior artifact.");
                }
            }

            return { artifact, report, outcome, iterations: iter + 1, ledger };
        }

        // Record this signature now that we're continuing, so a later recurrence stalls.
        seenSignatures.add(report.signature);

        // DECIDE — reflect on the failures to guide the next regeneration. Pair the
        // reflection with the failures it was addressing so the next reflect sees
        // both what was tried AND what it failed to fix.
        log("🧠 Code Generation Agent: reflecting on the failures…");
        reflection = await reflectOnFailures(report, history, ir);
        history.push({
            failures:  report.failures.map((f) => f.detail),
            diagnosis: reflection.diagnosis,
            fixPlan:   reflection.fixPlan,
        });
        iter++;
    }
}
