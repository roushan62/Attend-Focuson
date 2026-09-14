import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, insert } from "@/lib/db";
import { newId } from "@/lib/ids";
import type { ReqType } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPES: ReqType[] = ["leave", "half_day", "on_duty", "late", "out_of_radius", "site_visit"];

/**
 * POST /api/requests { type, reason, from_date, to_date?, project_id? }
 * Employee files leave / half-day / travel(on-duty) / approval requests.
 * Auto-registered requests (from geofence rejects) already exist — this is
 * the manual "main bahar duty pe tha, special present chahiye" flow.
 */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s) return Response.json({ error: "Login required." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const type = String(body.type) as ReqType;
  const reason = String(body.reason ?? "").trim();
  const fromDate = String(body.from_date ?? "");
  const toDate = String(body.to_date ?? fromDate);
  if (!TYPES.includes(type)) return Response.json({ error: "Invalid request type." }, { status: 400 });
  if (reason.length < 3) return Response.json({ error: "Reason zaroori hai — kam se kam 3 characters." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return Response.json({ error: "Invalid date." }, { status: 400 });
  if (toDate < fromDate) return Response.json({ error: "To-date, from-date se pehle ho gayi?" }, { status: 400 });

  const employeeId = body.employeeId && s.role !== "employee" ? String(body.employeeId) : s.uid;
  const emp = await byId("Users", employeeId);
  if (!emp || emp.company_id !== s.cid) return Response.json({ error: "Employee not found." }, { status: 404 });
  if (type === "late" || type === "out_of_radius" || type === "site_visit") {
    return Response.json({ error: "Ye request attendance mark karte hi automatically ban jaati hai — sirf leave / half-day / on-duty yahin se bhejo." }, { status: 400 });
  }

  const row = await insert("Requests", {
    id: newId("req"), company_id: s.cid, employee_id: employeeId,
    type, reason: reason.slice(0, 400),
    from_date: fromDate, to_date: toDate || fromDate,
    project_id: String(body.project_id ?? emp.current_project_id ?? ""),
    attendance_id: "", status: "pending", review_note: "", reviewed_by: "", reviewed_at: "",
    created_at: new Date().toISOString(),
  });
  return Response.json({ ok: true, request: row });
}
