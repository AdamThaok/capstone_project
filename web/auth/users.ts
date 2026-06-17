/**
 * web/auth/users.ts — Supabase-backed user store.
 * Passwords hashed with Node crypto.scrypt.
 */

import crypto from "node:crypto";
import { getSupabaseAdmin } from "./supabase-client";

export type User = {
    id:           string;
    name:         string;
    email:        string;
    passwordHash: string;
    salt:         string;
    createdAt:    string;
    verified:     boolean;
};

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 64 };

async function hashPassword(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(
            password,
            Buffer.from(salt, "hex"),
            SCRYPT_PARAMS.keyLen,
            { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
            (err, derived) => { if (err) reject(err); else resolve(derived.toString("hex")); },
        );
    });
}

function isValidEmail(e: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function isStrongEnough(p: string) {
    return p.length >= 8 && /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateUserInput  = { name: string; email: string; password: string; };
export type CreateUserResult =
    | { ok: true;  user: User }
    | { ok: false; error: "email_taken" | "invalid_email" | "weak_password" };

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const email = input.email.trim().toLowerCase();
    if (!isValidEmail(email))            return { ok: false, error: "invalid_email" };
    if (!isStrongEnough(input.password)) return { ok: false, error: "weak_password" };

    const db = getSupabaseAdmin();
    const { data: existing } = await db.from("opm_users").select("id").eq("email", email).maybeSingle();
    if (existing) return { ok: false, error: "email_taken" };

    const salt         = crypto.randomBytes(32).toString("hex");
    const passwordHash = await hashPassword(input.password, salt);
    const id           = crypto.randomUUID();
    const now          = new Date().toISOString();

    const { error } = await db.from("opm_users").insert({
        id, name: input.name.trim(), email,
        password_hash: passwordHash, salt, created_at: now, verified: true,
    });
    if (error) throw new Error(error.message);

    return { ok: true, user: { id, name: input.name.trim(), email, passwordHash, salt, createdAt: now, verified: true } };
}

export async function findUserByEmailAsync(email: string): Promise<User | undefined> {
    const db = getSupabaseAdmin();
    const { data } = await db.from("opm_users").select("*").eq("email", email.trim().toLowerCase()).maybeSingle();
    if (!data) return undefined;
    return { id: data.id, name: data.name, email: data.email, passwordHash: data.password_hash, salt: data.salt, createdAt: data.created_at, verified: data.verified };
}

export async function findUserById(id: string): Promise<User | undefined> {
    const db = getSupabaseAdmin();
    const { data } = await db.from("opm_users").select("*").eq("id", id).maybeSingle();
    if (!data) return undefined;
    return { id: data.id, name: data.name, email: data.email, passwordHash: data.password_hash, salt: data.salt, createdAt: data.created_at, verified: data.verified };
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
    const derived = await hashPassword(password, user.salt);
    const a = Buffer.from(user.passwordHash, "hex");
    const b = Buffer.from(derived, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}
