# 4. Procedural Link Rules

Procedural links bind objects (or object states) to processes and carry the dynamic semantics of the model (ISO 8.1.1). Three families (ISO 8.1.1 ¶721–730): **transforming** (consumption, result, effect), **enabling** (agent, instrument), **control** (event, condition, invocation, exception — a transforming/enabling link plus control semantics). Any transforming or enabling link may be **state-specified** (attached to a state instead of the whole object, ISO 8.1.3 ¶739–740).

**Global procedural rules**
- P-G1 Uniqueness: at a given abstraction level, one object (or one of its states) connects to a given process by exactly one procedural link and plays exactly one role (ISO 8.1.2 ¶733–737).
- P-G2 Every process has a transforming link to ≥1 object or state (ISO 8.1.2 ¶734); preprocess and postprocess object sets are each non-empty (ISO 8.2.2 ¶763, ¶768).
- P-G3 ECA semantics: events trigger precondition evaluation; events are consumed by evaluation; the process runs iff the precondition holds (ISO 8.2.1).
- P-G4 Wait vs skip: non-condition incoming links have wait semantics; condition links ("c") have skip semantics, and skip overrides wait (ISO 8.2.3 ¶775–790).
- P-G5 There is no result event link and no result condition link (outgoing links carry no control modifier) (ISO 8.2.3 NOTE 1 ¶791–794).
- P-G6 AND/XOR/OR: multiple same-kind links not touching at a common point = AND (one OPL sentence with "and", ISO 12.1 ¶2054–2058); links meeting at a common point form an XOR/OR link fan (ISO 12.2 ¶2086–2092).
- P-G7 Semantic strength order for abstraction conflicts: consumption event > consumption = result > consumption condition > effect event > effect > effect condition > agent event > agent > agent condition > instrument event > instrument > instrument condition (ISO 14.2.4.1.4).

---

## 4.1 Consumption link

| Field | Content |
|---|---|
| Definition | Transforming link specifying that the linked process consumes (destroys, eliminates) the linked object, the consumee (ISO 9.1.2 ¶810) |
| Source → Target | consumee object → process (state-specified: consumee state → process, ISO 9.3.1) |
| Meaning | Object existence is (part of) the precondition; the object is destroyed immediately upon process activation (unless a rate property models gradual consumption, ISO ¶818–821). Consumee belongs only to the preprocess object set |
| Graphical notation | Arrow with closed arrowhead from consumee to process (ISO ¶812) |
| OPL | `Processing consumes Consumee.` (ISO ¶814). State-specified: `Process consumes specified-state Object.` e.g. `Eating consumes edible Food.` (ISO 9.3.1 ¶921, Table 3) |
| Validation rules | P-C1 source is an object or object state; target is a process. P-C2 a stateless object can be consumed but not affected (ISO 3.3 NOTE). P-C3 same object cannot also be yielded by the same process at the same abstraction (fact consistency, ISO 14.2.3). P-C4 wait semantics unless "c"/"e" modified |
| Software hints | input destroyed/dequeued/closed by operation; resource depletion; record deletion. Defer. |
| Example | `Welding consumes Steel Part A and Steel Part B.` (ISO Fig. 8) |
| Semantic mapping | Steel Part A, Steel Part B = consumees of Welding; preprocess set members only |
| Source reference | ISO 9.1.2; 9.3.1; Dori §5.2.7 ("Consumption link… connects a consuming process with a consumee") |
| Assumption | false |

## 4.2 Result link

| Field | Content |
|---|---|
| Definition | Transforming link specifying that the linked process creates (generates, yields) the linked object, the resultee (ISO 9.1.3 ¶831) |
| Source → Target | process → resultee object (state-specified: process → resultee state, ISO 9.3.2) |
| Meaning | Resultee generation is immediate upon process completion (or rate-based); resultee existence (possibly at a state) is (part of) the postcondition. Resultee belongs only to the postprocess object set |
| Graphical notation | Arrow with closed arrowhead from process to resultee (ISO ¶833) |
| OPL | `Processing yields Resultee.` (ISO ¶835). State-specified: `Process yields specified-state Object.` e.g. `Mining yields raw Copper.` (ISO 9.3.2 ¶943, Table 3) |
| Validation rules | P-R1 source is a process; target an object or object state. P-R2 if the resultee has an initial state, the result link should attach to the object (or a non-initial state), not the initial state (ISO 9.3.2 ¶954–958). P-R3 no event/condition modifier on result links (P-G5). P-R4 cannot contradict consumption of same object by same process |
| Software hints | output creation; record/file/message creation; constructor/factory semantics. Defer. |
| Example | `Welding yields Steel Part AB.` (ISO Fig. 8) |
| Semantic mapping | Steel Part AB = resultee; postprocess set member only |
| Source reference | ISO 9.1.3; 9.3.2; Dori §5.2.7 ("Result link… connects a resulting process with a resultee") |
| Assumption | false |

## 4.3 Effect link

| Field | Content |
|---|---|
| Definition | Transforming link specifying that the linked process affects the linked object (causes some unspecified change in the affectee's state) (ISO 9.1.4 ¶848) |
| Source ↔ Target | bidirectional between affectee object and process; state-specified forms split into input link (state→process) and output link (process→state) (ISO 9.3.3) |
| Meaning | The affectee exists before and after; only its state changes. Affectee is in both pre- and postprocess sets. During performance it is in transition between states |
| Graphical notation | Bidirectional arrow with two closed arrowheads (ISO ¶850). State-specified: pair of unidirectional closed-arrowhead arrows via the states |
| OPL | `Processing affects Affectee.` (ISO ¶852). State pairs: `Process changes Object from s1 to s2.` (input-output, ISO ¶979); `Process changes Object from s1.` (input-specified, ISO ¶1023); `Process changes Object to s2.` (output-specified, ISO ¶1034) |
| Validation rules | P-E1 affectee must be a **stateful** object (ISO 3.3 NOTE, 3.15 NOTE). P-E2 for input-output pairs, s1 ≠ s2 and both are permissible states of the same object. P-E3 input-specified effect requires a default state or a state probability distribution to determine the output state (ISO 9.3.3.3 ¶1014–1016). P-E4 "affects" is an abstraction; "changes from/to" is its refinement (consistent, not contradictory — ISO 14.2.3 EXAMPLE) |
| Software hints | update operations; status field transitions; PATCH-like semantics. Defer. |
| Example | `Sintering changes Insert Set from pre-sintered to sintered.` (ISO Fig. 9) |
| Semantic mapping | Insert Set = affectee; pre-sintered = input state (precondition); sintered = output state (postcondition) |
| Source reference | ISO 9.1.4; 9.3.3; Dori §5.2.7 ("Effect link… connects an affecting process with an affectee") |
| Assumption | false |

## 4.4 Agent link

| Field | Content |
|---|---|
| Definition | Enabling link from an agent object to the process it enables; the agent — a human or group of humans capable of intelligent decision-making — is necessary for activation and performance (ISO 9.2.2 ¶870–873) |
| Source → Target | agent object (or agent state) → process |
| Meaning | The agent enables/controls but is NOT transformed; it must be present throughout performance; if it disappears, the process ends immediately (ISO 9.2.1 ¶862–864). Enabler is in both pre- and postprocess sets, unchanged |
| Graphical notation | Line from agent to process ending in a filled ("black lollipop") circle at the process end (ISO ¶874) |
| OPL | `Agent handles Processing.` (ISO ¶876). State-specified: `Specified-state Agent handles Processing.` e.g. `Sober Pilot handles Flying.` (ISO 9.4.1 ¶1046–1050) |
| Validation rules | P-A1 source is an object (role: human/organizational actor) or its state; target a process. P-A2 the agent's existence and state after completion equal those before start (ISO 9.2.1 ¶859–860). P-A3 if the "agent" is itself transformed by the process, it is a transformee, not an agent (Dori §5.2.4 Student/Studying example). P-A4 humanness: ISO restricts agents to humans/groups; Dori extends to organizations — record the model's choice explicitly |
| Software hints | user role; human task / approval step; UI interaction point (Dori §5.2.4: agent hierarchy guides UI design). Defer. |
| Example | `Welder handles Welding.` (ISO Fig. 8) |
| Semantic mapping | Welder = agent (enabler); not in any transformee role for Welding |
| Source reference | ISO 3.4; 9.2.2; 9.4.1; Dori §5.2.4 |
| Assumption | false |

## 4.5 Instrument link

| Field | Content |
|---|---|
| Definition | Enabling link from an instrument — an inanimate or otherwise non-decision-making enabler — to the process, which cannot start or take place without the instrument's existence and availability (ISO 9.2.3 ¶889–892) |
| Source → Target | instrument object (or its state) → process |
| Meaning | Required but neither consumed nor changed (wear and tear disregarded; if change matters, model the object as affectee instead — Dori §5.2.5) |
| Graphical notation | Line from instrument to process ending in an empty ("white lollipop") circle (ISO ¶893) |
| OPL | `Processing requires Instrument.` (ISO ¶895). State-specified: `Processing requires specified-state Instrument.` e.g. `Moving requires serviced Moving Truck.` (ISO 9.4.2 ¶1056, Fig. 12) |
| Validation rules | P-I1 source object/state, target process. P-I2 instrument is non-human (ISO 3.30). P-I3 unchanged by the process (else remodel as affectee). P-I4 must exist throughout performance; disappearance aborts the process (ISO 9.2.1 ¶862–864) |
| Software hints | dependency/resource (service, device, file read-only, algorithm, configuration). Defer. |
| Example | `Sintering requires Sintering Oven.` (ISO Fig. 9) |
| Semantic mapping | Sintering Oven = instrument (enabler); Insert Set = affectee of the same process |
| Source reference | ISO 3.30; 9.2.3; 9.4.2; Dori §5.2.5 |
| Assumption | false |

## 4.6 Condition link (control link family, modifier "c")

| Field | Content |
|---|---|
| Definition | A procedural link from an object or object state to a process annotated with the control modifier "c", adding **skip semantics**: if the source operational instance does not exist (or is not at the specified state), the precondition fails and execution control bypasses the process instead of waiting (ISO 3.9; 9.5.1 ¶1094–1096; 8.2.3) |
| Source → Target | object or object state → process. Each incoming transforming/enabling link kind has a condition counterpart: condition consumption, condition effect, condition agent, condition instrument, plus state-specified variants (ISO 9.5.3) |
| Meaning | "Occur if, else skip" — contrast with the unmodified state-specified link, which means "wait until". IMPORTANT: the requirement "process occurs only if object is in state s" with *wait* semantics is a plain **state-specified link**, NOT a condition link (resolution C-1 in file 01) |
| Graphical notation | The underlying link with a small "c" near the process end/arrowhead (ISO ¶1106–1109) |
| OPL (ISO canonical) | Condition consumption: `Process occurs if Object exists, in which case Object is consumed, otherwise Process is skipped.` (ISO ¶1241). Condition instrument: `Process occurs if Instrument exists, else Process is skipped.` (ISO ¶1295). Condition agent: `Agent handles Process if Agent exists, else Process is skipped.` (ISO ¶1279). Condition state-specified consumption: `Process occurs if Object is specified-state, in which case Object is consumed, otherwise Process is skipped.` (ISO ¶1327). Condition input-output effect: `Process occurs if Object is input-state, in which case Process changes Object from input-state to output-state, otherwise Process is skipped.` (ISO ¶1346). Condition state-specified instrument: `Process occurs if Instrument is specified-state, otherwise Process is skipped.` (ISO ¶1419). Condition state-specified agent: `Agent handles Process if Agent is specified-state, else Process is skipped.` (ISO ¶1401). Each has an "If … then … otherwise bypass Process." alternate form |
| Book (legacy) OPL | `Process occurs if Object is state.` (condition sentence); `Agent must be state for Process to occur.` (agent condition sentence) (Dori §5.3.3) |
| Validation rules | P-Co1 source must be an existing object or one of its permissible states. P-Co2 no condition modifier on outgoing (result) links (P-G5). P-Co3 skip overrides wait when mixed (ISO 8.2.3 ¶782–787). P-Co4 if any one condition fails, the process is skipped and control passes onward (ISO ¶788–790) |
| Software hints | guard clause / if-else branch; rule-engine condition; bypass path in a workflow. Defer. |
| Example | `Accessing occurs if Card is valid.` (Dori Fig. 5.15, legacy phrasing) |
| Semantic mapping | Card = conditioning object; state valid = required situation; Accessing skipped when not valid |
| Source reference | ISO 3.9; 8.2.3; 9.5.3; Dori §5.3.3 |
| Assumption | false |

## 4.7 Event links (control link family, modifier "e") — supplementary

Event link = control link denoting an initiating event from an object/state to a process (ISO 3.19, 9.5.2). Kinds mirror the incoming links: consumption event (`Object initiates Process, which consumes Object.` ISO ¶1119), effect event (`Object initiates Process, which affects Object.` ¶1128), agent event (`Agent initiates and handles Process.` ¶1139), instrument event (`Instrument initiates Process, which requires Instrument.` ¶1146), plus state-specified variants (e.g. `Input-state Object initiates Process, which changes Object from input-state to output-state.` ¶1167). Events are lost after precondition evaluation (ISO 9.5.1 ¶1089).

## 4.8 Invocation and exception links (process-to-process) — supplementary

- **Invocation link:** process → process; on completion the source immediately initiates the destination. OPL: `Invoking-process invokes invoked-process.`; self-invocation: `Invoking-process invokes itself.` Notation: jagged "lightning" arrow. Semantically implies a transient object created by the source and immediately consumed by the destination (ISO 9.5.2.5 ¶1206–1224). These are the only procedural links (with exceptions) directly connecting two processes (ISO 3.57 NOTE 2).
- **Overtime exception link:** `Overtime Handling Process occurs if duration of Source Process exceeds max-duration time-units.` (ISO 9.5.4.2 ¶1447). **Undertime exception link:** `Undertime Handling Process occurs if duration of Source Process falls short of min-duration time-units.` (ISO 9.5.4.3 ¶1456). Notation: one (overtime) or two (undertime) short bars crossing the link near the handling process.

## 4.9 Source/target legality matrix (procedural)

| Link | Object→Proc | State→Proc | Proc→Object | Proc→State | Proc→Proc |
|---|---|---|---|---|---|
| Consumption | yes | yes (state-specified) | no | no | no |
| Result | no | no | yes | yes (state-specified) | no |
| Effect | yes (bidirectional) | yes (input link) | yes (bidirectional) | yes (output link) | no |
| Agent | yes | yes | no | no | no |
| Instrument | yes | yes | no | no | no |
| Condition (any kind) | yes | yes | no | no | no |
| Event (any kind) | yes | yes | no | no | no |
| Invocation | no | no | no | no | yes |
| Exception | no | no | no | no | yes |

Forbidden in all cases: object→object or state→state procedural links; procedural links between two objects; structural links between an object and a process (except exhibition).
