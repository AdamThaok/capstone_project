// Quick smoke-test: pings Anthropic + Gemini with the keys in web/.env.local.
//   npm run check:keys
// No new dependencies — uses built-in fetch and a tiny .env parser. This script
// is standalone; it does not import or touch the pipeline code.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

// Minimal .env parser — KEY=VALUE per line, ignoring blanks and # comments.
function loadEnv(path) {
    let text;
    try {
        text = readFileSync(path, "utf-8");
    } catch {
        console.error(`✗ Could not read ${path}\n  Create web/.env.local from .env.example and add your keys.`);
        process.exit(1);
    }
    const env = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

async function checkAnthropic(key) {
    if (!key) return "missing — ANTHROPIC_API_KEY not set";
    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 4,
                messages: [{ role: "user", content: "ping" }],
            }),
        });
        if (res.ok) return "OK";
        return `HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`;
    } catch (e) {
        return `request failed — ${e.message}`;
    }
}

async function checkGemini(key) {
    if (!key) return "missing — GOOGLE_API_KEY not set";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
        });
        if (res.ok) return "OK";
        return `HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`;
    } catch (e) {
        return `request failed — ${e.message}`;
    }
}

const env = loadEnv(envPath);
console.log("Checking API keys in web/.env.local …\n");

const anthropic = await checkAnthropic(env.ANTHROPIC_API_KEY);
const gemini    = await checkGemini(env.GOOGLE_API_KEY);

const mark = (s) => (s === "OK" ? "✓" : "✗");
console.log(`${mark(anthropic)} Anthropic (Claude): ${anthropic}`);
console.log(`${mark(gemini)} Google (Gemini):    ${gemini}`);

const ok = anthropic === "OK" && gemini === "OK";
console.log(ok
    ? "\nBoth keys work — the real agent loop will run."
    : "\nFix the ✗ above, then re-run: npm run check:keys");
process.exit(ok ? 0 : 1);
