"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./clientlib";

/** Admin: add / edit employee — phone + password is their whole login. */
export default function AdminEmployeeForm({ initial, projects, isAdmin, onDone }: {
  initial?: any;
  projects: { id: string; name: string }[];
  isAdmin: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    name: "", phone: "", password: "", role: "employee",
    daily_wage: "800", current_project_id: "", status: "active",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (initial) setF({ ...f, ...initial, password: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (initial?.id) {
        const patch: any = { ...f };
        if (!patch.password) delete patch.password;
        await api(`/api/employees?id=${initial.id}`, "PATCH", patch);
      } else {
        await api("/api/employees", "POST", f);
      }
      setMsg({ ok: true, text: initial?.id ? "Updated ✅" : "Employee added ✅ — ab wo isi phone+password se login karega." });
      if (!initial?.id) setF({ ...f, name: "", phone: "", password: "" });
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
      <h3 className="text-sm font-bold text-slate-700">{initial?.id ? "Edit employee" : "➕ Add employee"}</h3>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Full name" value={f.name} onChange={set("name")} required />
        <input placeholder="Mobile (10-digit)" inputMode="numeric" value={f.phone} onChange={set("phone")} required />
      </div>
      <input
        type={initial?.id ? "text" : "text"}
        placeholder={initial?.id ? "New password (khali chhodo = same rahega)" : "Login password (min 6)"}
        value={f.password} onChange={set("password")} {...(!initial?.id ? { required: true, minLength: 6 } : { minLength: 6 })}
      />
      <div className="grid grid-cols-3 gap-2">
        <select value={f.role} onChange={set("role")} disabled={!isAdmin}>
          <option value="employee">Employee</option>
          <option value="hr">HR</option>
        </select>
        <input inputMode="numeric" type="number" placeholder="Daily wage ₹" value={f.daily_wage} onChange={set("daily_wage")} />
        {initial?.id ? (
          <select value={f.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        ) : (
          <span />
        )}
      </div>
      <div>
        <label className="label">Assigned site (attendance isi pe default mark hogi)</label>
        <select value={f.current_project_id} onChange={set("current_project_id")}>
          <option value="">— not assigned —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : initial?.id ? "Update" : "Add employee"}</button>
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</p>
      )}
    </form>
  );
}
