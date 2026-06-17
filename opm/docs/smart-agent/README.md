# Smart Agent — architecture & requirement demonstration

**Agent purpose:** a Smart Agent that autonomously transforms an uploaded **OPM
(ISO 19450)** model into a complete, validated, deployable full-stack application.

This folder gives a single, runnable artifact for the lecturer's three required
properties, and maps each one to **both** the demo file *and* the real production
code (TypeScript pipeline under `opm/pipeline/`), so the requirements are shown to
be genuinely implemented — not only in a toy.

| File | What it is |
|---|---|
| `agent_architecture.json` | Requirement 3 — the layered architecture (Perception / Logic-Decision / Execution + Memory) in JSON, each component mapped to a real source file. |
| `smart_agent.py` | A runnable Python mirror of the agent's control logic, with `###` comments on every loop and autonomous decision. Run: `python smart_agent.py`. |

## Requirement 1 — Autonomous decision making
The agent perceives state and chooses its next action with **no human prompt**,
using `if/else`/`match` decision logic.

- **Demo:** `smart_agent.py` → `decide_next_action()` (a `match` over the lifecycle
  stage with nested `if/else`), `validate_links()` (per-link legality), and
  `qa_blocks_deploy()` (the deploy gate). All tagged `### AUTONOMOUS DECISION`.
- **Real code:**
  - `opm/pipeline/opm-validate.ts` — link-legality decisions (`E202`/`E204`, `ERR-FUNC-001`).
  - `opm/pipeline/stage5-validate.ts` → `computeQaBlocking()` — decides whether QA blocks deploy.
  - `opm/pipeline/runner.ts` — the planner: which stage runs next, halt-on-error vs. proceed.

## Requirement 2 — Continuous / iterative loops
The agent is not a run-once script; it has a continuous lifecycle loop plus inner
iterative loops.

- **Demo:** `smart_agent.py` → `run_agent()` continuous `while` loop (tagged
  `### LOOP (while)`), plus `for` loops / comprehensions in `validate_links()` and
  `qa_blocks_deploy()` (tagged `### LOOP`).
- **Real code:**
  - `opm/pipeline/stage5-validate.ts` — `while` self-refinement loop (refine until 100% coverage or `MAX_ITERS`).
  - `opm/pipeline/stage4-codegen.ts` → `generateComplete()` — `for` continuation loop until the file stream is complete.
  - `opm/pipeline/stage1-parse.ts` — retry-with-backoff `for` loop over parse attempts; processes each uploaded file.

## Requirement 3 — System architecture layers (JSON)
- **Demo:** `agent_architecture.json` defines `perception_layer`,
  `logic_decision_layer`, `execution_action_layer`, `memory_state_layer`, and the
  `control_loops`. `smart_agent.py` loads it at startup (`load_architecture()`).
- **Real code:** each JSON component carries a `maps_to` pointing at the live file
  that implements that layer (e.g. perception → `stage1-parse.ts`, logic →
  `opm-validate.ts`, execution → `stage4-codegen.ts`).

## Run it
```bash
cd opm/docs/smart-agent
python smart_agent.py
```
Expected: the agent ticks autonomously through `parse → validate → generate →
(refine…) → qa → deploy`, printing each perceive→decide→act step, and stops at a
terminal state on its own.
