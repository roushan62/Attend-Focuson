import { requireSession } from "@/lib/auth";
import { list } from "@/lib/db";
import { companyOf, projectsOf } from "@/lib/domain";
import { REQ_META, type ReqType } from "@/lib/types";
import { fmtDateHuman } from "@/lib/time";
import ReqForm from "@/components/ReqForm";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  pending: "bg-orange-100 text-orange-800 border-orange-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
};

/** My requests — history of everything I filed, plus the new-request form. */
export default async function MyRequests() {
  const s = await requireSession();
  const [company, projects] = await Promise.all([companyOf(s.cid), projectsOf(s.cid)]);
  const mine = (
    await list("Requests", (r) => r.company_id === s.cid && r.employee_id === s.uid)
  ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">Requests</h1>
        <p className="text-sm text-slate-500">
          Leave, half-day ya paid travel/duty — sab yahin. Late/outing ki requests
          attendance mark karte hi apne aap ban jaati hain.
        </p>
      </div>

      <ReqForm projects={projects.map((p) => ({ id: p.id, name: p.name }))} />

      <div className="space-y-2">
        {mine.map((r) => (
          <div key={r.id} className="card !p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold">
                {REQ_META[r.type as ReqType]?.label ?? r.type}
              </span>
              <span className={`chip ${TONE[r.status] ?? TONE.pending}`}>{r.status}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {fmtDateHuman(r.from_date)}
              {r.to_date && r.to_date !== r.from_date ? ` → ${fmtDateHuman(r.to_date)}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">“{r.reason}”</p>
            {r.review_note && (
              <p className="mt-1 rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600">
                Review: {r.review_note}
              </p>
            )}
            <p className="mt-1 text-[10px] text-slate-400">
              filed {r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: company.timezone || "Asia/Kolkata" }) : ""} · {r.status === "pending" ? "waiting for admin" : r.status}
            </p>
          </div>
        ))}
        {mine.length === 0 && (
          <p className="card text-center text-sm text-slate-400">Abhi tak koi request nahi.</p>
        )}
      </div>
    </div>
  );
}
