// Thin wrapper around @google/generative-ai.
// Single provider strategy: Gemini does everything (parse, reason, generate).
// Stage files call these helpers; swap provider here to switch models.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logLlmCall } from "../infra/llm-log";

const MODEL_TEXT    = "gemini-2.5-flash";   // fast + cheap for parse/spec/compose
const MODEL_VISION  = "gemini-2.5-flash";   // same model handles images
const MODEL_CODEGEN = "gemini-2.5-flash";   // flash is 5-10x faster than pro; good enough for constrained codegen

function client(): GoogleGenerativeAI {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY not set");
    return new GoogleGenerativeAI(key);
}

// Hard cap per model call. The SDK's generateContent has no built-in timeout,
// so a stalled request would hang its stage forever (esp. now that codegen /
// validation have generous stage budgets). On timeout the call rejects and the
// caller falls back (codegen → mock, QA → skipped, etc.).
const CALL_TIMEOUT_MS = Number(process.env.OPM_LLM_CALL_TIMEOUT_MS) || 240_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}

/** Send a text prompt, return the raw text response. */
export async function askText(prompt: string, model = MODEL_TEXT, timeoutMs = CALL_TIMEOUT_MS): Promise<string> {
    const g = client().getGenerativeModel({
        model,
        generationConfig: {
            maxOutputTokens: 65_536,   // enough for large codegen responses
            temperature:     0.4,
        },
    });
    const start = Date.now();
    const res = await withTimeout(g.generateContent(prompt), timeoutMs, "Gemini text call");
    const text = res.response.text();
    logLlmCall({ provider: "gemini", model, prompt, response: text, ms: Date.now() - start });
    return text;
}

/** Send text prompt expected to return JSON. Retries + extracts JSON on parse failure. */
export async function askJson<T = unknown>(prompt: string, model = MODEL_TEXT, timeoutMs = CALL_TIMEOUT_MS): Promise<T> {
    const text = await askText(
        `${prompt}\n\nRespond with a single valid JSON object. No markdown fences. No prose.`,
        model,
        timeoutMs,
    );
    try {
        return JSON.parse(stripFences(text));
    } catch (e1) {
        // Try salvage: extract the largest {...} block
        const salvaged = extractJson(text);
        if (salvaged) {
            try { return JSON.parse(salvaged); } catch { /* fall through */ }
        }
        // Try to close a truncated JSON object by appending closing brackets
        const closed = tryCloseJson(text);
        if (closed) {
            try { return JSON.parse(closed); } catch { /* fall through */ }
        }
        // On JSON error, include the raw text in the error so callers can salvage
        const err = e1 as Error;
        throw Object.assign(new Error(err.message), { rawText: text });
    }
}

/** Send file bytes + prompt (vision or text-file). */
export async function askMultimodal(
    prompt: string,
    file: { mime: string; base64: string },
    model = MODEL_VISION,
    timeoutMs = CALL_TIMEOUT_MS,
): Promise<string> {
    const g = client().getGenerativeModel({
        model,
        generationConfig: { maxOutputTokens: 65_536, temperature: 0.4 },
    });
    const start = Date.now();
    const res = await withTimeout(g.generateContent([
        { text: prompt },
        { inlineData: { mimeType: file.mime, data: file.base64 } },
    ]), timeoutMs, "Gemini vision call");
    const text = res.response.text();
    // Don't dump the base64 file into the log — just note it.
    logLlmCall({
        provider: "gemini",
        model,
        prompt:   `${prompt}\n\n[+ attached file: ${file.mime}, ${file.base64.length} base64 chars]`,
        response: text,
        ms:       Date.now() - start,
    });
    return text;
}

export async function askMultimodalJson<T = unknown>(
    prompt: string,
    file: { mime: string; base64: string },
    model = MODEL_VISION,
    timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
    const text = await askMultimodal(
        `${prompt}\n\nRespond with a single valid JSON object. No markdown fences. No prose.`,
        file,
        model,
        timeoutMs,
    );
    // Large documents (e.g. a multi-page PDF → big IR) can yield slightly
    // malformed or truncated JSON; salvage the same way askJson does.
    try {
        return JSON.parse(stripFences(text)) as T;
    } catch (e1) {
        const salvaged = extractJson(text);
        if (salvaged) { try { return JSON.parse(salvaged) as T; } catch { /* fall through */ } }
        const closed = tryCloseJson(text);
        if (closed) { try { return JSON.parse(closed) as T; } catch { /* fall through */ } }
        throw Object.assign(new Error((e1 as Error).message), { rawText: text });
    }
}

export function isGeminiConfigured(): boolean {
    return !!process.env.GOOGLE_API_KEY;
}

export const CODEGEN_MODEL = MODEL_CODEGEN;

/** Attempt to close a truncated JSON string by counting brackets and appending closers. */
function tryCloseJson(s: string): string | null {
    const t = stripFences(s);
    const stack: string[] = [];
    let inStr = false, esc = false;
    for (const c of t) {
        if (inStr) {
            if (esc) { esc = false; continue; }
            if (c === "\\") { esc = true; continue; }
            if (c === '"') inStr = false;
        } else {
            if (c === '"') inStr = true;
            else if (c === "{") stack.push("}");
            else if (c === "[") stack.push("]");
            else if (c === "}" || c === "]") stack.pop();
        }
    }
    if (stack.length === 0) return null; // already valid or hopeless
    return t + (inStr ? '"' : "") + stack.reverse().join("");
}

function stripFences(s: string): string {
    return s
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();
}

// Find the first { ... matched ... } block at the top level. Handles strings
// with escaped quotes so braces inside strings don't trip the matcher.
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
