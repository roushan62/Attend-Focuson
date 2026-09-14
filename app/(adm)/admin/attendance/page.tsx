import { requireSession } from "@/lib/auth";
import { companyOf, projectsOf, employeesOf } from "@/lib/domain";
import { list } from "@/lib/db";
import { fmtTimeOf, todayStr } from "@/lib/time";
import { statusMeta } from "@/lib/types";
import AttStatusSelect from "@/components/AttStatusSelect";
import ManualMarkForm from "@/components/ManualMarkForm";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Day-by-day attendance review with GPS distance proof + corrections. */
export default async function AdminAttendance({ searchParams }: {
  searchParams: { date?: string; projectId?: string };
}) {
  const s = await requireSession(["admin", "hr"]);
  const company = await companyOf(s.cid);
  const tz = company.timezone || "Asia/Kolkata";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date || "") ? searchParams.date! : todayStr(tz);
  const projectId = searchParams.projectId || "";

  const [projects, users, attsAll] = await Promise.all([
    projectsOf(s.cid, false), employeesOf(s.cid),
    list("Attendance", (a) => a.company_id === s.cid && a.date === date),
  ]);
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  const atts = attsAll
    .filter((a) => !projectId || a.project_id === projectId)
    .sort((a, b) => (b.check_in_time || "").localeCompare(a.check_in_time || ""));
  const attByEmp = new Map(atts.map((a) => [a.employee_id, a]));

  const shown = projectId ? users.filter((u) => u.current_project_id === projectId) : users;
  const noMark = shown.filter((u) => u.role !== "admin" && !attByEmp.has(u.id));

  const prevDay = (d: string, n: number) => {
    const t = new Date(d + "T00:00:00Z");
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-black">Attendance review</h1>
          <p className="text-sm text-slate-500">Live GPS proofs — {atts.length} record(s) marked today at this filter.</p>
        </div>
        <div className="flex items-center gap-1 text-sm font-bold">
          <Link href={`/admin/attendance?date=${prevDay(date, -1)}&projectId=${projectId}`} className="btn-ghost !px-3 !py-1">‹</Link>
          <form action="/admin/attendance" method="get" className="flex items-center gap-1">
            <input type="date" name="date" defaultValue={date} className="!py-1" />
            {projectId && <input type="hidden" name="projectId" value={projectId} />}
            <button className="btn-ghost !px-2.5 !py-1 text-xs">Go</button>
          </form>
          <Link href={`/admin/attendance?date=${prevDay(date, 1)}&projectId=${projectId}`} className="btn-ghost !px-3 !py-1">›</Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Link href={`/admin/attendance?date=${date}`} className={`chip ${!projectId ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"}`}>All sites</Link>
        {projects.filter((p) => p.status === "active").map((p) => (
          <Link key={p.id} href={`/admin/attendance?date=${date}&projectId=${p.id}`} className={`chip ${projectId === p.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-300"}`}>
            {p.name}
          </Link>
        ))}
      </div>

      {atts.length > 0 && (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Worker</th><th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">In · Out</th><th className="px-3 py-2">Distance</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {atts.map((a) => {
                const emp = users.find((u) => u.id === a.employee_id);
                const dist = parseInt(a.check_in_distance_m || "0", 10);
                const limit = parseInt(projects.find((p) => p.id === a.project_id)?.radius_m || company.default_radius_m || "50", 10);
                return (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 font-bold">{emp?.name ?? "?"}<div className="text-[10px] font-normal text-slate-400">{a.remarks ? `“${a.remarks.slice(0, 60)}”` : ""}</div></td>
                    <td className="max-w-28 truncate px-3 py-2">{projName(a.project_id)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtTimeOf(a.check_in_time, tz)} → {fmtTimeOf(a.check_out_time, tz)}</td>
                    <td className="px-3 py-2">
                      {a.check_in_time ? (
                        <span className={`chip ${dist <= limit ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-rose-100 text-rose-700 border-rose-200"}`}>
                          {a.check_in_distance_m ? `~${dist} m` : "no GPS"} / {limit}
                        </span>
                      ) : <span className="text-slate-400">manual</span>}
                    </td>
                    <td className="px-3 py-2"><AttStatusSelect id={a.id} status={a.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {noMark.length > 0 && (
        <div className="card border-rose-200">
          <h3 className="text-sm font-bold text-rose-700">🚫 No mark yet — {date}</h3>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {noMark.map((u) => (
              <span key={u.id} className="chip bg-rose-50 text-rose-700 border-rose-200">{u.name} <span className="opacity-60">({projName(u.current_project_id)})</span></span>
            ))}
          </p>
        </div>
      )}

      {s.role !== "employee" && (
        <ManualMarkForm
          employees={users.filter((u) => u.role === "employee").map((u) => ({ id: u.id, name: u.name }))}
          projects={projects.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))}
        />
      )}
    </div>
  );
}
