// Shared types for all pipeline stages.
// Each stage reads its input, emits a structured output.
// Currently all stages return mock data; swap impls for real LLM calls later.

// ---------------------------------------------------------------------------
// Coverage types (mirror validator.py Pydantic models)
// ---------------------------------------------------------------------------

export type CoverageBreakdown = {
    total: number;
    covered: number;
    missing: string[];
};

export type CoverageReport = {
    total_elements: number;
    covered: number;
    coverage_pct: number;
    missing: string[];
    objects: CoverageBreakdown;
    processes: CoverageBreakdown;
    links: CoverageBreakdown;
};

export type CoverageSnapshot = {
    timestamp: string;
    label: string;          // "Initial scan", "After fix #1", ...
    coverage_pct: number;
    covered: number;
    total_elements: number;
};

// ---------------------------------------------------------------------------
// QA Agent (Stage 5) — independent acceptance tests + code review of the
// generated repository. Emitted as exactly 10 tests + 5 prioritized points.
// ---------------------------------------------------------------------------

export type QaAcceptanceTest = {
    objective: string;
    input:     string;
    expected:  string;
    status:    "pass" | "fail";
};

export type QaReviewPoint = {
    category:   string;   // Security | Architecture | Performance | Error Handling | Readability
    file:       string;
    context:    string;
    problem:    string;
    suggestion: string;
};

export type QaReport = {
    acceptanceTests: QaAcceptanceTest[];  // exactly 10
    codeReview:      QaReviewPoint[];      // exactly 5
    blocked:         boolean;              // failing test or critical security finding
    blockingReasons: string[];
};

export type StageId =
    | "validate_input"
    | "parse"
    | "rag"
    | "semantic"
    | "generate"
    | "validate"
    | "deploy";

export type StageStatus = "pending" | "active" | "done" | "error";

export type StageResult = {
    stage: StageId;
    status: StageStatus;
    startedAt: string;
    finishedAt?: string;
    output?: unknown;       // JSON blob viewable in UI
    error?: string;
    log?: string[];         // real-time sub-step messages shown in dashboard
};

export type JobState = {
    id: string;
    // Multi-file upload (book §4.3 Stage 1: "Hierarchical views SD, SD1,
    // SD2..."). lex models can span multiple files / zoom levels; each
    // is parsed separately and merged into one IR by stage 1.
    filenames:  string[];
    filePaths:  string[];   // absolute paths where the uploads were persisted
    // Back-compat aliases (first file) so existing code paths still work.
    filename:   string;
    filePath?:  string;
    outputDir?: string;     // absolute path of the generated project on disk
    format:     string;
    targetStack: string;
    createdAt:  string;
    stages:     StageResult[];
    done:       boolean;
    // OPM diagram validation.
    // diagramErrors   — BLOCKING violations (pipeline stopped). Currently only
    //                   ERR-FUNC-001 (zero processes).  User must re-upload.
    // diagramWarnings — Advisory style/naming issues (WARN-NAM-*, WARN-STR-001).
    //                   Pipeline continues; user should fix for best results.
    // Note: the frontend also reuses diagramErrors to surface warnings when
    // there are no blocking errors (for backwards-compat with the chatbot).
    diagramErrors?:   string[];
    diagramWarnings?: string[];
    // Cloud deployment URLs — persisted after stage 6 succeeds.
    deployedFrontendUrl?: string;
    deployedBackendUrl?:  string;
    deployedGithubUrl?:   string;
    // Owner — the user who created this job.
    userId?: string;
    // Coverage data -- populated after Stage 5 validation completes.
    coverageReport?: CoverageReport;
    // History of coverage snapshots across validation rounds (for before/after view).
    coverageHistory?: CoverageSnapshot[];
    // QA Agent report (Stage 5): 10 acceptance tests + 5 review points.
    // `blocked: true` (failing tests / security finding) disables deployment.
    qaReport?: QaReport;
};
