import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, update } from "@/lib/db";
import type { AttStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: AttStatus[] = [
  "present", "late", "half_day", "on_duty", "leave", "absent",
];

/** PATCH /api/attendance/[id] { status, remarks? } — admin/HR correction. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const rec = await byId("Attendance", params.id);
  if (!rec || rec.company_id !== s.cid) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const status = String(body.status) as AttStatus;
  if (!ALLOWED.includes(status)) return Response.json({ error: "Invalid status." }, { status: 400 });
  const patch: Record<string, string> = { status, approved_by: s.uid };
  if (body.remarks !== undefined) patch.remarks = String(body.remarks).slice(0, 400);
  await update("Attendance", rec.id, patch);
  return Response.json({ ok: true });
}
