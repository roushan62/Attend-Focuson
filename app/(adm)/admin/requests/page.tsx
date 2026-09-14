import { requireSession } from "@/lib/auth";
import { employeesOf, projectsOf } from "@/lib/domain";
import { list } from "@/lib/db";
import { fmtDateHuman } from "@/lib/time";
import { REQ_META, type ReqType } from "@/lib/types";
import ReqActions from "@/components/ReqActions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TONE: Record<string, string> = {
  pending: "bg-orange-100 text-orange-800 border-orange-200",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejected: "bg-rose-100 text-rose-800 border-rose-200",
};

/** Approval queue — late, outside-radius, site-visit, leave, half-day, travel. */
export default async function AdminRequests({ searchParams }: { searchParams: { f?: string } }) {
  const s = await requireSession(["admin", "hr"]);
  const filter = ["pending", "approved", "rejected"].includes(searchParams.f || "") ? searchParams.f! : "pending";

  const [requests, users, projects] = await Promise.all([
    list("Requests", (r) => r.company_id === s.cid && r.status === filter),
    employeesOf(s.cid), projectsOf(s.cid, false),
  ]);
  requests.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const empName = (id: string) => users.find((u) => u.id === id)?.name ?? "?";
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">Approvals</h1>
        <p className="text-sm text-slate-500">
          Approve = paid (late/on-duty) ya leave-entry. Reject pending-mark = absent.
        </p>
      </div>

      <div className="flex gap-1.5">
        {(["pending", "approved", "rejected"] as const).map((f) => (
          <Link key={f} href={`/admin/requests?f=${f}`} className={`chip capitalize ${filter === f ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"}`}>
            {f}
          </Link>
        ))}
      </div>

      {requests.length === 0 && (
        <div className="card text-center text-sm text-slate-400">
          {filter === "pending" ? "🎉 Koi pending request nahi — sab clear." : `No ${filter} requests.`}
        </div>
      )}

      {requests.map((r) => (
        <div key={r.id} className="card !p-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-black">{empName(r.employee_id)}</span>
                <span className="chip bg-slate-100 text-slate-600 border-slate-200">{REQ_META[r.type as ReqType]?.label ?? r.type}</span>
                <span className={`chip ${TONE[r.status]}`}>{r.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {fmtDateHuman(r.from_date)}{r.to_date !== r.from_date ? ` → ${fmtDateHuman(r.to_date)}` : ""}
                {" · "}site: {projName(r.project_id)}
              </p>
              <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700">“{r.reason}”</p>
              {r.review_note && <p className="mt-1 text-[11px] text-slate-400">Note: {r.review_note}</p>}
            </div>
          </div>
          {r.status === "pending" && <ReqActions id={r.id} types={[r.type]} />}
        </div>
      ))}
    </div>
  );
}
