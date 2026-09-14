import { NextRequest } from "next/server";
import { apiSession } from "@/lib/auth";
import { buildMonthReport } from "@/lib/domain";
import { statusMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/reports/csv?month=YYYY-MM — payroll/attendance matrix export. */
export async function GET(req: NextRequest) {
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const month = req.nextUrl.searchParams.get("month") || new Date().toISOString().slice(0, 7);

  const { days, rows } = await buildMonthReport(s.cid, month);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push([
    "Employee", "Phone", "Site", "Daily wage",
    ...days.map((d) => d.slice(8)),
    "Present", "Late", "Half", "OnDuty", "Leave", "Absent", "Pending",
    "Payable days", "Amount",
  ].map(esc).join(","));
  for (const r of rows) {
    lines.push([
      r.employee.name, r.employee.phone, r.project?.name ?? "", r.wage,
      ...r.cells.map((c) => (c.status ? statusMeta(c.status).short : "")),
      r.present, r.late, r.half, r.onDuty, r.leave, r.absent, r.pending,
      r.payable, r.amount,
    ].map(esc).join(","));
  }
  const csv = "\uFEFF" + lines.join("\r\n"); // BOM for Excel
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="attendance-${month}.csv"`,
    },
  });
}
