# Plan — the build & boot test tier (P0 #3)

Give the Testing Agent a tier that **actually builds the generated app**, so the
loop catches (and fixes) the bugs the cheap tiers can't see — missing deps,
broken imports, field/route mismatches that only surface at build time.

It's a new tier inside the SAME file as the others, `agents/testing-agent.ts`,
sitting next to `fileFailures` / `formulaFailures` / `pythonSyntaxFailures`.

## New Failure kind

In `agents/types.ts`, extend the `Failure.kind` union:

```ts
kind: "missing_file" | "empty_file" | "uncovered_id" | "invalid_formula"
    | "python_syntax" | "acceptance_test" | "build_error";   // <- new
```

## New functions (in testing-agent.ts)

```ts
// The tier: write the artifact to disk, build both halves, collect failures.
async function buildFailures(files: FileSpec[]): Promise<Failure[]>;

// Write the in-memory FileSpec[] into a temp working dir (reused per run so
// node_modules / venv survive between iterations).
function writeArtifactToTemp(files: FileSpec[]): string;

// Backend: create/reuse a venv, pip install, then `python -c "import main"`.
// Runs with DATABASE_URL=sqlite so the import doesn't need a real Postgres.
function checkBackend(rootDir: string): Failure[];

// Frontend: `npm install` then `npm run build` (vite). Catches missing deps
// (e.g. tailwindcss) and TS errors.
function checkFrontend(rootDir: string): Failure[];

// Small wrapper around spawnSync: returns { ok, stderr }, time-bounded.
function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): { ok: boolean; stderr: string };
```

Each `check*` turns a non-zero exit into one `Failure` whose `detail` is the
tail of stderr (the actual compiler/installer error), so the reflection step
gets the real message to fix.

## How it plugs into runTests

`runTests` is already async. Add the tier **last**, and gate it so it only runs
when it's worth the cost:

```ts
export async function runTests(files, ir): Promise<TestReport> {
    const failures: Failure[] = [];

    // ... existing cheap tiers (files, coverage, formula, python, acceptance) ...

    // Tier 3 (build & boot) — expensive, real. Only when:
    //   1. enabled via env, AND
    //   2. the cheap tiers are already clean (no point building broken structure).
    if (process.env.OPM_RUN_BUILD_CHECKS === "1" && failures.length === 0) {
        for (const f of await buildFailures(files)) failures.push(f);
    }
    // ...
}
```

Because the failures land in the same `failures` list, the orchestrator drives
on them exactly like any other — `reflectOnFailures` gets the build error,
`regenerateFromReflection` fixes it, the loop re-tests. **The loop self-heals
runtime breakage** instead of shipping it.

## Cost control (this tier is slow)

- **Env-gated** (`OPM_RUN_BUILD_CHECKS=1`) so light/dev runs stay fast.
- **Only after the cheap tiers pass** — never `pip install` on a draft that's
  already structurally broken.
- **Reuse one temp dir per job** so `npm install` / the venv are cached; later
  iterations only resolve the delta, not a full reinstall.
- **Time-bound** every command (`runCmd` timeout) so a hung install can't stall
  the stage.

## Honest caveats (tell the teacher these)

- **Needs python + node on the host.** True in dev and in a CI/Vercel build
  step; not available in a pure-serverless runtime.
- **Backend import needs a DB unless SQLite.** `import main` triggers
  `metadata.create_all`, which tries to connect. Run the check with
  `DATABASE_URL=sqlite:///./_check.db` so it works offline. This is why the tier
  pairs naturally with the "SQLite default" item (P1 #4).
- **It executes generated code** (`import main`). It's the user's own generated
  app and runs in an isolated temp dir, but it is real execution — keep it
  behind the env flag, off by default.
- **Still not a full integration test.** It proves "it builds + imports," not
  "every endpoint returns the right value." Real request/response testing is a
  later step (boot uvicorn + curl), noted but not in this tier.

## Verification

- `tsc --noEmit` + existing `vitest` (the tier is gated off by default, so tests
  stay deterministic/offline).
- Unit-test `runCmd` error handling and that `buildFailures` returns `[]` when
  the flag is unset.
- One real run with `OPM_RUN_BUILD_CHECKS=1` on a small diagram → confirm a
  missing-dependency app produces a `build_error` failure that the loop then fixes.

## Order of work

1. Add the `build_error` kind + `runCmd` + `writeArtifactToTemp`.
2. Add `checkFrontend` (the Tailwind-class bug is the easiest, highest-value win).
3. Add `checkBackend` (with the SQLite env shim).
4. Gate it into `runTests` behind the flag.
5. Verify; then flip the flag on for a real FTT run.
