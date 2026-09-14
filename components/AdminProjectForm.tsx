"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getLivePosition } from "./clientlib";

/** Admin: create/edit a site (geofence centre + radius). "Use my location"
 *  is made for the supervisor standing at the site itself. */
export default function AdminProjectForm({ initial, onDone }: { initial?: any; onDone?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "", address: "", latitude: "", longitude: "", radius_m: "50",
    start_date: "", end_date: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (initial) setF({ ...f, ...initial });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function useMyLocation() {
    setMsg(null);
    try {
      const p = await getLivePosition();
      setF((f0) => ({ ...f0, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }));
      setMsg({ ok: true, text: `Location captured (±${p.accuracy} m). Site boundary ke andar khade ho to theek hai.` });
    } catch (e: any) {
      setMsg({ ok: false, text: String(e?.message) });
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (initial?.id) await api(`/api/projects?id=${initial.id}`, "PATCH", f);
      else await api("/api/projects", "POST", f);
      setMsg({ ok: true, text: initial?.id ? "Site updated ✅" : "Site added ✅" });
      if (!initial?.id) setF({ name: "", address: "", latitude: "", longitude: "", radius_m: "50", start_date: "", end_date: "" });
      router.refresh();
      onDone?.();
    } catch (ex: any) {
      setMsg({ ok: false, text: String(ex?.message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">{initial?.id ? "Edit site" : "➕ Add new site / project"}</h3>
        <button type="button" onClick={useMyLocation} className="btn-ghost !px-2.5 !py-1 text-xs">
          📍 Use my location
        </button>
      </div>
      <input placeholder="Site name" value={f.name} onChange={set("name")} required />
      <input placeholder="Address" value={f.address} onChange={set("address")} />
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Latitude</label>
          <input inputMode="decimal" value={f.latitude} onChange={set("latitude")} required placeholder="19.1197" />
        </div>
        <div>
          <label className="label">Longitude</label>
          <input inputMode="decimal" value={f.longitude} onChange={set("longitude")} required placeholder="72.8464" />
        </div>
        <div>
          <label className="label">Radius m</label>
          <input inputMode="numeric" type="number" min={10} max={2000} value={f.radius_m} onChange={set("radius_m")} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Start date</label><input type="date" value={f.start_date} onChange={set("start_date")} /></div>
        <div><label className="label">End date</label><input type="date" value={f.end_date} onChange={set("end_date")} /></div>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Update site" : "Create site"}</button>
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>
      )}
    </form>
  );
}
