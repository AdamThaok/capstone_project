/**
 * web/auth/oauth-tokens.ts — per-user GitHub / Railway credential store.
 *
 * Each user connects their own GitHub account (OAuth) and pastes their own
 * Railway API token. Tokens live in the Supabase `user_oauth_tokens` table,
 * one row per (user_id, provider), and are read back at deploy time.
 *
 * SECURITY: raw tokens never leave server code. Only boolean connection status
 * and the GitHub login are ever returned to the browser (see the auth routes).
 */

import { getSupabaseAdmin } from "./supabase-client";

export type Provider = "github" | "railway";

export type StoredToken = { token: string; githubLogin?: string };

export async function saveToken(
    userId: string,
    provider: Provider,
    token: string,
    githubLogin?: string,
): Promise<void> {
    const db = getSupabaseAdmin();
    const { error } = await db.from("user_oauth_tokens").upsert(
        {
            user_id:      userId,
            provider,
            access_token: token,
            github_login: githubLogin ?? null,
        },
        { onConflict: "user_id,provider" },
    );
    if (error) throw new Error(error.message);
}

export async function getToken(userId: string, provider: Provider): Promise<StoredToken | null> {
    const db = getSupabaseAdmin();
    const { data } = await db
        .from("user_oauth_tokens")
        .select("access_token, github_login")
        .eq("user_id", userId)
        .eq("provider", provider)
        .maybeSingle();
    if (!data) return null;
    return { token: data.access_token, githubLogin: data.github_login ?? undefined };
}

export async function deleteToken(userId: string, provider: Provider): Promise<void> {
    const db = getSupabaseAdmin();
    const { error } = await db
        .from("user_oauth_tokens")
        .delete()
        .eq("user_id", userId)
        .eq("provider", provider);
    if (error) throw new Error(error.message);
}
