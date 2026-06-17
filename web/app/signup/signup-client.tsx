"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Password strength scorer (0 = very weak … 4 = strong)
// ---------------------------------------------------------------------------
type StrengthLevel = 0 | 1 | 2 | 3 | 4;

function scorePassword(pw: string): StrengthLevel {
    if (!pw) return 0;
    let score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    return Math.min(4, score) as StrengthLevel;
}

const STRENGTH_LABELS: Record<StrengthLevel, string> = {
    0: "",
    1: "Weak",
    2: "Fair",
    3: "Good",
    4: "Strong",
};
const STRENGTH_COLORS: Record<StrengthLevel, string> = {
    0: "transparent",
    1: "#f87171",
    2: "#fb923c",
    3: "#facc15",
    4: "#4ade80",
};

function StrengthBar({ password }: { password: string }) {
    const score = scorePassword(password);
    if (!password) return null;
    return (
        <div style={{ marginTop: ".4rem" }}>
            <div style={{ display: "flex", gap: "3px" }}>
                {([1, 2, 3, 4] as StrengthLevel[]).map((lvl) => (
                    <div key={lvl} style={{
                        flex: 1, height: "4px", borderRadius: "2px",
                        background: score >= lvl ? STRENGTH_COLORS[score] : "#1f1f1f",
                        transition: "background .3s",
                    }} />
                ))}
            </div>
            <div style={{ fontSize: ".72rem", color: STRENGTH_COLORS[score], marginTop: ".2rem" }}>
                {STRENGTH_LABELS[score]}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------

type FieldError = {
    name?:            string;
    email?:           string;
    password?:        string;
    confirmPassword?: string;
};

function validate(name: string, email: string, password: string, confirmPassword: string): FieldError {
    const errs: FieldError = {};
    if (!name.trim())                   errs.name = "Full name is required.";
    if (!email.trim())                  errs.email = "Email address is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Enter a valid email address.";
    if (!password)                      errs.password = "Password is required.";
    else if (password.length < 8)       errs.password = "At least 8 characters required.";
    else if (!/[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))
        errs.password = "Add a number or special character.";
    if (password && confirmPassword && password !== confirmPassword)
        errs.confirmPassword = "Passwords do not match.";
    return errs;
}

// ---------------------------------------------------------------------------

export default function SignupClient() {
    const router = useRouter();

    const [name,            setName]            = useState("");
    const [email,           setEmail]           = useState("");
    const [password,        setPassword]        = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPw,          setShowPw]          = useState(false);
    const [touched,         setTouched]         = useState<Record<string, boolean>>({});
    const [serverError,     setServerError]     = useState<string | null>(null);
    const [loading,         setLoading]         = useState(false);
    const [success,         setSuccess]         = useState<string | null>(null);

    const fieldErrors = validate(name, email, password, confirmPassword);
    const isValid     = Object.keys(fieldErrors).length === 0;

    function blur(field: string) { setTouched((t) => ({ ...t, [field]: true })); }

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        // Mark all fields as touched to surface all errors.
        setTouched({ name: true, email: true, password: true, confirmPassword: true });
        if (!isValid) return;

        setLoading(true);
        setServerError(null);

        const res = await fetch("/api/signup", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ name, email, password, confirmPassword }),
        });
        const data = await res.json().catch(() => ({}));
        setLoading(false);

        if (!res.ok) {
            setServerError(data.error || "Registration failed. Please try again.");
            return;
        }

        setSuccess(data.name ?? name.split(" ")[0]);
        setTimeout(() => {
            router.push("/projects");
            router.refresh();
        }, 1800);
    }

    // ---- Success screen ----
    if (success) {
        return (
            <main className="container">
                <div className="card" style={{ textAlign: "center", gap: "1rem", display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ fontSize: "3rem" }}>🎉</div>
                    <h1 style={{ margin: 0 }}>Welcome, {success}!</h1>
                    <p className="sub" style={{ margin: 0 }}>Your account has been created. Redirecting…</p>
                    <div className="signup-spinner" />
                </div>
            </main>
        );
    }

    function err(field: keyof FieldError) {
        return touched[field] ? fieldErrors[field] : undefined;
    }

    return (
        <main className="container">
            <form className="card signup-card" onSubmit={onSubmit} noValidate>
                {/* Header */}
                <div className="signup-logo">OPM<span>→</span>Code</div>
                <h1>Create your account</h1>
                <p className="sub">Start generating full-stack apps from OPM diagrams.</p>

                {/* Full name */}
                <div className={`field ${err("name") ? "field-err" : ""}`}>
                    <label>Full name</label>
                    <input
                        type="text"
                        placeholder="Jane Smith"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => blur("name")}
                        autoFocus
                        autoComplete="name"
                    />
                    {err("name") && <div className="field-msg">{err("name")}</div>}
                </div>

                {/* Email */}
                <div className={`field ${err("email") ? "field-err" : ""}`}>
                    <label>Email address</label>
                    <input
                        type="email"
                        placeholder="jane@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => blur("email")}
                        autoComplete="email"
                    />
                    {err("email") && <div className="field-msg">{err("email")}</div>}
                </div>

                {/* Password */}
                <div className={`field ${err("password") ? "field-err" : ""}`}>
                    <label>Password</label>
                    <div className="pw-wrap">
                        <input
                            type={showPw ? "text" : "password"}
                            placeholder="Min. 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onBlur={() => blur("password")}
                            autoComplete="new-password"
                        />
                        <button
                            type="button"
                            className="pw-toggle"
                            onClick={() => setShowPw((v) => !v)}
                            tabIndex={-1}
                            aria-label={showPw ? "Hide password" : "Show password"}
                        >
                            {showPw ? "Hide" : "Show"}
                        </button>
                    </div>
                    {err("password") && <div className="field-msg">{err("password")}</div>}
                    <StrengthBar password={password} />
                </div>

                {/* Confirm password */}
                <div className={`field ${err("confirmPassword") ? "field-err" : ""}`}>
                    <label>Confirm password</label>
                    <input
                        type={showPw ? "text" : "password"}
                        placeholder="Repeat your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onBlur={() => blur("confirmPassword")}
                        autoComplete="new-password"
                    />
                    {err("confirmPassword") && <div className="field-msg">{err("confirmPassword")}</div>}
                    {!err("confirmPassword") && confirmPassword && password === confirmPassword && (
                        <div className="field-msg field-ok">✓ Passwords match</div>
                    )}
                </div>

                {serverError && <div className="error">{serverError}</div>}

                <button className="primary signup-submit" type="submit" disabled={loading}>
                    {loading ? "Creating account…" : "Create account"}
                </button>

                <p className="muted">
                    Already have an account?{" "}
                    <Link href="/login" style={{ color: "#7aa2f7" }}>Log in</Link>
                </p>
            </form>
        </main>
    );
}
