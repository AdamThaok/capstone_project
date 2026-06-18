# Plan — layered code generation (kill chunk-to-chunk drift)

Replace the single "dump everything on Claude" call with **dependency-ordered
layers**, where each layer is generated in its own call and is handed the
*interfaces* of the layers already written. Same code style as the rest of
`agents/`: small named functions, classic loops, one job each.

## New file

`opm/pipeline/agents/layered-codegen.ts` — owns the layered generation. Keeps
`code-generation-agent.ts` thin (it just delegates to it).

## Types

```ts
// One generation layer = a coherent group of files in dependency order.
type Layer = {
    name:        string;   // "Data", "API", "Backend entry", "Frontend", "Config"
    instruction: string;   // what this layer must produce (prose, model-agnostic)
};

// What every layer call needs to stay consistent with the rest of the app.
type LayerContext = {
    superPrompt: string;       // the Stage 3 brief (the "what to build")
    written:     FileSpec[];   // every file produced by earlier layers
};
```

## The layers (the dependency order)

```ts
const LAYERS: Layer[] = [
    { name: "Data",          instruction: "Write the SQLAlchemy models + Pydantic schemas (one consistent set)." },
    { name: "API",           instruction: "Write the routers/endpoints, using ONLY the models + schemas above." },
    { name: "Backend entry", instruction: "Write main.py (wire routers, CORS, create tables), database.py, requirements.txt." },
    { name: "Frontend",      instruction: "Write the api client + pages that call EXACTLY the routes defined above." },
    { name: "Config",        instruction: "Write package.json (declare every imported dep), vite/postcss config, index.html, README, .env.example." },
];
```

## Functions (names + one-line contracts)

```ts
// The entry point — generate the whole app, layer by layer, and assemble it.
export async function generateLayered(
    superPrompt: string,
    onProgress?: (m: string) => void,
): Promise<CodeArtifact>;

// Generate ONE layer: build its prompt, call Claude, parse the files.
async function generateLayer(layer: Layer, ctx: LayerContext, log: Log): Promise<FileSpec[]>;

// Assemble a single layer's prompt: system + layer goal + brief + what already exists.
function buildLayerPrompt(layer: Layer, ctx: LayerContext): string;

// Compact digest of already-written files (paths + signatures only, NOT full code)
// so each layer sees the interfaces it must match without blowing the token budget.
function summarizeInterfaces(written: FileSpec[]): string;

// Pull the "signature" lines from one file (class / def / @router / export / route paths).
function signatureLines(file: FileSpec): string;
```

## How `generateLayered` works (the loop)

```ts
export async function generateLayered(superPrompt, onProgress) {
    const log = onProgress ?? (() => {});
    const written: FileSpec[] = [];

    for (const layer of LAYERS) {
        log(`🧱 Generating layer: ${layer.name}…`);
        const files = await generateLayer(layer, { superPrompt, written }, log);
        // Merge (later layer can overwrite a placeholder; normally just appends).
        for (const f of files) {
            const i = written.findIndex((w) => w.path === f.path);
            if (i >= 0) written[i] = f; else written.push(f);
        }
        log(`✅ ${layer.name}: ${files.length} file(s).`);
    }
    return written;
}
```

## How one layer is built + generated

```ts
function buildLayerPrompt(layer, ctx) {
    const alreadyWritten = ctx.written.length
        ? `## Files already written (match these EXACTLY — do not redefine them)\n${summarizeInterfaces(ctx.written)}`
        : "## Files already written\n(none — this is the first layer)";

    return [
        `You are generating ONE layer of the app: ${layer.name}.`,
        layer.instruction,
        "Output ONLY the files for THIS layer, in the delimiter format. Do not regenerate earlier files.",
        alreadyWritten,
        `## Build brief\n${ctx.superPrompt}`,
    ].join("\n\n");
}

async function generateLayer(layer, ctx, log) {
    const text = await generateComplete(
        (p) => claudeAskText(p, CODEGEN_MODEL),
        `${OPM_SYSTEM_PROMPT}\n\n${buildLayerPrompt(layer, ctx)}\n\n${CODEGEN_INSTRUCTIONS}`,
        log,
    );
    return parseDelimitedFiles(text);
}
```

`summarizeInterfaces` keeps tokens bounded — for each prior file it emits the path
plus only its signature lines (e.g. `class Child(Base):`, `def create_child(...)`,
`@router.post("/children")`, `export interface Child`), not the whole body. That's
enough for the next layer to stay consistent.

## Wiring it in (minimal)

- `code-generation-agent.ts` → `generateInitialCode` becomes a one-liner:
  ```ts
  export async function generateInitialCode(superPrompt, onProgress) {
      return generateLayered(superPrompt, onProgress);
  }
  ```
- The orchestrator, `regenerateFromReflection`, the Testing Agent, the loop — all
  unchanged. They still see a `CodeArtifact`; only *how* the first draft is built
  changed.
- Reuse the existing `callClaude` one-shot path as a **fallback** if a layer
  returns too few files (so a layer hiccup can't sink the whole run).

## Why this fixes the P0 drift

- **Dual ORM impossible** — models are written once (Data layer) and every later
  layer is handed their signatures, so nothing redefines them.
- **Front/back mismatch impossible** — the Frontend layer is handed the API
  layer's real route signatures (that digest *is* the shared contract from P0.2).
- **No truncation drift** — each layer is small (2–6 files), so `generateComplete`
  rarely needs a continuation, and no single context grows long enough to drift.

## Cost / trade-off

~5 calls instead of 1. Mitigate with prompt caching on the shared
`OPM_SYSTEM_PROMPT` + brief, and keep Haiku. Net: a bit slower, dramatically more
coherent.

## Verification

- `tsc --noEmit` + existing `vitest` (no behaviour change to the loop).
- Unit-test `summarizeInterfaces` (deterministic): given a models file, it returns
  the class/field lines and drops the bodies.
- One real run on the FTT diagram → confirm a single consistent ORM + a frontend
  whose routes match the backend.
