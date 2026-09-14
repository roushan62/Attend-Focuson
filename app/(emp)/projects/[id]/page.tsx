import { requireSession } from "@/lib/auth";
import { byId, findOne } from "@/lib/db";
import { companyOf } from "@/lib/domain";
import { statusMeta } from "@/lib/types";
import { todayStr } from "@/lib/time";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import MapEmbed from "@/components/MapEmbed";
import MarkPanel from "@/components/MarkPanel";

export const dynamic = "force-dynamic";

/**
 * A site's page for an employee. If it's their current assignment, marking
 * here behaves exactly like the dashboard. For any OTHER active site, marking
 * opens a site-visit request → paid on_duty after approval.
 */
export default async function SitePage({ params }: { params: { id: string } }) {
  const s = await requireSession();
  const project = await byId("Projects", params.id);
  if (!project || project.company_id !== s.cid) notFound();
  const [company, me] = await Promise.all([companyOf(s.cid), byId("Users", s.uid)]);
  if (!me) redirect("/login");

  const isCurrent = me.current_project_id === project.id;
  const tz = company.timezone || "Asia/Kolkata";
  const today = todayStr(tz);
  const rec = await findOne("Attendance", (a) => a.company_id === s.cid && a.employee_id === s.uid && a.date === today);
  // already marked today at ANOTHER site? then this page is read-only for marking.
  const markedElsewhere = rec && !isCurrent && rec.project_id !== project.id ? rec : null;
  const markedProject = markedElsewhere ? await byId("Projects", markedElsewhere.project_id) : null;
  const showStatus = rec && !markedElsewhere ? rec : null;

  return (
    <div className="space-y-4">
      <Link href="/projects" className="text-xs font-bold text-slate-500">← All sites</Link>
      <div className="card">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-black">{project.name}</h1>
          {isCurrent ? (
            <span className="chip bg-amber-100 text-amber-800 border-amber-200">CURRENT</span>
          ) : (
            <span className="chip bg-indigo-100 text-indigo-700 border-indigo-200">VISIT / OTHER SITE</span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">📍 {project.address || "—"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 p-2"><b>Coordinates:</b> {project.latitude}, {project.longitude}</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>Allowed radius:</b> {project.radius_m || company.default_radius_m} m</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>Start:</b> {project.start_date || "—"}</div>
          <div className="rounded-lg bg-slate-50 p-2"><b>End:</b> {project.end_date || "ongoing"}</div>
        </div>
      </div>

      {!isCurrent && (
        <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
          Ye aapka assigned site nahi hai. Yahan attendance <b>“site visit”</b> request banayegi —
          reason likho, admin approve kare to ye din <b>paid On-Duty</b> count hoga.
        </p>
      )}

      {project.status === "inactive" ? (
        <div className="card text-center text-sm text-slate-500">Is site pe attendance band hai (project closed).</div>
      ) : markedElsewhere ? (
        <div className="card border-slate-300 bg-slate-50 text-center text-sm text-slate-600">
          ✓ Aaj ki attendance <b>{markedProject?.name ?? "doosri site"}</b> pe lag chuki hai
          (“{statusMeta(markedElsewhere.status).label}”). Ek din me ek hi entry hoti hai —
          agar change karni hai to admin se baat karo.
        </div>
      ) : (
        <MarkPanel
          projectId={project.id}
          projectName={project.name}
          radius={parseInt(project.radius_m || company.default_radius_m || "50", 10)}
          status={showStatus?.status ?? null}
          checkedOut={!!showStatus?.check_out_time && (isCurrent || showStatus?.project_id === project.id)}
          cutoff={company.cutoff_time || "11:00"}
        />
      )}

      <div className="card">
        <h3 className="mb-2 text-sm font-bold text-slate-700">🗺️ Location</h3>
        <MapEmbed lat={parseFloat(project.latitude)} lng={parseFloat(project.longitude)} radius={parseInt(project.radius_m || "50", 10)} />
      </div>
    </div>
  );
}
