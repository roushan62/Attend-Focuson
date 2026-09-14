import { requireSession } from "@/lib/auth";
import { buildMonthReport } from "@/lib/domain";
import { currentMonthStr, todayStr } from "@/lib/time";
import { statusMeta } from "@/lib/types";
import Link from "next/link";

export const dynamic = "force-dynamic";

const LEGEND = ["present", "late", "half_day", "on_duty", "leave", "absent", "late_pending", "outside_pending", "visit_pending"] as const;

/**
 * Monthly payroll matrix — the reason this whole app exists.
 * P/L = full paid, H = half, O = on-duty/travel paid, A/V = unpaid,
 * pending cells = waiting for an approval. Amount = payable days × daily wage.
 */
export default async function Reports({ searchParams }: { searchParams: { month?: string } }) {
  const s = await requireSession(["admin", "hr"]);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "") ? searchParams.month! : currentMonthStr();
  const { days, rows } = await buildMonthReport(s.cid, month);

  const totalPaid = rows.reduce((a, r) => a + r.payable, 0);
  const totalAmt = rows.reduce((a, r) => a + r.amount, 0);

  const d = new Date(month + "-01T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  const d2 = new Date(month + "-01T00:00:00Z");
  d2.setUTCMonth(d2.getUTCMonth() + 1);
  const next = d2.toISOString().slice(0, 7);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-black">Payroll report</h1>
          <p className="text-sm text-slate-500">
            {new Date(month + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}
            {" · "}total payable {totalPaid} day(s) · ₹{totalAmt.toLocaleString("en-IN")}
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`/admin/reports?month=${prev}`} className="btn-ghost !px-3 !py-1">‹</Link>
          <form action="/admin/reports" method="get">
            <input type="month" name="month" defaultValue={month} className="!py-1" />
          </form>
          <Link href={`/admin/reports?month=${next}`} className="btn-ghost !px-3 !py-1">›</Link>
          <a href={`/api/reports/csv?month=${month}`} className="btn-success !py-1.5 text-xs">⬇ CSV</a>
        </div>
      </div>

      <div className="card overflow-x-auto !p-0">
        <table className="w-full border-collapse text-center text-[10px]">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="sticky left-0 z-10 min-w-32 bg-slate-50 px-2 py-1.5 text-left">Worker</th>
              {days.map((dd) => <th key={dd} className="px-1 py-1.5 font-semibold">{dd.slice(8)}</th>)}
              <th className="px-2 py-1.5 text-right">Days</th>
              <th className="px-2 py-1.5 text-right">₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employee.id} className="border-t border-slate-100">
                <td className="sticky left-0 z-10 min-w-32 bg-white px-2 py-1 text-left font-bold">
                  {r.employee.name}
                  <span className="block text-[9px] font-normal text-slate-400">₹{r.wage}/d · {r.project?.name?.slice(0, 18) ?? "—"}</span>
                </td>
                {r.cells.map((c) => {
                  const m = c.status ? statusMeta(c.status) : null;
                  const future = c.date > todayStr("Asia/Kolkata");
                  return (
                    <td key={c.date} title={`${c.date}${c.status ? ` · ${m!.label}` : ""}${c.distanceIn ? ` · ~${c.distanceIn}m` : ""}`}
                        className={`px-1 py-1 font-black ${m ? m.cls.split(" ").slice(0, 2).join(" ") : ""} ${future ? "text-slate-200" : c.status ? "" : "text-slate-300"}`}>
                      {m ? m.short : future ? "" : "·"}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right font-black">{r.payable}</td>
                <td className="px-2 py-1 text-right font-black">₹{r.amount.toLocaleString("en-IN")}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={days.length + 3} className="px-3 py-8 text-sm text-slate-400">No workers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {LEGEND.map((k) => (
          <span key={k} className={`chip ${statusMeta(k).cls}`}>{statusMeta(k).short} = {statusMeta(k).label} {statusMeta(k).pay ? `(${statusMeta(k).pay * 100}%)` : "(unpaid)"}</span>
        ))}
      </div>
      <p className="px-1 text-[11px] text-slate-400">
        Tip: CSV Excel me seedha khulta hai — salary sheet me copy/paste kar do. Ye report
        Google Sheet ke “Attendance” tab ka hi mirror hai, dono match karte rahenge.
      </p>
    </div>
  );
}
