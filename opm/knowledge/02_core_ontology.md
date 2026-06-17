# 2. Core OPM Ontology

All clause references "ISO x.y ¶n" cite ISO/PDPAS 19450 (2014), clause x.y, numbered paragraph n. "Dori §x.y" cites Dori, *Object-Process Methodology* (2002).

## 2.1 The minimal universal ontology

OPM is built from exactly two kinds of model **elements**: **things** and **links** (ISO 3.16, 6.2.2 ¶476–479).

- **Thing** = object or process (ISO 3.76).
- **Entity** (founder term, not in ISO) = thing or state, i.e., {object, process, state} (Dori §4.3.1: "State and Thing are Entities. Object and Process are Things.").
- **State** is NOT a thing. It is a situational refinement that belongs to exactly one object (ISO 3.68, 7.3.5.1 ¶668).
- **Link** = graphical expression of a structural or procedural relation between two OPM things (ISO 3.36); procedural links may also attach to a *state* of an object (ISO 8.1.3).

So the strict ontology is: Objects, Processes, States as entities; structural and procedural relations among them; everything else (agent, instrument, consumee, attribute, whole, part, general, class…) is a **role** an object/process plays with respect to a relation, not a new element kind (ISO 8.1.1 NOTE ¶731; Dori §5.2.7 "a transformee is a role").

## 2.2 Object

- **Definition (ISO 3.39):** "model element representing a thing that does or might exist physically or informatically."
- **Semantics (ISO 7.1.1 ¶564–569):** an object exists or has the potential of physical or informatical existence; its existence is *persistent* — as long as no process acts on it, it remains in its current implicit or explicit state. A model object is an abstract category (pattern) for operational instance objects.
- **Founder definition (Dori §4.4, OCR-restored):** "An object is a thing that has the potential of stable, unconditional physical or mental existence."
- **Notation (ISO 7.1.2 ¶571):** rectangle containing the object name. Physical objects: shaded; environmental objects: dashed contour (ISO 7.3.3 ¶636).
- **OPL form:** name in **bold**, each word capitalized (ISO 7.1.2 ¶573).
- **NOT (premature software mapping forbidden):** an object is not automatically a database table, class, or record; it may be physical (Machine, Person) or informatical (File, Order). Mapping decisions belong to a later phase.

## 2.3 Process

- **Definition (ISO 3.58):** "transformation of one or more objects in the system."
- **Semantics (ISO 7.2.1 ¶579–584):** a process transforms one or more objects by **generation** (creation), **effect** (state change), or **consumption** (elimination); it has positive time duration; it cannot exist in isolation — "a process is always associated with and occurs or happens to one or more objects" (ISO 6.2.3 ¶495–496). A model process is an abstract pattern; a process instance is a specific occurrence.
- **Founder definition (Dori front matter / §4.4):** "A process is a pattern of transformation that an object undergoes."
- **Process state:** OPM has **no process states** ("started/finished"); status is modeled via subprocesses (ISO 3.68 NOTE ¶276–278).
- **Persistent processes (ISO 7.2.1 NOTE 2 ¶587–593):** some processes maintain state rather than change it (Existing, Holding, Waiting…).
- **Notation (ISO 7.2.2 ¶595):** ellipse containing the process name; same shading/dash conventions as objects.
- **OPL form:** name in **bold**, each word capitalized; gerund ("-ing") naming is the founder convention (Dori front matter).
- **Object-process test (ISO 7.3.2 ¶610–619):** a noun denotes a process iff it satisfies ALL three criteria: (1) time association; (2) verb association; (3) it transforms (or state-maintains) at least one object. Default: a noun is an object.

## 2.4 State

- **Definition (ISO 3.68):** "<object> possible situation or position of an object."
- **Semantics (ISO 7.3.5.1 ¶668–673):** a state has meaning only in the context of the object that owns it. A **stateless object** has no specified states; a **stateful object** has a specified set of permissible states. At runtime a stateful object instance is always at exactly one permissible state or *in transition between two states* under an affecting process.
- **Initial / default / final states (ISO 7.3.5.3 ¶685–693):** initial = state at system start or upon generation; final = state at completion or upon consumption; default = most likely state on random inspection. An object may have 0+ initial, 0+ final, 0–1 default states; the same state may combine roles.
- **Attribute values (ISO 7.3.5.5 ¶707–713; 10.3.3.2.1 ¶1638):** a **value is a state of an attribute** (an attribute being an object that characterizes another thing, ISO 3.5). Measurement units appear in brackets in the OPD and inline in OPL.
- **Notation (ISO 7.3.5.2 ¶677):** "rountangle" (rounded-corner rectangle) inside the owning object. Initial: thick contour; final: double contour; default: diagonal open arrow (ISO 7.3.5.4 ¶696).
- **OPL forms (ISO Fig. 5, Fig. 6):**
  - `Object can be state1 or state2.` / `Object can be state1, state2, or state3.`
  - `State s of Object is initial.` / `… is default.` / `… is final.`
  - State labels: bold, NOT capitalized (except sentence-initial) (ISO 7.3.5.2 ¶678; 9.4.1 NOTE ¶1047).

## 2.5 Object state transition

OPM has no separate "transition" element. A state transition is expressed *only* by **effect links** between a process and an object/its states (ISO 9.1.4, 9.3.3):

| Pattern | Links | OPL | Pre/postcondition |
|---|---|---|---|
| input-output-specified effect | state s1 → Process, Process → state s2 (same object) | `Process changes Object from s1 to s2.` | pre: Object at s1; post: Object at s2 (ISO 9.3.3.2 ¶969–980) |
| input-specified effect | state s1 → Process, Process → Object | `Process changes Object from s1.` | post-state = default state or per state probability distribution (ISO 9.3.3.3 ¶1012–1023) |
| output-specified effect | Object → Process, Process → state s2 | `Process changes Object to s2.` | pre: Object exists in any state (ISO 9.3.3.4 ¶1025–1034) |
| plain effect | Object ↔ Process | `Process affects Object.` | unspecified state change (ISO 9.1.4 ¶848–852) |

During the process, the affectee is **in transition** between the two states and unavailable at either (ISO 9.3.3.2 NOTE 1 ¶985–987). If the process aborts, the state is indeterminate unless exception handling resolves it (ISO 9.3.3.2 NOTE 2 ¶1009–1010). Only stateful objects can be affected; stateless objects can only be created or consumed (ISO 3.3 NOTE ¶29).

## 2.6 Object-process relations

Two disjoint relation families (ISO 6.2.4 ¶502–506):

- **Procedural relation:** connection between an object (or object state) and a process specifying how the system operates: time-dependent or conditional initiating of processes that transform objects (ISO 3.57). Expressed by procedural links (transforming, enabling, control — ISO 8.1.1 ¶721–730).
- **Structural relation:** operationally invariant, time-independent association between things, persisting for at least some interval (ISO 3.73). Expressed by structural links (tagged + four fundamental relations — ISO 10.1).

**Roles of objects relative to a process** (ISO 8.1.1, Dori §5.2):
- transformee = consumee | resultee | affectee (ISO 3.78, 3.10, 3.64, 3.3)
- enabler = agent (human) | instrument (non-human) (ISO 3.17, 3.4, 3.30)
- initiator (event source) and conditional object (control links, ISO 8.1.2 ¶736).

**Preprocess / postprocess object sets (ISO 8.2.2 ¶757–772):** the preprocess set (consumees, affectees, enablers — possibly state-specified) determines the precondition; the postprocess set (resultees, affectees, enablers) determines the postcondition. Every process shall have a non-empty preprocess set and a non-empty postprocess set. Consumees only pre; resultees only post; enablers and affectees in both.

## 2.7 Diagram meaning: OPD and OPL

- **OPD (ISO 3.41):** the graphic representation of an OPM model or part of one: objects, processes, and the structural/procedural links among them. One OPD = one model **context** (ISO 3.11, 6.2.5).
- **OPL (ISO 3.42):** "subset of English natural language that represents textually the OPM model that the OPD represents graphically."
- **Bimodality principle (ISO 6.2.1 ¶463–465):** every OPM model shall be expressed in *semantically equivalent* graphics and text; each OPD has an equivalent OPL paragraph; each link + its source and destination things is an **OPM construct** with a corresponding OPL sentence (ISO 6.2.2 ¶485–486). OPD and OPL are NOT two models — they are two renderings of one model.
- **System Diagram SD (ISO 3.75):** root OPD showing one systemic process (the function) and the objects connected to it; root of the OPD process tree (ISO 3.45).
- **Context/refinement mechanisms (ISO 14.2.1):** state expression/suppression, unfolding/folding, in-zooming/out-zooming. New-diagram in-zooming/unfolding link contexts (ISO 6.2.5 ¶517–519).

## 2.8 Model consistency

- **Fact consistency principle (ISO 14.2.3 ¶2638–2643):** (1) a model fact appearing in one OPD is true for the whole OPD collection of the model; (2) no OPD may contain a model fact contradicting a fact in the same or another OPD. A fact may be a refinement or abstraction of a fact elsewhere (e.g., "P affects A." vs "P changes A from s1 to s2." is refinement, not contradiction; "P yields A." vs "P consumes A." is contradiction — ISO 14.2.3 EXAMPLE ¶2648–2651).
- **Procedural link uniqueness principle (ISO 8.1.2 ¶733–737):** a process shall connect with a transforming link to at least one object or object state; at a given extent of abstraction an object or any one of its states has exactly ONE role w.r.t. a given process and links to it by exactly ONE procedural link.
- **Link precedence / semantic strength (ISO 14.2.4.1.4 ¶2712–2726):** when abstraction forces competing links, the surviving link is chosen by the strength order: consumption event > consumption = result > consumption condition > effect event > effect > effect condition > agent event > agent > agent condition > instrument event > instrument > instrument condition.
- **Operational semantics — Event-Condition-Action (ISO 8.2.1 ¶743–756):** an event (object creation/appearance/state entry) triggers evaluation of the precondition of each process the object links to as source; the event is then lost; the process performs iff the precondition holds. Skip semantics of condition links override wait semantics of non-condition links (ISO 8.2.3 ¶775–790).

## 2.9 OPM thing generic properties (ISO 7.3.3 ¶624–638)

Every thing has exactly three generic properties:

| Property | Values | Default | Notation |
|---|---|---|---|
| Perseverance | static (object) / dynamic (process) [boundary: persistent] | — (determined by kind) | rectangle vs ellipse |
| Essence | physical / informatical | system's Primary Essence (ISO 3.55, 7.3.4 ¶656–659) | shaded vs plain |
| Affiliation | systemic / environmental | systemic (ISO 7.3.4 ¶651) | solid vs dashed contour |

OPL: `Thing is physical.` / `Thing is environmental and physical.` etc.; defaults are not expressed in OPL once the thing is linked (ISO 7.3.4 ¶662–664).

## 2.10 Strict separation from software concepts (Phase-1 discipline)

Per the sources, OPM is implementation-neutral: objects may be physical or informatical, processes are transformations (not function calls), states are situations (not data fields). The conceptual model vs. runtime model distinction (ISO 6.2.6.1) shows that behavior exists only when *operational instances* exist. Therefore in this KB:
- object ≠ table/class (it is a category of existents);
- process ≠ endpoint/function (it is a transformation pattern with duration, pre/postconditions, and an involved object set);
- state ≠ column/enum (it is a situational classification owned by one object, with initial/default/final semantics and in-transition periods).
Software interpretations appear only in `software_hints` fields for later phases.
