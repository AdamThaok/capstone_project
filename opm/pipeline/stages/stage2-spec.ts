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

Rules:
- Every entity must trace back to an OPM object via "source": "O<id>".
- Every endpoint must trace back to an OPM process via "source": "P<id>" (or "derived" for CRUD reads).
- Every state-change link becomes either an enum with transitions, or a dedicated endpoint.
- Every aggregation link becomes a foreign key from part → whole.
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
