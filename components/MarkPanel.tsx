"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, getLivePosition } from "./clientlib";

/**
 * Big GPS check-in / check-out panel shown on the dashboard and on any
 * project page (for site visits). Sends raw coordinates; the server does
 * the geofence maths — the phone can't fake being on site.
 */
export default function MarkPanel({
  projectId, projectName, radius, status, checkedOut, cutoff,
}: {
  projectId: string;
  projectName: string;
  radius: number;
  status: string | null; // today's attendance status, null = not marked
  checkedOut: boolean;
  cutoff: string; // company cutoff "11:00"
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [reason, setReason] = useState("");

  const pending = !!status && status.endsWith("_pending");
  const marked = !!status && !pending;

  async function mark(action: "in" | "out") {
    setErr(""); setOk("");
    setBusy(action);
    try {
      const pos = await getLivePosition();
      const res = await api("/api/attendance/mark", "POST", {
        action, projectId, lat: pos.lat, lng: pos.lng,
        remarks: reason.trim() || undefined,
        accuracy_m: pos.accuracy,
      });
      setOk(res.message || "Done ✅");
      setReason("");
      router.refresh();
    } catch (e: any) {
      const msg = String(e?.message || "Kuch galat ho gaya");
      if (msg.includes("already")) setOk(msg);
      else setErr(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">📍 Mark attendance — {projectName}</h3>
        <span className="chip bg-slate-100 text-slate-600 border-slate-200">≤ {radius} m · before {cutoff}</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Site pe khade hokar button dabao. Location live GPS se li jayegi — bhaari
        buildings me 10–30 m ka farq normal hai, isiliye thoda door se reject ho to
        building ke andar ghuske dobara try karo.
      </p>

      {status && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          <span className={`chip ${pending ? "bg-orange-100 text-orange-800 border-orange-200" : "bg-emerald-100 text-emerald-800 border-emerald-200"}`}>
            Today: {status.replace(/_/g, " ")}
          </span>
          {checkedOut && <span className="chip bg-slate-100 text-slate-600 border-slate-200">Checked out</span>}
        </div>
      )}

      {pending && (
        <div className="field">
          <label className="label">Reason / karṇ (admin ko dikhega) </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Jaise: traffic, bus late, site visit for material, security ne roka…"
          />
        </div>
      )}
      {!status && (
        <div className="field">
          <label className="label">Reason (optional — late/outside mark hua to ye admin tak jayega)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — e.g. 10:45 pe pahuncha, auto rickshaw kharab tha"
          />
        </div>
      )}

      <div className="flex gap-2">
        {!marked ? (
          <button className="btn-success flex-1" disabled={!!busy} onClick={() => mark("in")}>
            {busy === "in" ? "🛰️ Taking GPS fix…" : pending ? "🔄 Re-mark with new location" : "✅ Mark IN — I am on site"}
          </button>
        ) : !checkedOut ? (
          <button className="btn-primary flex-1" disabled={!!busy} onClick={() => mark("out")}>
            {busy === "out" ? "🛰️ Locating…" : "🏁 Mark OUT (end of shift)"}
          </button>
        ) : (
          <div className="btn-primary flex-1 justify-center bg-slate-200 !text-slate-600">✓ Shift complete</div>
        )}
      </div>

      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      {ok && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</p>}
    </div>
  );
}
