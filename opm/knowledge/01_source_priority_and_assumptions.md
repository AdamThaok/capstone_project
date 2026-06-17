# 1. Source Priority and Assumptions

## 1.1 Authoritative sources used in this knowledge base

| Priority | Source ID | Document | Status |
|---|---|---|---|
| 1 | `ISO` | ISO/PDPAS 19450, "Automation systems and integration — Object-Process Methodology", TC 184/SC 5 N 522, 2014-04-29 (provided PDF, 183 pp.) | Primary normative source |
| 2 | `Dov_Dori` | Dov Dori, *Object-Process Methodology: A Holistic Systems Paradigm*, Springer, 2002 (provided PDF, 466 pp.) | Founder methodology |
| 3 | `OPM_Book` | Same volume as `Dov_Dori` — used as the "OPM language/book material" tier where its content is linguistic/notational summary (front-matter "Building Blocks" tables, OPL frames) rather than methodological doctrine | Tertiary |

**Conflict rule:** where wording differs, ISO 19450 normative clauses ("shall" statements) prevail; Dori (2002) is used for founder rationale, methodology guidance, and for concepts ISO leaves informal; the book's summary tables fill remaining gaps. Every extracted rule carries a `source_reference` (ISO clause + numbered paragraph, or Dori section).

## 1.2 Caveats about the provided sources (global assumptions)

- **A-SRC-1 (assumption):** The provided ISO document is the 2014 *PDPAS draft* (preparatory stage), not the published ISO/PAS 19450:2015 or the 19450 series revisions. Definitions are assumed representative of the published standard; any discrepancy with the published text is unverifiable from the provided material.
- **A-SRC-2 (assumption):** The Dori book PDF is OCR-derived; inset definition boxes contain character-level OCR noise (e.g., "Enobler ofa process i an object…"). Definitions taken from these boxes were reconstructed to standard English; reconstruction is faithful to obvious intent but flagged as OCR-restored where used.
- **A-SRC-3 (assumption):** The book (2002) predates the ISO standard (2014). Terminology drift exists (book: "transformation link", "construction"; ISO: "transforming link", "result/generation"; book condition-OPL style differs from ISO). ISO wording is canonical in this KB; book wording is recorded as historical/founder variant.

## 1.3 Known source conflicts (resolved per priority)

| ID | Topic | ISO position | Dori 2002 position | Resolution |
|---|---|---|---|---|
| C-1 | Condition semantics | Condition link = control modifier "c" adding **skip/bypass** semantics; a mere state requirement is a **state-specified** (wait-semantics) link (ISO 8.2.3, 9.5.3) | Book describes condition links as "state-specified enablers" with OPL "Process occurs if Object is state." (Dori §5.3.3) | ISO prevails: distinguish state-specified links (wait) from condition links (skip). Book phrasing kept as informal equivalent. |
| C-2 | "Entity" term | ISO 19450 does not define "entity"; it defines *element* = thing or link (ISO 3.16) | Book: **Entity** generalizes Thing and State (Dori §4.3.1) | Both recorded. "OPM entity" answered from Dori (ISO is silent, not conflicting). |
| C-3 | Agent definition | "human or a group of humans" (ISO 3.4, 9.2.2) | "intelligent enabler… one or more humans, an organization, or a unit" (Dori §5.2.4) | Compatible; ISO wording canonical, book adds organizational agents. |
| C-4 | Condition OPL phrasing | "Process occurs if Object exists, in which case Object is consumed, otherwise Process is skipped." (ISO 9.5.3.1.1) | "Accessing occurs if Card is valid." / "User must be authorized for Accessing to occur." (Dori §5.3.3) | ISO templates canonical; book templates marked legacy variants. |
| C-5 | Effect-link state pair naming | input-output-specified / input-specified / output-specified effect link (ISO 9.3.3) | incoming/outgoing effect links joined into bidirectional effect link (Dori §5.2.7) | ISO naming canonical. |

## 1.4 What was deliberately NOT done in Phase 1

- No application code, database schema, API, or UI generation. `software_hints` fields are *hints only*, never normative.
- No UML/BPMN/ERD semantics imported. The single UML analogy in the sources (agent link ≈ use-case stick figure, Dori §5.2.4) is recorded as commentary only.
- No invented rules. Anything not supported by the two provided documents is marked `"assumption": true` or listed in `10_missing_information.md`.
