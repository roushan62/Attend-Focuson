import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { companyOf, employeesOf, projectsOf, attendanceOn } from "@/lib/domain";
import { list } from "@/lib/db";
import { storageLabel } from "@/lib/db";
import { todayStr } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Admin home — today's live picture per site (what the whole app exists for). */
export default async function AdminHome() {
  const s = await requireSession(["admin", "hr"]);
  const company = await companyOf(s.cid);
  const tz = company.timezone || "Asia/Kolkata";
  const today = todayStr(tz);

  const [projects, employees, todays, pendingReqs] = await Promise.all([
    projectsOf(s.cid),
    employeesOf(s.cid),
    attendanceOn(s.cid, today),
    list("Requests", (r) => r.company_id === s.cid && r.status === "pending"),
  ]);

  const workers = employees.filter((u) => u.role !== "admin");
  const byEmp = new Map(todays.map((a) => [a.employee_id, a]));
  let present = 0, pending = 0, absent = 0;
  for (const w of workers) {
    const a = byEmp.get(w.id);
    if (!a) absent++;
    else if (a.status.endsWith("_pending")) pending++;
    else present++;
  }

  const siteRows = projects.map((p) => {
    const team = workers.filter((w) => w.current_project_id === p.id);
    const rows = todays.filter((a) => a.project_id === p.id);
    const on = rows.filter((a) => !a.status.endsWith("_pending") && a.status !== "absent" && a.status !== "leave").length;
    const pd = rows.filter((a) => a.status.endsWith("_pending")).length;
    return { p, team: team.length, on, pending: pd };
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card !p-3">
          <div className="text-2xl font-black text-emerald-600">{present}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Verified on site</div>
        </div>
        <div className="card !p-3">
          <div className="text-2xl font-black text-orange-500">{pending}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Needs approval</div>
        </div>
        <div className="card !p-3">
          <div className="text-2xl font-black text-rose-600">{absent}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Not marked yet</div>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <h2 className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-bold">
          🗺️ Live site feed — {today}
        </h2>
        {siteRows.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Pehle site add karo → <Link className="underline" href="/admin/projects">Sites</Link></p>
        )}
        {siteRows.map(({ p, team, on, pending: pd }) => (
          <Link href={`/admin/attendance?date=${today}&projectId=${p.id}`} key={p.id} className="block border-b border-slate-100 px-4 py-3 last:border-0 hover:bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{p.name}</div>
                <div className="text-[11px] text-slate-500">team {team} · radius {p.radius_m || company.default_radius_m} m</div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <span className="chip bg-emerald-100 text-emerald-800 border-emerald-200">✓ {on}</span>
                {pd > 0 && <span className="chip bg-orange-100 text-orange-800 border-orange-200">⏳ {pd}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {pendingReqs.length > 0 && (
        <div className="card border-orange-300 bg-orange-50 !p-0">
          <div className="flex items-center justify-between border-b border-orange-200 px-4 py-2.5">
            <h2 className="text-sm font-bold text-orange-900">⏳ {pendingReqs.length} request(s) waiting</h2>
            <Link href="/admin/requests" className="text-xs font-bold text-orange-800 underline">Open queue</Link>
          </div>
          <ul className="divide-y divide-orange-100">
            {pendingReqs.slice(0, 5).map((r) => {
              const emp = workers.find((w) => w.id === r.employee_id);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0 truncate"><b>{emp?.name ?? "?"}</b> — {r.type.replace(/_/g, " ")}: “{r.reason}”</span>
                  <span className="shrink-0 text-[10px] text-orange-600">{r.from_date === r.to_date ? r.from_date.slice(5) : `${r.from_date.slice(5)}→${r.to_date.slice(5)}`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link href="/admin/employees" className="btn-ghost">👥 Team / assign sites</Link>
        <Link href="/admin/reports" className="btn-ghost">💰 Monthly payroll + CSV</Link>
      </div>

      <p className="px-1 text-center text-[11px] text-slate-400">
        Data store: {storageLabel()} · cutoff {company.cutoff_time} · {tz}
      </p>
    </div>
  );
}
