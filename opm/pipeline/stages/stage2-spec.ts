// Stage 2: Semantic Interpretation & System Specification.
//
// Gemini analyzes the OPM IR and derives a full-stack system specification
// (entities, API, screens, business rules), each traceable to an OPM id.
// If Gemini is not configured we fall back to the bundled mock.

import fs from "node:fs/promises";
import path from "node:path";
import { askJson as geminiAskJson, isGeminiConfigured } from "@/opm/pipeline/llm/gemini";

const SPEC_PROMPT = `
You are a software architect. Convert the attached OPM Intermediate Representation
into a concrete full-stack system specification.

Emit JSON exactly in this shape:

{
  "metadata": { "derivedFrom": "opm_model.json", "inferenceEngine": "Gemini" },
  "domainModel": {
    "entities": [
      {
        "name": "Customer",
        "source": "O1",
        "persistence": "postgres",
        "fields": [
          { "name": "id", "type": "string", "primary": true },
          { "name": "status", "type": "enum", "values": ["A","B"], "default": "A" }
        ]
      }
    ]
  },
  "api": {
    "framework": "FastAPI",
    "endpoints": [
      { "method": "POST", "path": "/orders", "source": "P1", "op": "create" },
      { "method": "POST", "path": "/orders/:id/pay", "source": "P3", "op": "transition", "transition": "Pending->Paid" }
    ]
  },
  "frontend": {
    "framework": "React",
    "screens": [
      { "name": "OrderList", "route": "/", "reads": ["Order"] }
    ]
  },
  "businessRules": [
    { "id": "BR1", "source": "L5", "rule": "Pending->Paid only via P3" }
  ]
}

COVERAGE IS MANDATORY — this is a fidelity tool, you may NOT summarize, sample, or omit:
- EVERY process (P1..Pn) in the IR MUST become an endpoint. N processes -> N endpoints.
- EVERY object (O1..On) MUST appear, either as an entity OR as a typed field of an entity.
- SELF-CHECK before answering: confirm every O-id and every P-id from the input appears
  in some "source". If any is missing, add it. Do not return until coverage is complete.
- ENUMERABILITY / REFERENCE LISTABILITY: every entity whose id is consumed by another
  endpoint (any *_id request field, INCLUDING process/transition endpoints) OR selected in
  any screen MUST expose a GLOBAL list endpoint { "method":"GET", "path":"/<plural>",
  "source":"derived", "op":"list" } returning the full collection — a parent-scoped or
  single-object read does NOT satisfy this. Add that entity to the "reads" array of every
  screen that selects it.
- REFERENCE-COMPLETENESS: for every entity referenced/selected by any endpoint body or
  screen, also emit (a) a create endpoint { "method":"POST", "path":"/<plural>",
  "op":"create", "source":"derived" } and (b) a create screen { "name":"<E>Create",
  "route":"/<plural>/new", "writes":["<E>"] }. A selection dropdown is INVALID unless its
  target entity has BOTH a list and a create endpoint. This is the one allowed exception to
  "no features beyond the model" — populating selectable entities is required for the modeled
  processes to be usable. Scope it to referenced entities only (objects a process YIELDS —
  resultees — get reads only, no create).
- SELECTION SOURCE INTEGRITY: (1) do not double-model an OPM part-object — if an aggregation
  part (e.g. Fetal Growth Indication) is represented as an enum/state value of its whole, NO
  screen may also expose it as a separate selectable foreign-key field; pick ONE representation.
  (2) every required select's option source MUST be a global list endpoint guaranteed non-empty
  for the modeled domain (e.g. GET /diagnoses or GET /diagnoses?type=<state>), NEVER a
  parent-scoped subset filtered client-side by a sub-type that may be absent for that parent.
- Extend the SELF-CHECK: confirm every required select's option source is a global list
  endpoint (never a parent-scoped filtered subset), and every reference target has both a list
  and a create endpoint.

Entity vs. field (avoid a table per number — but do NOT over-collapse):
- An object that plays a ROLE in any process — an AGENT (handles a process), an INSTRUMENT
  (required by a process), a CONSUMEE/input, or a RESULTEE (yielded by a process) — OR that is
  referenced by another object (an aggregation whole, or any FK target) MUST be a standalone
  entity, NEVER a field. (For FTT: Child, Father, Mother, Therapist Group, Diagnosis, Treatment
  Protocol, Implication Set, Perinatal/Postnatal Parameter Set, etc. are all standalone entities.)
- ONLY a pure scalar parameter with NO process role and NO references (a lone number/weight/
  length/percentile/severity/caloric value) becomes a typed FIELD of the entity that exhibits it.
- Do NOT merge multiple distinct named objects into one generic "Measurement"/"Parameter" entity.
- Create a standalone entity for an object that aggregates other objects (a "whole")
  or that has its own states / lifecycle.
- Every aggregation link (whole -> part) becomes a foreign key (or nested field) from part
  to whole.

Tracing & rules:
- Every entity: "source": "O<id>". Every endpoint: "source": "P<id>" (or "derived" for CRUD reads).
- Every state-change link becomes either an enum with transitions, or a dedicated endpoint.
- For a process with a "computation" field, create a compute endpoint; the code stage
  implements the formula verbatim from the IR, so just reference it here.
- No features beyond what the OPM model contains.
`.trim();

async function deriveWithGemini(opm: unknown): Promise<unknown> {
    return await geminiAskJson(
        `${SPEC_PROMPT}\n\nOPM IR:\n${JSON.stringify(opm, null, 2)}`,
    );
}

async function deriveMock(): Promise<unknown> {
    const mockPath = path.join(process.cwd(), "public", "mock-outputs", "system_spec.json");
    const raw = await fs.readFile(mockPath, "utf-8");
    return JSON.parse(raw);
}

export async function deriveSpec_stage2(opmModel: unknown) {

    if (!isGeminiConfigured()) { //Testing path with no keys
        return deriveMock();
    }
    try {
        return await deriveWithGemini(opmModel); // real run
    } catch (e) {
        console.error("[stage2] Gemini draft failed, using mock:", (e as Error).message);
        return deriveMock();
    }
}
