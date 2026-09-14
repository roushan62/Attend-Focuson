"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./clientlib";

/** Admin approval buttons on each pending request. */
export default function ReqActions({ id, types }: { id: string; types: string[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState("");

  const effect =
    types.includes("leave") ? "Leave mark hoga (unpaid)" :
    types.includes("half_day") ? "Aadha din pay" :
    types.includes("late") ? "Din paid, 'Late' tag ke saath" :
    "Full paid day (On Duty)";

  async function act(a: "approve" | "reject") {
    setBusy(a); setErr("");
    try {
      await api(`/api/requests/${id}`, "PATCH", { action: a, note });
      router.refresh();
    } catch (ex: any) {
      setErr(String(ex?.message));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. verified with supervisor" />
      <div className="flex items-center gap-2">
        <button onClick={() => act("approve")} disabled={!!busy} className="btn-success flex-1 !py-2 text-xs">
          ✓ Approve · {effect}
        </button>
        <button onClick={() => act("reject")} disabled={!!busy} className="btn-danger flex-1 !py-2 text-xs">
          ✕ Reject
        </button>
      </div>
      {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{err}</p>}
    </div>
  );
}
