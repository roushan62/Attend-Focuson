import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, update } from "@/lib/db";

export const dynamic = "force-dynamic";

/** PATCH /api/company — admin updates company settings (cutoff, radius, tz). */
export async function PATCH(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role !== "admin") return Response.json({ error: "Sirf company admin settings badal sakta hai." }, { status: 403 });
  const c = await byId("Companies", s.cid);
  if (!c) return Response.json({ error: "Not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  if (b.name) patch.name = String(b.name).trim().slice(0, 80);
  if (/^\d{2}:\d{2}$/.test(String(b.cutoff_time ?? ""))) patch.cutoff_time = String(b.cutoff_time);
  const r = parseInt(String(b.default_radius_m ?? ""), 10);
  if (r >= 10 && r <= 2000) patch.default_radius_m = String(r);
  if (["Asia/Kolkata", "Asia/Dubai", "Asia/Kathmandu", "Asia/Dhaka"].includes(String(b.timezone))) patch.timezone = String(b.timezone);
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to update." }, { status: 400 });
  await update("Companies", c.id, patch);
  return Response.json({ ok: true });
}
