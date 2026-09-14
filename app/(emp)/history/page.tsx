import { requireSession } from "@/lib/auth";
import { companyOf, attendanceFor } from "@/lib/domain";
import { fmtTimeOf, monthDates, todayStr } from "@/lib/time";
import { statusMeta } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Month calendar of the employee's own attendance + totals. */
export default async function History({ searchParams }: { searchParams: { month?: string } }) {
  const s = await requireSession();
  const company = await companyOf(s.cid);
  const tz = company.timezone || "Asia/Kolkata";
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "") ? searchParams.month! : todayStr(tz).slice(0, 7);
  const today = todayStr(tz);

  const rows = (await attendanceFor(s.cid, s.uid)).filter((a) => a.date.startsWith(month));
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const days = monthDates(month);

  const prev = month.slice(0, 4) + "-" + String(Math.max(1, +month.slice(5, 7) - 1)).padStart(2, "0");
  const next = month.slice(0, 4) + "-" + String(Math.min(12, +month.slice(5, 7) + 1)).padStart(2, "0");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black">My attendance</h1>
        <div className="flex items-center gap-1 text-sm font-bold">
          <Link href={`/history?month=${prev}`} className="btn-ghost !px-3 !py-1">‹</Link>
          <span className="px-1">{new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
          <Link href={`/history?month=${next}`} className="btn-ghost !px-3 !py-1">›</Link>
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase text-slate-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {(() => {
            const lead = new Date(days[0] + "T00:00:00Z").getUTCDay();
            return Array.from({ length: lead }).map((_, i) => <div key={"e" + i} />);
          })()}
          {days.map((d) => {
            const rec = byDate.get(d);
            const st = rec?.status || (d === today ? "" : "absent");
            const m = st ? statusMeta(st) : null;
            const isToday = d === today;
            return (
              <div
                key={d}
                title={rec ? `${m?.label} · in ${fmtTimeOf(rec.check_in_time, tz)}` : "—"}
                className={`relative aspect-square rounded-lg border text-center ${
                  m ? m.cls : "border-slate-200 bg-white text-slate-400"
                } ${isToday ? "ring-2 ring-slate-900" : ""}`}
              >
                <div className="pt-1 text-xs font-bold">{d.slice(8)}</div>
                {m && <div className="text-[9px] font-black leading-tight">{m.short}</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {(["present", "late", "half_day", "on_duty", "leave", "absent", "late_pending", "outside_pending", "visit_pending"] as const).map((k) => (
            <span key={k} className={`chip ${statusMeta(k).cls}`}>{statusMeta(k).short} = {statusMeta(k).label}</span>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">In</th><th className="px-3 py-2">Out</th>
              <th className="px-3 py-2">Dist (in)</th><th className="px-3 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold">{r.date}</td>
                <td className="px-3 py-2"><span className={`chip ${statusMeta(r.status).cls}`}>{statusMeta(r.status).label}</span></td>
                <td className="px-3 py-2">{fmtTimeOf(r.check_in_time, tz)}</td>
                <td className="px-3 py-2">{fmtTimeOf(r.check_out_time, tz)}</td>
                <td className="px-3 py-2">{r.check_in_distance_m ? `~${r.check_in_distance_m} m` : "—"}</td>
                <td className="max-w-40 truncate px-3 py-2 text-slate-500">{r.remarks || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Is mahine koi record nahi.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
