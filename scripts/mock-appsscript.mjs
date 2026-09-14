/**
 * DEV-ONLY mock of the Apps Script Web App (same GET?payload= contract) so the
 * appsscript driver can be exercised locally without deploying anything.
 * Speaks the exact protocol of google-apps-script/Code.gs, backed by
 * .data/mockdb.json. Also answers /exec with a 302 → /exec2 like Google does,
 * to prove the driver survives redirects.
 *
 *   node scripts/mock-appsscript.mjs [port] [secret]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.argv[2] || "3900", 10);
const SECRET = process.argv[3] || "mock-secret";
const FILE = path.join(process.cwd(), ".data", "mockdb.json");

const HEADERS = {
  Companies: ["id", "name", "cutoff_time", "default_radius_m", "timezone", "created_at"],
  Users: ["id", "company_id", "name", "phone", "password_hash", "role", "current_project_id", "daily_wage", "status", "created_at"],
  Projects: ["id", "company_id", "name", "address", "latitude", "longitude", "radius_m", "start_date", "end_date", "status"],
  Attendance: ["id", "company_id", "employee_id", "project_id", "date", "check_in_time", "check_in_lat", "check_in_lng", "check_in_distance_m", "check_out_time", "check_out_lat", "check_out_lng", "check_out_distance_m", "status", "remarks", "approved_by"],
  Requests: ["id", "company_id", "employee_id", "type", "reason", "from_date", "to_date", "project_id", "attendance_id", "status", "review_note", "reviewed_by", "reviewed_at", "created_at"],
};

function load() {
  if (!fs.existsSync(FILE)) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(Object.keys(HEADERS).map((t) => [t, []])), null, 1));
  }
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
const save = (d) => fs.writeFileSync(FILE, JSON.stringify(d, null, 1));

function handle(p) {
  if (p.secret !== SECRET) return { ok: false, error: "invalid or missing secret" };
  if (!HEADERS[p.tab]) return { ok: false, error: "unknown tab: " + p.tab };
  const d = load();
  const hdr = HEADERS[p.tab];
  const str = (v) => (v === null || v === undefined ? "" : String(v));
  if (p.action === "list") {
    return { ok: true, data: d[p.tab].map((r) => Object.fromEntries(hdr.map((h) => [h, str(r[h])]))) };
  }
  if (p.action === "insert") {
    d[p.tab].push(Object.fromEntries(hdr.map((h) => [h, str(p.row?.[h])])));
    save(d);
    return { ok: true, data: p.row };
  }
  if (p.action === "update") {
    const i = d[p.tab].findIndex((r) => str(r.id) === str(p.id));
    if (i === -1) return { ok: false, error: "row not found: " + p.id };
    for (const [k, v] of Object.entries(p.patch || {})) if (v !== undefined && v !== null) d[p.tab][i][k] = str(v);
    save(d);
    return { ok: true, data: p.patch };
  }
  if (p.action === "remove") {
    const before = d[p.tab].length;
    d[p.tab] = d[p.tab].filter((r) => str(r.id) !== str(p.id));
    save(d);
    return { ok: true, data: before !== d[p.tab].length };
  }
  return { ok: false, error: "unknown action" };
}

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/exec") {
      // simulate Google's /exec → content-host 302 (method-safe for GET)
      res.writeHead(302, { Location: "/exec2" + (u.search || "") });
      return res.end();
    }
    if (u.pathname === "/exec2") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const payload = req.method === "GET" ? JSON.parse(u.searchParams.get("payload") || "{}") : JSON.parse(body || "{}");
          const out = handle(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(out));
        } catch (e) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
      return;
    }
    res.writeHead(404).end("mock-appsscript: GET /exec2?payload=...");
  })
  .listen(PORT, "0.0.0.0", () => console.log(`mock Apps Script on http://0.0.0.0:${PORT}/exec (secret: ${SECRET})`));
