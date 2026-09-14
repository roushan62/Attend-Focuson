"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./clientlib";

export default function SettingsForm({ initial }: { initial: { name: string; cutoff_time: string; default_radius_m: string; timezone: string } }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api("/api/company", "PATCH", f);
      setMsg({ ok: true, text: "Saved ✅" });
      router.refresh();
    } catch (ex: any) {
      setMsg({ ok: false, text: String(ex?.message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <label className="label">Company name</label>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Cutoff time</label>
          <input type="time" value={f.cutoff_time} onChange={(e) => setF({ ...f, cutoff_time: e.target.value })} />
        </div>
        <div>
          <label className="label">Default radius (m)</label>
          <input type="number" min={10} max={2000} value={f.default_radius_m} onChange={(e) => setF({ ...f, default_radius_m: e.target.value })} />
        </div>
        <div>
          <label className="label">Timezone</label>
          <select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka"].map((t) => (
              <option key={t} value={t}>{t.replace("Asia/", "")}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Cutoff ke baad ka check-in late request banega (reason ke saath), outside radius ka
        auto-pending. Per-site radius usse override karta hai (Sites page me).
      </p>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button>
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>
      )}
    </form>
  );
}
