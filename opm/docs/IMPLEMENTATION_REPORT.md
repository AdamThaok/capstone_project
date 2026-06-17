# OPM-to-App — Implementation Report

**Project:** Automated OPM-diagram → full-stack application generator
**Stack:** Next.js 16 / TypeScript · Supabase · Gemini + Claude · GitHub + Railway
**Scope of this report:** the four work areas completed in this iteration.

---

## 1. Executive summary

This iteration moved the system from a hard-coded prototype to a methodology-grounded,
multi-agent pipeline:

1. **Per-user cloud credentials** — each user connects their *own* GitHub (OAuth) and
   Railway accounts; generated apps deploy to the user's accounts, not a shared one.
2. **OPM Knowledge Base + real RAG** — the Phase-1, ISO 19450 / Dori knowledge base is now
   vendored into the app and drives retrieval-augmented prompting (replacing an ad-hoc
   hard-coded rules string).
3. **Semantic validation gate** — the OPM model is checked against the knowledge base's
   link-legality rules (ISO 19450) before any code is generated.
4. **Multi-agent generation + blocking QA** — a *System Builder* agent generates the code and
   an independent *Testing & QA* agent produces acceptance tests + a code review and can
   **block deployment** on failures.

All changes are pipeline/code + UI only and are covered by an automated test suite
(34 tests passing) and a clean production build.

---

## 2. The generation pipeline (where each change lives)

```
 Stage 0  Input validation
 Stage 1  OPM parsing (objects, processes, links, states)  ─┐
 Stage 1b RAG retrieval                                      ├─ join
          ┌─────────────────────────────────────────────────┘
   [GATE]  Semantic validation  ← §5  (ISO 19450 link legality, blocking)
 Stage 2  Semantic interpretation → system specification
 Stage 3  Super-prompt composition  ← §4  (real RAG + OPL reconstruction)
 Stage 4  Code generation           ← §6  (System Builder agent)
 Stage 5  Validation + refinement + QA  ← §6  (QA agent, blocking)
 Stage 6  Cloud deployment          ← §3  (per-user GitHub + Railway)
```

---

## 3. Per-user cloud credentials (GitHub OAuth + Railway)

**Motivation.** Previously the server held one shared `GITHUB_TOKEN` / `GITHUB_OWNER` /
`RAILWAY_TOKEN`, so every user's generated repo and deployment landed in the *same* account.
That does not scale to real multi-user use and is a security/ownership problem.

**What we built.** Each user connects their own accounts once:
- **GitHub** — standard OAuth 2.0 authorization-code flow (with CSRF `state`); we store the
  returned access token and the user's GitHub login.
- **Railway** — the user pastes a personal API token (Railway has no public OAuth app).

Tokens are stored **per user** in a new Supabase table and used automatically at deploy time,
so a user's generated app is pushed to *their* GitHub and deployed to *their* Railway.

**Database.**
```sql
create table user_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null, provider text not null,      -- 'github' | 'railway'
  access_token text not null, github_login text,
  created_at timestamptz default now(), unique(user_id, provider)
);
```

**Security properties.** Tokens never leave the server (the client only ever sees a boolean
"connected" status + the GitHub username); OAuth uses an httpOnly CSRF `state` cookie; all new
API routes return `401` without a valid session.

**Key files.** `lib/auth/oauth-tokens.ts`, `lib/auth/session.ts`,
`app/api/auth/{github, github/callback, railway, connections, disconnect}/route.ts`,
`lib/deploy/{github,railway}.ts` (token is now a parameter, not an env var),
`lib/pipeline/stage6-deploy.ts` (deploys with the job owner's tokens),
`app/components/ConnectionsPanel.tsx` (the dashboard "Connections" UI).

---

## 4. OPM Knowledge Base & Retrieval-Augmented Generation (RAG)

**Motivation.** The code generator previously injected a hand-written ~18-line "ISO rules"
string and reported a *fake* retrieved-chunk count — it was not true RAG and was not faithful to
the standard. (It even contained leftover Firebase/emulator instructions contradicting the
PostgreSQL target.)

**What we built.** The Phase-1 knowledge base — built strictly from **ISO 19450** and
**Dov Dori's** OPM methodology (source priority: ISO > Dori > book) — is now vendored into the
repository at `lib/pipeline/opm-kb/` (13 files):

| File | Contents |
|---|---|
| `02_core_ontology.md` | Object / Process / State definitions |
| `03_structural_links.md`, `04_procedural_links.md` | the OPM link families |
| `05_opl_grammar_templates.md` | 53 Object-Process Language sentence templates |
| `06_rules_schema.json` | machine-readable element + link legality + rules **VR-01…VR-20** |
| `07_rag_chunks.json` | **64 source-cited retrieval chunks** (ontology / link / OPL / validation), each with an ISO/Dori citation |
| `08–12, README` | validator spec, checklist, codegen system prompt, etc. |

**Real retrieval** (`lib/pipeline/rag-retrieve.ts`). For each uploaded model we deterministically
retrieve, **in-memory**, only the relevant chunks:
- always pin the high-priority **ontology** chunks (needed to interpret any model),
- select the **link/OPL** chunks for the link kinds actually present in the diagram,
- add **state/transition** chunks when objects carry states,
- follow each chunk's referenced **validation rules**.

These chunks — *with their ISO/Dori citations* — plus the rules schema are injected into the
Stage-3 "super-prompt", and the model is asked to first **reconstruct the canonical OPL
paragraph** (using only the 53 templates) as the authoritative intermediate representation
(OPD and OPL are two views of one model). The reported retrieved-chunk count is now real.

**Why it matters (methodology).** This is textbook RAG over an authoritative, citation-bearing
corpus, with the ISO-first source priority enforced, and it keeps the OPD↔OPL equivalence
central — exactly the Phase-1 design the knowledge base prescribes.

**Key files.** `lib/pipeline/opm-kb/` (+ typed `index.ts`), `lib/pipeline/rag-retrieve.ts`,
`lib/pipeline/stage3-rag.ts`.

---

## 5. Semantic validation gate (ISO 19450 link legality)

**Motivation.** A code generator should refuse to build from a structurally invalid model.
The previous gate only checked naming style and "has ≥1 process".

**What we built** (`lib/pipeline/opm-validate.ts`). A schema-driven validator that enforces the
knowledge base's link-legality rules before generation:

| Check | Rule | Error |
|---|---|---|
| Procedural links connect an **object/state ↔ process** (only invocation/exception join two processes) | VR-04 | `E202` |
| Structural links connect **like kinds**; only *exhibition* may cross object↔process | VR-03 / VR-11 | `E204` |
| Every model has at least one process (system function) | — | `ERR-FUNC-001` |
| Naming / connectivity (gerund, Title Case, lowercase states, uniqueness, orphan process) | VR-06, naming | warnings |

The gate is conservative: a link is only flagged when **both** endpoints resolve to a known
element, so a parser quirk can never wrongly block a valid diagram. Blocking errors stop the
pipeline; warnings are advisory and surfaced to the user.

**Why it matters.** This realizes the knowledge base's "Semantic Validator" specification
(checks for element/link legality) and the principle that *no software is generated before the
model is semantically valid*.

---

## 6. Multi-agent generation & QA

The user's two-agent design was folded into the pipeline (their prose "output format" was
intentionally replaced by our structured formats).

### Agent 1 — System Builder (Stage 4, `lib/pipeline/stage4-codegen.ts`)
A "lead full-stack engineer" system prompt is prepended to every generation call:
map every **Object → data structure / class** and every **Process → function / service**;
build **strictly within the schema boundaries** (no invented fields/entities/endpoints);
enforce state transitions exactly as modelled (reject illegal source states with **HTTP 409**);
every file **complete and runnable — no placeholders or TODOs**; emit a traceability map.

### Agent 2 — Testing & QA (Stage 5, `lib/pipeline/stage5-validate.ts`)
An **independent** reviewer reasons over the generated repository and returns a structured,
typed report:
- **Exactly 10 acceptance tests** (objective / input / expected / pass-fail), targeting
  end-to-end behavior the app actually implements (auth, data ingestion, state mutations,
  core process execution);
- **Exactly 5 prioritized code-review points**, ordered **Security → Architecture →
  Performance → Error handling → Readability**, each with file, problem, and a refactoring
  suggestion.

**Blocking policy** (pure, unit-tested `computeQaBlocking`): the build is **blocked** if any
acceptance test fails **or** a Security issue is found; other categories are advisory. A blocked
build is marked `NEEDS_MANUAL_REVIEW` and **deployment is disabled** — enforced in two layers
(the dashboard hides the Deploy action; the deploy API returns `400`). An LLM failure during QA
is non-blocking by design (it can't *wrongly* block a working app).

**UI.** A "QA Review" card (`app/components/QaReviewCard.tsx`) shows the 10 tests (pass/fail) and
5 review points, with a red "deployment blocked" banner and the blocking reasons.

**Why it matters.** This is a genuine multi-agent separation of concerns — a builder and an
independent QA/reviewer — implementing acceptance testing and a prioritized static code review
as explicit, gating deliverables.

---

## 7. Pipeline robustness

- **No time cutoff on generation** (`lib/pipeline/runner.ts`). The `generate` and `validate`
  stages (the LLM-heavy ones) now run to completion with no timeout — the agent "takes its
  time" rather than being aborted mid-generation.
- **Hardened codegen prompt.** Running a generated app surfaced real defects (an end-of-life
  Docker base image, a missing Vite `index.html`, a non-existent wait-script, broken relative
  imports). Those lessons were encoded back into the Stage-3 brief: require a *current* base
  image, schema creation via `metadata.create_all` (no external wait-script), and a frontend
  `index.html` + correct `package.json` scripts — so future generations build cleanly.

---

## 8. Traceability

Every generated artifact is required to trace to an OPL sentence / OPM fact; the generator emits
a `TRACEABILITY.md` (OPL sentence → file), and Stage 5 computes an **OPM-element coverage**
report (each object/process referenced in the code) shown on the dashboard. This preserves the
"zero information loss" / full-traceability acceptance criterion.

---

## 9. Testing & verification

- **Automated tests: 34 passing** (`npm run test`, Vitest), including new suites:
  - `__tests__/opm-rag-retrieve.test.ts` — retrieval pins ontology + selects link/state chunks;
  - `__tests__/opm-validate.test.ts` — `E202`/`E204` link-legality + clean-model pass;
  - `__tests__/opm-qa.test.ts` — QA blocking policy (failing test / security ⇒ blocked).
- **Type-check:** `npx tsc --noEmit` clean. **Build:** `npm run build` succeeds.

---

## 10. File map

| Area | New | Modified |
|---|---|---|
| Per-user OAuth (§3) | `lib/auth/oauth-tokens.ts`, `lib/auth/session.ts`, `app/api/auth/**`, `app/components/ConnectionsPanel.tsx` | `lib/deploy/{github,railway}.ts`, `lib/pipeline/stage6-deploy.ts`, `app/api/deploy/[jobId]/route.ts`, `app/dashboard/dashboard-client.tsx`, `.env.example` |
| Knowledge base + RAG (§4) | `lib/pipeline/opm-kb/**` (13 files + `index.ts`), `lib/pipeline/rag-retrieve.ts` | `lib/pipeline/stage3-rag.ts` |
| Validation gate (§5) | `lib/pipeline/opm-validate.ts` | `lib/pipeline/runner.ts` |
| Multi-agent + QA (§6) | `app/components/QaReviewCard.tsx` | `lib/pipeline/stage4-codegen.ts`, `lib/pipeline/stage5-validate.ts`, `lib/pipeline/types.ts`, `lib/pipeline/runner.ts`, `app/dashboard/dashboard-client.tsx`, `app/api/deploy/[jobId]/route.ts` |
| Tests | `__tests__/opm-rag-retrieve.test.ts`, `__tests__/opm-validate.test.ts`, `__tests__/opm-qa.test.ts` | — |

---

## 11. How to run / demo

```bash
npm install
npm run dev          # http://localhost:3000
```
1. Log in (demo: `admin@opm.dev` / `admin`, or sign up).
2. **Connections** panel → connect GitHub (OAuth) + paste a Railway token.
3. **+ New Project** → upload an OPM diagram → the pipeline runs:
   parse → **validation gate** → RAG super-prompt → **System Builder** generates →
   **QA agent** produces 10 tests + 5 review points.
4. If QA passes, click **Deploy** (to *your* GitHub + Railway). If QA blocks, the dashboard
   shows the failing tests / security issues and Deploy stays disabled.

Run the tests: `npm run test`.

---

## 12. Mapping to methodology / acceptance criteria

| Criterion | How this iteration satisfies it |
|---|---|
| ISO 19450 / Dori grounding | Citation-bearing KB, ISO-first source priority, OPL templates |
| Retrieval-Augmented Generation | Real in-memory retrieval of relevant, cited chunks per model |
| Semantic validation before codegen | Link-legality gate (VR-03/VR-04) blocks invalid models |
| OPD ↔ OPL equivalence | Canonical OPL reconstruction drives generation |
| Multi-agent architecture | Independent System Builder + Testing/QA agents |
| Acceptance testing & code review | 10 tests + 5 prioritized review points, gating deploy |
| Traceability / zero information loss | `TRACEABILITY.md` + OPM-element coverage report |
| Per-user, deployable output | OAuth-based deployment to each user's own cloud accounts |
