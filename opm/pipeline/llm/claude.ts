// Thin wrapper around @anthropic-ai/sdk.
// Per book §4.3 Stage 4 + §7.B, Claude is the primary code-generation model
// (chosen for high adherence to security and syntax standards). Other stages
// can keep using Gemini / ChatGPT.

import Anthropic from "@anthropic-ai/sdk";
import { logLlmCall } from "../infra/llm-log";

const MODEL_CODEGEN = "claude-haiku-4-5-20251001";  // Haiku: 4x faster than Sonnet, fits in 4-min budget
const MAX_TOKENS    = 64_000;                        // Haiku 4.5 hard cap (64k) — minimizes continuations. 100k would 400-error.

function client(): Anthropic {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY not set");
    return new Anthropic({ apiKey: key });
}

export function isClaudeConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
}

/** Send a text prompt, return the raw text response. */
export async function askText(prompt: string, model = MODEL_CODEGEN): Promise<string> {
    const c = client();
    const start = Date.now();
    const res = await c.messages.create({
        model,
        max_tokens:   MAX_TOKENS,
        temperature:  0.3,
        messages: [{ role: "user", content: prompt }],
    });
    // Concatenate any text blocks in the response.
    const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    logLlmCall({ provider: "claude", model, prompt, response: text, ms: Date.now() - start });
    return text;
}

/** Send text prompt expected to return JSON. Salvages malformed responses. */
export async function askJson<T = unknown>(prompt: string, model = MODEL_CODEGEN): Promise<T> {
    const text = await askText(
        `${prompt}\n\nRespond with a single valid JSON object. No markdown fences. No prose.`,
        model,
    );
    try {
        return JSON.parse(stripFences(text));
    } catch (e1) {
        const salvaged = extractJson(text);
        if (salvaged) {
            try { return JSON.parse(salvaged); } catch { /* fall through */ }
        }
        // Second attempt
        const text2 = await askText(
            `Your previous output was not valid JSON. Emit ONLY a JSON object, nothing else. Original prompt:\n\n${prompt}`,
            model,
        );
        try {
            return JSON.parse(stripFences(text2));
        } catch {
            const salvaged2 = extractJson(text2);
            if (salvaged2) return JSON.parse(salvaged2);
            throw e1;
        }
    }
}

export const CODEGEN_MODEL = MODEL_CODEGEN;

function stripFences(s: string): string {
    return s
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
}

// Same JSON salvager pattern as gemini.ts — handles brace counting with
// escape-aware string scanning so braces inside strings are ignored.
function extractJson(text: string): string | null {
    const s = stripFences(text);
    const start = s.indexOf("{");
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc   = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (c === "\\") { esc = true; continue; }
            if (c === "\"") inStr = false;
            continue;
        }
        if (c === "\"") { inStr = true; continue; }
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    return null;
}
