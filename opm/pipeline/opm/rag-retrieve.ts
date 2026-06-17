/**
 * opm/pipeline/rag-retrieve.ts — deterministic, in-memory RAG over the 64
 * OPM knowledge chunks. No vector store / Pinecone: at this scale a keyword +
 * category match keyed off the parsed OPM model is sufficient and reproducible.
 *
 * Strategy (per knowledge/11_codegen_agent_prompt.md):
 *   - always pin the high-priority ontology chunks (model interpretation needs them);
 *   - pull link/OPL chunks for every link kind present in the model;
 *   - pull state/effect/transition chunks when objects carry states;
 *   - follow each matched chunk's referenced validation rules.
 */

import { RAG_CHUNKS, type RagChunk } from "../../knowledge";

export type OpmIR = {
    objects?:   { id?: string; name?: string; states?: (string | { name?: string })[] }[];
    processes?: { id?: string; name?: string }[];
    links?:     { id?: string; type?: string; from?: string; to?: string }[];
    [k: string]: unknown;
};

// Raw link-type strings (as emitted by the parsers) → KB concept keywords.
// Keys are matched as normalized substrings, so "consumes"/"consumption-link" both hit.
const LINK_CONCEPTS: Record<string, string[]> = {
    consum:        ["consumption"],
    result:        ["result"],
    yield:         ["result"],
    creat:         ["result"],
    effect:        ["effect", "state transition"],
    affect:        ["effect", "state transition"],
    agent:         ["agent"],
    instrument:    ["instrument"],
    condition:     ["condition", "occurs if in state"],
    event:         ["event"],
    invocation:    ["invocation"],
    invoke:        ["invocation"],
    exception:     ["overtime undertime"],
    aggregat:      ["aggregation"],
    part:          ["aggregation"],
    exhibit:       ["exhibition"],
    attribute:     ["exhibition"],
    characteriz:   ["exhibition"],
    general:       ["generalization"],
    "is-a":        ["generalization"],
    inherit:       ["generalization"],
    instanti:      ["instantiation"],
    classif:       ["instantiation"],
    tagged:        ["tagged link"],
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

const MAX_CHUNKS = 28;

function conceptsForModel(opm: OpmIR): Set<string> {
    const wanted = new Set<string>();
    for (const link of opm.links ?? []) {
        const t = (link.type ?? "").toLowerCase();
        for (const [needle, concepts] of Object.entries(LINK_CONCEPTS)) {
            if (t.includes(needle)) concepts.forEach((c) => wanted.add(c));
        }
    }
    const hasStates = (opm.objects ?? []).some((o) => (o.states ?? []).length > 0);
    if (hasStates) ["state", "state transition", "state markers", "effect"].forEach((c) => wanted.add(c));
    return wanted;
}

function haystack(c: RagChunk): string {
    return [c.concept, c.topic, ...(c.related_concepts ?? [])].join(" ").toLowerCase();
}

// Step 1: the core ontology chunks are always needed to interpret any model.
function pinCoreOntology(into: Map<string, RagChunk>): void {
    for (const chunk of RAG_CHUNKS) {
        const isCoreOntology = chunk.category === "ontology" && chunk.priority === "high";
        if (isCoreOntology) into.set(chunk.chunk_id, chunk);
    }
}

// Does this chunk talk about any concept the model actually uses?
function chunkMatchesModel(chunk: RagChunk, wanted: Set<string>): boolean {
    const hay = haystack(chunk);
    for (const concept of wanted) {
        if (hay.includes(concept)) return true;
    }
    return false;
}

// Find the chunk that defines a given validation rule (e.g. "VR-01").
function findValidationChunk(vr: string): RagChunk | undefined {
    for (const chunk of RAG_CHUNKS) {
        const isThatRule = chunk.chunk_id === vr || (chunk.related_concepts ?? []).includes(vr);
        if (isThatRule) return chunk;
    }
    return undefined;
}

// Step 3: pull in the validation-rule chunks a matched chunk points to.
function addValidationRulesFor(chunk: RagChunk, into: Map<string, RagChunk>): void {
    for (const vr of chunk.validation_rules ?? []) {
        const ruleChunk = findValidationChunk(vr);
        if (ruleChunk) into.set(ruleChunk.chunk_id, ruleChunk);
    }
}

// Step 2: add every chunk whose concepts appear in the model, plus their rules.
function addModelMatches(opm: OpmIR, into: Map<string, RagChunk>): void {
    const wanted = conceptsForModel(opm);
    if (wanted.size === 0) return;

    for (const chunk of RAG_CHUNKS) {
        if (chunkMatchesModel(chunk, wanted)) {
            into.set(chunk.chunk_id, chunk);
            addValidationRulesFor(chunk, into);
        }
    }
}

// Step 4: highest-priority chunks first, then cap the total.
function byPriorityThenCap(chunks: RagChunk[]): RagChunk[] {
    const sorted = [...chunks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return sorted.slice(0, MAX_CHUNKS);
}

/** Select the KB chunks relevant to a parsed OPM model. */
export function retrieveChunks(opm: OpmIR): RagChunk[] {
    const selected = new Map<string, RagChunk>();

    pinCoreOntology(selected);
    addModelMatches(opm, selected);

    return byPriorityThenCap([...selected.values()]);
}

// Render ONE chunk as a labelled, citation-bearing block, built top to bottom
// in the same order it prints: header (+ optional flag), definition, optional OPL.
function formatOneChunk(c: RagChunk): string {
    let block = `- [${c.chunk_id}] ${c.topic} — ${c.source} ${c.source_reference}`;

    if (c.assumption) {
        block += " [ASSUMPTION]";
    }

    block += `\n  ${c.definition}`;

    if (c.opl_template) {
        block += `\n  OPL: ${c.opl_template}`;
    }

    return block;
}

/** Render retrieved chunks as a compact, citation-bearing prompt block. */
export function formatChunksForPrompt(chunks: RagChunk[]): string {
    const blocks: string[] = [];
    for (const chunk of chunks) {
        blocks.push(formatOneChunk(chunk));
    }
    return blocks.join("\n");
}
