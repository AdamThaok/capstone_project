# 5. OPL Grammar Templates

OPL is a subset of English (ISO 3.42). Every OPD construct (link + source + destination) has exactly one corresponding OPL sentence (ISO 6.2.2 ¶485–486); OPD and OPL are equivalent renderings of one model (bimodality, ISO 6.2.1). Annex A of ISO 19450 gives the full normative EBNF (ISO Annex A, conforming to ISO/IEC 14977).

**Typography rules (confirmed):** thing names bold with each word capitalized (ISO 7.1.2 ¶573, 7.2.2 ¶596); state/value labels bold, lowercase except sentence-initial (ISO 7.3.5.2 ¶678, 9.4.1 NOTE ¶1047); tags bold (ISO 10.2.1 NOTE ¶1482); non-bold words are reserved OPL grammar words (Dori front matter).

Legend: status `confirmed` = exact ISO normative wording; `confirmed-book` = exact book wording (legacy); `assumed` = inferred, marked.

## 5.1 Thing and state sentences

| # | Sentence type | Template | Example | Source | Status |
|---|---|---|---|---|---|
| T1 | Generic properties | `Thing is essence[ and affiliation] thing-kind.` | `Testing is environmental and physical.` (process); `Raw Metal Bar is physical.` | ISO 7.3.3 Fig. 4, Fig. 11 | confirmed |
| T2 | State enumeration | `Object can be s1 or s2.` / `Object can be s1, s2, or s3.` | `Museum Visitor can be inside the museum or out of the museum.` | ISO 7.3.5.2 Fig. 5 | confirmed |
| T3 | Initial/default/final | `State s of Object is initial|default|final.` | `State preliminary of Specification is initial.` | ISO 7.3.5.4 Fig. 6 | confirmed |
| T4 | Attribute values (enum) | `Attribute of Exhibitor can be v1, v2, and v3.` | `Travelling Medium of Vehicle can be ground, air, and water surface.` | ISO Fig. 25 | confirmed |
| T5 | Attribute values (range) | `Attribute of Exhibitor ranges from x to y.` | `Height in cm of Adult ranges from 120 to 240.` | ISO Fig. 26 | confirmed |
| T6 | Attribute value (instance) | `Attribute of Thing is value.` | `Travelling Medium of Ship is water surface.` | ISO ¶1650, Fig. 25 | confirmed |

## 5.2 Procedural link sentences

| # | Link type | Template (source → target → form) | Example | Validation | Source | Status |
|---|---|---|---|---|---|---|
| P1 | Consumption | consumee obj → process: `Processing consumes Consumee.` | `Deleting consumes File.` | source object exists; wait semantics | ISO 9.1.2 ¶814, Fig. 7 | confirmed |
| P2 | State-specified consumption | consumee state → process: `Process consumes specified-state Object.` | `Eating consumes edible Food.` | state ∈ object's permissible states | ISO 9.3.1 ¶921 | confirmed |
| P3 | Result | process → resultee obj: `Processing yields Resultee.` | `Creating yields File.` | postcondition; no control modifier | ISO 9.1.3 ¶835, Fig. 7 | confirmed |
| P4 | State-specified result | process → resultee state: `Process yields specified-state Object.` | `Mining yields raw Copper.` | do not target an initial state | ISO 9.3.2 ¶943, ¶954 | confirmed |
| P5 | Effect | obj ↔ process: `Processing affects Affectee.` | `Editing affects File.` | affectee stateful | ISO 9.1.4 ¶852, Fig. 7 | confirmed |
| P6 | Input-output-specified effect | state s1 → process → state s2: `Process changes Object from s1 to s2.` | `Purifying changes Copper from raw to pure.` | s1≠s2, both permissible | ISO 9.3.3.2 ¶979 | confirmed |
| P7 | Input-specified effect | state s1 → process → obj: `Process changes Object from s1.` | `Testing changes Sample from awaiting test.` | default state or distribution needed | ISO 9.3.3.3 ¶1023 | confirmed |
| P8 | Output-specified effect | obj → process → state s2: `Process changes Object to s2.` | `Cleaning & Painting changes Engine Hood to painted.` | object exists in any state | ISO 9.3.3.4 ¶1034 | confirmed |
| P9 | Agent | agent obj → process: `Agent handles Processing.` | `Welder handles Welding.` | agent human; unchanged | ISO 9.2.2 ¶876 | confirmed |
| P10 | State-specified agent | agent state → process: `Specified-state Agent handles Processing.` | `Sober Pilot handles Flying.` | state ∈ agent's states | ISO 9.4.1 ¶1046 | confirmed |
| P11 | Instrument | instr obj → process: `Processing requires Instrument.` | `Manufacturing requires Machine.` | instrument non-human, unchanged | ISO 9.2.3 ¶895 | confirmed |
| P12 | State-specified instrument | instr state → process: `Processing requires specified-state Instrument.` | `Moving requires serviced Moving Truck.` | state ∈ instrument's states | ISO 9.4.2 ¶1056 | confirmed |
| P13 | Consumption event | obj →e process: `Object initiates Process, which consumes Object.` | `Food initiates Eating, which consumes Food.` | event lost after evaluation | ISO 9.5.2.1.1 ¶1119 | confirmed |
| P14 | Effect event | obj →e process: `Object initiates Process, which affects Object.` | `Copper initiates Purifying, which affects Copper.` | — | ISO 9.5.2.1.2 ¶1128 | confirmed |
| P15 | Agent event | agent →e process: `Agent initiates and handles Process.` | `Miner initiates and handles Copper Mining.` | — | ISO 9.5.2.2.1 ¶1139 | confirmed |
| P16 | Instrument event | instr →e process: `Instrument initiates Process, which requires Instrument.` | `Drill initiates Copper Mining, which requires Drill.` | — | ISO 9.5.2.2.2 ¶1146 | confirmed |
| P17 | State-specified consumption event | state →e process: `Specified-state Object initiates Process, which consumes Object.` | — | — | ISO 9.5.2.3.1 ¶1160 | confirmed |
| P18 | Input-output effect event | state →e process: `Input-state Object initiates Process, which changes Object from input-state to output-state.` | — | — | ISO 9.5.2.3.2 ¶1167 | confirmed |
| P19 | Condition consumption | obj →c process: `Process occurs if Object exists, in which case Object is consumed, otherwise Process is skipped.` (alt: `If Object exists then Process occurs and consumes Object, otherwise bypass Process.`) | — | skip semantics | ISO 9.5.3.1.1 ¶1241–1245 | confirmed |
| P20 | Condition effect | obj →c process: `Process occurs if Object exists, in which case Process affects Object, otherwise Process is skipped.` | — | skip semantics | ISO 9.5.3.1.2 ¶1258 | confirmed |
| P21 | Condition agent | agent →c process: `Agent handles Process if Agent exists, else Process is skipped.` | — | — | ISO 9.5.3.2.1 ¶1279 | confirmed |
| P22 | Condition instrument | instr →c process: `Process occurs if Instrument exists, else Process is skipped.` | `Precise Measuring occurs if LASER Meter exists, otherwise Precise Measuring is skipped.` | — | ISO 9.5.3.2.2 ¶1295 | confirmed |
| P23 | Condition state-specified consumption | state →c process: `Process occurs if Object is specified-state, in which case Object is consumed, otherwise Process is skipped.` | — | — | ISO 9.5.3.3.1 ¶1327 | confirmed |
| P24 | Condition input-output effect | state →c process: `Process occurs if Object is input-state, in which case Process changes Object from input-state to output-state, otherwise Process is skipped.` | — | — | ISO 9.5.3.3.2 ¶1346 | confirmed |
| P25 | Condition input-specified effect | `Process occurs if Object is input-state, in which case Process changes Object from input-state, otherwise Process is skipped.` | — | — | ISO 9.5.3.3.3 ¶1367 | confirmed |
| P26 | Condition output-specified effect | `Process occurs if Object exists, in which case Process changes Object to output-state, otherwise Process is skipped.` | — | — | ISO 9.5.3.3.4 ¶1381 | confirmed |
| P27 | Condition state-specified agent | `Agent handles Process if Agent is specified-state, else Process is skipped.` | — | — | ISO 9.5.3.4.1 ¶1401 | confirmed |
| P28 | Condition state-specified instrument | `Process occurs if Instrument is specified-state, otherwise Process is skipped.` | — | — | ISO 9.5.3.4.2 ¶1419 | confirmed |
| P29 | Invocation | proc →proc: `Invoking-process invokes invoked-process.` | `Product Finishing invokes Product Shipping.` | both ends processes | ISO 9.5.2.5.1 ¶1218 | confirmed |
| P30 | Self-invocation | `Invoking-process invokes itself.` | `Recurrent Processing invokes itself.` | — | ISO 9.5.2.5.2 ¶1224 | confirmed |
| P31 | Overtime exception | proc →proc: `Overtime Handling Process occurs if duration of Source Process exceeds max-duration time-units.` | — | needs Maximal Duration | ISO 9.5.4.2 ¶1447 | confirmed |
| P32 | Undertime exception | `Undertime Handling Process occurs if duration of Source Process falls short of min-duration time-units.` | — | needs Minimal Duration | ISO 9.5.4.3 ¶1456 | confirmed |

**User-supplied shorthand mapping (Phase-0 prompt → ISO canonical):**
- "Process X requires Object Y." = P11 (exact ISO wording).
- "Process X consumes Object Y." = P1 (exact).
- "Process X yields Object Y." = P3 (exact).
- "Process X changes Object Y from State A to State B." = P6 (exact).
- "Process X occurs if Object Y is in State Z." ≈ P28/P23 family — ISO exact wording is `Process occurs if Object is state, …, otherwise Process is skipped.` (skip semantics). If wait semantics is intended, use a state-specified link (P2/P6/P10/P12) instead. **This disambiguation is mandatory** (conflict C-1).

## 5.3 Structural link sentences

| # | Link type | Template | Example | Source | Status |
|---|---|---|---|---|---|
| S1 | Aggregation (complete) | `Whole consists of Part1, …, and Partn.` | `Resource Description Framework Statement consists of Subject, Predicate, and Object.` | ISO 10.3.2 ¶1560 | confirmed |
| S2 | Aggregation (incomplete) | `Whole consists of Part1, …, Partk, and at least one other part.` | — | ISO ¶1570 | confirmed |
| S3 | Exhibition (object exhibitor) | `Exhibitor exhibits Attr1, …, and Attrn, as well as Op1, …, Opm.` | `Laptop exhibits Manufacturer.` | ISO 10.3.3.1 ¶1604 | confirmed |
| S4 | Exhibition (process exhibitor) | `Exhibitor exhibits Op1, …, Opn, as well as Attr1, …, Attrm.` | `Diving exhibits Depth.` | ISO ¶1607 | confirmed |
| S5 | Exhibitor-feature reference | `Feature of Exhibitor …` | `Specific Weight in gr/cm3 of Metal Powder Mixture ranges from 7.545 to 7.537.` | ISO 10.3.3.2.2 ¶1646 | confirmed |
| S6 | Generalization (single) | `Specialization is a General.` | `Digital Camera is a Camera.` | ISO Fig. 24 | confirmed |
| S7 | Generalization (plural) | `Spec1, …, and Specn are General.` | `Car, Aircraft, and Ship are Vehicles.` | ISO ¶1660 | confirmed |
| S8 | Generalization (incomplete) | `Spec1, …, Speck, and other specializations are General.` | — | ISO ¶1670 | confirmed |
| S9 | Instantiation (single) | `Instance is an instance of Class.` | `Jack Robinson is an instance of Adult.` | ISO ¶1756 | confirmed |
| S10 | Instantiation (plural) | `Inst1, …, and Instn are instances of Class.` | — | ISO ¶1760 | confirmed |
| S11 | State-specified characterization | `Specialized-object exhibits value-name Attribute-Name.` | — | ISO 10.4.1 ¶1811 | confirmed |
| S12 | Unidirectional tagged | `Source tag Destination.` | `Airport serves City.` | ISO 10.2.1 ¶1480 | confirmed |
| S13 | Null-tagged | `Source relates to Destination.` | — | ISO 10.2.2 ¶1487 | confirmed |
| S14 | Bidirectional tagged | two unidirectional sentences | `Engine is attached to Gearbox.` + `Gearbox is attached to Engine.` | ISO 10.2.3 ¶1499 | confirmed |
| S15 | Reciprocal tagged | `A and B are reciprocity-tag.` / `A and B are related.` | `Engine and Gearbox are attached.` | ISO 10.2.4 ¶1512–1515 | confirmed |

## 5.4 Logical operator phrasing

- AND: several same-kind links → ONE sentence joined with "and": `Safe Opening requires Key A, Key B, and Key C.` (ISO 12.1 ¶2057–2063).
- XOR/OR link fans: divergent/convergent fan semantics (ISO 12.2–12.4). Exact OPL phrasing for XOR/OR sentences exists in ISO clause 12 and Annex A; not fully tabulated here — see `10_missing_information.md` item M-6.

## 5.5 Grammatical form requirements (summary)

1. Sentences end with a period; one sentence per OPM construct/fact.
2. Process names: gerund preferred (founder convention); object names: nouns (Dori front matter; ISO B.6 naming conventions).
3. Bold = modeller-defined names and tags; non-bold = reserved grammar words.
4. Lists use ", " with "and"/"or" before the last item, per templates above.
5. State adjectives precede the object name in state-specified shorthand (e.g., `edible Food`, `serviced Moving Truck`).
