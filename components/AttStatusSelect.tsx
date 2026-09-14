"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./clientlib";
import { statusMeta } from "@/lib/types";

const OPTIONS = ["present", "late", "half_day", "on_duty", "leave", "absent"] as const;

/** Admin: quick status correction on any attendance row. */
export default function AttStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [val, setVal] = useState(status);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (val === status) return;
    setBusy(true);
    try {
      await api(`/api/attendance/${id}`, "PATCH", { status: val });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select value={OPTIONS.includes(val as any) ? val : status} onChange={(e) => setVal(e.target.value)} className="!py-1 text-xs">
        {!OPTIONS.includes(status as any) && (
          <option value={status}>{statusMeta(status).label} (pending)</option>
        )}
        {OPTIONS.map((o) => <option key={o} value={o}>{statusMeta(o).label}</option>)}
      </select>
      {val !== status && (
        <button onClick={save} disabled={busy} className="btn-primary !px-2 !py-1 text-[10px]">{busy ? "…" : "Save"}</button>
      )}
    </span>
  );
}
