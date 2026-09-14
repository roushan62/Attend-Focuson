import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, insert, list, update } from "@/lib/db";
import { newId } from "@/lib/ids";
import { eachDate } from "@/lib/time";
import { FINAL_ON_APPROVE } from "@/lib/attendance";
import type { Row } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/requests/[id] { action: "approve" | "reject", note? }
 *
 * Approve:
 *   • linked attendance (late/out-of-radius/site-visit auto-requests) gets its
 *     final status — late → paid "late", visit/outside → paid "on_duty".
 *   • manual leave/half_day/on_duty requests WRITE attendance rows for every
 *     date in the range (so travel days become paid even with no GPS mark).
 *     An already auto-marked full day is never downgraded by an approval.
 * Reject:
 *   • linked attendance → absent; manual requests just close.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });

  const r = await byId("Requests", params.id);
  if (!r || r.company_id !== s.cid) return Response.json({ error: "Not found." }, { status: 404 });
  if (r.status !== "pending") return Response.json({ error: `Request already ${r.status}.` }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action);
  if (action !== "approve" && action !== "reject") return Response.json({ error: "action must be approve|reject" }, { status: 400 });
  const note = String(body.note ?? "").slice(0, 300);

  const meta = {
    status: action === "approve" ? "approved" : "rejected",
    review_note: note, reviewed_by: s.uid, reviewed_at: new Date().toISOString(),
  };

  if (action === "approve") {
    if (r.attendance_id) {
      const att = await byId("Attendance", r.attendance_id);
      if (att) {
        await update("Attendance", att.id, {
          status: FINAL_ON_APPROVE[r.type] ?? "on_duty",
          approved_by: s.uid,
          remarks: att.remarks || note || `Approved: ${r.reason}`,
        });
      }
    } else {
      const employee = await byId("Users", r.employee_id);
      const project: Row | null = r.project_id ? await byId("Projects", r.project_id) : null;
      if (employee) {
        const existing = await list("Attendance", (a) => a.company_id === s.cid && a.employee_id === r.employee_id);
        const byDate = new Map(existing.map((a) => [a.date, a]));
        const final = FINAL_ON_APPROVE[r.type] ?? r.type;
        for (const date of eachDate(r.from_date, r.to_date)) {
          const old = byDate.get(date);
          if (old) {
            const oldPaid = ["present", "late", "on_duty", "half_day"].includes(old.status);
            const oldPending = old.status.endsWith("_pending");
            if (oldPaid && r.type !== "half_day") continue; // never downgrade a marked full day
            await update("Attendance", old.id, {
              status: final,
              approved_by: s.uid,
              remarks: old.remarks || note || r.reason,
              project_id: old.project_id || project?.id || employee.current_project_id || "",
            });
          } else {
            await insert("Attendance", {
              id: newId("att"), company_id: s.cid, employee_id: r.employee_id,
              project_id: project?.id || employee.current_project_id || "",
              date,
              check_in_time: "", check_in_lat: "", check_in_lng: "", check_in_distance_m: "",
              check_out_time: "", check_out_lat: "", check_out_lng: "", check_out_distance_m: "",
              status: final, remarks: note || r.reason, approved_by: s.uid,
            });
          }
        }
      }
    }
  } else if (r.attendance_id) {
    const att = await byId("Attendance", r.attendance_id);
    if (att && att.status.endsWith("_pending")) {
      await update("Attendance", att.id, { status: "absent", approved_by: s.uid, remarks: att.remarks || `Rejected: ${note || r.reason}` });
    }
  }

  await update("Requests", r.id, meta);
  return Response.json({ ok: true });
}
