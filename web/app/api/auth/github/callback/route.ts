// GET /api/auth/github/callback — finish the GitHub OAuth dance.
// Validates the CSRF state, exchanges the code for an access token, looks up
// the GitHub username, stores the token against the current user, and bounces
// back to the dashboard.

import { NextResponse }     from "next/server";
import { cookies }          from "next/headers";
import { saveToken }        from "@/web/auth/oauth-tokens";
import { userIdFromCookie } from "@/web/auth/session";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export async function GET(req: Request) {
    const jar = await cookies();
    const url = new URL(req.url);
    const code          = url.searchParams.get("code");
    const state         = url.searchParams.get("state");
    const expectedState = jar.get("gh_oauth_state")?.value;

    const back = (reason: string) =>
        NextResponse.redirect(`${BASE_URL}/dashboard?connect=${reason}`);

    // One-time state cookie — clear it whatever happens next.
    jar.set("gh_oauth_state", "", { path: "/", maxAge: 0 });

    // CSRF: the `state` we get back must match the one we issued.
    if (!code || !state || !expectedState || state !== expectedState)
        return back("github_error");

    const userId = userIdFromCookie(jar.get("uid")?.value);
    if (!userId) return NextResponse.redirect(`${BASE_URL}/login`);

    const clientId     = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return back("github_unconfigured");

    try {
        // 1. Exchange the authorization code for an access token.
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
            method:  "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        const tokenJson  = (await tokenRes.json()) as { access_token?: string };
        const accessToken = tokenJson.access_token;
        if (!accessToken) return back("github_error");

        // 2. Identify the authorizing GitHub account.
        const userRes = await fetch("https://api.github.com/user", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept:        "application/vnd.github+json",
                "User-Agent":  "opm-to-app",
            },
        });
        const ghUser = (await userRes.json()) as { login?: string };
        if (!ghUser.login) return back("github_error");

        // 3. Store the token for this user.
        await saveToken(userId, "github", accessToken, ghUser.login);
    } catch {
        return back("github_error");
    }

    return back("github_ok");
}
