# 3. Structural Link Rules

Structural links express static, time-independent, long-lasting relations (ISO 10.1 ¶1467). **Global constraint:** a structural link connects two or more objects, or two or more processes, but NOT an object and a process — except exhibition-characterization (ISO 10.1 ¶1467–1469). The four fundamental relations each refine one source thing (the **refineable**) into one or more destination things (**refinees**) (ISO 10.3.1 ¶1527–1529). Forward names (refineable side): aggregation, exhibition, generalization, classification; complementary names (refinee side): participation, characterization, specialization, instantiation (ISO 10.3.1 ¶1538–1541). Fundamental relations are bidirectional but expressed by ONE default OPL sentence (ISO 10.3.1 ¶1547–1551).

---

## 3.1 Aggregation-Participation

| Field | Content |
|---|---|
| Link name | Aggregation-participation relation link |
| Source (refineable) | Whole — object or process |
| Target (refinees) | Part(s) — same Perseverance as the whole (all objects or all processes) (ISO 10.3.1 ¶1542–1543) |
| Meaning | The whole aggregates one or more parts (whole-part relation) (ISO 10.3.2 ¶1556) |
| Graphical notation | Solid black (filled) triangle; apex line to the whole, base lines to the parts (ISO ¶1558). Incomplete part set: short horizontal bar below the triangle (ISO ¶1568) |
| OPL template | `Whole consists of Part1, Part2, …, and Partn.` (ISO ¶1560) — incomplete: `Whole consists of Part1, …, Partk, and at least one other part.` (ISO ¶1570–1572) |
| Validation rules | V-S1: whole and all parts share Perseverance (no object-whole with process-parts). V-S2: a whole has ≥1 part shown; incomplete sets must carry the incompleteness annotation. V-S3: aggregation can form hierarchies (Dori front matter). |
| Software hints (later phases only) | composition/containment; component lists; BOM structures. NOT automatically a foreign key — physical assemblies and process decompositions also use it. |
| Example sentence | `Resource Description Framework Statement consists of Subject, Predicate, and Object.` (ISO Fig. 16) |
| Example semantic mapping | Whole=RDF Statement (object); Parts=Subject, Predicate, Object (objects); relation=whole-part, static |
| Source reference | ISO 10.3.2 ¶1555–1586; Dori §1.2/front matter ("Relates a whole to its parts") |
| Assumption | false |

## 3.2 Exhibition-Characterization

| Field | Content |
|---|---|
| Link name | Exhibition-characterization relation link |
| Source (refineable) | Exhibitor — object or process |
| Target (refinees) | Feature(s): **attribute** = feature that is an object; **operation** = feature that is a process (ISO 10.3.3.1 ¶1592) |
| Meaning | The exhibitor exhibits features that characterize it (thing-characteristic relation). All four exhibitor-feature combinations are legal: object-attribute, object-operation, process-attribute, process-operation (ISO ¶1595) |
| Graphical notation | Small black triangle inside a larger empty triangle; apex to exhibitor, base to features (ISO ¶1601). Incomplete: short bar below the triangle (ISO ¶1614) |
| OPL template | Object exhibitor: `Exhibitor exhibits Attribute1, …, and Attributen, as well as Operation1, …, Operationm.` (attributes before operations) (ISO ¶1604–1606). Process exhibitor: operations before attributes (ISO ¶1607–1609). Exhibitor-of-feature: `Feature of Exhibitor …` (ISO 10.3.3.2.2 ¶1646). Attribute values: `Attribute of Exhibitor can be v1, v2, and v3.` / `… ranges from x to y.` (ISO Fig. 25, Fig. 26) |
| Validation rules | V-S4: exhibition is the ONLY structural link that may cross the object-process boundary (ISO 10.1 ¶1469). V-S5: an attribute is an object; an operation is a process; an attribute's states are its values (ISO 10.3.3.2.1 ¶1638). V-S6: exhibitor has ≥1 feature (ISO ¶1593). |
| Software hints | attributes → fields/properties; operations → methods/behaviors of the owning concept; value sets/ranges → domain constraints. Defer realization. |
| Example sentence | `Vehicle exhibits Travelling Medium.` / `Travelling Medium of Vehicle can be ground, air, and water surface.` (ISO Fig. 25) |
| Example semantic mapping | Exhibitor=Vehicle (object); Attribute=Travelling Medium (object); its states = values {ground, air, water surface} |
| Source reference | ISO 10.3.3 ¶1587–1650; Dori front matter ("Relates an exhibitor to its attributes") |
| Assumption | false |

## 3.3 Generalization-Specialization

| Field | Content |
|---|---|
| Link name | Generalization-specialization relation link |
| Source (refineable) | General — object or process |
| Target (refinees) | Specialization(s) — same Perseverance as the general (ISO 10.3.4.1 ¶1655–1656) |
| Meaning | The general generalizes its specializations; specializations inherit from the general (is-a relation) |
| Graphical notation | Empty (blank) triangle; apex to general, base to specializations (ISO ¶1657). Incomplete: short bar below the triangle (ISO ¶1668) |
| OPL template | Single: `Specialization is a General.` (ISO Fig. 24: "Digital Camera is a Camera."). Plural complete: `Spec1, Spec2, …, and Specn are General.` (ISO ¶1660–1665). Incomplete: `Spec1, …, Speck, and other specializations are General.` (ISO ¶1670–1675) |
| Inheritance (ISO 10.3.4.2 ¶1682–1691) | A specialization inherits ALL four inheritable element kinds of the general: (1) parts (aggregation), (2) features (exhibition), (3) tagged structural links, (4) procedural links. Multiple inheritance is allowed. Overriding a participant is allowed via a renamed specialization of it (ISO ¶1692–1694). |
| Discriminating attribute (ISO 10.3.4.3 ¶1708–1730) | An inherited attribute whose distinct values identify the specializations; expressed via the **state-specified characterization link**: `Specialized-object exhibits value-name Attribute-Name.` (ISO 10.4.1 ¶1811). Max specializations for several discriminating attributes = Cartesian product of value counts. |
| Validation rules | V-S7: general and specializations all objects or all processes. V-S8: a specialization instance cannot exist at runtime without its general (ISO 10.3.4.2 NOTE ¶1695–1697). V-S9: inherited attribute values of a specialization must lie within the general's permissible value set. |
| Software hints | inheritance/subtyping/taxonomy; discriminating attribute → discriminator value. Defer realization. |
| Example sentence | `Car, Aircraft, and Ship are Vehicles.` (ISO Fig. 25) |
| Example semantic mapping | General=Vehicle; Specializations=Car, Aircraft, Ship; discriminating attribute Travelling Medium with one fixed value per specialization |
| Source reference | ISO 10.3.4 ¶1651–1735; Dori front matter ("Relates a general thing to its specializations") |
| Assumption | false |

## 3.4 Classification-Instantiation

| Field | Content |
|---|---|
| Link name | Classification-instantiation relation link |
| Source (refineable) | Class — object class or process class (ISO 3.40, 3.59) |
| Target (refinees) | Instance(s) — refinee instances whose attribute slots carry explicit values (ISO 10.3.5.1 ¶1738–1743) |
| Meaning | The class is a pattern; instances are identifiable incarnations created by providing values for the pattern's qualities. Distinguish *refinee instance* (model element) from *operational instance* (runtime occurrence) (ISO ¶1744–1746) |
| Graphical notation | Small filled black circle inside an otherwise empty triangle; apex to class, base to instances (ISO ¶1753) |
| OPL template | `Instance is an instance of Class.` (ISO ¶1756–1759); plural: `Instance1, Instance2, …, and Instancen are instances of Class.` (ISO ¶1760–1763) |
| Validation rules | V-S10: instance attribute values must lie within the class's specified value range (ISO ¶1750–1752). V-S11: no complete/incomplete distinction for instance collections (ISO NOTE 3 ¶1764). V-S12: instantiation does not generate a hierarchy (an instance is not further instantiable), unlike the other three fundamental relations (Dori front matter — **assumption-level for ISO**, explicit only in the book). V-S13: a process instance is identified by its involved object instances and its start/end timestamps (ISO 3.29 NOTE, 10.3.5.2 ¶1789–1794). |
| Software hints | class-instance; configuration data; test fixtures; named singletons. Defer realization. |
| Example sentence | `Jack Robinson is an instance of Adult.` with `Gender of Jack Robinson is male.` (ISO Fig. 26) |
| Example semantic mapping | Class=Adult (attributes Gender, Height, Weight with value sets/ranges); Instance=Jack Robinson with concrete values inside ranges |
| Source reference | ISO 10.3.5 ¶1736–1797; Dori front matter ("Relates a class of things to its instances") |
| Assumption | false (V-S12 partially book-only) |

## 3.5 Tagged structural links (general structural relations)

| Variant | Notation | OPL | Source |
|---|---|---|---|
| Unidirectional tagged | open-arrowhead arrow + tag text | `Source tag Destination.` (tag in bold) | ISO 10.2.1 ¶1474–1483 |
| Unidirectional null-tagged | same, no tag | `Source relates to Destination.` (default tag "relates to") | ISO 10.2.2 ¶1485–1488 |
| Bidirectional tagged | harpoon arrowheads both ends, tag per direction | two unidirectional sentences, one per direction | ISO 10.2.3 ¶1492–1500 |
| Reciprocal tagged | bidirectional with one tag or none | `A and B are reciprocity-tag.` / `A and B are related.` (default "are related") | ISO 10.2.4 ¶1509–1515 |

Validation: V-S14 — tagged structural links connect object↔object or process↔process, never object↔process (ISO 10.1 ¶1467–1469; Dori front matter: "Cannot be used to link an object to a process"). State-specified tagged structural variants exist (ISO 10.4.2).

## 3.6 Structural links: what they are NOT

Structural links carry **no execution semantics**: no triggering, no transformation, no temporal ordering (except the static ordering implied by in-zoom layout). They must never be compiled into runtime control flow. Conversely, they participate in **inheritance** (generalization) and **refinement/abstraction** (folding/unfolding of parts, features, specializations, instances — ISO 3.22, 14.2.1.2).
