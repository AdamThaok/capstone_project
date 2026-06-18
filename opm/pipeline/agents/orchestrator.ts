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
} from "./code-generation-agent";
import type { CodeArtifact, TestReport, ReflectionNote, AgentIR } from "./types";

export type Outcome = "SUCCESS" | "EXHAUSTED" | "STALLED" | "RUNNING";

// Pure stopping-condition decision (no I/O) — the heart of the loop, unit-tested.
//   SUCCESS   : the Testing Agent reports no failures.
//   EXHAUSTED : the iteration budget is spent.
//   STALLED   : the same failures recurred (the model is stuck).
//   RUNNING   : keep going.
export function decideHalt(state: {
    passed:        boolean;
    iter:          number;
    maxIters:      number;
    signature:     string;
    lastSignature: string;
}): Outcome {
    if (state.passed) return "SUCCESS";
    if (state.iter >= state.maxIters) return "EXHAUSTED";
    if (state.signature !== "" && state.signature === state.lastSignature) return "STALLED";
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

    const ledger:  LedgerEntry[]   = [];
    const history: ReflectionNote[] = [];

    const emptyCoverage = {
        total_elements: 0, covered: 0, coverage_pct: 0, missing: [],
        objects:   { total: 0, covered: 0, missing: [] },
        processes: { total: 0, covered: 0, missing: [] },
        links:     { total: 0, covered: 0, missing: [] },
    };

    let iter = 0;
    let lastSignature = "";
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

        // HALT? — pure decision.
        const outcome = decideHalt({ passed: report.passed, iter, maxIters, signature: report.signature, lastSignature });
        if (outcome !== "RUNNING") {
            log(`🛑 Build loop halted: ${outcome} after ${iter + 1} pass(es).`);
            return { artifact, report, outcome, iterations: iter + 1, ledger };
        }

        // DECIDE — reflect on the failures to guide the next regeneration.
        lastSignature = report.signature;
        log("🧠 Code Generation Agent: reflecting on the failures…");
        reflection = await reflectOnFailures(report, history, ir);
        history.push(reflection);
        iter++;
    }
}
