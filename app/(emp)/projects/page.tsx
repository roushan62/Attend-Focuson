import { requireSession } from "@/lib/auth";
import { byId } from "@/lib/db";
import { companyOf, projectsOf } from "@/lib/domain";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** All company projects are visible; the assigned one is pinned on top. */
export default async function SitesPage() {
  const s = await requireSession();
  const [company, me, projects] = await Promise.all([
    companyOf(s.cid), byId("Users", s.uid), projectsOf(s.cid),
  ]);
  const currentId = me?.current_project_id || "";

  const sorted = [...projects].sort((a, b) => (a.id === currentId ? -1 : b.id === currentId ? 1 : a.name.localeCompare(b.name)));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-black">All sites</h1>
        <p className="text-sm text-slate-500">
          Assignment ke saare projects yahan dikhte hain. Dusre site pe visit/Duty pe ho?
          wahan jaake us site ka button dabao — reason maanga jayega, admin approve karega.
        </p>
      </div>
      {sorted.map((p) => {
        const isCurrent = p.id === currentId;
        return (
          <Link key={p.id} href={`/projects/${p.id}`} className="card block hover:border-slate-400">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-bold">{p.name}</h2>
                  {isCurrent && <span className="chip bg-amber-100 text-amber-800 border-amber-200">CURRENT</span>}
                  {p.status === "inactive" && <span className="chip bg-slate-100 text-slate-500 border-slate-200">closed</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">📍 {p.address || `${p.latitude}, ${p.longitude}`}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Geofence {p.radius_m || company.default_radius_m} m · {p.start_date || "—"} → {p.end_date || "ongoing"}
                </p>
              </div>
              <span className="text-slate-400">›</span>
            </div>
          </Link>
        );
      })}
      {sorted.length === 0 && (
        <div className="card text-center text-sm text-slate-500">Abhi koi project nahi — admin sites add karega to yahan dikhega.</div>
      )}
    </div>
  );
}
