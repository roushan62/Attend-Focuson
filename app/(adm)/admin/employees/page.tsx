import { requireSession } from "@/lib/auth";
import { employeesOf, projectsOf } from "@/lib/domain";
import AdminEmployeeForm from "@/components/AdminEmployeeForm";
import { byId } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Team roster: add workers, assign sites, wages, HR accounts. */
export default async function AdminEmployees({ searchParams }: { searchParams: { edit?: string } }) {
  const s = await requireSession(["admin", "hr"]);
  const [users, projects] = await Promise.all([employeesOf(s.cid, false), projectsOf(s.cid, false)]);
  const initial = searchParams.edit ? await byId("Users", searchParams.edit) : null;
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "— not assigned —";

  const sorted = [...users].sort((a, b) => {
    const rank = (r: string) => (r === "admin" ? 0 : r === "hr" ? 1 : 2);
    return rank(a.role) - rank(b.role) || a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">Team</h1>
        <p className="text-sm text-slate-500">
          Employee = bas phone + password. Worker ko app download karne ko bolo, isi number se
          login karega, aur jahan assign karoge wahan ki attendance default aayegi.
        </p>
      </div>

      {s.role === "admin" && (
        <AdminEmployeeForm
          projects={projects.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }))}
          isAdmin={s.role === "admin"}
          initial={initial && initial.id !== s.uid ? { ...initial, password: "" } : undefined}
        />
      )}

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th><th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Site</th><th className="px-3 py-2">Wage</th>
              <th className="px-3 py-2">Role</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id} className={`border-t border-slate-100 ${u.status === "inactive" ? "opacity-40" : ""}`}>
                <td className="px-3 py-2 font-bold">
                  {u.name}
                  {u.id === s.uid && <span className="ml-1 text-[10px] font-normal text-slate-400">(you)</span>}
                </td>
                <td className="px-3 py-2">{u.phone}</td>
                <td className="max-w-36 truncate px-3 py-2">{projName(u.current_project_id)}</td>
                <td className="px-3 py-2">{u.role === "admin" ? "—" : `₹${u.daily_wage}`}</td>
                <td className="px-3 py-2 capitalize">{u.role}{u.status === "inactive" ? " · off" : ""}</td>
                <td className="px-3 py-2 text-right">
                  {s.role === "admin" && u.role !== "admin" && (
                    <a href={`/admin/employees?edit=${u.id}`} className="font-bold text-slate-700 underline">Edit</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
