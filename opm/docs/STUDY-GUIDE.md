# How to read this codebase in a week (and explain it)

You do **not** need to read every line. ~70% of the code is supporting noise.
Read the **6 entry functions** (one per stage) and follow the data. That's it.

---

## The 30-second mental model

> Upload an OPM diagram → the system turns it into structured data → decides what
> software that data implies → writes a full-stack app → checks the app actually
> covers every element of the diagram, fixing gaps in a loop.

Five stages, run in order by one conductor:

```
diagram ──▶ 1 PARSE ──▶ OPM IR ──▶ 2 SPEC ──▶ SystemSpec ──▶ 3 SUPER-PROMPT
                                                                    │
                                                                    ▼
        TRACEABILITY + report ◀── 5 VALIDATE+REFINE ◀── 4 CODEGEN ◀┘
```

Conductor: `opm/pipeline/stages/runner.ts` → `runPipeline()`.

---

## What to IGNORE while reading (this is the key to sanity)

In every stage file, skip these on the first pass — they're plumbing, not ideas:

- The big `*_PROMPT` / `*_INSTRUCTIONS` string constants → just think *"this paragraph teaches the model the rules."* You don't memorize it.
- The `mock()` / `*Mock` functions → offline fallback when no API key. Ignore.
- Retry / timeout / backoff wrappers (`withTimeout`, `withRetry`, `MAX_PARSE_ATTEMPTS`) → robustness, not logic.
- The `llm/` folder (`gemini.ts`, `claude.ts`, `chatgpt.ts`) → just "send text to a model, get text back."
- The `schemas/` (Python) / type definitions → the *shapes* of the data; glance, don't study.

---

## How to read ANY one stage file (the recipe)

1. Find the entry function — it's named `<thing>_stageN` (e.g. `parseOpm_stage1`).
2. Read **only that function** first — it's a short list of named steps now.
3. For each step it calls, read that helper **one level deep**. Stop there.
4. Done — you understand the stage.

---

## The 6 functions to read (in this order)

| # | Read this function | In file | One-sentence job |
|---|---|---|---|
| — | `runPipeline` | `pipeline/stages/runner.ts` | The conductor: runs stages 0→6 in order, can halt at the gate. **Read this first.** |
| 1 | `parseOpm_stage1` | `pipeline/stages/stage1-parse.ts` | Send the diagram to a vision model → get back structured OPM data (the "IR"). |
| 2 | `deriveSpec_stage2` | `pipeline/stages/stage2-spec.ts` | Ask a model to turn the IR into a software spec (entities, endpoints, screens). |
| 3 | `buildSuperPrompt_stage3` | `pipeline/stages/stage3-rag.ts` | Combine IR + spec + ISO-19450 rules into one big "build-this" prompt. |
| 4 | `generateCode_stage4` | `pipeline/stages/stage4-codegen.ts` | Stage-4 entry: runs the two-agent loop (`runBuildLoop` in `agents/orchestrator.ts`) and writes the project to disk. |
| 5 | `validateGenerated_stage5` | `pipeline/stages/stage5-validate.ts` | Final coverage + QA report for the dashboard. |

That's **~6 short functions**. Everything else is detail you pull in only if asked.

---

## Follow ONE diagram through the pipeline (the fastest way to "get it")

Open these sample files — they are the **real input/output of each stage**, side by side:

- `web/public/mock-outputs/opm_model.json` → what Stage 1 produces (the IR).
- `web/public/mock-outputs/system_spec.json` → what Stage 2 produces (the spec).
- `web/public/mock-outputs/super_prompt.txt` → what Stage 3 produces.
- `web/public/mock-outputs/file_tree.json` → what Stage 4 produces.
- `web/public/mock-outputs/validation_report.json` → what Stage 5 produces.

Read them in that order and you literally watch a diagram become an app. Each
stage's input is the previous stage's output.

---

## The two agents (the part teachers ask about)

There are **two agents** wired into a loop, in `pipeline/agents/`:

- **Code Generation Agent** (`code-generation-agent.ts`) — writes code, and on
  failure reflects + regenerates. It never judges its own output.
- **Testing Agent** (`testing-agent.ts`) — independently checks the code and emits
  a structured report: required files, OPM-id coverage, and a `new Function` parse
  check that deterministically catches broken formulas (e.g. a dropped `*`).
- **Orchestrator** (`orchestrator.ts`) — the loop that drives them, perceive →
  decide → act: generate → test → reflect → regenerate, with a stopping condition
  (`decideHalt`: all tests pass / iteration budget spent / repeated-failure stall).

Keeping testing separate from generation is what stops the model "grading its own
homework." The loop is wired into the live pipeline at the `generate` stage in
`runner.ts`.

---

## A 7-day plan

- **Day 1 — concepts.** `knowledge/02_core_ontology.md` (what OPM objects/processes/links are) + skim `docs/smart-agent/smart_agent.py` (the agent loop in plain Python).
- **Day 2 — the spine.** `runner.ts` → `runPipeline`. Read it top to bottom; it names all 6 stages.
- **Day 3 — Stages 1 & 2.** `parseOpm_stage1`, then `deriveSpec_stage2`. Open the two matching sample JSONs.
- **Day 4 — Stage 3 + the build loop.** `buildSuperPrompt_stage3`, then `generateCode_stage4` (`stage4-codegen.ts`) → the two-agent loop in `pipeline/agents/` (`orchestrator.ts` → `runBuildLoop`). Open `super_prompt.txt` + `file_tree.json`.
- **Day 5 — the agents.** `testing-agent.ts` (how failure is detected) + `orchestrator.ts` (`decideHalt` stopping conditions). Open `validation_report.json`.
- **Day 6 — fidelity story.** `pipeline/opm/opm-validate.ts` (the ISO gate) + `pipeline/opm/traceability.ts` (OPM→code mapping). This is your "100% coverage / no hallucination" pitch.
- **Day 7 — rehearse.** Explain each stage out loud in one sentence (table above). If you can do that, you can defend it.

---

## One-line-per-stage script (for the presentation)

1. **Parse** — a vision LLM reads the diagram and emits structured OPM data (objects, processes, links).
2. **Spec** — an LLM "architect" decides what software that data implies (DB entities, API endpoints, screens), each traceable to an OPM id.
3. **Super-prompt (RAG)** — we retrieve the exact ISO-19450 rules for the diagram's patterns and inject them, so the generator can't invent rules.
4. **Codegen** — Claude writes the full React + FastAPI + Postgres project from that prompt.
5. **Validate + refine** — our agent scans the generated code for every OPM element and loops, prompting the model to patch any gaps, until coverage is complete.
