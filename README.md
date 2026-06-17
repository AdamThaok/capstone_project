# OPM2Code — Capstone Milestone

> Translates **Object-Process Methodology** (ISO 19450:2015) diagrams into complete, runnable full-stack applications through a five-stage AI pipeline.

---

> **📁 Repo was reorganized.** All OPM logic now lives under `opm/` (see
> [`opm/README.md`](opm/README.md) for the layout + reading order). Web-only code
> lives in `app/` and `web/`. Full move log: [`REORG-PROPOSAL.md`](REORG-PROPOSAL.md).
> The tree below is the *original* layout and is kept for historical reference.

## Table of Contents

- [Overview](#overview)
- [Architecture — Five-Stage Pipeline](#architecture--five-stage-pipeline)
- [Project Tree](#project-tree)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Key Features](#key-features)

---

## Overview

OPM2Code reads an OPM diagram image (PNG/JPEG exported from OPCloud or any OPM tool), parses it into a canonical Intermediate Representation, derives a full Software Architecture Blueprint, enriches it with ISO 19450 rules via RAG, generates a complete React + FastAPI + PostgreSQL codebase using Claude, and validates the output against the original model — all in one automated pipeline.

---

## Architecture — Five-Stage Pipeline

```
[ OPM Diagram (PNG/JPEG) ]
         │
  Stage 1 – Parse          opm_parser.py            GPT-4o Vision → IR JSON
         │
  Stage 2 – Specify        semantic_interpreter.py  Topology + GPT-4o Architect → SystemSpec
         │
  Stage 3 – Orchestrate    prompt_orchestrator.py   Pinecone RAG + Gemini + ChatGPT → SuperPrompt
         │
  Stage 4 – Generate       code_generator.py        Claude → Full-stack project files
         │
  Stage 5 – Validate       validator.py             Coverage check + Gemini/Claude self-healing
         │
  [ Deliverables: TRACEABILITY.md · README.md · execution_log.json ]
```

**LLM assignments:**

| Task | Primary | Fallback |
|---|---|---|
| Image parsing (Stage 1) | GPT-4o Vision | — |
| Architecture spec (Stage 2) | GPT-4o | — |
| Semantic analysis (Stage 3) | Gemini 2.5 Flash | — |
| Code consolidation (Stage 3) | ChatGPT (GPT-4o) | — |
| Code generation (Stage 4) | **Claude Sonnet** | — |
| Self-healing (Stage 5) | **Gemini 2.5 Flash** | **Claude Sonnet** |
| Chatbot | **Gemini 2.5 Flash** | **Claude Sonnet** |

---

## Project Tree

```
capstone-milestone/
│
├── README.md                          ← This file
├── .env.local                         ← Next.js env vars (NEXT_PUBLIC_*)
├── next.config.ts                     ← Rewrites /api/* → backend
├── tsconfig.json
├── package.json
│
├── app/                               ← Next.js App Router
│   ├── layout.tsx
│   ├── page.tsx
│   │
│   ├── dashboard/
│   │   └── dashboard-client.tsx       ← Main UI + pipeline state machine
│   │
│   ├── components/
│   │   ├── ChatBot.tsx                ← Floating OPM assistant + error guide
│   │   └── CoverageCard.tsx           ← Coverage ring · breakdown · timeline
│   │
│   └── api/
│       ├── chat/route.ts              ← Next.js proxy → /api/opm/chat
│       └── pipeline/route.ts         ← Next.js proxy → /api/opm/pipeline
│
├── lib/
│   └── pipeline/
│       ├── types.ts                   ← Shared TS types (JobState, CoverageReport …)
│       └── runner.ts                  ← Client-side pipeline state machine
│
└── backend/                           ← FastAPI Python backend
    │
    ├── main.py                        ← App entry point — FastAPI + all routers + CORS
    ├── requirements.txt               ← Python dependencies
    ├── Dockerfile                     ← Production container image
    ├── .env                           ← 🔐 API keys (NOT committed to Git)
    │
    │── Pipeline stages (source of truth — flat modules)
    ├── opm_parser.py                  ← Stage 1 · GPT-4o Vision → OPM IR
    ├── semantic_interpreter.py        ← Stage 2 · IR → SystemSpec (topology + LLM)
    ├── prompt_orchestrator.py         ← Stage 3 · RAG + Gemini + ChatGPT → SuperPrompt
    ├── code_generator.py              ← Stage 4 · Claude → full-stack project files
    ├── validator.py                   ← Stage 5 · coverage check + self-healing
    ├── chatbot.py                     ← OPM conversational assistant (Gemini → Claude)
    ├── opm_error_db.py                ← OPM error database management (legacy path)
    │
    ├── core/                          ← Re-export shims (pipeline business logic)
    │   ├── __init__.py
    │   ├── opm_parser.py              ↪ ../opm_parser.py
    │   ├── semantic_interpreter.py    ↪ ../semantic_interpreter.py
    │   ├── prompt_orchestrator.py     ↪ ../prompt_orchestrator.py
    │   ├── code_generator.py          ↪ ../code_generator.py
    │   └── validator.py               ↪ ../validator.py
    │
    ├── api/                           ← Re-export shims (HTTP routers)
    │   ├── __init__.py
    │   ├── chat.py                    ↪ chatbot router
    │   └── errors.py                  ← OPM error DB router (reads from data/)
    │
    └── data/                          ← Static JSON databases & seed files
        ├── __init__.py
        └── opm_errors_db.json         ← 20 ISO 19450 error records (auto-updated)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router) · TypeScript · React 19 |
| **Backend** | Python 3.11 · FastAPI · Pydantic v2 |
| **LLMs** | GPT-4o · Claude Sonnet · Gemini 2.5 Flash |
| **Vector DB** | Pinecone (optional — static fallback bundled) |
| **Environment** | python-dotenv · Next.js env vars |

---

## Environment Variables

### `opm/backend/.env` *(never commit — already in .gitignore)*

```ini
# Stage 4 code generation + chatbot fallback
ANTHROPIC_API_KEY=sk-ant-...

# Chatbot PRIMARY + Stage 5 self-healing PRIMARY + Stage 3 Gemini analysis
GOOGLE_API_KEY=AIza...

# Stage 1/2/3 parsing, architecture, consolidation
OPENAI_API_KEY=sk-...

# Optional — ISO 19450 RAG vector store
PINECONE_API_KEY=
PINECONE_INDEX=iso-19450-v1
```

### `.env.local` *(root — Next.js)*

```ini
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Getting Started

> **Layout note:** the web app lives in `web/` (its own project root) and the
> OPM core lives in `opm/` (which `web/` imports from). Run web commands inside
> `web/`.

```bash
# 1. Install the web app's dependencies
cd web
npm install

# 2. Install the OPM core's dependencies (the AI SDKs the pipeline uses)
cd ../opm
npm install

# 3. Start the frontend
cd ../web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Key Features

**OPM Diagram Validation Gate** — every uploaded diagram is checked against ISO 19450 naming and structural rules before the pipeline proceeds. The user must fix all errors manually; the system never auto-corrects the diagram.

**OPM Conversational Assistant** — a floating chatbot (bottom-right) that answers OPM/ISO 19450 questions in general mode, and in error-guide mode presents each validation error with its rule reference and a concrete fix instruction. Pipeline is blocked until all errors are resolved.

**Coverage Tracking** — after Stage 5 validation, the dashboard shows what percentage of OPM elements (Objects / Processes / Links) are traceable in the generated code, with a per-type breakdown and a change timeline across refinement rounds.

**Error Database** — a self-improving JSON repository of 20+ ISO 19450 error patterns in `opm/backend/data/opm_errors_db.json`. Each detected error increments a frequency counter; new patterns are added automatically.

**Multi-Model Pipeline** — OpenAI for parsing and architecture, Gemini for semantic analysis, chatbot, and self-healing, Claude for code generation. Each stage degrades gracefully when keys are absent.

---

*OPM2Code · Capstone Project · ORT Braude College of Engineering*
