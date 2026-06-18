// Shared types for the two-agent build loop (Code Generation Agent + Testing
// Agent, driven by the Orchestrator). Mirrors the Agents-as-Loops spec:
//   generate -> test -> reflect -> regenerate, until a stopping condition.

import type { CoverageReport, QaAcceptanceTest, QaReviewPoint } from "../infra/types";

// One generated file.
export type FileSpec = { path: string; content: string };

// The candidate solution the Code Generation Agent produces.
export type CodeArtifact = FileSpec[];

// A single concrete defect found by the Testing Agent. `detail` is written to
// be actionable, because it is fed verbatim into the reflection step.
export type Failure = {
    kind:   "missing_file" | "empty_file" | "uncovered_id" | "invalid_formula" | "python_syntax" | "acceptance_test" | "build_error";
    id:     string;   // the thing that failed: a filename, an OPM id (O*/P*), or a test objective
    detail: string;   // human-readable, actionable description
};

// The Testing Agent's structured verdict (never prose — the loop reasons over fields).
export type TestReport = {
    passed:          boolean;
    failures:        Failure[];
    signature:       string;             // stable key of the failure set, for stall detection
    coverage:        CoverageReport;     // OPM-id coverage (also shown on the dashboard)
    acceptanceTests: QaAcceptanceTest[]; // LLM-judged behaviour tests (Tier 4)
    codeReview:      QaReviewPoint[];    // LLM code-review points (advisory)
};

// The Code Generation Agent's diagnosis before it rewrites code.
export type ReflectionNote = { diagnosis: string; fixPlan: string };

// Minimal view of the OPM IR the agents need.
export type AgentIR = {
    objects?:   { id: string; name?: string }[];
    processes?: { id: string; name?: string; computation?: string | null }[];
};
