import { clearSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout */
export async function POST() {
  await clearSessionCookie();
  return Response.json({ ok: true });
}
