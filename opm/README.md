# `opm/` — the OPM core (start here)

Everything that makes this project an *OPM-to-code* system lives in this folder.
The website around it lives in `app/`, `web/`, and `public/` and is not the focus —
treat it as AI-maintained plumbing.

## Layout

```
opm/
├── knowledge/   ISO 19450 methodology KB — the source-cited OPM corpus.
│               Markdown is human/agent reference; 06_rules_schema.json +
│               07_rag_chunks.json are loaded by the code (via index.ts).
├── pipeline/    The LIVE pipeline (TypeScript):
│   ├── stages/    ★ runner.ts + stage0 … stage6 — the pipeline, in order
│   ├── opm/       OPM helpers: opm-validate, rag-retrieve, traceability
│   ├── infra/     plumbing: types.ts (shared shapes) + jobs.ts (job state)
│   └── llm/       model clients (claude / chatgpt / gemini)
├── tests/       Vitest specs for the pipeline.
└── docs/        Project docs (smart-agent architecture, proposals).
```

The pipeline that runs the generation is the TypeScript one in `opm/pipeline/`
— that's the whole engine now (the old parallel Python backend was removed).

## Reading order

1. `knowledge/02_core_ontology.md` — what Objects / Processes / States are.
2. `knowledge/03_structural_links.md` + `04_procedural_links.md` — how they connect.
3. `pipeline/infra/types.ts` — the data shapes passed between stages.
4. `pipeline/stages/runner.ts` — the spine; read top-to-bottom, it narrates all 6 stages.
5. The stages in order, all in `pipeline/stages/`: `stage1-parse` → `stage2-spec` →
   `stage3-rag` → `stage4-codegen` → `stage5-validate` (→ `stage6-deploy`, bonus).
6. `pipeline/opm/opm-validate.ts` + `knowledge/08_validator_spec.md` — the ISO gate.
7. `pipeline/opm/traceability.ts` — how it proves the generated code covers the model.
8. Sample inputs/outputs live in `../public/mock-outputs/` (kept there because the
   pipeline reads them at runtime as offline fallbacks).
