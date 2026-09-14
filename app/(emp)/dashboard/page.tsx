import { requireSession } from "@/lib/auth";
import { byId, findOne } from "@/lib/db";
import { companyOf, attendanceFor, employeesOf } from "@/lib/domain";
import { todayStr } from "@/lib/time";
import { statusMeta } from "@/lib/types";
import MarkPanel from "@/components/MarkPanel";
import MapEmbed from "@/components/MapEmbed";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Employee home = CURRENT ASSIGNED PROJECT. Attendance marked here lands on
 * the current project by default. Shows today's status, month totals, site
 * map and the big GPS button.
 */
export default async function Dashboard() {
  const s = await requireSession();
  const [company, me] = await Promise.all([companyOf(s.cid), byId("Users", s.uid)]);
  if (!me) redirect("/login");

  const tz = company.timezone || "Asia/Kolkata";
  const today = todayStr(tz);
  const projectId = me.current_project_id || "";
  const project = projectId ? await byId("Projects", projectId) : null;

  const month = today.slice(0, 7);
  const rows = (await attendanceFor(s.cid, s.uid)).filter((a) => a.date.startsWith(month));
  const counts = { present: 0, late: 0, half: 0, on: 0, pending: 0, absent: 0, leave: 0 };
  for (const r of rows) {
    const m = statusMeta(r.status);
    if (r.status === "present") counts.present++;
    else if (r.status === "late") counts.late++;
    else if (r.status === "half_day") counts.half++;
    else if (r.status === "on_duty") counts.on++;
    else if (r.status.endsWith("_pending")) counts.pending++;
    else if (r.status === "leave") counts.leave++;
    else if (m.pay === 0) counts.absent++;
  }
  const payable = counts.present + counts.late + counts.on + counts.half * 0.5;
  const wage = parseFloat(me.daily_wage || "0") || 0;

  const todaysRec = await findOne("Attendance", (a) => a.employee_id === s.uid && a.date === today);
  const siteStrength = project
    ? (await employeesOf(s.cid)).filter((u) => u.current_project_id === project.id).length
    : 0;

  if (!project) {
    return (
      <div className="card text-center">
        <p className="text-3xl">⏳</p>
        <h2 className="mt-2 font-bold">Abhi aapko kisi site pe assign nahi kiya gaya</h2>
        <p className="mt-1 text-sm text-slate-500">Admin jab project assign karega, yahan uski details aur attendance button dikhne lagenge.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* month summary */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="card !p-3">
          <div className="text-xl font-black text-emerald-600">{payable}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Payable days · {month}</div>
        </div>
        <div className="card !p-3">
          <div className="text-xl font-black">₹{(payable * wage).toLocaleString("en-IN")}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Earnings · ₹{wage}/day</div>
        </div>
        <div className="card !p-3">
          <div className={`text-xl font-black ${counts.pending ? "text-orange-500" : ""}`}>{counts.pending}</div>
          <div className="text-[11px] font-semibold uppercase text-slate-400">Pending approvals</div>
        </div>
      </div>

      {/* current project */}
      <div className="card">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-600">Current assigned site</p>
            <h2 className="text-lg font-black leading-tight">{project.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{project.address || "—"}</p>
          </div>
          <span className="chip bg-slate-100 text-slate-600 border-slate-200">👷 {siteStrength} on site</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 p-2"><b>Geofence:</b> {project.radius_m || company.default_radius_m} m radius</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>Cutoff:</b> {company.cutoff_time} (late = approval req)</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>Project window:</b> {project.start_date || "—"} → {project.end_date || "ongoing"}</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>Coords:</b> {project.latitude}, {project.longitude}</div>
        </div>
      </div>

      <MarkPanel
        projectId={project.id}
        projectName={project.name}
        radius={parseInt(project.radius_m || company.default_radius_m || "50", 10)}
        status={todaysRec?.status ?? null}
        checkedOut={!!todaysRec?.check_out_time}
        cutoff={company.cutoff_time || "11:00"}
      />

      <div className="card">
        <h3 className="mb-2 text-sm font-bold text-slate-700">🗺️ Site location</h3>
        <MapEmbed lat={parseFloat(project.latitude)} lng={parseFloat(project.longitude)} radius={parseInt(project.radius_m || "50", 10)} />
        <a
          className="btn-ghost mt-2 w-full"
          target="_blank" rel="noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${project.latitude},${project.longitude}`}
        >
          🧭 Open in Google Maps (navigate to site)
        </a>
      </div>

      <div className="flex gap-2">
        <Link href="/history" className="btn-ghost flex-1">🗓️ My attendance</Link>
        <Link href="/requests" className="btn-ghost flex-1">📨 Leave / requests</Link>
      </div>
    </div>
  );
}
