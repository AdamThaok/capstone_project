// DELETE /api/auth/disconnect?provider=github|railway
// Removes the current user's stored token for one provider.

import { NextResponse }     from "next/server";
import { cookies }          from "next/headers";
import { deleteToken }      from "@/web/auth/oauth-tokens";
import { userIdFromCookie } from "@/web/auth/session";

export async function DELETE(req: Request) {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const userId = userIdFromCookie(jar.get("uid")?.value);
    if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const provider = new URL(req.url).searchParams.get("provider");
    if (provider !== "github" && provider !== "railway")
        return NextResponse.json({ error: "invalid provider" }, { status: 400 });

    await deleteToken(userId, provider);
    return NextResponse.json({ ok: true });
}
