/**
 * opm/knowledge/index.ts — typed access to the vendored OPM knowledge base.
 *
 * The KB is the Phase-1, source-cited OPM corpus (ISO 19450 > Dori > book):
 *   - 07_rag_chunks.json   → 64 retrievable chunks (ontology / link / OPL / validation)
 *   - 06_rules_schema.json → element + link legality + VR-01..VR-20
 * The markdown files in this folder are human/agent reference (not loaded here).
 */

import rawChunks from "./07_rag_chunks.json";
import rawSchema from "./06_rules_schema.json";

export type RagCategory =
    | "ontology"
    | "structural_link"
    | "procedural_link"
    | "opl_grammar"
    | "validation_rule";

export type RagChunk = {
    chunk_id:         string;
    topic:            string;
    concept:          string;
    definition:       string;
    category:         RagCategory;
    opl_template:     string;
    validation_rules: string[];
    example:          string;
    source:           string;
    source_reference: string;
    priority:         "high" | "medium" | "low";
    related_concepts: string[];
    assumption?:      boolean;
};

export type ValidationRule = {
    rule_id:           string;
    description:       string;
    severity:          "error" | "warning" | "assumption";
    source_reference?: string;
};

export type RulesSchema = {
    schema_name:    string;
    schema_version: string;
    source_priority: string[];
    opm_elements: Record<string, {
        definition:         string;
        source_reference:   string;
        allowed_relations:  string[];
        forbidden_relations: string[];
        validation_rules:   string[];
        software_hints:     string[];
    }>;
    links: {
        structural: { name: string; definition: string; source_type: string; target_type: string }[];
        procedural: { name: string; definition: string; source_type: string; target_type: string }[];
    };
    validation_rules: ValidationRule[];
};

export const RAG_CHUNKS  = rawChunks as unknown as RagChunk[];
export const RULES_SCHEMA = rawSchema as unknown as RulesSchema;
