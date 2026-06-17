# OPM2Code — Reorganization (DONE) & Reading Map

> **Status: APPLIED & BUILD-VERIFIED.** Final layout: the repo root contains just
> **`opm/`** (the OPM core + Python backend + docs) and **`web/`** (the entire
> Next.js website, now its own project root), plus `README.md`,
> `REORG-PROPOSAL.md`, `.gitignore`, and `vercel.json`. Verified with a real
> `next build` (✓ compiled, all 18 routes), `tsc --noEmit` (0 errors), and
> `vitest` (38/38 tests pass).

## Final structure (everything web in `web/`)

```
capstone-milestone-main/
├── opm/                 ← OPM core (your focus)
│   ├── knowledge/  pipeline/  llm/  tests/  backend/  docs/
│   ├── package.json     ← OPM's own deps (the 3 AI SDKs the pipeline uses)
│   └── README.md
├── web/                 ← the WHOLE website (Next.js project root)
│   ├── app/  public/  auth/  deploy/
│   ├── package.json  tsconfig.json  next.config.js  proxy.ts  vitest.config.ts
│   └── node_modules/
├── README.md  REORG-PROPOSAL.md  .gitignore  vercel.json
```

How it holds together: `web/` is the Next.js root; `opm/` is a sibling it imports
via the `@/opm/*` path alias (mapped to `../opm/*` in `web/tsconfig.json`), with
`outputFileTracingRoot` in `next.config.js` pointing at the repo root so Next
bundles the imported OPM code. `opm/` has its own `package.json` because Node only
resolves `node_modules` upward, never into a sibling. Run web commands from
`web/`; the Python backend still deploys via `vercel.json` (`opm/backend`).

## What changed vs. this draft

- **OPM code moved into `opm/`**: `lib/pipeline`→`opm/pipeline`,
  `lib/pipeline/opm-kb`→`opm/knowledge`, `lib/llm`→`opm/llm`,
  `__tests__`→`opm/tests`. All `@/lib/...` imports rewired to `@/opm/...`.
- **Web helpers moved into `web/`**: `lib/auth`→`web/auth`,
  `lib/deploy`→`web/deploy`. `lib/` is now empty.
- **Root decluttered (second pass):** `backend/`→`opm/backend/` (with
  `vercel.json` `"root"` + `tsconfig` exclude updated), `docs/`→`opm/docs/`,
  and the loose scripts `clear-users.js` + `supabase-setup.sql`→`web/`.
- **Stayed put (would break the running site / tooling if moved):**
  - `app/` — Next.js pins the App Router to the repo root.
  - `public/mock-outputs/` — read at runtime by the pipeline as offline
    fallbacks, so the sample data stays in `public/` (not `opm/samples/`).
  - `proxy.ts` — Next.js 16 middleware, framework-detected at root.
  - Root config files (`package.json`, `package-lock.json`, `tsconfig.json`,
    `next.config.js`, `next-env.d.ts`, `vercel.json`, `vitest.config.ts`,
    `.gitignore`, `.env*` examples, `README.md`).
- **Couldn't auto-delete this session** (no shell): the now-empty `lib/` folder
  and the `tsconfig.tsbuildinfo` build cache (now git-ignored). Delete both by
  hand whenever — they're inert.
- **Verification:** a repo-wide grep confirms **zero** remaining `@/lib/...` or
  `./opm-kb` imports. The Linux sandbox couldn't boot here, so a full
  `npm run build` / `vitest` was not run — recommend running both once locally.

---

_Original proposal below (kept for reference)._

---

## 1. What this project actually is

OPM2Code takes an **Object-Process Methodology** diagram (ISO 19450) and runs it
through a multi-stage AI pipeline that ends in a generated full-stack app. The
*point* of the project is the OPM understanding + the pipeline — **not** the
website that wraps it.

The repo today mixes three things together with no clear boundary:

1. **The OPM brain** — methodology knowledge, parsing, the staged pipeline, validation. *(what you care about)*
2. **The website** — Next.js UI, auth, login/signup, deploy plumbing. *(build once, ignore)*
3. **Duplication / dead weight** — see §4.

---

## 2. The single most important thing to know before reading

There are **two separate implementations of the pipeline**, and the README is
misleading about which one runs:

| | TypeScript `lib/pipeline/` | Python `backend/` |
|---|---|---|
| Wired into the running app? | **Yes** — `runner.ts` → `app/api/generate` | No |
| README calls it... | "client-side state machine" | "source of truth" |
| Reality | **This is the live pipeline** | Parallel / earlier implementation, not invoked by the web app |

**Read the TypeScript pipeline first.** Treat the Python `backend/` as a second
reference implementation, not the truth. (Decide later whether to keep both — see §4.)

---

## 3. Proposed folder structure

The idea: one top-level `opm/` folder that holds *everything you care about*, and
one `web/` folder you can collapse and forget. Shared bits sit on their own.

```
capstone-milestone/
│
├── opm/                          ← ★ THE PROJECT. Everything OPM lives here.
│   │
│   ├── knowledge/                ← ISO 19450 methodology KB  (from lib/pipeline/opm-kb/)
│   │   ├── 01_source_priority_and_assumptions.md
│   │   ├── 02_core_ontology.md
│   │   ├── 03_structural_links.md
│   │   ├── 04_procedural_links.md
│   │   ├── 05_opl_grammar_templates.md
│   │   ├── 06_rules_schema.json
│   │   ├── 07_rag_chunks.json
│   │   ├── 08_validator_spec.md
│   │   ├── 09_validation_checklist.md
│   │   ├── 10_missing_information.md
│   │   ├── 11_codegen_agent_prompt.md
│   │   └── 12_translation_agent_operating_spec.md
│   │
│   ├── pipeline/                 ← ★ THE LIVE PIPELINE  (from lib/pipeline/)
│   │   ├── runner.ts             ← orchestrator: stages 0→6 + validation gate
│   │   ├── stage0-validate.ts
│   │   ├── stage1-parse.ts
│   │   ├── stage2-spec.ts
│   │   ├── stage3-rag.ts
│   │   ├── stage4-codegen.ts
│   │   ├── stage5-validate.ts
│   │   ├── stage6-deploy.ts
│   │   ├── opm-validate.ts       ← ISO 19450 diagram validation gate
│   │   ├── rag-retrieve.ts
│   │   ├── traceability.ts       ← OPM-element → generated-code coverage
│   │   ├── jobs.ts               ← in-memory job state
│   │   └── types.ts              ← shared types (read this early)
│   │
│   ├── llm/                      ← model clients used by the pipeline (from lib/llm/)
│   │   ├── claude.ts
│   │   ├── chatgpt.ts
│   │   └── gemini.ts
│   │
│   ├── samples/                  ← example inputs/outputs  (from public/mock-outputs + public/samples)
│   │   ├── opm_model_simple.json
│   │   ├── opm_model_complex.json
│   │   ├── system_spec.json
│   │   ├── super_prompt.txt
│   │   ├── validation_report.json
│   │   ├── file_tree.json
│   │   └── library.xml
│   │
│   ├── tests/                    ← OPM tests  (from __tests__/)
│   │   ├── opm-codegen.test.ts
│   │   ├── opm-qa.test.ts
│   │   ├── opm-rag-retrieve.test.ts
│   │   ├── opm-validate.test.ts
│   │   ├── coverage-regex.test.ts
│   │   ├── stage1-merge.test.ts
│   │   ├── traceability.test.ts
│   │   └── validate-input.test.ts
│   │
│   └── reference-python/         ← the OTHER implementation  (from backend/)
│       │   ⚠ parallel pipeline — NOT used by the running app. Keep for reference
│       │     or delete (see §4). De-duplicated: flat modules only, no core/ shims.
│       ├── opm_parser.py
│       ├── semantic_interpreter.py
│       ├── prompt_orchestrator.py
│       ├── code_generator.py
│       ├── validator.py
│       ├── chatbot.py
│       ├── opm_error_db.py
│       ├── opm_errors_db.json
│       └── api/                  ← FastAPI routers (chat, errors)
│
├── web/                          ← ✕ THE WEBSITE. Build once, never look again.
│   ├── app/                      ← Next.js UI: dashboard, login, signup, projects, components
│   ├── api-routes/               ← thin HTTP proxies into opm/pipeline (app/api/*)
│   ├── auth/                      ← from lib/auth/ (supabase, session, oauth, users)
│   ├── deploy/                   ← from lib/deploy/ (railway) + vercel.json + supabase-setup.sql
│   └── public/                   ← static web assets (the non-sample parts of public/)
│
├── docs/                         ← keep as-is (smart-agent notes, IMPLEMENTATION_REPORT.md)
│
└── config/                       ← project tooling, mostly web-related
    ├── package.json / package-lock.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── proxy.ts
    ├── clear-users.js
    └── .env.example / .env.local.example
```

> **Note on feasibility:** `app/`, `lib/`, and `public/` are names Next.js
> requires in specific places. If you ever want the site to still *run* after
> moving things, the imports and a few config paths need rewiring. Since you
> don't run the web, the simplest path is to move freely and accept the build
> breaking. Just say the word when you want me to actually do the move.

---

## 4. Duplication & dead weight to resolve

While reorganizing, these are worth a decision:

- **Two full pipelines** (TS `lib/pipeline` vs Python `backend`). The app uses
  only the TS one. Decide: keep Python as reference, or delete it.
- **`backend/` internal duplication** — top-level modules (`opm_parser.py` …)
  are duplicated by `backend/core/*.py`, which the README says are just
  re-export shims. And `opm_errors_db.json` exists twice (`backend/` and
  `backend/data/`). Collapse to one copy.
- **`public/mock-outputs/`** mixes real sample OPM data (worth keeping under
  `opm/samples/`) with a `generated-project.zip` build artifact (probably
  deletable).

---

## 5. Reading map (suggested order)

Once organized, read in this order — it follows a diagram's journey through the system:

1. **`opm/knowledge/02_core_ontology.md`** → what Objects/Processes/States *are*.
2. **`opm/knowledge/03_structural_links.md`** + **`04_procedural_links.md`** → how elements connect.
3. **`opm/pipeline/types.ts`** → the data shapes everything passes around.
4. **`opm/pipeline/runner.ts`** → the spine: read top-to-bottom, it narrates all 6 stages.
5. **Each stage in order:** `stage1-parse` → `stage2-spec` → `stage3-rag` → `stage4-codegen` → `stage5-validate`.
6. **`opm/pipeline/opm-validate.ts`** + **`knowledge/08_validator_spec.md`** → the ISO 19450 gate.
7. **`opm/pipeline/traceability.ts`** → how it proves the generated code covers the model.
8. **`opm/samples/*.json`** → see real input/output for each stage to anchor the abstractions.

---

*Proposal generated for navigation-first reorganization. No files were modified.*
