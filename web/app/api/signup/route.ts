import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import { createUser }   from "@/web/auth/users";

export async function POST(req: Request) {
    const body = await req.json().catch(() => ({}));
    const { name, email, password, confirmPassword } = body as Record<string, string>;

    // ---- basic field checks ----
    if (!name?.trim())
        return NextResponse.json({ error: "Name is required." }, { status: 400 });
    if (!email?.trim())
        return NextResponse.json({ error: "Email is required." }, { status: 400 });
    if (!password)
        return NextResponse.json({ error: "Password is required." }, { status: 400 });
    if (password !== confirmPassword)
        return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });

    // ---- create user ----
    let result: Awaited<ReturnType<typeof createUser>>;
    try {
        result = await createUser({ name: name.trim(), email: email.trim(), password });
    } catch (e) {
        console.error("[signup] createUser threw:", e);
        return NextResponse.json({ error: `Server error: ${(e as Error).message}` }, { status: 500 });
    }

    if (!result.ok) {
        const messages: Record<string, string> = {
            email_taken:    "An account with this email already exists.",
            invalid_email:  "Please enter a valid email address.",
            weak_password:  "Password must be at least 8 characters and contain a number or special character.",
        };
        return NextResponse.json(
            { error: messages[result.error] ?? "Registration failed." },
            { status: 400 },
        );
    }

    const user = result.user;

    // ---- set session cookies ----
    const jar = await cookies();
    jar.set("session", "ok", {
        httpOnly: true,
        sameSite: "lax",
        path:     "/",
        maxAge:   60 * 60 * 24 * 7,
        secure:   process.env.NODE_ENV === "production",
    });
    // uid cookie is readable client-side for display purposes (not security-sensitive)
    jar.set("uid", JSON.stringify({ id: user.id, name: user.name, email: user.email }), {
        httpOnly: false,
        sameSite: "lax",
        path:     "/",
        maxAge:   60 * 60 * 24 * 7,
        secure:   process.env.NODE_ENV === "production",
    });

    return NextResponse.json({ ok: true, name: user.name });
}
