import { NextRequest } from "next/server";
import { apiSession, isWriteRequest } from "@/lib/auth";
import { list } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/requests — employee: own requests; admin/HR: all (+ pending). */
export async function GET(req: NextRequest) {
  const s = await apiSession();
  if (!s) return Response.json({ error: "Login required." }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status");
  const rows = await list(
    "Requests",
    (r) =>
      r.company_id === s.cid &&
      (s.role === "employee" ? r.employee_id === s.uid : true) &&
      (!status || r.status === status)
  );
  return Response.json({ ok: true, requests: rows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")) });
}
