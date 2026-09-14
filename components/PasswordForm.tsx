"use client";

import { useState } from "react";
import { api } from "./clientlib";

export default function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api("/api/auth/password", "POST", { current, next });
      setMsg({ ok: true, text: "Password change ho gaya ✅" });
      setCurrent(""); setNext("");
    } catch (ex: any) {
      setMsg({ ok: false, text: String(ex?.message || "Failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <h3 className="text-sm font-bold text-slate-700">🔒 Change password</h3>
      <input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <input type="password" placeholder="New password (min 6)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={6} />
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {msg.text}
        </p>
      )}
    </form>
  );
}
