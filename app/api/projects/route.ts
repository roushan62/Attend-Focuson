import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { byId, insert, update } from "@/lib/db";
import { newId } from "@/lib/ids";

export const dynamic = "force-dynamic";

function num(v: unknown): string {
  const n = parseFloat(String(v));
  return isFinite(n) ? String(n) : "";
}

/** POST /api/projects — create a site with geofence (lat, lng, radius). */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const lat = num(b.latitude), lng = num(b.longitude);
  if (!name) return Response.json({ error: "Project name required." }, { status: 400 });
  if (!lat || !lng) return Response.json({ error: "Latitude/longitude required — site pe khade hoke 'Use my location' dabao." }, { status: 400 });
  const row = await insert("Projects", {
    id: newId("prj"), company_id: s.cid, name: name.slice(0, 80),
    address: String(b.address ?? "").slice(0, 200),
    latitude: lat, longitude: lng,
    radius_m: num(b.radius_m) || "50",
    start_date: String(b.start_date ?? ""), end_date: String(b.end_date ?? ""),
    status: "active",
  });
  return Response.json({ ok: true, project: row });
}

/** PATCH /api/projects?id=xx — update site details / geofence / status. */
export async function PATCH(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const p = await byId("Projects", id);
  if (!p || p.company_id !== s.cid) return Response.json({ error: "Not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  if (b.name) patch.name = String(b.name).trim().slice(0, 80);
  if (b.address !== undefined) patch.address = String(b.address).slice(0, 200);
  if (b.latitude !== undefined && num(b.latitude)) patch.latitude = num(b.latitude);
  if (b.longitude !== undefined && num(b.longitude)) patch.longitude = num(b.longitude);
  if (b.radius_m !== undefined && num(b.radius_m)) patch.radius_m = num(b.radius_m);
  if (b.start_date !== undefined) patch.start_date = String(b.start_date ?? "");
  if (b.end_date !== undefined) patch.end_date = String(b.end_date ?? "");
  if (b.status === "active" || b.status === "inactive") patch.status = b.status;
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to update." }, { status: 400 });
  await update("Projects", p.id, patch);
  return Response.json({ ok: true });
}
