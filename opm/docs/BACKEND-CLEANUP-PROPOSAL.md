# Backend cleanup proposal — `opm/backend/`

> **Status: PROPOSAL. Nothing changed yet.** Goal: make the Python backend
> readable and *traceable* — so "show me the function that does X" is always
> "open `stages/X.py`, top function," with schemas, prompt strings, and HTTP
> routers moved out of the way (still present, just grouped by kind).

---

## 1. Why it's unreadable today

Every stage file crams **five unrelated concerns into one module**, in this order:

```
[pydantic schemas] → [big prompt strings] → [LLM client init] → ★ CORE function → [FastAPI router]
```

The actual logic is a small slice buried in the middle. Measured from the survey:

| File | Lines | The core function (what you want) | Buried under |
|---|---|---|---|
| `opm_parser.py` | 466 | `analyze_opm_image` (299–411) | 135 lines of schemas + 75-line prompt + router |
| `semantic_interpreter.py` | 966 | topology algos (401–622) + `generate_system_specification` (833–912) | **325 lines of schemas** + 120-line prompt |
| `prompt_orchestrator.py` | 1261 | `retrieve_iso_rules`, `orchestrate`, `build_super_prompt` | **232-line embedded rule library** + 4 prompt constants |
| `code_generator.py` | 303 | `generate_code_from_prompt` (167–269) | schemas + a copy-pasted JSON helper |
| `validator.py` | 1066 | `check_coverage` (355–409), `validate_codebase` (694–774) | schemas + **285 lines of doc-generators** |

Plus structural cruft the survey found:

- **`core/` is mostly dead** — `core/semantic_interpreter.py`, `…prompt_orchestrator.py`, `…code_generator.py`, `…validator.py` are 1-line re-export shims. But `core/opm_parser.py` is a **real second copy** of the parser.
- **`api/errors.py` is a full duplicate** of `opm_error_db.py` (only the DB path differs) — a drift hazard, not a shim. `api/chat.py` is a 1-line shim.
- **Copy-paste:** `_safe_json_loads` is duplicated in stages 3, 4, 5; every file re-implements the same `_get_client()` / `_is_configured()` pattern.
- **Doc/code mismatch:** `validator.py`'s docstring promises `run_stage5` + a `/api/opm/validate` router that don't exist in the file.

---

## 2. The clean layout (group by concern)

One rule: **`stages/` holds the logic you read; every other concern gets its own
folder.** Open `stages/`, see all five cores side by side.

```
opm/backend/
├── main.py              ← app init ONLY (~40 lines: create app, CORS, include routers, health)
│
├── stages/              ← ★ THE LOGIC — one short file per stage, the function on top
│   ├── parse.py             analyze_opm_image                         (Stage 1)
│   ├── spec.py              analyze_graph_topology, generate_system_specification (Stage 2)
│   ├── orchestrate.py       retrieve_iso_rules, build_super_prompt, orchestrate    (Stage 3)
│   ├── codegen.py           generate_code_from_prompt                 (Stage 4)
│   ├── validate.py          check_coverage, validate_codebase, refine (Stage 5)
│   └── pipeline.py          run_pipeline + _merge_irs   (the end-to-end glue, from main.py)
│
├── schemas/             ← all pydantic models (data shapes), out of the logic files
│   ├── opm_ir.py            OpmModel + Opm*  — the canonical IR, ONE definition
│   ├── spec.py              SystemSpec + sub-models
│   ├── codegen.py  validation.py  chat.py  errors.py
│
├── prompts/             ← the big LLM prompt strings + embedded rule data
│   ├── parse.py            architect.py  orchestrator.py
│   ├── iso_rule_library.py  ← the 232-line static rules from Stage 3
│   ├── codegen.py  refinement.py
│
├── api/                 ← FastAPI routers ONLY (thin wrappers that call stages/)
│   ├── parse.py spec.py rag.py generate.py validate.py pipeline.py chat.py errors.py
│
├── assistant/           ← non-pipeline features
│   ├── chatbot.py           chat()
│   └── error_db.py          validate_opm_model, record_error   (ONE copy, not two)
│
├── shared/              ← cross-cutting utilities (kills the duplication)
│   ├── llm_clients.py       one get_client()/is_configured() per provider
│   └── json_utils.py        safe_json_loads (was copy-pasted ×3)
│
├── data/                ← opm_errors_db.json  (single source of truth)
└── requirements.txt
```

**Tracing payoff** — every stage becomes a one-line lookup:

| Teacher asks… | Answer |
|---|---|
| "the parsing function?" | `stages/parse.py` → `analyze_opm_image` |
| "the spec/topology logic?" | `stages/spec.py` |
| "the RAG / super-prompt builder?" | `stages/orchestrate.py` |
| "the code generator?" | `stages/codegen.py` |
| "the coverage / validation?" | `stages/validate.py` |
| "where it all chains together?" | `stages/pipeline.py` → `run_pipeline` |

---

## 3. Example: what happens to `opm_parser.py` (466 → 4 small files)

| New file | Content | ~lines |
|---|---|---|
| `stages/parse.py` | `analyze_opm_image` + `OpmParseError` (the real logic) | ~120 |
| `schemas/opm_ir.py` | `OpmModel` + all `Opm*` models (the IR contract) | ~135 |
| `prompts/parse.py` | `SYSTEM_PROMPT` + `USER_INSTRUCTION` | ~75 |
| `api/parse.py` | `router` + `parse_endpoint` (upload/size/MIME handling) | ~50 |

Same surgery for each stage. `stages/parse.py` ends up importing its schema from
`schemas/opm_ir.py`, its prompt from `prompts/parse.py`, and its client from
`shared/llm_clients.py` — so the logic file is *just the algorithm*.

---

## 4. Cleanup folded in (finish the abandoned `core/`/`api/` refactor)

- Delete the 4 `core/*.py` shims and `api/chat.py` shim.
- Merge the duplicate parser (`opm_parser.py` + `core/opm_parser.py`) → one `stages/parse.py`.
- Merge `api/errors.py` + `opm_error_db.py` → one `assistant/error_db.py`, one DB path.
- Extract `_safe_json_loads` → `shared/json_utils.py`; extract client init → `shared/llm_clients.py`.
- Fix the `validator.py` `run_stage5` / router doc-mismatch while splitting it.

---

## 5. Phasing + verification

**Phase 1 — group the *whole* files into the folders above** (move + fix imports; no
file-internal surgery yet). Low risk, immediate readability. `stages/` already
gives the "read this / ignore that" separation.

**Phase 2 — split each stage file internally** (schemas → `schemas/`, prompts →
`prompts/`, router → `api/`), one stage at a time. This is what makes tracing
trivial; bigger, so done incrementally.

**Verification (real, not guessed):** I can `pip install -r requirements.txt` in
`opm/backend`, then after each step run `python -c "import main"` (and the
existing flow) to confirm the app still imports and wires every router — the
Python equivalent of the `next build` check we used for the TypeScript side.

---

## 6. Decision for you

- **Phase 1 only** (group files — fast, low risk), or **push through Phase 2**
  (full per-stage split — the real tracing win)?
- **By concern** (`stages/`, `schemas/`, `prompts/`, `api/` — as above, all logic
  side by side) or **by stage** (one folder per stage holding its
  logic+schema+prompt+router)? The layout above is *by concern*, which best
  matches "important files grouped together."

Say the word and I'll execute, verifying the app still boots after each step.
