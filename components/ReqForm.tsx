"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./clientlib";

/** Employee: leave / half-day / on-duty (paid travel-duty) request form. */
export default function ReqForm({ projects }: { projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<"leave" | "half_day" | "on_duty">("leave");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setOk("");
    try {
      await api("/api/requests/create", "POST", {
        type, from_date: from, to_date: to || from, reason,
        ...(projectId ? { project_id: projectId } : {}),
      });
      setOk("Request bhej di — admin panel me dikhega.");
      setReason("");
      router.refresh();
    } catch (ex: any) {
      setErr(String(ex?.message || "Failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div>
        <label className="label">Request type</label>
        <div className="grid grid-cols-3 gap-2">
          {([
            ["leave", "🌴 Leave"],
            ["half_day", "½ Half day"],
            ["on_duty", "🚚 On duty / travel"],
          ] as const).map(([v, lbl]) => (
            <button
              type="button" key={v} onClick={() => setType(v)}
              className={`rounded-xl border px-2 py-2 text-xs font-bold ${
                type === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>
        {type === "on_duty" && (
          <p className="mt-1 text-[11px] text-slate-500">
            Company bhej rahi hai kahin aur (material, dusri site, travel 2 din…) — approve hone par ye din paid “On Duty” count honge.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </div>
        <div>
          <label className="label">To (leave ke liye)</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} />
        </div>
      </div>
      {projects.length > 1 && (
        <div>
          <label className="label">Related site (optional)</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">My current site</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label">Reason (saaf saaf likho — approval ka karan)</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="Ghar ka kaam / medical / truck ke saath Noida site 2 din…" />
      </div>
      <button className="btn-primary w-full" disabled={busy || !from}>
        {busy ? "Sending…" : "Submit request"}
      </button>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      {ok && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>}
    </form>
  );
}
