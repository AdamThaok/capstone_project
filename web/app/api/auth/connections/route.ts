// GET /api/auth/connections — which providers has the current user connected?
// Returns booleans + the GitHub username only. Raw tokens never leave the server.

import { NextResponse }     from "next/server";
import { cookies }          from "next/headers";
import { getToken }         from "@/web/auth/oauth-tokens";
import { userIdFromCookie } from "@/web/auth/session";

export async function GET() {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const userId = userIdFromCookie(jar.get("uid")?.value);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    try {
        const [gh, rw] = await Promise.all([
            getToken(userId, "github"),
            getToken(userId, "railway"),
        ]);
        return NextResponse.json({
            github:      !!gh,
            githubLogin: gh?.githubLogin,
            railway:     !!rw,
        });
    } catch {
        // Supabase unavailable → report nothing connected rather than 500.
        return NextResponse.json({ github: false, railway: false });
    }
}
