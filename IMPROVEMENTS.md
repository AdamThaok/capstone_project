# Fix backlog — toward "deploy to Vercel, minimal user fixing"

Ordered by impact. The end goal: a generated app the user can push to Vercel and
run with (almost) zero hand-fixing. Today it needs a lot of hand-fixing because of
the items below.

---

## P0 — the root causes (a generated app won't run without these)

### 1. Codegen drifts chunk-to-chunk (the core problem)
**Now:** we dump the entire super-prompt on Claude and let it stream 30+ files in
one shot, finished with 2–3 truncation "continuation" calls. Each continuation
doesn't remember what the earlier chunks defined, so the output drifts: it built
**two parallel backends** (sync `backend/` + async `backend/app/`), dangling
imports, and references to models that don't exist.
**Fix:** stop one-shot streaming. (a) First generate a **file manifest** (the list
of files + one-line purpose each). (b) Then generate **one file (or a small,
related group) per call**, each call given the manifest + a short summary of what's
already been written. This keeps every file coherent with the rest instead of
drifting. Slower, far more reliable.

### 2. No shared front↔back API contract
**Now:** frontend assumes `Child {id: number, status: "active"}`; backend assumes
OPM string-ids with `INITIAL` status. They were generated independently from the
same prompt and disagreed — so "create child" can never work.
**Fix:** Stage 2 emits **one API contract** (endpoints + request/response shapes).
Generate the backend to that contract, then generate the frontend against the
backend's **real** routes (or generate TS types from the backend's OpenAPI). Single
source of truth, no drift.

### 3. The Testing Agent never builds or runs the code
**Now:** the loop checks files-present, OPM-id coverage, JS-formula parse, Python
*syntax*, and an LLM acceptance opinion. None of it **runs** anything, so all
deterministic tiers passed while the app was non-functional.
**Fix:** add a real **Tier 3 (build & boot)** that the loop drives on:
- backend: `pip install -r requirements.txt` + `python -c "import main"` (catches
  broken imports / dual ORM / missing models),
- frontend: `npm install && npm run build` (catches missing deps like Tailwind),
- optional: boot backend + `curl /health`.
Feed those real failures back into reflect→regenerate so the loop **fixes** them
before the user ever sees the app.

---

## P1 — deployability (so "upload to Vercel" actually works)

### 4. The target stack isn't Vercel-friendly
**Now:** generated stack is Postgres + Docker + a long-running uvicorn server.
Vercel hosts the frontend + serverless functions; it does **not** run your
docker-compose or a persistent FastAPI server, and there's no Postgres unless you
attach one. So "deploy to Vercel" can't work as generated.
**Fix:** target a Vercel-deployable architecture by default:
- frontend → Vercel static/SPA build,
- backend → either Vercel **Python serverless functions** (`/api/*.py`) or a small
  hosted API, with a **managed serverless DB** (Vercel Postgres / Neon) read from
  `DATABASE_URL`,
- **local dev → SQLite** (zero infra: `pip install` + run).
Remove Docker/Postgres from the critical path.

### 5. Missing / wrong dependencies
**Now:** `postcss.config.js` uses Tailwind but `package.json` never lists it; a
bogus `cors` package; unused `psycopg2`. The generator declares configs for tools
it forgets to install.
**Fix:** a post-gen **dependency reconciler** — scan imports + config files and
ensure `package.json`/`requirements.txt` declare exactly what's used (or pin
known-good templates). Tier 3 (build) also catches these automatically.

### 6. Generate fewer, simpler files
**Now:** 58 objects → ~58 tables / 32 files is where coherence breaks.
**Fix:** keep enforcing "scalar → field, not its own table" (added in Stage 2),
cap file/entity count, and group related endpoints. Smaller surface = coherent +
deployable.

### 7. Env + deploy scaffolding
**Now:** the app needs `DATABASE_URL` etc.; the user has to figure out env wiring.
**Fix:** generate `vercel.json`, a correct `.env.example`, and read all config from
env with sane defaults — so "Import to Vercel → set 1–2 env vars → Deploy" is the
whole flow.

---

## P2 — polish / known issues

### 8. Acceptance tier is noisy and drives the loop
**Now:** the LLM acceptance tests are non-deterministic (re-invented each pass), so
the failure count bounces (we saw 17→3→2→**5**) and the loop can't converge.
**Fix:** make acceptance **advisory** (shown + gate deploy), not a loop driver.
Drive convergence on the deterministic tiers + the new build/run tier (item 3).

### 9. Formula corruption can still slip through
**Now:** Claude still occasionally drops a `*` (`)100` instead of `)*100`), even
with the IR-as-source rule.
**Fix:** in the build tier, parse every generated formula and **block** the loop
until all are valid (the detector already exists — just make it loop-blocking on
the generated code, not only the IR).

### 10. README / runner matches reality
**Now:** README assumes Docker; the real run path differs.
**Fix:** generate a one-command runner (`run.ps1`/`run.sh`) and a README whose
commands actually match the chosen (Vercel/local) flow.

---

## If you do only three
1. **#3 build & boot in the loop** — the loop starts shipping apps that actually run.
2. **#4 Vercel-friendly + SQLite-local** — removes Docker/Postgres setup pain.
3. **#1 manifest-then-per-file generation** — kills the chunk-to-chunk drift at the source.
