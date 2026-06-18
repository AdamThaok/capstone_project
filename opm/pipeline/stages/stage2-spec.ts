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

Entity vs. field (avoid a table per number):
- A scalar/parameter object (a single number, weight, length, percentile, severity,
  caloric value, etc.) becomes a typed FIELD of the entity that aggregates or exhibits
  it — NOT its own table.
- Create a standalone entity only for an object that aggregates other objects (a "whole")
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
