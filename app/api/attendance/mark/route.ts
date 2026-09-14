import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, insert, list, update } from "@/lib/db";
import { newId } from "@/lib/ids";
import { getDistanceInMeters } from "@/lib/distance";
import { todayStr } from "@/lib/time";
import { companyCutoffPassed } from "@/lib/domain";
import { decideMarkStatus } from "@/lib/attendance";
import type { Row } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/attendance/mark  { projectId?, action: "in" | "out", lat, lng, remarks? }
 *
 * The employee (or admin/HR marking for someone, or a site supervisor using
 * the company login on-site) sends live GPS coordinates. We recompute the
 * distance SERVER-SIDE against the project's geofence — client can't fake the
 * maths — then apply the rules from lib/attendance.ts. A pending situation
 * automatically opens a Request so it lands in the admin approval queue.
 */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s) return Response.json({ error: "Login required." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body.action === "out" ? "out" : "in";
  const lat = parseFloat(body.lat), lng = parseFloat(body.lng);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
    return Response.json({ error: "GPS location nahi mila — phone ka location ON karke permission do aur phir try karo." }, { status: 400 });
  }
  const remarks = String(body.remarks ?? "").slice(0, 400);
  const now = new Date();

  const [company, user] = await Promise.all([byId("Companies", s.cid), byId("Users", s.uid)]);
  if (!company || !user) return Response.json({ error: "Session invalid — dobara login karo." }, { status: 401 });
  const tz = company.timezone || "Asia/Kolkata";
  const today = todayStr(tz);

  // Admin/HR may mark for any employee of their company.
  const employeeId = body.employeeId && s.role !== "employee" ? String(body.employeeId) : s.uid;
  const employee = employeeId === s.uid ? user : await byId("Users", employeeId);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });
  if (employee.company_id !== s.cid) return Response.json({ error: "Not allowed." }, { status: 403 });
  const manual = s.role !== "employee";

  // Target project: requested one, else the employee's assigned project.
  const requested = body.projectId ? await byId("Projects", String(body.projectId)) : null;
  const project: Row | null = requested ?? (employee.current_project_id ? await byId("Projects", employee.current_project_id) : null);
  if (!project || project.company_id !== s.cid) {
    return Response.json({ error: "Aapko kisi project/site pe assign nahi kiya gaya hai — admin se contact karo." }, { status: 400 });
  }

  const pLat = parseFloat(project.latitude), pLng = parseFloat(project.longitude);
  if (!isFinite(pLat) || !isFinite(pLng)) {
    return Response.json({ error: "Is site ke coordinates set nahi hain — admin pehle site ka location set kare." }, { status: 400 });
  }
  const radius = parseFloat(project.radius_m || company.default_radius_m || "50") || 50;
  const distance = Math.round(getDistanceInMeters(pLat, pLng, lat, lng));
  const withinRadius = distance <= radius;

  const existing = await list(
    "Attendance",
    (a) => a.company_id === s.cid && a.employee_id === employeeId && a.date === today
  );
  const rec = existing[0] ?? null;
  const isAssigned = project.id === employee.current_project_id;

  /* ------------------------------ CHECK OUT ------------------------------ */
  if (action === "out") {
    if (!rec) return Response.json({ error: "Pehle check-IN karo." }, { status: 400 });
    if (rec.check_out_time) return Response.json({ error: "Aaj ka check-out already ho chuka hai." }, { status: 409 });
    await update("Attendance", rec.id, {
      check_out_time: now.toISOString(),
      check_out_lat: String(lat), check_out_lng: String(lng),
      check_out_distance_m: String(distance),
    });
    return Response.json({ ok: true, action: "out", distance, message: "Check-out ho gaya. Achhe kaam ke liye dhanyavaad 🙏" });
  }

  /* ------------------------------- CHECK IN ------------------------------ */
  const cutoffPassed = companyCutoffPassed(company);
  const hasPending = rec && rec.status.endsWith("_pending");
  if (rec && !hasPending) {
    return Response.json({
      error: `Aaj attendance already marked hai (${rec.status}). Dobara mark karne ke liye admin se baat karo.`,
      status: rec.status,
    }, { status: 409 });
  }

  const decision = decideMarkStatus({
    distance, withinRadius, cutoffPassed, isAssignedProject: isAssigned, manual,
  });

  const base = {
    project_id: project.id,
    date: today,
    check_in_time: now.toISOString(),
    check_in_lat: String(lat), check_in_lng: String(lng),
    check_in_distance_m: String(distance),
    status: decision.status,
    remarks,
    approved_by: manual ? s.uid : "",
  };

  if (rec && hasPending) {
    // Re-marking while pending: refresh the record (they may have moved on-site).
    await update("Attendance", rec.id, base);
    // update any auto-created request's reason too
    const linked = await list("Requests", (r) => r.attendance_id === rec.id && r.status === "pending");
    if (!decision.status.endsWith("_pending")) {
      // worker corrected themselves into policy (walked on-site / before cutoff next day) —
      // close the stale pending requests so the admin queue stays clean.
      for (const r of linked) {
        await update("Requests", r.id, {
          status: "approved", review_note: "Auto-resolved: worker re-marked validly", reviewed_by: s.uid,
          reviewed_at: new Date().toISOString(),
        });
      }
    } else {
      for (const r of linked) await update("Requests", r.id, { reason: remarks || r.reason });
    }
  } else {
    await insert("Attendance", { id: newId("att"), company_id: s.cid, employee_id: employeeId, ...base });
  }

  // Pending statuses auto-open a request for the admin queue (unless one exists).
  let requestCreated = false;
  if (decision.needRequest) {
    const att = await list(
      "Attendance",
      (a) => a.company_id === s.cid && a.employee_id === employeeId && a.date === today
    );
    const attRec = att[0];
    const already = attRec && (await list("Requests", (r) => r.attendance_id === attRec.id));
    if (!already || already.length === 0) {
      await insert("Requests", {
        id: newId("req"), company_id: s.cid, employee_id: employeeId,
        type: decision.needRequest,
        reason: remarks || (decision.needRequest === "late" ? `Checked in at ${fmtHM(now, tz)} — after cutoff` : "Site visit / duty"),
        from_date: today, to_date: today, project_id: project.id,
        attendance_id: attRec?.id ?? "", status: "pending", review_note: "",
        reviewed_by: "", reviewed_at: "", created_at: now.toISOString(),
      });
      requestCreated = true;
    }
  }

  return Response.json({
    ok: true, action: "in",
    status: decision.status, distance, radius,
    projectName: project.name,
    needRequest: decision.needRequest, requestCreated,
    message: decision.message,
  });
}

function fmtHM(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true }).format(d).replace("\u202f", " ");
}
