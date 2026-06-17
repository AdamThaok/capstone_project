# 10. Missing Information and Open Questions

Items the provided sources do not settle, or that require a decision before Phase 2. None of these were silently resolved; defaults (where chosen) are marked.

## 10.1 Missing / not fully extracted from sources

- **M-1 — Published-standard delta.** Provided ISO text is the 2014 PDPAS draft. The published ISO/PAS 19450:2015 (and later 19450-1/-2/-4 work) may differ in wording, e.g., OPL phrasings or added link kinds. *Action:* verify against the published standard when available.
- **M-2 — Annex A EBNF not fully transcribed.** The normative OPL EBNF (ISO Annex A, ~90 pages incl. annexes) exists in the source but only sentence-level templates were extracted into this KB. *Action for Phase 2:* transcribe Annex A productions verbatim for the parser.
- **M-3 — Graph grammar (Annex E/F).** ISO Annex E references a graph grammar for valid OPD construction; referenced "Annex F" suggests draft-stage inconsistency. Not extracted. *Action:* extract before building a diagram validator UI.
- **M-4 — Cardinalities/multiplicities (ISO 11).** Object multiplicity expressions and constraints on links (e.g., participation constraints, `3 Keys`) were located but not fully tabulated. Needed for data-model generation later.
- **M-5 — Path labels (ISO 13)** and their effect on AND/OR OPL syntax: not extracted.
- **M-6 — Exact XOR/OR OPL sentence forms (ISO 12.2–12.7)** and probabilistic link fans: semantics captured, exact sentence templates not tabulated.
- **M-7 — In-zoom/unfold context semantics (ISO 14.2.2):** implicit invocation links, link distribution across contexts, event link constraint — summarized only at principle level.
- **M-8 — Simulation/dynamics (ISO Annex D)** and **OPM-of-OPM metamodel (Annex C):** not extracted; relevant for execution semantics in later phases.
- **M-9 — Book chapters 6–15 details** (participation constraints, scenarios, real-time aspects, UML mappings) sampled, not exhaustively mined.

## 10.2 Open questions requiring user/modeller decisions (Phase 2 gates)

- **Q-1 Wait vs skip.** When a natural-language requirement says "P occurs only if O is in state s", should the importer default to state-specified (wait) or condition (skip) links? **KB default: wait + logged assumption** (rule VR-17). Confirm.
- **Q-2 Agent scope.** Accept organizational agents (Dori) or strictly humans/groups (ISO)? **KB default: ISO wording, organizational agents allowed with a note.**
- **Q-3 Environmental things.** How should environmental (outside-boundary) objects/processes be treated in generation — as external interfaces? Sources define the boundary semantics (ISO 6.1.5) but no software mapping (by design).
- **Q-4 Persistent processes** (state-maintaining, ISO 7.2.1 NOTE 2): generation semantics undefined; likely daemons/invariants. Defer.
- **Q-5 Probabilistic fans and initial-state probabilities** (ISO 12.7): include in simulation scope?

## 10.3 Explicit assumptions registered in this KB

| ID | Assumption | Where used |
|---|---|---|
| A-SRC-1..3 | Source-version and OCR caveats | file 01 |
| A-V1 | Acyclicity of aggregation/generalization hierarchies (inferred from refinement semantics; not an explicit "shall" in extracted text) | validator Check 5 / E502 |
| V-S12 | "Instantiation cannot generate a hierarchy" — book front matter only; not found in extracted ISO text | file 03 §3.4 |
| VR-17 | Default wait-semantics interpretation for informal state requirements | schema, validator, checklist |
| ONT-005 | OCR-restored founder definitions | RAG chunks |

## 10.4 Things deliberately out of scope for Phase 1 (per instructions)

Database/backend/frontend/API generation; mapping objects→tables, processes→endpoints, states→columns; UML/BPMN/ERD crosswalks (except the recorded founder commentary); tool-specific OPD layout rules (ISO 6.2.6.3 explicitly leaves labelling tool-specific).
