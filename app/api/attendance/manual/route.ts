import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { findOne, insert } from "@/lib/db";
import { newId } from "@/lib/ids";

export const dynamic = "force-dynamic";

/** POST /api/attendance/manual — admin/HR writes a PRESENT record directly
 *  (with remark). Use for register-loss / special cases; GPS-free by intent. */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const employeeId = String(b.employeeId ?? "");
  const date = String(b.date ?? "");
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "employeeId and date (YYYY-MM-DD) required." }, { status: 400 });
  }
  const existing = await findOne("Attendance", (a) => a.company_id === s.cid && a.employee_id === employeeId && a.date === date);
  const patch = {
    status: "present",
    approved_by: s.uid,
    remarks: String(b.remarks ?? "Manual entry by admin/HR").slice(0, 400),
  };
  if (existing) {
    const { update } = await import("@/lib/db");
    await update("Attendance", existing.id, patch);
    return Response.json({ ok: true, updated: true });
  }
  await insert("Attendance", {
    id: newId("att"), company_id: s.cid, employee_id: employeeId,
    project_id: String(b.projectId ?? ""),
    date,
    check_in_time: "", check_in_lat: "", check_in_lng: "", check_in_distance_m: "",
    check_out_time: "", check_out_lat: "", check_out_lng: "", check_out_distance_m: "",
    ...patch,
  });
  return Response.json({ ok: true, created: true });
}
