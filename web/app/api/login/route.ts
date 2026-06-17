import { NextResponse }              from "next/server";
import { cookies }                  from "next/headers";
import { findUserByEmailAsync, verifyPassword } from "@/web/auth/users";

const ADMIN_USERNAME = process.env.DEMO_USERNAME || "admin@opm.dev";
const ADMIN_PASSWORD = process.env.DEMO_PASSWORD || "admin";

export async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body as Record<string, string>;

    if (!username || !password)
        return NextResponse.json({ error: "Email and password are required." }, { status: 400 });

    let displayName   = ADMIN_USERNAME;
    let userId        = "admin";
    let authenticated = false;

    // 1. Try Supabase user store.
    try {
        const user = await findUserByEmailAsync(username);
        if (user) {
            if (await verifyPassword(user, password)) {
                authenticated = true;
                displayName   = user.name;
                userId        = user.id;
            } else {
                return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
            }
        }
    } catch (e) {
        console.warn("[login] Supabase lookup failed:", (e as Error).message);
    }

    // 2. Fallback: hardcoded admin credentials.
    if (!authenticated) {
        if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
            authenticated = true;
        }
    }

    if (!authenticated)
        return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

    const jar = await cookies();
    jar.set("session", "ok", {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        maxAge:   60 * 60 * 24 * 7,
        secure:   process.env.NODE_ENV === "production",
    });
    jar.set("uid", JSON.stringify({ id: userId, name: displayName, email: username }), {
        httpOnly: false,
        sameSite: "lax",
        path:     "/",
        maxAge:   60 * 60 * 24 * 7,
        secure:   process.env.NODE_ENV === "production",
    });

    return NextResponse.json({ ok: true, name: displayName });
}
