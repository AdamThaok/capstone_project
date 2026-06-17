# 8. OPM Semantic Validator Specification

The validator consumes a parsed OPM model (things, states, links, OPDs, OPL sentences) and emits a validation report. It generates **no code**. It runs the eight checks below in order; checks 1–6 gate check 8's "ready" verdict. Severity levels: `error` (blocks code generation), `warning` (must be acknowledged), `assumption` (logged, must be confirmed or carried forward explicitly).

## Check 1 — Element validation

- **Input:** all model nodes.
- **Checks:** each node is exactly one of {object, process, state}; each state has exactly one owning object; each thing has a unique name (per model context disambiguation, ISO 6.2.5 ¶521–523); generic properties valid (Perseverance/Essence/Affiliation); object-process test heuristics for suspicious names (process without verb/time association; object named as gerund).
- **Expected output:** classified element table.
- **Failure conditions / messages:**
  - `E101 Unclassified element '<name>'.`
  - `E102 State '<s>' has no owning object.` (ISO 7.3.5.1)
  - `E103 Duplicate thing name '<name>' without disambiguating refineable relation.` (ISO 6.2.5)
  - `W104 Thing '<name>' fails/ambiguously passes the object-process test; verify kind.` (ISO 7.3.2)
  - `E105 Object '<o>' has more than one default state.` (ISO 7.3.5.3)
- **Example:** "Approval" named as object but used only as the target of "yields" and source of "occurs if" — passes (object with states); "Approving" declared object → W104.

## Check 2 — Link validation

- **Input:** all links + endpoint kinds.
- **Checks:** each link is a known structural or procedural kind; endpoints legal per the legality matrix (file 04 §4.9, file 03 §3.5); Perseverance preservation for aggregation/generalization; condition/event modifiers only on incoming links; exhibition is the only object↔process structural relation.
- **Expected output:** classified link table.
- **Failure conditions / messages:**
  - `E201 Structural link '<kind>' between object '<o>' and process '<p>' (only exhibition may cross kinds).` (ISO 10.1)
  - `E202 Procedural link '<kind>' with illegal source/target.` (ISO 9, matrix)
  - `E203 Control modifier on outgoing result link from '<p>' to '<o>'.` (ISO 8.2.3 NOTE 1)
  - `E204 Aggregation/generalization mixing objects and processes.` (ISO 10.3.1 ¶1542, 10.3.4.1 ¶1655)
- **Example:** invocation link from object → E202.

## Check 3 — OPL equivalence validation

- **Input:** OPD constructs + OPL paragraph(s).
- **Checks:** bijection between constructs and sentences; each sentence matches the canonical template for its link kind (file 05); typography (bold names, lowercase states); AND lists merged into single sentences.
- **Expected output:** construct↔sentence alignment map.
- **Failure conditions / messages:**
  - `E301 Construct <link-id> has no OPL sentence.` (ISO 6.2.2 ¶485–486)
  - `E302 OPL sentence '<s>' has no corresponding construct.`
  - `W303 Sentence '<s>' deviates from ISO template '<template-id>'.`
- **Example:** `Welding consumes Steel Part A and Steel Part B.` must correspond to exactly two consumption links AND-grouped.

## Check 4 — State transition validation

- **Input:** stateful objects + effect/result/consumption link families.
- **Checks:** referenced states ∈ owning object's permissible set; input-output pairs have s1≠s2 on the same object; input-specified effect has default state or probability distribution; affectees stateful; result links do not target initial states (warning); initial/final/default markers consistent.
- **Expected output:** per-object state machine derived solely from effect links, with pre/post annotations.
- **Failure conditions / messages:**
  - `E401 State '<s>' referenced by link <id> is not a permissible state of '<o>'.`
  - `E402 Affectee '<o>' is stateless.` (ISO 3.3 NOTE)
  - `E403 Input-output effect on '<o>' with identical input and output state.`
  - `E404 Input-specified effect on '<o>' but no default state or distribution.` (ISO 9.3.3.3)
  - `W405 Result link targets initial state of '<o>'; attach to object instead.` (ISO 9.3.2 ¶954)
- **Example:** `Purifying changes Copper from raw to pure.` → raw, pure verified as Copper states.

## Check 5 — Structural consistency validation

- **Input:** structural links, inheritance graph.
- **Checks:** no cycles in aggregation/generalization hierarchies of a thing with itself (acyclicity — **assumption A-V1**: not explicit in sources, inferred from refinement semantics); inherited attribute values within general's ranges; discriminating attribute values unique per specialization; instance values within class ranges; incomplete refinee collections carry the incompleteness annotation; instantiation not chained (book rule V-S12).
- **Expected output:** refinement forest + inheritance closure.
- **Failure conditions / messages:**
  - `E501 Value '<v>' of instance '<i>' outside class range of '<attr>'.` (ISO 10.3.5.1 ¶1750)
  - `E502 Generalization cycle involving '<t>'.` (assumption A-V1)
  - `W503 Refinee collection of '<t>' marked complete but known parts missing.`
  - `E504 Instance '<i>' used as a class.` (Dori front matter; assumption w.r.t. ISO)
- **Example:** Jack Robinson Height 185 ∈ [120,240] → pass.

## Check 6 — Procedural consistency validation

- **Input:** processes + procedural links + OPD tree.
- **Checks:** every process has ≥1 transforming link; pre/post sets non-empty; role uniqueness per object-process pair at each abstraction level; fact consistency across OPDs (yields vs consumes conflicts); event link constraint and link distribution rules for in-zoomed contexts (ISO 14.2.2.4); semantic-strength resolution applied on out-zoom.
- **Expected output:** per-process contract: preprocess set (with states/conditions/events), postprocess set, enablers, invocations.
- **Failure conditions / messages:**
  - `E601 Process '<p>' transforms no object.` (ISO 8.1.2 ¶734)
  - `E602 Object '<o>' has two procedural links to process '<p>' at one abstraction level.` (ISO 8.1.2)
  - `E603 Contradicting facts: '<p> yields <o>' and '<p> consumes <o>'.` (ISO 14.2.3)
  - `W604 Out-zoom link conflict on '<o>'-'<p>' resolved to '<kind>' by semantic strength.` (ISO 14.2.4.1.4)
- **Example:** a process linked only to an instrument → E601.

## Check 7 — Ambiguity detection

- **Input:** whole model + import metadata.
- **Checks:** wait-vs-skip intent for state requirements (conflict C-1); link fans without declared XOR/OR semantics; null tags; agents that may be transformees (Dori §5.2.4 test); environmental/systemic boundary unassigned; missing system function/SD.
- **Expected output:** ambiguity list, each with the documented default applied.
- **Messages:** `A701 '<o>' state requirement on '<p>' interpreted as state-specified (wait); confirm skip semantics not intended.` `A702 Link fan at '<p>' lacks XOR/OR declaration.` `A703 Agent '<o>' may be transformed by '<p>'; confirm role.` `A704 No System Diagram / function process identified.` (ISO 6.1.3)

## Check 8 — Assumption logging & readiness verdict

- **Input:** outputs of checks 1–7.
- **Output:** machine-readable report `{errors[], warnings[], assumptions[], ready: bool}`. `ready = (errors == 0) AND (every assumption explicitly acknowledged)`. Only a `ready: true` report authorizes Phase-2+ artifact generation (rule VR-20).
- **Failure condition:** any unresolved error or unacknowledged assumption ⇒ `ready: false`, message `A801 Semantic validation incomplete; code generation blocked.`
