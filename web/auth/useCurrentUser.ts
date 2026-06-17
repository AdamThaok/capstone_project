"use client";
/**
 * useCurrentUser — reads the `uid` cookie set by login/signup.
 * The cookie is httpOnly:false so it's readable in the browser.
 * Uses useEffect to avoid SSR/client hydration mismatch.
 */

import { useState, useEffect } from "react";

export type CurrentUser = { id: string; name: string; email: string };

const FALLBACK: CurrentUser = { id: "admin", name: "", email: "" };

function parseCookie(name: string): string | undefined {
    const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : undefined;
}

export function useCurrentUser(): CurrentUser {
    const [user, setUser] = useState<CurrentUser>(FALLBACK);

    useEffect(() => {
        try {
            const raw = parseCookie("uid");
            if (raw) setUser(JSON.parse(raw) as CurrentUser);
        } catch { /* ignore */ }
    }, []);

    return user;
}
