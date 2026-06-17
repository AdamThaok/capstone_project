# `opm/` internal layout — reorganization proposal

> **Status: PROPOSAL ONLY. Nothing moved yet.** Based on a full read of every
> file in `opm/` (Python backend, TypeScript pipeline, llm, knowledge, tests,
> docs). Goal: group the *core OPM logic* so it's easy to point at ("where's the
> parsing function?"), and move the supporting code (schemas, prompt strings,
> HTTP routers, types, job-state, transport) out of the way — organized, not
> dumped.

---

## 1. What the survey found

**Two implementations of the same 5 stages:**
- `opm/pipeline/` — **TypeScript, the one that actually runs** (wired into the web app).
- `opm/backend/` — **Python (FastAPI), the parallel service** that also powers the chatbot + error DB.

**Every stage file mixes 5 unrelated things.** Example — `opm/backend/opm_parser.py` (466 lines): the real parsing function `analyze_opm_image` is lines 299–411, but it's surrounded by schemas (46–180), a 75-line prompt constant (187–261), client init (271–296), and a FastAPI router (418–466). The same shape repeats in every stage, Python and TS:

```
[data schemas] → [big prompt strings] → [LLM client init] → [★ CORE function] → [HTTP router]
```

The core function is usually 15–25% of the file; the rest is boilerplate.

**Python `core/` and `api/` are an abandoned half-done version of this exact split:**
- `core/semantic_interpreter.py`, `core/prompt_orchestrator.py`, `core/code_generator.py`, `core/validator.py` → **thin re-export shims** (`from X import ...`). Dead weight.
- `core/opm_parser.py` → a **real full copy** of the parser (duplicated with the root one).
- `api/chat.py` → a 1-line shim onto `chatbot.py`.
- `api/errors.py` → **a full duplicate** of `opm_error_db.py` (drift hazard; only the DB path differs).

**Other cruft worth fixing while we reorganize:**
- `_safe_json_loads` (tolerant JSON parser) is copy-pasted in Python stages 3, 4, 5.
- Every Python stage re-implements the same `_get_client()` / `_is_configured()` pattern.
- In TypeScript, the canonical IR type is redefined 4× (`stage1-parse`, `opm-validate`, `rag-retrieve`, `traceability`).
- `validator.py`'s docstring promises a `run_stage5` + `/api/opm/validate` router that don't appear in the file — a doc/code mismatch to verify.

---

## 2. The organizing principle

One rule, applied to both implementations:

> **`stages/` (+ `opm/` helpers) = the code you read. Everything else lives in a
> clearly-named support folder.** Supporting files stay first-class — they're
> just grouped by *kind* (schemas, prompts, routers, transport, runtime) instead
> of being inlined into every stage.

---

## 3. Proposed layout

```
opm/
├── README.md                       ← top-level guide + read order
│
├── pipeline/                       ← ★ THE LIVE PIPELINE (TypeScript)
│   ├── stages/                     ← ★ read these — the OPM logic, in order
│   │   ├── runner.ts                   orchestrator + ISO validation gate
│   │   ├── stage1-parse.ts             IR extraction + multi-file merge
│   │   ├── stage2-spec.ts              IR → system spec
│   │   ├── stage3-rag.ts               RAG + super-prompt
│   │   ├── stage4-codegen.ts           code generation
│   │   └── stage5-validate.ts          coverage + QA + refine loop
│   ├── opm/                        ← ★ OPM-specific helpers
│   │   ├── opm-validate.ts              ISO 19450 legality rules
│   │   ├── rag-retrieve.ts              knowledge-base retrieval
│   │   └── traceability.ts              coverage / traceability report
│   ├── runtime/                    ← supporting infra (still important)
│   │   ├── types.ts                     shared contracts
│   │   ├── jobs.ts                      job-state persistence
│   │   ├── stage0-validate.ts           input guardrail
│   │   └── stage6-deploy.ts             bonus deploy glue
│   └── llm/                        ← model transport (was opm/llm/)
│       ├── gemini.ts  claude.ts  chatgpt.ts
│
├── backend/                        ← PARALLEL PYTHON SERVICE (FastAPI)
│   ├── core/                       ← ★ the stage functions (pure logic)
│   │   ├── parser.py                    analyze_opm_image
│   │   ├── semantic.py                  analyze_graph_topology, generate_system_specification
│   │   ├── orchestrator.py              orchestrate, retrieve_iso_rules
│   │   ├── codegen.py                   generate_code_from_prompt
│   │   ├── validator.py                 check_coverage, validate_codebase
│   │   └── pipeline.py                  run_pipeline + _merge_irs  (extracted from main.py)
│   ├── assistant/                  ← non-pipeline features
│   │   ├── chatbot.py                   chat()
│   │   └── error_db.py                  validate_opm_model, record_error  (ONE copy)
│   ├── api/                        ← FastAPI routers ONLY (thin wrappers → core/)
│   │   ├── parse.py spec.py rag.py generate.py validate.py pipeline.py chat.py errors.py
│   ├── main.py                     ← app init only (~40 lines: app, CORS, include routers, health)
│   ├── data/                       ← opm_errors_db.json  (single source of truth)
│   └── requirements.txt
│
├── knowledge/                      ← ISO 19450 KB (already clean data — leave as-is)
├── tests/                          ← leave as-is (optionally split ts/ + py/ later)
└── docs/                           ← smart-agent design docs (this file lives here)
```

Result: to answer "show me the X function," you open `pipeline/stages/` or
`backend/core/` and it's one short file per stage — no schemas/prompts/routers in
the way.

---

## 4. Cleanup folded into the move (the abandoned refactor, finished)

- **Delete** the 4 `core/*.py` re-export shims and `api/chat.py` shim.
- **Merge** the duplicated parser (root `opm_parser.py` + `core/opm_parser.py`) into one `backend/core/parser.py`.
- **Merge** `api/errors.py` and `opm_error_db.py` into one `backend/assistant/error_db.py` with a single DB path (`data/opm_errors_db.json`).
- **(Optional)** extract the copy-pasted `_safe_json_loads` and the `_get_client()` pattern into `backend/core/_shared.py`; consolidate the 4 TS IR-type redefinitions into `pipeline/runtime/types.ts`.

---

## 5. Suggested phasing (so it stays safe + runnable)

**Phase 1 — group whole files into the folders above (no file-internal surgery).**
Lower risk. Touches only import paths. After it, `pipeline/stages/` and
`backend/core/` already give you the "read this / ignore that" separation.

- TS cost: update `@/opm/pipeline/*` imports in `web/` + tests (~20 sites) and the
  relative imports between stages. **Verifiable with `npm run build` + `vitest`.**
- Python cost: update `main.py` + router imports; update `vercel.json`
  (`opm/backend`) only if the top folder name changes (it doesn't here).
  **Verifiable with `python -m py_compile` (full run needs the pip deps).**

**Phase 2 — split each stage file internally (the deeper win).**
Pull each stage's schemas → `schemas/`, big prompt strings → `prompts/`, and HTTP
handler → `api/`, leaving each `core/*.py` / `stages/*.ts` as just its function(s).
This is what makes "point to the parsing function" trivial, but it's bigger and
riskier — do it one stage at a time, building after each.

---

## 6. Open decisions for you

1. **Both implementations, or retire Python?** The TS pipeline is the one that
   runs; Python is parallel (only the chatbot + error DB are uniquely live). If
   you don't need the Python pipeline, deleting `backend/core` (keeping only
   `assistant/`) would massively shrink the surface.
2. **Phase 1 only, or push through Phase 2?**
3. **Keep folder names `pipeline/` + `backend/`** (less churn) **or rename to
   `ts-pipeline/` + `py-backend/`** (clearer that they're parallel)?

*Nothing has been changed. Tell me which phase + decisions, and I'll execute it
with a build check after each step.*
