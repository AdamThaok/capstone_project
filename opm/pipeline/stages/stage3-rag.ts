// Stage 3: Syntax-Aware RAG + Multi-Model Reasoning.
//
// Real RAG: for THIS model, retrieve the relevant chunks from the vendored OPM
// knowledge base (knowledge/07_rag_chunks.json, in-memory) plus the element/link
// rules schema, and ask Gemini to fold them — with a canonical OPL
// reconstruction — into a precise, ISO-grounded code-gen super prompt.
// Fallback: bundled mock super_prompt.txt.

import fs from "node:fs/promises";
import path from "node:path";
import { askText, isGeminiConfigured } from "@/opm/pipeline/llm/gemini";
import { retrieveChunks, formatChunksForPrompt, type OpmIR } from "../opm/rag-retrieve";
import { RULES_SCHEMA } from "../../knowledge";

// One OPM element as a line: "- object: <definition> (<citation>)".
function formatElement(name: string, el: { definition: string; source_reference: string }): string {
    return `- ${name}: ${el.definition} (${el.source_reference})`;
}

// One validation rule as a line: "- VR-01 [error]: <description>".
function formatRule(rule: { rule_id: string; severity: string; description: string }): string {
    return `- ${rule.rule_id} [${rule.severity}]: ${rule.description}`;
}

// Compact rendering of element legality + VR rules from knowledge/06_rules_schema.json.
function rulesSchemaSummary(): string {
    const elementLines: string[] = [];
    for (const [name, el] of Object.entries(RULES_SCHEMA.opm_elements)) {
        elementLines.push(formatElement(name, el));
    }

    const ruleLines: string[] = [];
    for (const rule of RULES_SCHEMA.validation_rules) {
        ruleLines.push(formatRule(rule));
    }

    return [
        "OPM ELEMENTS (ISO 19450 > Dori):",
        elementLines.join("\n"),
        "",
        "VALIDATION RULES:",
        ruleLines.join("\n"),
    ].join("\n");
}

const PROMPT = `
You are a prompt composer that turns an OPM model into a faithful code-gen brief.

Given:
1. The OPM IR (objects, processes, links, states).
2. The derived system specification (entities, endpoints, screens, rules).
3. The OPM rules schema (element legality + validation rules VR-01..VR-20).
4. The retrieved OPM knowledge-base chunks (authoritative semantics, each with an
   ISO 19450 / Dori citation). These are the source of truth for OPM meaning —
   never substitute UML/BPMN/ERD intuition.

FIRST, reconstruct the canonical OPL paragraph for the model using ONLY standard
OPL sentence patterns, e.g.:
- consumption: "<Process> consumes <Object>."
- result:      "<Process> yields <Object>."
- effect:      "<Process> changes <Object> from <state1> to <state2>."
- condition:   "<Process> occurs if <Object> is <state>."
- instrument:  "<Process> requires <Object>."
- agent:       "<Object> handles <Process>."
- aggregation: "<Whole> consists of <Part1> and <Part2>."
- generalization: "<Special> is a <General>."
Treat this OPL paragraph as the authoritative intermediate representation: every
generated artifact must trace to one or more OPL sentences (VR-12).

Then produce a single consolidated "super prompt" that a code generator can follow
to emit a complete, compilable, ZERO-CONFIG full-stack project matching the model.

Target stack: React + Vite (frontend), FastAPI + Python + SQLAlchemy (backend),
PostgreSQL (database), deployed to Railway (cloud host).

ZERO-CONFIG CLOUD DEPLOY REQUIREMENTS (HARD):
- The project is auto-deployed to Railway. The end user NEVER runs Docker, NEVER
  installs anything. They click a live URL and use the app.
- Backend MUST use SQLAlchemy + asyncpg + PostgreSQL. NO Firebase, NO Firestore,
  NO firebase-admin, NO firestore.rules, NO external emulator anywhere.
- Backend reads DATABASE_URL from env (Railway injects it when a Postgres plugin
  is attached). If it starts with "postgres://", rewrite to "postgresql+asyncpg://"
  at startup.
- Backend MUST create its schema on startup with SQLAlchemy metadata.create_all
  (or Alembic) BEFORE serving requests. Do NOT depend on any external
  "wait-for-*" shell script; rely on restart/retry or a DB healthcheck.
- Backend MUST run a seed routine that inserts 3–5 sample rows per table derived
  from OPM object names/states. Idempotent.
- Frontend uses axios to call the backend via VITE_API_BASE_URL (Railway sets it
  to the backend's public URL at build time).
- Emit a Dockerfile for BOTH services (Railway builds from Dockerfile) using a
  CURRENT base image (e.g. python:3.11-slim, node:20-alpine — never an EOL tag).
- Emit docker-compose.yml for local dev (postgres + backend + frontend); the
  backend service relies on metadata.create_all + restart, not a wait script.
- Emit railway.json at repo root describing two services + one Postgres plugin.
- Backend reads PORT env (Railway default 8080); frontend serves on its PORT.
- README.md has ONE link at top: "Live app: {{RAILWAY_URL}}" (literal placeholder).
- CORS: backend allows FRONTEND_ORIGIN (env). .gitignore excludes .env,
  node_modules, __pycache__, dist.

The super prompt MUST:
- Begin with the reconstructed OPL paragraph.
- Enumerate every entity, endpoint, screen, business rule.
- Embed the retrieved KB chunks INLINE (keep their [ID] + ISO/Dori citations).
- State hard constraints: no extra features; validate state transitions exactly
  as modelled (reject illegal source states with 409); no invented fields;
  consumees destroyed, resultees created, instruments untouched; include
  TRACEABILITY.md (OPL sentence -> artifact), README.md, docker-compose.yml.
- Include a seed routine populating sample data for every OPM object.
- Frontend MUST include index.html (Vite entry) and a package.json whose scripts
  are exactly { "dev": "vite", "build": "vite build", "preview": "vite preview" }.
- Instruct the generator to emit files in the delimiter format used by Stage 4.

Respond with ONLY the super prompt text (no markdown fences, no preamble).
`.trim();

// Send gemini rules+rag+chunks and diagram
async function buildWithGemini(opm: unknown, spec: unknown) {
    const chunks = retrieveChunks(opm as OpmIR); // get relavant chuncks
    const kb     = formatChunksForPrompt(chunks); // make chunks to a string, a messege format for prompt
    const schema = rulesSchemaSummary();
    const text = await askText(
        `${PROMPT}\n\n## OPM IR\n${JSON.stringify(opm, null, 2)}\n\n## System Spec\n${JSON.stringify(spec, null, 2)}` +
        `\n\n## OPM Rules Schema\n${schema}\n\n## Retrieved OPM Knowledge (${chunks.length} chunks)\n${kb}`,
    );
    return {
        prompt: text,
        retrievedChunks: chunks.length,
        models: ["Gemini"],
    };
}

async function mock(): Promise<{ prompt: string; retrievedChunks: number; models: string[] }> {
    const mockPath = path.join(process.cwd(), "public", "mock-outputs", "super_prompt.txt");
    const prompt = await fs.readFile(mockPath, "utf-8");
    return { prompt, retrievedChunks: 6, models: ["Gemini"] };
}

export async function buildSuperPrompt_stage3(opm: unknown, spec: unknown) {
    if (isGeminiConfigured() && opm && spec) {
        try {
            return await buildWithGemini(opm, spec);
        } catch (e) {
            console.error("[stage3] Gemini prompt build failed, using mock:", (e as Error).message);
            return mock();
        }
    }
    return mock();
}
