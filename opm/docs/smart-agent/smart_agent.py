#!/usr/bin/env python3
"""
OPM-to-Code Smart Agent — reference implementation of the agent's control logic.

This is a single, runnable Python mirror of the production pipeline
(opm/pipeline/*.ts) so the three architectural requirements are easy to point to:

  1. AUTONOMOUS DECISION MAKING  -> every line tagged ### AUTONOMOUS DECISION
  2. CONTINUOUS / ITERATIVE LOOPS -> every line tagged ### LOOP
  3. LAYERED ARCHITECTURE (JSON)  -> loaded from agent_architecture.json
                                     (Perception / Logic-Decision / Execution layers)

The agent: autonomously turns an uploaded OPM (ISO 19450) model into a complete,
validated, deployable full-stack app. It PERCEIVES the model/job state, DECIDES
the next action on its own (if/else/match), and ACTS — looping over a job
lifecycle plus an inner self-refinement loop, with NO human prompts in between.

Run:  python smart_agent.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_REFINE_ITERS = 2  # cap on the self-refinement loop (mirrors stage5 MAX_ITERS)


# ──────────────────────────────────────────────────────────────────────────────
# REQUIREMENT 3 — the layered architecture is DEFINED IN JSON and loaded here.
# ──────────────────────────────────────────────────────────────────────────────
def load_architecture() -> dict:
    with open(os.path.join(HERE, "agent_architecture.json"), encoding="utf-8") as fh:
        return json.load(fh)


# ──────────────────────────────────────────────────────────────────────────────
# PERCEPTION LAYER — sense the environment / current state.
# ──────────────────────────────────────────────────────────────────────────────
def perceive(world: dict) -> dict:
    return {
        "stage":        world["stage"],
        "model_valid":  world["model"].get("valid", False),
        "coverage":     world["coverage"],
        "iteration":    world["iteration"],
        "deploy_ready": world["deploy_ready"],
    }


# ──────────────────────────────────────────────────────────────────────────────
# LOGIC / DECISION LAYER — evaluate state and choose actions autonomously.
# ──────────────────────────────────────────────────────────────────────────────
def validate_links(model: dict) -> list:
    """Check OPM link legality (ISO 19450) — iterate every link and judge it."""
    problems = []
    for link in model["links"]:                                              ### LOOP (for): process each environmental data item (one OPM link)
        src, dst = model["kinds"].get(link["from"]), model["kinds"].get(link["to"])
        if link["family"] == "procedural" and src == dst:                    ### AUTONOMOUS DECISION (if): procedural link must join object<->process
            problems.append(f"E202 illegal procedural {link['from']}->{link['to']}")
        elif (link["family"] == "structural"                                 ### AUTONOMOUS DECISION (elif): structural like-kind, except exhibition
              and src != dst and link["type"] != "exhibition"):
            problems.append(f"E204 illegal structural {link['from']}->{link['to']}")
    return problems


def qa_blocks_deploy(qa: dict) -> bool:
    """QA gate: autonomously decide whether findings must block deployment."""
    failing  = [t for t in qa["tests"]  if t["status"] == "fail"]            ### LOOP (comprehension): evaluate every acceptance test
    security = [r for r in qa["review"] if r["category"].lower() == "security"]  ### LOOP (comprehension): evaluate every review point
    return len(failing) > 0 or len(security) > 0                             ### AUTONOMOUS DECISION: block on a failing test OR a security finding


def decide_next_action(p: dict) -> str:
    """
    Core autonomous planner. Given ONLY the perceived state, pick the next action
    with no human input. Uses match + nested if/else (complex decision logic).
    """
    match p["stage"]:                                                        ### AUTONOMOUS DECISION (match): branch on the perceived lifecycle stage
        case "new":
            return "parse"
        case "parsed":
            return "validate"
        case "validated":
            return "generate" if p["model_valid"] else "halt"                ### AUTONOMOUS DECISION (if/else): halt an illegal model, else generate
        case "generated":
            if p["coverage"] < 100 and p["iteration"] < MAX_REFINE_ITERS:    ### AUTONOMOUS DECISION (if): not fully covered yet -> self-refine again
                return "refine"
            return "qa"
        case "qa_done":
            return "deploy" if p["deploy_ready"] else "block"                ### AUTONOMOUS DECISION (if/else): QA gate -> deploy or block
        case _:
            return "stop"


# ──────────────────────────────────────────────────────────────────────────────
# EXECUTION / ACTION LAYER — effect the chosen action on the world.
# ──────────────────────────────────────────────────────────────────────────────
def act(action: str, world: dict) -> None:
    match action:                                                            ### AUTONOMOUS DECISION (match): dispatch the chosen action
        case "parse":
            world["model"] = parse_model()
            world["stage"] = "parsed"
        case "validate":
            warnings = validate_links(world["model"])
            world["model"]["valid"] = world["model"]["has_process"]          # only a process-less model is BLOCKING (ERR-FUNC-001)
            world["model"]["warnings"] = warnings
            world["stage"] = "validated"
        case "generate":
            world["coverage"] = generate_code(world["model"])
            world["stage"] = "generated"
        case "refine":
            world["iteration"] += 1
            world["coverage"] = min(100, world["coverage"] + 20)
            world["stage"] = "generated"                                     # re-enter the decision point after refining
        case "qa":
            world["qa"] = run_qa(world["model"])
            world["deploy_ready"] = not qa_blocks_deploy(world["qa"])
            world["stage"] = "qa_done"
        case "deploy":
            world["stage"] = "deployed"
        case "block":
            world["stage"] = "blocked"
        case _:
            world["stage"] = "stopped"


# ── Simulated sub-systems (stand-ins for the real LLM-backed stages) ──────────
def parse_model() -> dict:
    # An OPM fragment from the FTT (Failure-To-Thrive) model used in the project.
    return {
        "links": [
            {"from": "Child",     "to": "Diagnosing",          "family": "procedural", "type": "agent"},
            {"from": "Diagnosis", "to": "Treatment Protocol",  "family": "structural", "type": "aggregation"},
        ],
        "kinds": {"Child": "object", "Diagnosing": "process",
                  "Diagnosis": "object", "Treatment Protocol": "object"},
        "has_process": True, "valid": False, "warnings": [],
    }

def generate_code(_model: dict) -> int:
    return random.choice([80, 100])  # coverage %; 80 deliberately triggers the refine loop

def run_qa(_model: dict) -> dict:
    return {
        "tests":  [{"objective": "create entity",     "status": "pass"},
                   {"objective": "process endpoint",  "status": "pass"}],
        "review": [{"category": "Performance", "problem": "N+1 query"}],  # advisory only -> not blocking
    }


# ──────────────────────────────────────────────────────────────────────────────
# AGENT LIFECYCLE — Requirement 1 (autonomous) + Requirement 2 (continuous loop)
# ──────────────────────────────────────────────────────────────────────────────
def run_agent(max_ticks: int = 50) -> str:
    arch = load_architecture()                                               # REQUIREMENT 3: layered architecture loaded from JSON
    print(f"[agent] {arch['system']['name']}")
    print(f"[agent] layers: {', '.join(arch['layers'].keys())}\n")

    world = {"stage": "new", "model": {}, "coverage": 0,
             "qa": {}, "iteration": 0, "deploy_ready": False}
    TERMINAL = {"deployed", "blocked", "stopped"}

    tick = 0
    while world["stage"] not in TERMINAL and tick < max_ticks:               ### LOOP (while): continuous agent lifecycle — runs until a terminal state
        tick += 1
        perception = perceive(world)                                         # PERCEPTION layer
        action = decide_next_action(perception)                              ### AUTONOMOUS DECISION: choose the next action with NO human prompt
        print(f"[tick {tick:02d}] perceive(stage={perception['stage']:<10} "
              f"cov={perception['coverage']:>3}% iter={perception['iteration']}) "
              f"-> decide '{action}'")
        act(action, world)                                                   # EXECUTION layer

    print(f"\n[agent] reached terminal state '{world['stage']}' "
          f"after {tick} autonomous ticks "
          f"(coverage {world['coverage']}%, refinements {world['iteration']}).")
    return world["stage"]


if __name__ == "__main__":
    run_agent()
