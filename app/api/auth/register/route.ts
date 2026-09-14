import { NextRequest } from "next/server";
import { apiSession, isWriteRequest, normalizePhone } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { hashPassword } from "@/lib/auth";
import { findOne, insert } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/auth/register — company onboarding: creates company + its admin. */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  if (await apiSession()) {
    return Response.json({ error: "Pehle logout karo, phir nayi company register karo." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const company = String(body.company ?? "").trim();
  const name = String(body.name ?? "").trim();
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");
  if (!company || !name) return Response.json({ error: "Company name and your name are required." }, { status: 400 });
  if (!/^\d{10}$/.test(phone)) return Response.json({ error: "Enter a valid 10-digit mobile number." }, { status: 400 });
  if (password.length < 6) return Response.json({ error: "Password at least 6 characters." }, { status: 400 });

  const existing = await findOne("Users", (u) => u.phone === phone);
  if (existing) return Response.json({ error: "Ye number already registered hai — login karo." }, { status: 409 });

  const compRow = await insert("Companies", {
    id: newId("cmp"), name: company, cutoff_time: "11:00", default_radius_m: "50",
    timezone: "Asia/Kolkata", created_at: new Date().toISOString(),
  });
  await insert("Users", {
    id: newId("emp"), company_id: compRow.id, name, phone,
    password_hash: await hashPassword(password), role: "admin",
    current_project_id: "", daily_wage: "0", status: "active",
    created_at: new Date().toISOString(),
  });
  return Response.json({ ok: true, companyId: compRow.id });
}
