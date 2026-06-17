"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username: email, password }),
      });
      const data = await res.json().catch(() => ({}));
      setLoading(false);
      if (!res.ok) {
        const msg = data.error || `Login failed (${res.status})`;
        alert("❌ " + msg);
        return setError(msg);
      }
      alert("✅ Login OK! Redirecting...");
      // Login OK — hard navigate so cookies are sent on first server request
      window.location.replace("/projects");
    } catch (err) {
      setLoading(false);
      setError(`Network error: ${(err as Error).message}`);
    }
  }

  return (
    <main className="container">
      <form className="card signup-card" onSubmit={onSubmit}>
        <div className="signup-logo">OPM<span>→</span>Code</div>
        <h1>Welcome back</h1>
        <p className="sub">Log in to manage your projects.</p>

        <div className="field">
          <label>Email address</label>
          <input
            type="email"
            placeholder="jane@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />
        </div>

        <div className="field">
          <label>Password</label>
          <div className="pw-wrap">
            <input
              type={showPw ? "text" : "password"}
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
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
        </div>

        {error && <div className="error">{error}</div>}

        <button className="primary signup-submit" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Log in"}
        </button>

        <p className="muted">
          New here?{" "}
          <Link href="/signup" style={{ color: "#7aa2f7" }}>Create a free account</Link>
        </p>
      </form>
    </main>
  );
}
