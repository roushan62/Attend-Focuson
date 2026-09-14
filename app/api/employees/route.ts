import { NextRequest } from "next/server";
import { apiSession, hashPassword, isWriteRequest, normalizePhone } from "@/lib/auth";
import { byId, findOne, insert, update } from "@/lib/db";
import { newId } from "@/lib/ids";

export const dynamic = "force-dynamic";

/**
 * POST /api/employees — admin/HR adds a worker (name, phone, password,
 * role, wage, assigned project). The employee then just installs the app
 * and logs in with that phone + password.
 */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  const phone = normalizePhone(String(b.phone ?? ""));
  const role = ["hr", "employee"].includes(b.role) ? b.role : "employee";
  const password = String(b.password ?? "");
  if (!name || !/^\d{10}$/.test(phone)) return Response.json({ error: "Name and a valid 10-digit phone required." }, { status: 400 });
  if (role !== "employee" && s.role !== "admin") return Response.json({ error: "Sirf admin HR user bana sakta hai." }, { status: 403 });
  if (password.length < 6) return Response.json({ error: "Password at least 6 characters." }, { status: 400 });
  if (await findOne("Users", (u) => u.phone === phone)) {
    return Response.json({ error: "Ye phone number kisi aur account me already hai." }, { status: 409 });
  }
  const proj = b.current_project_id ? await byId("Projects", String(b.current_project_id)) : null;
  const row = await insert("Users", {
    id: newId("emp"), company_id: s.cid, name, phone,
    password_hash: await hashPassword(password), role,
    current_project_id: proj && proj.company_id === s.cid ? proj.id : "",
    daily_wage: String(parseFloat(String(b.daily_wage ?? "0")) || 0),
    status: "active", created_at: new Date().toISOString(),
  });
  delete row.password_hash;
  return Response.json({ ok: true, employee: row });
}

/** PATCH /api/employees?id=xx — partial update (assignment, wage, status, reset password). */
export async function PATCH(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s || s.role === "employee") return Response.json({ error: "Not allowed." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") || "";
  const u = await byId("Users", id);
  if (!u || u.company_id !== s.cid) return Response.json({ error: "Not found." }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  if (b.name) patch.name = String(b.name).trim().slice(0, 60);
  if (b.phone) patch.phone = normalizePhone(String(b.phone));
  if (b.daily_wage !== undefined) patch.daily_wage = String(parseFloat(String(b.daily_wage)) || 0);
  if (b.status === "active" || b.status === "inactive") patch.status = b.status;
  if (b.current_project_id !== undefined) {
    const p = b.current_project_id ? await byId("Projects", String(b.current_project_id)) : null;
    patch.current_project_id = p && p.company_id === s.cid ? p.id : "";
  }
  if (b.password) {
    if (s.role !== "admin") return Response.json({ error: "Sirf admin password reset kar sakta hai." }, { status: 403 });
    if (String(b.password).length < 6) return Response.json({ error: "Password at least 6 characters." }, { status: 400 });
    patch.password_hash = await hashPassword(String(b.password));
  }
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to update." }, { status: 400 });
  await update("Users", u.id, patch);
  return Response.json({ ok: true });
}
