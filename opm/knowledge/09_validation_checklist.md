# 9. Pre-Generation Validation Checklist

Run top to bottom before any software generation. Each item cites its rule(s).

1. [ ] Every model element is classified as object, process, or state (state owned by exactly one object). — VR-01, E101/E102
2. [ ] Every link is classified as structural or procedural (control links = procedural). — VR-02
3. [ ] Every link has legal source and target types per the legality matrices (structural: like-kind except exhibition; procedural: object/state↔process; invocation/exception: process→process). — VR-03, VR-04
4. [ ] Every graphical relation has exactly one equivalent OPL sentence matching its ISO template, and every sentence has a construct. — VR-12
5. [ ] Every process has: ≥1 transforming link; non-empty preprocess and postprocess object sets; identified enablers (agents/instruments) where required. — VR-06, E601
6. [ ] Every stateful object's transitions are valid: referenced states permissible, s1≠s2 for input-output pairs, default-state rule for input-specified effects, ≤1 default state. — VR-08, VR-14, VR-15
7. [ ] Every condition link refers to an existing object or a valid object state, and carries explicit skip semantics. — VR-17, P-Co1
8. [ ] Every instrument link refers to a non-human object the process requires but does not transform. — P-I2, P-I3
9. [ ] Every agent link refers to a human/organizational object capable of enabling/handling the process and not transformed by it. — P-A1–P-A3
10. [ ] Every consumption link identifies a consumee (preprocess set only; not also a resultee of the same process). — P-C1–P-C3
11. [ ] Every result link identifies a resultee (postprocess set only; no control modifier; not aimed at an initial state). — P-R1–P-R3, VR-09, VR-10
12. [ ] Every effect link identifies a stateful affectee whose state the process changes. — VR-07
13. [ ] Every structural link expresses a valid static relation: Perseverance preserved (aggregation/generalization); attribute=object, operation=process (exhibition); instance values within class ranges (instantiation); tags meaningful (tagged). — VR-11, V-S5, V-S10
14. [ ] No procedural-link uniqueness violations (one link, one role per object/state–process pair per abstraction level). — VR-05
15. [ ] No fact contradictions across OPDs; refinements verified as refinements. — VR-13
16. [ ] Link fans have declared AND/XOR/OR semantics. — VR-16
17. [ ] All ambiguities flagged with explicit assumptions (wait-vs-skip, agent-vs-transformee, fan semantics, boundary affiliation, missing SD/function). — Check 7
18. [ ] Assumption log reviewed and acknowledged; report `ready: true`.
19. [ ] **No software artifact is generated before items 1–18 pass.** — VR-20
