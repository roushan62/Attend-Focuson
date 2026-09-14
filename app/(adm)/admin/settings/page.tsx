import { requireSession } from "@/lib/auth";
import { companyOf } from "@/lib/domain";
import SettingsForm from "@/components/SettingsForm";
import { driverName } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Company-wide rules + live backend info. */
export default async function AdminSettings() {
  const s = await requireSession(["admin"]);
  const c = await companyOf(s.cid);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black">Settings</h1>
        <p className="text-sm text-slate-500">Rules poori company pe lagte hain; site ka apna radius unhe override karta hai.</p>
      </div>
      <SettingsForm
        initial={{
          name: c.name, cutoff_time: c.cutoff_time || "11:00",
          default_radius_m: c.default_radius_m || "50", timezone: c.timezone || "Asia/Kolkata",
        }}
      />
      <div className="card text-xs text-slate-600">
        <h3 className="mb-1 text-sm font-bold">🔌 Backend</h3>
        <p>
          Storage driver: <b>{driverName() === "sheets" ? "Google Sheets (production)" : "Local demo DB"}</b>
          {driverName() === "sheets" && <> · Sheet ID <code className="rounded bg-slate-100 px-1">{process.env.GOOGLE_SHEET_ID?.slice(0, 24)}…</code></>}
        </p>
        <p className="mt-1 text-slate-400">
          Google Sheets connect karne ke liye repo ka SETUP.md follow karo (5 steps, ~10 min, free).
        </p>
      </div>
    </div>
  );
}
