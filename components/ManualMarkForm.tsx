"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, getLivePosition } from "./clientlib";

/**
 * Supervisor/admin on-site marking for a worker (paper-register replacement):
 * pick employee + date + site. "Mark at my GPS" verifies distance exactly
 * like the employee flow; "Override" records manually with a note.
 */
export default function ManualMarkForm({ employees, projects }: {
  employees: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [emp, setEmp] = useState(employees[0]?.id ?? "");
  const [proj, setProj] = useState(projects[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<"gps" | "override" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function mark(viaGps: boolean) {
    if (viaGps) {
      setBusy("gps");
      try {
        const pos = await getLivePosition();
        const res = await api("/api/attendance/mark", "POST", {
          action: "in", employeeId: emp, projectId: proj,
          lat: pos.lat, lng: pos.lng, remarks,
        });
        setMsg({ ok: true, text: res.message || "Marked ✅" });
      } catch (e: any) {
        setMsg({ ok: false, text: String(e?.message) });
      } finally {
        setBusy(null);
      }
    } else {
      setBusy("override");
      try {
        await api("/api/attendance/manual", "POST", { employeeId: emp, projectId: proj, date, remarks });
        setMsg({ ok: true, text: "Manual record saved ✅" });
        router.refresh();
      } catch (e: any) {
        setMsg({ ok: false, text: String(e?.message) });
      } finally {
        setBusy(null);
      }
    }
    router.refresh();
  }

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-bold text-slate-700">✍️ Mark attendance for a worker</h3>
      <div className="grid grid-cols-2 gap-2">
        <select value={emp} onChange={(e) => setEmp(e.target.value)}>
          {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select value={proj} onChange={(e) => setProj(e.target.value)}>
          {projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remark — e.g. register lost, supervisor present" />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => mark(true)} disabled={!!busy || !emp || !proj} className="btn-success text-xs">
          {busy === "gps" ? "Locating…" : "📍 Verify with my GPS"}
        </button>
        <button onClick={() => mark(false)} disabled={!!busy || !emp || !proj || !date} className="btn-primary text-xs">
          {busy === "override" ? "Saving…" : "Override (manual entry)"}
        </button>
      </div>
      {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>}
    </div>
  );
}
