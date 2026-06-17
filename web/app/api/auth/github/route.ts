// GET /api/auth/github — start the GitHub OAuth dance.
// Sets a CSRF `state` cookie, then redirects the browser to GitHub's consent
// screen. GitHub calls us back at /api/auth/github/callback.

import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import crypto           from "node:crypto";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET() {
    const jar = await cookies();
    if (jar.get("session")?.value !== "ok")
        return NextResponse.redirect(`${BASE_URL}/login`);

    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId)
        return NextResponse.redirect(`${BASE_URL}/dashboard?connect=github_unconfigured`);

    const state = crypto.randomBytes(16).toString("hex");
    jar.set("gh_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        maxAge:   600,
        secure:   process.env.NODE_ENV === "production",
    });

    const params = new URLSearchParams({
        client_id:    clientId,
        redirect_uri: `${BASE_URL}/api/auth/github/callback`,
        scope:        "repo user:email",
        state,
    });
    return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
