# Run OPM2Code locally

The app is a Next.js project in `web/`. These steps get it running on your machine.

## 1. Install + start

```bash
cd web
npm install
npm run dev        # → http://localhost:3000
```

## 2. Configure keys

Copy `web/.env.example` to `web/.env.local` and fill it in. `.env.local` is
gitignored, so your keys stay on your machine.

The two keys that make the real agent loop run:

- `GOOGLE_API_KEY`    — Gemini: stages 1–3 (parse / spec / super-prompt) + the acceptance tests.
- `ANTHROPIC_API_KEY` — Claude: stage 4 code generation (the generate ↔ test ↔ reflect loop).

Plus a demo login (the login route checks these):

- `DEMO_USERNAME`, `DEMO_PASSWORD`

Optional, only for those features: Supabase (signup), GitHub OAuth (deploy),
and the `OPM_*_TIMEOUT_MS` knobs (all have sensible defaults).

## 3. Mock mode vs. real mode

Every stage is guarded by `isGeminiConfigured()` / `isClaudeConfigured()`:

- **No keys** → the pipeline still runs end-to-end but returns **mock outputs**
  (canned IR / spec / files). Good for exercising the UI.
- **Both keys set** → the **real** loop runs: parse → spec → super-prompt →
  generate ↔ test ↔ reflect, then the dashboard validation report.

## 4. Watch it live (debugging)

`npm run dev` gives hot reload. The loop logs to **both** places:

- the terminal: `[stage4] …`, `[stage5] …`, `[testing-agent] …`
- the dashboard stage panels (via `appendStageLog`)

So you can watch "Code Generation Agent: regenerating… / Testing Agent: 3
failure(s)…" stream in real time. Good breakpoints to set:

- `runBuildLoop`        (`opm/pipeline/agents/orchestrator.ts`) — the loop itself
- `runTests`            (`opm/pipeline/agents/testing-agent.ts`) — what's being checked
- `decideHalt`          (`opm/pipeline/agents/orchestrator.ts`) — why it stopped

## 5. Heads-up on cost / time

A real run makes several Gemini + Claude calls per attempt (more now with the
acceptance tier), so a full run on a large diagram can take a few minutes and a
handful of API calls. Fine for testing — just not instant.

## Quick checks (no server needed)

```bash
cd web
npm run check:keys   # ping Anthropic + Gemini to confirm your keys work
npx tsc --noEmit     # type-check
npx vitest run       # unit tests (testing agent, stopping conditions, QA blocking)
npx next build       # production build
```
