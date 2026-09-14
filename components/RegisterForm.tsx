"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** First-time setup by the company owner/admin: company + their login. */
export default function RegisterForm() {
  const router = useRouter();
  const [f, setF] = useState({ company: "", name: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Registration failed");
      router.push("/admin");
      router.refresh();
    } catch (ex: any) {
      setErr(String(ex?.message || "Failed")); setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-8 max-w-sm px-4">
      <div className="mb-6 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-2 h-14 w-14" />
        <h1 className="text-2xl font-black">Company sign-up</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pehle company ka admin account banega — phir wahi aapke workers ko add karega.
        </p>
      </div>
      <form onSubmit={submit} className="card">
        <div className="field">
          <label className="label">Company name</label>
          <input value={f.company} onChange={set("company")} placeholder="Shreeji Constructions" required />
        </div>
        <div className="field">
          <label className="label">Your name (admin)</label>
          <input value={f.name} onChange={set("name")} placeholder="Rajesh Sharma" required />
        </div>
        <div className="field">
          <label className="label">Your mobile (login ke liye)</label>
          <input inputMode="numeric" value={f.phone} onChange={set("phone")} placeholder="98765 43210" required />
        </div>
        <div className="field">
          <label className="label">Password (min 6)</label>
          <input type="password" value={f.password} onChange={set("password")} required minLength={6} />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : "Create company + admin login"}
        </button>
        {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <p className="mt-3 text-center text-xs text-slate-500">
          Already account hai? <a href="/login" className="font-bold text-slate-800 underline">Login</a>
        </p>
      </form>
    </div>
  );
}
