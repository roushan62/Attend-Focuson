"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Phone + password login. One form for employees, HR and admins. */
export default function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.push(data.next || "/dashboard");
      router.refresh();
    } catch (ex: any) {
      setErr(String(ex?.message || "Login failed"));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm px-4">
      <div className="mb-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-2 h-14 w-14" />
        <h1 className="text-2xl font-black tracking-tight">SiteAttend</h1>
        <p className="mt-1 text-sm text-slate-500">
          Location-verified attendance for site teams
        </p>
      </div>

      <form onSubmit={submit} className="card">
        <div className="field">
          <label className="label">Mobile number</label>
          <input
            inputMode="numeric" autoComplete="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98765 43210" required
          />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input
            type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••" required
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Login"}
        </button>
        {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <p className="mt-3 text-center text-xs text-slate-500">
          Nayi company? <Link href="/register" className="font-bold text-slate-800 underline">Admin sign-up</Link> —
          phir admin aapko add karega.
        </p>
      </form>

      {demo && (
        <div className="card mt-4 border-amber-300 bg-amber-50 text-sm">
          <p className="font-bold text-amber-900">🧪 Demo mode (local data)</p>
          <p className="mt-1 text-xs text-amber-800">
            Ye copy Google Sheets se connect nahi hai — demo company loaded hai. Try karo:
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            <li>Admin — <b>9000000001</b> / <b>admin@123</b></li>
            <li>HR — <b>9000000002</b> / <b>hr@123</b></li>
            <li>Worker (Sunil) — <b>9000000011</b> / <b>attend@123</b></li>
          </ul>
        </div>
      )}
    </div>
  );
}
