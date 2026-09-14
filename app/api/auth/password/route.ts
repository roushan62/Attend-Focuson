import { NextRequest } from "next/server";
import { apiSession, checkPassword, hashPassword, isWriteRequest } from "@/lib/auth";
import { byId, update } from "@/lib/db";

export const dynamic = "force-dynamic";

/** POST /api/auth/password — change own password. */
export async function POST(req: NextRequest) {
  if (!isWriteRequest()) return Response.json({ error: "Bad origin" }, { status: 403 });
  const s = await apiSession();
  if (!s) return Response.json({ error: "Login required." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  if (next.length < 6) return Response.json({ error: "New password at least 6 characters." }, { status: 400 });
  const user = await byId("Users", s.uid);
  if (!user) return Response.json({ error: "User not found." }, { status: 404 });
  if (!(await checkPassword(current, user.password_hash))) {
    return Response.json({ error: "Current password galat hai." }, { status: 400 });
  }
  await update("Users", user.id, { password_hash: await hashPassword(next) });
  return Response.json({ ok: true });
}
