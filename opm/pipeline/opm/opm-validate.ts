// OPM diagram validation gate (ISO 19450 / Dori, driven by knowledge/ rules).
//
// Returns { errors, warnings }.
// • errors   — BLOCKING: pipeline cannot produce a faithful artifact.
//              Only ERR-FUNC-001 (no processes at all).
// • warnings — NON-BLOCKING advisories: naming / style / connectivity, plus
//              link-legality (WARN-LINK-E202/E204, VR-03/VR-04). Link legality is
//              advisory because the vision parser mislabels element kinds/directions
//              often enough that hard-blocking would false-positive on valid models.
//
// Design rationale: naming rules (NAM-*) and connectivity (STR-001) are
// advisory. Link-legality errors only fire when BOTH endpoints resolve to a
// known element kind — parsers vary, and a false positive here would wrongly
// block code generation.

export type OpmModel = {
    objects?:   { id?: string; name?: string; states?: (string | { name?: string })[] }[];
    processes?: { id?: string; name?: string }[];
    links?:     { id?: string; type?: string; from?: string; to?: string }[];
    [k: string]: unknown;
};

export function validateOpmModel(model: OpmModel): { errors: string[]; warnings: string[] } {
    const errors:   string[] = [];
    const warnings: string[] = [];

    const objects   = model.objects   ?? [];
    const processes = model.processes ?? [];
    const links     = model.links     ?? [];

    const allNames: string[] = [];

    // Words that end in 's' but are unambiguously singular in English.
    const SINGULAR_S_SUFFIXES = [
        "ss", "us", "ous", "ias", "is", "as", "es",
        "ness", "ress", "cess", "ress", "ics", "tics",
    ];
    const SINGULAR_S_WORDS = new Set([
        "address", "status", "process", "class", "basis", "axis",
        "analysis", "synthesis", "hypothesis", "thesis", "crisis",
        "emphasis", "canvas", "atlas", "bonus", "campus", "chorus",
        "focus", "radius", "nexus", "corpus", "virus", "genius",
        "series", "species", "means", "news", "mathematics", "physics",
        "logistics", "ethics", "politics", "economics", "electronics",
        "details", "credentials", "controls", "roles", "rules",
        "sales", "tools", "goals", "skills", "results",
    ]);

    // ---- Process naming rules (ISO 19450 §6.3) ----
    for (const proc of processes) {
        const name = (proc.name ?? "").trim();
        if (!name) continue;
        allNames.push(name);

        // WARN-NAM-001: should end with -ing (gerund)
        const lastWord = name.split(" ").pop() ?? "";
        if (!lastWord.toLowerCase().endsWith("ing")) {
            warnings.push(
                `WARN-NAM-001: התהליך "${name}" אינו מסתיים ב-"-ing". ` +
                `מומלץ להשתמש בגרונד (למשל: "${lastWord}ing"). (ISO 19450 §6.3)`
            );
        }

        // WARN-NAM-002: Title Case
        const words = name.split(" ");
        if (words.some((w) => w.length > 0 && w[0] !== w[0].toUpperCase())) {
            warnings.push(
                `WARN-NAM-002: התהליך "${name}" אינו ב-Title Case. ` +
                `מומלץ להגדיל את האות הראשונה של כל מילה. (ISO 19450 §6.2)`
            );
        }
    }

    // ---- Object naming rules (ISO 19450 §6.2) ----
    for (const obj of objects) {
        const name = (obj.name ?? "").trim();
        if (!name) continue;
        allNames.push(name);

        // WARN-NAM-002: Title Case
        const words = name.split(" ");
        if (words.some((w) => w.length > 0 && w[0] !== w[0].toUpperCase())) {
            warnings.push(
                `WARN-NAM-002: האובייקט "${name}" אינו ב-Title Case. ` +
                `מומלץ להגדיל את האות הראשונה של כל מילה. (ISO 19450 §6.2)`
            );
        }

        // WARN-NAM-004: plural heuristic — only flag when highly confident.
        const lastWord = (words[words.length - 1] ?? "").toLowerCase();
        const isSingularSuffix = SINGULAR_S_SUFFIXES.some((sfx) => lastWord.endsWith(sfx));
        const isSingularWord   = SINGULAR_S_WORDS.has(lastWord);
        const isAllowed        = ["set", "group"].includes(lastWord);
        if (
            !isAllowed &&
            !isSingularSuffix &&
            !isSingularWord &&
            lastWord.length > 3 &&
            lastWord.endsWith("s")
        ) {
            warnings.push(
                `WARN-NAM-004: האובייקט "${name}" עשוי להיות בצורת רבים. ` +
                `אם מדובר באוסף, מומלץ להוסיף "Set" או "Group" ` +
                `(למשל: "${name} Set"). (ISO 19450 §6.2)`
            );
        }

        // WARN-NAM-003: state names must be lowercase
        for (const state of obj.states ?? []) {
            const stateName = (typeof state === "string" ? state : (state.name ?? "")).trim();
            if (stateName && stateName !== stateName.toLowerCase()) {
                warnings.push(
                    `WARN-NAM-003: המצב "${stateName}" של האובייקט "${name}" מומלץ להיות ` +
                    `באותיות קטנות (למשל: "${stateName.toLowerCase()}"). (ISO 19450 §7)`
                );
            }
        }
    }

    // WARN-NAM-005: duplicate names
    const seenNames = new Set<string>();
    for (const n of allNames) {
        const key = n.toLowerCase();
        if (seenNames.has(key)) {
            warnings.push(
                `WARN-NAM-005: שם כפול "${n}". ` +
                `מומלץ שלכל אובייקט ותהליך יהיה שם ייחודי. (ISO 19450 §6.2)`
            );
        }
        seenNames.add(key);
    }

    // ---- Connectivity (process must be linked) ----
    const processIdsWithLinks   = new Set<string>();
    const processNamesWithLinks = new Set<string>();
    for (const link of links) {
        const frm = (link.from ?? "").toLowerCase();
        const to  = (link.to  ?? "").toLowerCase();
        for (const proc of processes) {
            const pid  = (proc.id   ?? "").toLowerCase();
            const pnam = (proc.name ?? "").toLowerCase();
            if (pid  && (pid  === frm || pid  === to)) processIdsWithLinks.add(pid);
            if (pnam && (pnam === frm || pnam === to)) processNamesWithLinks.add(pnam);
        }
    }

    // WARN-STR-001 / E601 (advisory): process with no transforming link.
    for (const proc of processes) {
        const pid  = (proc.id   ?? "").toLowerCase();
        const pnam = (proc.name ?? "").toLowerCase();
        const name = proc.name ?? proc.id ?? "?";
        const hasLink =
            (pid  && processIdsWithLinks.has(pid)) ||
            (pnam && processNamesWithLinks.has(pnam)) ||
            links.length === 0; // if no links at all, skip — likely a simple diagram
        if (!hasLink) {
            warnings.push(
                `WARN-STR-001: התהליך "${name}" לא נמצאו קישורים מפורשים אליו/ממנו. ` +
                `ודא שהוא מחובר לאובייקט בדיאגרמה. (ISO 19450 §8.1.2; VR-06)`
            );
        }
    }

    // ---- Link legality (ISO 19450 §9 procedural / §10 structural; VR-03/VR-04) ----
    // ADVISORY warnings only (not blocking): vision-parsed IR mislabels element
    // kinds/directions often enough that hard-blocking here false-positives on valid
    // models. Only validate links whose BOTH endpoints resolve.
    const kindByRef = new Map<string, "object" | "process">();
    for (const o of objects)   for (const r of [o.id, o.name]) if (r) kindByRef.set(r.toLowerCase(), "object");
    for (const p of processes) for (const r of [p.id, p.name]) if (r) kindByRef.set(r.toLowerCase(), "process");

    const PROCEDURAL_RE   = /(consum|result|yield|creat|effect|affect|agent|instrument|condition|event|invocat|invoke|exception|overtime|undertime)/;
    const STRUCTURAL_RE   = /(aggregat|exhibit|attribute|characteriz|general|inherit|special|instanti|classif|tagged)/;
    const PROC_TO_PROC_RE = /(invocat|invoke|exception|overtime|undertime)/; // process↔process only
    const CROSS_KIND_OK_RE = /(exhibit|attribute|characteriz)/;             // exhibition may cross kinds

    for (const link of links) {
        const type = (link.type ?? "").trim();
        if (!type) continue;
        const fromKind = kindByRef.get((link.from ?? "").toLowerCase());
        const toKind   = kindByRef.get((link.to   ?? "").toLowerCase());
        if (!fromKind || !toKind) continue; // unresolved endpoint → skip
        const t = type.toLowerCase();
        const ends = `"${link.from}"→"${link.to}"`;

        if (PROCEDURAL_RE.test(t)) {
            if (PROC_TO_PROC_RE.test(t)) {
                if (fromKind !== "process" || toKind !== "process") {
                    warnings.push(
                        `WARN-LINK-E202: קישור "${type}" (${ends}) מצופה לחבר תהליך לתהליך. ` +
                        `(ISO 19450 §9; VR-04)`
                    );
                }
            } else if (fromKind === toKind) {
                warnings.push(
                    `WARN-LINK-E202: קישור פרוצדורלי "${type}" (${ends}) מצופה לחבר אובייקט לתהליך, ` +
                    `לא ${fromKind}↔${toKind}. (ISO 19450 §9; VR-04)`
                );
            }
        } else if (STRUCTURAL_RE.test(t) && !CROSS_KIND_OK_RE.test(t)) {
            if (fromKind !== toKind) {
                warnings.push(
                    `WARN-LINK-E204: קישור מבני "${type}" (${ends}) בדרך כלל אינו מערבב אובייקט ותהליך ` +
                    `(רק exhibition חוצה סוגים). (ISO 19450 §10; VR-03/VR-11)`
                );
            }
        }
    }

    // ERR-FUNC-001: BLOCKING — zero processes means nothing to generate.
    if (processes.length === 0) {
        errors.push(
            `ERR-FUNC-001: לא נמצאו תהליכים בדיאגרמה. ` +
            `כל מודל OPM חייב לכלול לפחות תהליך ראשי אחד (פונקציית המערכת). (ISO 19450 §5.2)`
        );
    }

    return { errors, warnings };
}
