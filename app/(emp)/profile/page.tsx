import { requireSession } from "@/lib/auth";
import { byId } from "@/lib/db";
import { companyOf } from "@/lib/domain";
import PasswordForm from "@/components/PasswordForm";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Self-service profile: who I am, which site, wage, password change. */
export default async function Profile() {
  const s = await requireSession();
  const [me, company] = await Promise.all([byId("Users", s.uid), companyOf(s.cid)]);
  if (!me) redirect("/login");
  const project = me.current_project_id ? await byId("Projects", me.current_project_id) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-black">Profile</h1>

      <div className="card">
        <div className="flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-slate-900 text-xl font-black text-amber-300">
            {me.name.slice(0, 1)}
          </div>
          <div>
            <div className="text-lg font-bold">{me.name}</div>
            <div className="text-xs capitalize text-slate-500">{me.role} · +91 {me.phone}</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Company</div><b>{company.name}</b></div>
          <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Daily wage</div><b>₹{me.daily_wage || 0}</b></div>
          <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Current site</div><b>{project?.name ?? "Not assigned"}</b></div>
          <div className="rounded-lg bg-slate-50 p-2"><div className="text-slate-400">Status</div><b className="capitalize">{me.status}</b></div>
        </div>
      </div>

      <div className="card text-sm">
        <h3 className="mb-1 font-bold text-slate-700">📲 Install on phone</h3>
        <p className="text-xs text-slate-500">
          Browser menu (⋮) → “Add to Home screen / Install app”. Ye web-app full-screen
          chalti hai aur attendance ke liye location permission zaroori hai.
        </p>
      </div>

      <PasswordForm />
    </div>
  );
}
