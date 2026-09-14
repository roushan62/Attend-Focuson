import { requireSession } from "@/lib/auth";
import { companyOf, projectsOf, employeesOf } from "@/lib/domain";
import AdminProjectForm from "@/components/AdminProjectForm";
import MapEmbed from "@/components/MapEmbed";
import { byId } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminProjects({ searchParams }: { searchParams: { edit?: string } }) {
  const s = await requireSession(["admin", "hr"]);
  const [company, projects, users] = await Promise.all([
    companyOf(s.cid), projectsOf(s.cid, false), employeesOf(s.cid),
  ]);
  const initial = searchParams.edit ? await byId("Projects", searchParams.edit) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">Sites / Projects</h1>
        <p className="text-sm text-slate-500">
          Har site ka centre (GPS) + radius set karo — attendance sirf isi geofence ke andar
          auto-verify hogi. Site pe khade hokar “Use my location” dabana sabse accurate hai.
        </p>
      </div>

      {s.role === "admin" && (
        <AdminProjectForm initial={initial ?? undefined} />
      )}
      {s.role !== "admin" && (
        <p className="card text-sm text-slate-500">Sites sirf company admin add/edit kar sakta hai.</p>
      )}

      {projects.map((p) => {
        const team = users.filter((u) => u.current_project_id === p.id && u.role !== "admin");
        return (
          <div key={p.id} className="card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-black">{p.name}</h2>
                  <span className={`chip ${p.status === "active" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                    {p.status}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{p.address || "—"}</p>
              </div>
              {s.role === "admin" && (
                <a href={`/admin/projects?edit=${p.id}`} className="btn-ghost !px-2.5 !py-1 text-xs shrink-0">✏️ Edit</a>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Centre</div><b>{p.latitude}, {p.longitude}</b></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Radius</div><b>{p.radius_m || company.default_radius_m} m</b></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Window</div><b>{p.start_date || "—"} → {p.end_date || "ongoing"}</b></div>
              <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Assigned</div><b>{team.length} worker(s)</b></div>
            </div>
            {team.length > 0 && (
              <p className="mt-2 truncate text-[11px] text-slate-500">👷 {team.map((t) => t.name).join(", ")}</p>
            )}
            {isFinite(parseFloat(p.latitude)) && (
              <div className="mt-3"><MapEmbed lat={parseFloat(p.latitude)} lng={parseFloat(p.longitude)} radius={parseInt(p.radius_m || "50", 10)} height={160} /></div>
            )}
          </div>
        );
      })}
    </div>
  );
}
