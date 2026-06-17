// POST /api/auth/railway — save the current user's Railway API token.
// Railway has no public OAuth app registration, so the user generates a token
// at railway.app/account/tokens and pastes it once.
// Body: { token: string }

import { NextResponse }     from "next/server";
import { cookies }          from "next/headers";
import { saveToken }        from "@/web/auth/oauth-tokens";
import { userIdFromCookie } from "@/web/auth/session";

export async function POST(req: Request) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const userId = userIdFromCookie(jar.get("uid")?.value);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body  = (await req.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

    await saveToken(userId, "railway", token);
    return NextResponse.json({ ok: true });
}
