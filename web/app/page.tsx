import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <div className="card">
        <h1>Capstone Milestone</h1>
        <p className="sub">OPM → Code — deployment test</p>
        <Link href="/login" className="primary" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>Login</Link>
      </div>
    </main>
  );
}
