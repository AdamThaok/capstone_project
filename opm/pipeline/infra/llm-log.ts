// Opt-in disk log of every LLM call (prompt + response), for debugging the
// pipeline end-to-end. Enable with OPM_LOG_LLM=1. Writes to OPM_LLM_LOG_DIR
// (default <cwd>/llm-logs). Best-effort: logging must NEVER throw into a run.

import fs from "node:fs";
import path from "node:path";

let seq = 0;

export function llmLogEnabled(): boolean {
    return process.env.OPM_LOG_LLM === "1";
}

function logDir(): string {
    return process.env.OPM_LLM_LOG_DIR || path.join(process.cwd(), "llm-logs");
}

// Append one prompt/response pair to llm-calls.log, and also drop it as its own
// numbered file so a single call is easy to open in isolation.
export function logLlmCall(entry: {
    provider: string;   // "claude" | "gemini"
    model:    string;
    prompt:   string;
    response: string;
    ms:       number;
}): void {
    if (!llmLogEnabled()) {
        return;
    }
    try {
        const dir = logDir();
        fs.mkdirSync(dir, { recursive: true });

        seq += 1;
        const ts = new Date().toISOString();
        const header =
            `#${seq}  ${ts}  ${entry.provider}/${entry.model}  ${entry.ms}ms  ` +
            `(prompt ${entry.prompt.length} chars, response ${entry.response.length} chars)`;
        const block =
            `\n${"=".repeat(90)}\n${header}\n` +
            `${"-".repeat(40)} PROMPT ${"-".repeat(40)}\n${entry.prompt}\n` +
            `${"-".repeat(39)} RESPONSE ${"-".repeat(39)}\n${entry.response}\n`;

        fs.appendFileSync(path.join(dir, "llm-calls.log"), block, "utf-8");

        const tag = ts.replace(/[:.]/g, "-");
        const per = `${String(seq).padStart(4, "0")}-${entry.provider}-${tag}.txt`;
        fs.writeFileSync(path.join(dir, per), block, "utf-8");
    } catch {
        /* never break a run on a logging failure */
    }
}
