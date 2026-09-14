import { NextRequest } from "next/server";
import { checkPassword, isWriteRequest, normalizePhone, setSessionCookie } from "@/lib/auth";
import { findOne, byId } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — phone + password across all companies (phone is global-unique). */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!phone || !password) return Response.json({ error: "Phone and password required." }, { status: 400 });

  const user = await findOne("Users", (u) => u.phone === phone);
  if (!user || user.status === "inactive" || !(await checkPassword(password, user.password_hash))) {
    return Response.json({ error: "Galat phone number ya password." }, { status: 401 });
  }
  const comp = await byId("Companies", user.company_id);
  await setSessionCookie({
    uid: user.id, role: user.role as any, cid: user.company_id, name: user.name,
  });
  return Response.json({
    ok: true,
    role: user.role,
    next: user.role === "employee" ? "/dashboard" : "/admin",
    company: comp?.name ?? "",
  });
}
